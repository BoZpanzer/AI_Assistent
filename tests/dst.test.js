'use strict';
// Zeitumstellung Ende Oktober: Tage nie mit „+ 24 h“ weiterzählen (sonst rutscht alles in den Nachbartag).
process.env.TZ = 'Europe/Berlin';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tempCore } = require('./helpers');

test('Freie Zeitfenster über die Zeitumstellung: jeder Tag genau einmal, Beginn 08:00 Ortszeit', () => {
  const { core, cleanup } = tempCore();
  try {
    const from = new Date(2026, 9, 24, 0, 0); const to = new Date(2026, 9, 28, 0, 0); // Sa 24. – Di 27.10.2026
    const slots = core.calendar.freeSlots({ from: from.toISOString(), to: to.toISOString(), minutes: 60 });
    const days = slots.map((s) => new Date(s.start)).map((d) => `${d.getDate()}. ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`);
    assert.deepEqual(days, ['24. 8:00', '25. 8:00', '26. 8:00', '27. 8:00']);
  } finally { cleanup(); }
});

test('Agenda ohne KI: „Was hab ich nächste Woche zu tun?“ listet die echten Termine nach Tagen, Aktionen gehen an die KI', async () => {
  const { parseAgendaQuery, buildAgenda } = require('../src/main/agent/agenda');
  const now = new Date(2026, 9, 28, 22, 0); // Mi 28.10.2026
  const q = parseAgendaQuery('Was hab ich nächste Woche alles zu tun?', now);
  assert.equal(q.label, 'Nächste Woche'); assert.equal(q.from.getDate(), 2); assert.equal(q.to.getDate(), 9);
  assert.equal(parseAgendaQuery('Was kann ich heute alles tun?', now).label, 'Heute');
  assert.equal(parseAgendaQuery('Welche Termine hab ich am Freitag?', now).from.getDate(), 30);
  assert.equal(parseAgendaQuery('Trag mir nächste Woche Mathe ein', now), null);
  assert.equal(parseAgendaQuery('Schreib mir morgen 14 Uhr Zahnarzt in meine Termine rein', now), null);
  assert.equal(parseAgendaQuery('Kannst du morgen um 15 Uhr Sport eintragen?', now), null);
  assert.equal(parseAgendaQuery('Ich habe morgen um 14 Uhr einen Termin', now), null);
  assert.equal(parseAgendaQuery('Wie spät ist es?', now), null);
  const privacy = require('../src/main/core/privacy');
  assert.equal(privacy.privateText('Was sind meine Termine morgen?'), true);
  assert.equal(privacy.privateText('Morgen 14 Uhr Zahnarzttermin'), true);
  assert.equal(privacy.personalText('Kannst du morgen um 15 Uhr Sport eintragen?'), true);
  assert.equal(privacy.personalText('Schreib mir morgen 14 Uhr Training rein'), true);
  const { core, cleanup } = tempCore();
  try {
    core.calendar.create({ title: 'VS Betriebssysteme', start: new Date(2026, 10, 3, 9, 0).toISOString(), end: new Date(2026, 10, 3, 10, 30).toISOString(), location: '204 PC-Kabinett, Staatliche Studienakademie' });
    core.calendar.create({ title: 'Stochastik', start: new Date(2026, 10, 6, 8, 0).toISOString(), end: new Date(2026, 10, 6, 9, 30).toISOString() });
    const txt = buildAgenda(core, q, now);
    assert.match(txt, /Dienstag, 3\.11\.[\s\S]*09:00–10:30 VS Betriebssysteme \(204 PC-Kabinett\)/);
    assert.match(txt, /Freitag, 6\.11\.[\s\S]*08:00–09:30 Stochastik/);
    assert.doesNotMatch(txt, /Samstag/);
  } finally { cleanup(); }
});
