'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tempCore } = require('./helpers');

test('specialist game widgets are only shown for relevant games', () => {
  const { core, cleanup } = tempCore();
  try {
    const cases = [
      ['ark', 'ark-breeding'], ['ark_asa', 'ark-breeding'],
      ['cs2', 'cs2-matches'], ['pubg', 'pubg-matches'],
      ['assettocorsa', 'racing-laps'], ['raceroom', 'racing-laps'],
      ['mxbikes', 'racing-laps'], ['stardew', 'stardew-farm'],
      ['factorio', 'factorio-calc'],
    ];
    for (const [game, widget] of cases) {
      const layout = core.gaming.layout(game);
      assert.ok(layout, game + ' exists');
      assert.ok(layout.widgets.some(w => w.type === widget), game + ' should have ' + widget);
    }
    const rust = core.gaming.layout('rust');
    assert.ok(!rust.widgets.some(w => w.type === 'ark-breeding'));
    assert.throws(() => core.gaming.pushWidget('rust', 'ark-breeding'), /passt nicht/);
    assert.throws(() => core.gaming.pushWidget('ark', 'cs2-matches'), /passt nicht/);
  } finally { cleanup(); }
});
