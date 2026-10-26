'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tempCore } = require('./helpers');
const { FIELD_BOSSES } = require('../src/main/services/gaming/aion2');

test('AION 2: profile is detected by name/process and gets its own layout with boss, reset and calculator widgets', () => {
  const { core, cleanup } = tempCore();
  try {
    assert.equal(core.gaming.context.resolve('aion 2').id, 'aion2');
    const types = core.gaming.layout('aion2').widgets.map((w) => w.type);
    for (const t of ['aion2-bosses', 'aion2-resets', 'aion2-calc', 'game-research', 'map', 'timers']) assert.ok(types.includes(t), 'fehlt: ' + t);
  } finally { cleanup(); }
});

test('AION 2: fixed events in EU server time (Kaira every 3 h from 01:00, siege Mon/Thu/Sat 21:00)', () => {
  const { core, cleanup } = tempCore();
  try {
    const A = core.gaming.aion2;
    // Montag 20.10.2026? -> 2026-10-26 ist ein Montag; 20:10 Uhr Berlin (UTC+1)
    const now = new Date('2026-10-26T19:10:00Z');
    const ev = Object.fromEntries(A.events(now).events.map((e) => [e.id, e]));
    assert.equal(ev.kaira.start, '2026-10-26T21:00:00.000Z', 'nächste Kaira 22:00 Berlin');
    assert.equal(ev.siege.start, '2026-10-26T20:00:00.000Z', 'Belagerung Montag 21:00 Berlin');
    assert.equal(ev.executors.start, '2026-10-26T20:30:00.000Z');
    // Dienstag: nächste Belagerung Donnerstag
    const tue = Object.fromEntries(A.events(new Date('2026-10-27T12:00:00Z')).events.map((e) => [e.id, e]));
    assert.equal(tue.siege.start, '2026-10-29T20:00:00.000Z');
    // während der Belagerung: läuft
    const during = A.events(new Date('2026-10-26T20:10:00Z')).events.find((e) => e.id === 'siege');
    assert.equal(during.running, true);
  } finally { cleanup(); }
});

test('AION 2: field boss kill starts a respawn timer (overlay), own respawn time can be set', () => {
  const { core, cleanup } = tempCore();
  try {
    const A = core.gaming.aion2;
    assert.ok(FIELD_BOSSES.length >= 45);
    const b = FIELD_BOSSES.find((x) => x.name === 'Chaser Taulo');
    const r = A.killed(b.id, { minutesAgo: 30 });
    assert.equal(Math.round((Date.parse(r.nextSpawn) - Date.now()) / 60000), 90);
    const t = core.gaming.timers({ game: 'aion2' });
    assert.equal(t.length, 1); assert.match(t[0].label, /Chaser Taulo/);
    A.killed(b.id); assert.equal(core.gaming.timers({ game: 'aion2' }).length, 1, 'erneuter Kill ersetzt den Timer');
    assert.equal(A.bosses({ query: 'taulo' }).bosses[0].nextSpawn != null, true);
    A.setRespawn(b.id, 100); assert.equal(A.bosses({ query: 'taulo' }).bosses[0].respawn, 100);
    A.setRespawn(b.id, null); assert.equal(A.bosses({ query: 'taulo' }).bosses[0].respawn, 120);
    assert.throws(() => A.killed('gibtsnicht'), /unbekannt/);
  } finally { cleanup(); }
});

test('AION 2: daily/weekly tasks reset themselves at the configured reset time; reset time from in-game countdown', () => {
  const { core, cleanup } = tempCore();
  try {
    const A = core.gaming.aion2;
    core.settings.update({ gaming: { aion2: { region: 'eu', resetTime: '05:00', weeklyDay: 3 } } });
    A.toggleTask('duty', true); A.toggleTask('raids', true);
    let t = A.tasks();
    assert.equal(t.tasks.find((x) => x.id === 'duty').done, true);
    // nach dem nächsten täglichen Reset: Daily offen, Weekly (vor Mittwoch) noch erledigt
    const afterDaily = new Date(Date.parse(t.nextDaily) + 60000);
    const w = A.tasks(afterDaily);
    assert.equal(w.tasks.find((x) => x.id === 'duty').done, false);
    const weeklyDone = Date.parse(t.nextWeekly) > afterDaily.getTime();
    assert.equal(w.tasks.find((x) => x.id === 'raids').done, weeklyDone);
    assert.equal(A.tasks(new Date(Date.parse(t.nextWeekly) + 60000)).tasks.find((x) => x.id === 'raids').done, false);
    // Wöchentlicher Reset ist ein Mittwoch 05:00 Berlin
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).format(new Date(t.nextWeekly));
    assert.match(wd, /Wed.*05/);
    A.addTask({ label: 'Legion-Quest', period: 'weekly' });
    assert.ok(A.tasks().tasks.some((x) => x.label === 'Legion-Quest'));
    const now = new Date('2026-10-26T09:00:00Z'); // 10:00 Berlin
    A.resetFromCountdown('7:00', now);
    assert.equal(core.settings.get('gaming').aion2.resetTime, '17:00');
  } finally { cleanup(); }
});

test('AION 2: calculators – regeneration, upgrade chance, crafting', () => {
  const { core, cleanup } = tempCore();
  try {
    const A = core.gaming.aion2;
    const r = A.regen('odyle', 500, { now: 0 });
    assert.equal(r.minutes, 4 * 180); // 60 fehlen → 4 × 15 alle 3 h
    assert.equal(A.regen('odyle', 560).full, true);
    const u = A.upgrade({ chance: 25, costPerTry: 1000 });
    assert.equal(u.expectedTries, 4); assert.equal(u.expectedCost, 4000); assert.equal(u.tries90, 9);
    assert.throws(() => A.upgrade({ chance: 0 }));
    const c = A.craft({ materials: [{ name: 'Erz', qty: 3, price: 100 }, { name: 'Holz', qty: 2, price: 50 }], count: 4, sellPrice: 500 });
    assert.equal(c.total, 4 * 400); assert.equal(c.perItem, 400); assert.equal(c.profit, 400);
    A.saveRecipe({ name: 'Trank', materials: [{ name: 'Kraut', qty: 2, price: 10 }] });
    assert.equal(A.recipes()[0].name, 'Trank'); A.removeRecipe('Trank'); assert.equal(A.recipes().length, 0);
  } finally { cleanup(); }
});
