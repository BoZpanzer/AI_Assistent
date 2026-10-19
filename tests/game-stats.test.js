'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { tempCore } = require('./helpers');
const { createCore } = require('../src/main/app-core');
const { localDay } = require('../src/main/services/costguard');

test('Tarkov stats: empty data are unknown, not zero', () => {
  const { core, cleanup } = tempCore();
  try {
    const s = core.gaming.stats.tarkov('today');
    assert.equal(s.raids, 0); assert.equal(s.survivalRate, null); assert.equal(s.pmcKills, null); assert.equal(s.kd, null);
    assert.match(core.gaming.stats.answer('Wie ist meine Überlebensrate heute?').text, /keine Tarkov-Raids erfasst/);
  } finally { cleanup(); }
});

test('Tarkov stats: log raids are deduplicated, results are entered manually, K/D only with deaths', () => {
  const { core, cleanup } = tempCore();
  try {
    const st = core.gaming.stats;
    const now = new Date().toISOString();
    assert.ok(st.raidStarted({ raidId: 'ABC123', map: 'customs', type: 'pmc', at: now }));
    assert.equal(st.raidStarted({ raidId: 'ABC123', map: 'customs', type: 'pmc', at: now }), null, 'same log line twice → one raid');
    st.raidEnded({ raidId: 'ABC123' });
    // fills the last log raid without result
    const r = st.recordRaid({ outcome: 'survived', pmcKills: 2, aiKills: 5 });
    assert.equal(r.source, 'log'); assert.equal(r.manualResult, true);
    let s = st.tarkov('today');
    assert.equal(s.raids, 1); assert.equal(s.survivalRate, 100); assert.equal(s.kd, null); assert.equal(s.kdNote, 'keine Tode');
    st.recordRaid({ outcome: 'died', pmcKills: 1 }); // no open log raid → manual raid
    st.raidStarted({ raidId: 'XYZ999', map: 'woods', type: 'scav', at: new Date().toISOString() }); // raid without result
    s = st.tarkov('today');
    assert.equal(s.raids, 3); assert.equal(s.withOutcome, 2); assert.equal(s.unknownOutcome, 1);
    assert.equal(s.survivalRate, 50, 'raids without result do not count');
    assert.equal(s.deaths, 1); assert.equal(s.pmcKills, 3); assert.equal(s.aiKills, 5); assert.equal(s.kd, 3);
    assert.equal(s.manual, 2);
    // correction by id and removal
    const died = s.recent.find((x) => x.outcome === 'died');
    st.recordRaid({ id: died.id, outcome: 'runthrough' });
    assert.equal(st.tarkov('today').survivalRate, 100);
    assert.ok(st.remove(died.id));
    assert.equal(st.tarkov('today').raids, 2);
    assert.throws(() => st.recordRaid({ outcome: 'won' }), /Unbekanntes/);
    assert.throws(() => st.recordRaid({ outcome: 'died', pmcKills: -1 }), /ganze Zahl/);
  } finally { cleanup(); }
});

test('Tarkov stats: day boundary (local time), totals and persistence across restart', () => {
  const { core, dir } = tempCore();
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); yesterday.setHours(23, 59, 0, 0);
  core.gaming.stats.raidStarted({ raidId: 'OLD001', map: 'factory', at: yesterday.toISOString() });
  core.gaming.stats.recordRaid({ id: core.gaming.stats.tarkov('total').recent[0].id, outcome: 'died' });
  core.gaming.stats.recordRaid({ outcome: 'survived' }); // today, manual
  assert.equal(core.gaming.stats.tarkov('today').raids, 1);
  assert.equal(core.gaming.stats.tarkov('total').raids, 2);
  assert.equal(localDay(yesterday) < localDay(new Date()), true);
  core.stop();
  const again = createCore({ dataDir: dir, version: '3.0.0', fetch: async () => { throw new Error('offline'); } });
  try {
    assert.equal(again.gaming.stats.tarkov('total').raids, 2);
    assert.equal(again.gaming.stats.tarkov('total').survivalRate, 50);
  } finally { again.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Spoken/typed stats questions are answered without any model call', async () => {
  const { core, fake, cleanup } = tempCore();
  try {
    core.secrets.set('gemini.api_key', 'AIza-test-key-123456789'); await core.gemini.discover();
    const conv = core.conversations.create('Gaming', 'gaming');
    let m = await core.orchestrator.chat({ conversationId: conv.id, text: 'Raid überlebt mit 3 Kills und 4 Scavs' });
    assert.match(m.content, /Eingetragen: Raid überlebt, 3 PMC-Kills, 4 KI-Kills/);
    m = await core.orchestrator.chat({ conversationId: conv.id, text: 'Wie ist meine Überlebensrate heute?' });
    assert.match(m.content, /Überlebensrate 100 %/);
    m = await core.orchestrator.chat({ conversationId: conv.id, text: 'Wie viele Kills habe ich heute in Tarkov?' });
    assert.match(m.content, /3 PMC-Kills, 4 KI-Kills/);
    m = await core.orchestrator.chat({ conversationId: conv.id, text: 'Wie ist meine Winrate in Tarkov?' });
    assert.match(m.content, /keine Winrate/);
    assert.equal(fake.requests.length, 0, 'no Gemini request for standard stats');
    // voice channel answers are spoken locally
    const spoken = []; core.bus.on('tts:speak', (d) => spoken.push(d.text));
    await core.orchestrator.chat({ conversationId: conv.id, text: 'Wie ist meine K/D heute?', channel: 'voice' });
    assert.equal(spoken.length, 1); assert.match(spoken[0], /K\/D: –/);
  } finally { cleanup(); }
});

test('LoL: wins, losses, winrate per period and counters from own analyzed games', () => {
  const { core, cleanup } = tempCore();
  try {
    const now = Date.now();
    const add = (i, champion, win, opp) => {
      const mid = 'EUW_' + i;
      core.db.run('INSERT INTO lol_matches(match_id,puuid,played_at,summary) VALUES(?,?,?,?)', mid, 'p', new Date(now - i * 60000).toISOString(), JSON.stringify({ matchId: mid, champion, win, kills: 5, deaths: 2, assists: 7 }));
      core.gaming.league.setDeep(mid, { matchId: mid, champion, win, opponent: { champion: opp } });
    };
    add(1, 'Jhin', true, 'Draven'); add(2, 'Jhin', false, 'Draven'); add(3, 'Caitlyn', true, 'Draven'); add(4, 'Jhin', false, 'Lucian'); add(5, 'Jhin', false, 'Lucian');
    const s = core.gaming.stats.lol('today');
    assert.equal(s.games, 5); assert.equal(s.wins, 2); assert.equal(s.losses, 3); assert.equal(s.winrate, 40); assert.equal(s.kda, 6);
    const c = core.gaming.stats.counters({ vs: 'draven' });
    assert.equal(c.overall.games, 3); assert.equal(c.bestPicks[0].champion, 'Caitlyn'); assert.equal(c.bestPicks[0].reliable, false);
    const hard = core.gaming.stats.counters();
    assert.equal(hard.hardest[0].champion, 'Lucian'); assert.equal(hard.hardest[0].winrate, 0);
    assert.match(core.gaming.stats.answer('Konter gegen Draven in LoL').text, /Gegen Draven: 2 von 3/);
    assert.match(core.gaming.stats.answer('Wie ist meine Winrate heute in LoL?').text, /2 Siege, 3 Niederlagen – Winrate 40 %/);
  } finally { cleanup(); }
});
