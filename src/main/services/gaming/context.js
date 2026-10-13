'use strict';
const { execFile } = require('node:child_process');
const { nowIso, normText, safeJson } = require('../../core/util');
const PROFILES = require('./profiles.json');
const { applyKit } = require('./kits');
const log = require('../../core/logger').scope('game-context');

/**
 * Game Context Engine.
 * Separates the *active* game (what you are playing) from the *discussed*
 * game (what the conversation is about). Priority for the active game:
 *   manual selection / explicit statement  >  running process  >  last confirmed.
 */
class GameContext {
  constructor(ctx) {
    this.db = ctx.db; this.bus = ctx.bus; this.settings = ctx.settings;
    this.platform = process.platform;
    this.running = []; // detected game ids
    this.leagueClient = false;
    this.timer = null;
  }

  profiles() {
    const custom = safeJson(this.getState('custom_profiles'), []) || [];
    const stats = safeJson(this.getState('steam:stats'), {}) || {};
    return [...PROFILES, ...custom].map((p) => {
      const st = stats[p.id];
      const q = applyKit(p);
      if (!st) return q;
      return { ...q, steamAppId: q.steamAppId || st.appid, steamAppIds: st.appids, playtimeMin: st.minutes, lastPlayed: st.lastPlayed, header: q.header || st.header };
    });
  }
  profile(gid) { return this.profiles().find((p) => p.id === gid) || null; }

  getState(key) { return this.db.get('SELECT value FROM game_state WHERE key=?', key)?.value ?? null; }
  setState(key, value) {
    this.db.run('INSERT INTO game_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at', key, typeof value === 'string' ? value : JSON.stringify(value), nowIso());
  }

  /** Resolve free text ("ich zocke gerade ARK") to a profile; unknown names create a generic profile. */
  resolve(name, { create = true } = {}) {
    const n = normText(name);
    if (!n) return null;
    const all = this.profiles();
    let best = null; let bestLen = 0;
    for (const p of all) {
      for (const a of [p.name, p.short, p.id, ...(p.aliases || [])].filter(Boolean)) {
        const an = normText(a);
        if (n === an || (an.length >= 3 && (` ${n} `).includes(` ${an} `))) {
          if (an.length > bestLen) { best = p; bestLen = an.length; }
        }
      }
    }
    if (best || !create) return best;
    const cleaned = String(name).trim().slice(0, 60);
    if (cleaned.length < 2) return null;
    const custom = safeJson(this.getState('custom_profiles'), []) || [];
    const prof = { id: 'custom_' + n.replace(/\s+/g, '_').slice(0, 40), name: cleaned, aliases: [n], processes: [], integration: 'generic', custom: true };
    if (!custom.some((c) => c.id === prof.id)) { custom.push(prof); this.setState('custom_profiles', custom); }
    return prof;
  }

  state() {
    const active = safeJson(this.getState('active'), null);
    const discussed = safeJson(this.getState('discussed'), null);
    const out = {
      active: active && this.profile(active.id) ? { ...active, profile: this.profile(active.id) } : null,
      discussed: discussed && this.profile(discussed.id) && (!active || discussed.id !== active.id) && Date.now() - Date.parse(discussed.at) < 30 * 60000
        ? { ...discussed, profile: this.profile(discussed.id) } : null,
      running: this.running.map((id) => this.profile(id)).filter(Boolean),
      gaming: this.running.length > 0,
    };
    return out;
  }

  /** Explicit statement or manual selection. */
  setActive(gid, source = 'explicit') {
    const p = this.profile(gid);
    if (!p) throw new Error('Unbekanntes Spiel');
    this.setState('active', { id: p.id, source, since: nowIso() });
    this.setState('last_confirmed', { id: p.id, at: nowIso() });
    this.emit();
    return this.state();
  }
  clearActive() { this.db.run("DELETE FROM game_state WHERE key='active'"); this.emit(); return this.state(); }

  setDiscussed(gid) {
    const p = this.profile(gid);
    if (!p) return this.state();
    this.setState('discussed', { id: p.id, at: nowIso() });
    this.emit();
    return this.state();
  }

  emit() { this.bus.emit('game:context', this.state()); }

  start() {
    this.stop();
    if (!this.settings.get('gaming').detection) return;
    const tick = () => this.poll().catch((e) => log.debug('poll', e));
    tick();
    this.timer = setInterval(tick, 15000);
  }
  stop() { clearInterval(this.timer); this.timer = null; }

  listProcesses() {
    if (this.platform !== 'win32') return Promise.resolve([]);
    return new Promise((resolve) => {
      execFile('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
        if (err) return resolve([]);
        resolve(String(out).split(/\r?\n/).map((l) => l.split('","')[0]?.replace(/^"/, '').toLowerCase()).filter(Boolean));
      });
    });
  }

  async poll(processList) {
    const procs = new Set((processList || await this.listProcesses()).map((p) => p.toLowerCase()));
    // Launcher/Client-Prozesse (kein Spiel, aber für Champion-Auswahl etc. relevant)
    const lc = procs.has('leagueclientux.exe');
    if (lc !== this.leagueClient) { this.leagueClient = lc; this.bus.emit('game:client', { league: lc }); }
    const found = this.profiles().filter((p) => (p.processes || []).some((x) => procs.has(x.toLowerCase())) && !p.processRequiresTitle).map((p) => p.id);
    // Steam meldet das laufende Spiel selbst (Registry) – so werden auch Spiele ohne bekannten Prozessnamen erkannt
    if (this.steam && this.platform === 'win32') {
      try {
        const appid = await this.steam.runningAppId();
        if (appid) { const sp = this.profiles().find((p) => p.steamAppId === appid || (p.steamAppIds || []).includes(appid)); if (sp && !found.includes(sp.id)) found.push(sp.id); }
      } catch { /* ignore */ }
    }
    const prev = this.running;
    const changed = found.join(',') !== prev.join(',');
    this.running = found;
    if (changed) this.bus.emit('game:running', { running: this.running, started: found.filter((x) => !prev.includes(x)), stopped: prev.filter((x) => !found.includes(x)) });
    const st = safeJson(this.getState('active'), null);
    const explicit = st && ['explicit', 'manual'].includes(st.source);
    if (found.length) {
      // An explicit/manual choice always wins over automatic detection.
      if (!explicit && (!st || !found.includes(st.id))) {
        this.setState('active', { id: found[0], source: 'process', since: nowIso() });
        this.emit();
        return;
      }
    } else if (st && st.source === 'process') {
      // Game closed → keep as "last confirmed", clear active.
      this.setState('last_confirmed', { id: st.id, at: nowIso() });
      this.db.run("DELETE FROM game_state WHERE key='active'");
      this.emit();
      return;
    }
    if (changed) this.emit();
  }

  /** On startup: restore an explicit choice made in the last 6 hours. */
  restore() {
    const st = safeJson(this.getState('active'), null);
    if (st && ['explicit', 'manual'].includes(st.source) && Date.now() - Date.parse(st.since) > 6 * 3600000) this.db.run("DELETE FROM game_state WHERE key='active'");
  }

  /** Installed games (Steam library manifests + running processes). */
  async detectInstalled() {
    const fs = require('node:fs'); const path = require('node:path');
    const found = new Set();
    if (this.platform === 'win32') {
      const libs = new Set(['C:\\Program Files (x86)\\Steam\\steamapps']);
      try {
        const vdf = fs.readFileSync('C:\\Program Files (x86)\\Steam\\steamapps\\libraryfolders.vdf', 'utf8');
        for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(path.join(m[1].replace(/\\\\/g, '\\'), 'steamapps'));
      } catch { /* no steam */ }
      const names = [];
      for (const lib of libs) {
        try { for (const f of fs.readdirSync(lib)) if (f.startsWith('appmanifest_')) { const t = fs.readFileSync(path.join(lib, f), 'utf8'); const n = t.match(/"name"\s+"([^"]+)"/); if (n) names.push(n[1]); } } catch { /* ignore */ }
      }
      for (const n of names) { const p = this.resolve(n, { create: false }); if (p) found.add(p.id); }
      const riot = ['C:\\Riot Games\\League of Legends', 'C:\\Program Files\\Riot Games\\League of Legends'];
      if (riot.some((d) => fs.existsSync(d))) found.add('league');
      if (['C:\\Battlestate Games\\EFT', 'C:\\Battlestate Games\\Escape from Tarkov'].some((d) => fs.existsSync(d))) found.add('eft');
    }
    for (const r of this.running) found.add(r);
    return [...found].map((id) => this.profile(id)).filter(Boolean);
  }
}

module.exports = { GameContext, PROFILES };
