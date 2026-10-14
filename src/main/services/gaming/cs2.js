'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { id, nowIso } = require('../../core/util');
const log = require('../../core/logger').scope('cs2');

/**
 * Counter-Strike 2 – Runden-Nachbesprechung über Valves offizielle Game State Integration (GSI).
 * CS2 schickt den Spielzustand per HTTP an 127.0.0.1 (nur deine eigenen Werte: Geld, Ausrüstungswert,
 * Kills, Tod, Rundenergebnis). JARVIS zeigt im Match nichts an und gibt keine Tipps im Spiel –
 * ausgewertet wird nach dem Match. Die Konfigurationsdatei legt JARVIS nur nach Bestätigung an.
 */
const CFG_NAME = 'gamestate_integration_jarvis.cfg';
const BUY = (v) => (v == null ? null : v >= 4000 ? 'voll' : v >= 2000 ? 'halb' : v >= 1000 ? 'force' : 'eco');
const BUY_DE = { voll: 'Vollkauf', halb: 'Halbkauf', force: 'Force-Buy', eco: 'Eco' };

function cfgText(port, token) {
  return `"JARVIS"
{
  "uri" "http://127.0.0.1:${port}/cs2"
  "timeout" "5.0"
  "buffer" "0.1"
  "throttle" "0.5"
  "heartbeat" "30.0"
  "auth"
  {
    "token" "${token}"
  }
  "data"
  {
    "provider" "1"
    "map" "1"
    "round" "1"
    "player_id" "1"
    "player_state" "1"
    "player_match_stats" "1"
  }
}
`;
}

/** Auswertung eines Matches aus den Runden (reine Rechnung). */
function summarize(m) {
  const rounds = m.rounds || [];
  const by = {};
  for (const r of rounds) { const k = r.buy || 'unbekannt'; by[k] = by[k] || { rounds: 0, won: 0 }; by[k].rounds++; if (r.won) by[k].won++; }
  const side = (s) => { const rs = rounds.filter((r) => r.side === s); return rs.length ? { rounds: rs.length, won: rs.filter((r) => r.won).length, kills: rs.reduce((a, r) => a + (r.kills || 0), 0), deaths: rs.filter((r) => r.died).length } : null; };
  const findings = [];
  const fullNoKill = rounds.filter((r) => r.buy === 'voll' && r.died && !r.kills).length;
  if (fullNoKill >= 3) findings.push(`${fullNoKill}× mit Vollkauf ohne Kill gestorben – Positionierung/Timing in diesen Runden ansehen.`);
  const force = by.force; if (force && force.rounds >= 3 && force.won / force.rounds < 0.25) findings.push(`Force-Buys: nur ${force.won} von ${force.rounds} gewonnen – öfter sparen und gemeinsam kaufen?`);
  const multi = rounds.filter((r) => r.kills >= 3).length; if (multi) findings.push(`${multi} Runde${multi > 1 ? 'n' : ''} mit 3+ Kills.`);
  const ct = side('CT'); const t = side('T');
  if (ct && t && Math.abs(ct.kills / Math.max(1, ct.deaths) - t.kills / Math.max(1, t.deaths)) >= 0.5) findings.push(`K/D als CT ${(ct.kills / Math.max(1, ct.deaths)).toFixed(2)}, als T ${(t.kills / Math.max(1, t.deaths)).toFixed(2)} – deutlich unterschiedlich.`);
  const hs = rounds.reduce((a, r) => a + (r.hs || 0), 0); const k = rounds.reduce((a, r) => a + (r.kills || 0), 0);
  return { byBuy: Object.fromEntries(Object.entries(by).map(([b, v]) => [BUY_DE[b] || b, v])), ct, t, hsPct: k ? Math.round(hs / k * 100) : null, findings };
}

class Cs2 {
  constructor(s) {
    this.s = s; this.server = null; this.cur = null;
    s.bus.on('game:running', ({ started = [], stopped = [] } = {}) => { if (started.includes('cs2')) this.start().catch((e) => log.debug('start', e)); if (stopped.includes('cs2')) this.finish('closed'); });
  }
  cfg() { return this.s.settings.get('gaming') || {}; }
  port() { return Number(this.cfg().cs2GsiPort || 3175); }
  token() {
    let t = this.s.secrets.get('cs2.gsi_token');
    if (!t) { t = crypto.randomBytes(16).toString('hex'); this.s.secrets.set('cs2.gsi_token', t); }
    return t;
  }

  async cfgDir() {
    const inst = await this.s.gaming.steam?.installed?.().catch(() => null);
    const a = inst?.get(730);
    return a?.installdir ? path.join(a.installdir, 'game', 'csgo', 'cfg') : null;
  }
  async status() {
    const dir = await this.cfgDir();
    const file = dir ? path.join(dir, CFG_NAME) : null;
    let installed = false; try { installed = !!file && fs.readFileSync(file, 'utf8').includes(`127.0.0.1:${this.port()}/cs2`); } catch { installed = false; }
    return { found: !!dir, installed, file, listening: !!this.server, matches: this.matches().length };
  }
  /** Konfigurationsdatei anlegen (nur auf ausdrücklichen Klick in der Oberfläche). CS2 danach neu starten. */
  async install() {
    const dir = await this.cfgDir();
    if (!dir || !fs.existsSync(dir)) throw new Error('CS2-Installation nicht gefunden (Steam-Bibliothek).');
    const file = path.join(dir, CFG_NAME);
    fs.writeFileSync(file, cfgText(this.port(), this.token()));
    await this.start();
    return { file, restartNeeded: true };
  }

  async start() {
    if (this.server || this.cfg().cs2Gsi === false) return;
    const token = this.token();
    this.server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/cs2') { res.writeHead(404); return res.end(); }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        res.writeHead(200); res.end();
        try { const j = JSON.parse(body); if (j?.auth?.token !== token) return; this.onState(j); } catch (e) { log.debug('gsi', e); }
      });
    });
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.port(), '127.0.0.1', resolve); }).catch((e) => { this.server = null; throw e; });
    log.info('CS2 GSI hört auf 127.0.0.1:' + this.port());
  }
  stop() { try { this.server?.close(); } catch { /* ignore */ } this.server = null; }

  /** Ein GSI-Paket verarbeiten – nur eigene Werte (provider.steamid = player.steamid). */
  onState(j) {
    const map = j.map; const p = j.player; const round = j.round;
    if (!map || !p || p.steamid !== j.provider?.steamid) return; // Zuschauen/Tod → anderer Spieler, ignorieren
    if (map.phase === 'warmup') return;
    if (!this.cur || this.cur.map !== map.name || (map.round === 0 && this.cur.rounds.length > 2)) this.cur = { id: id('cs'), map: map.name, mode: map.mode, startedAt: nowIso(), rounds: [], pending: null };
    const c = this.cur; const st = p.state || {};
    if (round?.phase === 'freezetime') c.pending = { n: (map.round || 0) + 1, side: p.team, money: st.money ?? null, equip: null };
    if (round?.phase === 'live' && c.pending && c.pending.equip == null) c.pending.equip = st.equip_value ?? null;
    if (round?.phase === 'over' && c.pending && !c.rounds.some((r) => r.n === c.pending.n)) {
      const equip = c.pending.equip ?? st.equip_value ?? null;
      c.rounds.push({ n: c.pending.n, side: c.pending.side || p.team, won: round.win_team === (c.pending.side || p.team), kills: st.round_kills || 0, hs: st.round_killhs || 0, died: (st.health ?? 100) === 0, money: c.pending.money, equip, buy: BUY(equip) });
      c.pending = null;
    }
    c.team = p.team;
    c.stats = p.match_stats || c.stats;
    c.score = { ct: map.team_ct?.score ?? null, t: map.team_t?.score ?? null };
    if (map.phase === 'gameover') this.finish('gameover');
  }

  finish(reason) {
    const c = this.cur; this.cur = null;
    if (!c || c.rounds.length < 5) return null;
    const us = c.team === 'CT' ? c.score?.ct : c.score?.t; const them = c.team === 'CT' ? c.score?.t : c.score?.ct;
    const m = { id: c.id, map: c.map, mode: c.mode, startedAt: c.startedAt, endedAt: nowIso(), complete: reason === 'gameover', us, them, result: us == null ? null : us > them ? 'Sieg' : us < them ? 'Niederlage' : 'Unentschieden', stats: c.stats || null, rounds: c.rounds };
    m.summary = summarize(m);
    const list = this.matches(); list.unshift(m);
    this.s.gaming.context.setState('cs2:matches', list.slice(0, 50));
    const st = m.stats || {};
    this.s.notifications.push({ category: 'gaming', origin: 'system', game: 'cs2', dedupeKey: 'cs2:' + m.id, title: `CS2 ${m.map}: ${m.result || 'Match vorbei'}${us != null ? ` ${us}:${them}` : ''}`, body: [`${st.kills ?? '–'}/${st.assists ?? '–'}/${st.deaths ?? '–'}${m.summary.hsPct != null ? ` · ${m.summary.hsPct} % HS` : ''}`, ...m.summary.findings.slice(0, 2)].join(' · ') });
    this.s.bus.emit('game:data', { game: 'cs2' });
    return m;
  }
  matches() { try { return JSON.parse(this.s.gaming.context.getState('cs2:matches') || '[]'); } catch { return []; } }
}

module.exports = { Cs2, cfgText, summarize, BUY };
