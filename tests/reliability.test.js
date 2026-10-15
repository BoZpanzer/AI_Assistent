'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Scheduler } = require('../src/main/jobs/scheduler');
const { GameCache } = require('../src/main/services/gaming/cache');

test('scheduler reports failures and recovers after a successful run', async () => {
  const scheduler = new Scheduler({ settings: { get: () => ({ reduceWhileGaming: false }) }, gaming: { context: { state: () => ({ gaming: false }) } } });
  let fail = true;
  scheduler.add('probe', 60000, async () => { if (fail) throw new Error('offline'); });
  scheduler.jobs[0].next = 0;
  await scheduler.tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scheduler.status()[0].consecutiveFailures, 1);
  assert.match(scheduler.status()[0].lastError, /offline/);
  fail = false;
  scheduler.jobs[0].next = 0;
  await scheduler.tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scheduler.status()[0].consecutiveFailures, 0);
  assert.equal(scheduler.status()[0].lastError, null);
});

test('broken game cache JSON returns miss instead of crashing', () => {
  const cache = new GameCache({ get: () => ({ value: '{bad', expires_at: '2999-01-01T00:00:00Z' }) });
  assert.equal(cache.get('broken'), null);
});
