'use strict';
const { id, nowIso, normText, truncate } = require('../../core/util');
const { validate } = require('../../core/validate');

/**
 * Persönlicher Spielstand je Spiel (vom Nutzer gemeldet oder manuell gepflegt).
 * Ein Eintrag = (Spiel, Kategorie, Name) → Wert/Status. Neue Meldungen zum
 * selben Eintrag aktualisieren ihn (mit Verlauf), statt Duplikate anzulegen.
 * Ein „Wipe“/Neustart archiviert den kompletten Stand eines Spiels.
 */
const CATEGORIES = {
  character: 'Charakter', quest: 'Quests', commander: 'Kommandanten', building: 'Gebäude', research: 'Forschung',
  hero: 'Helden/Champions', item: 'Items & Ausrüstung', skill: 'Fähigkeiten', creature: 'Kreaturen/Zähmungen',
  base: 'Basis', achievement: 'Erfolge', resource: 'Ressourcen', other: 'Sonstiges',
};
const STATUS = { done: 'erledigt', in_progress: 'in Arbeit', todo: 'offen', failed: 'fehlgeschlagen' };

const ITEM_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['category', 'name'], properties: {
    category: { type: 'string', enum: Object.keys(CATEGORIES) },
    name: { type: 'string', minLength: 1, maxLength: 120 },
    value: { type: 'string', maxLength: 300 },
    status: { type: 'string', enum: Object.keys(STATUS), nullable: true },
    note: { type: 'string', maxLength: 500 },
    source: { type: 'string', enum: ['chat', 'voice', 'manual', 'api'] },
  },
};

class GameProgress {
  constructor({ db, bus }) { this.db = db; this.bus = bus; }

  toPublic(r) {
    return {
      id: r.id, game: r.game, category: r.category, categoryLabel: CATEGORIES[r.category] || r.category, name: r.name, value: r.value,
      status: r.status, statusLabel: STATUS[r.status] || null, note: r.note, source: r.source, createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }

  find(game, category, name) {
    return this.db.get('SELECT * FROM game_progress WHERE game=? AND category=? AND key=? AND archived=0', game, category, normText(name));
  }

  /** Insert or update. Returns { item, action: created|updated|unchanged, previous }. */
  upsert(game, input) {
    const v = validate(ITEM_SCHEMA, input);
    if (!v.ok) throw new Error(v.errors.join('; '));
    const d = v.value;
    const now = nowIso();
    const prev = this.find(game, d.category, d.name);
    if (prev) {
      const next = { value: d.value ?? prev.value, status: d.status !== undefined ? d.status : prev.status, note: d.note ?? prev.note };
      if (next.value === prev.value && next.status === prev.status && next.note === prev.note) return { item: this.toPublic(prev), action: 'unchanged', previous: null };
      this.db.run('INSERT INTO game_progress_history(progress_id,value,status,at) VALUES(?,?,?,?)', prev.id, prev.value, prev.status, prev.updated_at);
      this.db.run('UPDATE game_progress SET name=?, value=?, status=?, note=?, source=?, updated_at=? WHERE id=?', d.name.trim(), next.value, next.status, next.note, d.source || 'chat', now, prev.id);
      this.changed(game);
      return { item: this.get(prev.id), action: 'updated', previous: { value: prev.value, status: prev.status, note: prev.note } };
    }
    const pid = id('gp');
    this.db.run(`INSERT INTO game_progress(id,game,category,name,key,value,status,note,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      pid, game, d.category, d.name.trim(), normText(d.name), d.value || '', d.status ?? null, d.note || '', d.source || 'chat', now, now);
    this.changed(game);
    return { item: this.get(pid), action: 'created', previous: null };
  }

  /** Undo of an upsert (used by the "Rückgängig" button on chat cards). */
  revert(pid, previous) {
    const r = this.db.get('SELECT * FROM game_progress WHERE id=?', pid);
    if (!r) return null;
    if (!previous) { this.db.run('DELETE FROM game_progress WHERE id=?', pid); this.db.run('DELETE FROM game_progress_history WHERE progress_id=?', pid); }
    else this.db.run('UPDATE game_progress SET value=?, status=?, note=?, updated_at=? WHERE id=?', previous.value ?? '', previous.status ?? null, previous.note ?? '', nowIso(), pid);
    this.changed(r.game);
    return true;
  }

  get(pid) { const r = this.db.get('SELECT * FROM game_progress WHERE id=?', pid); return r ? this.toPublic(r) : null; }

  list(game, { category, status } = {}) {
    let sql = 'SELECT * FROM game_progress WHERE game=? AND archived=0'; const p = [game];
    if (category) { sql += ' AND category=?'; p.push(category); }
    if (status) { sql += ' AND status=?'; p.push(status); }
    sql += ' ORDER BY category, updated_at DESC';
    return this.db.all(sql, ...p).map((r) => this.toPublic(r));
  }

  history(pid) { return this.db.all('SELECT value, status, at FROM game_progress_history WHERE progress_id=? ORDER BY id DESC LIMIT 20', pid); }

  remove(pid) {
    const r = this.db.get('SELECT game FROM game_progress WHERE id=?', pid);
    if (!r) return null;
    this.db.run('DELETE FROM game_progress WHERE id=?', pid);
    this.db.run('DELETE FROM game_progress_history WHERE progress_id=?', pid);
    this.changed(r.game);
    return true;
  }

  /** Wipe / neuer Spielstand: alles archivieren (bleibt als Verlauf erhalten). */
  wipe(game, label = '') {
    const n = this.db.run("UPDATE game_progress SET archived=1, season=? WHERE game=? AND archived=0", label || 'bis ' + new Date().toLocaleDateString('de-DE'), game).changes;
    this.changed(game);
    return { archived: n };
  }

  doneKeys(game, category) {
    return new Set(this.db.all("SELECT key FROM game_progress WHERE game=? AND category=? AND status='done' AND archived=0", game, category).map((r) => r.key));
  }

  counts(game) {
    return Object.fromEntries(this.db.all('SELECT category, COUNT(*) c FROM game_progress WHERE game=? AND archived=0 GROUP BY category', game).map((r) => [r.category, r.c]));
  }

  /**
   * Compact text for the system prompt. Bounded size: long quest lists are
   * summarized (the model can fetch everything with get_game_progress).
   */
  summary(game, gameName, { maxChars = 1800 } = {}) {
    const rows = this.list(game);
    if (!rows.length) return '';
    const lines = [];
    const byCat = {};
    for (const r of rows) (byCat[r.category] = byCat[r.category] || []).push(r);
    const d = (iso) => new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    for (const [cat, list] of Object.entries(byCat)) {
      const label = CATEGORIES[cat] || cat;
      const done = list.filter((r) => r.status === 'done' && !r.value);
      const rest = list.filter((r) => !(r.status === 'done' && !r.value));
      if (done.length) {
        const names = done.map((r) => r.name);
        const shown = names.slice(0, 25).join(', ');
        lines.push(`- ${label} erledigt (${done.length}): ${shown}${names.length > 25 ? ` … +${names.length - 25} weitere` : ''}`);
      }
      for (const r of rest.slice(0, 20)) {
        lines.push(`- ${label}: ${r.name}${r.value ? ' – ' + r.value : ''}${r.status ? ` [${STATUS[r.status]}]` : ''}${r.note ? ` (${truncate(r.note, 60)})` : ''} · Stand ${d(r.updatedAt)}`);
      }
      if (rest.length > 20) lines.push(`- ${label}: … +${rest.length - 20} weitere`);
    }
    let text = `Bekannter Spielstand ${gameName} (vom Nutzer gemeldet, kann veraltet sein):\n` + lines.join('\n');
    if (text.length > maxChars) text = text.slice(0, maxChars - 40) + '\n- … (vollständig über get_game_progress)';
    return text;
  }

  changed(game) { this.bus?.emit('game:progress', { game }); }
}

module.exports = { GameProgress, CATEGORIES, STATUS, ITEM_SCHEMA };
