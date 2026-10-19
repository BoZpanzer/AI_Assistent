'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempCore } = require('./helpers');
const { Tarkov } = require('../src/main/services/gaming/tarkov');
const { GameCache } = require('../src/main/services/gaming/cache');

// Echte, gekürzte Dateien von json.tarkov.dev (Stand 19.10.2026)
const FIX = path.join(__dirname, 'fixtures', 'tarkov-json');
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => body, json: async () => JSON.parse(body) });
function fakeFetch(log = []) {
  return async (url, init) => {
    log.push(String(url));
    const u = String(url);
    if (u.startsWith('https://api.tarkov.dev/graphql')) return res(422, '{"errors":["GraphQL server unavailable. Try again later."]}');
    if (u.startsWith('https://api.tarkovtracker.org')) {
      if (u.endsWith('/token')) return res(200, JSON.stringify({ permissions: ['GP', 'WP'], gameMode: 'pvp' }));
      if (u.endsWith('/progress') && (!init || init.method === 'GET')) return res(200, JSON.stringify({ data: { tasksProgress: [{ id: '657315ddab5a49b71f098853', complete: true }], playerLevel: 12, displayName: 'BoZ' } }));
      if (u.includes('/progress/task/')) { log.push('POST ' + init.body); return res(200, '{}'); }
    }
    const m = u.match(/^https:\/\/json\.tarkov\.dev\/(regular|pve)\/([a-z_]+)$/);
    if (m) { const f = path.join(FIX, m[2] + '.json'); return fs.existsSync(f) ? res(200, fs.readFileSync(f, 'utf8')) : res(404, 'Not found'); }
    return res(404, 'Not found');
  };
}

test('JSON source: maps, tasks, hideout and traders work while GraphQL answers 422', async () => {
  const { core, cleanup } = tempCore();
  try {
    const calls = [];
    const t = new Tarkov({ fetch: fakeFetch(calls), gameCache: new GameCache(core.db) });
    const customs = (await t.map('customs', 'regular')).value;
    assert.equal(customs.name, 'Customs'); // deutscher Spielname laut tarkov.dev
    assert.ok(customs.extracts.length >= 1 && Number.isFinite(customs.extracts[0].position.x));
    assert.ok(customs.extracts.every((x) => !/^ex_/.test(x.name)), 'Exit-Namen übersetzt');
    assert.ok(customs.bosses.some((b) => b.boss.name && !/^boss/.test(b.boss.name)), 'Bossnamen übersetzt');
    assert.ok(customs.locks[0].key?.id);

    const tasks = (await t.tasks('regular')).value;
    const first = tasks.find((x) => x.id === '657315ddab5a49b71f098853');
    assert.equal(first.name, 'Der Erste in der Schlange');
    assert.equal(first.trader.name, 'Therapist');
    assert.ok(first.objectives[0].description.includes('Emercom'));
    assert.ok(first.objectives[0].maps.every((m) => m.normalizedName));

    const plan = await t.raidPlan({ gameMode: 'regular' });
    assert.ok(plan.detailed && plan.available >= 1 && plan.maps.length >= 1);
    const markers = await t.questMarkers('ground-zero', { gameMode: 'regular' });
    assert.ok(markers.markers.length >= 1);

    const hs = (await t.hideoutStations('regular')).value;
    assert.ok(hs.length > 10 && hs.every((s) => s.name && !/^hideout_area/.test(s.name)));
    const tr = (await t.traders('regular')).value;
    assert.ok(tr.some((x) => x.id === 'prapor' && x.resetTime));
    assert.ok(calls.every((u) => !u.includes('api.tarkov.dev')), 'GraphQL wird nicht gebraucht');
  } finally { cleanup(); }
});

test('JSON source down too: GraphQL outage message says "Störung" and is not treated as permanent', async () => {
  const { core, cleanup } = tempCore();
  try {
    const t = new Tarkov({ fetch: async (u) => (String(u).includes('json.tarkov.dev') ? res(503, 'down') : res(422, '{"errors":["GraphQL server unavailable. Try again later."]}')), gameCache: new GameCache(core.db) });
    await assert.rejects(() => t.maps('regular'), (e) => { assert.match(e.message, /Störung/); assert.ok(!e.permanent); return true; });
  } finally { cleanup(); }
});

test('TarkovTracker sync works again: quest names come from the JSON files, progress is applied', async () => {
  const calls = [];
  const { core, cleanup } = tempCore({ fetch: fakeFetch(calls), tarkovJson: true });
  try {
    await core.gaming.tracker.test('PVP_0123456789abcdef01');
    const r = await core.gaming.tracker.sync();
    assert.equal(r.done, 1); assert.equal(r.level, 12);
    assert.ok(core.gaming.progress.find('eft', 'quest', 'Der Erste in der Schlange'));
    // Lokal abgehakte Quest → Upload an TarkovTracker (Schreibrecht WP)
    core.gaming.progress.upsert('eft', { category: 'quest', name: 'Der Erste in der Schlange', status: 'done', source: 'chat' });
    core.gaming.progress.upsert('eft', { category: 'quest', name: core.gaming.tracker && (await core.gaming.tarkov.tasks('regular')).value.find((x) => x.id === '596a204686f774576d4c95de').name, status: 'done', source: 'log' });
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(calls.some((c) => c.startsWith('POST') && c.includes('completed')), 'Quest aus dem Log wird hochgeladen');
  } finally { cleanup(); }
});

test('Quests: only the ones you can do now (not done, level reached, predecessors done); "Alle" shows everything', async () => {
  const { core, cleanup } = tempCore();
  try {
    const t = new Tarkov({ fetch: fakeFetch(), gameCache: new GameCache(core.db) });
    const names = (r) => r.items.map((x) => x.id).sort();
    const base = { failed: new Set(), gameMode: 'regular' };
    // Level 1, nichts erledigt: nur die zwei Einstiegsquests ohne Vorgänger
    let r = await t.quests({ progress: { ...base, done: new Set(), level: 1 } });
    assert.deepEqual(names(r), ['657315ddab5a49b71f098853', '657315e4a6af4ab4b50f3459']);
    assert.equal(r.available, 2); assert.equal(r.onlyAvailable, true);
    // Level 7, erste Quest erledigt: die erledigte fällt weg, Level-7-Quest ohne Vorgänger kommt dazu; Quests mit offenem Vorgänger bleiben gesperrt
    const first = (await t.tasks('regular')).value.find((x) => x.id === '657315ddab5a49b71f098853').name;
    r = await t.quests({ progress: { ...base, done: new Set([first]), level: 7 } });
    assert.deepEqual(names(r), ['5b4795fb86f7745876267770', '657315e4a6af4ab4b50f3459']);
    // „Alle“
    r = await t.quests({ all: true, progress: { ...base, done: new Set(), level: 1 } });
    assert.equal(r.items.length, 5);
    // Questpunkte auf der Karte nur für machbare Quests
    const all = await t.questMarkers('ground-zero', { gameMode: 'regular', all: true });
    const avail = await t.questMarkers('ground-zero', { gameMode: 'regular', level: 1, done: new Set([first]) });
    assert.ok(avail.markers.length < all.markers.length);
    assert.ok(avail.markers.every((m) => m.task !== first));
  } finally { cleanup(); }
});
