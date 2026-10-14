'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { ipcMain, dialog, shell, clipboard } = require('electron');
const logger = require('./core/logger');
const { friendlyError } = require('./providers/gemini');
const log = logger.scope('ipc');

const ALLOWED_SECRETS = ['gemini.api_key', 'riot.api_key', 'google.client_secret', 'tarkovtracker.token', 'telegram.token', 'github.token'];

/**
 * Single RPC entry point. Only our own app:// frame may call; every method
 * is explicit (no generic service access from the renderer).
 */
function registerIpc({ core: s, getWin, app, showWindow, quit, relaunch, overlay }) {
  const pick = async (opts) => {
    const r = await dialog.showOpenDialog(getWin(), opts);
    return r.canceled ? null : r.filePaths;
  };

  const M = {
    // --- app ---
    'app.info': () => ({ version: s.version, electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform, dataDir: s.paths.data, packaged: app.isPackaged }),
    'app.bootstrap': () => ({
      settings: s.settings.all(), secrets: s.secrets.status(), secureStorage: s.secrets.available(), version: s.version,
      game: s.gaming.context.state(), counts: s.tasks.counts(), update: s.updater.public(), unread: s.notifications.unreadCount(), voice: s.voice.state, google: s.calendar.status(),
      confirmations: s.confirmations.list(),
    }),
    'window.minimize': () => getWin()?.minimize(),
    'window.maximize': () => { const w = getWin(); if (w) w.isMaximized() ? w.unmaximize() : w.maximize(); },
    'window.close': () => getWin()?.close(),
    'app.quit': () => quit(),
    'app.relaunch': () => relaunch(),
    'shell.openExternal': ({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); },
    'shell.openPath': ({ which }) => shell.openPath({ data: s.paths.data, logs: path.join(s.paths.data, 'logs'), backups: path.join(s.paths.data, 'backups') }[which] || s.paths.data),
    'shell.showDocument': ({ docId }) => { const d = s.study.document(docId); if (d?.fullPath && fs.existsSync(d.fullPath)) shell.openPath(d.fullPath); else if (d?.url && /^https:\/\//.test(d.url)) shell.openExternal(d.url); },
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
    'ai.budget': () => s.costGuard.status(),
    'ai.calibrate': ({ eur }) => { const r = s.costGuard.calibrate(eur); s.costGuard.check(); return r; },
    'gemini.usageReport': ({ days } = {}) => s.gemini.usageReport(Math.min(31, Math.max(1, Number(days) || 7))),

    // --- chat ---
    'chat.retry': ({ conversationId, messageId }) => { s.orchestrator.retry({ conversationId, messageId }).catch((e) => log.error('chat.retry', e)); return { ok: true }; },
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
    'tasks.focus': ({ limit } = {}) => s.tasks.focus(limit || 6),
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
      try {
        const r = await s.google.connect({ drive: !!drive });
        await s.calendar.sync().catch(() => {});
        return { ...r, calendars: s.calendar.calendars() };
      } finally { showWindow(); } // JARVIS nach der Browser-Anmeldung wieder nach vorne holen – auch bei Fehlern
    },
    // --- Klausurmodus ---
    'exams.list': ({ archived } = {}) => s.exams.list({ archived: !!archived }),
    'exams.create': (input) => s.exams.create(input || {}),
    'exams.update': ({ id, patch }) => s.exams.update(id, patch || {}),
    'exams.remove': ({ id }) => s.exams.remove(id),
    'exams.propose': ({ id }) => s.exams.proposePlan(id),
    // Übernehmen = ausdrücklicher Klick des Nutzers auf den angezeigten Plan
    'exams.apply': ({ id, sessions }) => s.exams.applyPlan(id, (sessions || []).slice(0, 80).map((x) => ({ start: String(x.start), end: String(x.end), topic: String(x.topic || '').slice(0, 200) }))),
    'exams.session': ({ id, status }) => s.exams.setSessionStatus(id, status),
    'feeds.list': () => s.feeds.list(),
    'feeds.add': ({ name, url, color, lecture, campusDual }) => s.feeds.add({ name, url, color, lecture, campusDual }),
    'feeds.addFile': async ({ name }) => { const f = (await pick({ properties: ['openFile'], filters: [{ name: 'Kalender (.ics)', extensions: ['ics'] }] }))?.[0]; return f ? s.feeds.add({ name: name || path.basename(f, '.ics'), file: f }) : null; },
    'feeds.refresh': async ({ id }) => (id ? s.feeds.refresh(id) : s.feeds.refreshAll()),
    'feeds.update': ({ id, patch }) => s.feeds.update(id, patch || {}),
    'feeds.remove': ({ id }) => s.feeds.remove(id),
    'feeds.campusDualLogin': () => s.feeds.campusDualLogin(),
    'feeds.campusDualConnect': ({ icsUrl, name } = {}) => s.feeds.addCampusDualSession({ icsUrl: icsUrl ? String(icsUrl).trim() : undefined, name }),
    'feeds.campusDualStatus': async () => ({ available: !!s.platform?.campusDual, loggedIn: s.platform?.campusDual ? await s.platform.campusDual.loggedIn() : false }),
    'feeds.campusDualLogout': async () => { await s.platform?.campusDual?.logout(); return true; },
    // Campus-Dual-Zugangsdaten: nur verschlüsselt (DPAPI) im Hauptprozess, nie zurück an die Oberfläche
    'campusdual.setCredentials': ({ user, password } = {}) => {
      const u = String(user || '').trim(); const pw = String(password || '');
      if (!u && !pw) { s.secrets.delete('campusdual.user'); s.secrets.delete('campusdual.password'); return { hasCreds: false }; }
      if (!u || !pw) throw new Error('Benutzername und Passwort angeben');
      if (u.length > 120 || pw.length > 200) throw new Error('Eingabe zu lang');
      s.secrets.set('campusdual.user', u); s.secrets.set('campusdual.password', pw);
      return { hasCreds: true };
    },
    'campusdual.status': async () => {
      const cd = s.platform?.campusDual;
      const j = (k) => { try { return JSON.parse(s.system.meta(k) || 'null'); } catch { return null; } };
      return { available: !!cd, loggedIn: cd ? await cd.loggedIn() : false, hasCreds: !!cd?.hasCreds?.(), events: j('campusdual:eventstats'), eventFields: j('campusdual:eventfields'), results: s.campusResults.status(), exams: j('campusdual:exams:status') };
    },
    'campusdual.testLogin': async () => {
      const cd = s.platform?.campusDual;
      if (!cd) throw new Error('Nur in der Desktop-App verfügbar');
      if (!cd.hasCreds()) throw new Error('Erst Benutzername und Passwort speichern');
      const ok = await cd.login({ interactive: false });
      if (ok) s.feeds.refreshAll().catch(() => {});
      return { ok, reason: cd.lastReason };
    },
    'campusdual.syncExams': async () => { const r = await s.campusExams.sync(); return { found: r.found, created: (r.created || []).length, moved: (r.moved || []).length, serviceError: r.serviceError || null }; },
    'campusdual.checkResults': async () => { const r = await s.campusResults.check({ notify: true }); return { ...s.campusResults.status(), newResults: r.newResults, firstRun: r.firstRun, tileChanged: r.tileChanged }; },
    'backup.driveStatus': () => s.driveBackup.status(),
    'backup.driveConnect': async () => {
      try { await s.google.connect({ drive: 'write' }); } finally { showWindow(); }
      s.settings.update({ backupDrive: { enabled: true } });
      s.driveBackup.run({ force: true }).catch((e) => log.warn('drive-backup', e));
      return s.driveBackup.status();
    },
    'backup.driveRun': () => s.driveBackup.run({ force: true }),
    'drive.status': () => s.drive.publicStatus(),
    'drive.connect': async () => {
      try { await s.google.connect({ drive: true }); } finally { showWindow(); }
      s.settings.update({ study: { source: 'drive', enabled: true } });
      s.drive.sync().catch((e) => log.warn('drive', e));
      return s.drive.publicStatus();
    },
    'drive.sync': ({ force } = {}) => s.drive.sync({ force: !!force }),
    'drive.folders': ({ name } = {}) => s.drive.findFolders(name),
    'drive.useFolder': ({ id, name }) => { s.settings.update({ study: { driveFolderId: String(id || ''), driveFolder: String(name || 'Goodnotes').slice(0, 120), source: 'drive', enabled: true } }); s.drive.sync({ force: true }).catch(() => {}); return s.drive.publicStatus(); },
    'google.disconnect': () => { s.google.disconnect(); return s.calendar.status(); },
    'google.importClientJson': async () => {
      const f = (await pick({ properties: ['openFile'], filters: [{ name: 'OAuth-Client (JSON)', extensions: ['json'] }] }))?.[0];
      if (!f) return null;
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      const c = j.installed || j.web;
      if (!c?.client_id) throw new Error('Keine OAuth-Client-Datei (installed.client_id fehlt)');
      s.settings.update({ google: { clientId: c.client_id } });
      if (c.client_secret) s.secrets.set('google.client_secret', String(c.client_secret).trim());
      // Google zeigt Secrets neuer Clients nur beim Erstellen – später geladene JSONs enthalten oft keins.
      return { clientId: c.client_id, hasSecret: !!c.client_secret, secretStored: s.secrets.has('google.client_secret'), type: j.installed ? 'desktop' : 'web' };
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
    'brain.birthdays': () => s.birthdays.list(),
    'brain.birthdaysSync': () => s.birthdays.sync(),
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
    'eft.logStatus': async () => { if (!s.gaming.eftLogs.timer) s.gaming.eftLogs.dir = undefined; await s.gaming.eftLogs.gameDir(); return s.gaming.eftLogs.status(); },
    'game.design': ({ id }) => s.gaming.designer.create(String(id || '')),
    'game.designReset': ({ id }) => s.gaming.designer.reset(String(id || '')),
    'game.designState': ({ id }) => ({ running: s.gaming.designer.running.has(String(id || '')), needs: s.gaming.designer.needsDesign(s.gaming.context.profile(String(id || ''))) }),
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
    'tracker.status': () => ({ ...s.gaming.tracker.status, configured: s.gaming.tracker.configured(), canWrite: s.gaming.tracker.canWrite() }),
    'tracker.connect': async ({ token }) => { const r = await s.gaming.tracker.test(token); s.gaming.tracker.sync().catch(() => {}); return r; },
    'tracker.sync': () => s.gaming.tracker.sync(),
    'tracker.disconnect': () => s.gaming.tracker.disconnect(),
    'lol.reviews': ({ limit } = {}) => s.gaming.lolflow.reviews(limit || 10),
    'lol.reviewNow': () => s.gaming.lolflow.review({ force: true }),
    'lol.champselect': () => s.gaming.lolflow.state(),
    'lol.patterns': ({ games } = {}) => s.gaming.league.patterns(games || 20),
    'lol.deepSync': async () => { const r = await s.gaming.league.deepSync({ limit: 30 }); return { ...r, patterns: s.gaming.league.patterns(20) }; },
    'steam.library': () => s.gaming.steam.library(),
    'steam.import': ({ minMinutes } = {}) => s.gaming.steam.importProfiles({ minMinutes: minMinutes ?? s.settings.get('gaming').steamMinMinutes ?? 1 }),
    'steam.updates': () => s.gaming.steam.updates(),
    'steam.accounts': () => s.gaming.steam.accounts(),
    // Nur feste steam://-Befehle (Downloads öffnen, Dateien prüfen/aktualisieren, Spiel starten) – keine beliebigen URLs
    'steam.open': ({ action, appid }) => {
      const id = Number(appid);
      const url = action === 'downloads' ? 'steam://open/downloads' : action === 'validate' && id > 0 ? `steam://validate/${id}` : action === 'run' && id > 0 ? `steam://rungameid/${id}` : action === 'store' && id > 0 ? `steam://store/${id}` : null;
      if (!url) throw new Error('Unbekannte Steam-Aktion');
      shell.openExternal(url); return true;
    },
    'game.lastMap': ({ game }) => (game ? s.gaming.lastMap(game) : { map: null, hasImage: false, markers: [] }),
    'game.setLastMap': ({ game, map }) => s.gaming.setLastMap(game, map),
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
    'game.progress': ({ game }) => ({ items: s.gaming.progress.list(game), categories: require('./services/gaming/progress').CATEGORIES, statuses: require('./services/gaming/progress').STATUS }),
    'game.progressUpsert': ({ game, item }) => s.gaming.progress.upsert(game, { ...item, source: 'manual' }).item,
    'game.progressRemove': ({ id }) => s.gaming.progress.remove(id),
    'game.progressHistory': ({ id }) => s.gaming.progress.history(id),
    'game.progressWipe': ({ game, label }) => s.gaming.progress.wipe(game, label),
    'game.questDone': ({ name, done }) => {
      const p = s.gaming.progress;
      if (done) return p.upsert('eft', { category: 'quest', name, status: 'done', source: 'manual' }).item;
      const r = p.find('eft', 'quest', name); if (r) p.remove(r.id); return null;
    },
    'game.doneQuests': () => [...s.gaming.progress.doneKeys('eft', 'quest')],
    'game.addNote': ({ game, text, title }) => s.gaming.addNote(game, text, title),
    'game.sources': ({ game }) => s.gaming.sources(game),
    'game.research': ({ game, query }) => s.gaming.research(game, query),
    'game.wikiSearch': async ({ game, q }) => { const p = s.gaming.context.profile(game); if (!p?.wiki) return { results: [], available: false }; return s.gaming.wiki.search(p.wiki, q); },
    'game.wikiPage': async ({ game, title, api }) => { const p = s.gaming.context.profile(game); if (!p?.wiki) throw new Error('Kein Wiki'); return s.gaming.wiki.page(p.wiki, title, 12000, api); },
    'game.others': ({ active }) => s.gaming.otherGameNotifications(active),
    'tarkov.importMaps': ({ map, force } = {}) => s.gaming.tarkovMaps.importAll({ only: map ? String(map) : undefined, force: !!force }),
    'tarkov.maps': async () => { const r = await s.gaming.tarkov.maps(); return { maps: r.value.map((m) => ({ name: m.name, id: m.normalizedName, players: m.players, raidDuration: m.raidDuration })), source: r.source, fetchedAt: r.fetchedAt, offline: r.offline }; },
    'tarkov.map': async ({ map }) => { const r = await s.gaming.tarkov.map(map); return r ? { map: r.value, source: r.source, fetchedAt: r.fetchedAt, offline: r.offline } : null; },
    'tarkov.questMarkers': async ({ map }) => {
      const items = s.gaming.progress.list('eft');
      const done = new Set(items.filter((x) => x.category === 'quest' && x.status === 'done').map((x) => x.name));
      const lvl = Number(s.gaming.tracker.status?.level ?? String(items.find((x) => /(pmc[- ]?)?level/i.test(x.name))?.value || '').match(/\d+/)?.[0]);
      return s.gaming.tarkov.questMarkers(String(map || ''), { done, level: Number.isFinite(lvl) && lvl > 0 ? lvl : null, gameMode: s.gaming.tracker.tdMode() });
    },
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
    'lol.source': () => s.gaming.league.source(),

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
    'system.checkUpdates': () => s.updater.check(),
    'update.state': () => s.updater.public(),
    'update.check': () => s.updater.check(),
    'update.download': () => s.updater.download().then(() => s.updater.public()),
    'update.install': async () => {
      if (!s.updater.downloaded) await s.updater.download();
      const { file } = s.updater.downloaded;
      s.updater.set({ state: 'installing' });
      // Stiller Installer: ersetzt die Programmdateien (Daten bleiben) und startet JARVIS danach neu.
      // Ein kleiner, losgelöster cmd-Prozess wartet, bis der Installer fertig ist, und startet JARVIS dann neu.
      // (Zusätzlich startet auch der Installer JARVIS – die zweite Instanz beendet sich dank Single-Instance-Sperre sofort.)
      const exe = app.getPath('exe');
      if (process.platform === 'win32' && app.isPackaged) {
        const q = (x) => '"' + String(x).replace(/"/g, '') + '"';
        const line = `/d /s /c "start "" /wait ${q(file)} /S /RELAUNCH & timeout /t 2 /nobreak >nul & start "" ${q(exe)} --updated"`;
        require('node:child_process').spawn(process.env.ComSpec || 'cmd.exe', [line], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
      } else {
        require('node:child_process').spawn(file, ['/S', '/RELAUNCH'], { detached: true, stdio: 'ignore' }).unref();
      }
      setTimeout(() => quit(), 700);
      return { started: true };
    },
    'system.installUpdate': () => M['update.install'](),
    'system.selfTest': async () => selfTest(s),
    'system.diagnostics': async () => require('./services/diagnostics').runDiagnostics(s),

    // --- overlay & screen ---
    'screen.ask': async ({ question }) => { const r = await s.screen.hotkeyQuestion(String(question || '').slice(0, 500)); return { content: r?.content || '' }; },
    'screen.recent': () => s.db.all('SELECT id, question, answer, game, created_at AS createdAt FROM screenshots ORDER BY created_at DESC LIMIT 10'),
    'overlay.toggle': () => overlay?.()?.toggle(),
    'overlay.interactive': ({ on }) => overlay?.()?.setInteractive(!!on),
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
