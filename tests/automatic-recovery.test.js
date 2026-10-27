'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { LolFlow } = require('../src/main/services/gaming/lolflow');
const { TarkovMaps } = require('../src/main/services/gaming/tarkovmaps');
const { League } = require('../src/main/services/gaming/league');

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('LoL keeps game context across temporary API outages and reconnect before scheduling review', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let phase = 'InProgress'; const reviews = [];
  const s = { bus: new EventEmitter(), settings: { get: () => ({}) }, gaming: { league: { lcuGet: async p => {
    if (p.endsWith('gameflow-phase')) { if (phase === null) throw Error('offline'); return phase; }
    return { gameData: { gameId: 123 } };
  } } } };
  const flow = new LolFlow(s); flow.afterGame = async id => reviews.push(id);
  try {
    await flow.tick(); phase = null; await flow.tick(); assert.equal(flow.phase, 'InProgress');
    phase = 'Reconnect'; await flow.tick(); phase = 'EndOfGame'; await flow.tick();
    t.mock.timers.tick(15000); assert.deepEqual(reviews, [123]);
    flow.lastSelectKey = 'old'; flow.gameId = 456; flow.stop();
    assert.equal(flow.lastSelectKey, ''); assert.equal(flow.gameId, null);
  } finally { flow.dispose(); }
});

test('stopping LoL cancels a scheduled review', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const flow = new LolFlow({ bus: new EventEmitter(), settings: { get: () => ({}) }, gaming: { league: { lcuGet: async () => 'EndOfGame' } } });
  let reviews = 0; flow.afterGame = async () => { reviews++; };
  flow.phase = 'InProgress'; flow.gameId = 123;
  await flow.tick(); flow.dispose(); t.mock.timers.tick(15000); assert.equal(reviews, 0);
});

test('negative League discovery expires promptly when a client starts later', async () => {
  const L = new League({ settings: { get: () => ({}) } });
  L._lcu = { at: Date.now() - 4000, creds: null };
  await L.lcuCreds();
  assert.ok(Date.now() - L._lcu.at < 1000);
});

test('map imports deduplicate identical jobs but preserve different requested maps', async () => {
  const maps = new TarkovMaps({}, {}), gate = deferred(), seen = [];
  maps._import = async opts => { seen.push(opts.only); await gate.promise; return { done: [opts.only] }; };
  const a = maps.importAll({ only: 'customs' });
  assert.equal(maps.importAll({ only: 'customs' }), a);
  const b = maps.importAll({ only: 'woods' });
  gate.resolve();
  assert.deepEqual((await a).done, ['customs']); assert.deepEqual((await b).done, ['woods']);
  assert.deepEqual(seen, ['customs', 'woods']);
});

test('Gaming LoL tools execute, while private tools and Study access remain restricted', async () => {
  const { tempCore } = require('./helpers');
  const { core, cleanup } = tempCore();
  try {
    const gaming = core.conversations.create('LoL', 'gaming'), study = core.conversations.create('Uni', 'study');
    core.settings.update({ gaming: { lolCloudShare: true } });
    core.gaming.league.live = async () => ({ connected: true, champion: 'Jinx' });
    const r = await core.orchestrator.execute('league_live', {}, { conversationId: gaming.id, channel: 'voice' });
    assert.equal(r.response.champion, 'Jinx');
    assert.ok((await core.orchestrator.execute('league_live', {}, { conversationId: study.id })).response.error);
    assert.ok((await core.orchestrator.execute('list_events', {}, { conversationId: gaming.id })).response.error);
  } finally { cleanup(); }
});

test('changing game context keeps Tarkov background services running; shutdown stops them', () => {
  const { tempCore } = require('./helpers'); const { core, cleanup } = tempCore();
  let logs = 0, raid = 0;
  core.gaming.eftLogs.stop = () => { logs++; }; core.gaming.eftRaid.stop = () => { raid++; };
  core.bus.emit('game:context', { active: { id: 'eft' } });
  assert.equal(logs, 0); assert.equal(raid, 0);
  cleanup(); assert.equal(logs, 1); assert.equal(raid, 1);
});

test('automatic Wiki calibration rejects missing and non-finite quality evidence', () => {
  const { tempCore } = require('./helpers'); const { core, cleanup } = tempCore();
  try {
    const g = core.gaming; g.tarkovMaps.importWiki();
    g.context.setState('calib:eft:customs', { affine: [1,0,0,0,1,0] });
    for (const quality of [{}, { inliers: 12, candidates: 12, spread: NaN, medianError: 0 }, { inliers: 12, candidates: 100, spread: .5, medianError: 0 }]) {
      assert.throws(() => g.tarkovMaps.saveWikiAlignment('customs-wiki', { affine: [1,0,0,0,1,0], quality }), /nicht ausreichend/);
    }
    assert.equal(g.context.getState('calib:eft:customs-wiki'), null);
  } finally { cleanup(); }
});


test('stopping League during in-flight phase response never schedules post-game review', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const gate = deferred(); const bus = new EventEmitter(); const reviewed = [];
  const flow = new LolFlow({
    bus, settings: { get: () => ({}) }, gaming: { league: { lcuGet: async () => gate.promise } },
  });
  flow.phase = 'InProgress'; flow.gameId = 123;
  flow.afterGame = async (id) => reviewed.push(id);
  const pending = flow.tick();
  flow.stop();
  gate.resolve('EndOfGame'); await pending;
  t.mock.timers.tick(15000);
  assert.deepEqual(reviewed, []);
  assert.equal(flow.reviewPending, null);
  assert.equal(flow.phase, null);
  flow.dispose();
});

test('stale League session answer cannot restore gameId after stop or restart', async () => {
  const gate = deferred(); let sessionRequests = 0;
  const bus = new EventEmitter();
  const flow = new LolFlow({
    bus, settings: { get: () => ({}) },
    gaming: { league: { lcuGet: async p => {
      if (p.endsWith('gameflow-phase')) return 'InProgress';
      sessionRequests++; return gate.promise;
    } } },
  });
  const first = flow.tick();
  while (sessionRequests === 0) await Promise.resolve();
  flow.stop();
  gate.resolve({ gameData: { gameId: 999 } }); await first;
  assert.equal(flow.gameId, null);
  assert.equal(flow.busy, false, 'stale requests do not block future polling');
  flow.dispose();
});

test('stopping League while an afterGame request is pending prevents automatic review', async () => {
  const gate = deferred(), bus = new EventEmitter();
  let stored = 0, reviewed = 0;
  const flow = new LolFlow({
    bus, settings: { get: () => ({}) },
    gaming: { league: {
      lcuGet: async p => p.includes('current-summoner') ? gate.promise : { gameId: 444 },
      clientGame: async () => { stored++; return { gameDuration: 90, participants: [{}] }; },
      storeClientGame: async () => ({ matchId: '444' }),
    } },
  });
  flow.review = async () => { reviewed++; };
  const pending = flow.afterGame(444, { tries: 1, delayMs: 0 });
  flow.stop();
  gate.resolve({ puuid: 'player' }); await pending;
  assert.equal(stored, 0);
  assert.equal(reviewed, 0);
  flow.dispose();
});

test('disposed League flow cannot be restarted by late client or settings events', () => {
  const bus = new EventEmitter();
  const flow = new LolFlow({
    bus, settings: { get: () => ({}) },
    gaming: { context: { leagueClient: true }, league: { lcuGet: async () => 'None' } },
  });
  flow.dispose();
  bus.emit('game:client', { league: true });
  bus.emit('settings:changed', { keys: ['gaming'] });
  assert.equal(flow.timer, null);
});
