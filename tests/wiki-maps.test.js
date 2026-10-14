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
