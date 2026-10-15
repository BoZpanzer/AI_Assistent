'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tempCore } = require('./helpers');
const { TarkovMaps } = require('../src/main/services/gaming/tarkovmaps');

test('Wiki bundle imports twelve maps offline without changing existing calibration or routes', () => {
  const { core, cleanup } = tempCore();
  try {
    const g = core.gaming;
    g.context.setState('calib:eft:customs', { affine: [1,0,0,0,1,0] });
    g.saveRoute('eft', 'customs', 'Existing', [{ x: .1, y: .2 }, { x: .3, y: .4 }]);
    const maps = new TarkovMaps(g, { fetch: () => { throw Error('network forbidden'); } });
    const r = maps.importWiki();
    assert.equal(r.done.length, 12); assert.deepEqual(r.failed, []);
    const wiki = g.maps('eft').find(m => m.name === 'customs-wiki');
    assert.equal(wiki.hasImage, true); assert.equal(wiki.width, 2600);
    assert.equal(wiki.source.baseMap, 'customs'); assert.equal(wiki.calibration, null);
    assert.deepEqual(JSON.parse(g.context.getState('calib:eft:customs')).affine, [1,0,0,0,1,0]);
    assert.equal(g.routes('eft', 'customs').length, 1);
    assert.equal(g.routes('eft', 'customs-wiki').length, 0);
    g.setRouteGoal('customs-wiki', { x: .5, y: .5, label: 'Dorms' });
    assert.equal(g.routeGoal('customs-wiki').label, 'Dorms');
    assert.equal(maps.importWiki().skipped.length, 12);
    assert.equal(g.routeGoal('customs-wiki').label, 'Dorms');
  } finally { cleanup(); }
});

test('Three-point calibration handles mirrored maps and rejects degenerate references', () => {
  const { affineFromPoints } = require('../src/main/services/gaming/calibration');
  const points = [{ gx: 0, gz: 0, ix: .8, iy: .1 }, { gx: 100, gz: 0, ix: .3, iy: .1 }, { gx: 0, gz: 200, ix: .8, iy: .9 }];
  const a = affineFromPoints(points);
  assert.ok(Math.abs(a[0] * 50 + a[1] * 100 + a[2] - .55) < 1e-10);
  assert.ok(Math.abs(a[3] * 50 + a[4] * 100 + a[5] - .5) < 1e-10);
  assert.throws(() => affineFromPoints([points[0], points[0], points[2]]), /Linie/);
  assert.throws(() => affineFromPoints([points[0], points[1], { ...points[2], ix: 2 }]), /außerhalb/);
  const { core, cleanup, dir } = tempCore();
  try {
    core.gaming.tarkovMaps.importWiki();
    const c = core.gaming.setCalibration('eft', 'customs-wiki', points);
    assert.equal(c.imageHash.length, 64);
    assert.deepEqual(c.affine, a);
    core.gaming.context.setState('eft:position', { map: 'customs', x: 50, z: 100, fx: 1, fz: 0, at: new Date().toISOString() });
    core.gaming.setLastMap('eft', 'customs-wiki');
    const pos = core.gaming.lastMap('eft').position;
    assert.ok(Math.abs(pos.nx - .55) < 1e-10);
    assert.ok(Math.abs(Math.abs(pos.angle) - 180) < 1e-10, 'mirrored facing direction');
    const fs = require('node:fs'), path = require('node:path');
    const image = path.join(dir, 'replacement.png'); fs.writeFileSync(image, 'test image');
    core.gaming.importMapImage('eft', 'customs-wiki', image);
    assert.equal(core.gaming.maps('eft').find(m => m.name === 'customs-wiki').calibration, null);
  } finally { cleanup(); }
});
