'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tempCore } = require('./helpers');
const ex = require('../src/main/services/calendar-google-export');

/** Nachgebildete Google-Kalender-API mit mehreren Kalendern. */
function fakeGoogle(initial = []) {
  const cals = new Map(initial.map((c) => [c.id, { ...c, events: new Map() }]));
  let n = 0;
  const cal = (id) => { const c = cals.get(id); if (!c) throw Object.assign(new Error('404'), { status: 404 }); return c; };
  const google = {
    isConnected: () => true,
    listCalendars: async () => ({ items: [...cals.values()].map(({ events, ...c }) => c) }),
    createCalendar: async ({ summary }) => { const id = 'cal' + (++n) + '@group'; cals.set(id, { id, summary, accessRole: 'owner', events: new Map() }); return { id, summary }; },
    setCalendarColor: async () => ({}),
    listMirroredEvents: async (id) => [...cal(id).events.values()].filter((e) => e.extendedProperties?.private?.jarvisMirror === '1').map((e) => structuredClone(e)),
    listEvents: async (id) => [...cal(id).events.values()].map((e) => structuredClone(e)),
    insertEvent: async (id, ev) => { const c = cal(id); if (c.events.has(ev.id)) throw Object.assign(new Error('409'), { status: 409 }); c.events.set(ev.id, structuredClone(ev)); return { ...ev, etag: 'x', updated: new Date().toISOString() }; },
    getEvent: async (id, eid) => structuredClone(cal(id).events.get(eid)),
    patchEvent: async (id, eid, ev) => { cal(id).events.set(eid, structuredClone(ev)); return ev; },
    deleteEvent: async (id, eid) => { cal(id).events.delete(eid); },
  };
  const byName = (name) => [...cals.values()].find((c) => c.summary === name);
  return { google, cals, byName };
}

function setup() {
  const t = tempCore();
  const { core } = t;
  const f = fakeGoogle([{ id: 'primary@me', summary: 'Ich', accessRole: 'owner', primary: true }]);
  core.calendar.google = f.google;
  core.settings.update({ google: { exportLocalToGoogle: true } });
  return { ...t, ...f };
}
const soon = (days, h = 10) => { const d = new Date(Date.now() + days * 86400000); d.setHours(h, 0, 0, 0); return d.toISOString(); };

test('Kinds: birthdays, uni items, appointments, todos and reminders are told apart', () => {
  assert.equal(ex.eventKind({ calendar_id: 'local', title: 'Geburtstag: Lisa' }), 'geburtstage');
  assert.equal(ex.eventKind({ calendar_id: 'local', title: 'Mein Geburtstag' }), 'geburtstage');
  assert.equal(ex.eventKind({ calendar_id: 'feed:campus', title: 'Mathe 1' }), 'uni');
  assert.equal(ex.eventKind({ calendar_id: 'local', title: 'Klausur Physik' }), 'uni');
  assert.equal(ex.eventKind({ calendar_id: 'local', title: '📚 Analysis: Integrale' }), 'uni');
  assert.equal(ex.eventKind({ calendar_id: 'local', title: 'Zahnarzt' }), 'termine');
  assert.equal(ex.taskKind({ reminder_minutes: null }), 'todos');
  assert.equal(ex.taskKind({ reminder_minutes: 0 }), 'erinnerungen');
});

test('Task copies: reminder time becomes a Google popup, all-day todos stay all-day', () => {
  const r = ex.taskPayload({ id: 't1', title: 'Müll rausbringen', status: 'open', due_at: '2026-11-03T17:00:00.000Z', reminder_minutes: 10, all_day: 0 });
  assert.deepEqual(r.reminders, { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] });
  assert.equal(r.end.dateTime, '2026-11-03T17:15:00.000Z');
  assert.ok(ex.owned(r) && ex.remoteUnchanged(r));
  const changed = ex.taskPayload({ id: 't1', title: 'Müll rausbringen', status: 'open', due_at: '2026-11-03T17:00:00.000Z', reminder_minutes: 30, all_day: 0 });
  assert.notEqual(changed.extendedProperties.private.jarvisFingerprint, r.extendedProperties.private.jarvisFingerprint, 'neue Erinnerungszeit → Aktualisierung');
  const todo = ex.taskPayload({ id: 't2', title: 'Steuer', status: 'open', due_at: '2026-11-03T00:00:00', reminder_minutes: null, all_day: 1 });
  assert.equal(todo.reminders, undefined);
  assert.ok(todo.start.date && todo.end.date && todo.end.date > todo.start.date);
  // ältere Kopien ohne eigene Erinnerung behalten ihren Fingerabdruck (kein Massen-Konflikt nach dem Update)
  const ev = { summary: 'a', start: { dateTime: '2026-11-03T17:00:00.000Z' }, end: { dateTime: '2026-11-03T18:00:00.000Z' } };
  assert.equal(ex.contentHash(ev), ex.contentHash({ ...ev, reminders: { useDefault: true } }));
});

test('Everything in the JARVIS calendar lands in its own Google calendar per kind', async () => {
  const { core, cleanup, byName, cals } = setup();
  try {
    await core.calendar.create({ title: 'Zahnarzt', start: soon(2), end: soon(2, 11) });
    await core.calendar.create({ title: 'Geburtstag: Lisa', start: soon(5, 0), allDay: true, recurrence: { freq: 'yearly' } });
    await core.calendar.create({ title: 'Klausur Physik', start: soon(9), end: soon(9, 12) });
    core.tasks.create({ title: 'Wäsche', dueAt: soon(1) });
    core.tasks.create({ title: 'Mama anrufen', dueAt: soon(3, 18), reminderMinutes: 15 });
    core.tasks.create({ title: 'Ohne Datum' });

    const r = await core.calendar.exportAll();
    assert.equal(r.failed, 0);
    assert.deepEqual(r.createdCalendars.sort(), ['JARVIS · Erinnerungen', 'JARVIS · Geburtstage', 'JARVIS · Termine', 'JARVIS · Todos', 'JARVIS · Uni'].sort());
    const titles = (name) => [...byName(name).events.values()].map((e) => e.summary);
    assert.deepEqual(titles('JARVIS · Termine'), ['Zahnarzt']);
    assert.deepEqual(titles('JARVIS · Geburtstage'), ['Geburtstag: Lisa']);
    assert.equal(byName('JARVIS · Geburtstage').events.values().next().value.recurrence[0], 'RRULE:FREQ=YEARLY');
    assert.deepEqual(titles('JARVIS · Uni'), ['Klausur Physik']);
    assert.deepEqual(titles('JARVIS · Todos'), ['Wäsche']);
    assert.deepEqual(titles('JARVIS · Erinnerungen'), ['Mama anrufen']);
    assert.equal(cals.get('primary@me').events.size, 0, 'Hauptkalender bleibt unberührt');

    // gespeicherte Kalender werden wiederverwendet, nichts doppelt
    const again = await core.calendar.exportAll();
    assert.equal(again.created, 0); assert.equal(again.createdCalendars.length, 0); assert.equal(again.unchanged, 5);
    assert.equal(cals.size, 6);
    // eigene JARVIS-Kalender erscheinen nicht als zusätzliche Kalender in JARVIS
    core.db.run("INSERT OR IGNORE INTO calendars(id,name,selected,writable) VALUES(?,?,1,1)", core.settings.get('google').exportCalendars.todos, 'JARVIS · Todos');
    assert.ok(!core.calendar.calendars().some((c) => c.name === 'JARVIS · Todos'));

    // erledigte Aufgabe verschwindet aus Google, geänderte wird aktualisiert
    const wash = core.tasks.list({ filter: 'all' }).find((t) => t.title === 'Wäsche');
    core.tasks.complete(wash.id);
    const call = core.tasks.list({ filter: 'all' }).find((t) => t.title === 'Mama anrufen');
    core.tasks.update(call.id, { title: 'Mama anrufen (Geburtstag)' });
    const third = await core.calendar.exportAll();
    assert.deepEqual(titles('JARVIS · Todos'), []);
    assert.deepEqual(titles('JARVIS · Erinnerungen'), ['Mama anrufen (Geburtstag)']);
    assert.equal(third.deleted, 1); assert.equal(third.updated, 1);
  } finally { cleanup(); }
});

test('Switching a kind off removes only unchanged JARVIS copies; Google edits and own events stay', async () => {
  const { core, cleanup, byName } = setup();
  try {
    core.tasks.create({ title: 'A', dueAt: soon(1) });
    core.tasks.create({ title: 'B', dueAt: soon(2) });
    await core.calendar.exportAll();
    const todos = byName('JARVIS · Todos');
    const [first] = todos.events.values();
    first.summary = 'In Google umbenannt';
    todos.events.set('own', { id: 'own', summary: 'Eigener Google-Termin' });
    core.settings.update({ google: { exportKinds: { todos: false } } });
    const r = await core.calendar.exportAll();
    assert.equal(r.byKind.todos.deleted, 1);
    assert.deepEqual([...todos.events.values()].map((e) => e.summary).sort(), ['Eigener Google-Termin', 'In Google umbenannt']);
  } finally { cleanup(); }
});

test('One-time move: copies of the old single-calendar export are removed from the main calendar', async () => {
  const { core, cleanup, cals, byName } = setup();
  try {
    core.db.run("INSERT INTO calendars(id,name,is_primary,selected,writable) VALUES('primary@me','Ich',1,1,1)");
    const e = await core.calendar.create({ title: 'Zahnarzt', start: soon(2), end: soon(2, 11) });
    const row = core.db.get('SELECT * FROM events WHERE id=?', e.id);
    const primary = cals.get('primary@me').events;
    const old = ex.payload(row); primary.set(old.id, old);                               // alte Kopie
    primary.set('mine', { id: 'mine', summary: 'Eigener Termin' });                         // normaler Google-Termin
    const edited = ex.payload({ ...row, id: 'x2' }); edited.summary = 'geändert'; primary.set(edited.id, edited); // in Google geändert
    const r = await core.calendar.exportAll();
    assert.equal(r.legacy.deleted, 1);
    assert.deepEqual([...primary.keys()].sort(), ['mine', edited.id].sort());
    assert.deepEqual([...byName('JARVIS · Termine').events.values()].map((x) => x.summary), ['Zahnarzt']);
    primary.set(old.id, old);
    const r2 = await core.calendar.exportAll();
    assert.equal(r2.legacy, undefined, 'Umzug läuft nur einmal');
  } finally { cleanup(); }
});

test('Only calendars owned by the account are used; a missing calendar list aborts safely', async () => {
  const { google } = fakeGoogle([{ id: 'shared', summary: 'JARVIS · Termine', accessRole: 'writer' }]);
  const { targets, created } = await ex.ensureCalendars({ google, kinds: ['termine'] });
  assert.notEqual(targets.termine, 'shared');
  assert.deepEqual(created, ['JARVIS · Termine']);
  await assert.rejects(ex.ensureCalendars({ google: { listCalendars: async () => ({}) } }), /unvollständig/);
});
