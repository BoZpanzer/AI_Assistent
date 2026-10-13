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
