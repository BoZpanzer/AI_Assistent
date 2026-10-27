'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tempCore, fakeSdk } = require('./helpers');
const { priceFor, costUsd } = require('../src/main/services/costguard');
const { localPronunciation } = require('../src/main/voice/speech');

const MODELS = ['gemini-3.8-flash', 'gemini-2.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash-lite-tts', 'gemini-3.1-pro-preview', 'gemini-embedding-2'];
const champs = { Sett: '875', Aatrox: '266', Malphite: '54', Leona: '89', Sivir: '15', Kayn: '141', Syndra: '134', Draven: '119', Thresh: '412', Ahri: '103', Nautilus: '111', Braum: '201' };
const ddragon = async (url) => {
  if (url.endsWith('versions.json')) return new Response(JSON.stringify(['16.20.1']));
  if (url.includes('/champion.json')) return new Response(JSON.stringify({ data: Object.fromEntries(Object.entries(champs).map(([n, k]) => [n, { id: n, key: k, name: n, tags: ['Fighter'] }])) }));
  const m = url.match(/champion\/(\w+)\.json/); if (m) return new Response(JSON.stringify({ data: { [m[1]]: { id: m[1], name: m[1], enemytips: [`Riot-Tipp gegen ${m[1]}`], spells: [], passive: { name: 'P', description: '' } } } }));
  throw new Error('offline');
};

test('Prices: old 2.5 Flash-Lite models are known (no Pro fallback price)', () => {
  assert.equal(priceFor('gemini-2.5-flash-lite').out, 0.40);
  assert.equal(priceFor('gemini-2.5-flash').out, 2.5);
  assert.ok(costUsd('gemini-2.5-flash-lite', { in: 2000, out: 500 }) < costUsd('gemini-3.8-flash', { in: 2000, out: 500 }) / 5, 'Sparmodell deutlich günstiger');
});

test('Economy: short tasks use the cheapest Flash-Lite; free key first, paid key after its quota', async () => {
  const sdk = fakeSdk([{ text: '{"enemies":[]}' }, { text: '{"enemies":[]}' }], { models: MODELS });
  const keys = [];
  const Orig = sdk.sdk.GoogleGenAI;
  sdk.sdk.GoogleGenAI = class extends Orig { constructor(o) { super(o); const gc = this.models.generateContent; this.models.generateContent = async (req) => { keys.push(o.apiKey); if (o.apiKey === 'FREE' && keys.filter((k) => k === 'FREE').length > 1) throw Object.assign(new Error('429 RESOURCE_EXHAUSTED quota PerDay'), { status: 429 }); return gc(req); }; } };
  const { core, cleanup } = tempCore({ genaiSdk: sdk.sdk });
  try {
    core.secrets.set('gemini.api_key', 'PAID'); await core.gemini.discover();
    core.secrets.set('gemini.free_api_key', 'FREE');
    await core.gemini.generate({ feature: 'lol', tier: 'lite', json: true, contents: [{ role: 'user', parts: [{ text: 'a' }] }] });
    assert.equal(sdk.requests.at(-1).model, 'gemini-2.5-flash-lite');
    assert.deepEqual(keys, ['FREE']);
    const before = core.db.get('SELECT COUNT(*) c FROM ai_ledger').c;
    assert.equal(before, 0, 'kostenloses Kontingent kostet nichts');
    await core.gemini.generate({ feature: 'lol', tier: 'lite', json: true, contents: [{ role: 'user', parts: [{ text: 'b' }] }] });
    assert.deepEqual(keys, ['FREE', 'FREE', 'PAID'], 'Limit erreicht → normaler Schlüssel');
    assert.equal(core.db.get('SELECT COUNT(*) c FROM ai_ledger').c, 1);
    // Sparmodell ausgeschaltet → Flash
    core.settings.update({ cloud: { economy: false } });
    sdk.script.push({ text: '{}' });
    await core.gemini.generate({ feature: 'lol', tier: 'lite', json: true, contents: [{ role: 'user', parts: [{ text: 'c' }] }] });
    assert.equal(sdk.requests.at(-1).model, 'gemini-3.8-flash');
  } finally { cleanup(); }
});

test('Local voice: English gaming terms get a German-readable spelling', () => {
  const t = localPronunciation('Der Jungler gankt die Toplane, setz Wards vor dem Raid und den Quests.');
  assert.match(t, /Dschungler/); assert.match(t, /Topp-Lehn/); assert.match(t, /Wohrds/); assert.match(t, /Reid/); assert.match(t, /Kwests/);
});

test('LoL: tips against every enemy champion (one cheap call, cached per patch), Riot tips without cloud', async () => {
  const resp = { enemies: [{ champion: 'Draven', danger: 'Spinning Axes (Q): hoher Burst', tips: ['Nicht dort stehen, wo er die Äxte fängt', 'Früh Druck, er braucht Gold'] }, { champion: 'Thresh', danger: 'Death Sentence (Q)', tips: ['Hinter Vasallen bleiben'] }] };
  const sdk = fakeSdk([{ text: JSON.stringify(resp) }], { models: MODELS });
  const { core, cleanup } = tempCore({ fetch: ddragon, genaiSdk: sdk.sdk });
  try {
    core.secrets.set('gemini.api_key', 'PAID'); await core.gemini.discover();
    const F = core.gaming.lolflow;
    const t = await F.enemyTips({ enemies: ['Draven', 'Thresh', 'Ahri'] });
    assert.deepEqual(t.map((x) => [x.champion, x.source]), [['Draven', 'ki'], ['Thresh', 'ki'], ['Ahri', 'riot']]);
    assert.equal(sdk.requests.length, 1); assert.equal(sdk.requests[0].model, 'gemini-2.5-flash-lite');
    // zweites Spiel mit denselben Gegnern: kein neuer Aufruf
    sdk.script.push({ text: '{"enemies":[]}' });
    await F.enemyTips({ enemies: ['Draven', 'Thresh'] });
    assert.equal(sdk.requests.length, 1);
    // im Spiel: aus dem Speicher (nicht blockierend)
    F.liveEnemyTips(['Draven', 'Thresh']); await new Promise((r) => setTimeout(r, 30));
    assert.equal(F.liveEnemyTips(['Draven', 'Thresh']).length, 2);
  } finally { cleanup(); }
});

test('LoL: champion recommendation from own pool, own record vs these enemies, taken/banned excluded, AI picks only from pool', async () => {
  const sdk = fakeSdk([{ text: JSON.stringify({ picks: [{ champion: 'Braum', reason: 'Schild gegen Dravens Äxte' }, { champion: 'Pyke', reason: 'nicht im Pool' }, { champion: 'Leona', reason: 'Engage gegen immobile Botlane' }] }) }], { models: MODELS });
  const { core, cleanup } = tempCore({ fetch: ddragon, genaiSdk: sdk.sdk });
  try {
    core.secrets.set('gemini.api_key', 'PAID'); await core.gemini.discover();
    const L = core.gaming.league; let n = 0;
    const put = (champ, win, vs) => { const mid = 'EUW1_' + (++n); core.db.run("INSERT INTO lol_matches(match_id,puuid,played_at,summary) VALUES(?,'me',?,?)", mid, new Date(Date.now() - n * 1e6).toISOString(), JSON.stringify({ win, champion: champ, role: 'UTILITY' })); if (vs) L.setDeep(mid, { matchId: mid, hasTimeline: true, v: 3, win, champion: champ, opponent: { champion: vs } }); };
    for (let i = 0; i < 6; i++) put('Leona', i < 3);
    for (let i = 0; i < 4; i++) put('Braum', true, i < 2 ? 'Draven' : null);
    for (let i = 0; i < 5; i++) put('Nautilus', i < 2);
    put('Malphite', true); put('Thresh', true);
    const r = await core.gaming.lolflow.recommend({ role: 'Support', enemies: ['Draven', 'Thresh', 'Ahri'], allies: ['Sivir'], unavailable: ['Nautilus'] });
    assert.equal(r.onRole, true);
    assert.equal(r.candidates[0].champion, 'Braum', '4/4 Siege, 2/2 gegen Draven');
    assert.deepEqual(r.candidates[0].vs, [{ enemy: 'Draven', wins: 2, games: 2 }]);
    assert.ok(!r.candidates.some((c) => ['Nautilus', 'Thresh'].includes(c.champion)), 'gebannt bzw. beim Gegner vergeben');
    assert.deepEqual(r.ai.picks.map((p) => p.champion), ['Braum', 'Leona'], 'KI darf nur Champions aus dem Pool nennen');
    assert.equal(sdk.requests[0].model, 'gemini-2.5-flash-lite');
    // nur wählbare Champions
    const r2 = await core.gaming.lolflow.recommend({ role: 'Support', enemies: ['Draven'], pickable: new Set(['Leona']) });
    assert.deepEqual(r2.candidates.map((c) => c.champion), ['Leona']);
  } finally { cleanup(); }
});

