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
  await step('Tarkov-Karte: von tarkov.dev geladen (Fake), Exit an berechneter Position', async () => {
    const origMaps = core.gaming.tarkov.maps; const origFetch = core.gaming.tarkovMaps.fetch;
    try {
    core.gaming.tarkov.maps = async () => ({ value: [{ name: 'Zollgebiet', normalizedName: 'customs', extracts: [{ name: 'Testexit', faction: 'pmc', position: { x: 166.5, y: 0, z: -35 } }], locks: [], transits: [], bosses: [], players: '8-12', raidDuration: 40 }], source: 'test', fetchedAt: new Date().toISOString() });
    core.gaming.tarkovMaps.fetch = async (url) => (/maps\.json$/.test(url) ? new Response('', { status: 503 }) : new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1062 535"><style>.l{fill:#1f5054}</style><g id="Ground_Level"><rect class="l" width="1062" height="535"/><circle cx="531" cy="267" r="40" fill="#c6c2c2"/></g><g id="Second_Floor"><rect width="1062" height="535" fill="red"/></g></svg>'));
    await nav('dashboard'); await nav('gaming'); await sleep(500);
    await js(`[...document.querySelectorAll('.map-tools .tool')].find(t=>t.textContent.includes('Karten laden'))?.click()`);
    await waitFor(() => js(`!!document.querySelector('.map-inner img') && document.querySelector('.map-inner img').naturalWidth > 0`), 15000);
    await waitFor(() => js(`[...document.querySelectorAll('.marker .lbl')].some(l=>l.textContent==='Testexit')`), 8000);
    const pos = await js(`(()=>{const m=[...document.querySelectorAll('.marker')].find(x=>x.textContent.includes('Testexit')); const i=document.querySelector('.map-inner'); return { l: parseFloat(m.style.left)/parseFloat(i.style.width), t: parseFloat(m.style.top)/parseFloat(i.style.height) };})()`);
    // Mittelpunkt des Rechtecks: x=(698-372)/2=163, z=(237-307)/2=-35 → (0.5, 0.5); 166.5 liegt minimal links davon
    if (!(Math.abs(pos.l - 0.4967) < 0.01 && Math.abs(pos.t - 0.5) < 0.01)) throw new Error('Exit an falscher Stelle: ' + JSON.stringify(pos));
    if (!(await js(`document.body.textContent.includes('tarkov.dev (CC BY-NC-SA 4.0)')`))) throw new Error('Quellenangabe fehlt');
    await shot('61b-gaming-tarkov-map');
    } finally { core.gaming.tarkov.maps = origMaps; core.gaming.tarkovMaps.fetch = origFetch; }
  });
  await step('Gaming: League of Legends & Rise of Kingdoms Layouts', async () => {
    core.gaming.context.setActive('league', 'manual'); await sleep(600); await shot('62-gaming-league');
    core.gaming.context.setActive('rok', 'manual'); await sleep(600); await shot('63-gaming-rok');
    core.gaming.context.setActive('ark', 'manual'); await sleep(600); await shot('64-gaming-ark');
  });
  await step('Spiel-Kits: Rust mit Fragen, Force-Wipe-Termin, Checkliste; Elden Ring mit Bossliste', async () => {
    core.gaming.context.setState('steam:stats', { rust: { minutes: 16638, lastPlayed: '2024-04-01T18:00:00Z', appid: 252490, appids: [252490] } });
    await nav('dashboard'); await nav('gaming');
    core.gaming.context.setActive('rust', 'manual'); await sleep(800);
    await waitFor(() => js(`document.body.textContent.includes('Frag JARVIS zu Rust') && document.body.textContent.includes('Monatlicher Force-Wipe') && document.body.textContent.includes('Nach dem Wipe')`), 8000);
    if (!(await js(`document.body.textContent.includes('277,3 h gespielt')`))) throw new Error('Steam-Spielzeit fehlt');
    await shot('66-gaming-rust-kit');
    // Frage mit „…“ landet im Eingabefeld statt sofort gesendet zu werden
    await js(`[...document.querySelectorAll('.ask-chip')].find(c=>c.textContent.includes('…')).click()`); await sleep(200);
    const v = await js(`document.querySelector('.panel input.inp.grow').value`);
    if (!v || v.includes('…')) throw new Error('Platzhalter-Frage nicht übernommen: ' + v);
    core.gaming.context.setActive('eldenring', 'manual'); await sleep(800);
    await waitFor(() => js(`document.body.textContent.includes('Hauptbosse') && document.body.textContent.includes('Malenia')`), 8000);
    await shot('67-gaming-eldenring-kit');
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
    // kleineres Fenster (wie 1540×1050 bei Skalierung): Karten rechts dürfen sich nicht überlappen
    win.setSize(1366, 900); await sleep(500);
    const overlap = await js(`(()=>{const c=[...document.querySelectorAll('.rightcol .rcard')].map(e=>e.getBoundingClientRect()); for(let i=1;i<c.length;i++) if(c[i].top < c[i-1].bottom - 1) return i; return 0;})()`);
    if (overlap) throw new Error('Rechte Karten überlappen (Karte ' + overlap + ')');
    const out = await js(`(()=>{const w=document.querySelector('.graph-wrap').getBoundingClientRect(); return [...document.querySelectorAll('.gnode.domain')].filter(g=>{const r=g.getBoundingClientRect(); return r.top < w.top-1 || r.bottom > w.bottom+1 || r.left < w.left-1 || r.right > w.right+1;}).length;})()`);
    if (out) throw new Error(out + ' Graph-Knoten ragen aus der Fläche');
    await shot('71-brain-small');
    // Geburtstag im Brain → Termin im Kalender
    core.brain.add({ content: 'Meine Schwester Anna hat am 3. Mai Geburtstag', domain: 'personal', kind: 'fact' });
    const r = await core.birthdays.sync();
    if (r.created !== 1) throw new Error('Geburtstag nicht eingetragen: ' + JSON.stringify(r));
    const ev = core.calendar.list(new Date(new Date().getFullYear(), 4, 1).toISOString(), new Date(new Date().getFullYear(), 4, 31).toISOString()).find((e) => e.title === 'Geburtstag: Anna (Schwester)');
    if (!ev || !ev.allDay) throw new Error('Termin fehlt oder nicht ganztägig');
    win.setSize(1600, 1000); await sleep(300);
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
  await step('Klausurmodus auf der Studium-Seite + Lernplan-Vorschlag', async () => {
    core.exams.create({ title: 'Klausur Mathematik II', subject: 'Mathematik', date: new Date(Date.now() + 21 * 86400000).toISOString(), targetHours: 12, notes: 'Aus Campus-Dual-Stundenplan übernommen. Raum: Aula' });
    await nav('study'); await sleep(600);
    await waitFor(() => js(`document.body.textContent.includes('Klausur Mathematik II')`), 5000);
    await js(`[...document.querySelectorAll('.btn')].find(b=>b.textContent.trim()==='Lernplan').click()`);
    await waitFor(() => js(`!!document.querySelector('.modal') && document.querySelector('.modal').textContent.includes('In den Kalender eintragen')`), 8000);
    await shot('52-study-exam-plan');
    await js(`[...document.querySelectorAll('.modal .btn')].find(b=>b.textContent.includes('In den Kalender eintragen')).click()`);
    await waitFor(() => js(`document.body.textContent.includes('h geplant')`), 8000);
    await shot('51-study-exams');
  });
  await step('Gestaltete Seite für ein unbekanntes Spiel', async () => {
    const p = core.gaming.context.resolve('Valheim');
    core.gaming.context.setState('design:' + p.id, { genre: 'survival', summary: 'Wikinger-Survival.', widgets: [{ type: 'ask', params: {} }, { type: 'progress', params: {} }, { type: 'checklist', params: { name: 'Bosse' } }, { type: 'timers', params: { kinds: ['build', 'custom'] } }, { type: 'game-research', params: { query: '' } }, { type: 'notes', params: {} }, { type: 'other-games', params: {} }],
      questions: ['Wie besiege ich …?', 'Was baue ich zuerst?'], progressCats: [['bosse', 'Bosse', 'Eikthyr', ''], ['base', 'Basis', '', '']], checklists: [{ name: 'Bosse', items: ['Eikthyr', 'The Elder', 'Bonemass'] }], links: [], wiki: null, timerKinds: ['build'], sources: [{ title: 'Valheim Wiki', url: 'https://valheim.fandom.com' }], createdAt: new Date().toISOString() });
    core.gaming.context.setActive(p.id, 'manual');
    await nav('dashboard'); await nav('gaming'); await sleep(900);
    await waitFor(() => js(`document.body.textContent.includes('Von JARVIS gestaltet') && document.body.textContent.includes('Eikthyr')`), 6000);
    await shot('68-gaming-designed');
  });
  await step('Einstellungen', async () => {
    await nav('settings'); await shot('80-settings');
    if (!(await js(`[...document.querySelectorAll('.panel')].some(p=>p.textContent.includes('Campus Dual') && p.textContent.includes('Prüfungsergebnisse'))`))) throw new Error('Campus-Dual-Karte fehlt');
    await js(`[...document.querySelectorAll('.panel')].find(p=>p.textContent.includes('Prüfungsergebnisse melden')).scrollIntoView()`); await shot('80b-settings-campusdual');
    await js(`[...document.querySelectorAll('.panel')].find(p=>p.textContent.includes('Monatsbudget')).scrollIntoView()`); await shot('80c-settings-budget');
    if (!(await js(`document.body.textContent.includes('Monatsbudget Gemini')`))) throw new Error('Budget fehlt');
  });
  await step('Systemcheck: Probleme mit Lösungs-Knopf', async () => {
    core.updater.check = async () => ({});
    await js(`[...document.querySelectorAll('.chatbar .btn')].find(b=>b.textContent.includes('Systemcheck')).click()`);
    await waitFor(() => js(`!!document.querySelector('.modal') && document.querySelector('.modal').textContent.includes('Datenbank')`), 30000);
    await shot('81-systemcheck');
    if (!(await js(`document.querySelectorAll('.modal .check-line').length >= 6`))) throw new Error('zu wenige Prüfungen');
    await js(`[...document.querySelectorAll('.modal .btn')].find(b=>b.textContent.trim()==='Schließen').click()`);
  });
  await step('Kalender: Campus Dual verbinden (Anleitung sichtbar)', async () => {
    await nav('calendar');
    await waitFor(() => js(`document.body.textContent.includes('Bei Campus Dual anmelden')`), 5000);
    await js(`[...document.querySelectorAll('.btn')].find(b=>b.textContent.includes('Matrikelnummer + Hash'))?.click()`);
    await waitFor(() => js(`document.body.textContent.includes('im Filter „room“')`), 5000);
    win.setSize(1280, 800); await sleep(500); await shot('46-campusdual'); win.setSize(1600, 1000); await sleep(300);
  });
  await step('Kalender: ganztägiger Geburtstag mit Farbe + eigenes Dropdown', async () => {
    await nav('calendar');
    await js(`(()=>{ const c=[...document.querySelectorAll('.cal-cell')].find((x)=>!x.classList.contains('other')); c.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); })()`);
    await waitFor(() => js('!!document.querySelector(".modal")'), 4000);
    await js(`(()=>{ const t=document.querySelector('.modal input.inp'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(t,'Geburtstag Testperson'); t.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await sleep(200);
    if (!(await js('!!document.querySelector(".modal input[type=date]")'))) throw new Error('Ganztägig wurde nicht vorgeschlagen');
    if (!(await js('[...document.querySelectorAll(".modal .seg button.active")].some((b)=>b.textContent==="Jährlich")'))) throw new Error('Jährlich nicht vorgeschlagen');
    await js('document.querySelectorAll(".modal .swatches .sw")[4].click()');
    await shot('45-geburtstag');
    await js('[...document.querySelectorAll(".modal button")].find((b)=>b.textContent==="Speichern").click()');
    await waitFor(() => js('!document.querySelector(".modal")'), 4000);
    const ev = core.calendar.list(new Date(Date.now() - 40 * 86400000), new Date(Date.now() + 60 * 86400000)).find((e) => e.title === 'Geburtstag Testperson');
    if (!ev || !ev.allDay || ev.colorId !== '4' || !ev.recurring) throw new Error('Termin falsch gespeichert: ' + JSON.stringify(ev && { allDay: ev.allDay, colorId: ev.colorId, recurring: ev.recurring }));
    // Eigenes Dropdown (Einstellungen → Startseite)
    await nav('settings');
    await js('[...document.querySelectorAll(".sel.dd")].find((b)=>b.textContent.trim()==="Dashboard").click()');
    await waitFor(() => js('!!document.querySelector(".dd-list")'), 2000);
    const before = core.settings.get('startPage');
    await js(`(()=>{ const o=[...document.querySelectorAll('.dd-opt')].find((x)=>x.textContent.includes('Aufgaben')); o.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); })()`);
    await sleep(300);
    if (core.settings.get('startPage') !== 'tasks') throw new Error('Dropdown-Auswahl nicht übernommen (vorher ' + before + ')');
    core.settings.update({ startPage: before });
  });
  await step('Update-Button: erscheint bei signiertem Update, Dialog mit Changelog', async () => {
    core.updater.set({ state: 'available', version: '9.9.9', signed: true, notes: '## Neu\n- Testfeature', size: 110 * 1048576, publishedAt: new Date().toISOString() });
    await waitFor(() => js('!!document.querySelector(".update-btn")'), 5000);
    const label = await js('document.querySelector(".update-btn").textContent');
    if (!/9\.9\.9/.test(label)) throw new Error('Beschriftung: ' + label);
    await js('document.querySelector(".update-btn").click()');
    await waitFor(() => js('!!document.querySelector(".update-notes")'), 3000);
    if (!(await js('/Testfeature/.test(document.querySelector(".update-notes").textContent)'))) throw new Error('Changelog fehlt');
    await shot('85-update');
    await js('[...document.querySelectorAll(".modal button")].find((b) => b.textContent.includes("Später")).click()');
    core.updater.set({ state: 'available', signed: false });
    await sleep(300);
    if (await js('!!document.querySelector(".update-btn")')) throw new Error('Unsigniertes Update darf keinen Button zeigen');
    core.updater.set({ state: 'current' });
  });
  await step('Renderer ohne Fehler', async () => { const real = errors.filter((e) => !/Autofill|Electron Security Warning|ddragon|ERR_|net::|Failed to load resource|tarkov|DevTools/i.test(e)); if (real.length) throw new Error(real.slice(0, 5).join(' | ')); });

  const report = { at: new Date().toISOString(), results, consoleErrors: errors };
  fs.writeFileSync(path.join(__dirname, 'e2e-report.json'), JSON.stringify(report, null, 2));
  for (const r of results) console.log(`${r.ok ? '✔' : '✖'} ${r.name}${r.ok ? ` (${r.ms} ms)` : ' — ' + r.error}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} E2E-Schritte bestanden`);
  setTimeout(() => { try { core.stop(); } catch { /* */ } fs.rmSync(dir, { recursive: true, force: true }); app.exit(failed ? 1 : 0); }, 300);
});
