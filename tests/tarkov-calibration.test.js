'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempCore, withoutTarkovJson } = require('./helpers');
const { createCore } = require('../src/main/app-core');
const { Tarkov } = require('../src/main/services/gaming/tarkov');
const { GameCache } = require('../src/main/services/gaming/cache');

const res = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => JSON.parse(body), text: async () => body,
});

test('tarkov.dev 422: readable error, sanitized diagnostics, no request loop', async () => {
  const { core, cleanup } = tempCore();
  try {
    let calls = 0;
    const t = new Tarkov({ fetch: withoutTarkovJson(async () => { calls++; return res(422, '{"errors":["Unprocessable"]}', { 'cf-ray': 'abc' }); }), gameCache: new GameCache(core.db) });
    await assert.rejects(() => t.maps('regular'), (e) => {
      assert.equal(e.status, 422);
      assert.match(e.message, /abgelehnt \(HTTP 422\)/);
      assert.match(e.message, /Kalibrierung/);
      return true;
    });
    // The identical rejected query is not re-sent automatically.
    await assert.rejects(() => t.maps('regular'), /HTTP 422/);
    assert.equal(calls, 1);
  } finally { cleanup(); }
});

test('tarkov.dev outage after a successful fetch keeps the stored map data (offline flag)', async () => {
  const { core, cleanup } = tempCore();
  try {
    let fail = false;
    const t = new Tarkov({ fetch: withoutTarkovJson(async () => (fail ? res(503, 'down') : res(200, JSON.stringify({ data: { maps: [{ normalizedName: 'customs', name: 'Zollgebiet', extracts: [{ name: 'ZB-1011', position: { x: 1, y: 0, z: 2 } }] }] } })))), gameCache: new GameCache(core.db) });
    assert.equal((await t.map('customs')).value.name, 'Zollgebiet');
    core.db.run("UPDATE game_cache SET expires_at='2000-01-01T00:00:00.000Z'");
    fail = true;
    const r = await t.map('customs');
    assert.equal(r.offline, true);
    assert.equal(r.value.extracts.length, 1);
  } finally { cleanup(); }
});

test('Identical concurrent tarkov.dev queries share one request', async () => {
  const { core, cleanup } = tempCore();
  try {
    let calls = 0;
    const t = new Tarkov({ fetch: withoutTarkovJson(async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return res(200, JSON.stringify({ data: { maps: [] } })); }), gameCache: new GameCache(core.db) });
    await Promise.all([t.gql('{ maps { id } }'), t.gql('{ maps { id } }')]);
    assert.equal(calls, 1);
  } finally { cleanup(); }
});

test('Regression: Tarkov raid widget only uses variables it declares (crashed with cloudShare)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/renderer/src/pages/gaming/widgets.jsx'), 'utf8');
  const body = src.slice(src.indexOf('function TarkovRaid('), src.indexOf('function TarkovQuests('));
  assert.ok(body.length > 100);
  for (const name of ['cloudShare']) {
    if (body.includes(name)) assert.match(body, new RegExp(`const ${name}\\b`), `${name} used but not declared in TarkovRaid`);
  }
});

test('Calibration survives save, restart and reload; invalid or degenerate points are rejected', () => {
  const { core, dir } = tempCore();
  const points = [{ gx: -300, gz: -200, ix: .1, iy: .9 }, { gx: 600, gz: -150, ix: .85, iy: .8 }, { gx: 100, gz: 230, ix: .45, iy: .15 }];
  core.gaming.tarkovMaps.importWiki();
  assert.throws(() => core.gaming.setCalibration('eft', 'customs-wiki', points.slice(0, 1)), /zwei Referenzpunkte/);
  assert.throws(() => core.gaming.setCalibration('eft', 'customs-wiki', [points[0], { ...points[1], gx: NaN }, points[2]]), /Ungültiger Referenzpunkt/);
  // three collinear game positions
  assert.throws(() => core.gaming.setCalibration('eft', 'customs-wiki', [points[0], { ...points[1], gx: 0, gz: 0 }, { ...points[2], gx: 300, gz: 200 }]), /Linie/);
  // no image → no calibration
  assert.throws(() => core.gaming.setCalibration('eft', 'missing-map', points), /Kartenbild/);
  const saved = core.gaming.setCalibration('eft', 'customs-wiki', points);
  core.stop();
  // restart with the same data directory
  const again = createCore({ dataDir: dir, version: '3.0.0', fetch: async () => { throw new Error('offline'); } });
  try {
    const m = again.gaming.maps('eft').find((x) => x.name === 'customs-wiki');
    assert.deepEqual(m.calibration.affine, saved.affine);
    // every reference point maps back onto its clicked image position (independent of image pixel size/zoom)
    const a = m.calibration.affine;
    for (const p of points) {
      assert.ok(Math.abs(a[0] * p.gx + a[1] * p.gz + a[2] - p.ix) < 1e-9);
      assert.ok(Math.abs(a[3] * p.gx + a[4] * p.gz + a[5] - p.iy) < 1e-9);
    }
    // calibration is bound to the map: other maps stay uncalibrated
    assert.equal(again.gaming.maps('eft').find((x) => x.name === 'woods-wiki').calibration, null);
  } finally { again.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
