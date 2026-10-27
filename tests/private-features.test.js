'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { tempCore } = require('./helpers');
const { local } = require('../src/main/core/privacy');
const { LocalLLM } = require('../src/main/providers/local');

const response = (text = 'Lokal erledigt') => ({ text, parts: [{ text }], functionCalls: [] });
const r = (v) => Math.round(v * 100) / 100;
const ym = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; };

test('Private messages: local without API key, no cloud fallback on local failure (also on retry)', async () => {
  const { core: s, fake, cleanup } = tempCore();
  try {
    const c = s.conversations.create(); assert.equal(c.privacy, 'auto');
    s.localLLM.stepStream = async (o) => { o.onText('nur lokal'); return response('nur lokal'); };
    const m = await s.orchestrator.chat({ conversationId: c.id, text: 'Mein Gehalt' });
    assert.equal(m.content, 'nur lokal'); assert.equal(fake.requests.length, 0);
    s.secrets.set('gemini.api_key', 'test');
    s.localLLM.stepStream = async () => { throw new Error('offline'); };
    const failure = await s.orchestrator.chat({ conversationId: c.id, text: 'Ausgaben' });
    assert.equal(failure.meta.error, true); assert.equal(fake.requests.length, 0);
    await s.orchestrator.retry({ conversationId: c.id, messageId: failure.id });
    assert.equal(fake.requests.length, 0);
  } finally { cleanup(); }
});

test('Buckets: book expenses into a bucket (partial, overspend), chart data, removal keeps the expenses', async () => {
  const { core: s, cleanup } = tempCore();
  try {
    s.life.addIncome({ amount: 1000 });
    const urlaub = s.life.saveBucket({ name: 'Urlaub', amount: 300, month: ym() });
    const essen = s.life.saveBucket({ name: 'Essen gehen', amount: 50, month: ym(), category: 'Essen & Trinken' });
    s.life.addExpense({ amount: 120, note: 'Hotel', bucketId: urlaub.id });
    s.life.addExpense({ amount: '30,5', bucketId: urlaub.id });
    s.life.addExpense({ amount: 60, note: 'Sushi', bucketId: essen.id });
    let [u, e] = [s.life.bucket(urlaub.id), s.life.bucket(essen.id)];
    assert.deepEqual([u.spent, u.remaining, u.over, u.bookings], [150.5, 149.5, 0, 2]);
    assert.deepEqual([e.spent, e.remaining, e.over], [60, 0, 10], 'überzogen');
    assert.equal(s.life.bucketExpenses(urlaub.id).find((x) => !x.note.includes('Hotel')).note, 'Urlaub', 'ohne Notiz → Bucket-Name');
    assert.equal(s.life.bucketExpenses(essen.id)[0].category, 'Essen & Trinken', 'Kategorie des Buckets');
    let m = s.life.month();
    assert.equal(m.total, 210.5); assert.equal(m.reserved, 149.5, 'nur der offene Rest ist reserviert');
    assert.equal(m.balance, r(1000 - 210.5 - 149.5), 'nichts doppelt abgezogen');
    // Rest bezahlt → Bucket voll, bleibt sichtbar
    s.life.bookBucket(urlaub.id); u = s.life.bucket(urlaub.id);
    assert.deepEqual([u.spent, u.remaining, u.bookings], [300, 0, 3]);
    assert.throws(() => s.life.bookBucket(urlaub.id), /bereits gebucht/);
    assert.throws(() => s.life.addExpense({ amount: 5, bucketId: 'nope' }), /Bucket nicht gefunden/);
    // Name-Suche (für den Chat) und Löschen
    assert.equal(s.life.findBucket('essen').id, essen.id);
    s.life.removeBucket(essen.id);
    assert.equal(s.life.month().total, 360, 'Ausgaben bleiben nach dem Löschen erhalten');
    assert.equal(s.life.bucket(essen.id), null);
    // Chat-Werkzeuge: „15 € aus dem Urlaub-Bucket“ / spend per Name
    const ctx = { conversationId: 'x', channel: 'voice' };
    const kino = s.life.saveBucket({ name: 'Kino', amount: 40, month: ym() });
    const a = await s.orchestrator.execute('add_expense', { amount: 15, note: 'Popcorn', bucket: 'kino' }, ctx);
    assert.equal(a.response.bucket, 'Kino'); assert.equal(a.response.bucketRemaining, 25);
    const b = await s.orchestrator.execute('expense_buckets', { action: 'spend', name: 'Kino', amount: 12, note: 'Ticket' }, ctx);
    assert.equal(b.response.remaining, 13); assert.equal(s.life.bucket(kino.id).bookings, 2);
  } finally { cleanup(); }
});

test('Auto privacy per message: public → Gemini without personal primer or private history, private → local, switching back and forth', async () => {
  const { core: s, fake, cleanup } = tempCore();
  try {
    s.secrets.set('gemini.api_key', 'test'); s.settings.update({ models: { fast: 'gemini-3.8-flash' } });
    s.brain.add({ content: 'SECRET_FAMILY', domain: 'personal', pinned: true, tags: ['Private'] });
    const c = s.conversations.create();
    const a = await s.orchestrator.chat({ conversationId: c.id, text: 'Erkläre Tarkov' });
    assert.equal(fake.requests.length, 1); assert.ok(!JSON.stringify(fake.requests).includes('SECRET_FAMILY'));
    assert.equal(a.meta.scope, 'gaming');
    let local = 0; s.localLLM.stepStream = async (o) => { local++; o.onText('local'); return response('local'); };
    const p = await s.orchestrator.chat({ conversationId: c.id, text: '#Private mein besonderer Inhalt MEINGEHEIMNIS' });
    assert.equal(p.meta.scope, 'private'); assert.equal(local, 1); assert.equal(fake.requests.length, 1);
    const f = await s.orchestrator.chat({ conversationId: c.id, text: 'und morgen?' });
    assert.equal(f.meta.scope, 'private', 'kurze Folgefrage bleibt privat'); assert.equal(local, 2);
    await s.orchestrator.chat({ conversationId: c.id, text: 'Welche Munition für Tarkov-Raids?' });
    assert.equal(fake.requests.length, 2, 'öffentliches Thema → wieder Gemini');
    const sent = JSON.stringify(fake.requests[1]);
    assert.ok(sent.includes('Erkläre Tarkov'), 'öffentlicher Verlauf bleibt'); assert.ok(!sent.includes('MEINGEHEIMNIS'), 'private Nachrichten nie an Gemini');
    assert.equal(s.conversations.get(c.id).privacy, 'auto', 'Gespräch wird nicht dauerhaft umgestellt');
    for (const t of ['Wann ist meine Klausur?', 'Erinner mich morgen an Mathe', 'Meine Miete ist zu hoch', 'Trag Training am Freitag ein']) assert.equal(s.orchestrator.classify(c.id, t), 'private', t);
    for (const [t, sc] of [['Wie baue ich Malphite Support?', 'gaming'], ['Erklär mir Rekursion', 'study'], ['Wie funktioniert ein Elektroauto? Erzähl ausführlich über Batterien, Reichweite und Laden im Alltag, bitte mit Beispielen.', 'general']]) assert.equal(s.orchestrator.classify(c.id, t), sc, t);
    const denied = await s.orchestrator.execute('finance_overview', {}, { conversationId: c.id, scope: 'study' });
    assert.match(denied.response.error, /privat/);
    // alte private Gespräche bleiben komplett lokal
    const old = s.conversations.create('Alt', 'private');
    assert.equal(s.orchestrator.classify(old.id, 'Erkläre Tarkov'), 'private');
  } finally { cleanup(); }
});

test('Private tools reject external tools and fetch; async scope does not block concurrent public fetch', async () => {
  let external = 0;
  const { core: s, cleanup } = tempCore({ fetch: async () => { external++; return new Response('{}'); } });
  try {
    const c = s.conversations.create();
    const denied = await local(() => s.orchestrator.execute('web_research', { query: 'SECRET' }, { conversationId: c.id }));
    assert.match(denied.response.error, /Private/);
    assert.throws(() => local(() => s.fetch('https://example.com/SECRET')), /Private/);
    await s.fetch('https://example.com/public'); assert.equal(external, 1);
    await assert.rejects(local(() => s.gemini.research('SECRET')), /Private/);
  } finally { cleanup(); }
});

test('Private tool loop can book financial data locally without SDK requests', async () => {
  const { core: s, fake, cleanup } = tempCore();
  try {
    let step = 0;
    s.localLLM.stepStream = async (o) => {
      if (!step++) { const fc = { name: 'add_income', args: { amount: 100, note: 'privat' }, id: 'a' }; return { text: '', parts: [{ functionCall: fc }], functionCalls: [fc] }; }
      assert.ok(JSON.stringify(o.contents).includes('100')); o.onText('gebucht'); return response('gebucht');
    };
    await s.orchestrator.chat({ text: '100 Euro Einnahme' });
    assert.equal(s.life.month().income, 100); assert.equal(fake.requests.length, 0);
  } finally { cleanup(); }
});

test('Calendar, backup, embeddings and voice fail closed; private recipes use local generation', async () => {
  const { core: s, fake, cleanup } = tempCore();
  try {
    const event = await s.calendar.create({ title: 'Familie', start: '2026-10-16T10:00:00Z', end: '2026-10-16T11:00:00Z' });
    const rows = s.db.all('SELECT calendar_id FROM events'); assert.ok(rows.length); assert.equal(rows[0].calendar_id, 'local');
    await assert.rejects(s.google.api('POST', '/calendars/primary/events', { body: { summary: 'SECRET' } }), /lokal/);
    await assert.rejects(s.gemini.embed(['SECRET']), /gesperrt/);
    assert.equal(typeof s.vectors.backfill, 'undefined', 'kein Embedding-Hintergrundjob mehr');
    assert.equal((await s.driveBackup.run({ force: true })).skipped, 'private-data');
    await assert.rejects(s.driveBackup.upload('/none'), /Private/);
    await assert.rejects(s.voice.start(), /Datenschutz/);
    assert.equal((await s.transit.check()).skipped, 'private-calendar');
    s.localLLM.generate = async () => ({ recipes: [{ name: 'local' }] });
    s.life.addPantry(['Reis', 'Tomaten', 'Bohnen']);
    assert.equal((await s.life.recipes()).recipes[0].name, 'local');
    assert.equal(fake.requests.length, 0);
  } finally { cleanup(); }
});

test('Buckets reserve once, month scoping, editable, book atomically and reject double booking', () => {
  const { core: s, cleanup } = tempCore();
  try {
    s.settings.update({ life: { budgetMonthly: 1000 } }); s.life.addIncome({ amount: 1000 });
    const b = s.life.saveBucket({ name: 'Grafikkarte', amount: '200,50', month: ym() });
    s.life.saveBucket({ name: 'Später', amount: 90, month: '2099-01' });
    let m = s.life.month(); assert.equal(m.total, 0); assert.equal(m.reserved, 200.5); assert.equal(m.balance, 799.5); assert.equal(m.left, 799.5);
    s.life.saveBucket({ ...b, amount: 150 }); assert.equal(s.life.month().reserved, 150);
    assert.throws(() => s.life.bookBucket(b.id, 'not a date'), /Datum/); assert.equal(s.life.month().reserved, 150);
    s.life.bookBucket(b.id); m = s.life.month(); assert.equal(m.reserved, 0); assert.equal(m.total, 150); assert.equal(m.balance, 850);
    assert.throws(() => s.life.bookBucket(b.id), /bereits gebucht/); assert.equal(s.life.month().total, 150);
    for (const amount of [0, -1, Infinity, NaN, '']) assert.throws(() => s.life.saveBucket({ name: 'x', amount, month: ym() }));
    assert.throws(() => s.life.saveBucket({ name: 'x', amount: 1, month: '2026-13' }));
    assert.throws(() => s.life.saveBucket({ id: 'missing', name: 'x', amount: 1, month: ym() }));
    assert.equal(s.life.buckets('2099-01').length, 1);
    s.life.removeBucket(s.life.buckets('2099-01')[0].id); assert.equal(s.life.buckets().length, 1, 'gebuchter Bucket bleibt als Plan sichtbar');
  } finally { cleanup(); }
});

test('Tarkov goal is scoped per map, validates coordinates, persists and clears independently', () => {
  const { core: s, cleanup } = tempCore();
  try {
    s.gaming.setRouteGoal('customs', { label: 'Dorms', x: 0.4, y: 0.2, floor: 'Second_Floor' });
    s.gaming.setRouteGoal('woods', { label: 'Med-Loot' });
    assert.equal(s.gaming.routeGoal('customs').floor, 'Second_Floor'); assert.equal(s.gaming.routeGoal('woods').x, null);
    assert.ok(s.db.get('SELECT value FROM game_state WHERE key=?', 'eft:route-goal:customs'));
    for (const x of [-1, 2, NaN, Infinity, '0.5']) assert.throws(() => s.gaming.setRouteGoal('woods', { label: 'x', x, y: 0.2 }));
    assert.throws(() => s.gaming.saveRoute('eft', 'woods', 'Bad', [{ x: 0.1, y: 0.2 }, { x: 2, y: 0.4 }]));
    s.gaming.setRouteGoal('customs', null); assert.equal(s.gaming.routeGoal('customs'), null); assert.equal(s.gaming.routeGoal('woods').label, 'Med-Loot');
  } finally { cleanup(); }
});

test('Loopback Ollama integration: local verification, lowercase tools, tool results, no redirects', async () => {
  const seen = []; let remote = false; let redirect = false;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null; seen.push({ path: req.url, body });
    if (redirect) { res.writeHead(302, { Location: 'https://example.com' }); res.end(); return; }
    const out = req.url === '/api/tags' ? { models: [{ name: 'local:test' }, { name: 'remote-cloud' }] } : req.url === '/api/show' ? (remote ? { remote_host: 'https://ollama.com' } : { model_info: { architecture: 'test' } }) : { message: { content: 'local reply', tool_calls: [{ function: { name: 'add_income', arguments: { amount: 1 } } }] } };
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(out));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const llm = new LocalLLM({ get: () => ({ port: server.address().port, model: 'local:test' }) });
    const out = await llm.stepStream({ contents: [{ role: 'user', parts: [{ text: 'private text' }] }], tools: [{ functionDeclarations: [{ name: 'add_income', parameters: { type: 'OBJECT', properties: { amount: { type: 'NUMBER' } } } }] }] });
    assert.equal(out.text, 'local reply'); assert.equal(out.functionCalls[0].args.amount, 1);
    assert.equal(seen.at(-1).body.tools[0].function.parameters.properties.amount.type, 'number');
    remote = true; const before = seen.filter((r) => r.path === '/api/chat').length;
    await assert.rejects(llm.stepStream({ contents: [] }), /lokales Modell/);
    assert.equal(seen.filter((r) => r.path === '/api/chat').length, before);
    redirect = true; await assert.rejects(llm.models(), /HTTP 302/);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
