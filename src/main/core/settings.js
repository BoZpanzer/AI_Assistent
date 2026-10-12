'use strict';
const { validate } = require('./validate');

/**
 * Typed, whitelisted user settings. Secrets are NOT stored here (see secrets.js).
 */
const SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    // General
    setupComplete: { type: 'boolean' },
    nickname: { type: 'string', maxLength: 40 },
    userName: { type: 'string', maxLength: 60 },
    theme: { type: 'string', enum: ['jarvis'] },
    startPage: { type: 'string', enum: ['dashboard', 'chat', 'tasks', 'calendar', 'study', 'gaming', 'brain'] },
    language: { type: 'string', enum: ['de-DE'] },
    // Desktop
    autostart: { type: 'boolean' },
    startMinimized: { type: 'boolean' },
    closeToTray: { type: 'boolean' },
    notifications: { type: 'boolean' },
    notifyCategories: { type: 'object' },
    quietHours: { type: 'object', properties: { enabled: { type: 'boolean' }, from: { type: 'string', maxLength: 5 }, to: { type: 'string', maxLength: 5 } } },
    animations: { type: 'string', enum: ['full', 'reduced', 'off'] },
    hudTransparency: { type: 'number', minimum: 0.4, maximum: 1 },
    alwaysOnTop: { type: 'boolean' },
    globalHotkey: { type: 'string', maxLength: 40 },
    startSound: { type: 'object', properties: {
      mode: { type: 'string', enum: ['off', 'immediate', 'delayed'] },
      delaySeconds: { type: 'number', minimum: 0, maximum: 120 },
      file: { type: 'string', maxLength: 500 },
      volume: { type: 'number', minimum: 0, maximum: 1 } } },
    updateChannelUrl: { type: 'string', maxLength: 500 },
    updateCheck: { type: 'boolean' },
    // AI
    models: { type: 'object', properties: {
      fast: { type: 'string', maxLength: 80 }, reasoning: { type: 'string', maxLength: 80 },
      research: { type: 'string', maxLength: 80 }, vision: { type: 'string', maxLength: 80 },
      live: { type: 'string', maxLength: 80 }, embedding: { type: 'string', maxLength: 80 } } },
    availableModels: { type: 'array', items: { type: 'string' }, maxItems: 400 },
    temperature: { type: 'number', minimum: 0, maximum: 1.5 },
    webSearch: { type: 'boolean' },
    autoMemory: { type: 'boolean' },
    // Voice
    voice: { type: 'object', properties: {
      inputDeviceId: { type: 'string', maxLength: 300 }, outputDeviceId: { type: 'string', maxLength: 300 },
      voiceName: { type: 'string', maxLength: 60 }, speakReplies: { type: 'boolean' },
      wakeWord: { type: 'boolean' }, wakeSensitivity: { type: 'number', minimum: 0.1, maximum: 0.95 },
      pushToTalkKey: { type: 'string', maxLength: 40 }, extendedThinking: { type: 'boolean' },
      bargeIn: { type: 'boolean' }, idleDisconnectSeconds: { type: 'number', minimum: 10, maximum: 900 } } },
    // Google
    google: { type: 'object', properties: {
      clientId: { type: 'string', maxLength: 200 }, calendarSync: { type: 'boolean' },
      syncIntervalMinutes: { type: 'number', minimum: 5, maximum: 240 },
      defaultCalendarId: { type: 'string', maxLength: 300 }, account: { type: 'string', maxLength: 200 } } },
    // Study
    study: { type: 'object', properties: {
      folder: { type: 'string', maxLength: 600 }, enabled: { type: 'boolean' },
      formats: { type: 'array', items: { type: 'string' } },
      visionForHandwriting: { type: 'string', enum: ['off', 'on-demand', 'auto'] },
      visionDailyLimit: { type: 'number', minimum: 0, maximum: 500 } } },
    // Gaming
    gaming: { type: 'object', properties: {
      detection: { type: 'boolean' }, reduceWhileGaming: { type: 'boolean' },
      riotId: { type: 'string', maxLength: 60 }, riotRegion: { type: 'string', enum: ['euw1', 'eun1', 'na1', 'kr', 'br1', 'la1', 'la2', 'oc1', 'tr1', 'ru', 'jp1'] },
      lolLiveCoach: { type: 'boolean' }, favorites: { type: 'array', items: { type: 'string' } } } },
    // Proactive
    proactive: { type: 'object', properties: {
      dailyBriefing: { type: 'boolean' }, briefingTime: { type: 'string', maxLength: 5 },
      overdueReminders: { type: 'boolean' } } },
    // Security
    security: { type: 'object', properties: {
      localOnlyProcessing: { type: 'boolean' }, restrictFileAccess: { type: 'boolean' },
      lockAfterMinutes: { type: 'number', minimum: 0, maximum: 1440 } } },
  },
};

const DEFAULTS = {
  setupComplete: false, nickname: 'Chef', userName: '', theme: 'jarvis', startPage: 'dashboard', language: 'de-DE',
  autostart: false, startMinimized: false, closeToTray: true, notifications: true,
  notifyCategories: { tasks: true, calendar: true, gaming: true, study: true, system: true, briefing: true },
  quietHours: { enabled: false, from: '23:00', to: '07:00' },
  animations: 'full', hudTransparency: 0.85, alwaysOnTop: false, globalHotkey: 'Control+Alt+J',
  startSound: { mode: 'off', delaySeconds: 0, file: '', volume: 0.6 },
  updateChannelUrl: '', updateCheck: true,
  models: { fast: '', reasoning: '', research: '', vision: '', live: '', embedding: '' },
  availableModels: [], temperature: 0.7, webSearch: true, autoMemory: true,
  voice: { inputDeviceId: 'default', outputDeviceId: 'default', voiceName: 'Charon', speakReplies: false,
    wakeWord: false, wakeSensitivity: 0.5, pushToTalkKey: 'Control+Alt+Space', extendedThinking: false, bargeIn: true, idleDisconnectSeconds: 90 },
  google: { clientId: '', calendarSync: true, syncIntervalMinutes: 15, defaultCalendarId: '', account: '' },
  study: { folder: '', enabled: false, formats: ['pdf', 'docx', 'pptx', 'txt', 'md', 'ipynb'], visionForHandwriting: 'on-demand', visionDailyLimit: 40 },
  gaming: { detection: true, reduceWhileGaming: true, riotId: '', riotRegion: 'euw1', lolLiveCoach: false, favorites: [] },
  proactive: { dailyBriefing: false, briefingTime: '08:00', overdueReminders: true },
  security: { localOnlyProcessing: false, restrictFileAccess: true, lockAfterMinutes: 0 },
};

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function merge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  return out;
}

class Settings {
  constructor(db, bus) {
    this.db = db; this.bus = bus;
    this._cache = null;
  }
  all() {
    if (this._cache) return this._cache;
    const stored = {};
    for (const r of this.db.all('SELECT key, value FROM settings')) {
      try { stored[r.key] = JSON.parse(r.value); } catch { /* ignore corrupt */ }
    }
    this._cache = merge(DEFAULTS, stored);
    return this._cache;
  }
  get(key) { return this.all()[key]; }
  /** Patch settings. Unknown keys are rejected. */
  update(patch) {
    const res = validate(SCHEMA, patch);
    if (!res.ok) throw new Error('Ungültige Einstellungen: ' + res.errors.join('; '));
    const current = this.all();
    const changed = [];
    this.db.tx(() => {
      for (const [k, v] of Object.entries(res.value)) {
        if (v === undefined) continue;
        const next = isObj(v) && isObj(current[k]) ? merge(current[k], v) : v;
        this.db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, JSON.stringify(next));
        changed.push(k);
      }
    });
    this._cache = null;
    if (changed.length) this.bus?.emit('settings:changed', { keys: changed, settings: this.all() });
    return this.all();
  }
}

module.exports = { Settings, DEFAULTS, SCHEMA };
