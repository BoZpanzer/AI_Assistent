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

/**
 * Composition root. Pure Node (no Electron imports) so the complete service
 * layer runs in automated tests. Platform specifics are injected.
 *
 * @param {{dataDir:string, version:string, cipher?:object, fetch?:Function,
 *          platform?:{toast?,openExternal?}, genaiSdk?:object, updatePublicKey?:any}} opts
 */
function createCore(opts) {
  const data = opts.dataDir;
  fs.mkdirSync(data, { recursive: true });
  logger.init(path.join(data, 'logs'), process.env.JARVIS_LOG_LEVEL || 'info');
  System.applyPendingRestore(data);

  const bus = new EventEmitter();
  bus.setMaxListeners(100);
  const s = { bus, version: opts.version, paths: { data }, platform: opts.platform || {}, fetch: opts.fetch || globalThis.fetch, updatePublicKey: opts.updatePublicKey || null };
  s.db = new Database(opts.dbFile || path.join(data, 'jarvis.sqlite3'), { backupDir: path.join(data, 'backups') });
  s.settings = new Settings(s.db, bus);
  s.secrets = new Secrets(path.join(data, 'secrets.json'), opts.cipher || memoryCipher);
  s.confirmations = new Confirmations(bus);
  s.gemini = new Gemini({ ...s, genaiSdk: opts.genaiSdk });
  s.google = new GoogleClient(s);
  s.notifications = new Notifications(s);
  s.tasks = new Tasks(s);
  s.calendar = new Calendar(s);
  s.vectors = new VectorIndex(s);
  s.brain = new Brain(s);
  s.study = new Study(s);
  s.web = new Web(s);
  s.conversations = new Conversations(s);
  s.gaming = new Gaming(s);
  s.system = new System(s);
  s.briefing = () => briefing(s);
  s.orchestrator = new Orchestrator(s);
  s.voice = new LiveVoice(s);
  s.scheduler = new Scheduler(s);

  s.start = () => {
    s.gaming.context.restore();
    s.gaming.context.start();
    s.study.start();
    s.scheduler.start();
    bus.on('settings:changed', ({ keys }) => {
      if (keys.includes('study')) { s.study.start(); s.scheduler.runNow('study-scan'); }
      if (keys.includes('gaming')) s.gaming.context.start();
    });
  };
  s.stop = () => {
    try { s.scheduler.stop(); s.study.stop(); s.gaming.context.stop(); s.voice.stop(); } catch { /* ignore */ }
    s.db.close();
  };
  return s;
}

module.exports = { createCore };
