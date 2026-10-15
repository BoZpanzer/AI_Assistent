'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  eligible, googleId, payload, contentHash, owned, remoteUnchanged, freshSource, exportToGoogle,
} = require('../src/main/services/calendar-google-export');

const row = {
  id: 'lecture-1', calendar_id: 'feed:campus', title: 'Vorlesung',
  start_at: '2026-10-16T08:00:00.000Z', end_at: '2026-10-16T10:00:00.000Z',
  sync_state: 'synced', status: 'confirmed',
};
const PASSWORDLESS_GOOGLE = () => {
  const seen = new Map();
  const actions = { inserts: 0, patches: 0, deletes: 0 };
  const google = {
    isConnected: () => true,
    listMirroredEvents: async () => [...seen.values()].map((v) => structuredClone(v)),
    insertEvent: async (_, ev) => {
      if (seen.has(ev.id)) throw Object.assign(new Error('Already exists'), { status: 409 });
      seen.set(ev.id, structuredClone(ev)); actions.inserts++;
    },
    getEvent: async (_, id) => structuredClone(seen.get(id)),
    patchEvent: async (_, id, ev) => {
      seen.set(id, structuredClone(ev)); actions.patches++;
    },
    deleteEvent: async (_, id) => { seen.delete(id); actions.deletes++; },
  };
  return { seen, google, actions };
};
const dbFor = (rows, { fresh = true, writable = true } = {}) => ({
  get: (sql, id) => sql.includes('FROM calendar_feeds')
    ? fresh ? { last_fetch: new Date(Date.now() - 60_000).toISOString(), last_error: null } : { last_fetch: null, last_error: 'offline' }
    : { id, writable: writable ? 1 : 0 },
  all: () => rows,
});
const args = (db, google) => ({
  db, google, calendarId: 'google-primary',
  from: '2026-10-01T00:00:00.000Z', to: '2026-12-01T00:00:00.000Z',
});

test('eligibility is a strict boolean and only local or feed events are eligible', () => {
  assert.equal(eligible(row), true);
  assert.equal(eligible({ ...row, calendar_id: 'google-primary' }), false);
  assert.equal(eligible({ ...row, status: 'cancelled' }), false);
  assert.equal(eligible({ ...row, start_at: null }), false);
  assert.equal(eligible(null), false);
  assert.match(googleId(row), /^jarvis[a-f0-9]{40}$/);
  assert.equal(payload(row).summary, 'Vorlesung');
});

test('mirrored event metadata binds ownership and detects independent Google edits', () => {
  const event = payload(row);
  assert.ok(owned(event));
  assert.ok(remoteUnchanged(event));
  assert.equal(event.extendedProperties.private.jarvisFingerprint, contentHash(event));
  assert.equal(remoteUnchanged({ ...event, summary: 'Manipuliert' }), false);
  assert.equal(owned({ ...event, extendedProperties: null }), false);
  assert.equal(payload({ ...row, rrule: 'RRULE:FREQ=WEEKLY' }).recurrence[0], 'RRULE:FREQ=WEEKLY');
});

test('repeat sync is idempotent and source edits are patched, not duplicated', async () => {
  const rows = [{ ...row }, { ...row, id: 'local-2', calendar_id: 'local' }];
  const { google, seen, actions } = PASSWORDLESS_GOOGLE();
  const opts = args(dbFor(rows), google);
  const first = await exportToGoogle(opts);
  assert.equal(first.created, 2);
  assert.equal(first.failed, 0);
  const second = await exportToGoogle(opts);
  assert.equal(second.unchanged, 2);
  assert.equal(actions.inserts, 2);
  assert.equal(actions.patches, 0);
  rows[0].title = 'Neue Vorlesung';
  const third = await exportToGoogle(opts);
  assert.equal(third.updated, 1);
  assert.equal(third.unchanged, 1);
  assert.equal(actions.patches, 1);
  assert.equal(seen.get(googleId(rows[0])).summary, 'Neue Vorlesung');
});

test('Google-side edits produce conflicts instead of being overwritten', async () => {
  const rows = [{ ...row }];
  const { google, seen, actions } = PASSWORDLESS_GOOGLE();
  const opts = args(dbFor(rows), google);
  await exportToGoogle(opts);
  seen.get(googleId(row)).summary = 'In Google bearbeitet';
  rows[0].title = 'Auch in JARVIS geändert';
  const out = await exportToGoogle(opts);
  assert.equal(out.conflicts, 1);
  assert.equal(actions.patches, 0);
  assert.equal(seen.get(googleId(row)).summary, 'In Google bearbeitet');
});

test('deletes removed source entries only for owned unchanged mirrors from healthy feeds', async () => {
  const rows = [{ ...row }];
  const { google, seen, actions } = PASSWORDLESS_GOOGLE();
  const healthy = args(dbFor(rows), google);
  await exportToGoogle(healthy);
  rows.length = 0;
  const out = await exportToGoogle(healthy);
  assert.equal(out.deleted, 1);
  assert.equal(seen.size, 0);
  assert.equal(actions.deletes, 1);
  rows.push({ ...row });
  await exportToGoogle(healthy);
  const stale = await exportToGoogle(args(dbFor([], { fresh: false }), google));
  assert.equal(stale.deleted, 0);
  assert.equal(stale.retained, 1);
  assert.equal(seen.size, 1);
});

test('does not delete a Google-modified copy or unrelated Google appointments', async () => {
  const { google, seen, actions } = PASSWORDLESS_GOOGLE();
  const target = payload(row);
  seen.set(target.id, { ...target, location: 'Google edit' });
  seen.set('unrelated', { id: 'unrelated', summary: 'Private appointment' });
  const out = await exportToGoogle(args(dbFor([]), google));
  assert.equal(out.deleted, 0);
  assert.equal(out.retained, 1);
  assert.equal(actions.deletes, 0);
  assert.equal(seen.size, 2);
});

test('invalid destination, missing connection or incomplete Google response aborts safely', async () => {
  const { google } = PASSWORDLESS_GOOGLE();
  await assert.rejects(exportToGoogle(args(dbFor([]), { ...google, isConnected: () => false })));
  await assert.rejects(exportToGoogle({ ...args(dbFor([]), google), calendarId: 'local' }));
  await assert.rejects(exportToGoogle(args(dbFor([], { writable: false }), google)));
  await assert.rejects(exportToGoogle(args(dbFor([]), { ...google, listMirroredEvents: async () => null })));
});

test('409 ID collisions never overwrite Google events without JARVIS ownership', async () => {
  const { google, seen, actions } = PASSWORDLESS_GOOGLE();
  seen.set(googleId(row), { id: googleId(row), summary: 'Not JARVIS', start: { dateTime: row.start_at } });
  const result = await exportToGoogle(args(dbFor([row]), google));
  assert.equal(result.conflicts, 1);
  assert.equal(actions.patches, 0);
  assert.equal(seen.get(googleId(row)).summary, 'Not JARVIS');
});

test('feed freshness never treats a missing or failed download as deletion authority', () => {
  assert.equal(freshSource(dbFor([]), 'local', Date.now()), true);
  assert.equal(freshSource(dbFor([], { fresh: false }), 'feed:campus', Date.now()), false);
  assert.equal(freshSource(dbFor([]), 'unexpected', Date.now()), false);
});
