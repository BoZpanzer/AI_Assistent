'use strict';
const { safeJson } = require('../../core/util');
const log = require('../../core/logger').scope('gamebrain');

/**
 * Spiegelt Spieldaten dauerhaft ins Brain (Bereich „Gaming“), damit JARVIS
 * sie auch kennt, wenn das Spiel bzw. der Client gerade nicht läuft:
 * - pro Spiel ein Eintrag „Spielstand: <Spiel>“ (wird aktualisiert, mit Verlauf)
 * - League: „Statistik & Rang“ (aktualisiert) + ein Eintrag je Nachbesprechung
 * Einträge stammen aus Spiel-/Client-Daten (Quelle „game“), nie erfunden.
 */
class GameBrainSync {
  constructor(s) {
    this.s = s; this.timers = new Map();
    s.bus.on('game:progress', ({ game } = {}) => { if (game) this.later('progress:' + game, () => this.syncProgress(game)); });
    s.bus.on('game:data', ({ game } = {}) => { if (game === 'league') this.later('lol-stats', () => this.syncLeagueStats(), 15000); });
    s.bus.on('lol:review', (r) => { try { this.addReview(r); } catch (e) { log.warn('review', e); } });
  }

  /** Beim Start: vorhandene Spielstände/Statistiken einmal ins Brain übernehmen. */
  syncAll() {
    for (const r of this.s.db.all('SELECT DISTINCT game FROM game_progress WHERE archived=0')) { try { this.syncProgress(r.game); } catch (e) { log.warn('progress', e); } }
    try { this.syncLeagueStats(); } catch (e) { log.warn('lol-stats', e); }
  }

  later(key, fn, ms = 4000) {
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => { this.timers.delete(key); try { fn(); } catch (e) { log.warn(key, e); } }, ms));
  }
  flush() { for (const [key, t] of this.timers) { clearTimeout(t); this.timers.delete(key); } }

  ctx() { return this.s.gaming.context; }

  /** Create or update one Brain entry identified by a stable key. */
  upsert(key, { title, content, game, tags = [], kind = 'game' }) {
    const ref = safeJson(this.ctx().getState('brain:' + key), null);
    const cur = ref?.id ? this.s.brain.get(ref.id) : null;
    if (!content || !content.trim()) {
      if (cur && !cur.archived) this.s.brain.archive(cur.id, true);
      return null;
    }
    if (cur && !cur.archived) {
      if (cur.content === content && cur.title === title) return cur;
      return this.s.brain.update(cur.id, { title, content, tags }, 'automatisch aus Spieldaten aktualisiert');
    }
    const r = this.s.brain.add({ kind, domain: 'gaming', title, content, game, tags, sourceType: 'game', confidence: 0.95 });
    if (r.entry) this.ctx().setState('brain:' + key, { id: r.entry.id });
    return r.entry;
  }

  syncProgress(gid) {
    const p = this.ctx().profile(gid);
    const name = p?.name || gid;
    const text = this.s.gaming.progress.summary(gid, name, { maxChars: 15000 });
    return this.upsert('progress:' + gid, { title: `Spielstand: ${name}`, content: text ? `Mein aktueller Spielstand in ${name} (automatisch gepflegt):\n${text}` : '', game: gid, tags: ['spielstand', p?.short || name].filter(Boolean) });
  }

  syncLeagueStats() {
    const L = this.s.gaming.league;
    const st = L.stats(20);
    const c = st.current;
    if (!c) return null;
    const me = this.s.gaming.cache.get('lol:me', { allowStale: true })?.value;
    const rank = st.rank ? `${st.rank.tier} ${st.rank.rank || ''} ${st.rank.lp ?? ''} LP (${st.rank.wins ?? '?'}S/${st.rank.losses ?? '?'}N)`.replace(/\s+/g, ' ') : 'unbekannt';
    const lines = [
      `League of Legends${me?.name ? ` – ${me.name}` : ''}, Stand ${new Date().toLocaleDateString('de-DE')}`,
      `Rang (Solo/Duo): ${rank}`,
      `Letzte ${c.games} Ranked-Spiele: ${c.winrate}% Siege, KDA ${c.kda} (Ø ${c.avgK}/${c.avgD}/${c.avgA}), ${c.csPerMin} CS/min${c.vision != null ? `, Vision Ø ${c.vision}` : ''}${c.kp != null ? `, Kill-Beteiligung ${c.kp}%` : ''}`,
      st.champions.length ? 'Champions: ' + st.champions.slice(0, 6).map((x) => `${x.champion} (${x.games} Spiele, ${x.winrate}% Siege, KDA ${x.kda})`).join('; ') : null,
      st.roles.length ? 'Rollen: ' + st.roles.map((r) => `${r.role} ${r.share}%`).join(', ') : null,
      st.insights.length ? 'Hinweise: ' + st.insights.map((i) => i.text).join(' ') : null,
      L.goals().length ? 'Trainingsziele: ' + L.goals().map((g) => g.text).join('; ') : null,
    ].filter(Boolean);
    return this.upsert('lol-stats', { title: 'League of Legends: Statistik & Rang', content: lines.join('\n'), game: 'league', tags: ['lol', 'statistik', 'rang'] });
  }

  addReview(r) {
    if (!r?.summary) return null;
    const day = new Date().toLocaleDateString('de-DE');
    const res = this.s.brain.add({ kind: 'experience', domain: 'gaming', game: 'league', title: `LoL-Nachbesprechung ${day}: ${r.title}`, content: String(r.summary).replace(/\*\*/g, ''), tags: ['lol', 'nachbesprechung', r.win ? 'sieg' : 'niederlage'], sourceType: 'game', confidence: 0.95 });
    return res.entry;
  }
}

module.exports = { GameBrainSync };
