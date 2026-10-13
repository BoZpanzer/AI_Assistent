'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { nowIso, safeJson, normText } = require('../../core/util');
const log = require('../../core/logger').scope('steam');

/**
 * Steam-Bibliothek – komplett lokal und ohne API-Schlüssel:
 * - Spielzeit pro Spiel aus userdata/<id>/config/localconfig.vdf (auch bei privatem Profil)
 * - installierte Spiele, Größe und Update-Status aus steamapps/appmanifest_*.acf
 * - laufendes Spiel aus der Registry (HKCU\Software\Valve\Steam → RunningAppID)
 * Namen/Bilder von nicht installierten Spielen kommen (gecacht) aus der öffentlichen Store-API.
 * Nur lesend; „Aktualisieren“ übergibt an den Steam-Client (steam://-Links).
 */
const STEAM64_BASE = 76561197960265728n;
/** Name-Vergleich ohne ™/®/© („EA SPORTS FC™ 25“ = „ea sports fc 25“). */
const gameKey = (n) => normText(String(n || '').replace(/[™®©]/g, ' '));
// Steam-Werkzeuge, die keine Spiele sind (Soundpad, Wallpaper Engine, Crosshair V2 …) und Redistributables
const NOT_GAMES = new Set([629520, 431960, 1366800, 7, 228980, 250820, 431960, 1007, 1070560, 1391110, 1493710, 1628350, 1826330, 2180100, 2348590]);

/** Minimal KeyValues (VDF) parser – text format used by Steam config files. */
function parseVdf(text) {
  const root = {}; const stack = [root]; let key = null;
  const re = /"((?:[^"\\]|\\.)*)"|([{}])|\/\/[^\n]*/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[2] === '{') { const o = {}; const cur = stack[stack.length - 1]; if (key !== null) { cur[key] = o; key = null; } stack.push(o); continue; }
    if (m[2] === '}') { if (stack.length > 1) stack.pop(); continue; }
    if (m[1] === undefined) continue; // comment
    const str = m[1].replace(/\\\\/g, '\\').replace(/\\"/g, '"');
    if (key === null) key = str; else { stack[stack.length - 1][key] = str; key = null; }
  }
  return root;
}
/** Case-insensitive nested lookup. */
function pick(obj, ...keys) {
  let cur = obj;
  for (const k of keys) {
    if (!cur || typeof cur !== 'object') return undefined;
    const hit = Object.keys(cur).find((x) => x.toLowerCase() === String(k).toLowerCase());
    cur = hit === undefined ? undefined : cur[hit];
  }
  return cur;
}

class Steam {
  constructor(s) { this.s = s; this._root = undefined; }

  regQuery(key, value) {
    if (process.platform !== 'win32') return Promise.resolve(null);
    return new Promise((resolve) => execFile('reg.exe', ['query', key, '/v', value], { windowsHide: true, timeout: 4000 }, (err, out) => {
      if (err) return resolve(null);
      const m = String(out).match(new RegExp(value + '\\s+REG_\\w+\\s+(.+)', 'i'));
      resolve(m ? m[1].trim() : null);
    }));
  }

  async root() {
    if (this._root !== undefined) return this._root;
    const custom = this.s.settings.get('gaming')?.steamDir;
    const cands = [custom, (await this.regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath'))?.replace(/\//g, '\\'), 'C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam', process.env.STEAM_DIR].filter(Boolean);
    this._root = cands.find((d) => { try { return fs.existsSync(path.join(d, 'steamapps')); } catch { return false; } }) || null;
    return this._root;
  }

  /** Currently running Steam app (0 = none). Cheap registry read. */
  async runningAppId() {
    const v = await this.regQuery('HKCU\\Software\\Valve\\Steam', 'RunningAppID');
    const n = v ? parseInt(v, v.startsWith('0x') ? 16 : 10) : 0;
    return Number.isFinite(n) ? n : 0;
  }

  readVdf(file) { try { return parseVdf(fs.readFileSync(file, 'utf8')); } catch { return null; } }

  async libraries() {
    const root = await this.root();
    if (!root) return [];
    const libs = new Set([path.join(root, 'steamapps')]);
    const lf = this.readVdf(path.join(root, 'steamapps', 'libraryfolders.vdf'));
    const folders = pick(lf, 'libraryfolders') || {};
    for (const v of Object.values(folders)) { const p = typeof v === 'object' ? v.path : v; if (p && typeof p === 'string') libs.add(path.join(p, 'steamapps')); }
    return [...libs].filter((d) => { try { return fs.existsSync(d); } catch { return false; } });
  }

  /** Installed apps from appmanifests. */
  async installed() {
    const out = new Map();
    for (const lib of await this.libraries()) {
      let files = []; try { files = fs.readdirSync(lib).filter((f) => /^appmanifest_\d+\.acf$/.test(f)); } catch { /* ignore */ }
      for (const f of files) {
        const st = pick(this.readVdf(path.join(lib, f)), 'AppState');
        if (!st?.appid) continue;
        const flags = Number(st.StateFlags || 0);
        const toDl = Number(st.BytesToDownload || 0) - Number(st.BytesDownloaded || 0);
        out.set(Number(st.appid), {
          appid: Number(st.appid), name: st.name, installdir: path.join(lib, 'common', st.installdir || ''), sizeOnDisk: Number(st.SizeOnDisk || 0),
          lastUpdated: st.LastUpdated ? new Date(Number(st.LastUpdated) * 1000).toISOString() : null, buildId: st.buildid || null,
          updateRequired: !!(flags & 2) || (flags & 4 && toDl > 0), updating: !!(flags & 1024 || flags & 512), fullyInstalled: !!(flags & 4),
        });
      }
    }
    return out;
  }

  /** Steam accounts that logged in on this PC. */
  async accounts() {
    const root = await this.root();
    if (!root) return [];
    const lu = pick(this.readVdf(path.join(root, 'config', 'loginusers.vdf')), 'users') || {};
    return Object.entries(lu).map(([id64, u]) => ({ id64, name: u.PersonaName || u.AccountName, mostRecent: u.MostRecent === '1' || u.mostrecent === '1', timestamp: Number(u.Timestamp || 0) }))
      .sort((a, b) => b.mostRecent - a.mostRecent || b.timestamp - a.timestamp);
  }

  async accountId() {
    const pref = this.s.settings.get('gaming')?.steamId;
    const id64 = pref && /^7656\d{13}$/.test(pref) ? pref : (await this.accounts())[0]?.id64;
    if (!id64) return null;
    return { id64, id3: String(BigInt(id64) - STEAM64_BASE) };
  }

  /** Playtime (minutes) per app from localconfig.vdf. */
  async playtimes() {
    const root = await this.root(); const acc = await this.accountId();
    if (!root || !acc) return new Map();
    const lc = this.readVdf(path.join(root, 'userdata', acc.id3, 'config', 'localconfig.vdf'));
    const apps = pick(lc, 'UserLocalConfigStore', 'Software', 'Valve', 'Steam', 'apps') || pick(lc, 'UserLocalConfigStore', 'Software', 'Valve', 'Steam', 'Apps') || {};
    const out = new Map();
    for (const [id, a] of Object.entries(apps)) {
      const minutes = Number(pick(a, 'Playtime') || 0);
      const last = Number(pick(a, 'LastPlayed') || 0);
      if (minutes > 0 || last > 0) out.set(Number(id), { minutes, lastPlayed: last ? new Date(last * 1000).toISOString() : null });
    }
    return out;
  }

  /** Name/type/header from the public store API (cached 30 days; null if unavailable). */
  async storeInfo(appid) {
    const key = 'steam:app:' + appid;
    const cached = this.s.gaming.cache.get(key, { allowStale: true });
    if (cached?.value) return cached.value;
    try {
      const r = await this.s.fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=german&filters=basic`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) return null;
      const j = (await r.json())?.[appid];
      const v = j?.success ? { name: j.data.name, type: j.data.type, header: j.data.header_image || null } : { name: null, type: 'unknown', header: null };
      this.s.gaming.cache.set(key, v, 'Steam Store', 30 * 86400000);
      return v;
    } catch { return null; }
  }

  /** Full library: played and/or installed apps, newest first. */
  async library({ withNames = true } = {}) {
    if (!(await this.root())) return { available: false, games: [], reason: 'Steam wurde auf diesem PC nicht gefunden.' };
    const [inst, play, acc] = await Promise.all([this.installed(), this.playtimes(), this.accountId()]);
    const ids = new Set([...inst.keys(), ...play.keys()]);
    const games = [];
    for (const appid of ids) {
      if (NOT_GAMES.has(appid)) continue;
      const i = inst.get(appid); const p = play.get(appid) || { minutes: 0, lastPlayed: null };
      let name = i?.name || null; let type = null; let header = `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`;
      if (withNames && (!name || !i)) {
        const info = await this.storeInfo(appid);
        if (info) { name = name || info.name; type = info.type; if (info.header) header = info.header; }
      }
      if (!name) continue; // unbekannt (z. B. entfernt) → nicht anzeigen
      if (type && !['game', 'unknown'].includes(type)) continue; // DLC, Soundtrack, Tool …
      if (/soundtrack|dedicated server|redistributable|sdk|benchmark|playtest|staging branch|^soundpad$|^wallpaper engine$|^crosshair v2$/i.test(name)) continue;
      games.push({ appid, name, minutes: p.minutes, hours: +(p.minutes / 60).toFixed(1), lastPlayed: p.lastPlayed, installed: !!i, updateRequired: !!i?.updateRequired, updating: !!i?.updating, sizeOnDisk: i?.sizeOnDisk || 0, lastUpdated: i?.lastUpdated || null, header });
    }
    games.sort((a, b) => b.minutes - a.minutes || String(b.lastPlayed).localeCompare(String(a.lastPlayed)));
    return { available: true, account: acc?.id64 || null, games, scannedAt: nowIso() };
  }

  /**
   * Create a game profile („Game-Seite“) for every Steam game with at least
   * `minMinutes` playtime. Existing built-in profiles are matched by Steam-ID/name.
   */
  async importProfiles({ minMinutes = 1 } = {}) {
    const lib = await this.library();
    if (!lib.available) throw new Error(lib.reason);
    const ctx = this.s.gaming.context;
    const builtins = ctx.profiles().filter((p) => !p.custom);
    let custom = safeJson(ctx.getState('custom_profiles'), []) || [];
    const stats = {};
    let created = 0; let updated = 0; let matched = 0; let merged = 0;
    for (const g of lib.games.filter((x) => x.minutes >= minMinutes)) {
      const nn = gameKey(g.name);
      const builtin = builtins.find((p) => p.steamAppId === g.appid) || builtins.find((p) => [p.name, ...(p.aliases || [])].some((a) => gameKey(a) === nn));
      const pid = builtin ? builtin.id : 'steam_' + g.appid;
      const st = stats[pid] || { minutes: 0, lastPlayed: null, appids: [] };
      st.minutes += g.minutes; st.appids.push(g.appid);
      if (!st.appid || g.minutes > (st.top || 0)) { st.appid = g.appid; st.top = g.minutes; st.header = g.header; }
      if (g.lastPlayed && (!st.lastPlayed || g.lastPlayed > st.lastPlayed)) st.lastPlayed = g.lastPlayed;
      stats[pid] = st;
      if (builtin) {
        matched++;
        // Aus 3.8.0 stammende Steam-Seite für ein Spiel, das jetzt ein eigenes Kit hat → zusammenführen, wenn dort noch nichts gespeichert ist
        const old = custom.findIndex((c) => c.source === 'steam' && c.id === 'steam_' + g.appid);
        if (old >= 0 && !this.hasData(custom[old].id)) { custom.splice(old, 1); merged++; }
        continue;
      }
      const prof = { id: pid, name: g.name, aliases: [g.name.toLowerCase()], processes: [], integration: 'generic', custom: true, steamAppId: g.appid, header: g.header, source: 'steam' };
      const i = custom.findIndex((c) => c.id === pid || (c.custom && gameKey(c.name) === nn));
      if (i >= 0) { custom[i] = { ...custom[i], ...prof, id: custom[i].id }; updated++; } else { custom.push(prof); created++; }
    }
    for (const st of Object.values(stats)) delete st.top;
    ctx.setState('custom_profiles', custom);
    ctx.setState('steam:stats', stats);
    ctx.setState('steam:lastImport', { at: nowIso(), created, updated, matched, merged, total: lib.games.length });
    this.s.bus.emit('game:profiles', {});
    log.info(`Steam-Import: ${created} neu, ${updated} aktualisiert, ${matched} mit eigenem Kit${merged ? `, ${merged} zusammengeführt` : ''}`);
    return { created, updated, matched, merged, games: lib.games.length, eligible: lib.games.filter((x) => x.minutes >= minMinutes).length };
  }

  /** Hat der Nutzer zu dieser Game-Seite schon etwas gespeichert? */
  hasData(gid) {
    const db = this.s.db;
    return !!(db.get('SELECT 1 FROM game_progress WHERE game=? LIMIT 1', gid) || db.get('SELECT 1 FROM knowledge WHERE game=? LIMIT 1', gid)
      || db.get('SELECT 1 FROM game_timers WHERE game=? LIMIT 1', gid) || db.get("SELECT 1 FROM game_state WHERE key LIKE ? LIMIT 1", `checklist:${gid}:%`));
  }

  async updates() {
    const inst = await this.installed();
    return [...inst.values()].filter((g) => g.updateRequired || g.updating).map((g) => ({ appid: g.appid, name: g.name, updating: g.updating }));
  }
}

module.exports = { Steam, parseVdf, pick };
