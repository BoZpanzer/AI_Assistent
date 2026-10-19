'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, safeStorage, shell, protocol, net, globalShortcut, session, powerMonitor, desktopCapturer, screen } = require('electron');
const { Overlay, MapCorner } = require('./overlay');
const { createCore } = require('./app-core');
const { registerIpc } = require('./ipc');
const logger = require('./core/logger');

const APP_ID = 'de.boz.jarvis';
const VERSION = app.getVersion();
const isDev = !app.isPackaged && process.env.JARVIS_DEV === '1';
const isE2E = !app.isPackaged && process.env.JARVIS_E2E === '1';
const isSmoke = process.argv.includes('--smoke');
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const ICON = path.join(__dirname, '..', '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

// Data lives in %APPDATA%\JARVIS — outside the install dir, survives updates/uninstall.
if (isSmoke) app.setPath('userData', fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'jarvis-smoke-')));
else if (process.env.JARVIS_DATA_DIR) app.setPath('userData', process.env.JARVIS_DATA_DIR);
else app.setPath('userData', path.join(app.getPath('appData'), 'JARVIS'));
app.setAppUserModelId(APP_ID);

// Single instance: a second start focuses the running JARVIS.
if (!isE2E && !isSmoke && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// Renderer is served from a private, privileged scheme (no web server, no localhost).
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true } }]);

app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let win = null; let tray = null; let core = null; let quitting = false; let overlay = null; let mapCorner = null;
const startHidden = process.argv.includes('--hidden') && !process.argv.includes('--updated');
const justUpdated = process.argv.includes('--updated');

function cipher() {
  return {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (s) => safeStorage.encryptString(s),
    decrypt: (b) => safeStorage.decryptString(b),
  };
}

function loadUpdateKey() {
  try { const p = path.join(__dirname, '..', '..', 'build', 'update-public-key.pem'); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; } catch { return null; }
}

/** Baked in by the release workflow: { repo: "owner/name" } */
function loadUpdateRepo() {
  try { const p = path.join(__dirname, '..', '..', 'build', 'update-config.json'); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')).repo || null : null; } catch { return null; }
}

function createWindow() {
  const s = core.settings.all();
  win = new BrowserWindow({
    width: 1480, height: 940, minWidth: 1180, minHeight: 740, show: false, frame: false, backgroundColor: '#040a13',
    title: 'JARVIS', icon: ICON, alwaysOnTop: !!s.alwaysOnTop,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, spellcheck: false, backgroundThrottling: false, devTools: isDev || !app.isPackaged,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadURL('app://jarvis/index.html');
  win.once('ready-to-show', () => {
    // Nach einem Update immer sichtbar starten (auch wenn „minimiert starten“ aktiv ist)
    if (justUpdated || !(startHidden || s.startMinimized)) { win.show(); win.focus(); }
    if (justUpdated) setTimeout(() => toast('JARVIS aktualisiert', `Version ${VERSION} ist installiert – deine Daten sind unverändert.`), 1500);
  });
  win.on('close', (e) => {
    if (!quitting && core.settings.get('closeToTray')) { e.preventDefault(); win.hide(); send('window', { visible: false }); }
  });
  win.on('show', () => send('window', { visible: true }));
  win.on('minimize', () => send('window', { visible: false, minimized: true }));
  win.on('restore', () => send('window', { visible: true }));
  win.on('maximize', () => send('window', { maximized: true }));
  win.on('unmaximize', () => send('window', { maximized: false }));
  // Hard navigation lock: never leave the app, never open new windows.
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://jarvis/')) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('render-process-gone', (_e, d) => logger.scope('main').error('Renderer beendet: ' + d.reason));
}

// Overlay gets everything except high-rate streams it does not need.
const OVERLAY_SKIP = new Set(['voice:audio', 'chat:delta', 'message:update', 'study:progress']);
function send(type, data) {
  if (win && !win.isDestroyed()) win.webContents.send('evt', { type, data });
  if (overlay?.visible && !OVERLAY_SKIP.has(type)) overlay.send(type, data);
  if (mapCorner?.visible && /^(game:|settings:)/.test(type)) mapCorner.send(type, data);
}

/** Ausschnitt um den Mauszeiger (Item-Scanner): ~640×420 echte Pixel, Overlays kurz ausgeblendet. */
async function captureAroundCursor() {
  const pt = screen.getCursorScreenPoint();
  const disp = screen.getDisplayNearestPoint(pt);
  const sf = disp.scaleFactor || 1;
  const full = { width: Math.round(disp.size.width * sf), height: Math.round(disp.size.height * sf) };
  const hide = [overlay, mapCorner].map((o) => (o?.win && !o.win.isDestroyed() && o.visible ? o : null)).filter(Boolean);
  for (const o of hide) o.win.setOpacity(0);
  if (hide.length) await new Promise((r) => setTimeout(r, 60));
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: full });
    const src = sources.find((x) => String(x.display_id) === String(disp.id)) || sources[0];
    if (!src || src.thumbnail.isEmpty()) throw new Error('Kein Bildschirmbild erhalten');
    const img = src.thumbnail; const sz = img.getSize();
    const k = sz.width / disp.size.width; // Thumbnail-Pixel pro DIP
    const cx = (pt.x - disp.bounds.x) * k; const cy = (pt.y - disp.bounds.y) * k;
    const w = Math.min(sz.width, Math.round(640 * k / sf * sf)); const h = Math.min(sz.height, Math.round(420 * k / sf * sf));
    const x = Math.max(0, Math.min(sz.width - w, Math.round(cx - w / 2))); const y = Math.max(0, Math.min(sz.height - h, Math.round(cy - h / 2)));
    const crop = img.crop({ x, y, width: w, height: h });
    return { data: crop.toJPEG(88), width: w, height: h };
  } finally { for (const o of hide) o.applyBounds(); }
}

/**
 * Screenshot only on explicit request. With windowHints (active game) only that game's window is captured;
 * only if no matching window is found the display under the cursor is used (scope tells which).
 * Max. 1600 px wide – enough for text/items, fewer image tokens.
 */
async function captureScreen({ windowHints = [] } = {}) {
  const disp = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const f = Math.min(1, 1600 / (disp.size.width * disp.scaleFactor));
  const size = { width: Math.round(disp.size.width * disp.scaleFactor * f), height: Math.round(disp.size.height * disp.scaleFactor * f) };
  const hints = windowHints.map((h) => String(h).toLowerCase()).filter((h) => h.length >= 3);
  if (hints.length) {
    try {
      const wins = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: size });
      const w = wins.find((x) => hints.some((h) => String(x.name || '').toLowerCase().includes(h)) && !x.thumbnail.isEmpty());
      if (w) return { data: w.thumbnail.toJPEG(85), ...w.thumbnail.getSize(), scope: 'window' };
    } catch { /* fall back to the display */ }
  }
  const ov = overlay?.win && !overlay.win.isDestroyed() && overlay.visible ? overlay.win : null;
  const mc = mapCorner?.win && !mapCorner.win.isDestroyed() && mapCorner.visible ? mapCorner.win : null;
  if (ov) ov.setOpacity(0);
  if (mc) mc.setOpacity(0);
  if (ov || mc) await new Promise((r) => setTimeout(r, 60));
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    const src = sources.find((x) => String(x.display_id) === String(disp.id)) || sources[0];
    if (!src || src.thumbnail.isEmpty()) throw new Error('Kein Bildschirmbild erhalten');
    const img = src.thumbnail;
    return { data: img.toJPEG(85), ...img.getSize(), scope: 'screen' };
  } finally { if (ov) overlay.applyBounds(); if (mc) mapCorner.applyBounds(); }
}

function showWindow(page) {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  if (page) send('ui:navigate', { page });
}

function buildTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'build', 'tray.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createFromPath(ICON) : img);
  tray.setToolTip('JARVIS');
  const menu = () => Menu.buildFromTemplate([
    { label: 'JARVIS öffnen', click: () => showWindow() },
    { label: core.voice.isOpen() ? 'Sprachmodus beenden' : 'Sprachmodus starten', click: () => (core.voice.isOpen() ? core.voice.stop() : send('voice:toggle', {})) },
    { label: 'Wake-Word „Hey Jarvis“', type: 'checkbox', checked: !!core.settings.get('voice').wakeWord, click: (i) => core.settings.update({ voice: { wakeWord: i.checked } }) },
    { type: 'separator' },
    { label: overlay?.visible ? 'In-Game-Overlay ausblenden' : 'In-Game-Overlay einblenden', click: () => overlay?.toggle() },
    { label: 'Bildschirm fragen („Was ist das?“)', click: () => core.screen.hotkeyQuestion().catch((e) => toast('JARVIS', e.message)) },
    { type: 'separator' },
    { label: 'Aufgaben', click: () => showWindow('tasks') },
    { label: 'Kalender', click: () => showWindow('calendar') },
    { label: 'Einstellungen', click: () => showWindow('settings') },
    { type: 'separator' },
    ...(core.updater.state.state === 'available' && core.updater.state.signed ? [{ label: `Auf ${core.updater.state.version} aktualisieren`, click: () => showWindow('settings') }, { type: 'separator' }] : []),
    { label: 'JARVIS vollständig beenden', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu());
  tray.on('click', () => (win.isVisible() && win.isFocused() ? win.hide() : showWindow()));
  core.bus.on('settings:changed', () => tray.setContextMenu(menu()));
  core.bus.on('voice:state', () => tray.setContextMenu(menu()));
  core.bus.on('overlay:visible', () => tray.setContextMenu(menu()));
  core.bus.on('update:state', (u) => { if (['available', 'current', 'error'].includes(u.state)) tray.setContextMenu(menu()); });
}

function toast(title, body) { if (Notification.isSupported()) { const n = new Notification({ title, body, icon: ICON, silent: false }); n.on('click', () => showWindow()); n.show(); } }

function applyDesktopSettings() {
  const s = core.settings.all();
  if (process.platform === 'win32' || process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: !!s.autostart, args: ['--hidden'] });
  }
  win?.setAlwaysOnTop(!!s.alwaysOnTop);
  globalShortcut.unregisterAll(); scanKey = null;
  const hk = s.globalHotkey;
  if (hk) { try { globalShortcut.register(hk, () => { showWindow(); send('ui:focus-input', {}); }); } catch { /* invalid accelerator */ } }
  const ptt = s.voice?.pushToTalkKey;
  if (ptt) { try { globalShortcut.register(ptt, () => send('voice:toggle', {})); } catch { /* ignore */ } }
  const reg = (acc, fn) => { if (acc) { try { globalShortcut.register(acc, fn); } catch { /* invalid accelerator */ } } };
  if (s.screen?.enabled !== false) reg(s.screen?.hotkey, () => core.screen.hotkeyQuestion().catch((e) => { toast('JARVIS – Bildschirm', e.message); core.bus.emit('overlay:answer', { question: '', answer: '⚠️ ' + e.message, cards: [] }); }));
  reg(s.overlay?.hotkey, () => overlay?.toggle());
  applyScanHotkey();
  reg(s.overlay?.interactHotkey, () => overlay?.toggleInteractive());
}

/** Item-Scanner-Taste nur registrieren, solange Tarkov läuft (sonst blockiert sie die Tastenkombination global). */
let scanKey = null;
function applyScanHotkey() {
  const acc = core.settings.get('gaming')?.eftScanHotkey;
  const want = acc && core.gaming.context.running.includes('eft') ? acc : null;
  if (scanKey && scanKey !== want) { try { globalShortcut.unregister(scanKey); } catch { /* ignore */ } scanKey = null; }
  if (want && !scanKey) {
    try {
      globalShortcut.register(want, () => { overlay?.flash(25000); core.gaming.eftScan().catch((e) => logger.scope('main').info('Scan: ' + e.message)); });
      scanKey = want;
    } catch { /* ungültige Tastenkombination */ }
  }
}

function forwardEvents() {
  const types = ['message', 'message:update', 'chat:delta', 'chat:card', 'chat:tool', 'chat:done', 'confirm:new', 'confirm:resolved', 'confirm:expired',
    'tasks:changed', 'calendar:changed', 'calendar:sync', 'brain:changed', 'study:progress', 'study:changed', 'notification', 'notifications:changed',
    'game:context', 'game:design', 'game:position', 'eft:raid', 'eft:scan', 'game:focus', 'game:progress', 'game:timers', 'game:markers', 'game:data', 'game:running', 'lol:live', 'orb:state', 'voice:state', 'voice:audio', 'voice:standby',
    'voice:interrupted', 'voice:transcript', 'ui:navigate', 'settings:changed', 'conversations:changed', 'research:new', 'tts:speak', 'data:imported', 'cloud:usage', 'cloud:state', 'game:stats', 'privacy:capture',
    'overlay:thinking', 'overlay:answer', 'lol:champselect', 'lol:review', 'exams:changed', 'github:changed', 'telegram:status', 'pc:focus', 'feeds:changed', 'tarkovtracker:status', 'update:state', 'drive:status', 'game:profiles', 'backup:drive', 'lol:replay', 'life:data', 'life:rest', 'deadlines:changed', 'transit:data'];
  for (const t of types) core.bus.on(t, (d) => send(t, t === 'settings:changed' ? { keys: d.keys } : d));
}

app.whenReady().then(async () => {
  core = createCore({
    dataDir: app.getPath('userData'), version: VERSION,
    cipher: isE2E && !safeStorage.isEncryptionAvailable() ? require('./core/secrets').memoryCipher : cipher(),
    // Electron's net.fetch bricht bei redirect:'manual' mit „Redirect was cancelled“ ab, statt die
    // 3xx-Antwort zu liefern. Für manuelle Weiterleitungen (SSRF-Prüfung, private GitHub-Downloads
    // ohne Token-Weitergabe) deshalb Nodes eigenes fetch verwenden.
    fetch: (url, init) => (init?.redirect === 'manual' ? globalThis.fetch(url, init) : net.fetch(url, init)),
    platform: {
      toast,
      captureScreen,
      captureAroundCursor,
      idleSeconds: () => powerMonitor.getSystemIdleTime(),
      openExternal: (url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); },
    },
    updatePublicKey: loadUpdateKey(), updateRepo: loadUpdateRepo(),
    genaiSdk: isE2E && process.env.JARVIS_FAKE_GEMINI === '1' ? require('../../tests/e2e/fake-genai.js') : undefined,
  });
  core.platform.campusDual = require('./campusdual-session').createCampusDual({ secrets: core.secrets, settings: core.settings, log: logger.scope('campusdual'), parent: () => win });
  if (isSmoke && process.env.JARVIS_SMOKE_ANIM) core.settings.update({ animations: process.env.JARVIS_SMOKE_ANIM, setupComplete: true });
  const log = logger.scope('main');
  log.info(`JARVIS ${VERSION} startet (Electron ${process.versions.electron})`);

  // Strict CSP for everything served via app://
  protocol.handle('app', async (req) => {
    const u = new URL(req.url);
    if (u.host !== 'jarvis') return new Response('Not found', { status: 404 });
    if (u.pathname === '/user-sound') {
      const dir = path.join(core.paths.data, 'sounds');
      const f = fs.existsSync(dir) ? fs.readdirSync(dir).find((x) => x.startsWith('start.')) : null;
      if (!f) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(path.join(dir, f)).href);
    }
    if (u.pathname.startsWith('/map-image/')) {
      const [, , gid, ...rest] = u.pathname.split('/');
      const p = core.gaming.mapImagePath(decodeURIComponent(gid), decodeURIComponent(rest.join('/')), u.searchParams.get('layer'));
      if (!p) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(p).href);
    }
    const file = path.normalize(path.join(RENDERER_DIR, decodeURIComponent(u.pathname)));
    if (!file.startsWith(RENDERER_DIR) || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
    const res = await net.fetch(pathToFileURL(file).href);
    const headers = new Headers(res.headers);
    if (file.endsWith('.html')) {
      headers.set('Content-Security-Policy', [
        "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'", "font-src 'self' data:",
        "img-src 'self' data: blob: https://ddragon.leagueoflegends.com https://cdn.akamai.steamstatic.com https://shared.akamai.steamstatic.com https://cdn.cloudflare.steamstatic.com https://shared.cloudflare.steamstatic.com https://shared.fastly.steamstatic.com https://steamcdn-a.akamaihd.net", "media-src 'self' blob: data:", "connect-src 'self'",
        "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
      ].join('; '));
    }
    if (file.endsWith('.mjs') || file.endsWith('.js')) headers.set('Content-Type', 'text/javascript');
    if (file.endsWith('.wasm')) headers.set('Content-Type', 'application/wasm');
    return new Response(res.body, { status: res.status, headers });
  });

  // Only microphone (and notifications) may be granted to our own origin.
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => cb(['media', 'notifications', 'clipboard-sanitized-write'].includes(perm) && String(details.requestingUrl || '').startsWith('app://jarvis/')));
  session.defaultSession.setPermissionCheckHandler((wc, perm, origin) => ['media', 'notifications', 'clipboard-sanitized-write'].includes(perm) && String(origin || '').startsWith('app://jarvis'));

  registerIpc({ core, getWin: () => win, app, showWindow, overlay: () => overlay, quit: () => { quitting = true; app.quit(); }, relaunch: () => { quitting = true; app.relaunch(); app.quit(); } });
  forwardEvents();
  core.bus.on('game:running', () => applyScanHotkey());
  createWindow();
  if (!isSmoke) { overlay = new Overlay({ core, preload: path.join(__dirname, 'preload.js'), isDev }); mapCorner = new MapCorner({ core, preload: path.join(__dirname, 'preload.js'), isDev, overlay }); core.bus.on('overlay:visible', (d) => send('overlay:visible', d)); }
  if (isE2E) global.__jarvis = { win, core, overlay: () => overlay, mapCorner: () => mapCorner };
  if (isSmoke) runSmoke();
  buildTray();
  applyDesktopSettings();
  core.bus.on('settings:changed', ({ keys }) => { if (keys.some((k) => ['autostart', 'alwaysOnTop', 'globalHotkey', 'voice', 'screen', 'overlay'].includes(k))) applyDesktopSettings(); });
  core.start();
  overlay?.refresh();
  powerMonitor.on('resume', () => { core.scheduler.runNow('calendar-sync'); });
  powerMonitor.on('lock-screen', () => { if (core.voice.isOpen()) core.voice.stop({ standby: true }); });
});

/** `JARVIS.exe --smoke`: packaged self-test (CI / acceptance). Exit code 0 = OK. */
async function runSmoke() {
  const report = { version: VERSION, electron: process.versions.electron, steps: [] };
  const done = (code) => {
    const out = path.join(require('node:os').tmpdir(), 'jarvis-smoke-report.json');
    try { fs.writeFileSync(out, JSON.stringify(report, null, 2)); } catch { /* ignore */ }
    process.stdout.write(JSON.stringify(report) + '\n');
    try { core.stop(); fs.rmSync(app.getPath('userData'), { recursive: true, force: true }); } catch { /* ignore */ }
    app.exit(code);
  };
  const timer = setTimeout(() => { report.steps.push({ name: 'timeout', ok: false }); done(2); }, 60000);
  report.console = [];
  win.webContents.on('console-message', (e) => { if (['error', 'warning'].includes(e.level)) report.console.push(String(e.message).slice(0, 300)); });
  try {
    await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', r) : r()));
    let ui = false;
    for (let i = 0; i < 300 && !ui; i++) { ui = await win.webContents.executeJavaScript('!!document.querySelector(".sidebar")').catch(() => false); if (!ui) await new Promise((r) => setTimeout(r, 100)); }
    report.steps.push({ name: 'Renderer/UI geladen', ok: ui });
    if (!ui) report.debug = await win.webContents.executeJavaScript('JSON.stringify({rs: document.readyState, bridge: !!window.jarvis, html: document.body?.innerHTML?.slice(0, 300), title: document.title})').catch((e) => 'exec failed: ' + e.message);
    const wake = await win.webContents.executeJavaScript(`new Promise((res) => { try { const w = new Worker('audio/wakeword-worker.js', { type: 'module' }); const t = setTimeout(() => res('timeout'), 20000); w.onmessage = (e) => { if (e.data.type === 'ready' || e.data.type === 'error') { clearTimeout(t); w.terminate(); res(e.data.type === 'ready' ? 'ready' : e.data.error); } }; w.onerror = (e) => res('worker error: ' + e.message); w.postMessage({ type: 'init', threshold: 0.5 }); } catch (e) { res(String(e)); } })`).catch((e) => e.message);
    report.steps.push({ name: 'Wake-Word-Modelle (ONNX/WASM, lokal)', ok: wake === 'ready', detail: wake });
    const { selfTest } = require('./ipc');
    for (const st of await selfTest(core)) report.steps.push({ name: st.name, ok: st.ok || /optional|nicht hinterlegt/.test(String(st.detail)), detail: st.detail });
    // Manuelle Weiterleitungen (Update-Download aus privatem Repo, SSRF-geprüfte Webabrufe) müssen die 3xx-Antwort liefern
    const redirectOk = await new Promise((resolve) => {
      const srv = require('node:http').createServer((q, r) => { r.writeHead(302, { location: 'https://example.com/x' }); r.end(); }).listen(0, '127.0.0.1', async () => {
        try { const r = await core.fetch(`http://127.0.0.1:${srv.address().port}/`, { redirect: 'manual' }); resolve(r.status === 302 ? 'OK' : 'Status ' + r.status); } catch (e) { resolve(e.message); } finally { srv.close(); }
      });
    });
    report.steps.push({ name: 'Weiterleitungen (Update-Download)', ok: redirectOk === 'OK', detail: redirectOk });
    const uploadOk = await new Promise((resolve) => {
      const srv = require('node:http').createServer((q, r) => { let n = 0; q.on('data', (c) => { n += c.length; }); q.on('end', () => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ n })); }); }).listen(0, '127.0.0.1', async () => {
        try { const r = await core.fetch(`http://127.0.0.1:${srv.address().port}/`, { method: 'PUT', headers: { 'Content-Type': 'application/zip' }, body: Buffer.alloc(300000, 1) }); const j = await r.json(); resolve(j.n === 300000 ? 'OK' : 'Bytes ' + j.n); } catch (e) { resolve(e.message); } finally { srv.close(); }
      });
    });
    report.steps.push({ name: 'Datei-Upload (Drive-Backup)', ok: uploadOk === 'OK', detail: uploadOk });
    const t = core.tasks.create({ title: 'Smoke' }); core.tasks.complete(t.id); report.steps.push({ name: 'Aufgabe anlegen/abschließen', ok: core.tasks.get(t.id).done });
    report.steps.push({ name: 'Tray', ok: !!tray });
    app.getAppMetrics(); // prime CPU counters
    await new Promise((r) => setTimeout(r, 3000));
    const m = app.getAppMetrics();
    report.metrics = { processes: m.length, workingSetMB: Math.round(m.reduce((a, x) => a + (x.memory?.workingSetSize || 0), 0) / 1024), cpuPercentIdle: +m.reduce((a, x) => a + (x.cpu?.percentCPUUsage || 0), 0).toFixed(1), startupMs: Math.round(performance.now()) };
    clearTimeout(timer);
    done(report.steps.every((x) => x.ok) ? 0 : 1);
  } catch (e) { report.steps.push({ name: 'Ausnahme', ok: false, detail: e.message }); clearTimeout(timer); done(1); }
}

app.on('second-instance', () => { showWindow(); });
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { globalShortcut.unregisterAll(); overlay?.destroy(); mapCorner?.destroy(); try { core?.stop(); } catch { /* ignore */ } });
app.on('window-all-closed', () => { /* tray keeps running */ });
process.on('uncaughtException', (e) => logger.scope('main').error('Unerwarteter Fehler', e));
process.on('unhandledRejection', (e) => logger.scope('main').error('Unbehandelte Ablehnung', e));
