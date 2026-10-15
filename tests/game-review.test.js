'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tempCore } = require('./helpers');

test('game screenshot suggestions are never saved before explicit confirmation', () => {
  const { core, cleanup } = tempCore();
  try {
    const review = core.gaming.review;
    const proposal = [{ category: 'quest', name: 'Testquest', value: '2/5', status: 'in_progress' }];
    const staged = review.stage('ark', proposal);
    assert.equal(staged.requiresConfirmation, true);
    assert.equal(staged.changes[0].change, 'new');
    assert.equal(core.gaming.progress.list('ark').length, 0);
    assert.equal(review.confirm(staged.token, [0])[0].action, 'created');
    assert.equal(core.gaming.progress.list('ark')[0].value, '2/5');
    assert.throws(() => review.confirm(staged.token, [0]), /abgelaufen|unbekannt/);
  } finally { cleanup(); }
});

test('review compares old values and rejects without side effects', () => {
  const { core, cleanup } = tempCore();
  try {
    core.gaming.progress.upsert('ark', { category: 'resource', name: 'Holz', value: '10', source: 'manual' });
    const review = core.gaming.review;
    const staged = review.stage('ark', [{ category: 'resource', name: 'Holz', value: '25' }]);
    assert.equal(staged.changes[0].change, 'changed');
    assert.equal(staged.changes[0].previous.value, '10');
    review.reject(staged.token);
    assert.equal(core.gaming.progress.list('ark')[0].value, '10');
    assert.throws(() => review.confirm(staged.token, [0]));
  } finally { cleanup(); }
});

test('game memory only exposes the selected game and validates suggestions', () => {
  const { core, cleanup } = tempCore();
  try {
    core.gaming.progress.upsert('stardew', { category: 'quest', name: 'Bündel', status: 'todo' });
    assert.equal(core.gaming.review.memory('ark').total, 0);
    assert.equal(core.gaming.review.memory('stardew').open[0].name, 'Bündel');
    assert.throws(() => core.gaming.review.stage('ark', [{ category: 'invalid', name: 'X' }]));
    assert.throws(() => core.gaming.review.stage('missing-game', [{ category: 'quest', name: 'X' }]));
  } finally { cleanup(); }
});
