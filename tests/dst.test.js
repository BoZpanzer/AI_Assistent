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
