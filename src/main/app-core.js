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
const { TarkovTracker } = require('./services/gaming/tarkovtracker');
const { LolFlow } = require('./services/gaming/lolflow');
const { GameBrainSync } = require('./services/gaming/brainsync');
const { Steam } = require('./services/gaming/steam');

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
  s.study = new Study(s);
  s.drive = new Drive(s);
  s.web = new Web(s);
  s.conversations = new Conversations(s);
  s.gaming = new Gaming(s);
  s.gaming.tracker = new TarkovTracker(s);
  s.gaming.lolflow = new LolFlow(s);
  s.gaming.brainSync = new GameBrainSync(s);
  s.gaming.steam = new Steam(s);
  s.gaming.context.steam = s.gaming.steam;
  s.system = new System(s);
  s.updater = new Updater(s);
  s.driveBackup = new DriveBackup(s);
  s.briefing = () => briefing(s);
  s.contextProviders = [];
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
    bus.on('settings:changed', ({ keys }) => {
      if (keys.includes('study')) { s.study.start(); s.scheduler.runNow('study-scan'); if (s.drive.active()) s.scheduler.runNow('drive-sync'); }
      if (keys.includes('gaming')) s.gaming.context.start();
    });
  };
  s.stop = () => {
    try { clearTimeout(s._brainSyncTimer); s.gaming.brainSync.flush(); s.scheduler.stop(); s.study.stop(); s.gaming.context.stop(); s.gaming.lolflow.stop(); s.voice.stop(); } catch { /* ignore */ }
    s.db.close();
  };
  return s;
}

module.exports = { createCore };
