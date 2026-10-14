'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const { tempCore } = require('./helpers');

/** Nachgebauter League-Client: HTTPS (selbstsigniert), Basic-Auth riot:<passwort>, lockfile. */
function fakeClient(dir, extra = () => ({})) {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
  const password = 'geheim123';
  const game = (id, champ, win, k, d, a, cs, queueId = 420) => ({
    gameId: id, platformId: 'EUW1', gameCreation: Date.now() - id * 1000, gameDuration: 1800, queueId, gameVersion: '16.20.123.4567',
    participantIdentities: [{ participantId: 3, player: { puuid: 'me' } }],
    participants: [{ participantId: 3, championId: champ, teamId: 100, timeline: { lane: 'BOTTOM', role: 'CARRY' },
      stats: { win, kills: k, deaths: d, assists: a, totalMinionsKilled: cs, neutralMinionsKilled: 0, visionScore: 25, goldEarned: 12000, totalDamageDealtToChampions: 21000, item0: 3031 } }],
  });
  const routes = {
    '/lol-summoner/v1/current-summoner': { puuid: 'me', gameName: 'BoZ', tagLine: 'EUW', summonerLevel: 312 },
    '/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=49': { games: { games: [game(1, 202, true, 10, 2, 8, 240), game(2, 145, false, 4, 7, 5, 200), game(3, 202, true, 8, 3, 9, 230, 450)] } },
    '/lol-ranked/v1/current-ranked-stats': { queueMap: { RANKED_SOLO_5x5: { tier: 'GOLD', division: 'II', leaguePoints: 47, wins: 30, losses: 25 } } },
    ...extra(game),
  };
  const srv = https.createServer({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) }, (req, res) => {
    if (req.headers.authorization !== 'Basic ' + Buffer.from('riot:' + password).toString('base64')) { res.writeHead(401); return res.end(); }
    const body = typeof routes[req.url] === 'function' ? routes[req.url]() : routes[req.url];
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body || {}));
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => {
    fs.writeFileSync(path.join(dir, 'lockfile'), `LeagueClient:1234:${srv.address().port}:${password}:https`);
    r(srv);
  }));
}

let hasOpenssl = true;
try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); } catch { hasOpenssl = false; }

test('LoL ohne API-Schlüssel: Matches + Rang aus dem lokalen League-Client', { skip: !hasOpenssl && 'openssl fehlt' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcu-'));
  const srv = await fakeClient(dir);
  const ddragon = async (url) => {
    if (url.endsWith('versions.json')) return new Response(JSON.stringify(['16.20.1']));
    return new Response(JSON.stringify({ data: { Jhin: { id: 'Jhin', key: '202', name: 'Jhin', tags: [] }, Kaisa: { id: 'Kaisa', key: '145', name: "Kai'Sa", tags: [] } } }));
  };
  const { core, cleanup } = tempCore({ fetch: ddragon });
  core.settings.update({ gaming: { leagueDir: dir } });
  const L = core.gaming.league;
  assert.equal(L.hasKey(), false, 'kein Riot-Schlüssel hinterlegt');
  assert.equal(await L.clientAvailable(), true);
  const r = await L.syncMatches();
  assert.equal(r.source, 'client');
  assert.equal(r.added, 2, 'nur Ranked Solo/Duo (queue 420), ARAM ignoriert');
  assert.equal(await L.syncMatches().then((x) => x.added), 0, 'keine Duplikate beim erneuten Sync');
  const st = L.stats();
  assert.equal(st.current.games, 2);
  assert.equal(st.current.winrate, 50);
  assert.equal(st.champions[0].champion, 'Jhin', 'Champion-ID → Name über Data Dragon');
  assert.equal(st.recent[0].role, 'BOTTOM');
  assert.equal(st.current.kp, null, 'Kill-Beteiligung unbekannt statt erfunden');
  assert.deepEqual({ tier: st.rank.tier, rank: st.rank.rank, lp: st.rank.lp }, { tier: 'GOLD', rank: 'II', lp: 47 });
  assert.equal((await L.source()).me.name, 'BoZ#EUW');
  // falsches Passwort → sauberer Fehler, kein Absturz
  fs.writeFileSync(path.join(dir, 'lockfile'), `LeagueClient:1:${srv.address().port}:falsch:https`);
  L._lcu = null;
  assert.equal(await L.clientAvailable(), false);
  srv.close();
  L._lcu = null;
  await assert.rejects(L.syncMatches(), /League-Client/);
  cleanup();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('LoL: neue Spiele ohne Öffnen der Matchhistorie (PUUID-Abfrage + Spiel direkt per gameId nach Spielende)', { skip: !hasOpenssl && 'openssl fehlt' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcu-'));
  let gameReady = false;
  const srv = await fakeClient(dir, (game) => {
    const fresh = game(0, 145, true, 12, 1, 7, 260); // gerade gespielt – steht noch NICHT im Zwischenspeicher „current-summoner“
    const full = { ...fresh, gameId: 4711, gameCreation: Date.now() - 2000 };
    return {
      '/lol-match-history/v1/products/lol/me/matches?begIndex=0&endIndex=49': { games: { games: [fresh, game(1, 202, true, 10, 2, 8, 240), game(2, 145, false, 4, 7, 5, 200)] } },
      '/lol-match-history/v1/games/4711': () => (gameReady ? full : undefined),
      '/lol-end-of-game/v1/eog-stats-block': { gameId: 4711 },
    };
  });
  const ddragon = async (url) => {
    if (url.endsWith('versions.json')) return new Response(JSON.stringify(['16.20.1']));
    return new Response(JSON.stringify({ data: { Jhin: { id: 'Jhin', key: '202', name: 'Jhin', tags: [] }, Kaisa: { id: 'Kaisa', key: '145', name: "Kai'Sa", tags: [] } } }));
  };
  const { core, cleanup } = tempCore({ fetch: ddragon });
  core.settings.update({ gaming: { leagueDir: dir, lolReview: false } });
  const L = core.gaming.league;
  try {
  const r = await L.syncFromClient();
  assert.equal(r.added, 3, 'das neueste Spiel kommt über die PUUID-Abfrage, obwohl der Zwischenspeicher alt ist');
  // Nach Spielende: Spiel ist erst beim 3. Versuch abrufbar
  let tries = 0;
  const sleep = async () => { tries++; if (tries === 2) gameReady = true; };
  const m = await core.gaming.lolflow.afterGame(null, { tries: 5, sleep });
  assert.equal(m.matchId, 'EUW1_4711'); assert.equal(m.champion, 'Kaisa'); assert.equal(m.kills, 12);
  assert.ok(core.db.get("SELECT 1 x FROM lol_matches WHERE match_id='EUW1_4711'"), 'gespeichert');
  } finally { srv.close(); cleanup(); fs.rmSync(dir, { recursive: true, force: true }); }
});

/** Synthetisches 5v5-Spiel (LCU-Format) + Timeline. Ich (pid 4, Jinx BOTTOM) gegen pid 9 (BOTTOM). */
function fullGame(gameId, { win = false, myCs10 = 60, oppCs10 = 75, deaths = [], posFor = null, extra = [], gold = null } = {}) {
  const roles = [['TOP', 'SOLO'], ['JUNGLE', 'NONE'], ['MIDDLE', 'SOLO'], ['BOTTOM', 'DUO_CARRY'], ['BOTTOM', 'DUO_SUPPORT']];
  const participants = []; const ids = [];
  for (let i = 1; i <= 10; i++) {
    const [lane, role] = roles[(i - 1) % 5]; const team = i <= 5 ? 100 : 200;
    participants.push({ participantId: i, teamId: team, championId: i === 4 ? 222 : 100 + i, spell1Id: lane === 'JUNGLE' ? 11 : 4, spell2Id: 14, timeline: { lane, role },
      stats: { win: team === 100 ? win : !win, kills: i === 4 ? 3 : 2, deaths: i === 4 ? deaths.length : 2, assists: 4, totalMinionsKilled: i === 4 ? 180 : 150, neutralMinionsKilled: 0, visionScore: 20, wardsPlaced: 8, visionWardsBoughtInGame: i === 4 ? 0 : 2, totalDamageDealtToChampions: 15000, totalDamageTaken: 18000, goldEarned: 11000 } });
    ids.push({ participantId: i, player: { puuid: i === 4 ? 'me' : 'p' + i } });
  }
  const pfAt = (min) => Object.fromEntries(participants.map((p) => [String(p.participantId), { participantId: p.participantId, position: (posFor && posFor(p.participantId, min)) || (p.participantId === 4 ? { x: 9800, y: 4400 } : { x: 7000, y: 7000 }), currentGold: gold != null && p.participantId === 4 ? gold : 300, totalGold: 500 + min * 300 + (p.participantId === 4 ? -40 * min : 0), xp: min * 400, minionsKilled: p.participantId === 4 ? Math.round(myCs10 * min / 10) : p.participantId === 9 ? Math.round(oppCs10 * min / 10) : min * 6, jungleMinionsKilled: 0 }]));
  const frames = []; for (let m = 0; m <= 30; m++) frames.push({ timestamp: m * 60000, participantFrames: pfAt(m), events: [] });
  for (const d of deaths) frames[Math.floor(d.min)].events.push({ type: 'CHAMPION_KILL', timestamp: d.min * 60000, victimId: 4, killerId: 9, assistingParticipantIds: d.assists || [], position: d.pos });
  for (const e of extra) frames[Math.floor(e.timestamp / 60000)].events.push(e);
  // Gegner holt Drachen 30 s nach einem Tod in Minute 12
  frames[12].events.push({ type: 'ELITE_MONSTER_KILL', timestamp: 12.5 * 60000, killerId: 7, killerTeamId: 200, monsterType: 'DRAGON', position: { x: 9866, y: 4414 } });
  frames[20].events.push({ type: 'ELITE_MONSTER_KILL', timestamp: 20 * 60000, killerId: 2, killerTeamId: 100, monsterType: 'DRAGON', position: { x: 9866, y: 4414 } });
  return { game: { gameId, platformId: 'EUW1', gameCreation: Date.now() - gameId * 1e6, gameDuration: 1800, queueId: 420, gameVersion: '16.20.1', participants, participantIdentities: ids }, timeline: { frames } };
}

test('LoL-Fehleranalyse: Tode mit Ort, Lane-Differenz, Tode vor Objectives, Muster über mehrere Spiele', async () => {
  const { analyzeGame, patterns, zone } = require('../src/main/services/gaming/lolanalysis');
  assert.equal(zone({ x: 7400, y: 7400 }, 100), 'Midlane');
  assert.equal(zone({ x: 9000, y: 5800 }, 100), 'Fluss');
  assert.equal(zone({ x: 11000, y: 6500 }, 100), 'gegnerischer Jungle');
  const deaths = [{ min: 6, pos: { x: 9000, y: 5800 } }, { min: 12, pos: { x: 11000, y: 6500 }, assists: [7, 8] }, { min: 25, pos: { x: 7400, y: 7400 } }];
  const { game, timeline } = fullGame(1, { deaths });
  const a = analyzeGame(game, timeline, 'me');
  assert.equal(a.role, 'BOTTOM'); assert.equal(a.opponent.championId, 109);
  assert.equal(a.csAt10, 60); assert.equal(a.csDiff10, -15); assert.ok(a.goldDiff15 < 0);
  assert.deepEqual(a.deathsDetail.map((d) => [d.min, d.zone, d.solo]), [[6, 'Fluss', true], [12, 'gegnerischer Jungle', false], [25, 'Midlane', true]]);
  assert.equal(a.earlyDeaths, 2);
  assert.equal(a.objectives.deathsBeforeEnemyObjective, 1); assert.match(a.objectives.lostWhileDead[0], /Drache/);
  assert.equal(a.objectives.presentPct, 100, 'bei der Pit-Position → dabei');
  const list = [1, 2, 3, 4, 5].map((i) => analyzeGame(...Object.values(fullGame(i, { win: i > 3, myCs10: i > 3 ? 80 : 55, deaths: i > 3 ? [] : deaths })), 'me'));
  const p = patterns(list);
  assert.equal(p.games, 5);
  const ids = p.findings.map((f) => f.id);
  for (const x of ['early-deaths', 'death-zones', 'obj-deaths', 'lane-loss', 'control-wards']) assert.ok(ids.includes(x), 'fehlt: ' + x + ' in ' + ids.join(','));
  assert.equal(p.focus.length, 3);
  assert.equal(patterns(list.slice(0, 2)).findings.length, 0, 'zu wenig Daten → keine Behauptungen');
});

test('LoL-Fehleranalyse über den Client: Timeline nachladen, Muster, Tool + Brain-Eintrag', { skip: !hasOpenssl && 'openssl fehlt' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcu-'));
  const deaths = [{ min: 5, pos: { x: 9000, y: 5800 } }, { min: 9, pos: { x: 9100, y: 5700 } }, { min: 12, pos: { x: 11000, y: 6500 }, assists: [7, 8] }];
  const games = [11, 12, 13, 14].map((i) => fullGame(i, { win: i === 14, deaths: i === 14 ? [] : deaths }));
  const srv = await fakeClient(dir, () => Object.fromEntries(games.flatMap(({ game, timeline }) => [
    [`/lol-match-history/v1/games/${game.gameId}`, game], [`/lol-match-history/v1/game-timelines/${game.gameId}`, timeline]])));
  const ddragon = async (url) => {
    if (url.endsWith('versions.json')) return new Response(JSON.stringify(['16.20.1']));
    return new Response(JSON.stringify({ data: { Jinx: { id: 'Jinx', key: '222', name: 'Jinx', tags: [] }, Ashe: { id: 'Ashe', key: '109', name: 'Ashe', tags: [] } } }));
  };
  const { core, cleanup } = tempCore({ fetch: ddragon });
  try {
    core.settings.update({ gaming: { leagueDir: dir } });
    for (const { game } of games) core.db.run('INSERT INTO lol_matches(match_id,puuid,played_at,summary) VALUES(?,?,?,?)', 'EUW1_' + game.gameId, 'me', new Date(game.gameCreation).toISOString(), JSON.stringify({ matchId: 'EUW1_' + game.gameId, champion: 'Jinx', win: false, kills: 3, deaths: 3, assists: 4, csPerMin: 6, role: 'BOTTOM', duration: 1800 }));
    const out = await core.orchestrator.execute('league_deep_review', { games: 10 }, { conversationId: 'x', channel: 'text' });
    const r = out.response;
    assert.equal(r.games, 4); assert.equal(r.sync.analyzed, 4);
    assert.ok(r.findings.some((f) => f.id === 'early-deaths'));
    assert.equal(r.recent[0].vs, 'Ashe'); assert.match(r.recent[0].deaths[0], /Min Fluss/);
    const entry = core.gaming.brainSync.syncLeaguePatterns();
    assert.match(entry.content, /Zu viele frühe Tode/); assert.equal(entry.domain, 'gaming');
    assert.equal((await core.gaming.league.deepSync()).analyzed, 0, 'schon analysiert → nicht nochmal laden');
  } finally { srv.close(); cleanup(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('LoL Objective-Timer: Respawns aus echten Kills, Seele → Elder, einmalige Objectives verschwinden', () => {
  const { objectives } = require('../src/main/services/gaming/lolobjectives');
  const players = [{ riotIdGameName: 'Ich', team: 'ORDER' }, { riotIdGameName: 'Gegner', team: 'CHAOS' }];
  // 3:00 – noch nichts passiert: Standard-Startzeiten (geschätzt)
  let o = objectives([], players, 180, 'ORDER');
  const d = o.find((x) => x.id === 'dragon');
  assert.equal(d.spawnAt, 300); assert.equal(d.estimated, true); assert.equal(d.remaining, 120);
  assert.ok(o.some((x) => x.id === 'baron' && x.estimated));
  // Drache bei 6:10 von uns, Grubs bei 9:00 → nächster Drache 11:10 (nicht geschätzt), Grubs weg
  o = objectives([{ EventName: 'DragonKill', EventTime: 370, DragonType: 'Fire', KillerName: 'Ich', Stolen: 'False' }, { EventName: 'HordeKill', EventTime: 540, KillerName: 'Gegner' }], players, 600, 'ORDER');
  const d2 = o.find((x) => x.id === 'dragon');
  assert.equal(d2.spawnAt, 670); assert.equal(d2.estimated, false); assert.match(d2.note, /Fire.*dein Team/);
  assert.ok(!o.some((x) => x.id === 'grubs'));
  // 4 Drachen für den Gegner → Seele → Elder 6:00 nach dem letzten
  const four = [1, 2, 3, 4].map((i) => ({ EventName: 'DragonKill', EventTime: 300 * i + 10, DragonType: 'Water', KillerName: 'Gegner' }));
  o = objectives(four, players, 1300, 'ORDER');
  const e = o.find((x) => x.id === 'elder');
  assert.equal(e.spawnAt, 1210 + 360); assert.match(e.note, /Seele: Gegner/);
  // Baron-Kill bei 26:00 → nächster 32:00, Buff bis 29:00; eigene Startzeiten aus den Einstellungen
  o = objectives([{ EventName: 'BaronKill', EventTime: 1560, KillerName: 'Ich' }], players, 1600, 'ORDER', { dragon: 330 });
  const b = o.find((x) => x.id === 'baron');
  assert.equal(b.spawnAt, 1920); assert.match(b.note, /29:00/);
  assert.equal(objectives([], players, 0, 'ORDER', { dragon: 330 }).find((x) => x.id === 'dragon').spawnAt, 330);
});

test('LoL-Jungle-Analyse nach dem Spiel: gegnerischer Jungler, Ganks an mir, eigenes Jungling, Gold beim Tod', () => {
  const { analyzeGame, patterns } = require('../src/main/services/gaming/lolanalysis');
  const { jungleFacts } = require('../src/main/services/gaming/lolflow');
  // Gegnerischer Jungler = pid 7 (Team 200), startet oben (y > x), gankt mich in Minute 6 auf der Botlane
  const posFor = (pid, min) => (pid === 7 && min <= 6 ? { x: 4000, y: 11000 } : pid === 2 && min >= 5 && min <= 8 ? { x: 13000, y: 3000 } : null);
  const extra = [
    { type: 'CHAMPION_KILL', timestamp: 7 * 60000, victimId: 8, killerId: 2, assistingParticipantIds: [4], position: { x: 12800, y: 2500 } },
    { type: 'WARD_PLACED', timestamp: 3 * 60000, creatorId: 4, wardType: 'YELLOW_TRINKET' },
    { type: 'WARD_PLACED', timestamp: 9 * 60000, creatorId: 4, wardType: 'CONTROL_WARD' },
    { type: 'ITEM_PURCHASED', timestamp: 60000, participantId: 4, itemId: 1055 },
    { type: 'ITEM_PURCHASED', timestamp: 8.4 * 60000, participantId: 4, itemId: 3031 },
  ];
  const deaths = [{ min: 6, pos: { x: 12800, y: 2500 }, assists: [7] }, { min: 11, pos: { x: 9000, y: 5800 } }];
  const names = { 107: 'Lee Sin', 109: 'Caitlyn', 102: 'Vi', 222: 'Jinx' };
  const { game, timeline } = fullGame(1, { deaths, posFor, extra, gold: 1500 });
  const a = analyzeGame(game, timeline, 'me', { name: (id) => names[id] || null });
  assert.equal(a.v, 2);
  assert.deepEqual(a.deathsDetail.map((d) => [d.min, d.jungler, d.gold]), [[6, true, 1500], [11, false, 1500]]);
  assert.deepEqual(a.deathsDetail[0].by.sort(), ['Caitlyn', 'Lee Sin']);
  assert.equal(a.enemyJungle.champion, 'Lee Sin');
  assert.equal(a.enemyJungle.earlySide, 'top');
  assert.equal(a.enemyJungle.ganksOnMe, 1); assert.equal(a.enemyJungle.firstGank.min, 6); assert.equal(a.enemyJungle.firstGank.victim, 'Jinx');
  assert.equal(a.highGoldDeaths, 2);
  assert.equal(a.wardsBefore14, 2); assert.equal(a.controlWardsPlaced, 1);
  assert.equal(a.firstBackMin, 8.4, 'Startkauf in Minute 1 zählt nicht als Rückkehr');
  assert.equal(a.jungle, undefined, 'eigene Jungle-Werte nur, wenn ich Jungle spiele');
  // Dasselbe Spiel aus Sicht des eigenen Junglers (pid 2, Vi)
  const j = analyzeGame(game, timeline, 'p2', { name: (id) => names[id] || null });
  assert.equal(j.role, 'JUNGLE');
  assert.equal(j.jungle.gankKillsBefore14, 1);
  assert.ok(j.jungle.laneVisitsBefore14.Botlane >= 3, JSON.stringify(j.jungle.laneVisitsBefore14));
  assert.equal(j.jungle.jungleCsAt10, 0);
  // Nachbesprechung: Fakten nur aus der Analyse
  const f = jungleFacts(a).join('\n');
  assert.match(f, /Lee Sin war in Min\. 3–6 auf der oberen Seite/);
  assert.match(f, /erster erfolgreicher Gank 6\. Min\. \(Botlane, Jinx\)/);
  assert.match(f, /Erster Einkauf nach dem Start: 8\.4\. Min\. · 2 Wards/);
  // Muster über mehrere Spiele
  const list = [1, 2, 3, 4].map((i) => analyzeGame(...Object.values(fullGame(i, { deaths, posFor, extra, gold: 1500 })), 'me', { name: (id) => names[id] || null }));
  const p = patterns(list);
  const ids = p.findings.map((x) => x.id);
  assert.ok(ids.includes('ganked'), ids.join(','));
  assert.ok(ids.includes('gold-deaths'), ids.join(','));
  assert.equal(p.averages.gankDeathPct, 50);
});

test('LoL live: neutrale Werte statt Anweisungen, Kill-Stand + eigene Tode, Notizen im Spiel fließen in die Analyse', async () => {
  const { liveContext } = require('../src/main/services/gaming/league');
  const { core, cleanup } = tempCore();
  try {
    const L = core.gaming.league;
    core.settings.update({ gaming: { lolLiveCoach: true } });
    const tips = L.liveTips({ seconds: 900, csPerMin: 5.1, cs: 77, position: 'BOTTOM', level: 8, gold: 2600, deaths: 6, ward: 4, opponent: { champion: 'Caitlyn', level: 10, cs: 95 } });
    assert.ok(tips.length >= 2, JSON.stringify(tips));
    assert.ok(tips.some((t) => /CS 77 gegen 95 \(-18\)/.test(t)), JSON.stringify(tips));
    assert.ok(tips.some((t) => /Level 8 gegen 10/.test(t)));
    for (const t of tips) assert.doesNotMatch(t, /recall|kauf|geh |Risiko|ward(s)? setzen|Ganken|jetzt/i, 'keine Anweisungen im Spiel: ' + t);

    const me = { riotId: 'BoZ#EUW', championName: 'Jinx', team: 'ORDER', position: 'BOTTOM' };
    const players = [me, { riotId: 'A#1', championName: 'Lee Sin', team: 'CHAOS', position: 'JUNGLE' }, { riotId: 'B#2', championName: 'Caitlyn', team: 'CHAOS', position: 'BOTTOM' }, { riotId: 'C#3', championName: 'Vi', team: 'ORDER', position: 'JUNGLE' }];
    const ev = [
      { EventName: 'ChampionKill', EventTime: 362, KillerName: 'B', VictimName: 'BoZ', Assisters: ['A'] },
      { EventName: 'ChampionKill', EventTime: 420, KillerName: 'C', VictimName: 'B', Assisters: ['BoZ'] },
      { EventName: 'DragonKill', EventTime: 500 },
    ];
    const c = liveContext(ev, players, me);
    assert.deepEqual(c.score, { us: 1, them: 1 });
    assert.deepEqual(c.myDeaths, [{ min: 6, by: ['Caitlyn', 'Lee Sin'], jungler: true }]);

    L.lastLive = { seconds: 754, champion: 'Jinx' };
    const out = await core.orchestrator.execute('lol_note', { text: 'Lee Sin kam zweimal bot über den Fluss' }, { conversationId: 'x', channel: 'voice' });
    const r = out.response;
    assert.equal(r.saved, true); assert.equal(r.gameTime, '12:34');
    const start = new Date(Date.now() - 20 * 60000).toISOString();
    assert.equal(L.liveNotes(start).length, 1);
    assert.deepEqual(L.notesFor({ playedAt: start, durationMin: 25 }).map((n) => n.text), ['Lee Sin kam zweimal bot über den Fluss']);
    assert.deepEqual(L.notesFor({ playedAt: new Date(Date.now() - 5 * 3600_000).toISOString(), durationMin: 30 }), [], 'Notizen gehören nur zum passenden Spiel');
    assert.throws(() => L.addLiveNote('  '), /Leere Notiz/);
  } finally { cleanup(); }
});
