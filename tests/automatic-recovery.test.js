'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { LiveVoice } = require('../src/main/voice/live');
const { LolFlow } = require('../src/main/services/gaming/lolflow');
const { TarkovMaps } = require('../src/main/services/gaming/tarkovmaps');
const { League } = require('../src/main/services/gaming/league');

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function voiceHarness(connect) {
  const messages = [], sessions = [], callbacks = [];
  const s = {
    bus: new EventEmitter(), settings: { get: () => ({}), update: () => {} },
    conversations: { get: id => ({ id, privacy: 'gaming' }), history: () => [], add: (id, m) => messages.push({ id, ...m }) },
    orchestrator: { declarations: () => [{ functionDeclarations: [] }], system: () => '', execute: async () => ({ response: { ok: true } }) },
    gemini: { hasKey: () => true, model: () => null, requireModel: () => 'test', client: () => ({ live: { connect: async opts => {
      callbacks.push(opts.callbacks);
      const session = { closed: false, responses: [], close() { this.closed = true; }, sendToolResponse(r) { this.responses.push(r); } };
      sessions.push(session);
      if (connect) await connect();
      return session;
    } } }) },
  };
  return { voice: new LiveVoice(s), s, messages, sessions, callbacks };
}

test('stopping a pending voice connection closes its late result without reopening audio', async () => {
  const gate = deferred(); const { voice, sessions } = voiceHarness(() => gate.promise);
  const pending = voice.start({ conversationId: 'a', cloudAudioApproved: true });
  voice.stop(); gate.resolve(); await pending;
  assert.equal(voice.state, 'off'); assert.equal(voice.session, null); assert.equal(sessions[0].closed, true);
});

test('callbacks from a replaced voice session cannot close or write into the next conversation', async () => {
  const { voice, callbacks, sessions, messages } = voiceHarness();
  try {
    await voice.start({ conversationId: 'a', cloudAudioApproved: true });
    voice.handle = 'old-private-context'; voice.stop({ standby: true });
    await voice.start({ conversationId: 'b', cloudAudioApproved: true });
    assert.equal(voice.handle, null);
    callbacks[0].onclose({ code: 1000 });
    callbacks[0].onmessage({ serverContent: { inputTranscription: { text: 'stale' }, turnComplete: true } });
    assert.equal(voice.session, sessions[1]); assert.deepEqual(messages, []);
  } finally { voice.stop(); }
});

test('a failing voice tool returns an error and does not swallow later tool responses', async () => {
  const { voice, s, sessions } = voiceHarness();
  s.orchestrator.execute = async name => { if (name === 'broken') throw Error('tool unavailable'); return { response: { ok: true } }; };
  try {
    await voice.start({ conversationId: 'a', cloudAudioApproved: true });
    await voice.onToolCall([{ id: '1', name: 'broken' }, { id: '2', name: 'working' }]);
    const responses = sessions[0].responses[0].functionResponses;
    assert.equal(responses.length, 2); assert.ok(responses[0].response.error); assert.equal(responses[1].response.ok, true);
    assert.equal(voice.pendingTools, 0);
  } finally { voice.stop(); }
});

test('a tool finishing after a chat switch answers no new voice session', async () => {
  const gate = deferred(); const { voice, s, sessions, messages } = voiceHarness();
  s.orchestrator.execute = async () => { await gate.promise; return { card: { title: 'old' }, response: {} }; };
  try {
    await voice.start({ conversationId: 'a', cloudAudioApproved: true });
    const pending = voice.onToolCall([{ id: '1', name: 'slow' }]);
    voice.stop(); await voice.start({ conversationId: 'b', cloudAudioApproved: true });
    gate.resolve(); await pending;
    assert.deepEqual(sessions[1].responses, []); assert.equal(messages[0].id, 'a');
  } finally { voice.stop(); }
});

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

test('Gaming voice exposes usable LoL tools without the private system primer', () => {
  const { voice, s } = voiceHarness();
  voice.conversationId = 'a';
  s.orchestrator.system = () => { throw Error('must not collect private memory'); };
  s.orchestrator.declarations = () => [{ functionDeclarations: ['league_live', 'voice_standby', 'list_events'].map(name => ({ name })) }];
  const config = voice.config();
  const names = config.tools[0].functionDeclarations.map(t => t.name);
  assert.ok(names.includes('league_live')); assert.ok(names.includes('voice_standby')); assert.ok(!names.includes('list_events'));
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


test('speaking forever cannot defer Standby past the original deadline', async () => {
  const { voice } = voiceHarness();
  await voice.start({ conversationId: 'a', cloudAudioApproved: true });
  voice.setState('speaking');
  assert.equal(voice.requestStandby({ quick: true }).ok, true);
  assert.equal(voice.standbyPending, true);
  voice.enterStandby(); // early callback while speaking: still allowed to finish
  assert.equal(voice.standbyPending, true);
  assert.equal(voice.state, 'speaking');
  voice.standbyDeadline = Date.now() - 1; // the original deadline has elapsed
  voice.enterStandby();
  assert.equal(voice.state, 'standby');
  assert.equal(voice.session, null);
  assert.equal(voice.standbyPending, false);
  assert.equal(voice.standbyTimer, null);
  await voice.start({ conversationId: 'a', cloudAudioApproved: true });
  assert.equal(voice.state, 'listening', 'a new session is not blocked by stale Standby');
  voice.stop();
});

test('manual Voice stop discards pending standby and old callback state', async () => {
  const { voice } = voiceHarness();
  await voice.start({ conversationId: 'a', cloudAudioApproved: true });
  voice.requestStandby({ quick: true });
  voice.stop();
  assert.equal(voice.standbyPending, false);
  assert.equal(voice.standbyDeadline, 0);
  voice.enterStandby();
  assert.equal(voice.state, 'off');
  await voice.start({ conversationId: 'b', cloudAudioApproved: true });
  voice.enterStandby();
  assert.equal(voice.state, 'listening');
  voice.stop();
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
