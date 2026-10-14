'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { tempCore } = require('./helpers');
const rec = require('../src/main/core/recurrence');
const { validate } = require('../src/main/core/validate');
const { redact } = require('../src/main/core/logger');

test('Datenbank: Migration, Schema-Version, Backup vor Migration', () => {
  const { core, cleanup } = tempCore();
  assert.equal(core.db.version, 7);
  const snap = core.db.snapshot('test');
  assert.ok(fs.existsSync(snap));
  cleanup();
});

test('Validierung entfernt unbekannte Felder und Prototype-Pollution', () => {
  const r = validate({ type: 'object', additionalProperties: false, properties: { a: { type: 'integer', minimum: 1 } } }, JSON.parse('{"a":"5","b":1,"__proto__":{"x":1}}'));
  assert.ok(r.ok); assert.deepEqual(r.value, { a: 5 });
  assert.equal(validate({ type: 'string', maxLength: 3 }, 'abcd').ok, false);
});

test('Logger schwärzt Schlüssel und Tokens', () => {
  const s = redact('key=AIzaSyA1234567890abcdefghijklmnopqrstuv token: ya29.abcDEF Bearer xyz.123 RGAPI-1234-5678-9012-3456789abcdef');
  assert.ok(!s.includes('AIzaSy')); assert.ok(!s.includes('ya29.abc')); assert.ok(!s.includes('xyz.123')); assert.ok(!s.includes('RGAPI-1234'));
});

test('Wiederholungen: täglich, wöchentlich mit Wochentagen, monatlich, RRULE-Rundreise', () => {
  const start = '2026-10-12T08:00:00.000Z'; // Montag
  assert.equal(rec.next(start, { freq: 'daily' }, new Date('2026-10-12T09:00:00Z')), '2026-10-13T08:00:00.000Z');
  const w = rec.next(start, { freq: 'weekly', byDay: ['WE', 'FR'] }, new Date('2026-10-12T09:00:00Z'));
  assert.equal(new Date(w).getUTCDay(), 3);
  assert.equal(rec.next('2026-01-31T10:00:00Z', { freq: 'monthly' }, new Date('2026-02-01T00:00:00Z')).slice(0, 10), '2026-02-28');
  const r = rec.toRRule({ freq: 'weekly', interval: 2, byDay: ['MO'] });
  assert.equal(r, 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO');
  assert.deepEqual(rec.normalize(rec.fromRRule(r)), { freq: 'weekly', interval: 2, byDay: ['MO'] });
  assert.equal(rec.between(start, { freq: 'daily' }, new Date('2026-10-12T00:00:00Z'), new Date('2026-10-15T00:00:00Z')).length, 3);
});

test('Aufgaben: anlegen, Unteraufgaben, abschließen, Routine rückt vor, Historie, Erinnerung', () => {
  const { core, cleanup } = tempCore();
  const t = core.tasks.create({ title: 'Hausarbeit abgeben', priority: 'high', dueAt: new Date(Date.now() + 3600e3).toISOString(), category: 'Studium', reminderMinutes: 120 });
  core.tasks.create({ title: 'Gliederung', parentId: t.id });
  const full = core.tasks.get(t.id);
  assert.equal(full.subtasks.length, 1);
  assert.equal(core.tasks.list({ filter: 'important' }).length, 1);
  assert.equal(core.tasks.dueReminders().length, 1, 'Erinnerung 2h vorher ist fällig');
  core.tasks.complete(t.id);
  assert.equal(core.tasks.get(t.id).status, 'done');
  const r = core.tasks.create({ title: 'Deutsch-Vokabeln', recurrence: { freq: 'daily' }, dueAt: new Date(Date.now() - 60e3).toISOString() });
  const before = core.tasks.get(r.id).dueAt;
  core.tasks.complete(r.id);
  const after = core.tasks.get(r.id);
  assert.equal(after.status, 'open'); assert.ok(after.dueAt > before);
  assert.ok(after.history.some((h) => h.action === 'occurrence_done'));
  assert.equal(core.tasks.board().recurring.length, 1);
  assert.throws(() => core.tasks.create({ title: '' }));
  cleanup();
});

test('Kalender: lokale Termine, Serien, freie Slots, ohne Google', async () => {
  const { core, cleanup } = tempCore();
  const day = new Date(); day.setDate(day.getDate() + 1); day.setHours(10, 0, 0, 0);
  const e = await core.calendar.create({ title: 'Projektbesprechung KI', start: day.toISOString() });
  assert.equal(e.source, 'local');
  await core.calendar.create({ title: 'Sport', start: new Date(day.getTime() + 7 * 3600e3).toISOString(), recurrence: { freq: 'daily' } });
  const from = new Date(day); from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + 3 * 86400e3);
  const list = core.calendar.list(from, to);
  assert.equal(list.filter((x) => x.title === 'Sport').length, 3);
  const slots = core.calendar.freeSlots({ from: from.toISOString(), to: new Date(from.getTime() + 86400e3).toISOString(), minutes: 90 });
  assert.ok(slots.every((s) => !(Date.parse(s.start) < Date.parse(e.end) && Date.parse(s.end) > Date.parse(e.start))), 'kein Slot überlappt den Termin');
  await core.calendar.update(e.id, { title: 'Projekt KI' });
  assert.equal(core.calendar.get(e.id).title, 'Projekt KI');
  await core.calendar.remove(e.id);
  assert.equal(core.calendar.get(e.id), null);
  cleanup();
});

test('Kalender: Google-Sync mit Fake-API (Push-Queue, Pull, Konflikt)', async () => {
  const remote = new Map();
  let n = 0;
  const google = {
    isConnected: () => true,
    listCalendars: async () => ({ items: [{ id: 'primary@x', summary: 'Privat', primary: true, accessRole: 'owner' }] }),
    listEvents: async () => [...remote.values()],
    insertEvent: async (cal, ev) => { const g = { id: 'g' + (++n), etag: 'e1', updated: new Date().toISOString(), status: 'confirmed', ...ev }; remote.set(g.id, g); return g; },
    patchEvent: async (cal, id, ev) => { const g = { ...remote.get(id), ...ev, updated: new Date().toISOString() }; remote.set(id, g); return g; },
    getEvent: async (cal, id) => remote.get(id),
    deleteEvent: async (cal, id) => { remote.delete(id); },
  };
  const { core, cleanup } = tempCore();
  core.calendar.google = google;
  await core.calendar.sync();
  assert.equal(core.calendar.defaultCalendarId(), 'primary@x');
  const start = new Date(Date.now() + 86400e3).toISOString();
  const e = await core.calendar.create({ title: 'Mathe lernen', start });
  assert.equal(e.source, 'google'); assert.equal(e.syncState, 'synced');
  assert.equal(remote.size, 1);
  // Remote-only event appears after sync
  remote.set('gx', { id: 'gx', summary: 'Vom Handy', start: { dateTime: start }, end: { dateTime: new Date(Date.parse(start) + 3600e3).toISOString() }, updated: new Date().toISOString(), status: 'confirmed' });
  await core.calendar.sync();
  assert.ok(core.calendar.list(new Date(), new Date(Date.now() + 2 * 86400e3)).some((x) => x.title === 'Vom Handy'));
  // Conflict: local pending edit + newer remote change
  const ev = core.db.get("SELECT * FROM events WHERE title='Mathe lernen'");
  core.db.run("UPDATE events SET sync_state='pending_update', title='Mathe (lokal)', remote_updated='2000-01-01T00:00:00Z' WHERE id=?", ev.id);
  remote.get(ev.google_id).updated = new Date(Date.now() + 1000).toISOString();
  await core.calendar.sync();
  assert.equal(core.calendar.get(ev.id).syncState, 'conflict');
  cleanup();
});

test('Brain: Duplikate, Ersetzen persönlicher Fakten, Konflikt bei Quellen, sensible Auto-Speicherung, Hybrid-Suche', async () => {
  const { core, cleanup } = tempCore();
  core.secrets.set('gemini.api_key', 'AIza-test-key-123456789');
  core.settings.update({ models: { embedding: 'gemini-embedding-2' } });
  const a = core.brain.add({ content: 'Mein Lieblingschampion ist Jhin', subjectKey: 'lieblingschampion', domain: 'gaming', sourceType: 'chat' });
  assert.equal(a.action, 'created');
  assert.equal(core.brain.add({ content: 'mein lieblingschampion ist JHIN!', sourceType: 'chat' }).action, 'duplicate');
  const b = core.brain.add({ content: 'Mein Lieblingschampion ist jetzt Kai\'Sa', subjectKey: 'Lieblingschampion', domain: 'gaming', sourceType: 'chat' });
  assert.equal(b.action, 'superseded');
  assert.equal(core.brain.get(a.entry.id).archived, true);
  core.brain.add({ content: 'Patch 14.1 bufft Jhin', subjectKey: 'jhin-patch', sourceType: 'web' });
  assert.equal(core.brain.add({ content: 'Patch 14.1 nerft Jhin', subjectKey: 'jhin-patch', sourceType: 'web' }).action, 'conflict');
  assert.equal(core.brain.add({ content: 'Ich habe eine Depression diagnostiziert bekommen' }, { auto: true }).action, 'rejected');
  core.brain.add({ content: 'Projekt Hausautomation mit Home Assistant und lokalem LLM', domain: 'projects' });
  const r = await core.brain.search('Hausautomation LLM');
  assert.equal(r.results[0].domain, 'projects');
  // semantic part
  await core.vectors.backfill();
  assert.ok(core.vectors.count('k') >= 3);
  const r2 = await core.brain.search('home assistant');
  assert.ok(r2.semantic);
  const g = core.brain.graph();
  assert.ok(g.nodes.some((n) => n.type === 'core') && g.nodes.some((n) => n.domain === 'projects' && n.type === 'entry'));
  cleanup();
});

test('Studium: PDF/MD indexieren, inkrementell, Duplikat, Suche mit Seitenzitat', async () => {
  const { core, dir, cleanup } = tempCore();
  const folder = path.join(dir, 'OneDrive', 'Studium');
  fs.mkdirSync(path.join(folder, 'Mathe'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'fixture.pdf'), path.join(folder, 'Mathe', 'Analysis.pdf'));
  fs.writeFileSync(path.join(folder, 'Mathe', 'notizen.md'), '# Neuronale Netze\n\nBackpropagation berechnet Gradienten mit der Kettenregel.');
  core.settings.update({ study: { folder, source: 'folder', enabled: true } });
  assert.equal(core.study.checkFolder(folder).ok, true);
  await core.study.scan();
  const st = core.study.status();
  assert.equal(st.indexed, 2);
  const r = await core.brain.search('Scheitelpunktform', { scope: 'documents' });
  assert.equal(r.results[0].subject, 'Mathe');
  assert.match(r.results[0].citation, /Analysis\.pdf – S\. 1/);
  const again = await core.study.indexFile(path.join(folder, 'Mathe', 'Analysis.pdf'));
  assert.ok(again.unchanged, 'unveränderte Datei wird nicht neu verarbeitet');
  fs.copyFileSync(path.join(folder, 'Mathe', 'Analysis.pdf'), path.join(folder, 'Kopie.pdf'));
  const dup = await core.study.indexFile(path.join(folder, 'Kopie.pdf'));
  assert.ok(dup.duplicateOf, 'identischer Inhalt wird nicht doppelt indexiert');
  cleanup();
});

test('Gaming: Kontext aktiv vs. besprochen, Prozess-Erkennung, manuelle Auswahl hat Vorrang, Timer feuert als Schätzung', async () => {
  const pushed = [];
  const { core, cleanup } = tempCore({ toast: (t, b) => pushed.push([t, b]) });
  const ctx = core.gaming.context;
  assert.equal(ctx.resolve('ich zocke gerade Escape from Tarkov').id, 'eft');
  assert.equal(ctx.resolve('ARK').id, 'ark');
  ctx.setActive('eft', 'explicit');
  ctx.setDiscussed('rok');
  let st = ctx.state();
  assert.equal(st.active.id, 'eft'); assert.equal(st.discussed.id, 'rok');
  await ctx.poll(['explorer.exe', 'league of legends.exe']);
  assert.equal(ctx.state().active.id, 'eft', 'explizite Auswahl schlägt Prozess');
  ctx.clearActive();
  await ctx.poll(['League of Legends.exe']);
  assert.equal(ctx.state().active.id, 'league');
  await ctx.poll([]);
  assert.equal(ctx.state().active, null);
  const custom = ctx.resolve('Hollow Knight Silksong');
  assert.equal(custom.integration, 'generic');
  assert.equal(core.gaming.layout(custom.id).widgets.some((w) => w.type === 'wiki'), false, 'kein Wiki-Widget ohne Wiki');
  const t = core.gaming.addTimer({ game: 'Rise of Kingdoms', label: 'Rathaus', kind: 'build', minutes: 0.1 });
  assert.ok(t.estimate);
  core.db.run('UPDATE game_timers SET ends_at=? WHERE id=?', new Date(Date.now() - 1000).toISOString(), t.id);
  assert.equal(core.gaming.checkTimers(), 1);
  const n = core.notifications.list({ category: 'gaming' })[0];
  assert.equal(n.origin, 'timer'); assert.match(n.body, /kein bestätigter Spielstatus/);
  assert.throws(() => core.gaming.pushWidget('eft', 'lol-overview', {}));
  assert.throws(() => core.gaming.pushWidget('eft', '<script>', {}));
  const mk = core.gaming.addMarker('eft', 'customs', { x: 0.4, y: 0.5, category: 'loot', label: 'Dorms' });
  assert.equal(core.gaming.markers('eft', 'customs')[0].id, mk);
  assert.throws(() => core.gaming.addMarker('eft', 'customs', { x: 2, y: 0 }));
  cleanup();
});

test('Orchestrator: Werkzeugschleife, Bestätigungspflicht, Einmal-Token, Quellen', async () => {
  const script = [
    { calls: [{ name: 'create_task', args: { title: 'Mathe lernen', category: 'Studium' } }, { name: 'create_event', args: { title: 'Mathe lernen', start: new Date(Date.now() + 86400e3).toISOString() } }] },
    { text: 'Aufgabe angelegt, Termin wartet auf deine Bestätigung, Chef.' },
  ];
  const { core, fake, cleanup } = tempCore({ script });
  core.secrets.set('gemini.api_key', 'AIza-test-key-123456789');
  await core.gemini.discover();
  const cards = [];
  core.bus.on('chat:card', (c) => cards.push(c.card));
  const msg = await core.orchestrator.chat({ text: 'Jarvis, trag morgen Mathe lernen ein' });
  assert.match(msg.content, /Bestätigung/);
  assert.equal(core.tasks.list().length, 1, 'Aufgabe ohne Rückfrage');
  assert.equal(core.calendar.list(new Date(), new Date(Date.now() + 3 * 86400e3)).length, 0, 'Termin NICHT ohne Bestätigung');
  const confirm = cards.find((c) => c.kind === 'confirm');
  assert.ok(confirm);
  // tool response told the model it is not executed yet
  const fr = fake.requests[1].contents.flatMap((c) => c.parts).find((p) => p.functionResponse?.name === 'create_event');
  assert.equal(fr.functionResponse.response.status, 'awaiting_user_confirmation');
  await core.orchestrator.resolveConfirmation(confirm.token, true);
  assert.equal(core.calendar.list(new Date(), new Date(Date.now() + 3 * 86400e3)).length, 1);
  await assert.rejects(core.orchestrator.resolveConfirmation(confirm.token, true), /abgelaufen oder wurde bereits verwendet/);
  // invalid tool args are rejected, not executed
  const bad = await core.orchestrator.execute('create_task', { title: 5 });
  assert.ok(bad.response.error);
  const unk = await core.orchestrator.execute('rm_rf', {});
  assert.match(unk.response.error, /Unbekanntes Werkzeug/);
  cleanup();
});

test('Orchestrator ohne Schlüssel: klare Meldung statt Absturz', async () => {
  const { core, cleanup } = tempCore();
  const m = await core.orchestrator.chat({ text: 'Hallo' });
  assert.match(m.content, /Gemini-API-Schlüssel/);
  cleanup();
});

test('Modellauswahl: nur bestätigte Modelle, Rollen-Zuordnung', async () => {
  const { core, cleanup } = tempCore();
  const r = await core.gemini.discover('AIza-x');
  assert.equal(r.chosen.fast, 'gemini-3.8-flash');
  assert.equal(r.chosen.live, 'gemini-3.8-live');
  assert.equal(r.chosen.embedding, 'gemini-embedding-2');
  assert.equal(r.requested.every((x) => x.available), true);
  cleanup();
});

test('Web: SSRF-Schutz und HTML-Bereinigung', async () => {
  const { assertPublicUrl, htmlToText } = require('../src/main/services/web');
  await assert.rejects(assertPublicUrl('http://example.com'), /https/);
  await assert.rejects(assertPublicUrl('https://127.0.0.1/x'), /Private/);
  await assert.rejects(assertPublicUrl('https://localhost/x'), /Lokale/);
  await assert.rejects(assertPublicUrl('https://user:pw@example.com'), /Zugangsdaten/);
  const t = htmlToText('<html><title>T</title><script>alert(1)</script><h1>Hallo</h1><p>Welt &amp; mehr</p></html>');
  assert.equal(t.title, 'T'); assert.ok(!t.text.includes('alert')); assert.match(t.text, /# Hallo/); assert.match(t.text, /Welt & mehr/);
});

test('Backup: erstellen, prüfen, Wiederherstellung beim Start', () => {
  const { core, dir, cleanup } = tempCore();
  core.tasks.create({ title: 'Vor dem Backup' });
  const b = core.system.createBackup();
  core.tasks.create({ title: 'Nach dem Backup' });
  core.system.stageRestore(b.file);
  core.stop();
  const { System } = require('../src/main/services/system');
  assert.equal(System.applyPendingRestore(dir), true);
  const { createCore } = require('../src/main/app-core');
  const c2 = createCore({ dataDir: dir, version: '3.0.0' });
  assert.deepEqual(c2.tasks.list().map((t) => t.title), ['Vor dem Backup']);
  c2.stop();
  fs.rmSync(dir, { recursive: true, force: true });
  void cleanup;
});

test('Benachrichtigungen: Ruhezeiten, Deduplizierung', () => {
  const toasts = [];
  const { core, cleanup } = tempCore({ toast: (t) => toasts.push(t) });
  core.notifications.push({ title: 'A', dedupeKey: 'x' });
  assert.equal(core.notifications.push({ title: 'A', dedupeKey: 'x' }), null);
  assert.equal(toasts.length, 1);
  core.settings.update({ quietHours: { enabled: true, from: '00:00', to: '23:59' } });
  core.notifications.push({ title: 'B' });
  assert.equal(toasts.length, 1, 'Ruhezeit unterdrückt Toast');
  assert.equal(core.notifications.unreadCount(), 2);
  cleanup();
});

test('Kalender: ganztägige Termine, Geburtstags-/Kategorie-Farben, eigene Farbe, jährliche Wiederholung', async () => {
  const { core, cleanup } = tempCore();
  const day = new Date(2026, 10, 20, 15, 30); // 20.11.2026 15:30 lokal
  const b = await core.calendar.create({ title: 'Geburtstag Mama', start: day.toISOString(), allDay: true, recurrence: { freq: 'yearly' } });
  assert.equal(b.allDay, true);
  assert.equal(new Date(b.start).getHours(), 0, 'auf Mitternacht gerundet');
  assert.equal(Date.parse(b.end) - Date.parse(b.start), 86400000, 'Ende exklusiv am Folgetag');
  assert.equal(b.category, 'birthday'); assert.equal(b.icon, '🎂'); assert.equal(b.color, '#f472b6');
  const next = core.calendar.list(new Date(2027, 10, 19), new Date(2027, 10, 22));
  assert.ok(next.some((e) => e.title === 'Geburtstag Mama'), 'jährlich wiederholt');
  // Dienst-Ebene: Ende exklusiv (wie Google) – 1. bis einschließlich 5. Juli = Ende 6. Juli 00:00
  const u = await core.calendar.create({ title: 'Urlaub Ostsee', start: new Date(2026, 6, 1).toISOString(), end: new Date(2026, 6, 6).toISOString(), allDay: true });
  assert.equal(Math.round((Date.parse(u.end) - Date.parse(u.start)) / 86400000), 5, '1.–5. Juli inklusive = 5 Tage');
  assert.equal(u.category, 'vacation');
  const k = await core.calendar.create({ title: 'Klausur Mathe II', start: new Date(2026, 11, 3, 9).toISOString() });
  assert.equal(k.category, 'exam');
  const own = await core.calendar.update(k.id, { color: '7' });
  assert.equal(own.color, '#039be5', 'eigene Farbe schlägt Kategorie'); assert.equal(own.colorId, '7');
  const back = await core.calendar.update(k.id, { color: 'auto' });
  assert.equal(back.color, '#f87171');
  const plain = await core.calendar.create({ title: 'Kaffee mit Max', start: new Date(2026, 11, 3, 15).toISOString() });
  assert.equal(plain.category, null); assert.equal(plain.color, plain.calendarColor);
  cleanup();
});

test('Kosten: fester Systemteil bleibt gleich (Cache), Kontext an der neuesten Nachricht, wenig Denken bei normalen Fragen, Verbrauch pro Funktion', async () => {
  const script = [{ text: 'Hi Chef.' }, { text: 'Klar.' }, { text: 'Plan steht.' }];
  const { core, fake, cleanup } = tempCore({ script });
  try {
    core.secrets.set('gemini.api_key', 'AIza-test-key-123456789');
    await core.gemini.discover();
    const conv = core.conversations.current();
    await core.orchestrator.chat({ conversationId: conv.id, text: 'Hallo Jarvis' });
    await new Promise((r) => setTimeout(r, 1100)); // andere Uhrzeit darf den festen Teil nicht ändern
    await core.orchestrator.chat({ conversationId: conv.id, text: 'Wie spät ist es?' });
    const [a, b] = fake.requests;
    assert.equal(a.config.systemInstruction, b.config.systemInstruction, 'fester Teil identisch');
    assert.doesNotMatch(a.config.systemInstruction, /Jetzt: /);
    const last = [...b.contents].reverse().find((c) => c.role === 'user'); // (Anfrage-Objekt wird danach um die Antwort ergänzt)
    assert.match(last.parts[0].text, /Aktueller Kontext[\s\S]*Jetzt: /);
    assert.match(last.parts.at(-1).text, /Wie spät ist es\?/);
    // der Kontext der ersten Nachricht wird nicht gespeichert → Verlauf vorne bleibt gleich
    const firstUserInB = b.contents.find((c) => c.role === 'user');
    assert.doesNotMatch(JSON.stringify(firstUserInB), /Aktueller Kontext/);
    assert.deepEqual(a.config.thinkingConfig, { thinkingLevel: 'low' }, 'normale Frage: wenig Denken');
    // Analyse → Reasoning-Modell mit voller Denktiefe
    await core.orchestrator.chat({ conversationId: conv.id, text: 'Erstelle mir einen Lernplan für Mathe' });
    assert.deepEqual(fake.requests[2].config.thinkingConfig, { thinkingLevel: 'high' });
    // Modus „Immer maximal“: kein Sparen
    core.settings.update({ aiCostMode: 'max' });
    assert.equal(core.gemini.thinkingFor('gemini-3.8-flash', 'low'), undefined);
    assert.deepEqual(core.gemini.thinkingFor('gemini-2.5-flash', 'high'), undefined);
    core.settings.update({ aiCostMode: 'spar' });
    assert.deepEqual(core.gemini.thinkingFor('gemini-2.5-flash', 'low'), { thinkingBudget: 512 });
    // Verbrauch wird pro Funktion gezählt
    core.gemini.record('voice', 'gemini-3.8-live', { promptTokenCount: 1000, cachedContentTokenCount: 600, responseTokenCount: 50 });
    const rep = core.gemini.usageReport(1);
    assert.equal(rep.features.chat.req, 3);
    assert.equal(rep.features.voice.in, 1000); assert.equal(rep.features.voice.cached, 600);
  } finally { cleanup(); }
});

test('Kosten: Modell lehnt thinkingConfig ab → einmal ohne wiederholen, danach gemerkt', async () => {
  const { core, cleanup } = tempCore();
  try {
    let calls = 0;
    const r = await core.gemini.withThinking('gemini-x-flash', 'low', async (t) => { calls++; if (t) throw Object.assign(new Error('400 INVALID_ARGUMENT: thinking_level is not supported'), { status: 400 }); return 'ok'; });
    assert.equal(r, 'ok'); assert.equal(calls, 2);
    assert.equal(core.gemini.thinkingFor('gemini-x-flash', 'low'), undefined);
  } finally { cleanup(); }
});

test('Kostenbremse: Schätzung nach Modell, Eichen mit AI-Studio-Stand, Warnung und Sparstufe', async () => {
  const { costUsd } = require('../src/main/services/costguard');
  // 1 Mio. Eingabe (davon 800k Cache) + 100k Ausgabe + 100k Denken mit Flash-Preisen
  assert.ok(Math.abs(costUsd('gemini-3.8-flash', { in: 1e6, cached: 8e5, out: 1e5, think: 1e5 }) - (0.2 * 0.5 + 0.8 * 0.05 + 0.2 * 3)) < 1e-9);
  const { core, cleanup } = tempCore();
  try {
    core.secrets.set('gemini.api_key', 'AIza-test-key-123456789');
    await core.gemini.discover();
    core.settings.update({ aiBudget: { monthlyEur: 5 } });
    assert.equal(core.costGuard.status().level, 'ok');
    // geeicht: 4,00 € laut AI Studio → 80 % → Warnung
    core.costGuard.calibrate('4,00');
    let st = core.costGuard.check();
    assert.equal(st.level, 'warn'); assert.equal(st.calibrated, true);
    assert.ok(core.notifications.list({ limit: 10 }).some((n) => /Budget: Achtung/.test(n.title)));
    // Verbrauch nach dem Eichen kommt dazu (Pro: 1 Mio. Ausgabe ≈ 12 $ → weit über Budget) → Sparstufe
    core.gemini.record('chat', 'gemini-3.1-pro-preview', { promptTokenCount: 1000, candidatesTokenCount: 1e6 });
    st = core.costGuard.check();
    assert.equal(st.level, 'brake'); assert.equal(st.braking, true);
    assert.equal(core.gemini.model('reasoning'), core.gemini.model('fast'), 'keine Pro-Analysen in der Sparstufe');
    assert.deepEqual(core.gemini.thinkingFor('gemini-3.8-flash', 'high'), { thinkingLevel: 'low' });
    await assert.rejects(core.gemini.generate({ feature: 'lol', contents: [] }), /Kostenbremse/);
    // Sparstufe abschaltbar
    core.settings.update({ aiBudget: { brake: false } });
    assert.equal(core.costGuard.braking(), false);
    assert.throws(() => core.costGuard.calibrate('abc'), /Betrag/);
  } finally { cleanup(); }
});

test('Schlüssel-Sicherung: mit Passwort verschlüsselt im Backup, auf anderem PC mit Passwort wiederherstellbar; Einstellungen exportierbar', async () => {
  const kv = require('../src/main/core/keyvault');
  const b = kv.seal({ 'gemini.api_key': 'AIza-geheim-123', 'campusdual.cookies': '[]', 'backup.password': 'x' }, 'sehr-geheim');
  assert.equal(b.count, 1, 'Sitzungs-Cookies und Backup-Passwort nicht enthalten');
  assert.ok(!JSON.stringify(b).includes('AIza-geheim'), 'nichts im Klartext');
  assert.deepEqual(kv.open(b, 'sehr-geheim'), { 'gemini.api_key': 'AIza-geheim-123' });
  assert.throws(() => kv.open(b, 'falsch!!'), /Falsches Backup-Passwort/);
  assert.throws(() => kv.seal({}, 'kurz'), /mindestens 8/);

  const { core, cleanup } = tempCore();
  const other = tempCore();
  try {
    core.secrets.set('gemini.api_key', 'AIza-geheim-123');
    core.secrets.set('riot.api_key', 'RGAPI-xyz');
    core.secrets.set('backup.password', 'mein-backup-pw');
    const zipFile = path.join(core.paths.data, 'b.zip');
    core.system.createBackup(zipFile, { secrets: false }); // wie das Drive-Backup
    const { unzipSync } = require('fflate');
    const z = unzipSync(new Uint8Array(fs.readFileSync(zipFile)));
    assert.ok(!z['secrets.json'], 'keine DPAPI-Datei im Drive-Backup');
    assert.ok(z['keys.jarvis.json'], 'passwortgeschützte Schlüssel enthalten');
    assert.ok(!Buffer.from(z['keys.jarvis.json']).toString().includes('RGAPI'));
    // „anderer PC“: Wiederherstellen fragt nach dem Passwort und übernimmt die Schlüssel
    const r1 = other.core.system.stageRestore(zipFile);
    assert.equal(r1.needsPassword, true); assert.equal(r1.keysInBackup, 2);
    assert.throws(() => other.core.system.stageRestore(zipFile, { password: 'falsch-falsch' }), /Falsches/);
    const r2 = other.core.system.stageRestore(zipFile, { password: 'mein-backup-pw' });
    assert.equal(r2.staged, true); assert.equal(r2.keysRestored, 2);
    assert.equal(other.core.secrets.get('riot.api_key'), 'RGAPI-xyz');
    // Einstellungen: Export-Inhalt lässt sich wieder einspielen (Schema-Prüfung)
    core.settings.update({ nickname: 'Cheffe', gaming: { eftFaction: 'scav' } });
    const { availableModels, ...settings } = core.settings.all();
    other.core.settings.update(JSON.parse(JSON.stringify(settings)));
    assert.equal(other.core.settings.get('nickname'), 'Cheffe'); assert.equal(other.core.settings.get('gaming').eftFaction, 'scav');
  } finally { cleanup(); other.cleanup(); }
});
