'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { tempCore } = require('./helpers');

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

test('Markdown-Renderer: escaped, sichere Links, Tabellen, kein Hängen bei Teil-Tabellen', async () => {
  const { renderMarkdown } = await import('../src/renderer/src/lib/markdown.js');
  const html = renderMarkdown('<img src=x onerror=alert(1)> **b** [ok](https://a.de) [bad](javascript:alert(1))\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n| unvollständig |');
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('data-href="https://a.de"'));
  assert.ok(!html.includes('href="javascript'));
  assert.ok(html.includes('<table>'));
});

test('League: Statistik, Trends, Insights aus gespeicherten Matches (keine erfundenen Werte)', () => {
  const { core, cleanup } = tempCore();
  const mk = (i, win, k, d, a, cs, vision) => core.db.run('INSERT INTO lol_matches(match_id,puuid,played_at,summary) VALUES(?,?,?,?)', 'EUW_' + i, 'p', new Date(Date.now() - i * 3600e3).toISOString(),
    JSON.stringify({ matchId: 'EUW_' + i, champion: i % 2 ? 'Jhin' : 'Kaisa', win, kills: k, deaths: d, assists: a, csPerMin: cs, vision, goldPerMin: 400, damagePerMin: 700, killParticipation: 50, role: 'BOTTOM', duration: 1800 }));
  for (let i = 0; i < 20; i++) mk(i, i % 3 !== 0, 8, 4, 10, 7.5, 28);
  for (let i = 20; i < 40; i++) mk(i, i % 2 === 0, 5, 6, 6, 6.0, 20);
  const s = core.gaming.league.stats(20);
  assert.equal(s.current.games, 20);
  assert.equal(s.current.winrate, 65);
  assert.equal(s.current.kda, 4.5);
  assert.equal(s.deltas.csPerMin, 25);
  assert.equal(s.roles[0].role, 'BOTTOM');
  assert.ok(s.insights.some((x) => x.kind === 'trend'));
  assert.equal(core.gaming.league.stats(20).rank, null, 'kein Rang ohne API-Daten');
  cleanup();
});

test('Tarkov-Client: Quests/Keys über tarkov.dev (gemockt), Cache + Offline-Fallback', async () => {
  let calls = 0; let offline = false;
  const fetch = async (url, init) => {
    if (offline) throw new Error('fetch failed');
    calls++;
    const q = JSON.parse(init.body).query;
    if (q.includes('maps(')) return json({ data: { maps: [{ id: 'm1', name: 'Zollgelände', normalizedName: 'customs', players: '8-12', raidDuration: 40, extracts: [{ id: 'e', name: 'ZB-1011', faction: 'pmc', position: { x: 1, y: 0, z: 2 } }], transits: [], bosses: [], locks: [{ lockType: 'door', needsPower: false, position: { x: 0, y: 0, z: 0 }, key: { id: 'k1', name: 'Dorms room 314 marked key', shortName: '314' } }] }] } });
    if (q.includes('tasks(')) return json({ data: { tasks: [{ id: 't', name: 'Operation Aquarius', trader: { name: 'Therapist' }, map: { name: 'Zollgelände', normalizedName: 'customs' }, minPlayerLevel: 5, kappaRequired: true, objectives: [{ type: 'visit', description: 'Finde den Wasservorrat', optional: false, maps: [{ normalizedName: 'customs' }] }] }] } });
    return json({ data: { items: [] } });
  };
  const { core, cleanup } = tempCore({ fetch });
  const t = core.gaming.tarkov;
  const keys = await t.keysForMap('customs');
  assert.equal(keys.items[0].shortName, '314');
  assert.match(keys.source, /tarkov\.dev/);
  const q = await t.searchTasks('aquarius', { map: 'customs' });
  assert.equal(q.items[0].trader.name, 'Therapist');
  const before = calls;
  await t.maps();
  assert.equal(calls, before, 'aus dem Cache');
  core.db.run("UPDATE game_cache SET expires_at='2000-01-01T00:00:00Z'");
  offline = true;
  const m = await t.maps();
  assert.equal(m.offline, true, 'veraltete Daten werden als offline gekennzeichnet');
  cleanup();
});

test('Web: Seite speichern, Versionierung bei Änderung, SSRF-Schutz bei Weiterleitung', async () => {
  let body = '<html><title>Doku</title><body><p>Version eins</p></body></html>';
  const fetch = async (url) => {
    if (url.includes('redirect')) return new Response('', { status: 302, headers: { location: 'https://127.0.0.1/admin' } });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  const { core, cleanup } = tempCore({ fetch });
  const a = await core.web.savePage('https://93.184.215.14/doku');
  assert.equal(a.version, 1);
  const same = await core.web.savePage('https://93.184.215.14/doku');
  assert.ok(same.unchanged);
  body = body.replace('eins', 'zwei');
  const b = await core.web.savePage('https://93.184.215.14/doku');
  assert.equal(b.version, 2);
  assert.equal(core.web.versions(a.id).length, 2);
  const r = await core.brain.search('Version zwei', { scope: 'documents' });
  assert.equal(r.results[0].source, 'web');
  await assert.rejects(core.web.savePage('https://93.184.215.14/redirect'), /Private/);
  cleanup();
});

test('Altdaten-Import aus JARVIS 2.0 (Aufgaben, Erinnerungen, Verlauf, Termine) – einmalig', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-'));
  const file = path.join(dir, 'jarvis.sqlite3');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE tasks(id TEXT PRIMARY KEY, title TEXT, notes TEXT, due_at TEXT, repeat TEXT, priority TEXT, done INTEGER, created_at TEXT);
    CREATE TABLE memories(id TEXT PRIMARY KEY, category TEXT, content TEXT, origin TEXT, created_at TEXT);
    CREATE TABLE messages(id TEXT PRIMARY KEY, role TEXT, content TEXT, mode TEXT, sources TEXT, created_at TEXT);
    CREATE TABLE calendar_events(id TEXT PRIMARY KEY, title TEXT, start_at TEXT, end_at TEXT, location TEXT, description TEXT, source TEXT);
    INSERT INTO tasks VALUES('1','Vokabeln','', '2026-10-01T18:00:00', 'daily', 'high', 0, '2026-09-01');
    INSERT INTO tasks VALUES('2','Altes Erledigtes','', NULL, 'none', 'normal', 1, '2026-09-01');
    INSERT INTO memories VALUES('m','persoenlich','Mag Pizza Diavolo','manual','2026-09-01');
    INSERT INTO messages VALUES('x','user','Hallo','freundlich','[]','2026-09-01T10:00:00');
    INSERT INTO messages VALUES('y','assistant','Hallo Chef','freundlich','[]','2026-09-01T10:00:01');
    INSERT INTO calendar_events VALUES('c','Zahnarzt','2026-11-02T09:00:00','2026-11-02T10:00:00','','','import');`);
  old.close();
  const { core, cleanup } = tempCore();
  const r = core.system.importLegacy(file);
  assert.deepEqual(r.imported, { tasks: 2, memories: 1, messages: 2, events: 1, research: 0 });
  const vok = core.tasks.list({ filter: 'recurring' })[0];
  assert.equal(vok.title, 'Vokabeln'); assert.equal(vok.priority, 'high');
  assert.equal(core.brain.list({ domain: 'personal' })[0].content, 'Mag Pizza Diavolo');
  assert.ok(core.system.importLegacy(file).skipped, 'kein Doppelimport');
  cleanup();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Update-Prüfung: nur signierte Manifeste, Versionsvergleich', async () => {
  const crypto = require('node:crypto');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const m = { version: '3.1.0', url: 'https://example.com/JARVIS_Setup.exe', sha256: 'a'.repeat(64) };
  m.signature = crypto.sign(null, Buffer.from(`${m.version}\n${m.sha256}\n${m.url}`), privateKey).toString('base64');
  const { core, cleanup } = tempCore({ fetch: async () => json(m) });
  core.updatePublicKey = publicKey.export({ type: 'spki', format: 'pem' });
  core.settings.update({ updateChannelUrl: 'https://example.com/channel.json' });
  let u = await core.system.checkUpdates({ silent: true });
  assert.equal(u.state, 'available'); assert.equal(u.signed, true);
  m.version = '3.2.0'; // signature no longer matches
  u = await core.system.checkUpdates({ silent: true });
  assert.equal(u.signed, false);
  await assert.rejects(core.system.downloadUpdate(), /nicht signiert/);
  const { cmpVersion } = require('../src/main/services/system');
  assert.ok(cmpVersion('3.10.0', '3.9.9') > 0);
  cleanup();
});

test('Performance: Vektorsuche über 20.000 Einträge < 100 ms, FTS-Suche < 30 ms', async () => {
  const { core, cleanup } = tempCore();
  const dim = 768; const n = 20000;
  core.db.tx(() => {
    for (let i = 0; i < n; i++) {
      const v = new Float32Array(dim); for (let j = 0; j < dim; j++) v[j] = Math.sin(i * 0.37 + j);
      core.vectors.put('c', String(i), 't' + i, v, 'test');
    }
  });
  const q = new Float32Array(dim); for (let j = 0; j < dim; j++) q[j] = Math.sin(j);
  core.vectors.load('c');
  const t0 = performance.now();
  const hits = core.vectors.search('c', q, 10);
  const ms = performance.now() - t0;
  assert.equal(hits.length, 10);
  assert.ok(ms < 100, `Vektorsuche dauerte ${ms.toFixed(1)} ms`);
  for (let i = 0; i < 2000; i++) core.brain.add({ content: `Eintrag ${i} über Thema ${i % 50} und Projekt ${i % 7}` });
  const t1 = performance.now();
  await core.brain.search('Thema 42', { semantic: false });
  const ms2 = performance.now() - t1;
  assert.ok(ms2 < 30, `FTS dauerte ${ms2.toFixed(1)} ms`);
  console.log(`  Vektorsuche 20k×768: ${ms.toFixed(1)} ms · Brain-FTS 2k Einträge: ${ms2.toFixed(1)} ms`);
  cleanup();
});
