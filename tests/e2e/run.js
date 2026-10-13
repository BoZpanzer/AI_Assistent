'use strict';
/**
 * End-to-end UI test: starts the real Electron app (main + renderer) against
 * a temporary data directory, seeds data, drives every page, verifies the
 * renderer has no errors and writes screenshots to tests/e2e/screens/.
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-e2e-'));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_E2E = '1';
process.env.JARVIS_FAKE_GEMINI = '1';
const { app } = require('electron');
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
require('../../src/main/index.js');

const SHOTS = path.join(__dirname, 'screens');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(100); } throw new Error('Timeout'); }

async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); } catch (e) { results.push({ name, ok: false, error: e.message }); }
}

app.whenReady().then(async () => {
  const { win, core } = await waitFor(() => global.__jarvis);
  win.setSize(1600, 1000);
  win.webContents.on('console-message', (e) => { const lvl = e.level ?? e; if (lvl === 'error' || lvl === 3) errors.push(e.message); });
  win.webContents.on('preload-error', (_e, p, err) => errors.push('preload: ' + err.message));
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => { await sleep(900); const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(SHOTS, name + '.png'), img.toPNG()); };
  const say = async (text) => {
    await js(`(()=>{const t=document.querySelector('.chatbar textarea'); const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set; set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await sleep(150);
    await js(`document.querySelector('.chatbar .send').click()`);
  };
  const nav = async (page) => { await js(`document.querySelectorAll('.nav button')[${['dashboard', 'chat', 'tasks', 'calendar', 'study', 'gaming', 'brain', 'settings'].indexOf(page)}].click()`); await sleep(400); };
  await waitFor(() => js('!!document.querySelector(".frame .sidebar")').catch(() => false), 20000);

  await step('Einrichtungsassistent erscheint beim ersten Start', async () => {
    if (!(await js('!!document.querySelector(".setup")'))) throw new Error('Setup fehlt');
    await shot('00-setup');
  });
  await step('Setup: Gemini-Schlüssel prüfen (Fake-API)', async () => {
    await js(`[...document.querySelectorAll('.setup .btn')].find(b=>b.textContent.includes('Weiter')).click()`);
    await sleep(300);
    await js(`(()=>{const i=document.querySelector('.setup input[type=password]'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(i,'AIzaTESTKEY-0123456789abcdefghij'); i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await sleep(100);
    await js(`[...document.querySelectorAll('.setup .btn')].find(b=>b.textContent.includes('Verbindung testen')).click()`);
    await waitFor(() => js(`document.querySelector('.setup .pane-body').textContent.includes('Verbindung erfolgreich')`));
    await shot('01-setup-gemini');
    await core.settings.update({ setupComplete: true });
    await js(`[...document.querySelectorAll('.setup .btn')].find(b=>b.textContent.includes('Später')).click()`);
  });

  // Seed realistic data
  const now = new Date(); const at = (d, h, m = 0) => { const x = new Date(now); x.setDate(x.getDate() + d); x.setHours(h, m, 0, 0); return x.toISOString(); };
  core.settings.update({ nickname: 'Chef', userName: 'BoZ' });
  const t1 = core.tasks.create({ title: 'Projektbesprechung KI', category: 'Studium', priority: 'high', dueAt: at(0, 10), notes: 'Besprechung der aktuellen Fortschritte im KI-Projekt. Ergebnisse der Analyse-Tools vorstellen und nächste Schritte definieren.' });
  core.tasks.create({ title: 'Vorbereitung der Präsentation', parentId: t1.id }); core.tasks.complete(core.tasks.create({ title: 'Datenanalyse zusammenfassen', parentId: t1.id }).id);
  core.tasks.create({ title: 'Offene Fragen notieren', parentId: t1.id });
  core.tasks.create({ title: 'Analyse-Tools recherchieren', category: 'Studium', priority: 'medium', dueAt: at(0, 13) });
  core.tasks.create({ title: 'Sport: Krafttraining', category: 'Gesundheit', priority: 'medium', dueAt: at(0, 17) });
  core.tasks.create({ title: 'E-Mails beantworten', category: 'Organisation', priority: 'low', dueAt: at(0, 18) });
  core.tasks.create({ title: 'Tagesreflexion schreiben', category: 'Persönlich', priority: 'low', dueAt: at(0, 21) });
  core.tasks.create({ title: 'Tägliche Planung', category: 'Routine', priority: 'medium', dueAt: at(1, 8), recurrence: { freq: 'daily' } });
  core.tasks.create({ title: 'Deutsch-Vokabeln', category: 'Studium', priority: 'medium', dueAt: at(1, 19), recurrence: { freq: 'daily' } });
  core.tasks.create({ title: 'Wohnung aufräumen', category: 'Privat', priority: 'low', dueAt: at(6, 11), recurrence: { freq: 'weekly', byDay: ['SU'] } });
  core.tasks.create({ title: 'Hausarbeit Entwurf abgeben', category: 'Studium', priority: 'high', dueAt: at(2, 23, 59), allDay: true });
  core.tasks.create({ title: 'Literaturrecherche abschließen', category: 'Studium', priority: 'medium', dueAt: at(3, 23, 59), allDay: true });
  core.tasks.create({ title: 'Geburtstagsgeschenk besorgen', category: 'Privat', priority: 'low', dueAt: at(4, 23, 59), allDay: true });
  core.tasks.complete(core.tasks.create({ title: 'Recherche zu KI-Modellen', category: 'Studium' }).id);
  core.tasks.complete(core.tasks.create({ title: 'Einkaufen', category: 'Privat' }).id);
  await core.calendar.create({ title: 'Vorlesung Neuronale Netze', start: at(0, 8, 15), end: at(0, 9, 45), location: 'DHSN Hörsaal 3' });
  await core.calendar.create({ title: 'Projektgruppe KI', start: at(2, 16), end: at(2, 17), location: 'Online (Discord)' });
  await core.calendar.create({ title: 'Lerngruppe Mathe', start: at(3, 14), end: at(3, 15, 30) });
  for (const [content, domain, kind, tags] of [
    ['Idee: Integration eines lokalen LLM in Home Assistant zur natürlichen Sprachsteuerung und automatisierten Abläufen. Ziel ist eine datenschutzfreundliche Lösung ohne Cloud-Abhängigkeit.', 'projects', 'idea', ['KI', 'Smart Home']],
    ['Hausautomation Projektplan: Sensoren im Wohnzimmer, Heizungssteuerung, Sprachbefehle über JARVIS.', 'projects', 'project', ['Hausautomation']],
    ['Lieblingschampion ist Jhin (ADC).', 'gaming', 'preference', ['LoL']],
    ['Studiert Informatik an der DHSN Leipzig.', 'personal', 'memory', ['Studium']],
    ['Vergleich Home Assistant vs. OpenHAB: Home Assistant hat die größere Community.', 'technology', 'fact', ['Smart Home']],
    ['Backpropagation berechnet Gradienten mit der Kettenregel.', 'study', 'fact', ['Neuronale Netze']],
    ['Idee: JARVIS-Overlay für Spiele mit Timer-Anzeige.', 'ideas', 'idea', ['Gaming']],
    ['Best Practices für lokale LLMs: Quantisierung, Kontextfenster beachten.', 'sources', 'source', ['KI']],
  ]) core.brain.add({ content, domain, kind, tags, sourceType: domain === 'sources' ? 'web' : 'user' });
  const a = core.brain.list({ domain: 'projects' }); if (a.length > 1) core.brain.link(a[0].id, a[1].id);
  core.gaming.addTimer({ game: 'Rise of Kingdoms', label: 'Rathaus Stufe 22', kind: 'build', minutes: 287 });
  core.gaming.addTimer({ game: 'Rise of Kingdoms', label: 'Forschung Ausrüstung', kind: 'research', minutes: 95 });
  core.gaming.addTimer({ game: 'ARK', label: 'Rex-Zähmung', kind: 'taming', minutes: 42 });
  core.notifications.push({ category: 'gaming', origin: 'timer', game: 'rok', title: 'Rise of Kingdoms: Forschung abgeschlossen', body: 'Chef, dein Forschungs-Timer ist abgelaufen. (Gespeicherter Timer – kein bestätigter Spielstatus.)', toast: false });
  core.notifications.push({ category: 'system', title: 'Systemmeldung', body: 'Sicherung erstellt.', toast: false });
  await sleep(500);

  await step('Dashboard: Orb + Chat + Werkzeugaufruf (Tagesüberblick)', async () => {
    await nav('dashboard');
    await say('Jarvis, was steht heute an?');
    await waitFor(() => js(`document.querySelector('.chat-list').textContent.includes('Überblick')`), 15000);
    await shot('10-dashboard');
  });
  await step('Chat: Termin mit Bestätigungskarte', async () => {
    await nav('chat');
    await say('Trag morgen um 16 Uhr Mathe lernen ein');
    await waitFor(() => js(`!!document.querySelector('.card-confirm')`), 15000);
    await shot('20-chat-confirm');
    const before = core.calendar.list(new Date(), new Date(Date.now() + 3 * 86400000)).length;
    await js(`[...document.querySelectorAll('.card-confirm .btn')].find(b=>b.textContent.includes('Bestätigen')).click()`);
    await waitFor(() => core.calendar.list(new Date(), new Date(Date.now() + 3 * 86400000)).length === before + 1, 8000);
    await waitFor(() => js(`document.querySelector('.card-confirm').textContent.includes('Ausgeführt')`), 5000);
    await shot('21-chat-confirmed');
  });
  await step('Aufgaben: Board, Detail, Abhaken', async () => {
    await nav('tasks');
    await waitFor(() => js(`document.querySelectorAll('.task-row').length > 5`));
    await js(`document.querySelector('.task-row').click()`);
    await shot('30-tasks');
    const open = core.tasks.counts().open;
    await js(`document.querySelector('.task-row .checkbox').click()`);
    await waitFor(() => core.tasks.counts().open === open - 1, 5000);
  });
  await step('Kalender: Monats- und Wochenansicht', async () => {
    await nav('calendar'); await shot('40-calendar-month');
    await js(`[...document.querySelectorAll('.tabs button')].find(b=>b.textContent==='Woche').click()`); await shot('41-calendar-week');
  });
  await step('Studium', async () => { await nav('study'); await shot('50-study'); });
  await step('Gaming: Spielkontext per Chat setzen (Tarkov) → Oberfläche passt sich an', async () => {
    await nav('gaming'); await shot('60-gaming-empty');
    await say('Jarvis, ich spiele gerade Escape from Tarkov');
    await waitFor(() => js(`document.querySelector('.game-hero')?.textContent.includes('Escape from Tarkov')`), 15000);
    core.gaming.addMarker('eft', 'customs', { x: 0.42, y: 0.38, category: 'loot', label: 'Dorms' });
    core.gaming.addMarker('eft', 'customs', { x: 0.62, y: 0.55, category: 'danger', label: 'Scavs' });
    core.gaming.addMarker('eft', 'customs', { x: 0.2, y: 0.7, category: 'exit', label: 'ZB-1011' });
    await shot('61-gaming-tarkov');
  });
  await step('Gaming: League of Legends & Rise of Kingdoms Layouts', async () => {
    core.gaming.context.setActive('league', 'manual'); await sleep(600); await shot('62-gaming-league');
    core.gaming.context.setActive('rok', 'manual'); await sleep(600); await shot('63-gaming-rok');
    core.gaming.context.setActive('ark', 'manual'); await sleep(600); await shot('64-gaming-ark');
  });
  await step('Spielstand: „Sun Tzu ist Level 40“ → gemerkt, im Widget sichtbar, im Kontext', async () => {
    await nav('gaming');
    core.gaming.context.setActive('rok', 'manual');
    await say('Jarvis, mein Sun Tzu ist jetzt Level 40 und das Rathaus Stufe 22');
    await waitFor(() => core.gaming.progress.list('rok').length === 2, 15000);
    await waitFor(() => js(`[...document.querySelectorAll('.panel')].some(p=>p.textContent.includes('Mein Spielstand') && p.textContent.includes('Sun Tzu') && p.textContent.includes('Level 40'))`), 8000);
    if (!/Sun Tzu – Level 40/.test(core.orchestrator.system('text', ''))) throw new Error('Spielstand fehlt im Kontext');
    await js(`document.querySelector('[title="Sprachmodus beenden"]')?.click()`);
    await shot('65-gaming-progress');
  });
  await step('Brain: Graph mit echten Daten', async () => {
    await nav('brain');
    await waitFor(() => js(`document.querySelectorAll('.gnode.domain').length >= 8`));
    await js(`document.querySelectorAll('.result-row')[0]?.click()`);
    await shot('70-brain');
  });
  await step('Sprachmodus: Mikrofon → Gemini Live (Fake) → Audioantwort → Transkript im Chat', async () => {
    await nav('dashboard');
    await js(`document.querySelector('.chatbar .mic').click()`);
    await waitFor(() => global.__fakeLive?.answered === 1, 15000);
    await waitFor(() => js(`document.querySelector('.chat-list').textContent.includes('ich höre dich')`), 10000);
    await shot('15-voice');
    const st = core.voice.state;
    if (!['speaking', 'listening'].includes(st)) throw new Error('Unerwarteter Zustand: ' + st);
    await sleep(1800);
    const msgs = core.conversations.messages(core.voice.conversationId);
    if (!msgs.some((m) => m.channel === 'voice' && m.content.includes('Hallo Jarvis'))) throw new Error('Sprach-Transkript fehlt im Verlauf');
    await js(`document.querySelector('.chatbar .mic.on').click()`);
    await waitFor(() => core.voice.state === 'off', 5000);
    if (!global.__fakeLive.closed) throw new Error('Live-Sitzung nicht geschlossen');
  });
  await step('Einstellungen', async () => { await nav('settings'); await shot('80-settings'); });
  await step('Renderer ohne Fehler', async () => { const real = errors.filter((e) => !/Autofill|Electron Security Warning|ddragon|ERR_|net::|Failed to load resource|tarkov|DevTools/i.test(e)); if (real.length) throw new Error(real.slice(0, 5).join(' | ')); });

  const report = { at: new Date().toISOString(), results, consoleErrors: errors };
  fs.writeFileSync(path.join(__dirname, 'e2e-report.json'), JSON.stringify(report, null, 2));
  for (const r of results) console.log(`${r.ok ? '✔' : '✖'} ${r.name}${r.ok ? ` (${r.ms} ms)` : ' — ' + r.error}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} E2E-Schritte bestanden`);
  setTimeout(() => { try { core.stop(); } catch { /* */ } fs.rmSync(dir, { recursive: true, force: true }); app.exit(failed ? 1 : 0); }, 300);
});
