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
    updateRepo: { type: 'string', maxLength: 140 },
    campusDualUrl: { type: 'string', maxLength: 500 },
    campusDualExams: { type: 'object', properties: { enabled: { type: 'boolean' } } },
    campusDualResults: { type: 'object', properties: { enabled: { type: 'boolean' }, intervalHours: { type: 'number', minimum: 1, maximum: 48 } } },
    backupDrive: { type: 'object', properties: { enabled: { type: 'boolean' }, folder: { type: 'string', maxLength: 200 }, keep: { type: 'number', minimum: 1, maximum: 100 }, intervalHours: { type: 'number', minimum: 1, maximum: 168 } } },
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
    aiCostMode: { type: 'string', enum: ['spar', 'max'] },
    aiBudget: { type: 'object', properties: { monthlyEur: { type: 'number', minimum: 0, maximum: 1000 }, warnPct: { type: 'number', minimum: 10, maximum: 99 }, brake: { type: 'boolean' }, usdToEur: { type: 'number', minimum: 0.5, maximum: 1.5 } } },
    birthdaysToCalendar: { type: 'boolean' },
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
      defaultCalendarId: { type: 'string', maxLength: 300 }, account: { type: 'string', maxLength: 200 },
      scopes: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 200 } } } },
    // Study
    study: { type: 'object', properties: {
      folder: { type: 'string', maxLength: 600 }, enabled: { type: 'boolean' },
      formats: { type: 'array', items: { type: 'string' } },
      visionForHandwriting: { type: 'string', enum: ['off', 'on-demand', 'auto'] },
      visionDailyLimit: { type: 'number', minimum: 0, maximum: 500 },
      source: { type: 'string', enum: ['folder', 'drive'] }, driveFolder: { type: 'string', maxLength: 120 }, driveFolderId: { type: 'string', maxLength: 200 },
      preferredTime: { type: 'string', maxLength: 5 }, maxSessionsPerDay: { type: 'number', minimum: 1, maximum: 4 }, linkLectures: { type: 'boolean' } } },
    // Gaming
    gaming: { type: 'object', properties: {
      detection: { type: 'boolean' }, reduceWhileGaming: { type: 'boolean' },
      riotId: { type: 'string', maxLength: 60 }, leagueDir: { type: 'string', maxLength: 500 }, riotRegion: { type: 'string', enum: ['euw1', 'eun1', 'na1', 'kr', 'br1', 'la1', 'la2', 'oc1', 'tr1', 'ru', 'jp1'] },
      lolLiveCoach: { type: 'boolean' }, lolMatchupCard: { type: 'boolean' }, patchNotes: { type: 'boolean' }, patchSummaries: { type: 'boolean' }, breakReminderMin: { type: 'number', minimum: 0, maximum: 600 }, wishlistAlerts: { type: 'boolean' }, wishlistMinDiscount: { type: 'number', minimum: 0, maximum: 100 }, gameRecap: { type: 'boolean' }, servers: { type: 'array', maxItems: 30, items: { type: 'object', additionalProperties: false, required: ['address'], properties: { address: { type: 'string', maxLength: 200 }, game: { type: 'string', maxLength: 40 }, name: { type: 'string', maxLength: 80 }, kind: { type: 'string', enum: ['steam', 'minecraft'] } } } }, lolBreakHint: { type: 'boolean' }, lolWeekly: { type: 'boolean' }, autoDesign: { type: 'boolean' }, eftLogWatch: { type: 'boolean' }, eftDir: { type: 'string', maxLength: 400 }, eftScreenshotsDir: { type: 'string', maxLength: 400 }, eftMoveShots: { type: 'boolean' }, eftFaction: { type: 'string', enum: ['pmc', 'scav', 'all'] }, eftRunthroughSec: { type: 'number', minimum: 0, maximum: 1800 }, eftScavCooldownMin: { type: 'number', minimum: 1, maximum: 60 }, eftScanHotkey: { type: 'string', maxLength: 40 }, eftAlerts: { type: 'object', properties: Object.fromEntries(['matchFound', 'raidStart', 'runthrough', 'scavReady', 'fleaSold', 'speak'].map((k) => [k, { type: 'boolean' }])) }, eftShotKeepDays: { type: 'number', minimum: 0, maximum: 365 }, lolObjectives: { type: 'boolean' }, lolObjectiveTimes: { type: 'object', additionalProperties: false, properties: Object.fromEntries(['dragon', 'grubs', 'herald', 'atakhan', 'baron'].map((k) => [k, { type: 'number', minimum: 0, maximum: 3600 }])) }, favorites: { type: 'array', items: { type: 'string' } },
      lolChampSelect: { type: 'boolean' }, lolReview: { type: 'boolean' }, steamDir: { type: 'string', maxLength: 500 }, steamId: { type: 'string', maxLength: 20 }, steamAutoImport: { type: 'boolean' }, steamMinMinutes: { type: 'number', minimum: 0, maximum: 100000 }, lolReviewAi: { type: 'boolean' }, tarkovTrackerSync: { type: 'boolean' } } },
    // Screen analysis & in-game overlay
    screen: { type: 'object', properties: {
      enabled: { type: 'boolean' }, hotkey: { type: 'string', maxLength: 40 }, defaultQuestion: { type: 'string', maxLength: 300 } } },
    overlay: { type: 'object', properties: {
      mode: { type: 'string', enum: ['auto', 'always', 'off'] }, hotkey: { type: 'string', maxLength: 40 }, interactHotkey: { type: 'string', maxLength: 40 },
      position: { type: 'string', enum: ['left', 'right'] }, opacity: { type: 'number', minimum: 0.4, maximum: 1 }, scale: { type: 'number', minimum: 0.7, maximum: 1.5 },
      showMap: { type: 'boolean' }, speakAnswers: { type: 'boolean' }, mapCorner: { type: 'boolean' }, mapSize: { type: 'number', minimum: 200, maximum: 600 }, mapZoom: { type: 'boolean' } } },
    // Phone (Telegram bot)
    telegram: { type: 'object', properties: {
      enabled: { type: 'boolean' }, forwardMode: { type: 'string', enum: ['off', 'idle', 'always'] }, idleMinutes: { type: 'number', minimum: 1, maximum: 240 },
      chats: { type: 'array', maxItems: 5, items: { type: 'object', properties: { id: { type: 'number' }, name: { type: 'string', maxLength: 80 } } } },
      allowConfirm: { type: 'boolean' } } },
    // PC control (fixed allowlist)
    pc: { type: 'object', properties: {
      enabled: { type: 'boolean' }, allowPower: { type: 'boolean' },
      apps: { type: 'array', maxItems: 60, items: { type: 'object', properties: { name: { type: 'string', maxLength: 60 }, kind: { type: 'string', enum: ['exe', 'steam', 'uri', 'folder'] }, target: { type: 'string', maxLength: 500 } } } } } },
    // Local offline model (Ollama)
    ollama: { type: 'object', properties: {
      enabled: { type: 'boolean' }, url: { type: 'string', maxLength: 100 }, model: { type: 'string', maxLength: 100 }, notWhileGaming: { type: 'boolean' } } },
    // GitHub projects
    github: { type: 'object', properties: {
      enabled: { type: 'boolean' }, repos: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 140 } }, notifyFailures: { type: 'boolean' } } },
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
  notifyCategories: { tasks: true, calendar: true, gaming: true, study: true, system: true, briefing: true, projects: true },
  quietHours: { enabled: false, from: '23:00', to: '07:00' },
  animations: 'full', hudTransparency: 0.85, alwaysOnTop: false, globalHotkey: 'Control+Alt+J',
  startSound: { mode: 'off', delaySeconds: 0, file: '', volume: 0.6 },
  updateChannelUrl: '', updateRepo: '', updateCheck: true, campusDualUrl: '',
  campusDualResults: { enabled: true, intervalHours: 3 }, campusDualExams: { enabled: true },
  backupDrive: { enabled: false, folder: 'coding', keep: 14, intervalHours: 24 },
  models: { fast: '', reasoning: '', research: '', vision: '', live: '', embedding: '' },
  availableModels: [], temperature: 0.7, webSearch: true, autoMemory: true, birthdaysToCalendar: true, aiCostMode: 'spar', aiBudget: { monthlyEur: 5, warnPct: 80, brake: true, usdToEur: 0.86 },
  voice: { inputDeviceId: 'default', outputDeviceId: 'default', voiceName: 'Charon', speakReplies: false,
    wakeWord: false, wakeSensitivity: 0.5, pushToTalkKey: 'Control+Alt+Space', extendedThinking: false, bargeIn: true, idleDisconnectSeconds: 90 },
  google: { clientId: '', calendarSync: true, syncIntervalMinutes: 15, defaultCalendarId: '', account: '' },
  study: { folder: '', source: 'drive', driveFolder: 'Goodnotes', driveFolderId: '', enabled: false, formats: ['pdf', 'docx', 'pptx', 'txt', 'md', 'ipynb'], visionForHandwriting: 'on-demand', visionDailyLimit: 40, preferredTime: '16:00', maxSessionsPerDay: 2, linkLectures: true },
  gaming: { detection: true, reduceWhileGaming: true, riotId: '', leagueDir: '', riotRegion: 'euw1', lolLiveCoach: false, lolMatchupCard: true, patchNotes: true, patchSummaries: true, breakReminderMin: 0, wishlistAlerts: true, wishlistMinDiscount: 30, gameRecap: true, servers: [], lolBreakHint: true, lolWeekly: true, favorites: [], lolChampSelect: true, lolReview: true, steamDir: '', steamId: '', steamAutoImport: true, steamMinMinutes: 1, lolReviewAi: true, tarkovTrackerSync: true, lolObjectives: true, lolObjectiveTimes: {}, autoDesign: true, eftLogWatch: true, eftDir: '', eftScreenshotsDir: '', eftMoveShots: true, eftShotKeepDays: 7, eftFaction: 'pmc', eftRunthroughSec: 430, eftScavCooldownMin: 25, eftScanHotkey: 'Alt+Shift+S', eftAlerts: { matchFound: true, raidStart: true, runthrough: true, scavReady: true, fleaSold: true, speak: false } },
  screen: { enabled: true, hotkey: 'Control+Alt+W', defaultQuestion: 'Was sehe ich hier? Hilf mir kurz und konkret.' },
  overlay: { mode: 'auto', hotkey: 'Control+Alt+O', interactHotkey: 'Control+Alt+I', position: 'right', opacity: 0.92, scale: 1, showMap: true, speakAnswers: false, mapCorner: true, mapSize: 320, mapZoom: true },
  telegram: { enabled: false, forwardMode: 'idle', idleMinutes: 10, chats: [], allowConfirm: true },
  pc: { enabled: true, allowPower: true, apps: [] },
  ollama: { enabled: false, url: 'http://127.0.0.1:11434', model: '', notWhileGaming: true },
  github: { enabled: false, repos: [], notifyFailures: true },
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
