'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const logger = require('./core/logger');
const { Database } = require('./core/db');
const { Settings } = require('./core/settings');
const { Secrets, memoryCipher } = require('./core/secrets');
const { Confirmations } = require('./core/confirmations');
const { Gemini } = require('./providers/gemini');
const { GoogleClient } = require('./providers/google');
const { Notifications } = require('./services/notifications');
const { Tasks } = require('./services/tasks');
const { Calendar } = require('./services/calendar');
const { VectorIndex } = require('./services/vectors');
const { Brain } = require('./services/brain');
const { Study } = require('./services/study');
const { Web } = require('./services/web');
const { Conversations } = require('./services/conversations');
const { Gaming } = require('./services/gaming');
const { System, briefing } = require('./services/system');
const { Orchestrator } = require('./agent/orchestrator');
const { LiveVoice } = require('./voice/live');
const { Scheduler } = require('./jobs/scheduler');
const { ScreenVision } = require('./services/screen');
const { Updater } = require('./services/updater');
const { Drive } = require('./services/drive');
const { Feeds } = require('./services/ics');
const { DriveBackup } = require('./services/drivebackup');
const { CampusResults } = require('./services/campusresults');
const { CostGuard } = require('./services/costguard');
const { CampusExams } = require('./services/campusexams');
const { Exams } = require('./services/exams');
const { Birthdays } = require('./services/birthdays');
const { TarkovTracker } = require('./services/gaming/tarkovtracker');
const { LolFlow } = require('./services/gaming/lolflow');
const { Playtime } = require('./services/gaming/playtime');
const { Life } = require('./services/life');
const { Deadlines } = require('./services/deadlines');
const { Transit } = require('./services/transit');
const { GameNews } = require('./services/gaming/news');
const { Deals } = require('./services/gaming/deals');
const { Rok } = require('./services/gaming/rok');
const { Ark } = require('./services/gaming/ark');
const { Cs2 } = require('./services/gaming/cs2');
const { AcTelemetry } = require('./services/gaming/actelemetry');
const { Pubg } = require('./services/gaming/pubg');
const { Stardew } = require('./services/gaming/stardew');
const { WikiLists } = require('./services/gaming/wikilists');
const { Factorio } = require('./services/gaming/factorio');
const { GameBrainSync } = require('./services/gaming/brainsync');
const { Steam } = require('./services/gaming/steam');
const { GameDesigner } = require('./services/gaming/designer');
const { EftLogs } = require('./services/gaming/eftlogs');
const { EftRaid } = require('./services/gaming/eftraid');

/**
 * Composition root. Pure Node (no Electron imports) so the complete service
 * layer runs in automated tests. Platform specifics are injected.
 *
 * @param {{dataDir:string, version:string, cipher?:object, fetch?:Function,
 *          platform?:{toast?,openExternal?}, genaiSdk?:object, updatePublicKey?:any, updateRepo?:string}} opts
 */
function createCore(opts) {
  const data = opts.dataDir;
  fs.mkdirSync(data, { recursive: true });
  logger.init(path.join(data, 'logs'), process.env.JARVIS_LOG_LEVEL || 'info');
  System.applyPendingRestore(data);

  const bus = new EventEmitter();
  bus.setMaxListeners(100);
  const s = { bus, version: opts.version, paths: { data }, platform: opts.platform || {}, fetch: opts.fetch || globalThis.fetch, updatePublicKey: opts.updatePublicKey || null, updateRepo: opts.updateRepo || null };
  s.db = new Database(opts.dbFile || path.join(data, 'jarvis.sqlite3'), { backupDir: path.join(data, 'backups') });
  s.settings = new Settings(s.db, bus);
  s.localLLM = new (require('./providers/local').LocalLLM)(s.settings);
  const fetchExternal = s.fetch;
  s.fetch = (...args) => { require('./core/privacy').assertExternal(); return fetchExternal(...args); };
  s.secrets = new Secrets(path.join(data, 'secrets.json'), opts.cipher || memoryCipher);
  s.confirmations = new Confirmations(bus);
  s.gemini = new Gemini({ ...s, genaiSdk: opts.genaiSdk });
  s.google = new GoogleClient(s);
  s.notifications = new Notifications(s);
  s.tasks = new Tasks(s);
  s.calendar = new Calendar(s);
  s.feeds = new Feeds(s);
  s.vectors = new VectorIndex(s);
  s.brain = new Brain(s);
  s.birthdays = new Birthdays(s);
  s.study = new Study(s);
  s.drive = new Drive(s);
  s.web = new Web(s);
  s.conversations = new Conversations(s);
  s.gaming = new Gaming(s);
  s.gaming.tracker = new TarkovTracker(s);
  s.gaming.lolflow = new LolFlow(s);
  s.gaming.playtime = new Playtime(s);
  s.life = new Life(s);
  s.deadlines = new Deadlines(s);
  s.transit = new Transit(s);
  s.gaming.news = new GameNews(s);
  s.gaming.deals = new Deals(s);
  s.gaming.rok = new Rok(s);
  s.gaming.ark = new Ark(s);
  s.gaming.cs2 = new Cs2(s);
  s.gaming.ac = new AcTelemetry(s);
  s.gaming.pubg = new Pubg(s);
  s.gaming.stardew = new Stardew(s);
  s.gaming.wikiLists = new WikiLists(s);
  s.gaming.factorio = new Factorio(s);
  s.gaming.brainSync = new GameBrainSync(s);
  s.gaming.designer = new GameDesigner(s);
  s.gaming.eftLogs = new EftLogs(s);
  s.gaming.eftRaid = new EftRaid(s);
  // Tarkov gestartet → TarkovTracker sofort abgleichen und Quest-Meldungen aus dem Spiel-Log mitlesen
  bus.on('game:running', ({ started = [], stopped = [] }) => {
    if (started.includes('eft')) { s.gaming.eftLogs.start().catch(() => {}); setTimeout(() => !s.stopped && s.scheduler?.runNow('tarkovtracker'), 8000); }
    if (stopped.includes('eft')) s.gaming.eftLogs.stop();
  });
  // Unbekanntes Spiel wird gespielt/besprochen → eigene Seite gestalten (einmal, im Hintergrund)
  bus.on('game:context', (st) => { for (const x of [st?.active, st?.discussed]) if (x?.id) { clearTimeout(s._designTimer); s._designTimer = setTimeout(() => { if (!s.stopped) s.gaming.designer.maybeAuto(x.id); }, 1500); } });
  s.gaming.steam = new Steam(s);
  s.gaming.context.steam = s.gaming.steam;
  s.system = new System(s);
  s.updater = new Updater(s);
  s.driveBackup = new DriveBackup(s);
  s.campusResults = new CampusResults(s);
  s.costGuard = new CostGuard(s);
  s.exams = new Exams(s);
  s.campusExams = new CampusExams(s);
  s.gemini.guard = s.costGuard;
  s.briefing = () => briefing(s);
  s.contextProviders = [() => s.exams.contextText()];
  s.screen = new ScreenVision(s);
  s.orchestrator = new Orchestrator(s);
  s.voice = new LiveVoice(s);
  s.scheduler = new Scheduler(s);

  s.start = () => {
    s.gaming.context.restore();
    s.gaming.context.start();
    s.study.start();
    s.scheduler.start();
    s._brainSyncTimer = setTimeout(() => s.gaming.brainSync.syncAll(), 30_000);
    s.birthdays.schedule(20_000);
    bus.on('settings:changed', ({ keys }) => { if (keys.includes('birthdaysToCalendar')) s.birthdays.schedule(500); });
    bus.on('settings:changed', ({ keys }) => {
      if (keys.includes('study')) { s.study.start(); s.scheduler.runNow('study-scan'); if (s.drive.active()) s.scheduler.runNow('drive-sync'); }
      if (keys.includes('gaming')) s.gaming.context.start();
    });
  };
  s.stop = () => {
    s.stopped = true;
    try { clearTimeout(s._brainSyncTimer); clearTimeout(s._designTimer); clearTimeout(s.scheduler?._examT); s.birthdays.stop(); s.gaming.brainSync.flush(); s.scheduler.stop(); s.study.stop(); s.gaming.context.stop(); s.gaming.eftLogs.stop({ final: false }); s.gaming.eftRaid.stop(); s.gaming.lolflow.dispose(); s.gaming.playtime.stop(); s.gaming.cs2.stop(); s.gaming.ac.stop(); s.life.stop(); s.voice.stop(); } catch { /* ignore */ }
    s.db.close();
  };
  return s;
}

module.exports = { createCore };

