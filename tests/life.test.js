'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tempCore } = require('./helpers');

test('Ausgaben: Kategorie aus der Notiz, Monatssumme, Budget mit Abos, Prognose', () => {
  const { core, cleanup } = tempCore();
  try {
    const L = core.life;
    core.settings.update({ life: { budgetMonthly: 400 } });
    assert.equal(L.addExpense({ amount: '12,50', note: 'Döner' }).category, 'Essen & Trinken');
    assert.equal(L.addExpense({ amount: 45.2, note: 'Tanken' }).category, 'Transport');
    assert.equal(L.addExpense({ amount: 30, note: 'Rewe Wocheneinkauf' }).category, 'Lebensmittel');
    assert.equal(L.addExpense({ amount: 5, note: 'irgendwas' }).category, 'Sonstiges');
    assert.throws(() => L.addExpense({ amount: -3 }), /Betrag/);
    L.addSubscription({ name: 'Netflix', amount: 13.99, cycle: 'month', nextCharge: '2026-11-03' });
    L.addSubscription({ name: 'Domain', amount: 24, cycle: 'year', nextCharge: '2027-01-10' });
    const m = L.month();
    assert.equal(m.total, 92.7); assert.equal(m.subscriptions, 15.99); assert.equal(m.left, 400 - 92.7 - 15.99);
    assert.equal(m.categories[0].category, 'Transport');
    // Prognose ab Tag 5: Hochrechnung auf den Monat
    const mid = new Date(); mid.setDate(15);
    const p = L.month(null, mid);
    assert.equal(p.forecast, Math.round(92.7 / 15 * new Date(mid.getFullYear(), mid.getMonth() + 1, 0).getDate() * 100) / 100);
  } finally { cleanup(); }
});

test('Abos: Abbuchung weiterschieben, Erinnerung 2 Tage vorher, Kündigungsfrist', () => {
  const { addCycle } = require('../src/main/services/life');
  assert.equal(addCycle('2026-01-31', 'month'), '2026-02-28', 'Monatsende bleibt Monatsende');
  assert.equal(addCycle('2026-10-14', 'year'), '2027-10-14');
  const { core, cleanup } = tempCore();
  try {
    const L = core.life;
    const a = L.addSubscription({ name: 'Spotify', amount: 10.99, nextCharge: '2026-09-16', remind: true, cancelBy: '2026-10-17' });
    const n = L.dailySubs(new Date('2026-10-14T10:00:00'));
    assert.equal(n, 2);
    assert.equal(L.subscriptions()[0].nextCharge, '2026-10-16', 'verpasste Abbuchung weitergeschoben');
    const notes = core.db.all("SELECT title FROM notifications WHERE dedupe_key LIKE 'abo%'").map((x) => x.title);
    assert.ok(notes.some((t) => /Spotify wird in 2 Tagen abgebucht/.test(t)));
    assert.ok(notes.some((t) => /Kündigungsfrist Spotify: in 3 Tagen/.test(t)));
    assert.equal(L.dailySubs(new Date('2026-10-14T18:00:00')), 2, 'gleiche Meldung wird über dedupe nicht doppelt gezeigt');
    assert.equal(core.db.get("SELECT COUNT(*) n FROM notifications WHERE dedupe_key LIKE 'abo%'").n, 2);
    L.updateSubscription(a.id, { active: false });
    assert.equal(L.month().subscriptions, 0);
  } finally { cleanup(); }
});

test('Einkauf: nach Ladenbereich sortiert, keine Duplikate, gekauft → Vorräte, „leer“ → zurück auf die Liste', () => {
  const { core, cleanup } = tempCore();
  try {
    const L = core.life;
    L.addShopping(['Milch', 'Bananen', { name: 'Nudeln', qty: '2 Pck' }, 'Klopapier', 'milch', 'Brei']);
    const l = L.shoppingList();
    const sec = Object.fromEntries(l.groups.flatMap((g) => g.items.map((i) => [i.name, g.section])));
    assert.deepEqual([sec.Milch, sec.Bananen, sec.Nudeln, sec.Klopapier, sec.Brei], ['Kühlregal', 'Obst & Gemüse', 'Trockenwaren & Konserven', 'Drogerie & Haushalt', 'Sonstiges']);
    assert.equal(l.open, 5, '„milch“ doppelt → nicht nochmal');
    const milk = l.groups.flatMap((g) => g.items).find((i) => i.name === 'Milch');
    L.checkShopping(milk.id);
    assert.ok(L.pantry().some((p) => p.name === 'Milch'));
    assert.equal(L.shoppingList().open, 4);
    L.usePantry(['milch'], { toShopping: true });
    assert.ok(!L.pantry().some((p) => p.name === 'Milch'));
    assert.equal(L.shoppingList().open, 5);
    L.addPantry([{ name: 'Joghurt', expires: new Date(Date.now() + 86400000).toISOString() }]);
    assert.equal(L.dailyPantry(), 1);
  } finally { cleanup(); }
});

test('Rezeptideen aus den Vorräten (gespeichert pro Vorratsstand) und Geschenkideen aus dem Brain', async () => {
  const recipes = { recipes: [{ name: 'Nudeln mit Tomatensoße', uses: ['Nudeln', 'Passata'], minutes: 20, steps: ['Nudeln kochen', 'Soße erhitzen'] }] };
  const gifts = { ideas: [{ idea: 'Kletterhallen-Gutschein', why: 'Lisa bouldert gern', budget: '20 €' }] };
  const { core, cleanup, fake } = tempCore({ script: [{ text: JSON.stringify(recipes) }, { text: JSON.stringify(gifts) }] });
  try {
    core.secrets.set('gemini.api_key', 'AIza-test-key-123456789'); await core.gemini.discover();
    const L = core.life;
    await assert.rejects(L.recipes(), /Zu wenig Vorräte/);
    L.addPantry(['Nudeln', 'Passata', 'Zwiebel']);
    const r = await L.recipes();
    assert.equal(r.recipes[0].name, 'Nudeln mit Tomatensoße');
    const n = fake.requests.length; await L.recipes(); assert.equal(fake.requests.length, n, 'gleicher Vorratsstand → gespeichert');

    // Geburtstag in 7 Tagen im Brain → Erinnerung mit Ideen
    const d = new Date(Date.now() + 7 * 86400000);
    core.brain.add({ content: `Lisa hat am ${d.getDate()}.${d.getMonth() + 1}.1999 Geburtstag`, sourceType: 'chat' });
    core.brain.add({ content: 'Lisa geht gern bouldern und mag Fantasy-Bücher', sourceType: 'chat' });
    const up = core.birthdays.upcoming(30);
    assert.equal(up[0].name, 'Lisa'); assert.equal(up[0].inDays, 7); assert.equal(up[0].turns, d.getFullYear() - 1999);
    assert.equal(await core.birthdays.remind(), 1);
    const note = core.db.get("SELECT * FROM notifications WHERE dedupe_key LIKE 'bday7:%'");
    assert.match(note.title, /In einer Woche: Geburtstag von Lisa/); assert.match(note.body, /Kletterhallen-Gutschein/);
    assert.match(JSON.stringify(fake.requests.at(-1).contents), /bouldern/);
    assert.equal(core.birthdays.upcoming(30)[0].ideas.ideas[0].idea, 'Kletterhallen-Gutschein');
  } finally { cleanup(); }
});

test('Training: Text verstehen, Rekorde (geschätztes 1RM), Fortschritt, Pausen-Timer', async () => {
  const { parseWorkout, e1rm } = require('../src/main/services/life');
  assert.deepEqual(parseWorkout('Bankdrücken 3×8 mit 70 kg, Kniebeugen 5x5 100kg und Klimmzüge 3 x 10'), [
    { exercise: 'Bankdrücken', sets: 3, reps: 8, weight: 70 }, { exercise: 'Kniebeugen', sets: 5, reps: 5, weight: 100 }, { exercise: 'Klimmzüge', sets: 3, reps: 10, weight: 0 }]);
  assert.equal(e1rm(70, 8), 88.7);
  const { core, cleanup } = tempCore();
  try {
    const L = core.life;
    L.logWorkout([{ exercise: 'Bankdrücken', sets: 3, reps: 8, weight: 70 }], { at: new Date(Date.now() - 7 * 86400000).toISOString() });
    const r = L.logWorkout([{ exercise: 'bankdrücken', sets: 3, reps: 8, weight: 72.5 }]);
    assert.equal(r.records.length, 1);
    assert.ok(core.db.get("SELECT 1 x FROM notifications WHERE title='Neuer Rekord: bankdrücken'"));
    assert.equal(L.logWorkout([{ exercise: 'Bankdrücken', sets: 3, reps: 5, weight: 70 }]).records.length, 0, 'leichter → kein Rekord');
    const p = L.progress().find((x) => x.exercise.toLowerCase() === 'bankdrücken');
    assert.equal(p.sessions, 2); assert.equal(p.change, Math.round((e1rm(72.5, 8) - e1rm(70, 8)) * 10) / 10);
    assert.throws(() => L.logWorkout([{ exercise: 'x', sets: 0, reps: 5, weight: 10 }]), /ungültig/);
    const t = L.rest(30);
    assert.equal(t.seconds, 30);
    L.stop();
    // über Chat-Werkzeug
    const out = await core.orchestrator.execute('log_workout', { entries: [{ exercise: 'Klimmzüge', sets: 3, reps: 10, weight: 0 }] }, { conversationId: 'x', channel: 'voice' });
    assert.equal(out.response.logged[0].exercise, 'Klimmzüge');
    const ex = await core.orchestrator.execute('add_expense', { amount: 12, note: 'Döner' }, { conversationId: 'x', channel: 'voice' });
    assert.equal(ex.response.category, 'Essen & Trinken');
  } finally { cleanup(); }
});
