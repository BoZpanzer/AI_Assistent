'use strict';
const { nowIso } = require('../../core/util');
const log = require('../../core/logger').scope('pubg');

/**
 * PUBG – Nachbesprechung über die offizielle PUBG-API (kostenloser Schlüssel von developer.pubg.com):
 * Matches des Spielers, Telemetrie (Positionen, Landung, Tod). Route und Landungen werden auf einer
 * Kartenfläche gezeichnet. Nur nach dem Match, 10 Anfragen/Minute (API-Grenze).
 */
const API = 'https://api.pubg.com';
// Kartengrößen in Zentimetern (offizielle API-Doku); unbekannte Karten: aus den Daten
const MAPS = { Baltic_Main: ['Erangel', 816000], Erangel_Main: ['Erangel', 816000], Desert_Main: ['Miramar', 816000], Savage_Main: ['Sanhok', 408000], DihorOtok_Main: ['Vikendi', 816000], Tiger_Main: ['Taego', 816000], Kiki_Main: ['Deston', 816000], Neon_Main: ['Rondo', 816000], Summerland_Main: ['Karakin', 204000], Chimera_Main: ['Paramo', 306000], Heaven_Main: ['Haven', 102000], Range_Main: ['Camp Jackal', 204000] };

/** Telemetrie → eigene Route (alle ~10 s), Landung, Tod. */
function analyzeTelemetry(events, accountId) {
  const mine = (c) => c && c.accountId === accountId;
  const route = []; let lastT = -1e9; let landing = null; let death = null; const kills = [];
  for (const e of events || []) {
    const t = e._T;
    if (t === 'LogPlayerPosition' && mine(e.character) && e.elapsedTime != null && e.elapsedTime - lastT >= 10) { route.push([Math.round(e.character.location.x), Math.round(e.character.location.y), Math.round(e.elapsedTime)]); lastT = e.elapsedTime; }
    if (t === 'LogParachuteLanding' && mine(e.character) && !landing) landing = { x: Math.round(e.character.location.x), y: Math.round(e.character.location.y) };
    if ((t === 'LogPlayerKillV2' || t === 'LogPlayerKill') && mine(e.victim)) {
      const k = e.finisher || e.killer || null;
      death = { x: Math.round(e.victim.location?.x || 0), y: Math.round(e.victim.location?.y || 0), by: k?.name || null, weapon: e.finishDamageInfo?.damageCauserName || e.damageCauserName || null, distanceM: e.finishDamageInfo?.distance != null ? Math.round(e.finishDamageInfo.distance / 100) : null };
    }
    if ((t === 'LogPlayerKillV2' || t === 'LogPlayerKill') && mine(e.finisher || e.killer) && !mine(e.victim)) kills.push({ x: Math.round(e.victim?.location?.x || 0), y: Math.round(e.victim?.location?.y || 0) });
  }
  return { route, landing, death, kills };
}

class Pubg {
  constructor(s) {
    this.s = s;
    s.bus.on('game:running', ({ stopped = [] } = {}) => { if (stopped.includes('pubg')) setTimeout(() => this.sync().catch((e) => log.debug('sync', e)), 90_000); });
  }
  key() { return this.s.secrets.get('pubg.api_key') || null; }
  cfg() { return this.s.settings.get('gaming') || {}; }
  async get(path, { auth = true } = {}) {
    const r = await this.s.fetch(API + path, { headers: { Accept: 'application/vnd.api+json', ...(auth ? { Authorization: 'Bearer ' + this.key() } : {}) }, signal: AbortSignal.timeout(20000) });
    if (r.status === 401) throw new Error('PUBG-API-Schlüssel ungültig');
    if (r.status === 404) throw new Error('Nicht gefunden – stimmt der Spielername?');
    if (r.status === 429) throw new Error('PUBG-API: zu viele Anfragen, gleich nochmal');
    if (!r.ok) throw new Error('PUBG-API ' + r.status);
    return r.json();
  }
  matches() { try { return JSON.parse(this.s.gaming.context.getState('pubg:matches') || '[]'); } catch { return []; } }

  /** Neue Matches holen und auswerten (höchstens 3 pro Lauf wegen der Anfrage-Grenze). */
  async sync({ max = 3 } = {}) {
    const name = String(this.cfg().pubgName || '').trim(); const shard = this.cfg().pubgShard || 'steam';
    if (!this.key() || !name) return { skipped: 'PUBG-Schlüssel oder Spielername fehlt (Einstellungen → Gaming).' };
    const pl = await this.get(`/shards/${shard}/players?filter[playerNames]=${encodeURIComponent(name)}`);
    const player = pl.data?.[0]; if (!player) throw new Error('Spieler nicht gefunden');
    const ids = (player.relationships?.matches?.data || []).map((m) => m.id);
    const have = new Set(this.matches().map((m) => m.id));
    const todo = ids.filter((x) => !have.has(x)).slice(0, max);
    const out = [];
    for (const mid of todo) {
      try {
        const m = await this.get(`/shards/${shard}/matches/${mid}`, { auth: false });
        const at = m.data?.attributes || {};
        const part = (m.included || []).find((x) => x.type === 'participant' && x.attributes?.stats?.playerId === player.id);
        const st = part?.attributes?.stats || {};
        const asset = (m.included || []).find((x) => x.type === 'asset')?.attributes?.URL;
        let tele = null;
        if (asset && /^https:\/\//.test(asset)) { const r = await this.s.fetch(asset, { signal: AbortSignal.timeout(60000) }); if (r.ok) tele = analyzeTelemetry(await r.json(), player.id); }
        const [mapName, size] = MAPS[at.mapName] || [at.mapName, null];
        out.push({ id: mid, at: at.createdAt, map: mapName, mapSize: size, mode: at.gameMode, duration: at.duration, place: st.winPlace ?? null, kills: st.kills ?? 0, damage: Math.round(st.damageDealt || 0), survived: Math.round(st.timeSurvived || 0), walk: Math.round(st.walkDistance || 0), ride: Math.round(st.rideDistance || 0), headshots: st.headshotKills ?? 0, ...(tele || {}) });
      } catch (e) { log.debug('match ' + mid, e); }
    }
    if (out.length) {
      const list = [...out, ...this.matches()].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 60);
      this.s.gaming.context.setState('pubg:matches', list);
      const last = out[0];
      this.s.notifications.push({ category: 'gaming', origin: 'system', game: 'pubg', dedupeKey: 'pubg:' + last.id, title: `PUBG ${last.map}: Platz ${last.place ?? '–'}`, body: `${last.kills} Kills · ${last.damage} Schaden · ${Math.floor(last.survived / 60)} min überlebt${last.death?.by ? ` · getötet von ${last.death.by}${last.death.distanceM != null ? ` (${last.death.distanceM} m)` : ''}` : ''}` });
      this.s.bus.emit('game:data', { game: 'pubg' });
    }
    return { added: out.length, at: nowIso() };
  }

  /** Muster über die gespeicherten Matches. */
  stats() {
    const list = this.matches(); if (!list.length) return null;
    const avg = (f) => Math.round(list.reduce((a, m) => a + (f(m) || 0), 0) / list.length * 10) / 10;
    const early = list.filter((m) => m.survived && m.survived < 300).length;
    const findings = [];
    if (list.length >= 5 && early / list.length >= 0.4) findings.push(`${early} von ${list.length} Matches nach weniger als 5 Minuten vorbei – Landeplätze prüfen (Karte unten).`);
    return { matches: list.length, avgPlace: avg((m) => m.place), avgKills: avg((m) => m.kills), avgDamage: Math.round(avg((m) => m.damage)), top10: list.filter((m) => m.place && m.place <= 10).length, findings };
  }
}

module.exports = { Pubg, analyzeTelemetry, MAPS };
