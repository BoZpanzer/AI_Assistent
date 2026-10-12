'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { ipcMain, dialog, shell, clipboard } = require('electron');
const logger = require('./core/logger');
const { friendlyError } = require('./providers/gemini');
const log = logger.scope('ipc');

const ALLOWED_SECRETS = ['gemini.api_key', 'riot.api_key', 'google.client_secret'];

/**
 * Single RPC entry point. Only our own app:// frame may call; every method
 * is explicit (no generic service access from the renderer).
 */
function registerIpc({ core: s, getWin, app, showWindow, quit, relaunch }) {
  const pick = async (opts) => {
    const r = await dialog.showOpenDialog(getWin(), opts);
    return r.canceled ? null : r.filePaths;
  };

  const M = {
    // --- app ---
    'app.info': () => ({ version: s.version, electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform, dataDir: s.paths.data, packaged: app.isPackaged }),
    'app.bootstrap': () => ({
      settings: s.settings.all(), secrets: s.secrets.status(), secureStorage: s.secrets.available(), version: s.version,
      game: s.gaming.context.state(), counts: s.tasks.counts(), unread: s.notifications.unreadCount(), voice: s.voice.state, google: s.calendar.status(),
      confirmations: s.confirmations.list(),
    }),
    'window.minimize': () => getWin()?.minimize(),
    'window.maximize': () => { const w = getWin(); if (w) w.isMaximized() ? w.unmaximize() : w.maximize(); },
    'window.close': () => getWin()?.close(),
    'app.quit': () => quit(),
    'app.relaunch': () => relaunch(),
    'shell.openExternal': ({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); },
    'shell.openPath': ({ which }) => shell.openPath({ data: s.paths.data, logs: path.join(s.paths.data, 'logs'), backups: path.join(s.paths.data, 'backups') }[which] || s.paths.data),
    'shell.showDocument': ({ docId }) => { const d = s.study.document(docId); if (d?.fullPath && fs.existsSync(d.fullPath)) shell.openPath(d.fullPath); else if (d?.url) shell.openExternal(d.url); },
    'sound.pick': async () => {
      const f = (await pick({ properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg'] }] }))?.[0];
      if (!f) return null;
      if (fs.statSync(f).size > 15 * 1024 * 1024) throw new Error('Datei zu groß (max. 15 MB)');
      const dir = path.join(s.paths.data, 'sounds'); fs.mkdirSync(dir, { recursive: true });
      for (const old of fs.readdirSync(dir)) fs.rmSync(path.join(dir, old), { force: true });
      const dest = path.join(dir, 'start' + path.extname(f).toLowerCase());
      fs.copyFileSync(f, dest);
      s.settings.update({ startSound: { file: 'app://jarvis/user-sound?v=' + Date.now() } });
      return true;
    },
    'clipboard.write': ({ text }) => clipboard.writeText(String(text).slice(0, 200000)),

    // --- settings & secrets ---
    'settings.get': () => s.settings.all(),
    'settings.update': (p) => s.settings.update(p),
    'secrets.status': () => s.secrets.status(),
    'secrets.set': ({ key, value }) => { if (!ALLOWED_SECRETS.includes(key)) throw new Error('Nicht erlaubt'); s.secrets.set(key, String(value || '').trim()); return s.secrets.status(); },
    'gemini.test': async ({ apiKey }) => {
      const key = String(apiKey || '').trim() || s.secrets.get('gemini.api_key');
      if (!key) throw new Error('Kein Schlüssel angegeben');
      const r = await s.gemini.test(key);
      if (r.ok && apiKey) s.secrets.set('gemini.api_key', key);
      return { ok: r.ok, error: r.error, chosen: r.chosen, requested: r.requested, count: r.models?.length || 0, models: (r.models || []).map((m) => m.name) };
    },
    'gemini.usage': () => s.gemini.usage,

    // --- chat ---
    'chat.send': async ({ conversationId, text, attachments }) => {
      if (s.voice.isOpen() && s.voice.conversationId === conversationId && text && !attachments?.length) { s.voice.sendText(text); return { viaVoice: true }; }
      const files = [];
      for (const a of (attachments || []).slice(0, 5)) {
        if (!a.path || !fs.existsSync(a.path)) continue;
        try { const r = await s.study.indexFile(a.path, { source: 'upload', root: path.dirname(a.path), subject: 'Anhänge' }); files.push({ name: path.basename(a.path), docId: r.id || r.duplicateOf }); } catch (e) { files.push({ name: path.basename(a.path), error: e.message }); }
      }
      s.orchestrator.chat({ conversationId, text, attachments: files }).catch((e) => log.error('chat', e));
      return { started: true };
    },
    'chat.cancel': ({ conversationId }) => s.orchestrator.cancel(conversationId),
    'conv.current': () => s.conversations.current(),
    'conv.list': ({ q } = {}) => s.conversations.list({ q }),
    'conv.messages': ({ id, limit }) => s.conversations.messages(id, { limit: limit || 200 }),
    'conv.create': ({ title } = {}) => s.conversations.create(title),
    'conv.rename': ({ id, title }) => s.conversations.rename(id, title),
    'conv.remove': ({ id }) => s.conversations.remove(id),
    'conv.export': async ({ id }) => {
      const md = s.conversations.exportMarkdown(id);
      const r = await dialog.showSaveDialog(getWin(), { defaultPath: `JARVIS-Gespraech-${new Date().toISOString().slice(0, 10)}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (r.canceled) return null;
      fs.writeFileSync(r.filePath, md, 'utf8');
      return r.filePath;
    },
    'confirm.resolve': ({ token, approve }) => s.orchestrator.resolveConfirmation(token, !!approve),
    'confirm.list': () => s.confirmations.list(),
    'action.undo': ({ tool, args }) => s.orchestrator.runInternal(tool, args),
    'dialog.pickFiles': ({ kind }) => pick({ properties: ['openFile', 'multiSelections'], filters: kind === 'image' ? [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] : kind === 'audio' ? [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg'] }] : kind === 'backup' ? [{ name: 'JARVIS-Sicherung', extensions: ['zip', 'sqlite3'] }] : [{ name: 'Dokumente', extensions: ['pdf', 'docx', 'pptx', 'txt', 'md', 'ipynb'] }] }),
    'dialog.pickFolder': async () => (await pick({ properties: ['openDirectory'] }))?.[0] || null,

    // --- tasks ---
    'tasks.board': () => s.tasks.board(),
    'tasks.list': (p = {}) => s.tasks.list(p),
    'tasks.get': ({ id }) => s.tasks.get(id),
    'tasks.create': (p) => s.tasks.create(p),
    'tasks.update': ({ id, patch }) => s.tasks.update(id, patch),
    'tasks.complete': ({ id, done }) => s.tasks.complete(id, done !== false),
    'tasks.remove': ({ id }) => s.tasks.remove(id),
    'tasks.counts': () => s.tasks.counts(),
    'tasks.categories': () => s.tasks.categories(),
    'tasks.addAttachment': ({ id, kind, name, ref }) => s.tasks.addAttachment(id, { kind, name, ref }),
    'tasks.removeAttachment': ({ id }) => s.tasks.removeAttachment(id),
    'tasks.openAttachment': ({ ref }) => { if (/^https:\/\//.test(ref)) shell.openExternal(ref); else if (fs.existsSync(ref)) shell.showItemInFolder(ref); },

    // --- calendar ---
    'calendar.list': ({ from, to }) => s.calendar.list(new Date(from), new Date(to)),
    'calendar.get': ({ id }) => s.calendar.get(id),
    'calendar.create': (p) => s.calendar.create(p),
    'calendar.update': ({ id, patch }) => s.calendar.update(id, patch),
    'calendar.remove': ({ id }) => s.calendar.remove(id),
    'calendar.calendars': () => s.calendar.calendars(),
    'calendar.select': ({ id, selected }) => s.calendar.selectCalendar(id, selected),
    'calendar.sync': () => s.calendar.sync(),
    'calendar.status': () => s.calendar.status(),
    'calendar.resolveConflict': ({ id, keep }) => s.calendar.resolveConflict(id, keep),
    'calendar.freeSlots': (p) => s.calendar.freeSlots(p),
    'google.connect': async ({ clientId, clientSecret, drive }) => {
      if (clientId) s.settings.update({ google: { clientId: String(clientId).trim() } });
      if (clientSecret) s.secrets.set('google.client_secret', String(clientSecret).trim());
      const r = await s.google.connect({ drive: !!drive });
      await s.calendar.sync().catch(() => {});
      showWindow();
      return { ...r, calendars: s.calendar.calendars() };
    },
    'google.disconnect': () => { s.google.disconnect(); return s.calendar.status(); },
    'google.importClientJson': async () => {
      const f = (await pick({ properties: ['openFile'], filters: [{ name: 'OAuth-Client (JSON)', extensions: ['json'] }] }))?.[0];
      if (!f) return null;
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      const c = j.installed || j.web;
      if (!c?.client_id) throw new Error('Keine OAuth-Client-Datei (installed.client_id fehlt)');
      s.settings.update({ google: { clientId: c.client_id } });
      if (c.client_secret) s.secrets.set('google.client_secret', c.client_secret);
      return { clientId: c.client_id };
    },

    // --- brain ---
    'brain.list': (p = {}) => s.brain.list(p),
    'brain.get': ({ id }) => s.brain.get(id),
    'brain.add': (p) => s.brain.add(p),
    'brain.update': ({ id, patch }) => s.brain.update(id, patch),
    'brain.archive': ({ id, archived }) => s.brain.archive(id, archived !== false),
    'brain.remove': ({ id }) => s.brain.remove(id),
    'brain.search': ({ q, scope, domains }) => s.brain.search(q, { scope, domains, limit: 24 }),
    'brain.graph': () => s.brain.graph(),
    'brain.overview': () => s.brain.overview(),
    'brain.clusters': () => s.brain.clusters(),
    'brain.conflicts': () => s.brain.conflicts(),
    'brain.link': ({ a, b }) => s.brain.link(a, b),
    'brain.maintain': () => s.brain.maintain(),
    'brain.embed': () => s.vectors.backfill({ maxItems: 300 }),
    'brain.addSource': async ({ url }) => s.web.savePage(url, { refresh: true }),

    // --- study ---
    'study.status': () => s.study.status(),
    'study.documents': (p = {}) => s.study.documents(p),
    'study.subjects': () => s.study.subjects(),
    'study.document': ({ id }) => s.study.document(id),
    'study.scan': () => s.study.scan(),
    'study.check': ({ folder }) => s.study.checkFolder(folder),
    'study.analyzePage': ({ id, page }) => s.study.analyzePage(id, page),
    'study.import': async () => {
      const files = await pick({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'Dokumente', extensions: ['pdf', 'docx', 'pptx', 'txt', 'md', 'ipynb'] }] });
      const out = [];
      for (const f of files || []) { try { out.push({ file: path.basename(f), ...(await s.study.indexFile(f, { source: 'upload', root: path.dirname(f), subject: 'Importiert' })) }); } catch (e) { out.push({ file: path.basename(f), error: e.message }); } }
      return out;
    },
    'study.testIndex': async ({ folder }) => {
      const it = s.study.walk(folder, 1).next();
      if (it.done) return { ok: false, error: 'Keine unterstützte Datei gefunden' };
      const { extract } = require('./services/extract');
      const r = await extract(it.value);
      return { ok: true, file: path.relative(folder, it.value), pages: r.pages.length, chars: r.pages.reduce((a, p) => a + p.text.length, 0) };
    },

    // --- web ---
    'web.research': ({ query, game }) => s.web.research(query, { game }),
    'web.history': (p = {}) => s.web.history(p),
    'web.saveToBrain': ({ id }) => s.web.saveResearchToBrain(id),
    'web.versions': ({ id }) => s.web.versions(id),

    // --- gaming ---
    'game.state': () => s.gaming.context.state(),
    'game.profiles': () => s.gaming.context.profiles(),
    'game.setActive': ({ id }) => s.gaming.context.setActive(id, 'manual'),
    'game.resolve': ({ name }) => s.gaming.context.resolve(name),
    'game.clear': () => s.gaming.context.clearActive(),
    'game.installed': () => s.gaming.context.detectInstalled(),
    'game.layout': ({ id }) => s.gaming.layout(id),
    'game.pushWidget': ({ game, type, params }) => s.gaming.pushWidget(game, type, params),
    'game.clearFocus': () => { s.gaming.focus = null; return true; },
    'game.timers': (p = {}) => s.gaming.timers(p),
    'game.addTimer': (p) => s.gaming.addTimer(p),
    'game.removeTimer': ({ id }) => s.gaming.removeTimer(id),
    'game.maps': ({ game }) => s.gaming.maps(game),
    'game.importMap': async ({ game, name }) => {
      const f = (await pick({ properties: ['openFile'], filters: [{ name: 'Kartenbild', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] }))?.[0];
      return f ? s.gaming.importMapImage(game, name, f) : null;
    },
    'game.calibrate': ({ game, map, points }) => s.gaming.setCalibration(game, map, points),
    'game.markers': ({ game, map }) => s.gaming.markers(game, map),
    'game.addMarker': ({ game, map, marker }) => s.gaming.addMarker(game, map, marker),
    'game.updateMarker': ({ id, patch }) => s.gaming.updateMarker(id, patch),
    'game.removeMarker': ({ id }) => s.gaming.removeMarker(id),
    'game.clearMarkers': ({ game, map }) => s.gaming.clearMarkers(game, map),
    'game.routes': ({ game, map }) => s.gaming.routes(game, map),
    'game.saveRoute': ({ game, map, name, points }) => s.gaming.saveRoute(game, map, name, points),
    'game.removeRoute': ({ id }) => s.gaming.removeRoute(id),
    'game.checklist': ({ game, name }) => s.gaming.checklist(game, name),
    'game.saveChecklist': ({ game, name, items }) => s.gaming.saveChecklist(game, name, items),
    'game.plan': ({ game }) => s.gaming.plan(game),
    'game.savePlan': ({ game, plan }) => s.gaming.savePlan(game, plan),
    'game.notes': ({ game }) => s.gaming.notes(game),
    'game.addNote': ({ game, text, title }) => s.gaming.addNote(game, text, title),
    'game.sources': ({ game }) => s.gaming.sources(game),
    'game.research': ({ game, query }) => s.gaming.research(game, query),
    'game.wikiSearch': async ({ game, q }) => { const p = s.gaming.context.profile(game); if (!p?.wiki) return { results: [], available: false }; return s.gaming.wiki.search(p.wiki, q); },
    'game.wikiPage': async ({ game, title }) => { const p = s.gaming.context.profile(game); if (!p?.wiki) throw new Error('Kein Wiki'); return s.gaming.wiki.page(p.wiki, title, 12000); },
    'game.others': ({ active }) => s.gaming.otherGameNotifications(active),
    'tarkov.maps': async () => { const r = await s.gaming.tarkov.maps(); return { maps: r.value.map((m) => ({ name: m.name, id: m.normalizedName, players: m.players, raidDuration: m.raidDuration })), source: r.source, fetchedAt: r.fetchedAt, offline: r.offline }; },
    'tarkov.map': async ({ map }) => { const r = await s.gaming.tarkov.map(map); return r ? { map: r.value, source: r.source, fetchedAt: r.fetchedAt, offline: r.offline } : null; },
    'tarkov.quests': ({ map, q }) => s.gaming.tarkov.searchTasks(q, { map, limit: 30 }),
    'tarkov.items': ({ q, keysOnly }) => s.gaming.tarkov.items(q, { keysOnly, limit: 20 }),
    'tarkov.keys': ({ map }) => s.gaming.tarkov.keysForMap(map),
    'lol.stats': () => s.gaming.league.stats(),
    'lol.sync': () => s.gaming.league.syncMatches(),
    'lol.live': () => s.gaming.league.live(),
    'lol.champion': ({ name }) => s.gaming.league.champion(name),
    'lol.version': () => s.gaming.league.ddVersion(),
    'lol.goals': () => s.gaming.league.goals(),
    'lol.addGoal': (p) => s.gaming.league.addGoal(p),
    'lol.removeGoal': ({ id }) => s.gaming.league.removeGoal(id),
    'lol.hasKey': () => s.gaming.league.hasKey(),

    // --- notifications ---
    'notify.list': (p = {}) => s.notifications.list(p),
    'notify.read': ({ ids }) => s.notifications.markRead(ids),
    'notify.remove': ({ id }) => s.notifications.remove(id),
    'briefing.today': () => s.briefing(),

    // --- voice ---
    'voice.start': ({ conversationId } = {}) => s.voice.start({ conversationId }),
    'voice.stop': () => s.voice.stop(),
    'voice.state': () => ({ state: s.voice.state, model: s.voice.model }),
    'voice.activity': () => s.voice.activity(),

    // --- system ---
    'system.status': () => s.system.status(),
    'system.backup': async () => {
      const r = await dialog.showSaveDialog(getWin(), { defaultPath: `JARVIS-Backup-${new Date().toISOString().slice(0, 10)}.zip`, filters: [{ name: 'ZIP', extensions: ['zip'] }] });
      return r.canceled ? null : s.system.createBackup(r.filePath);
    },
    'system.backups': () => s.system.listBackups(),
    'system.restore': async ({ file } = {}) => {
      const f = file || (await pick({ properties: ['openFile'], filters: [{ name: 'JARVIS-Sicherung', extensions: ['zip', 'sqlite3'] }] }))?.[0];
      if (!f) return null;
      return s.system.stageRestore(f);
    },
    'system.legacy': () => s.system.legacyCandidates(),
    'system.importLegacy': ({ file }) => {
      if (!s.system.legacyCandidates().some((c) => c.file === file)) throw new Error('Unbekannte Altdatei');
      return s.system.importLegacy(file);
    },
    'system.checkUpdates': () => s.system.checkUpdates(),
    'system.installUpdate': async () => {
      const file = await s.system.downloadUpdate();
      shell.openPath(file);
      setTimeout(() => quit(), 1500);
      return { started: true };
    },
    'system.selfTest': async () => selfTest(s),
  };

  ipcMain.handle('rpc', async (e, { method, params }) => {
    const url = e.senderFrame?.url || '';
    if (!url.startsWith('app://jarvis/')) throw new Error('Ungültiger Absender');
    const fn = M[method];
    if (!fn) throw new Error('Unbekannte Methode: ' + method);
    try {
      return await fn(params || {});
    } catch (err) {
      log.warn(`${method} fehlgeschlagen`, err);
      throw new Error(friendlyError(err));
    }
  });
  // High-rate audio: one-way channel, size-limited.
  ipcMain.on('voice:audio', (e, buf) => {
    if (!(e.senderFrame?.url || '').startsWith('app://jarvis/')) return;
    if (buf && buf.byteLength && buf.byteLength <= 64000) s.voice.sendAudio(buf);
  });
}

/** End-to-end self test of local subsystems (no external calls). */
async function selfTest(s) {
  const out = [];
  const step = async (name, fn) => { const t0 = Date.now(); try { const d = await fn(); out.push({ name, ok: true, ms: Date.now() - t0, detail: d }); } catch (e) { out.push({ name, ok: false, ms: Date.now() - t0, detail: e.message }); } };
  await step('Datenbank (Schema)', () => 'v' + s.db.version + ', ' + s.db.get('PRAGMA quick_check').quick_check);
  await step('Sichere Schlüsselablage', () => { if (!s.secrets.available()) throw new Error('DPAPI nicht verfügbar'); return 'DPAPI aktiv'; });
  await step('Aufgaben-Dienst', () => { const t = s.tasks.create({ title: '__selftest__' }); s.tasks.remove(t.id); return 'OK'; });
  await step('Brain-Suche (FTS5)', async () => { const r = await s.brain.search('test', { semantic: false }); return r.results.length + ' Treffer'; });
  await step('Dokument-Parser (Worker)', async () => { const os = require('node:os'); const f = path.join(os.tmpdir(), `jarvis-selftest-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.md`); fs.writeFileSync(f, '# Test\nInhalt'); const { extract } = require('./services/extract'); const r = await extract(f); fs.rmSync(f); return r.pages.length + ' Seite'; });
  await step('Gemini-Schlüssel', () => { if (!s.gemini.hasKey()) throw new Error('nicht hinterlegt'); return s.gemini.model('fast') || 'Modellprüfung ausstehend'; });
  await step('Google Kalender', () => (s.calendar.connected() ? 'verbunden' : 'nicht verbunden (optional)'));
  await step('Studienordner', () => (s.study.enabled() ? s.study.checkFolder(s.study.root()).ok ? 'lesbar' : 'nicht lesbar' : 'nicht eingerichtet (optional)'));
  return out;
}

module.exports = { registerIpc, selfTest };
