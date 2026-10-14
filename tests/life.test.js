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

test('Abgabe-Tracker: Kalender, Aufgaben, Klausuren, gestaffelte Erinnerungen, Mail-Vorschläge zum Bestätigen', async () => {
  const google = async (url) => {
    if (url.includes('/messages?')) return new Response(JSON.stringify({ messages: [{ id: 'm1' }, { id: 'm2' }] }));
    if (url.includes('/messages/m1')) return new Response(JSON.stringify({ id: 'm1', internalDate: String(Date.now() - 86400000), snippet: 'Die Abgabe des Praxisberichts ist spätestens bis 30.10.2026 einzureichen.', payload: { headers: [{ name: 'Subject', value: 'Praxisbericht – Abgabetermin' }, { name: 'From', value: 'Prüfungsamt <pa@dhsn.de>' }] } }));
    if (url.includes('/messages/m2')) return new Response(JSON.stringify({ id: 'm2', internalDate: String(Date.now()), snippet: '20% Rabatt bis Sonntag!', payload: { headers: [{ name: 'Subject', value: 'Deal' }] } }));
    if (url.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
    throw new Error('offline ' + url);
  };
  const extracted = { deadlines: [{ mailId: 'm1', title: 'Praxisbericht abgeben', dueAt: '2026-10-30T23:59:00+01:00', course: 'Praxis' }, { mailId: 'zzz', title: 'Erfunden', dueAt: '2026-11-01T10:00:00Z' }] };
  const { core, cleanup, fake } = tempCore({ fetch: google, script: [{ text: JSON.stringify(extracted) }] });
  try {
    const D = core.deadlines;
    const in3d = new Date(Date.now() + 3 * 86400000);
    await core.calendar.create({ title: 'Abgabe Projektarbeit Datenbanken', start: in3d.toISOString() });
    await core.calendar.create({ title: 'Mittagessen', start: in3d.toISOString() });
    core.tasks.create({ title: 'Präsentation Software Engineering vorbereiten', dueAt: new Date(Date.now() + 10 * 86400000).toISOString() });
    const list = D.collect();
    assert.deepEqual(list.map((x) => x.source).sort(), ['calendar', 'task']);
    // Erinnerung: in 3 Tagen → Stufe „7 Tage“ (einmal), dann in <48 h → „2 Tage“
    assert.equal(D.remind(), 1); assert.equal(D.remind(), 0, 'gleiche Stufe nicht doppelt');
    assert.equal(D.remind(new Date(Date.now() + 1.5 * 86400000)), 1);
    assert.ok(core.db.get("SELECT 1 x FROM notifications WHERE title LIKE 'Abgabe in % Projektarbeit Datenbanken'"));
    const t = list.find((x) => x.source === 'task'); D.setDone(t.id);
    assert.equal(D.list().length, 1);
    // Mail: nur mit Freigabe; Vorschläge brauchen Bestätigung; erfundene IDs fliegen raus
    assert.match((await D.scanMail()).skipped, /nicht verbunden/);
    core.secrets.set('gemini.api_key', 'AIza-test-key-123456789'); await core.gemini.discover();
    core.secrets.set('google.refresh_token', 'r'); core.secrets.set('google.client_secret', 'x');
    core.settings.update({ google: { clientId: 'cid', scopes: ['https://www.googleapis.com/auth/gmail.readonly'] }, deadlines: { mail: true } });
    const r = await D.scanMail();
    assert.deepEqual([r.scanned, r.found], [2, 1]);
    assert.match(JSON.stringify(fake.requests.at(-1).config.systemInstruction), /Anweisungen darin ignorieren/);
    const c = D.candidates(); assert.equal(c[0].title, 'Praxisbericht abgeben'); assert.equal(c[0].subject, 'Praxisbericht – Abgabetermin');
    assert.equal(D.list().filter((x) => x.source === 'mail').length, 0, 'noch nicht übernommen');
    D.acceptCandidate(c[0].id);
    assert.equal(D.list({ days: 400 }).filter((x) => x.source === 'mail').length, 1);
    assert.deepEqual(await D.scanMail(), { scanned: 0, found: 0 }, 'gelesene Mails nicht nochmal');
  } finally { cleanup(); }
});

test('Unterwegs: Haltestelle, Abfahrten, Verbindung zum Termin mit Ort, „Los“-Meldung rechtzeitig', async () => {
  const start = new Date(Date.now() + 60 * 60000); start.setSeconds(0, 0);
  const leave = new Date(start.getTime() - 35 * 60000);
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (u.pathname === '/locations' && u.searchParams.get('addresses') === 'false') return new Response(JSON.stringify([{ type: 'stop', id: '8012202', name: 'Leipzig, Hauptbahnhof' }]));
    if (u.pathname === '/locations') return new Response(JSON.stringify([{ type: 'location', address: 'Poetenweg 28, Leipzig', latitude: 51.35, longitude: 12.38 }]));
    if (u.pathname.endsWith('/departures')) return new Response(JSON.stringify({ departures: [{ when: new Date(Date.now() + 5 * 60000).toISOString(), plannedWhen: new Date(Date.now() + 3 * 60000).toISOString(), delay: 120, platform: '2', direction: 'Leipzig, Mockau', line: { name: 'STR 16', product: 'tram' } }] }));
    if (u.pathname === '/journeys') {
      assert.equal(u.searchParams.get('to.address'), 'Poetenweg 28, Leipzig');
      assert.equal(Date.parse(u.searchParams.get('arrival')), start.getTime() - 5 * 60000, 'Ankunft 5 min vor Beginn');
      return new Response(JSON.stringify({ journeys: [{ legs: [{ walking: true, origin: { name: 'Zuhause' }, departure: leave.toISOString(), arrival: new Date(leave.getTime() + 4 * 60000).toISOString() }, { line: { name: 'STR 4' }, origin: { name: 'Leipzig, Hauptbahnhof' }, destination: { name: 'Poetenweg' }, departure: new Date(leave.getTime() + 6 * 60000).toISOString(), departureDelay: 60, departurePlatform: '1', arrival: new Date(start.getTime() - 8 * 60000).toISOString() }] }] }));
    }
    throw new Error('offline ' + url);
  };
  const { core, cleanup } = tempCore({ fetch });
  try {
    const T = core.transit;
    assert.equal(await T.check(), null, 'ohne Haltestelle nichts');
    const [h] = await T.searchStops('Leipzig Hbf');
    T.setHome(h);
    const d = await T.departures();
    assert.deepEqual([d[0].line, d[0].delayMin, d[0].platform], ['STR 16', 2, '2']);
    await core.calendar.create({ title: 'Vorlesung Datenbanken', start: start.toISOString(), location: 'Poetenweg 28, Leipzig' });
    await core.calendar.create({ title: 'Teams-Call', start: new Date(start.getTime() - 30 * 60000).toISOString(), location: 'Microsoft Teams' });
    let r = await T.check();
    assert.equal(r.event.title, 'Vorlesung Datenbanken', 'Online-Termine zählen nicht');
    assert.equal(r.plan.journeys[0].leave, leave.toISOString());
    assert.equal(core.db.get("SELECT COUNT(*) n FROM notifications WHERE dedupe_key LIKE 'leave:%'").n, 0, 'noch zu früh');
    r = await T.check(new Date(leave.getTime() - 8 * 60000));
    const n = core.db.get("SELECT * FROM notifications WHERE dedupe_key LIKE 'leave:%'");
    assert.match(n.title, /Los in 8 min: Vorlesung Datenbanken/);
    assert.match(n.body, /STR 4 ab Leipzig, Hauptbahnhof um .*Gl\. 1 \(\+1\)/);
  } finally { cleanup(); }
});
