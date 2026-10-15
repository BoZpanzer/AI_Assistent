'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tempCore } = require('./helpers');

test('game planning goals persist, update and stay scoped to their game', () => {
  const { core, cleanup } = tempCore();
  try {
    const progress = core.gaming.progress;
    const input = { category: 'other', name: 'Plan: Zuchtlinie dokumentieren', status: 'todo', note: 'Rex Linie A', source: 'manual' };
    const first = progress.upsert('ark', input);
    assert.equal(first.action, 'created');
    assert.equal(progress.list('ark').filter(x => x.name.startsWith('Plan: ')).length, 1);
    assert.equal(progress.list('stardew').filter(x => x.name.startsWith('Plan: ')).length, 0);
    const second = progress.upsert('ark', { ...input, status: 'done' });
    assert.equal(second.action, 'updated');
    assert.equal(progress.list('ark').find(x => x.name === input.name).status, 'done');
    assert.equal(progress.list('ark').filter(x => x.name === input.name).length, 1);
  } finally { cleanup(); }
});
