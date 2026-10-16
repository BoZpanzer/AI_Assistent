'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

async function makeRetry(opts) {
  const { createMapAutoRetry } = await import('../src/renderer/src/lib/map-auto-retry.mjs');
  return createMapAutoRetry(opts);
}

test('Tarkov retries a transient download or alignment failure after backoff', async () => {
  const retry = await makeRetry({ maxAttempts: 4, initialDelayMs: 2000, maxDelayMs: 10000 });
  const key = 'customs-wiki:wiki:2026';
  assert.equal(retry.due(key, 0), 0);
  assert.equal(retry.start(key, 0), true);
  assert.equal(retry.start(key, 0), false, 'one operation per map at a time');
  assert.equal(retry.finish(key, false, 0), 2000);
  assert.equal(retry.start(key, 1999), false);
  assert.equal(retry.due(key, 2000), 0);
  assert.equal(retry.start(key, 2000), true);
  assert.equal(retry.finish(key, true, 2000), null);
  assert.equal(retry.start(key, 200000), false, 'successful alignment is not repeated');
});

test('Tarkov automatic retries are bounded and use exponential delays', async () => {
  const retry = await makeRetry({ maxAttempts: 4, initialDelayMs: 1000, maxDelayMs: 5000 });
  const key = 'woods:svg';
  let now = 0;
  for (const delay of [1000, 2000, 4000, 5000]) {
    assert.equal(retry.start(key, now), true);
    assert.equal(retry.finish(key, false, now), delay === 5000 ? null : delay);
    now += delay;
  }
  assert.equal(retry.due(key, now), null);
  assert.equal(retry.start(key, now), false);
});

test('Tarkov retries are isolated between maps and can be reset after manual action', async () => {
  const retry = await makeRetry({ maxAttempts: 2, initialDelayMs: 1000 });
  const failedMap = 'shoreline:svg';
  const other = 'customs:svg';
  assert.equal(retry.start(failedMap, 0), true);
  retry.finish(failedMap, false, 0);
  assert.equal(retry.start(other, 0), true, 'other maps are not blocked by a failed download');
  retry.finish(other, true, 0);
  assert.equal(retry.start(failedMap, 500), false);
  assert.equal(retry.start(failedMap, 1000), true);
  retry.finish(failedMap, false, 1000);
  assert.equal(retry.start(failedMap, 10000), false);
  retry.reset(failedMap);
  assert.equal(retry.start(failedMap, 10000), true);
});

test('Tarkov exposes preparation, exhausted failure and manual recovery separately', async () => {
  const retry = await makeRetry({ maxAttempts: 1 });
  assert.equal(retry.status('map'), 'idle');
  retry.start('map', 0);
  assert.equal(retry.status('map'), 'running');
  retry.finish('map', false, 0);
  assert.equal(retry.status('map'), 'failed');
  retry.reset('map');
  retry.start('map', 1);
  retry.finish('map', true, 1);
  assert.equal(retry.status('map'), 'ready');
});
