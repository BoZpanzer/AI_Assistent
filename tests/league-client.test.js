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
