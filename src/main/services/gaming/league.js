'use strict';
const https = require('node:https');
const { id, nowIso } = require('../../core/util');
const log = require('../../core/logger').scope('league');

/**
 * League of Legends integration (read-only, Riot policy compliant):
 * - Live Client Data API on 127.0.0.1:2999 (only while a match runs)
 * - Riot Web API (account-v1, match-v5, league-v4) with the user's own key
 * - Data Dragon for champions/patch
 * No input automation, no information the APIs do not provide.
 */
const REGIONAL = { euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe', na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas', kr: 'asia', jp1: 'asia', oc1: 'sea' };
const DD = 'https://ddragon.leagueoflegends.com';

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
      if (!this.liveSession || (this.lastLive && seconds < this.lastLive.seconds - 30)) this.liveSession = id('lol');
      if (!this.lastLive || seconds - (this.lastLive.loggedAt || 0) >= 30) {
        this.db.run('INSERT INTO lol_samples(session,at,game_seconds,champion,level,gold,k,d,a,cs) VALUES(?,?,?,?,?,?,?,?,?,?)', this.liveSession, nowIso(), seconds, state.champion, state.level, state.gold, sc.kills, sc.deaths, sc.assists, sc.creepScore);
        state.loggedAt = seconds;
      } else state.loggedAt = this.lastLive.loggedAt;
      state.tips = this.liveTips(state);
      this.lastLive = state;
      return state;
    } catch {
      this.liveSession = null; this.lastLive = null;
      return { connected: false, reason: 'Kein laufendes Match erkannt (Live Client API nicht erreichbar).' };
    }
  }

  /** Rule-based, cheap live coaching hints (no LLM call). */
  liveTips(s) {
    const tips = [];
    const min = s.seconds / 60;
    if (s.csPerMin != null && min > 8 && ['BOTTOM', 'MIDDLE', 'TOP', 'JUNGLE'].includes(s.position) && s.csPerMin < 6) tips.push(`CS/min bei ${s.csPerMin} – Wellen zwischen Fights einsammeln.`);
    if (s.gold > 2000) tips.push(`${s.gold} Gold ungenutzt – bei Gelegenheit recallen.`);
    if (s.opponent && s.level != null && s.opponent.level - s.level >= 2) tips.push(`Lane-Gegner ${s.opponent.champion} ist ${s.opponent.level - s.level} Level voraus – Risiko reduzieren.`);
    if (s.deaths >= 5 && min < 15) tips.push('Viele frühe Tode – Wardings und Map-Check vor Aggression.');
    if (s.ward != null && min > 15 && s.ward < min * 0.6) tips.push('Vision Score niedrig – Control Ward kaufen.');
    return tips.slice(0, 3);
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
    if (this._lcu && Date.now() - this._lcu.at < 60000) return this._lcu.creds;
    const fs = require('node:fs'); const path = require('node:path');
    const dirs = [this.settings.get('gaming').leagueDir, ...['C', 'D', 'E', 'F'].flatMap((d) => [`${d}:\\Riot Games\\League of Legends`, `${d}:\\Program Files\\Riot Games\\League of Legends`, `${d}:\\Games\\Riot Games\\League of Legends`])].filter(Boolean);
    let creds = null;
    for (const d of dirs) {
      try {
        const [, , port, password, protocol] = fs.readFileSync(path.join(d, 'lockfile'), 'utf8').trim().split(':');
        if (port && password) { creds = { port: Number(port), password, protocol: protocol || 'https' }; break; }
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
  async clientAvailable() { try { await this.lcuGet('/lol-summoner/v1/current-summoner'); return true; } catch { return false; } }

  /** Matchhistorie + Rang direkt aus dem laufenden Client (kein Schlüssel nötig). */
  async syncFromClient({ queues = [420] } = {}) {
    const me = await this.lcuGet('/lol-summoner/v1/current-summoner');
    const hist = await this.lcuGet('/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=49');
    const games = hist?.games?.games || [];
    const champs = await this.champions().then((r) => r.value).catch(() => []);
    const champName = (cid) => champs.find((c) => String(c.key) === String(cid))?.id || `Champion ${cid}`;
    let added = 0;
    for (const g of games) {
      if (queues.length && !queues.includes(g.queueId)) continue;
      const mid = `${g.platformId || 'LCU'}_${g.gameId}`;
      if (this.db.get('SELECT 1 x FROM lol_matches WHERE match_id=?', mid)) continue;
      const ident = (g.participantIdentities || []).find((x) => x.player?.puuid === me.puuid);
      const p = (g.participants || []).find((x) => x.participantId === ident?.participantId) || (g.participants || [])[0];
      if (!p?.stats || !g.gameDuration) continue;
      const st = p.stats; const mins = g.gameDuration / 60;
      const team = (g.participants || []).filter((x) => x.teamId === p.teamId);
      const teamKills = team.length >= 5 ? team.reduce((a, x) => a + (x.stats?.kills || 0), 0) : null;
      const lane = String(p.timeline?.lane || '').toUpperCase(); const role = String(p.timeline?.role || '').toUpperCase();
      const pos = lane === 'BOTTOM' || lane === 'BOT' ? (role.includes('SUPPORT') ? 'UTILITY' : 'BOTTOM') : lane === 'MID' ? 'MIDDLE' : lane || 'UNKNOWN';
      const cs = (st.totalMinionsKilled || 0) + (st.neutralMinionsKilled || 0);
      const summary = {
        matchId: mid, champion: champName(p.championId), win: !!st.win, kills: st.kills, deaths: st.deaths, assists: st.assists,
        cs, csPerMin: +(cs / mins).toFixed(1), vision: st.visionScore ?? null, goldPerMin: Math.round((st.goldEarned || 0) / mins),
        damagePerMin: Math.round((st.totalDamageDealtToChampions || 0) / mins),
        killParticipation: teamKills ? Math.round(((st.kills + st.assists) / Math.max(1, teamKills)) * 100) : null,
        role: pos, duration: g.gameDuration, queue: g.queueId, patch: String(g.gameVersion || '').split('.').slice(0, 2).join('.'),
        items: [st.item0, st.item1, st.item2, st.item3, st.item4, st.item5].filter(Boolean), source: 'client',
      };
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

  saveRank(rank, source) {
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
  addGoal({ text, metric, target }) { const gid = id('g'); this.db.run('INSERT INTO lol_goals(id,text,metric,target,created_at) VALUES(?,?,?,?,?)', gid, String(text).slice(0, 200), metric || null, target ?? null, nowIso()); this.bus.emit('game:data', { game: 'league' }); return gid; }
  removeGoal(gid) { this.db.run('UPDATE lol_goals SET active=0 WHERE id=?', gid); this.bus.emit('game:data', { game: 'league' }); }
}

module.exports = { League, REGIONAL };
