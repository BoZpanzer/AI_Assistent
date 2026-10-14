'use strict';
const { id, nowIso } = require('../../core/util');
const log = require('../../core/logger').scope('playtime');

/**
 * Spielzeit für alle Spiele – auch ohne Steam (LoL, Tarkov, RoK …): Sessions aus der Prozesserkennung.
 * Läuft ein Spiel, wird die Session jede Minute „gesehen“; stürzt JARVIS ab, endet die Session beim
 * letzten Lebenszeichen statt beim nächsten Start. Nur lokal gespeichert.
 */
const HEARTBEAT_MS = 60000;
const MIN_SESSION_SEC = 120; // kürzere Starts (Launcher, Absturz) zählen nicht

class Playtime {
  constructor(s) {
    this.s = s;
    this.closeStale();
    s.bus.on('game:running', ({ started = [], stopped = [] } = {}) => { for (const g of started) this.begin(g); for (const g of stopped) this.end(g); });
    this.timer = setInterval(() => this.heartbeat(), HEARTBEAT_MS); this.timer.unref?.();
  }
  db() { return this.s.db; }
  open(game) { return this.db().get('SELECT * FROM game_sessions WHERE game=? AND end_at IS NULL ORDER BY start_at DESC LIMIT 1', game); }
  begin(game, at = nowIso()) {
    if (this.open(game)) return;
    this.db().run('INSERT INTO game_sessions(id,game,start_at,end_at,last_seen) VALUES(?,?,?,NULL,?)', id('gs'), game, at, at);
  }
  end(game, at = nowIso()) {
    const o = this.open(game); if (!o) return;
    if ((Date.parse(at) - Date.parse(o.start_at)) / 1000 < MIN_SESSION_SEC) this.db().run('DELETE FROM game_sessions WHERE id=?', o.id);
    else this.db().run('UPDATE game_sessions SET end_at=?, last_seen=? WHERE id=?', at, at, o.id);
    this.s.bus.emit('game:data', { game });
  }
  heartbeat(now = nowIso()) {
    const running = this.s.gaming?.context?.running || [];
    for (const g of running) { if (!this.open(g)) this.begin(g, now); else this.db().run('UPDATE game_sessions SET last_seen=? WHERE game=? AND end_at IS NULL', now, g); }
    // Sessions, deren Spiel nicht mehr läuft (verpasstes Ereignis), schließen
    for (const o of this.db().all('SELECT * FROM game_sessions WHERE end_at IS NULL')) if (!running.includes(o.game)) this.end(o.game, o.last_seen);
  }
  /** Beim Start: offene Sessions vom letzten Lauf (Absturz/Herunterfahren) beim letzten Lebenszeichen beenden. */
  closeStale() {
    try { for (const o of this.db().all('SELECT * FROM game_sessions WHERE end_at IS NULL')) this.end(o.game, o.last_seen); } catch (e) { log.debug('stale', e); }
  }
  stop() { clearInterval(this.timer); for (const o of this.db().all('SELECT * FROM game_sessions WHERE end_at IS NULL')) this.end(o.game); }

  /**
   * Auswertung: pro Spiel heute / diese Woche / letzte Woche / 30 Tage, Sessions, längste Session,
   * Tageswerte der letzten 14 Tage. Laufende Sessions zählen bis jetzt.
   */
  stats({ now = new Date(), game = null } = {}) {
    const nowMs = now.getTime();
    const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const week0 = day0 - ((now.getDay() + 6) % 7) * 86400000;
    const since = Math.min(week0 - 7 * 86400000, day0 - 30 * 86400000);
    const rows = this.db().all('SELECT * FROM game_sessions WHERE (end_at IS NULL OR end_at >= ?)' + (game ? ' AND game=?' : '') + ' ORDER BY start_at', new Date(since).toISOString(), ...(game ? [game] : []));
    const names = Object.fromEntries((this.s.gaming?.context?.profiles?.() || []).map((p) => [p.id, p.name]));
    const per = {};
    const overlap = (a, b, from, to) => Math.max(0, Math.min(b, to) - Math.max(a, from));
    for (const r of rows) {
      const a = Date.parse(r.start_at); const b = r.end_at ? Date.parse(r.end_at) : nowMs;
      const g = per[r.game] = per[r.game] || { game: r.game, name: names[r.game] || r.game, today: 0, week: 0, lastWeek: 0, last30: 0, sessions: 0, longest: 0, daily: Array(14).fill(0), running: false };
      g.today += overlap(a, b, day0, nowMs); g.week += overlap(a, b, week0, nowMs); g.lastWeek += overlap(a, b, week0 - 7 * 86400000, week0);
      g.last30 += overlap(a, b, day0 - 29 * 86400000, nowMs);
      if (b >= day0 - 29 * 86400000) { g.sessions++; g.longest = Math.max(g.longest, b - a); }
      for (let i = 0; i < 14; i++) { const d = day0 - (13 - i) * 86400000; g.daily[i] += overlap(a, b, d, d + 86400000); }
      if (!r.end_at) g.running = true;
    }
    const min = (ms) => Math.round(ms / 60000);
    const games = Object.values(per).map((g) => ({ ...g, today: min(g.today), week: min(g.week), lastWeek: min(g.lastWeek), last30: min(g.last30), longest: min(g.longest), avgSession: g.sessions ? Math.round(min(g.last30) / g.sessions) : null, daily: g.daily.map(min) })).sort((a, b) => b.week - a.week || b.last30 - a.last30);
    const sum = (k) => games.reduce((x, g) => x + g[k], 0);
    return { games, total: { today: sum('today'), week: sum('week'), lastWeek: sum('lastWeek'), last30: sum('last30') }, since: new Date(since).toISOString() };
  }
  /** Zuletzt gespielte Spiele (für Patch-Notes). */
  recentGames(days = 30) {
    return this.db().all('SELECT game, MAX(COALESCE(end_at,last_seen)) last FROM game_sessions WHERE COALESCE(end_at,last_seen) >= ? GROUP BY game ORDER BY last DESC', new Date(Date.now() - days * 86400000).toISOString()).map((r) => r.game);
  }
}

module.exports = { Playtime, MIN_SESSION_SEC };
