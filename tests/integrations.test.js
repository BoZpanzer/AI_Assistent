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

test('Updates über GitHub Releases: Signatur, Prüfsumme, privater Token, Versionsvergleich', async () => {
  const crypto = require('node:crypto');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const setup = Buffer.from('MZ fake installer ' + 'x'.repeat(5000));
  const sha = crypto.createHash('sha256').update(setup).digest('hex');
  const { signedMessage } = require('../src/main/services/updater');
  const man = { version: '9.0.0', file: 'JARVIS_Setup.exe', sha256: sha, size: setup.length, notes: '- Neues Feature' };
  man.signature = crypto.sign(null, signedMessage(man), privateKey).toString('base64');
  const calls = [];
  let manifest = man;
  const fetch = async (url, init = {}) => {
    calls.push({ url, auth: init.headers?.Authorization || null });
    if (url.endsWith('/repos/boz/jarvis/releases/latest')) return json({ tag_name: 'v9.0.0', html_url: 'https://github.com/boz/jarvis/releases/tag/v9.0.0', published_at: '2026-10-13T08:00:00Z', body: 'x',
      assets: [{ name: 'update.json', url: 'https://api.github.com/repos/boz/jarvis/releases/assets/1', browser_download_url: 'https://github.com/dl/update.json', size: 300 },
        { name: 'JARVIS_Setup.exe', url: 'https://api.github.com/repos/boz/jarvis/releases/assets/2', browser_download_url: 'https://github.com/dl/JARVIS_Setup.exe', size: setup.length }] });
    if (url === 'https://api.github.com/repos/boz/jarvis/releases/assets/1') return new Response(null, { status: 302, headers: { location: 'https://objects.githubusercontent.com/m' } });
    if (url === 'https://api.github.com/repos/boz/jarvis/releases/assets/2') return new Response(null, { status: 302, headers: { location: 'https://objects.githubusercontent.com/s' } });
    if (url === 'https://objects.githubusercontent.com/m' || url === 'https://github.com/dl/update.json') return json(manifest);
    if (url === 'https://objects.githubusercontent.com/s' || url === 'https://github.com/dl/JARVIS_Setup.exe') return new Response(setup, { headers: { 'content-length': String(setup.length) } });
    return new Response('nope', { status: 404 });
  };
  const { core, cleanup } = tempCore({ fetch });
  assert.equal((await core.updater.check()).state, 'not-configured');
  { // Repo erreichbar, aber noch kein Release
    const c2 = tempCore({ fetch: async (url) => (url.endsWith('/releases/latest') ? new Response('{}', { status: 404 }) : json({ full_name: 'boz/jarvis' })) });
    c2.core.updateRepo = 'boz/jarvis';
    assert.equal((await c2.core.updater.check()).state, 'no-release');
    c2.cleanup();
  }
  core.updateRepo = 'boz/jarvis'; // wie vom Release-Workflow eingebaut
  core.updatePublicKey = publicKey.export({ type: 'spki', format: 'pem' });
  // öffentliches Repo: ohne Token, direkte Download-URLs
  let u = await core.updater.check();
  assert.equal(u.state, 'available'); assert.equal(u.signed, true); assert.equal(u.version, '9.0.0');
  assert.ok(core.notifications.list().some((n) => /9\.0\.0/.test(n.title)));
  const file = await core.updater.download();
  assert.equal(require('node:fs').readFileSync(file).length, setup.length);
  assert.equal(core.updater.public().state, 'ready');
  assert.ok(require('node:fs').readdirSync(core.system.backupDir()).some((f) => f.startsWith('vor-update-9.0.0')), 'Sicherung vor Update');
  // privates Repo: Token nur an api.github.com, NICHT an den Speicher-Link
  core.secrets.set('github.token', 'github_pat_test123');
  calls.length = 0;
  u = await core.updater.check(); await core.updater.download();
  assert.ok(calls.filter((c) => c.url.startsWith('https://api.github.com')).every((c) => c.auth === 'Bearer github_pat_test123'));
  assert.ok(calls.filter((c) => c.url.startsWith('https://objects.githubusercontent.com')).every((c) => !c.auth), 'Token darf nicht an Fremd-Host gehen');
  // manipuliertes Manifest → nicht signiert → Installation gesperrt
  manifest = { ...man, version: '9.0.1' };
  u = await core.updater.check();
  assert.equal(u.signed, false);
  await assert.rejects(core.updater.download(), /nicht gültig signiert/);
  // falsche Prüfsumme → verworfen
  manifest = { ...man, sha256: 'b'.repeat(64) }; manifest.signature = crypto.sign(null, signedMessage(manifest), privateKey).toString('base64');
  await core.updater.check();
  await assert.rejects(core.updater.download(), /Prüfsumme/);
  // gleiche Version → aktuell
  manifest = { ...man, version: core.version }; manifest.signature = crypto.sign(null, signedMessage(manifest), privateKey).toString('base64');
  assert.equal((await core.updater.check()).state, 'current');
  const { cmpVersion } = require('../src/main/services/updater');
  assert.ok(cmpVersion('3.10.0', '3.9.9') > 0); assert.ok(cmpVersion('v3.3.0', '3.3.0') === 0);
  cleanup();
});

test('Release-Signaturskript: update.json passt zum eingebauten Schlüssel', () => {
  const crypto = require('node:crypto'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const { execFileSync } = require('node:child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-sign-'));
  fs.mkdirSync(path.join(tmp, 'scripts')); fs.mkdirSync(path.join(tmp, 'build')); fs.mkdirSync(path.join(tmp, 'release'));
  fs.copyFileSync(path.join(__dirname, '..', 'scripts', 'sign-update.mjs'), path.join(tmp, 'scripts', 'sign-update.mjs'));
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ version: '3.3.1' }));
  fs.writeFileSync(path.join(tmp, 'CHANGELOG.md'), '# Changelog\n\n## 3.3.1 – Test\n- Fix A\n\n## 3.3.0\n- Alt\n');
  fs.writeFileSync(path.join(tmp, 'release', 'JARVIS_Setup.exe'), 'installer');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(path.join(tmp, 'build', 'update-public-key.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
  execFileSync(process.execPath, [path.join(tmp, 'scripts', 'sign-update.mjs')], { env: { ...process.env, UPDATE_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }) } });
  const m = JSON.parse(fs.readFileSync(path.join(tmp, 'release', 'update.json'), 'utf8'));
  const { signedMessage } = require('../src/main/services/updater');
  assert.equal(m.version, '3.3.1'); assert.equal(m.notes, '- Fix A');
  assert.ok(crypto.verify(null, signedMessage(m), publicKey, Buffer.from(m.signature, 'base64')));
  // falscher Schlüssel → Abbruch
  const other = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.throws(() => execFileSync(process.execPath, [path.join(tmp, 'scripts', 'sign-update.mjs')], { env: { ...process.env, UPDATE_PRIVATE_KEY: other }, stdio: 'pipe' }));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('Stundenplan (ICS): Zeitzonen, Wiederholung, EXDATE, verschobene Termine', () => {
  const { parseIcs, expand, courseName } = require('../src/main/services/ics');
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:a', 'SUMMARY:V Mathematik II (CS24-1)', 'DTSTART;TZID=Europe/Berlin:20261012T081500', 'DTEND;TZID=Europe/Berlin:20261012T094500',
    'RRULE:FREQ=WEEKLY;COUNT=5', 'EXDATE;TZID=Europe/Berlin:20261019T081500', 'END:VEVENT', 'BEGIN:VEVENT', 'UID:a', 'RECURRENCE-ID;TZID=Europe/Berlin:20261102T081500', 'SUMMARY:V Mathematik II',
    'DTSTART;TZID=Europe/Berlin:20261102T100000', 'DTEND;TZID=Europe/Berlin:20261102T113000', 'END:VEVENT', 'BEGIN:VEVENT', 'UID:b', 'SUMMARY:Programmierung\\, Übung', 'DTSTART:20261013T120000Z', 'DURATION:PT1H30M', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const p = parseIcs(ics);
  const ev = expand(p.events, new Date('2026-10-01T00:00:00Z'), new Date('2026-12-01T00:00:00Z'));
  const math = ev.filter((e) => e.uid === 'a').map((e) => e.start);
  assert.deepEqual(math, ['2026-10-12T06:15:00.000Z', '2026-10-26T07:15:00.000Z', '2026-11-02T09:00:00.000Z', '2026-11-09T07:15:00.000Z']); // Sommer→Winterzeit korrekt, 19.10. entfällt, 02.11. verschoben
  assert.equal(ev.find((e) => e.uid === 'b').end, '2026-10-13T13:30:00.000Z');
  assert.equal(courseName('V Mathematik II (CS24-1)'), 'Mathematik II');
  assert.equal(courseName('Programmierung, Übung'), 'Programmierung');
});

test('LoL-Nachbesprechung: Hinweise nur aus echten Zahlen + Trainingsziele', () => {
  const { reviewTips } = require('../src/main/services/gaming/lolflow');
  const { parseGoal } = require('../src/main/services/gaming/league');
  const m = { csPerMin: 5.1, deaths: 9, vision: 10, killParticipation: 30, controlWards: 0, duration: 1800 };
  const avg = { csPerMin: 6.5, avgD: 5, vision: 22, kp: 52 };
  const t = reviewTips(m, avg, [{ text: '7 CS/min', ...parseGoal('7 CS/min') }]);
  assert.ok(t.some((x) => /5\.1 vs\. Ø 6\.5/.test(x)));
  assert.ok(t.some((x) => /9 Tode/.test(x)));
  assert.ok(t.some((x) => /Control Ward/.test(x)));
  assert.ok(t.some((x) => /Ziel CS\/min 7: verfehlt/.test(x)));
  assert.deepEqual(parseGoal('max. 5 Tode'), { metric: 'deaths', target: 5 });
});

test('TarkovTracker: Abgleich in „Mein Spielstand“ und Rückübertragung beim Abhaken', async () => {
  const posted = [];
  const fetch = async (url, init = {}) => {
    if (url.includes('api.tarkov.dev')) return json({ data: { tasks: [{ id: 't1', name: 'Debüt', normalizedName: 'debut' }, { id: 't2', name: 'Shortage' }, { id: 't3', name: 'Sanitäter' }] } });
    if (url.endsWith('/token')) return json({ success: true, permissions: ['GP', 'WP'], token: 'x', gameMode: 'pvp' });
    if (url.endsWith('/progress') && (init.method || 'GET') === 'GET') return json({ data: { tasksProgress: [{ id: 't1', complete: true }, { id: 't3', failed: true }], playerLevel: 23, displayName: 'BoZ', pmcFaction: 'usec' } });
    if (url.includes('/progress/task/')) { posted.push({ url, body: JSON.parse(init.body) }); return json({ success: true }); }
    return json({}, 404);
  };
  const { core, cleanup } = tempCore({ fetch });
  const tt = core.gaming.tracker;
  const r = await tt.test('PVP_0123456789abcdef01');
  assert.equal(r.canWrite, true);
  assert.ok(tt.status.connected);
  const s = await tt.sync();
  assert.equal(s.done, 1); assert.equal(s.level, 23);
  const items = core.gaming.progress.list('eft');
  assert.ok(items.some((x) => x.name === 'Debüt' && x.status === 'done' && x.source === 'api'));
  assert.ok(items.some((x) => x.name === 'Sanitäter' && x.status === 'failed'));
  assert.ok(items.some((x) => x.name === 'PMC-Level' && x.value === '23'));
  assert.equal(posted.length, 0, 'Sync spiegelt nichts zurück');
  core.gaming.progress.upsert('eft', { category: 'quest', name: 'Shortage', status: 'done', source: 'chat' });
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(posted.length, 1); assert.match(posted[0].url, /\/progress\/task\/t2$/); assert.equal(posted[0].body.state, 'completed');
  const { baseUrl } = require('../src/main/services/gaming/tarkovtracker');
  assert.equal(baseUrl('PVP_0123456789abcdef01'), 'https://api.tarkovtracker.org');
  assert.equal(baseUrl('abcdefghijklmnopqrstuv'), 'https://tarkovtracker.io/api/v2');
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

test('Gemini-Kontingent: Ausweichmodell bei 429, Recherche notfalls ohne Live-Suche, Wiki-Fallback', async () => {
  const { fakeSdk } = require('./helpers');
  const fk = fakeSdk([]);
  const calls = [];
  const quota = () => Object.assign(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"quota GenerateRequestsPerDayPerProjectPerModel-FreeTier"}}'), { status: 429 });
  class G extends fk.sdk.GoogleGenAI {
    constructor(o) {
      super(o);
      this.models.generateContent = async (req) => {
        calls.push({ model: req.model, search: !!req.config?.tools?.some((t) => t.googleSearch) });
        if (req.model === 'gemini-3.8-flash') throw quota();
        if (req.config?.tools?.some((t) => t.googleSearch)) throw quota(); // Suche überall erschöpft
        return { text: 'Antwort aus Modellwissen', candidates: [{}] };
      };
    }
  }
  const { core, cleanup } = tempCore({ genaiSdk: { GoogleGenAI: G } });
  core.secrets.set('gemini.api_key', 'x');
  core.settings.update({ availableModels: ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.8-flash-lite', 'gemini-3.8-flash-image'] });
  const t = await core.gemini.generate({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] });
  assert.equal(t, 'Antwort aus Modellwissen');
  assert.deepEqual(calls.map((c) => c.model).slice(0, 2), ['gemini-3.8-flash', 'gemini-3.5-flash'], 'nächstes Flash-Modell, kein Bild-Modell');
  calls.length = 0;
  const r = await core.gemini.research('Beste Strategie für Diamanten');
  assert.equal(r.grounded, false);
  assert.match(r.text, /Ohne Live-Websuche/);
  assert.ok(!calls.some((c) => /image/.test(c.model)));
  const { friendlyError } = require('../src/main/providers/gemini');
  assert.match(friendlyError(quota()), /Tageskontingent/);
  // Wiki: deutscher Begriff → deutsches Wiki leer → Fallback-Wiki
  const { Wiki } = require('../src/main/services/gaming/wiki');
  const { GameCache } = require('../src/main/services/gaming/cache');
  const w = new Wiki({ fetch: null, gameCache: new GameCache(core.db) });
  w.json = async (url) => ({ query: { search: String(url).includes('de.example') ? [] : [{ title: 'Diamond', snippet: 'A <b>diamond</b>' }] } }); // ohne Netz/DNS
  const res = await w.search({ api: 'https://de.example.org/api.php', label: 'DE', fallback: [{ api: 'https://example.org/api.php', label: 'EN' }] }, 'Diamant');
  assert.equal(res.results[0].title, 'Diamond'); assert.equal(res.source, 'EN'); assert.equal(res.results[0].api, 'https://example.org/api.php');
  cleanup();
});

test('Google-Anmeldung: Browser zeigt „verbunden“ erst nach erfolgreichem Token-Austausch', async () => {
  const http = require('node:http');
  const { GoogleClient } = require('../src/main/providers/google');
  const run = async (tokenResponse) => {
    const { core, cleanup } = tempCore();
    core.settings.update({ google: { clientId: 'cid.apps.googleusercontent.com' } });
    let page = '';
    const g = new GoogleClient({ secrets: core.secrets, settings: core.settings,
      fetch: async () => new Response(JSON.stringify(tokenResponse.body), { status: tokenResponse.status }),
      platform: { openExternal: (u) => { const a = new URL(u); const back = new URL(a.searchParams.get('redirect_uri')); back.searchParams.set('code', 'abc'); back.searchParams.set('state', a.searchParams.get('state'));
        http.get(back, (res) => { res.setEncoding('utf8'); res.on('data', (c) => { page += c; }); }); } } });
    const out = await g.connect().then((r) => ({ ok: true, r }), (e) => ({ ok: false, e }));
    await new Promise((r) => setTimeout(r, 50));
    const connected = g.isConnected();
    cleanup();
    return { out, page, connected };
  };
  const bad = await run({ status: 401, body: { error: 'invalid_client', error_description: 'Unauthorized' } });
  assert.equal(bad.out.ok, false); assert.match(bad.out.e.message, /Client-ID oder Client-Secret/);
  assert.match(bad.page, /Verbindung fehlgeschlagen/); assert.doesNotMatch(bad.page, /ist mit Google verbunden/);
  assert.equal(bad.connected, false);
  const id = Buffer.from(JSON.stringify({ email: 'boz@example.com' })).toString('base64url');
  const good = await run({ status: 200, body: { refresh_token: 'r', access_token: 'a', expires_in: 3600, id_token: `x.${id}.y`, scope: 'openid email' } });
  assert.equal(good.out.ok, true); assert.equal(good.out.r.account, 'boz@example.com');
  assert.match(good.page, /ist mit Google verbunden/);
  assert.equal(good.connected, true);
});

test('Google Drive „Goodnotes“: Unterordner = Fächer, nur Geändertes laden, Gelöschtes entfernen, Index', async () => {
  const fs = require('node:fs'); const path = require('node:path');
  let tree = {
    root: [{ id: 'f1', name: 'Mathe II', mimeType: 'application/vnd.google-apps.folder' }, { id: 'a', name: 'Allgemein.md', mimeType: 'text/markdown', md5Checksum: 'm1', modifiedTime: '2026-10-01T10:00:00Z' }, { id: 'x', name: 'Skizze.goodnotes', mimeType: 'application/octet-stream' }],
    f1: [{ id: 'b', name: 'Vorlesung 1.md', mimeType: 'text/markdown', md5Checksum: 'm2', modifiedTime: '2026-10-02T10:00:00Z' }, { id: 'g', name: 'Zusammenfassung', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-10-03T10:00:00Z' }],
  };
  const content = { a: '# Allgemein\nHinweise zum Studium', b: '# Matrizen\nEine Matrix ist eine rechteckige Anordnung von Zahlen.', g: '# Doc' };
  const downloads = [];
  const { core, cleanup } = tempCore({ fetch: async (url) => {
    const id = String(url).match(/files\/([^/?]+)/)[1]; downloads.push(id);
    return new Response(content[id] || 'x');
  } });
  core.settings.update({ study: { source: 'drive', enabled: true, driveFolder: 'Goodnotes', formats: ['pdf', 'md', 'txt'] }, google: { scopes: ['https://www.googleapis.com/auth/drive.readonly'] } });
  core.google.isConnected = () => true;
  core.google.token = async () => 't';
  core.google.api = async (m, p, { query }) => {
    if (query.q.startsWith('name =')) return { files: [{ id: 'root', name: 'Goodnotes', modifiedTime: '2026-10-01T00:00:00Z' }] };
    const parent = query.q.match(/'([^']+)' in parents/)[1];
    return { files: tree[parent] || [] };
  };
  const r1 = await core.drive.sync();
  assert.equal(r1.files, 3); assert.equal(r1.changed, 3);
  assert.deepEqual(downloads.sort(), ['a', 'b', 'g'], '.goodnotes-Datei wird übersprungen');
  assert.ok(fs.existsSync(path.join(core.drive.root(), 'Mathe II', 'Zusammenfassung.pdf')), 'Google-Doc als PDF exportiert');
  await core.study.processQueue?.();
  const docs = core.study.documents({});
  assert.ok(docs.some((d) => d.title.includes('Vorlesung 1') && d.subject === 'Mathe II'), 'Unterordner wird zum Fach');
  // zweiter Lauf: nichts geändert → kein Download
  downloads.length = 0;
  const r2 = await core.drive.sync();
  assert.equal(r2.changed, 0); assert.equal(downloads.length, 0);
  // Datei geändert + Datei gelöscht
  tree.f1[0].md5Checksum = 'm2b'; content.b = '# Matrizen\nNeu: Determinanten'; tree.root = tree.root.filter((f) => f.id !== 'a');
  const r3 = await core.drive.sync();
  assert.equal(r3.changed, 2); assert.deepEqual(downloads, ['b']);
  assert.ok(!fs.existsSync(path.join(core.drive.root(), 'Allgemein.md')));
  assert.equal(core.study.root(), core.drive.root());
  cleanup();
});

test('Kalender-Abo (ICS): Termine erscheinen, Aktualisierung entfernt Altes, schreibgeschützt, alle 15 Min.', async () => {
  const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
  const { core, cleanup } = tempCore();
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ics-')), 'stundenplan.ics');
  const d = (days, h) => { const x = new Date(); x.setDate(x.getDate() + days); x.setUTCHours(h, 15, 0, 0); return x.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''); };
  const ics = (evs) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SAP//Campus Dual//DE', ...evs.flatMap(([uid, t, day, h]) => ['BEGIN:VEVENT', 'UID:' + uid, 'SUMMARY:' + t, 'DTSTART:' + d(day, h), 'DTEND:' + d(day, h + 1), 'LOCATION:Raum 2.14', 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
  fs.writeFileSync(f, ics([['a', 'Mathematik II', 1, 7], ['b', 'Programmierung', 2, 9], ['c', 'Datenbanken', 3, 11]]));
  const r = await core.feeds.add({ name: 'Stundenplan', file: f });
  assert.equal(r.events, 3);
  const range = [new Date(Date.now() - 86400000), new Date(Date.now() + 10 * 86400000)];
  let ev = core.calendar.list(...range).filter((e) => e.calendarId.startsWith('feed:'));
  assert.equal(ev.length, 3); assert.equal(ev[0].readOnly, true); assert.equal(ev[0].source, 'feed');
  await assert.rejects(core.calendar.update(ev[0].id, { title: 'x' }), /schreibgeschützt/);
  // Quelle ändert sich: Datenbanken fällt weg, Statistik kommt dazu
  fs.writeFileSync(f, ics([['a', 'Mathematik II', 1, 7], ['b', 'Programmierung', 2, 9], ['d', 'Statistik', 4, 8]]));
  await core.feeds.refreshAll();
  ev = core.calendar.list(...range).filter((e) => e.calendarId.startsWith('feed:')).map((e) => e.title);
  assert.deepEqual(ev.sort(), ['Mathematik II', 'Programmierung', 'Statistik']);
  // unverändert → kein Neuschreiben
  const again = await core.feeds.refresh(r.id);
  assert.equal(again.unchanged, true);
  assert.ok(core.scheduler.jobs === undefined || true);
  const { Scheduler } = require('../src/main/jobs/scheduler');
  const sch = new Scheduler(core); sch.add = function (name, every) { (this.list = this.list || []).push([name, every]); };
  sch.start(); sch.stop();
  assert.deepEqual(sch.list.find((x) => x[0] === 'calendar-feeds'), ['calendar-feeds', 15 * 60_000]);
  assert.match(core.feeds.list()[0].name, /Stundenplan/);
  core.feeds.remove(r.id);
  assert.equal(core.calendar.list(...range).filter((e) => e.calendarId.startsWith('feed:')).length, 0);
  cleanup();
});

test('Steam-Bibliothek: Spielzeit aus localconfig, Updates aus Manifest, Game-Seiten ab 1 Minute', async () => {
  const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
  const steamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'steam-'));
  const lib2 = fs.mkdtempSync(path.join(os.tmpdir(), 'steamlib-'));
  const w = (p, t) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); };
  const id64 = '76561198845901603'; const id3 = String(BigInt(id64) - 76561197960265728n);
  w(path.join(steamDir, 'config', 'loginusers.vdf'), `"users"\n{\n\t"${id64}"\n\t{\n\t\t"AccountName"\t\t"boz"\n\t\t"PersonaName"\t\t"BoZ"\n\t\t"MostRecent"\t\t"1"\n\t\t"Timestamp"\t\t"1760000000"\n\t}\n}\n`);
  w(path.join(steamDir, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steamDir.replace(/\\/g, '\\\\')}"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${lib2.replace(/\\/g, '\\\\')}"\n\t}\n}\n`);
  const acf = (appid, name, flags, extra = '') => `"AppState"\n{\n\t"appid"\t\t"${appid}"\n\t"name"\t\t"${name}"\n\t"StateFlags"\t\t"${flags}"\n\t"installdir"\t\t"${name}"\n\t"SizeOnDisk"\t\t"1000"\n\t"LastUpdated"\t\t"1760000000"${extra}\n}\n`;
  w(path.join(steamDir, 'steamapps', 'appmanifest_264710.acf'), acf(264710, 'Subnautica', 4));
  w(path.join(lib2, 'steamapps', 'appmanifest_892970.acf'), acf(892970, 'Valheim', 6)); // 2|4 = Update nötig
  w(path.join(lib2, 'steamapps', 'appmanifest_228980.acf'), acf(228980, 'Steamworks Common Redistributables', 4));
  w(path.join(lib2, 'steamapps', 'appmanifest_1000.acf'), acf(1000, 'Nie gespielt', 4));
  // Spielzeit (Minuten) – 440 ist nicht installiert, Name kommt aus dem Store; 999 ist ein Soundtrack (Store-Typ „music“)
  const apps = { 264710: 125, 892970: 3000, 440: 61, 999: 5, 2000: 0, 2669320: 600, 3405690: 120, 629520: 900 };
  w(path.join(steamDir, 'userdata', id3, 'config', 'localconfig.vdf'), `"UserLocalConfigStore"\n{\n\t"Software"\n\t{\n\t\t"Valve"\n\t\t{\n\t\t\t"Steam"\n\t\t\t{\n\t\t\t\t"apps"\n\t\t\t\t{\n${Object.entries(apps).map(([id, m]) => `\t\t\t\t\t"${id}"\n\t\t\t\t\t{\n\t\t\t\t\t\t"LastPlayed"\t\t"${m ? 1760000000 + m : 0}"\n\t\t\t\t\t\t"Playtime"\t\t"${m}"\n\t\t\t\t\t}`).join('\n')}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}\n`);
  const store = { 2669320: { name: 'EA SPORTS FC™ 25', type: 'game' }, 3405690: { name: 'EA SPORTS FC™ 26', type: 'game' }, 440: { name: 'Team Fortress 2', type: 'game', header_image: 'https://shared.akamai.steamstatic.com/440.jpg' }, 999: { name: 'Irgendwas Original Soundtrack', type: 'music' }, 1000: { name: 'Nie gespielt', type: 'game' } };
  let storeCalls = 0;
  const { core, cleanup } = tempCore({ fetch: async (url) => {
    const appid = String(url).match(/appids=(\d+)/)[1]; storeCalls++;
    return json({ [appid]: store[appid] ? { success: true, data: store[appid] } : { success: false } });
  } });
  core.settings.update({ gaming: { steamDir } });
  const steam = core.gaming.steam;
  const lib = await steam.library();
  assert.equal(lib.available, true); assert.equal(lib.account, id64);
  assert.deepEqual(lib.games.map((g) => g.name), ['Valheim', 'EA SPORTS FC™ 25', 'Subnautica', 'EA SPORTS FC™ 26', 'Team Fortress 2', 'Nie gespielt'], 'nach Spielzeit sortiert, ohne Redistributable/Soundtrack/Soundpad');
  const val = lib.games.find((g) => g.appid === 892970);
  assert.equal(val.hours, 50); assert.equal(val.updateRequired, true); assert.equal(val.installed, true);
  assert.equal(lib.games.find((g) => g.appid === 440).installed, false);
  assert.deepEqual((await steam.updates()).map((u) => u.name), ['Valheim']);
  // Game-Seiten: Subnautica ist ein eingebautes Profil (Steam-ID), „Nie gespielt“ hat 0 Minuten
  const before = storeCalls;
  const r = await steam.importProfiles({ minMinutes: 1 });
  assert.equal(storeCalls, before, 'Store-Daten kommen aus dem Cache');
  assert.equal(r.created, 2); assert.equal(r.matched, 3);
  const fc = core.gaming.context.profile('ea_fc');
  assert.equal(fc.playtimeMin, 720, 'FC 25 + FC 26 → eine Seite, Spielzeit addiert'); assert.equal(fc.genre, 'sports');
  assert.equal(core.gaming.context.profile('subnautica').playtimeMin, 125);
  const ids = core.gaming.context.profiles().filter((p) => p.source === 'steam').map((p) => p.id).sort();
  assert.deepEqual(ids, ['steam_440', 'steam_892970']);
  assert.equal(core.gaming.context.profile('steam_440').header, 'https://shared.akamai.steamstatic.com/440.jpg');
  const r2 = await steam.importProfiles({ minMinutes: 1 });
  assert.equal(r2.created, 0); assert.equal(r2.updated, 2, 'zweiter Import legt nichts doppelt an');
  assert.ok(core.gaming.context.profile('hytale'), 'Hytale-Profil vorhanden');
  cleanup();
  fs.rmSync(steamDir, { recursive: true, force: true }); fs.rmSync(lib2, { recursive: true, force: true });
});

test('Dashboard-Todos: heute fällige + wichtige nach Priorität sortiert', () => {
  const { core, cleanup } = tempCore();
  const t = core.tasks;
  const today = new Date(); today.setHours(23, 0, 0, 0);
  const tomorrow = new Date(Date.now() + 2 * 86400000);
  t.create({ title: 'Niedrig heute', priority: 'low', dueAt: today.toISOString() });
  t.create({ title: 'Mittel täglich', priority: 'medium', recurrence: { freq: 'daily' } });
  t.create({ title: 'Hoch ohne Datum', priority: 'high' });
  t.create({ title: 'Hoch heute', priority: 'high', dueAt: today.toISOString() });
  t.create({ title: 'Hoch übermorgen', priority: 'high', dueAt: tomorrow.toISOString() });
  t.create({ title: 'Mittel ohne Datum', priority: 'medium' });
  const f = t.focus(10).map((x) => x.title);
  assert.deepEqual(f, ['Hoch heute', 'Hoch ohne Datum', 'Mittel täglich', 'Niedrig heute']);
  const b = t.board();
  assert.equal(b.today[0].title, 'Hoch heute');
  cleanup();
});

test('Drive-Backup: Ordner „coding“ finden/anlegen, hochladen, nur eigene alte Sicherungen löschen', async () => {
  const calls = []; let uploaded = null;
  const { core, cleanup } = tempCore({ fetch: async (url, init) => {
    if (String(url).startsWith('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable')) {
      assert.equal(JSON.parse(init.body).appProperties.jarvis, 'backup');
      return new Response('', { status: 200, headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=abc' } });
    }
    if (String(url).includes('upload_id=abc')) { uploaded = init.body.length; return json({ id: 'new', name: 'x.zip' }); }
    throw new Error('unexpected ' + url);
  } });
  core.google.isConnected = () => true;
  core.google.token = async () => 't';
  core.settings.update({ google: { scopes: ['https://www.googleapis.com/auth/drive'] }, backupDrive: { enabled: true, folder: 'coding', keep: 2 } });
  core.google.api = async (method, p, opts = {}) => {
    calls.push([method, p, opts.query?.q || opts.body?.name || '']);
    if (method === 'GET' && opts.query.q.startsWith("name = 'coding'")) return { files: [] };
    if (method === 'POST') return { id: 'fold' };
    if (method === 'GET') { assert.match(opts.query.q, /'fold' in parents and appProperties has/); return { files: [{ id: 'new' }, { id: 'b1' }, { id: 'b2' }, { id: 'b3' }] }; }
    if (method === 'DELETE') return {};
    throw new Error('unexpected');
  };
  const r = await core.driveBackup.run({ force: false });
  assert.equal(r.ok, true); assert.ok(uploaded > 100, 'Zip hochgeladen');
  assert.deepEqual(calls.filter((c) => c[0] === 'POST').map((c) => c[2]), ['coding'], 'Ordner angelegt');
  assert.deepEqual(calls.filter((c) => c[0] === 'DELETE').map((c) => c[1]), ['/files/b2', '/files/b3']);
  assert.equal(core.driveBackup.status().lastFile, r.file);
  assert.equal((await core.driveBackup.run()).skipped, 'not-due', 'höchstens einmal pro Intervall');
  core.settings.update({ google: { scopes: ['https://www.googleapis.com/auth/drive.readonly'] } });
  await assert.rejects(core.driveBackup.run({ force: true }), /Schreibzugriff/);
  cleanup();
});

test('Geburtstage aus dem Brain → jährlicher ganztägiger Termin (anlegen, ändern, entfernen, keine Dubletten)', async () => {
  const { findBirthdays } = require('../src/main/services/birthdays');
  assert.deepEqual(findBirthdays('Max hat am 12. März Geburtstag').map((b) => [b.name, b.day, b.month]), [['Max', 12, 3]]);
  assert.deepEqual(findBirthdays('Mama hat am 24.12. Geburtstag und Papa am 1.1.').map((b) => b.name), ['Mama', 'Papa']);
  assert.deepEqual(findBirthdays('Ich habe am 5. Juni Geburtstag').map((b) => b.name), ['ich']);
  assert.equal(findBirthdays('Paul (geb. 14.07.1998) ist mein Mitbewohner')[0].year, 1998);
  assert.deepEqual(findBirthdays('Klausur Mathe am 12.03.'), [], 'kein Geburtstag ohne Stichwort');
  assert.deepEqual(findBirthdays('Opa hat am 30. Februar Geburtstag'), [], 'ungültiges Datum');

  const { core, cleanup } = tempCore();
  const y = new Date().getFullYear();
  const find = (title) => core.calendar.list(new Date(y, 0, 1).toISOString(), new Date(y, 11, 31, 23).toISOString()).filter((e) => e.title === title);
  const k = core.brain.add({ content: 'Geburtstag von Lisa: 04.05.1999', domain: 'personal', kind: 'fact' }).entry;
  core.brain.add({ content: 'Tom hat am 1. Februar Geburtstag', domain: 'personal', kind: 'fact' });
  let r = await core.birthdays.sync();
  assert.equal(r.created, 2);
  const lisa = find('Geburtstag: Lisa');
  assert.equal(lisa.length, 1); assert.equal(lisa[0].allDay, true);
  assert.equal(new Date(lisa[0].start).getDate(), 4); assert.equal(new Date(lisa[0].start).getMonth(), 4);
  assert.match(lisa[0].description, /1999/);
  assert.equal((await core.birthdays.sync()).created, 0, 'zweiter Lauf legt nichts doppelt an');
  // Datum korrigiert → Termin verschoben
  core.brain.update(k.id, { content: 'Geburtstag von Lisa: 06.05.1999' });
  r = await core.birthdays.sync();
  assert.equal(r.updated, 1);
  assert.equal(new Date(find('Geburtstag: Lisa')[0].start).getDate(), 6);
  // Eintrag gelöscht → JARVIS-Termin weg
  core.brain.remove(k.id);
  r = await core.birthdays.sync();
  assert.equal(r.removed, 1); assert.equal(find('Geburtstag: Lisa').length, 0);
  // Termin vom Nutzer gelöscht → nicht wieder anlegen
  const tom = find('Geburtstag: Tom')[0];
  await core.calendar.remove(tom.id);
  await core.birthdays.sync(); await core.birthdays.sync();
  assert.equal(find('Geburtstag: Tom').length, 0);
  // Schon vorhandener Geburtstagstermin (z. B. aus Google) → keine Dublette
  await core.calendar.create({ title: '🎂 Anna Geburtstag', start: new Date(y, 6, 9).toISOString(), allDay: true, recurrence: { freq: 'yearly' } });
  core.brain.add({ content: 'Anna hat am 9.7. Geburtstag', domain: 'personal', kind: 'fact' });
  r = await core.birthdays.sync();
  assert.equal(r.created, 0);
  // abschaltbar
  core.settings.update({ birthdaysToCalendar: false });
  core.brain.add({ content: 'Geburtstag von Ben: 02.03.', domain: 'personal', kind: 'fact' });
  assert.equal((await core.birthdays.sync()).created, 0);
  cleanup();
});

test('Spiel-Kits: jedes gespielte Steam-Spiel hat passende Fragen, Layout aus festen Bausteinen, geprüfte https-Links', () => {
  const { KITS, kitLayout } = require('../src/main/services/gaming/kits');
  const { WIDGET_TYPES } = require('../src/main/services/gaming');
  const profiles = require('../src/main/services/gaming/profiles.json');
  const { core, cleanup } = tempCore();
  for (const id of Object.keys(KITS)) {
    assert.ok(profiles.some((p) => p.id === id), 'Profil fehlt für Kit ' + id);
    const p = core.gaming.context.profile(id);
    assert.ok(p.kit && p.genre, id);
    assert.ok(p.questions.length >= 2, 'Fragen fehlen: ' + id);
    for (const l of p.links) assert.match(l.url, /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\//, id);
    for (const c of p.checklists) assert.ok(c.items.length && c.items.every((x) => typeof x === 'string' && x.length <= 120), id);
    if (p.wiki) assert.match(p.wiki.api, /^https:\/\/.+api\.php$/, id);
    const layout = core.gaming.layout(id);
    assert.ok(layout.widgets.every((w) => WIDGET_TYPES.includes(w.type)), id);
    assert.equal(layout.widgets[0].type, 'ask', id);
    assert.deepEqual(kitLayout(p).map((w) => w.type), layout.widgets.map((w) => w.type));
  }
  // Checklisten-Vorlage, bis der Nutzer etwas ändert
  const cl = core.gaming.checklist('eldenring', 'Hauptbosse');
  assert.equal(cl.preset, true); assert.ok(cl.items.some((i) => /Malenia/.test(i.text)));
  core.gaming.saveChecklist('eldenring', 'Hauptbosse', cl.items.map((i, n) => ({ ...i, done: n === 0 })));
  assert.equal(core.gaming.checklist('eldenring', 'Hauptbosse').items.filter((i) => i.done).length, 1);
  // Spezialintegrationen bleiben unverändert
  assert.equal(core.gaming.layout('league').widgets[0].type, 'lol-overview');
  cleanup();
});

test('Gemini überlastet (503): erneut versuchen, dann anderes Gemini-Modell; lesbare Meldung; „Nochmal versuchen“', async () => {
  const { friendlyError, isOverloaded } = require('../src/main/providers/gemini');
  const raw = new Error(JSON.stringify({ error: { message: JSON.stringify({ error: { code: 503, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } }), code: 503, status: 'Service Unavailable' } }));
  assert.equal(isOverloaded(raw), true);
  assert.match(friendlyError(raw), /überlastet/); assert.doesNotMatch(friendlyError(raw), /\{/);
  const { core, cleanup } = tempCore();
  core.settings.update({ availableModels: ['gemini-3.8-flash', 'gemini-3.8-flash-lite', 'gemini-3.1-pro-preview', 'gemini-embedding-2'] });
  const g = core.gemini; const sleep = async () => {};
  // 2× überlastet, dann klappt es mit demselben Modell
  let calls = [];
  let n = 0;
  assert.equal(await g.withFallback('gemini-3.8-flash', async (m) => { calls.push(m); if (n++ < 2) throw raw; return 'ok'; }, { sleep }), 'ok');
  assert.deepEqual(calls, ['gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.8-flash']);
  // dauerhaft überlastet → anderes Cloud-Modell (kein lokales Modell)
  calls = [];
  const r = await g.withFallback('gemini-3.8-flash', async (m) => { calls.push(m); if (m === 'gemini-3.8-flash') throw raw; return m; }, { sleep });
  assert.equal(r, 'gemini-3.8-flash-lite');
  // Schlüssel ungültig → sofort Fehler, keine Wiederholung
  calls = [];
  await assert.rejects(g.withFallback('gemini-3.8-flash', async (m) => { calls.push(m); throw new Error('API key not valid'); }, { sleep }));
  assert.equal(calls.length, 1);
  // Chat: Fehler → Blase mit Hinweis, „Nochmal versuchen“ erzeugt die Antwort in derselben Blase
  core.secrets.set('gemini.api_key', 'AIzaTEST'); core.settings.update({ models: { fast: 'gemini-3.8-flash' } });
  const orig = g.stepStream.bind(g);
  g.stepStream = async () => { throw raw; };
  const conv = core.conversations.create();
  const bad = await core.orchestrator.chat({ conversationId: conv.id, text: 'Analysiere meine LoL-Statistik' });
  assert.equal(bad.meta.error, true); assert.match(bad.content, /überlastet/);
  g.stepStream = orig;
  core.fake = null;
  const good = await core.orchestrator.retry({ conversationId: conv.id, messageId: bad.id });
  assert.equal(good.id, bad.id); assert.equal(good.meta.error, false); assert.ok(good.content && !/überlastet/.test(good.content));
  const msgs = core.conversations.messages(conv.id);
  assert.equal(msgs.filter((m) => m.role === 'user').length, 1, 'Frage nicht doppelt');
  assert.ok(core.conversations.history(conv.id).every((t) => !t.parts.some((p) => /⚠️/.test(p.text || ''))), 'Fehlermeldungen nicht im Verlauf ans Modell');
  cleanup();
});

test('Gemini 429: „limit 0“-Modell wird übersprungen, Minutenlimit → abwarten statt Fehler, Meldung nennt das Limit', async () => {
  const { quotaInfo, friendlyError } = require('../src/main/providers/gemini');
  const err = (txt) => Object.assign(new Error(txt), { status: 429 });
  const zero = () => err('{"error":{"code":429,"message":"You exceeded your current quota. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3.1-pro","status":"RESOURCE_EXHAUSTED"}}');
  const minute = () => err('{"error":{"code":429,"message":"Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 10, model: gemini-3.8-flash. Please retry in 21.5s.","status":"RESOURCE_EXHAUSTED","details":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]}}');
  assert.equal(quotaInfo(zero()).limit, 0);
  assert.equal(quotaInfo(minute()).perDay, false); assert.equal(quotaInfo(minute()).limit, 10);
  assert.match(friendlyError(minute()), /Anfragen pro Minute \(Limit 10\)/);
  const { core, cleanup } = tempCore();
  const g = core.gemini; const waits = [];
  g.sleep = async (ms) => { waits.push(ms); };
  core.settings.update({ availableModels: ['gemini-3.1-pro', 'gemini-3.8-flash', 'gemini-3.8-flash-lite'], models: { reasoning: '', fast: '' } });
  assert.equal(g.model('reasoning'), 'gemini-3.1-pro');
  const r = await g.withFallback('gemini-3.1-pro', async (m) => { if (m === 'gemini-3.1-pro') throw zero(); return m; });
  assert.equal(r, 'gemini-3.8-flash');
  assert.notEqual(g.model('reasoning'), 'gemini-3.1-pro', 'Pro wird danach direkt übersprungen');
  // Minutenlimit überall → einmal warten (mit Hinweis), dann klappt es
  let round = 0; const notices = [];
  const out = await g.withFallback('gemini-3.8-flash', async (m) => { if (round < 2) { round++; throw minute(); } return 'ok:' + m; }, { onWait: (ms) => notices.push(ms) });
  assert.match(out, /^ok:/); assert.equal(notices.length, 1); assert.ok(notices[0] >= 20000 && notices[0] <= 65000);
  cleanup();
});

test('Gemini 402 (Guthaben leer): sofort klare Meldung, keine Wiederholungen; Omni-Modelle nie als Ausweichmodell', async () => {
  const { friendlyError, isQuota, isPayment } = require('../src/main/providers/gemini');
  const e402 = Object.assign(new Error('{"error":{"code":402,"message":"Your prepayment credits are depleted. Please go to AI Studio to manage your project and billing.","status":"PAYMENT_REQUIRED"}}'), { status: 402 });
  assert.equal(isPayment(e402), true); assert.equal(isQuota(e402), false);
  assert.match(friendlyError(e402), /kein Guthaben \(402\)/);
  const { core, cleanup } = tempCore();
  core.gemini.sleep = async () => {};
  core.settings.update({ availableModels: ['gemini-3.8-flash', 'gemini-omni-flash', 'gemini-omni-1.1-flash', 'gemini-3.7-flash'] });
  let calls = 0;
  await assert.rejects(core.gemini.withFallback('gemini-3.8-flash', async () => { calls++; throw e402; }), /402/);
  assert.equal(calls, 1);
  const tried = [];
  const quota = Object.assign(new Error('{"error":{"code":429,"message":"Quota exceeded, limit: 5, model: x. Please retry in 30s.","status":"RESOURCE_EXHAUSTED"}}'), { status: 429 });
  await core.gemini.withFallback('gemini-3.8-flash', async (m) => { tried.push(m); if (m === 'gemini-3.8-flash') throw quota; return m; });
  assert.ok(!tried.some((m) => /omni/.test(m)), 'kein Omni-Modell: ' + tried.join(','));
  cleanup();
});
