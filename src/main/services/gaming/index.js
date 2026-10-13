'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { id, nowIso, safeJson, truncate } = require('../../core/util');
const { validate } = require('../../core/validate');
const { GameContext } = require('./context');
const { GameCache } = require('./cache');
const { Tarkov } = require('./tarkov');
const { League } = require('./league');
const { Wiki } = require('./wiki');
const { GameProgress } = require('./progress');

/**
 * Widget registry. The orchestrator may only pick from these types; params are
 * validated; the renderer has a fixed component per type. No model-generated
 * HTML/JS is ever rendered.
 */
const WIDGETS = {
  'game-research': { title: 'Recherche', params: { query: { type: 'string', maxLength: 300 } } },
  'wiki': { title: 'Wiki', params: { query: { type: 'string', maxLength: 200 }, page: { type: 'string', maxLength: 200 } } },
  'notes': { title: 'Eigene Notizen', params: {} },
  'timers': { title: 'Timer', params: { kinds: { type: 'array', items: { type: 'string' } } } },
  'map': { title: 'Interaktive Karte', params: { map: { type: 'string', maxLength: 60 } } },
  'checklist': { title: 'Checkliste', params: { name: { type: 'string', maxLength: 60 } } },
  'sources': { title: 'Gespeicherte Quellen', params: {} },
  'other-games': { title: 'Andere Spiele – Benachrichtigungen', params: {} },
  'tarkov-raid': { title: 'Raid-Status & Hilfe', params: { map: { type: 'string', maxLength: 60 }, tab: { type: 'string', enum: ['overview', 'exits', 'quests', 'keys', 'bosses'] } } },
  'tarkov-quests': { title: 'Quest-Informationen', params: { map: { type: 'string', maxLength: 60 }, query: { type: 'string', maxLength: 120 } } },
  'tarkov-item': { title: 'Item-Details', params: { query: { type: 'string', maxLength: 120 }, keysOnly: { type: 'boolean' } } },
  'lol-overview': { title: 'Performance', params: {} },
  'lol-champions': { title: 'Champions & Rollen', params: {} },
  'lol-matches': { title: 'Letzte Spiele', params: {} },
  'lol-coaching': { title: 'Coaching & Insights', params: {} },
  'lol-live': { title: 'Live-Match', params: {} },
  'lol-champion': { title: 'Championinfo', params: { champion: { type: 'string', maxLength: 40 } } },
  'lol-goals': { title: 'Trainingsziele', params: {} },
  'rok-planner': { title: 'Entwicklungsplanung', params: {} },
  progress: { title: 'Mein Spielstand', params: { category: { type: 'string', maxLength: 30 } } },
};

const LAYOUTS = {
  tarkov: [{ type: 'map' }, { type: 'tarkov-raid' }, { type: 'tarkov-quests' }, { type: 'progress' }, { type: 'tarkov-item', params: { keysOnly: true } }, { type: 'checklist', params: { name: 'Raid-Checkliste' } }, { type: 'other-games' }],
  league: [{ type: 'lol-overview' }, { type: 'lol-champions' }, { type: 'lol-matches' }, { type: 'lol-coaching' }, { type: 'lol-live' }, { type: 'lol-goals' }, { type: 'progress' }, { type: 'other-games' }],
  rok: [{ type: 'progress' }, { type: 'timers', params: { kinds: ['build', 'research', 'training', 'custom'] } }, { type: 'rok-planner' }, { type: 'game-research', params: { query: '' } }, { type: 'notes' }, { type: 'sources' }, { type: 'other-games' }],
  generic: [{ type: 'progress' }, { type: 'game-research', params: { query: '' } }, { type: 'wiki' }, { type: 'notes' }, { type: 'timers' }, { type: 'sources' }, { type: 'other-games' }],
};

const TIMER_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  game: { type: 'string', maxLength: 80 }, label: { type: 'string', minLength: 1, maxLength: 120 },
  kind: { type: 'string', enum: ['build', 'research', 'training', 'taming', 'breeding', 'crafting', 'event', 'custom'] },
  minutes: { type: 'number', minimum: 0.1, maximum: 60 * 24 * 60 }, endsAt: { type: 'string', format: 'date-time' }, note: { type: 'string', maxLength: 300 } } };

class Gaming {
  constructor(ctx) {
    this.db = ctx.db; this.bus = ctx.bus; this.settings = ctx.settings; this.notifications = ctx.notifications; this.brain = ctx.brain; this.web = ctx.web;
    this.dataDir = ctx.paths.data;
    this.cache = new GameCache(ctx.db);
    const sub = { ...ctx, gameCache: this.cache };
    this.context = new GameContext(sub);
    this.tarkov = new Tarkov(sub);
    this.league = new League(sub);
    this.wiki = new Wiki(sub);
    this.progress = new GameProgress(sub);
    this.focus = null; // contextual widget pushed by the orchestrator
  }

  // ----- layout -----
  layout(gid) {
    const p = this.context.profile(gid);
    if (!p) return null;
    const base = LAYOUTS[p.integration] || LAYOUTS.generic;
    const custom = safeJson(this.context.getState('layout:' + gid), null);
    let widgets = (custom || base).map((w) => ({ ...w, params: w.params || {} }));
    if (p.integration === 'generic' && !p.wiki) widgets = widgets.filter((w) => w.type !== 'wiki');
    const focus = this.focus && this.focus.game === gid ? this.focus : null;
    return { game: p, widgets, focus, widgetTitles: Object.fromEntries(Object.entries(WIDGETS).map(([k, v]) => [k, v.title])) };
  }

  /** Validated widget request (from orchestrator or UI). */
  pushWidget(gid, type, params = {}) {
    const def = WIDGETS[type];
    if (!def) throw new Error('Unbekanntes Widget: ' + type);
    const p = this.context.profile(gid);
    if (!p) throw new Error('Unbekanntes Spiel');
    if (type.startsWith('tarkov-') && p.integration !== 'tarkov') throw new Error('Widget passt nicht zum Spiel');
    if (type.startsWith('lol-') && p.integration !== 'league') throw new Error('Widget passt nicht zum Spiel');
    const v = validate({ type: 'object', additionalProperties: false, properties: def.params }, params);
    if (!v.ok) throw new Error(v.errors.join('; '));
    this.focus = { game: gid, type, params: v.value, at: nowIso() };
    this.bus.emit('game:focus', this.focus);
    return this.focus;
  }

  // ----- timers (estimates — never presented as verified game state) -----
  addTimer(input) {
    const v = validate(TIMER_SCHEMA, input);
    if (!v.ok) throw new Error(v.errors.join('; '));
    const d = v.value;
    const prof = this.context.resolve(d.game || '') || null;
    if (!prof) throw new Error('Spiel unbekannt');
    const ends = d.endsAt ? new Date(d.endsAt) : new Date(Date.now() + (d.minutes || 0) * 60000);
    if (isNaN(ends) || ends <= new Date()) throw new Error('Timer-Ende liegt in der Vergangenheit');
    const tid = id('tm');
    this.db.run('INSERT INTO game_timers(id,game,label,kind,ends_at,created_at,note) VALUES(?,?,?,?,?,?,?)', tid, prof.id, d.label, d.kind || 'custom', ends.toISOString(), nowIso(), d.note || '');
    this.bus.emit('game:timers', {});
    return this.timer(tid);
  }
  timer(tid) { const r = this.db.get('SELECT * FROM game_timers WHERE id=?', tid); return r ? this.timerPublic(r) : null; }
  timerPublic(r) {
    const p = this.context.profile(r.game);
    return { id: r.id, game: r.game, gameName: p?.name || r.game, label: r.label, kind: r.kind, endsAt: r.ends_at, createdAt: r.created_at, fired: !!r.fired, note: r.note, origin: 'timer', estimate: true };
  }
  timers({ game, includeFired = false } = {}) {
    let sql = 'SELECT * FROM game_timers WHERE 1=1'; const p = [];
    if (game) { sql += ' AND game=?'; p.push(game); }
    if (!includeFired) sql += ' AND (fired=0 OR ends_at>?)', p.push(new Date(Date.now() - 6 * 3600000).toISOString());
    sql += ' ORDER BY fired, ends_at LIMIT 100';
    return this.db.all(sql, ...p).map((r) => this.timerPublic(r));
  }
  removeTimer(tid) { const t = this.timer(tid); this.db.run('DELETE FROM game_timers WHERE id=?', tid); this.bus.emit('game:timers', {}); return t; }

  /** Fire due timers → notification ("estimated", not verified game state). */
  checkTimers(now = new Date()) {
    const nick = this.settings.get('nickname') || 'Chef';
    const due = this.db.all('SELECT * FROM game_timers WHERE fired=0 AND ends_at<=?', now.toISOString());
    for (const r of due) {
      this.db.run('UPDATE game_timers SET fired=1 WHERE id=?', r.id);
      const p = this.context.profile(r.game);
      this.notifications.push({ category: 'gaming', origin: 'timer', game: r.game, dedupeKey: 'timer:' + r.id,
        title: `${p?.short || p?.name || r.game}: ${r.label}`,
        body: `${nick}, dein ${r.label}-Timer ist abgelaufen. (Gespeicherter Timer – kein bestätigter Spielstatus.)` });
    }
    if (due.length) this.bus.emit('game:timers', {});
    return due.length;
  }

  // ----- maps & markers -----
  maps(gid) {
    return this.db.all('SELECT * FROM game_maps WHERE game=? ORDER BY name', gid).map((m) => ({ id: m.id, game: m.game, name: m.name, hasImage: !!m.image_file, width: m.width, height: m.height,
      calibration: safeJson(this.context.getState(`calib:${gid}:${m.name}`), null) }));
  }
  /** Import a user-provided map image (copied into the data dir). */
  importMapImage(gid, name, srcFile, { width, height } = {}) {
    const ext = path.extname(srcFile).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) throw new Error('Nur PNG/JPG/WebP');
    const st = fs.statSync(srcFile);
    if (st.size > 40 * 1024 * 1024) throw new Error('Bild zu groß (max. 40 MB)');
    const dir = path.join(this.dataDir, 'maps', gid);
    fs.mkdirSync(dir, { recursive: true });
    const file = `${name.replace(/[^\w\-]+/g, '_').slice(0, 40)}${ext}`;
    fs.copyFileSync(srcFile, path.join(dir, file));
    this.db.run(`INSERT INTO game_maps(id,game,name,image_file,width,height,created_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(game,name) DO UPDATE SET image_file=excluded.image_file, width=excluded.width, height=excluded.height`, id('map'), gid, name, file, width || null, height || null, nowIso());
    this.bus.emit('game:markers', { game: gid, map: name });
    return this.maps(gid).find((m) => m.name === name);
  }
  mapImagePath(gid, name) {
    const m = this.db.get('SELECT image_file FROM game_maps WHERE game=? AND name=?', gid, name);
    if (!m?.image_file) return null;
    const p = path.join(this.dataDir, 'maps', gid, m.image_file);
    return p.startsWith(path.join(this.dataDir, 'maps')) && fs.existsSync(p) ? p : null;
  }
  ensureMap(gid, name) {
    this.db.run('INSERT OR IGNORE INTO game_maps(id,game,name,created_at) VALUES(?,?,?,?)', id('map'), gid, name, nowIso());
  }
  /** Two reference points (image x/y in 0..1 ↔ game x/z) → similarity transform. */
  setCalibration(gid, map, points) {
    if (!Array.isArray(points) || points.length !== 2) throw new Error('Genau zwei Referenzpunkte nötig');
    for (const p of points) for (const k of ['ix', 'iy', 'gx', 'gz']) if (!Number.isFinite(p[k])) throw new Error('Ungültiger Referenzpunkt');
    this.context.setState(`calib:${gid}:${map}`, { points });
    this.bus.emit('game:markers', { game: gid, map });
    return { points };
  }
  markers(gid, map) {
    return this.db.all('SELECT * FROM game_markers WHERE game=? AND map=? ORDER BY created_at', gid, map).map((m) => ({ id: m.id, x: m.x, y: m.y, category: m.category, label: m.label, note: m.note, createdAt: m.created_at, updatedAt: m.updated_at }));
  }
  addMarker(gid, map, { x, y, category = 'custom', label = '', note = '' }) {
    if (![x, y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error('Ungültige Position');
    const cats = ['exit', 'loot', 'danger', 'quest', 'key', 'custom'];
    if (!cats.includes(category)) category = 'custom';
    this.ensureMap(gid, map);
    const mid = id('mk'); const now = nowIso();
    this.db.run('INSERT INTO game_markers(id,game,map,x,y,category,label,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)', mid, gid, map, x, y, category, String(label).slice(0, 80), String(note).slice(0, 500), now, now);
    this.bus.emit('game:markers', { game: gid, map });
    return mid;
  }
  updateMarker(mid, patch) {
    const m = this.db.get('SELECT * FROM game_markers WHERE id=?', mid);
    if (!m) throw new Error('Marker nicht gefunden');
    const x = patch.x ?? m.x, y = patch.y ?? m.y;
    if (![x, y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error('Ungültige Position');
    this.db.run('UPDATE game_markers SET x=?, y=?, category=?, label=?, note=?, updated_at=? WHERE id=?', x, y, patch.category ?? m.category, String(patch.label ?? m.label).slice(0, 80), String(patch.note ?? m.note).slice(0, 500), nowIso(), mid);
    this.bus.emit('game:markers', { game: m.game, map: m.map });
  }
  removeMarker(mid) {
    const m = this.db.get('SELECT game, map FROM game_markers WHERE id=?', mid);
    this.db.run('DELETE FROM game_markers WHERE id=?', mid);
    if (m) this.bus.emit('game:markers', m);
  }
  clearMarkers(gid, map) { this.db.run('DELETE FROM game_markers WHERE game=? AND map=?', gid, map); this.bus.emit('game:markers', { game: gid, map }); }
  routes(gid, map) { return this.db.all('SELECT * FROM game_routes WHERE game=? AND map=? ORDER BY created_at DESC', gid, map).map((r) => ({ id: r.id, name: r.name, points: safeJson(r.points, []) })); }
  saveRoute(gid, map, name, points) {
    if (!Array.isArray(points) || points.length < 2 || points.length > 50) throw new Error('Route braucht 2–50 Punkte');
    const clean = points.map((p) => ({ x: Number(p.x), y: Number(p.y), label: String(p.label || '').slice(0, 40) })).filter((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
    const rid = id('rt');
    this.db.run('INSERT INTO game_routes(id,game,map,name,points,created_at) VALUES(?,?,?,?,?,?)', rid, gid, map, String(name).slice(0, 60), JSON.stringify(clean), nowIso());
    this.bus.emit('game:markers', { game: gid, map });
    return rid;
  }
  removeRoute(rid) { this.db.run('DELETE FROM game_routes WHERE id=?', rid); this.bus.emit('game:markers', {}); }

  // ----- checklists (per game, user-defined) -----
  checklist(gid, name = 'Checkliste') {
    const d = safeJson(this.context.getState(`checklist:${gid}:${name}`), null);
    if (d) return d;
    if (gid === 'eft' && name === 'Raid-Checkliste') {
      return { name, items: ['Ausrüstung geprüft', 'Heilung dabei', 'Munition & Magazine', 'Quest-Items', 'Schlüssel', 'Rucksack frei', 'Exit-Route geplant'].map((t) => ({ id: id('ci'), text: t, done: false })) };
    }
    return { name, items: [] };
  }
  saveChecklist(gid, name, items) {
    if (!Array.isArray(items) || items.length > 60) throw new Error('Ungültige Checkliste');
    const clean = items.map((i) => ({ id: String(i.id || id('ci')).slice(0, 40), text: String(i.text || '').slice(0, 120), done: !!i.done })).filter((i) => i.text);
    this.context.setState(`checklist:${gid}:${name}`, { name, items: clean });
    this.bus.emit('game:data', { game: gid });
    return { name, items: clean };
  }

  // ----- game knowledge -----
  notes(gid) { return this.brain.list({ domain: 'gaming', game: gid, limit: 50 }); }
  addNote(gid, text, title) {
    return this.brain.add({ kind: 'note', domain: 'gaming', game: gid, title: title || truncate(text, 60), content: text, sourceType: 'user' });
  }
  sources(gid) {
    return this.db.all("SELECT * FROM knowledge WHERE game=? AND source_type='web' AND archived=0 ORDER BY updated_at DESC LIMIT 20", gid).map((r) => this.brain.toPublic(r));
  }

  /** Research for a game, cached 3 days, stored in history with sources. */
  async research(gid, query) {
    const p = this.context.profile(gid);
    const q = `${p?.name || gid}: ${query}`;
    const key = 'research:' + q.toLowerCase();
    const r = await this.cache.wrap(key, 'Google-Suche (Gemini)', 3 * 86400000, async () => {
      const res = await this.web.research(q + ' — beachte die aktuelle Spielversion und nenne die Version/das Datum der Quelle.', { game: gid });
      return { answer: res.answer, sources: res.sources, researchId: res.id };
    });
    return { ...r.value, fetchedAt: r.fetchedAt, cached: !!r.fetchedAt && Date.now() - Date.parse(r.fetchedAt) > 5000, query };
  }

  otherGameNotifications(activeId) {
    return this.notifications.list({ category: 'gaming', limit: 12, excludeGame: activeId || undefined })
      .concat(this.timers().filter((t) => t.game !== activeId && !t.fired).slice(0, 6).map((t) => ({ id: t.id, title: `${t.gameName}: ${t.label}`, body: 'Läuft bis ' + new Date(t.endsAt).toLocaleString('de-DE'), origin: 'timer', originLabel: 'Eigener Timer (Zeitabschätzung)', game: t.game, createdAt: t.createdAt, pending: true, endsAt: t.endsAt })));
  }

  /** Erkennt Spiele, die in einem Text erwähnt werden (für den Kontext). */
  mentionedGames(text, max = 3) {
    const t = ' ' + require('../../core/util').normText(text) + ' ';
    const out = [];
    for (const p of this.context.profiles()) {
      const names = [p.name, p.short, ...(p.aliases || [])].filter(Boolean).map((a) => require('../../core/util').normText(a)).filter((a) => a.length >= 3);
      if (names.some((a) => t.includes(' ' + a + ' '))) out.push(p);
      if (out.length >= max) break;
    }
    return out;
  }

  /** Spielstand-Kontext für den Systemprompt: aktives, besprochenes und erwähnte Spiele. */
  progressContext(text = '', { maxGames = 3 } = {}) {
    const st = this.context.state();
    const games = [];
    const add = (p) => { if (p && !games.some((g) => g.id === p.id)) games.push(p); };
    add(st.active?.profile); add(st.discussed?.profile);
    for (const p of this.mentionedGames(text)) add(p);
    return games.slice(0, maxGames).map((p) => this.progress.summary(p.id, p.name)).filter(Boolean).join('\n\n');
  }

  // ----- RoK planner (user-maintained plan, no invented game data) -----
  plan(gid) { return safeJson(this.context.getState('plan:' + gid), { goals: [] }); }
  savePlan(gid, plan) {
    const goals = (plan.goals || []).slice(0, 40).map((g) => ({ id: String(g.id || id('pg')), text: String(g.text || '').slice(0, 160), category: String(g.category || 'Allgemein').slice(0, 30), done: !!g.done, due: g.due || null })).filter((g) => g.text);
    this.context.setState('plan:' + gid, { goals });
    this.bus.emit('game:data', { game: gid });
    return { goals };
  }
}

module.exports = { Gaming, WIDGETS, LAYOUTS };
