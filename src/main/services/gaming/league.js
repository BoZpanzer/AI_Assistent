'use strict';
const { objectives } = require('./lolobjectives');
const https = require('node:https');
const { id, nowIso } = require('../../core/util');
const log = require('../../core/logger').scope('league');
const { analyzeGame, patterns } = require('./lolanalysis');

/**
 * League of Legends integration (read-only, Riot policy compliant):
 * - Live Client Data API on 127.0.0.1:2999 (only while a match runs)
 * - Riot Web API (account-v1, match-v5, league-v4) with the user's own key
 * - Data Dragon for champions/patch
 * No input automation, no information the APIs do not provide.
 */
const REGIONAL = { euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe', na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas', kr: 'asia', jp1: 'asia', oc1: 'sea' };
const DD = 'https://ddragon.leagueoflegends.com';

/**
 * Was du im Spiel ohnehin siehst (Scoreboard, Death-Recap) – für Chat und Nachbesprechung, ohne Vorgaben:
 * Kill-Stand, deine Tode mit beteiligten Champions (und ob der gegnerische Jungler dabei war).
 */
function liveContext(events, players, self) {
  const names = (p) => [p.riotId, p.riotIdGameName, p.summonerName, String(p.riotId || '').split('#')[0]].filter(Boolean);
  const byName = new Map(); for (const p of players) for (const n of names(p)) byName.set(n, p);
  const find = (n) => byName.get(n) || byName.get(String(n || '').split('#')[0]) || null;
  const kills = events.filter((e) => e.EventName === 'ChampionKill');
  const score = { us: 0, them: 0 };
  for (const e of kills) { const v = find(e.VictimName); if (v) { if (v.team === self.team) score.them++; else score.us++; } }
  const isMe = (n) => { const p = find(n); return !!p && p === self; };
  const myDeaths = kills.filter((e) => isMe(e.VictimName)).map((e) => {
    const by = [e.KillerName, ...(e.Assisters || [])].map(find).filter((p) => p && p.team !== self.team);
    return { min: Math.round((e.EventTime || 0) / 6) / 10, by: by.map((p) => p.championName), jungler: by.some((p) => p.position === 'JUNGLE') };
  });
  return { score, myDeaths };
}

class League {
  constructor(ctx) {
    this.db = ctx.db; this.settings = ctx.settings; this.secrets = ctx.secrets; this.fetch = ctx.fetch; this.cache = ctx.gameCache; this.bus = ctx.bus;
    this.liveSession = null; this.lastLive = null;
  }

  // ---------- Live Client ----------
  liveGet(path) {
    return new Promise((resolve, reject) => {
      // Self-signed Riot certificate: verification is disabled ONLY for this loopback endpoint.
      const req = https.get({ host: '127.0.0.1', port: 2999, path: '/liveclientdata/' + path, rejectUnauthorized: false, timeout: 1500 }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; if (data.length > 2e6) req.destroy(); });
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
    });
  }

  async live() {
    try {
      const all = await this.liveGet('allgamedata');
      const me = all.activePlayer || {};
      if (!me.riotId && !me.summonerName) throw new Error('Zuschauer/Replay – kein eigenes Match');
      const myId = me.riotId || me.summonerName;
      const players = all.allPlayers || [];
      const self = players.find((p) => (p.riotId || p.summonerName) === myId) || {};
      const sc = self.scores || {};
      const seconds = Math.round(all.gameData?.gameTime || 0);
      const opp = players.find((p) => p.team !== self.team && p.position && p.position === self.position);
      const state = {
        connected: true, champion: self.championName || 'Unbekannt', level: me.level, gold: Math.round(me.currentGold || 0),
        mode: all.gameData?.gameMode, seconds, kills: sc.kills, deaths: sc.deaths, assists: sc.assists, cs: sc.creepScore, ward: sc.wardScore,
        csPerMin: seconds > 60 ? +(sc.creepScore / (seconds / 60)).toFixed(1) : null,
        position: self.position || null, team: self.team,
        opponent: opp ? { champion: opp.championName, level: opp.level, kills: opp.scores?.kills, deaths: opp.scores?.deaths, cs: opp.scores?.creepScore } : null,
        items: (self.items || []).map((i) => i.displayName),
        source: 'Live Client Data API (lokal)',
      };
      Object.assign(state, liveContext(all.events?.Events || [], players, self));
      if (!this.liveSession || (this.lastLive && seconds < this.lastLive.seconds - 30)) this.liveSession = id('lol');
      if (!this.lastLive || seconds - (this.lastLive.loggedAt || 0) >= 30) {
        this.db.run('INSERT INTO lol_samples(session,at,game_seconds,champion,level,gold,k,d,a,cs) VALUES(?,?,?,?,?,?,?,?,?,?)', this.liveSession, nowIso(), seconds, state.champion, state.level, state.gold, sc.kills, sc.deaths, sc.assists, sc.creepScore);
        state.loggedAt = seconds;
      } else state.loggedAt = this.lastLive.loggedAt;
      const g = this.settings.get('gaming') || {};
      state.tips = g.lolLiveCoach ? this.liveTips(state) : [];
      state.objectives = g.lolObjectives !== false ? objectives(all.events?.Events || [], players, all.gameData?.gameTime || seconds, self.team, g.lolObjectiveTimes || {}) : [];
      state.receivedAt = Date.now();
      this.lastLive = state;
      // Letzten Live-Stand merken – wird angezeigt, wenn gerade kein Match läuft
      if (!this._lastSaved || Date.now() - this._lastSaved > 20000) { this._lastSaved = Date.now(); this.cache.set('lol:lastlive', { ...state, at: nowIso() }, 'Live Client Data API (lokal)', 365 * 86400000); }
      return state;
    } catch {
      this.liveSession = null; this.lastLive = null;
      return { connected: false, reason: 'Gerade läuft kein Match.', last: this.cache.get('lol:lastlive', { allowStale: true })?.value || null, lastMatch: this.matches(1)[0] || null };
    }
  }

  /**
   * Live-Werte als neutrale Einordnung (kein LLM). Riot-Regeln: Apps dürfen im Spiel keine Entscheidungen
   * vorgeben („jetzt recallen/ganken“), keine Power-Spike-Alarme und keine Gegner-Cooldowns/-Positionen tracken.
   * Deshalb nur Zahlen, die du auch im Spiel siehst, verglichen mit DEINEM Schnitt und deinen Trainingszielen.
   */
  liveTips(s) {
    const tips = [];
    const min = s.seconds / 60;
    let avg = null; try { avg = this.stats(20).current; } catch { avg = null; }
    const goal = (metric) => (this.goals?.() || []).find((g) => g.metric === metric)?.target;
    if (s.csPerMin != null && min > 5 && s.position !== 'UTILITY') {
      const ref = goal('csPerMin') ?? avg?.csPerMin;
      tips.push(`CS/min ${s.csPerMin}${ref != null ? ` · ${goal('csPerMin') != null ? 'Ziel' : 'dein Schnitt'} ${ref}` : ''}`);
    }
    if (s.opponent && s.level != null && s.opponent.level != null && s.opponent.level !== s.level) tips.push(`Level ${s.level} gegen ${s.opponent.level} (${s.opponent.champion})`);
    if (s.opponent?.cs != null && s.cs != null && s.position !== 'UTILITY' && s.position !== 'JUNGLE') tips.push(`CS ${s.cs} gegen ${s.opponent.cs} (${s.cs - s.opponent.cs >= 0 ? '+' : ''}${s.cs - s.opponent.cs})`);
    const dg = goal('deaths');
    if (dg != null && s.deaths != null) tips.push(`Tode ${s.deaths} · Ziel max. ${dg}`);
    if (s.ward != null && min > 10) tips.push(`Vision ${Math.round(s.ward)}${avg?.vision != null ? ` · dein Schnitt am Ende ${avg.vision}` : ''}`);
    return tips.slice(0, 4);
  }

  /** Notiz während des Spiels (per Sprache/Chat) – fließt in die Nachbesprechung ein. */
  addLiveNote(text) {
    const t = String(text || '').trim().slice(0, 300);
    if (!t) throw new Error('Leere Notiz');
    const list = (() => { try { return JSON.parse(this.db.get("SELECT value FROM game_state WHERE key='lol:notes'")?.value || '[]'); } catch { return []; } })();
    const note = { at: nowIso(), gameSec: this.lastLive?.seconds ?? null, champion: this.lastLive?.champion || null, text: t };
    list.push(note);
    this.db.run("INSERT INTO game_state(key,value,updated_at) VALUES('lol:notes',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at", JSON.stringify(list.slice(-60)), nowIso());
    return note;
  }
  // ---------- Matchups ----------
  /** Champion-Name/-ID vereinheitlichen („Lee Sin“, „LeeSin“, „Wukong“/„MonkeyKing“ → gleicher Schlüssel). */
  async keyer() {
    const k = (x) => String(x || '').toLowerCase().replace(/[^a-z]/g, '');
    let list = []; try { list = (await this.champions()).value || []; } catch { list = []; }
    const map = new Map(); for (const c of list) { map.set(k(c.id), k(c.id)); map.set(k(c.name), k(c.id)); }
    return (n) => map.get(k(n)) || k(n);
  }
  async champKey(n) { return (await this.keyer())(n); }
  readList(key) { try { return JSON.parse(this.db.get('SELECT value FROM game_state WHERE key=?', key)?.value || '[]'); } catch { return []; } }
  writeList(key, list) { this.db.run('INSERT INTO game_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at', key, JSON.stringify(list), nowIso()); }

  /** Eigene Matchup-Notiz („gegen Darius: Level 1 nicht traden“) – erscheint beim nächsten Mal in der Championauswahl. */
  async addMatchupNote(vs, text, mine = null) {
    const t = String(text || '').trim().slice(0, 300);
    if (!t || !vs) throw new Error('Champion und Notiz nötig');
    const list = this.readList('lol:matchupnotes');
    const note = { id: id('mn'), at: nowIso(), vs: await this.champKey(vs), vsName: String(vs).slice(0, 40), mine: mine ? await this.champKey(mine) : null, mineName: mine ? String(mine).slice(0, 40) : null, text: t };
    list.push(note); this.writeList('lol:matchupnotes', list.slice(-400));
    this.bus.emit('game:data', { game: 'league' });
    return note;
  }
  async matchupNotes(vs, mine = null) {
    const v = await this.champKey(vs); const m = mine ? await this.champKey(mine) : null;
    return this.readList('lol:matchupnotes').filter((n) => n.vs === v && (!n.mine || !m || n.mine === m)).reverse();
  }
  removeMatchupNote(nid) { this.writeList('lol:matchupnotes', this.readList('lol:matchupnotes').filter((n) => n.id !== nid)); this.bus.emit('game:data', { game: 'league' }); return true; }

  /** Eigene Bilanz gegen einen Champion als direkter Lane-Gegner (aus den Timeline-Analysen). */
  async matchupStats(vs, mine = null) {
    const K = await this.keyer(); const v = K(vs); const m = mine ? K(mine) : null;
    const rows = this.db.all('SELECT match_id FROM lol_matches ORDER BY played_at DESC LIMIT 300');
    const all = []; for (const r of rows) { const d = this.getDeep(r.match_id); if (d?.opponent?.champion && K(d.opponent.champion) === v) all.push(d); }
    const sum = (list) => {
      if (!list.length) return null;
      const av = (f) => { const a = list.map(f).filter((x) => x != null && Number.isFinite(x)); return a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10 : null; };
      const early = list.reduce((a, g) => a + (g.deathsDetail || []).filter((d) => d.min < 14).length, 0);
      const jg = list.reduce((a, g) => a + (g.deathsDetail || []).filter((d) => d.min < 14 && d.jungler).length, 0);
      return { games: list.length, wins: list.filter((g) => g.win).length, csDiff10: av((g) => g.csDiff10), goldDiff15: av((g) => g.goldDiff15), earlyDeaths: av((g) => g.earlyDeaths), level6Diff: av((g) => (g.levels?.me?.[6] != null && g.levels?.opp?.[6] != null ? g.levels.me[6] - g.levels.opp[6] : null)), junglerInEarlyDeathsPct: early ? Math.round(jg / early * 100) : null, champions: [...new Set(list.map((g) => g.champion).filter(Boolean))] };
    };
    const same = m ? all.filter((d) => d.champion && K(d.champion) === m) : null;
    return { vs, all: sum(all), withChampion: m ? sum(same) : null };
  }

  /** Notizen in einem Zeitfenster (für die Nachbesprechung eines Spiels). */
  liveNotes(fromIso, toIso) {
    let list = []; try { list = JSON.parse(this.db.get("SELECT value FROM game_state WHERE key='lol:notes'")?.value || '[]'); } catch { list = []; }
    return list.filter((n) => (!fromIso || n.at >= fromIso) && (!toIso || n.at <= toIso));
  }

  // ---------- Riot Web API ----------
  hasKey() { return !!this.secrets.get('riot.api_key'); }

  async riot(host, path) {
    const key = this.secrets.get('riot.api_key');
    if (!key) throw new Error('Kein Riot-API-Schlüssel hinterlegt (Einstellungen → Gaming).');
    const r = await this.fetch(`https://${host}.api.riotgames.com${path}`, { headers: { 'X-Riot-Token': key } });
    if (r.status === 429) throw new Error('Riot-API-Limit erreicht – bitte kurz warten.');
    if (r.status === 401 || r.status === 403) throw new Error('Riot-API-Schlüssel ungültig oder abgelaufen (Entwicklerschlüssel gelten 24 h).');
    if (r.status === 404) throw new Error('Nicht gefunden (Riot-ID / Region prüfen).');
    if (!r.ok) throw new Error('Riot API ' + r.status);
    return r.json();
  }

  async account() {
    const g = this.settings.get('gaming');
    const [name, tag] = String(g.riotId || '').split('#');
    if (!name || !tag) throw new Error('Riot-ID fehlt (Format: Name#TAG, Einstellungen → Gaming).');
    const region = REGIONAL[g.riotRegion] || 'europe';
    return (await this.cache.wrap(`lol:acct:${g.riotId}`, 'Riot account-v1', 30 * 86400000, () => this.riot(region, `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`))).value;
  }

  // ---------- Lokaler League-Client (LCU) – ohne API-Schlüssel ----------
  /** Port + Passwort des laufenden Clients (lockfile oder Prozess-Kommandozeile). */
  async lcuCreds() {
    if (this._lcu && Date.now() - this._lcu.at < (this._lcu.creds ? 60000 : 3000)) return this._lcu.creds;
    const fs = require('node:fs'); const path = require('node:path');
    const dirs = [this.settings.get('gaming').leagueDir, ...['C', 'D', 'E', 'F'].flatMap((d) => [`${d}:\\Riot Games\\League of Legends`, `${d}:\\Program Files\\Riot Games\\League of Legends`, `${d}:\\Games\\Riot Games\\League of Legends`])].filter(Boolean);
    let creds = null;
    for (const d of dirs) {
      try {
        const [, , port, password, protocol] = fs.readFileSync(path.join(d, 'lockfile'), 'utf8').trim().split(':');
        if (Number.isInteger(Number(port)) && Number(port) > 0 && Number(port) <= 65535 && password && (!protocol || protocol === 'https')) { creds = { port: Number(port), password, protocol: protocol || 'https' }; this.leagueDirFound = d; break; }
      } catch { /* not here */ }
    }
    if (!creds && process.platform === 'win32') creds = await this.lcuFromProcess();
    this._lcu = { at: Date.now(), creds };
    return creds;
  }
  lcuFromProcess() {
    return new Promise((resolve) => {
      require('node:child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "(Get-CimInstance Win32_Process -Filter \"name='LeagueClientUx.exe'\").CommandLine"],
        { windowsHide: true, timeout: 8000 }, (err, out) => {
          const s = String(out || '');
          const port = s.match(/--app-port=(\d+)/)?.[1]; const password = s.match(/--remoting-auth-token=([\w-]+)/)?.[1];
          const inst = s.match(/--install-directory=([^"]+?)"?\s+"?--/)?.[1]; if (inst) this.leagueDirFound = inst.replace(/[\\/]+$/, '');
          resolve(!err && port && password ? { port: Number(port), password, protocol: 'https' } : null);
        });
    });
  }
  async lcuGet(apiPath) {
    const c = await this.lcuCreds();
    if (!c) throw new Error('League-Client läuft nicht');
    return new Promise((resolve, reject) => {
      // Selbstsigniertes Riot-Zertifikat: Prüfung NUR für diesen lokalen Endpunkt aus.
      const req = https.get({ host: '127.0.0.1', port: c.port, path: apiPath, rejectUnauthorized: false, timeout: 5000,
        headers: { Authorization: 'Basic ' + Buffer.from('riot:' + c.password).toString('base64'), Accept: 'application/json' } }, (res) => {
        let data = ''; res.setEncoding('utf8');
        res.on('data', (x) => { data += x; if (data.length > 2e7) req.destroy(); });
        res.on('end', () => {
          if (res.statusCode === 401 || res.statusCode === 403) { this._lcu = null; return reject(new Error('League-Client: Zugriff verweigert')); }
          if (res.statusCode >= 400) return reject(new Error('League-Client ' + res.statusCode));
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', (e) => { this._lcu = null; reject(e); });
    });
  }
  /** Lokale HTTPS-Anfrage (League-Client oder Replay-API auf 127.0.0.1, selbstsigniertes Riot-Zertifikat). */
  localReq({ port, path: p, method = 'GET', body, auth, timeout = 5000 }) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : JSON.stringify(body);
      const req = https.request({ host: '127.0.0.1', port, path: p, method, rejectUnauthorized: false, timeout,
        headers: { Accept: 'application/json', ...(auth ? { Authorization: 'Basic ' + Buffer.from('riot:' + auth).toString('base64') } : {}), ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
        let txt = ''; res.setEncoding('utf8');
        res.on('data', (x) => { txt += x; if (txt.length > 2e6) req.destroy(); });
        res.on('end', () => {
          if (res.statusCode >= 400) return reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode, body: txt.slice(0, 300) }));
          try { resolve(txt ? JSON.parse(txt) : null); } catch { resolve(txt); }
        });
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }
  async lcuPost(apiPath, body = {}) {
    const c = await this.lcuCreds();
    if (!c) throw new Error('League-Client läuft nicht');
    return this.localReq({ port: c.port, path: apiPath, method: 'POST', body, auth: c.password });
  }

  // ---------- Replays: zu einem Zeitpunkt springen (offizielle Replay-API, nur nach dem Spiel) ----------
  gameCfgPath() {
    const path = require('node:path');
    const dir = this.settings.get('gaming').leagueDir || this.leagueDirFound;
    return dir ? path.join(dir, 'Config', 'game.cfg') : null;
  }
  replayApiEnabled() {
    const f = this.gameCfgPath(); if (!f) return { known: false, enabled: false };
    try { return { known: true, enabled: /^\s*EnableReplayApi\s*=\s*1\s*$/mi.test(require('node:fs').readFileSync(f, 'utf8')), file: f }; } catch { return { known: false, enabled: false, file: f }; }
  }
  /** Schaltet in game.cfg die Replay-API ein (nur nach ausdrücklicher Bestätigung in der Oberfläche; Sicherung als game.cfg.jarvis-bak). */
  enableReplayApi() {
    const fs = require('node:fs');
    const f = this.gameCfgPath();
    if (!f) throw new Error('League-Ordner unbekannt – einmal den League-Client starten oder den Ordner in den Einstellungen angeben.');
    let txt = ''; try { txt = fs.readFileSync(f, 'utf8'); } catch { throw new Error('game.cfg nicht gefunden: ' + f); }
    if (/^\s*EnableReplayApi\s*=\s*1\s*$/mi.test(txt)) return { enabled: true, changed: false, file: f };
    fs.writeFileSync(f + '.jarvis-bak', txt);
    const nl = txt.includes('\r\n') ? '\r\n' : '\n';
    if (/^[ \t]*EnableReplayApi[ \t]*=[^\r\n]*/mi.test(txt)) txt = txt.replace(/^[ \t]*EnableReplayApi[ \t]*=[^\r\n]*/mi, 'EnableReplayApi=1');
    else if (/^\[General\][ \t]*(?=\r?$)/mi.test(txt)) txt = txt.replace(/^\[General\][ \t]*(?=\r?$)/mi, '[General]' + nl + 'EnableReplayApi=1');
    else txt = txt + (txt.endsWith(nl) || !txt ? '' : nl) + '[General]' + nl + 'EnableReplayApi=1' + nl;
    fs.writeFileSync(f, txt);
    return { enabled: true, changed: true, file: f, backup: f + '.jarvis-bak' };
  }
  replayReq(method, p, body) { return this.localReq({ port: 2999, path: p, method, body, timeout: 2500 }); }

  /**
   * Replay eines Spiels öffnen und zu einer Spielsekunde springen (Standard: 15 s vor dem Ereignis).
   * Ablauf: läuft das Replay schon → nur springen. Sonst über den League-Client herunterladen und starten,
   * auf die Replay-API warten, dann springen. Fortschritt als Ereignis 'lol:replay'.
   */
  async replayJump(gameId, sec, { lead = 15, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), waitSec = 150 } = {}) {
    const st = this.replayApiEnabled();
    if (!st.enabled) return { ok: false, needsEnable: true, file: st.file || null };
    const t = Math.max(0, Math.round(Number(sec) || 0) - lead);
    const emit = (phase, extra = {}) => this.bus.emit('lol:replay', { gameId: String(gameId), phase, ...extra });
    const jump = async () => { await this.replayReq('POST', '/replay/playback', { time: t, paused: false, speed: 1 }); emit('playing', { time: t }); return { ok: true, time: t }; };
    if (this.replayGameId === String(gameId)) { try { await this.replayReq('GET', '/replay/playback'); return await jump(); } catch { this.replayGameId = null; } }
    const gid = String(gameId).split('_').pop();
    let meta = await this.lcuGet(`/lol-replays/v1/metadata/${encodeURIComponent(gid)}`).catch(() => null);
    if (!meta) throw new Error('League-Client läuft nicht – für Replays muss der Client offen sein.');
    if (['incompatible', 'missingOrExpired', 'unsupported', 'lost', 'error'].includes(meta.state)) throw new Error(meta.state === 'incompatible' ? 'Das Replay stammt von einem älteren Patch und lässt sich nicht mehr abspielen.' : 'Für dieses Spiel gibt es kein Replay mehr (Riot hält Replays nur kurz bzw. bis zum nächsten Patch).');
    if (meta.state === 'download') { emit('downloading'); await this.lcuPost(`/lol-replays/v1/rofls/${encodeURIComponent(gid)}/download`, { componentType: 'replay-button_match-history' }); }
    for (let i = 0; i < 90 && meta?.state !== 'watch'; i++) {
      await sleep(1000);
      meta = await this.lcuGet(`/lol-replays/v1/metadata/${encodeURIComponent(gid)}`).catch(() => meta);
      if (meta?.state === 'downloading') emit('downloading', { progress: meta.downloadProgress ?? null });
      if (['incompatible', 'missingOrExpired', 'error', 'lost'].includes(meta?.state)) throw new Error('Replay-Download fehlgeschlagen (' + meta.state + ').');
    }
    if (meta?.state !== 'watch') throw new Error('Replay ist noch nicht bereit – gleich nochmal versuchen.');
    emit('starting');
    await this.lcuPost(`/lol-replays/v1/rofls/${encodeURIComponent(gid)}/watch`, { componentType: 'replay-button_match-history' });
    this.replayGameId = String(gameId);
    for (let i = 0; i < waitSec; i++) {
      await sleep(1000);
      try { const pb = await this.replayReq('GET', '/replay/playback'); if (pb && pb.length > 0) { await sleep(1500); return await jump(); } } catch { /* lädt noch */ }
    }
    throw new Error('Das Replay ist gestartet, aber die Replay-API antwortet nicht. Ist „EnableReplayApi=1“ in der game.cfg (League einmal neu starten)?');
  }

  async clientAvailable() { try { await this.lcuGet('/lol-summoner/v1/current-summoner'); return true; } catch { return false; } }

  /**
   * Matchliste aus dem Client. Die „current-summoner“-Liste ist ein Zwischenspeicher, den der Client
   * erst beim Öffnen der Matchhistorie auffrischt – deshalb zuerst die PUUID-Abfrage (lädt vom Server)
   * und die neuere der beiden Antworten nehmen.
   */
  async clientMatchList(me, end = 49) {
    const range = `begIndex=0&endIndex=${end}`;
    const lists = await Promise.all([
      this.lcuGet(`/lol-match-history/v1/products/lol/${encodeURIComponent(me.puuid)}/matches?${range}`).catch(() => null),
      this.lcuGet(`/lol-match-history/v1/products/lol/current-summoner/matches?${range}`).catch(() => null),
    ]);
    const newest = (h) => Math.max(0, ...((h?.games?.games || []).map((g) => g.gameCreation || 0)));
    const best = lists.filter(Boolean).sort((a, b) => newest(b) - newest(a))[0];
    return best?.games?.games || [];
  }

  /** Ein einzelnes Spiel direkt vom Server (über den Client) – unabhängig von der Matchhistorie. */
  async clientGame(gameId) { return this.lcuGet(`/lol-match-history/v1/games/${encodeURIComponent(gameId)}`); }

  /** Spiel speichern (nur Solo/Duo für die Statistik). Gibt die Zusammenfassung zurück. */
  async storeClientGame(g, me, { queues = [420] } = {}) {
    const champs = await this.champions().then((r) => r.value).catch(() => []);
    const champName = (cid) => champs.find((c) => String(c.key) === String(cid))?.id || `Champion ${cid}`;
    const summary = summarizeLcuGame(g, me, champName);
    if (!summary) return null;
    if (!queues.length || queues.includes(g.queueId)) {
      this.db.run('INSERT OR REPLACE INTO lol_matches(match_id,puuid,played_at,summary) VALUES(?,?,?,?)', summary.matchId, me.puuid, new Date(g.gameCreation).toISOString(), JSON.stringify(summary));
    }
    return { ...summary, playedAt: new Date(g.gameCreation).toISOString() };
  }

  /** Matchhistorie + Rang direkt aus dem laufenden Client (kein Schlüssel nötig). */
  async syncFromClient({ queues = [420] } = {}) {
    const me = await this.lcuGet('/lol-summoner/v1/current-summoner');
    const games = await this.clientMatchList(me, 49);
    const champs = await this.champions().then((r) => r.value).catch(() => []);
    const champName = (cid) => champs.find((c) => String(c.key) === String(cid))?.id || `Champion ${cid}`;
    let added = 0;
    // Andere Modi (ARAM, Arena, Normal …): nur kompakte Statistik, keine Ranked-Analyse
    try { this.recordOtherModes(games, me, champName); } catch (e) { log.debug('modes', e); }
    for (const g of games) {
      if (queues.length && !queues.includes(g.queueId)) continue;
      const mid = `${g.platformId || 'LCU'}_${g.gameId}`;
      if (this.db.get('SELECT 1 x FROM lol_matches WHERE match_id=?', mid)) continue;
      const summary = summarizeLcuGame(g, me, champName);
      if (!summary) continue;
      this.db.run('INSERT OR REPLACE INTO lol_matches(match_id,puuid,played_at,summary) VALUES(?,?,?,?)', mid, me.puuid, new Date(g.gameCreation).toISOString(), JSON.stringify(summary));
      added++;
    }
    try {
      const r = await this.lcuGet('/lol-ranked/v1/current-ranked-stats');
      const solo = r?.queueMap?.RANKED_SOLO_5x5 || (r?.queues || []).find((q) => q.queueType === 'RANKED_SOLO_5x5');
      if (solo && solo.tier && solo.tier !== 'NONE') this.saveRank({ tier: solo.tier, rank: solo.division, lp: solo.leaguePoints, wins: solo.wins, losses: solo.losses }, 'League-Client');
    } catch (e) { log.debug('Rang aus Client nicht verfügbar', e); }
    this.cache.set('lol:me', { name: me.gameName ? `${me.gameName}#${me.tagLine}` : me.displayName, level: me.summonerLevel }, 'League-Client', 365 * 86400000);
    this.cache.set('lol:lastsync', { at: new Date().toISOString(), source: 'client' }, 'League-Client', 365 * 86400000);
    this.bus.emit('game:data', { game: 'league' });
    return { added, total: games.length, source: 'client' };
  }

  /** Newest game of any queue from the client (for the post-game review). */
  async latestClientGame() {
    const me = await this.lcuGet('/lol-summoner/v1/current-summoner');
    const g = (await this.clientMatchList(me, 4)).sort((a, b) => b.gameCreation - a.gameCreation)[0];
    if (!g) return null;
    const champs = await this.champions().then((r) => r.value).catch(() => []);
    const champName = (cid) => champs.find((c) => String(c.key) === String(cid))?.id || `Champion ${cid}`;
    const sum = summarizeLcuGame(g, me, champName);
    return sum ? { ...sum, playedAt: new Date(g.gameCreation).toISOString() } : null;
  }

  // ---------- Tiefenanalyse (Timeline: Tode, Lane-Phase, Objectives) ----------
  deepKey(mid) { return 'lol:deep:' + mid; }
  getDeep(mid) { const r = this.db.get('SELECT value FROM game_state WHERE key=?', this.deepKey(mid)); try { return r ? JSON.parse(r.value) : null; } catch { return null; } }
  setDeep(mid, v) { this.db.run('INSERT INTO game_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at', this.deepKey(mid), JSON.stringify(v), nowIso()); }

  /** Ein Spiel tief analysieren – über den Client (ohne Schlüssel) oder die Riot-API. */
  async deepAnalyze(mid, { me } = {}) {
    const champs = await this.champions().then((r) => r.value).catch(() => []);
    const name = (cid) => champs.find((c) => String(c.key) === String(cid))?.id || null;
    const items = await this.items().then((r) => r.value).catch(() => ({}));
    const item = (iid) => items[String(iid)] || null;
    let game = null; let tl = null; let puuid = null; let source = null;
    const gameId = String(mid).split('_').pop();
    if (await this.lcuCreds().catch(() => null)) {
      me = me || await this.lcuGet('/lol-summoner/v1/current-summoner');
      puuid = me.puuid;
      game = await this.clientGame(gameId).catch(() => null);
      tl = await this.lcuGet(`/lol-match-history/v1/game-timelines/${encodeURIComponent(gameId)}`).catch(() => null);
      source = 'League-Client';
    }
    if ((!game || !tl) && this.hasKey()) {
      const region = REGIONAL[this.settings.get('gaming').riotRegion] || 'europe';
      const acct = await this.account();
      puuid = acct.puuid;
      game = await this.riot(region, `/lol/match/v5/matches/${mid}`);
      tl = await this.riot(region, `/lol/match/v5/matches/${mid}/timeline`).catch(() => null);
      source = 'Riot-API';
    }
    if (!game) return null;
    const a = analyzeGame(game, tl, puuid, { name, item });
    if (!a) return null;
    a.matchId = mid; a.champion = a.champion || name(a.championId); if (a.opponent) a.opponent.champion = a.opponent.champion || name(a.opponent.championId);
    a.source = source; a.analyzedAt = nowIso();
    const row = this.db.get('SELECT played_at FROM lol_matches WHERE match_id=?', mid);
    a.playedAt = row?.played_at || null;
    this.setDeep(mid, a);
    return a;
  }

  /** Fehlende Tiefenanalysen der letzten Ranked-Spiele nachholen (Client offen oder Riot-Schlüssel). */
  async deepSync({ limit = 20 } = {}) {
    const rows = this.db.all('SELECT match_id FROM lol_matches ORDER BY played_at DESC LIMIT ?', limit);
    const todo = rows.filter((r) => { const d = this.getDeep(r.match_id); return !d?.hasTimeline || (d.v || 1) < 3; }).map((r) => r.match_id);
    if (!todo.length) return { analyzed: 0, missing: 0 };
    const canClient = !!(await this.lcuCreds().catch(() => null));
    if (!canClient && !this.hasKey()) return { analyzed: 0, missing: todo.length, reason: 'Client geschlossen' };
    const me = canClient ? await this.lcuGet('/lol-summoner/v1/current-summoner').catch(() => null) : null;
    let analyzed = 0;
    for (const mid of todo) {
      try { if (await this.deepAnalyze(mid, { me })) analyzed++; } catch (e) { log.debug('Tiefenanalyse ' + mid, e); }
    }
    if (analyzed) this.bus.emit('game:data', { game: 'league' });
    return { analyzed, missing: todo.length - analyzed };
  }

  /** Muster über die letzten N tief analysierten Ranked-Spiele. */
  patterns(n = 20) {
    const rows = this.db.all('SELECT match_id FROM lol_matches ORDER BY played_at DESC LIMIT ?', n);
    const list = rows.map((r) => this.getDeep(r.match_id)).filter(Boolean);
    return { ...patterns(list), recent: list.slice(0, 5).map((g) => ({ matchId: g.matchId, playedAt: g.playedAt, champion: g.champion, vs: g.opponent?.champion || null, win: g.win, kda: `${g.kills}/${g.deaths}/${g.assists}`, earlyDeaths: g.earlyDeaths, csAt10: g.csAt10, csDiff10: g.csDiff10, goldDiff15: g.goldDiff15, deaths: (g.deathsDetail || []).map((d) => `${d.min}. Min ${d.zone}${d.by?.length ? ' durch ' + d.by.join(' + ') : ''}${d.solo ? ' (1v1)' : d.enemies >= 3 ? ` (${d.enemies} Gegner)` : ''}${d.jungler ? ' [Jungler]' : ''}${d.gold >= 1300 ? ` [${d.gold} Gold]` : ''}`), objectives: g.objectives, enemyJungle: g.enemyJungle || null, jungle: g.jungle || null, firstBackMin: g.firstBackMin ?? null, wardsBefore14: g.wardsBefore14 ?? null, notes: this.notesFor(g).map((x) => x.text), debrief: (() => { const d = this.debrief(g.matchId); return d ? d.questions.map((q, i) => (d.answers[i] ? { q, a: d.answers[i] } : null)).filter(Boolean) : []; })() })), analyzedOf: rows.length, session: (() => { try { const x = this.sessionStats(); return { findings: x.findings, afterLosses: x.afterLosses, gameInSession: x.gameInSession, timeOfDay: x.timeOfDay }; } catch { return null; } })() };
  }
  // ---------- Debrief: 2–3 Fragen nach dem Spiel, Antworten fließen in die Analyse ----------
  debrief(mid) { try { return JSON.parse(this.db.get('SELECT value FROM game_state WHERE key=?', 'lol:debrief:' + mid)?.value || 'null'); } catch { return null; } }
  setDebrief(mid, v) { this.db.run('INSERT INTO game_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at', 'lol:debrief:' + mid, JSON.stringify(v), nowIso()); }
  setDebriefQuestions(mid, questions) { const q = (questions || []).map((x) => String(x).slice(0, 240)).filter(Boolean).slice(0, 3); if (q.length) this.setDebrief(mid, { questions: q, answers: {}, at: nowIso() }); return q; }
  answerDebrief(mid, index, text) {
    const d = this.debrief(mid); if (!d?.questions?.[index]) throw new Error('Frage nicht gefunden');
    d.answers[index] = String(text || '').trim().slice(0, 500); this.setDebrief(mid, d); this.bus.emit('game:data', { game: 'league' }); return d;
  }

  // ---------- Session/Tilt und Wochenbericht ----------
  sessionStats() {
    const { sessionStats } = require('./lolcoach');
    return sessionStats(this.db.all('SELECT summary, played_at FROM lol_matches ORDER BY played_at DESC LIMIT 400').map((r) => { const x = JSON.parse(r.summary); return { playedAt: r.played_at, win: x.win, duration: x.duration }; }));
  }
  weekly(now = new Date()) {
    const { weekly } = require('./lolcoach');
    const day = (now.getDay() + 6) % 7; const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
    const from = new Date(monday.getTime() - 7 * 86400000);
    const rows = this.db.all('SELECT match_id, summary, played_at FROM lol_matches WHERE played_at >= ? ORDER BY played_at DESC', from.toISOString()).map((r) => ({ ...JSON.parse(r.summary), playedAt: r.played_at, deep: this.getDeep(r.match_id) }));
    const cur = rows.filter((r) => Date.parse(r.playedAt) >= monday.getTime()); const prev = rows.filter((r) => Date.parse(r.playedAt) < monday.getTime());
    return { from: monday.toISOString(), previousFrom: from.toISOString(), ...weekly(cur, prev, this.goals(), this.patterns(20), this.stats(20).current) };
  }

  /** Tief analysierte Spiele (für die Spielanalyse-Auswahl). */
  deepGames(limit = 20) {
    return this.db.all('SELECT match_id, played_at FROM lol_matches ORDER BY played_at DESC LIMIT ?', limit).map((r) => {
      const d = this.getDeep(r.match_id);
      return d?.hasTimeline ? { matchId: r.match_id, playedAt: r.played_at, champion: d.champion, vs: d.opponent?.champion || null, win: d.win, kda: `${d.kills}/${d.deaths}/${d.assists}`, role: d.roleDe } : null;
    }).filter(Boolean);
  }
  /** Ein Spiel mit allem für die Detailansicht: Analyse, Notizen, Debrief-Antworten, Build-Vergleich. */
  deepDetail(matchId) {
    const d = this.getDeep(matchId); if (!d) return null;
    const same = this.db.all('SELECT match_id FROM lol_matches ORDER BY played_at DESC LIMIT 60').map((r) => this.getDeep(r.match_id)).filter((g) => g && g.champion === d.champion && g.firstItemMin != null && g.matchId !== matchId);
    const firstItemAvg = same.length >= 2 ? Math.round(same.reduce((a, g) => a + g.firstItemMin, 0) / same.length * 10) / 10 : null;
    return { ...d, notes: this.notesFor(d), debrief: this.debrief(matchId), firstItemAvg, firstItemGames: same.length };
  }
  notesFor(g) {
    const start = Date.parse(g.playedAt); const dur = Number(g.duration || 0) || Number(g.durationMin || 0) * 60;
    if (!Number.isFinite(start) || !dur) return [];
    return this.liveNotes(new Date(start - 5 * 60000).toISOString(), new Date(start + (dur + 600) * 1000).toISOString());
  }

  /** ARAM/Arena/Normal-Spiele aus der Client-Matchliste merken (eigene Werte). */
  recordOtherModes(games, me, champName) {
    const MODES = { 450: 'ARAM', 1700: 'Arena', 1710: 'Arena', 400: 'Normal (Draft)', 430: 'Normal (Blind)', 490: 'Normal (Quickplay)', 440: 'Ranked Flex', 900: 'URF', 1900: 'URF', 2400: 'ARAM: Mayhem' };
    let list = []; try { list = JSON.parse(this.db.get("SELECT value FROM game_state WHERE key='lol:modes'")?.value || '[]'); } catch { list = []; }
    const seen = new Set(list.map((x) => x.id)); let added = 0;
    for (const g of games) {
      if (g.queueId === 420 || !MODES[g.queueId]) continue;
      const mid = `${g.platformId || 'LCU'}_${g.gameId}`; if (seen.has(mid)) continue;
      const ident = (g.participantIdentities || []).find((x) => x.player?.puuid === me.puuid);
      const p = (g.participants || []).find((x) => x.participantId === ident?.participantId); const st = p?.stats;
      if (!st) continue;
      list.push({ id: mid, mode: MODES[g.queueId], queueId: g.queueId, at: new Date(g.gameCreation).toISOString(), champion: champName(p.championId), win: !!st.win, place: st.subteamPlacement || st.playerSubteamPlacement || null, k: st.kills, d: st.deaths, a: st.assists, damage: st.totalDamageDealtToChampions || 0, minutes: Math.round((g.gameDuration || 0) / 60) });
      added++;
    }
    if (added) this.db.run("INSERT INTO game_state(key,value,updated_at) VALUES('lol:modes',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at", JSON.stringify(list.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 300)), nowIso());
    return added;
  }
  /** Statistik pro Modus: Spiele, Winrate (Arena: Ø Platz, Top 4), KDA, Lieblings-Champions. */
  modeStats() {
    let list = []; try { list = JSON.parse(this.db.get("SELECT value FROM game_state WHERE key='lol:modes'")?.value || '[]'); } catch { list = []; }
    const by = {};
    for (const g of list) {
      const m = by[g.mode] = by[g.mode] || { mode: g.mode, games: 0, wins: 0, k: 0, d: 0, a: 0, places: [], champs: {} };
      m.games++; if (g.win) m.wins++; m.k += g.k; m.d += g.d; m.a += g.a; if (g.place) m.places.push(g.place);
      const c = m.champs[g.champion] = m.champs[g.champion] || { champion: g.champion, games: 0, wins: 0 }; c.games++; if (g.win) c.wins++;
    }
    return Object.values(by).map((m) => ({ mode: m.mode, games: m.games, winrate: Math.round(m.wins / m.games * 100), kda: +((m.k + m.a) / Math.max(1, m.d)).toFixed(2), avgPlace: m.places.length ? +(m.places.reduce((a, b) => a + b, 0) / m.places.length).toFixed(1) : null, top4: m.places.length ? m.places.filter((x) => x <= 4).length : null, champions: Object.values(m.champs).sort((a, b) => b.games - a.games).slice(0, 5) })).sort((a, b) => b.games - a.games);
  }

  /** LP-Verlauf: absoluter Wert über Ränge hinweg (Eisen IV 0 LP = 0, je Division 100). */
  rankHistory() {
    let list = []; try { list = JSON.parse(this.db.get("SELECT value FROM game_state WHERE key='lol:rankhist'")?.value || '[]'); } catch { list = []; }
    return list;
  }
  /** Champion-Pool: pro Rolle die Champions, mit denen du (mit Glättung) am besten abschneidest – ab 3 Spielen. */
  championPool(n = 80) {
    const rows = this.db.all('SELECT summary FROM lol_matches ORDER BY played_at DESC LIMIT ?', n).map((r) => JSON.parse(r.summary));
    const by = {};
    for (const m of rows) {
      const role = m.role || 'UNBEKANNT'; const k = role + '|' + m.champion;
      const x = by[k] = by[k] || { role, champion: m.champion, games: 0, wins: 0, cs: 0, kda: 0 };
      x.games++; if (m.win) x.wins++; x.cs += m.csPerMin || 0; x.kda += (m.kills + m.assists) / Math.max(1, m.deaths);
    }
    const all = Object.values(by).filter((x) => x.games >= 3).map((x) => ({ ...x, winrate: Math.round(x.wins / x.games * 100), score: Math.round((x.wins + 1) / (x.games + 2) * 100), csPerMin: +(x.cs / x.games).toFixed(1), kda: +(x.kda / x.games).toFixed(2) }));
    const roles = {};
    for (const x of all) (roles[x.role] = roles[x.role] || []).push(x);
    const out = Object.entries(roles).map(([role, list]) => ({ role, games: list.reduce((a, x) => a + x.games, 0), pool: list.sort((a, b) => b.score - a.score || b.games - a.games).slice(0, 3), drop: list.filter((x) => x.games >= 5 && x.winrate < 40).map((x) => x.champion) })).sort((a, b) => b.games - a.games);
    return { analyzed: rows.length, roles: out, note: 'Bewertung mit Glättung ((Siege+1)/(Spiele+2)), damit 2 Glückssiege nicht alles überstrahlen.' };
  }

  saveRank(rank, source) {
    try {
      const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
      const DIV = { IV: 0, III: 1, II: 2, I: 3 };
      const t = TIERS.indexOf(String(rank.tier).toUpperCase());
      if (t >= 0) {
        const abs = t >= 7 ? 7 * 400 + (rank.lp || 0) : t * 400 + (DIV[rank.rank] ?? 0) * 100 + (rank.lp || 0);
        const h = this.rankHistory(); const last = h[h.length - 1];
        if (!last || last.abs !== abs || last.wins !== rank.wins || last.losses !== rank.losses) {
          h.push({ at: nowIso(), tier: rank.tier, rank: rank.rank, lp: rank.lp, wins: rank.wins, losses: rank.losses, abs });
          this.db.run("INSERT INTO game_state(key,value,updated_at) VALUES('lol:rankhist',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at", JSON.stringify(h.slice(-300)), nowIso());
        }
      }
    } catch (e) { log.debug('rankhist', e); }
    const prev = this.cache.get('lol:rank:last', { allowStale: true });
    const same = prev?.value && prev.value.tier === rank.tier && prev.value.rank === rank.rank && prev.value.lp === rank.lp;
    this.cache.set('lol:rank:last', { ...rank, prev: same ? prev.value.prev : prev?.value ? { tier: prev.value.tier, rank: prev.value.rank, lp: prev.value.lp } : null }, source, 365 * 86400000);
  }

  /**
   * Matches synchronisieren: bevorzugt aus dem laufenden League-Client (kein
   * Schlüssel), sonst – falls hinterlegt – über die Riot-Web-API.
   */
  async syncMatches(opts = {}) {
    if (await this.clientAvailable()) return this.syncFromClient();
    if (this.hasKey()) return this.syncMatchesApi(opts);
    throw new Error('Starte den League-Client – JARVIS liest deine Matches dann direkt aus (kein API-Schlüssel nötig).');
  }

  async source() {
    const last = this.cache.get('lol:lastsync', { allowStale: true })?.value || null;
    return { client: await this.clientAvailable(), key: this.hasKey(), lastSync: last, me: this.cache.get('lol:me', { allowStale: true })?.value || null };
  }

  /** Riot-Web-API (optional, mit eigenem Schlüssel). */
  async syncMatchesApi({ count = 20, queue = 420 } = {}) {
    const g = this.settings.get('gaming');
    const region = REGIONAL[g.riotRegion] || 'europe';
    const acct = await this.account();
    const ids = await this.riot(region, `/lol/match/v5/matches/by-puuid/${acct.puuid}/ids?queue=${queue}&count=${Math.min(count, 50)}`);
    let added = 0;
    for (const mid of ids) {
      if (this.db.get('SELECT 1 x FROM lol_matches WHERE match_id=?', mid)) continue;
      const m = await this.riot(region, `/lol/match/v5/matches/${mid}`);
      const p = m.info.participants.find((x) => x.puuid === acct.puuid);
      if (!p) continue;
      const mins = m.info.gameDuration / 60;
      const team = m.info.participants.filter((x) => x.teamId === p.teamId);
      const teamKills = team.reduce((a, x) => a + x.kills, 0) || 1;
      const summary = {
        matchId: mid, champion: p.championName, win: p.win, kills: p.kills, deaths: p.deaths, assists: p.assists,
        cs: p.totalMinionsKilled + p.neutralMinionsKilled, csPerMin: +((p.totalMinionsKilled + p.neutralMinionsKilled) / mins).toFixed(1),
        vision: p.visionScore, goldPerMin: Math.round(p.goldEarned / mins), damagePerMin: Math.round(p.totalDamageDealtToChampions / mins),
        killParticipation: Math.round(((p.kills + p.assists) / teamKills) * 100), role: p.teamPosition || p.individualPosition || 'UNKNOWN',
        duration: m.info.gameDuration, queue: m.info.queueId, patch: String(m.info.gameVersion).split('.').slice(0, 2).join('.'),
        items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5].filter(Boolean),
      };
      this.db.run('INSERT OR REPLACE INTO lol_matches(match_id,puuid,played_at,summary) VALUES(?,?,?,?)', mid, acct.puuid, new Date(m.info.gameStartTimestamp).toISOString(), JSON.stringify(summary));
      added++;
    }
    try {
      const host = g.riotRegion || 'euw1';
      const entries = await this.riot(host, `/lol/league/v4/entries/by-puuid/${acct.puuid}`);
      const solo = entries.find((e) => e.queueType === 'RANKED_SOLO_5x5');
      if (solo) this.saveRank({ tier: solo.tier, rank: solo.rank, lp: solo.leaguePoints, wins: solo.wins, losses: solo.losses }, 'Riot league-v4');
    } catch (e) { log.debug('Rang nicht verfügbar', e); }
    this.cache.set('lol:lastsync', { at: new Date().toISOString(), source: 'api' }, 'Riot API', 365 * 86400000);
    this.bus.emit('game:data', { game: 'league' });
    return { added, total: ids.length, source: 'api' };
  }

  matches(limit = 20) { return this.db.all('SELECT summary FROM lol_matches ORDER BY played_at DESC LIMIT ?', limit).map((r) => JSON.parse(r.summary)); }

  /** Aggregated stats + comparison with the previous window. Computed only from stored matches. */
  stats(window = 20) {
    const all = this.db.all('SELECT summary, played_at FROM lol_matches ORDER BY played_at DESC LIMIT ?', window * 2).map((r) => ({ ...JSON.parse(r.summary), playedAt: r.played_at }));
    const cur = all.slice(0, window), prev = all.slice(window);
    const agg = (list) => {
      if (!list.length) return null;
      const n = list.length; const s = (f) => list.reduce((a, x) => a + f(x), 0);
      const k = s((x) => x.kills) / n, d = s((x) => x.deaths) / n, a = s((x) => x.assists) / n;
      return { games: n, wins: s((x) => (x.win ? 1 : 0)), winrate: Math.round((s((x) => (x.win ? 1 : 0)) / n) * 100), kda: +((k + a) / Math.max(1, d)).toFixed(2),
        avgK: +k.toFixed(1), avgD: +d.toFixed(1), avgA: +a.toFixed(1), csPerMin: +(s((x) => x.csPerMin) / n).toFixed(1),
        goldPerMin: Math.round(s((x) => x.goldPerMin) / n), damagePerMin: Math.round(s((x) => x.damagePerMin) / n), kp: (() => { const k = list.filter((x) => x.killParticipation != null); return k.length ? Math.round(k.reduce((a, x) => a + x.killParticipation, 0) / k.length) : null; })(), vision: (() => { const v = list.filter((x) => x.vision != null); return v.length ? Math.round(v.reduce((a, x) => a + x.vision, 0) / v.length) : null; })() };
    };
    const c = agg(cur); const p = agg(prev);
    const delta = (key) => (c && p && p[key] ? Math.round(((c[key] - p[key]) / p[key]) * 100) : null);
    const champs = {}; const roles = {};
    for (const m of cur) {
      champs[m.champion] = champs[m.champion] || { champion: m.champion, games: 0, wins: 0, k: 0, d: 0, a: 0 };
      const ch = champs[m.champion]; ch.games++; ch.wins += m.win ? 1 : 0; ch.k += m.kills; ch.d += m.deaths; ch.a += m.assists;
      roles[m.role] = (roles[m.role] || 0) + 1;
    }
    const rank = this.cache.get('lol:rank:last', { allowStale: true })?.value || null;
    return {
      current: c, previous: p, deltas: { csPerMin: delta('csPerMin'), vision: delta('vision'), kda: delta('kda'), winrate: delta('winrate') },
      champions: Object.values(champs).map((x) => ({ ...x, winrate: Math.round((x.wins / x.games) * 100), kda: +((x.k + x.a) / Math.max(1, x.d)).toFixed(2) })).sort((a, b) => b.games - a.games),
      roles: Object.entries(roles).map(([role, n]) => ({ role, share: Math.round((n / cur.length) * 100) })).sort((a, b) => b.share - a.share),
      rank, recent: cur.slice(0, 8),
      insights: c ? this.insights(c, p, Object.values(champs)) : [],
    };
  }

  insights(c, p, champs) {
    const out = [];
    if (c.csPerMin < 6.5) out.push({ kind: 'farm', title: 'Farm-Fokus', text: `Ø ${c.csPerMin} CS/min – Ziel 7+: Wellen zwischen Objectives sauber einsammeln.` });
    if (c.avgD > 6) out.push({ kind: 'positioning', title: 'Positionierung', text: `Ø ${c.avgD} Tode pro Spiel – in Teamfights weiter hinten bleiben, Flash für Escapes halten.` });
    if (c.vision != null && c.vision < 20) out.push({ kind: 'vision', title: 'Vision', text: `Ø Vision Score ${c.vision} – pro Recall eine Control Ward einplanen.` });
    if (c.kp != null && c.kp < 45) out.push({ kind: 'macro', title: 'Makro-Fokus', text: `Kill-Beteiligung ${c.kp}% – öfter zu Drachen/Herald rotieren.` });
    const best = champs.filter((x) => x.games >= 3).sort((a, b) => b.wins / b.games - a.wins / a.games)[0];
    if (best) out.push({ kind: 'strength', title: 'Stärken ausbauen', text: `${best.champion}: ${Math.round((best.wins / best.games) * 100)}% WR in ${best.games} Spielen – Hauptpick ausbauen.` });
    if (p && c.csPerMin > p.csPerMin) out.push({ kind: 'trend', title: 'Entwicklung', text: `CS/min von ${p.csPerMin} auf ${c.csPerMin} verbessert.` });
    return out.slice(0, 4);
  }

  // ---------- Data Dragon ----------
  async ddVersion() {
    return (await this.cache.wrap('lol:dd:version', 'Data Dragon', 86400000, async () => (await (await this.fetch(DD + '/api/versions.json')).json())[0])).value;
  }
  async champions() {
    const v = await this.ddVersion();
    return this.cache.wrap('lol:dd:champs2:' + v, 'Data Dragon ' + v, 7 * 86400000, async () => {
      const j = await (await this.fetch(`${DD}/cdn/${v}/data/de_DE/champion.json`)).json();
      return Object.values(j.data).map((c) => ({ id: c.id, key: c.key, name: c.name, title: c.title, tags: c.tags, blurb: c.blurb }));
    });
  }
  /** Items (Data Dragon): Name und ob es ein fertiges Item ist (keine Weiterentwicklung, ≥ 2000 Gold, keine Stiefel). */
  async items() {
    const v = await this.ddVersion();
    return this.cache.wrap('lol:dd:items:' + v, 'Data Dragon ' + v, 7 * 86400000, async () => {
      const j = await (await this.fetch(`${DD}/cdn/${v}/data/de_DE/item.json`)).json();
      return Object.fromEntries(Object.entries(j.data || {}).map(([k, it]) => [k, { name: it.name, complete: !(it.into || []).length && (it.gold?.total || 0) >= 2000 && !(it.tags || []).includes('Boots') && it.gold?.purchasable !== false }]));
    });
  }
  async champion(name) {
    const v = await this.ddVersion();
    const list = (await this.champions()).value;
    const c = list.find((x) => x.name.toLowerCase() === String(name).toLowerCase() || x.id.toLowerCase() === String(name).toLowerCase());
    if (!c) return null;
    const r = await this.cache.wrap(`lol:dd:champ:${v}:${c.id}`, 'Data Dragon ' + v, 7 * 86400000, async () => {
      const j = await (await this.fetch(`${DD}/cdn/${v}/data/de_DE/champion/${c.id}.json`)).json();
      const d = j.data[c.id];
      return { id: d.id, name: d.name, title: d.title, tags: d.tags, lore: d.blurb, allytips: d.allytips, enemytips: d.enemytips,
        spells: d.spells.map((s) => ({ name: s.name, description: s.description.replace(/<[^>]+>/g, '') })), passive: { name: d.passive.name, description: d.passive.description.replace(/<[^>]+>/g, '') } };
    });
    return { ...r.value, patch: v, icon: `${DD}/cdn/${v}/img/champion/${c.id}.png`, source: r.source };
  }
  championIcon(nameOrId, v) { return `${DD}/cdn/${v}/img/champion/${String(nameOrId).replace(/[^A-Za-z]/g, '')}.png`; }

  goals() { return this.db.all('SELECT * FROM lol_goals WHERE active=1 ORDER BY created_at DESC').map((g) => ({ id: g.id, text: g.text, metric: g.metric, target: g.target })); }
  addGoal({ text, metric, target }) {
    if (!metric) { const g = parseGoal(text); if (g) { metric = g.metric; target = g.target; } }
    const gid = id('g'); this.db.run('INSERT INTO lol_goals(id,text,metric,target,created_at) VALUES(?,?,?,?,?)', gid, String(text).slice(0, 200), metric || null, target ?? null, nowIso()); this.bus.emit('game:data', { game: 'league' }); return gid; }
  removeGoal(gid) { this.db.run('UPDATE lol_goals SET active=0 WHERE id=?', gid); this.bus.emit('game:data', { game: 'league' }); }
}

/** „7 CS/min“, „max. 5 Tode“, „Vision 25“ → messbares Ziel. */
function parseGoal(text) {
  const t = String(text || '').toLowerCase().replace(',', '.');
  let m = /(früh|vor min|vor minute)/.test(t) && t.match(/(\d+)\s*(?:frühe\s*)?(?:tode|tod)/); if (m) return { metric: 'earlyDeaths', target: Number(m[1]) };
  m = t.match(/(\d+(?:\.\d+)?)\s*cs/); if (m) return { metric: 'csPerMin', target: Number(m[1]) };
  m = t.match(/(\d+)\s*(?:tode|deaths|tod)/) || t.match(/(?:tode|deaths)\D{0,12}(\d+)/); if (m) return { metric: 'deaths', target: Number(m[1]) };
  m = t.match(/vision\D{0,12}(\d+)/) || t.match(/(\d+)\s*vision/); if (m) return { metric: 'vision', target: Number(m[1]) };
  return null;
}

/** LCU match-history game → compact summary (same shape as API matches). */
function summarizeLcuGame(g, me, champName) {
  const mid = `${g.platformId || 'LCU'}_${g.gameId}`;
  const ident = (g.participantIdentities || []).find((x) => x.player?.puuid === me.puuid);
  const p = (g.participants || []).find((x) => x.participantId === ident?.participantId) || (g.participants || [])[0];
  if (!p?.stats || !g.gameDuration) return null;
  const st = p.stats; const mins = g.gameDuration / 60;
  const team = (g.participants || []).filter((x) => x.teamId === p.teamId);
  const teamKills = team.length >= 5 ? team.reduce((a, x) => a + (x.stats?.kills || 0), 0) : null;
  const lane = String(p.timeline?.lane || '').toUpperCase(); const role = String(p.timeline?.role || '').toUpperCase();
  const pos = lane === 'BOTTOM' || lane === 'BOT' ? (role.includes('SUPPORT') ? 'UTILITY' : 'BOTTOM') : lane === 'MID' ? 'MIDDLE' : lane || 'UNKNOWN';
  const cs = (st.totalMinionsKilled || 0) + (st.neutralMinionsKilled || 0);
  return {
    matchId: mid, champion: champName(p.championId), win: !!st.win, kills: st.kills, deaths: st.deaths, assists: st.assists,
    cs, csPerMin: +(cs / mins).toFixed(1), vision: st.visionScore ?? null, goldPerMin: Math.round((st.goldEarned || 0) / mins),
    damagePerMin: Math.round((st.totalDamageDealtToChampions || 0) / mins),
    killParticipation: teamKills ? Math.round(((st.kills + st.assists) / Math.max(1, teamKills)) * 100) : null,
    role: pos, duration: g.gameDuration, queue: g.queueId, patch: String(g.gameVersion || '').split('.').slice(0, 2).join('.'),
    items: [st.item0, st.item1, st.item2, st.item3, st.item4, st.item5].filter(Boolean), source: 'client',
    wardsPlaced: st.wardsPlaced ?? null, controlWards: st.visionWardsBoughtInGame ?? null, firstBlood: !!(st.firstBloodKill || st.firstBloodAssist),
  };
}

module.exports = { liveContext, League, REGIONAL, summarizeLcuGame, parseGoal };
