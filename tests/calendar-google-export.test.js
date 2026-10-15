'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { eligible, payload, exportToGoogle } = require('../src/main/services/calendar-google-export');
const row = { id: 'lecture-1', calendar_id: 'feed:campus', title: 'Vorlesung',
  start_at: '2026-10-16T08:00:00.000Z', end_at: '2026-10-16T10:00:00.000Z', sync_state: 'synced', status: 'confirmed' };
test('lecture and local events are exportable but remote Google events are not', () => {
  assert.equal(eligible(row), true);
  assert.equal(eligible({ ...row, calendar_id: 'google-primary' }), false);
  assert.equal(eligible({ ...row, status: 'cancelled' }), false);
  assert.match(payload(row).id, /^jarvis[a-f0-9]{40}$/);
  assert.equal(payload(row).summary, 'Vorlesung');
});
test('export is idempotent and only writes to a writable Google calendar', async () => {
  const seen = new Map();
  const google = { isConnected: () => true,
    insertEvent: async (_, ev) => { if (seen.has(ev.id)) { const e = new Error('409'); e.status = 409; throw e; } seen.set(ev.id, ev); },
    patchEvent: async (_, id, ev) => { seen.set(id, ev); } };
  const db = { get: () => ({ id: 'google-primary', writable: 1 }), all: () => [row, { ...row, id: 'local-2', calendar_id: 'local' }] };
  assert.deepEqual(await exportToGoogle({ db, google, calendarId: 'google-primary', from: row.start_at, to: row.end_at }), { created: 2, updated: 0, failed: 0 });
  assert.deepEqual(await exportToGoogle({ db, google, calendarId: 'google-primary', from: row.start_at, to: row.end_at }), { created: 0, updated: 2, failed: 0 });
  assert.equal(seen.size, 2);
  await assert.rejects(exportToGoogle({ db, google, calendarId: 'local', from: row.start_at, to: row.end_at }));
});
