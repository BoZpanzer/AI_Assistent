'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tempCore } = require('./helpers');

test('LoL recent matches return saved results with explicit stale status when client unavailable', async () => {
  const { core, cleanup } = tempCore();
  try {
    const L = core.gaming.league;
    core.db.run('INSERT INTO lol_matches(match_id,puuid,played_at,summary) VALUES(?,?,?,?)',
      'EUW1_123', 'player', '2026-10-01T18:00:00.000Z',
      JSON.stringify({ matchId: 'EUW1_123', champion: 'Jinx', win: true, kills: 5, deaths: 2, assists: 8 }));
    L.clientStatus = async () => ({ connected: false, code: 'not-found', reason: 'League-Client nicht gefunden' });
    assert.equal(L.hasKey(), false);
    const old = await L.recentMatches({ count: 5, refresh: true });
    assert.equal(old.count, 1);
    assert.equal(old.matches[0].champion, 'Jinx');
    assert.equal(old.fresh, false);
    assert.match(old.source, /gespeichert/);
    assert.match(old.warning, /League-Client/);
    assert.equal(old.status.code, 'not-found');
    const cachedOnly = await L.recentMatches({ count: 5, refresh: false });
    assert.equal(cachedOnly.count, 1);
    assert.equal(cachedOnly.fresh, false);
  } finally { cleanup(); }
});

test('LLM cloud tool shows consent requirement, then real cached matches; private mode never refreshes', async () => {
  const { core, cleanup } = tempCore();
  try {
    const L = core.gaming.league;
    let requests = [];
    L.recentMatches = async (opts) => {
      requests.push(opts);
      return { matches: [{ matchId: 'EUW1_999', champion: 'Ahri', win: true }], fresh: false, lastSync: null, source: 'lokal gespeichert' };
    };
    const gaming = core.conversations.create('Gaming', 'gaming');
    const blocked = await core.orchestrator.execute('league_recent_matches', { count: 5 }, { conversationId: gaming.id });
    assert.match(blocked.response.error, /freigegeben/);
    assert.equal(requests.length, 0);
    core.settings.update({ gaming: { lolCloudShare: true } });
    const allowed = await core.orchestrator.execute('league_recent_matches', { count: 3 }, { conversationId: gaming.id });
    assert.equal(allowed.response.matches[0].champion, 'Ahri');
    assert.deepEqual(requests.at(-1), { count: 3, refresh: true });
    const privateChat = core.conversations.create('Privat', 'private');
    const cached = await core.orchestrator.execute('league_recent_matches', {}, { conversationId: privateChat.id });
    assert.equal(cached.response.matches[0].champion, 'Ahri');
    assert.equal(requests.at(-1).refresh, false, 'private conversation never triggers remote Riot API');
  } finally { cleanup(); }
});

test('missing client credentials are checked again rapidly after initial negative cache', async () => {
  const { core, cleanup } = tempCore();
  try {
    const L = core.gaming.league;
    L._lcu = { at: Date.now() - 3000, creds: null };
    const seen = [];
    L.lcuFromProcess = async () => { seen.push(1); return null; };
    const c = await L.lcuCreds();
    assert.equal(c, null);
    if (process.platform === 'win32') assert.ok(seen.length > 0);
  } finally { cleanup(); }
});
