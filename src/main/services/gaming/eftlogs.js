'use strict';
const fs = require('node:fs');
const path = require('node:path');
const log = require('../../core/logger').scope('eftlogs');

/**
 * Tarkov-Logdateien mitlesen (nur lesen – wie das Community-Tool „TarkovMonitor“ von tarkov.dev).
 * Escape from Tarkov schreibt Quest-Nachrichten (angenommen / abgeschlossen / fehlgeschlagen) in die
 * Benachrichtigungs-Logs im Spielordner. JARVIS erkennt sie und trägt sie in „Mein Spielstand“ ein;
 * mit Schreibrecht im TarkovTracker-Token gehen „erledigt“/„fehlgeschlagen“ automatisch an TarkovTracker.
 * Kein Zugriff auf den Spielprozess, keine Eingaben ins Spiel.
 */
const TYPE = { 10: 'in_progress', 11: 'failed', 12: 'done' }; // TaskStarted / TaskFailed / TaskFinished
const LINE_START = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/;

/** Quest-Ereignisse aus einem Stück Logtext (Einträge beginnen mit Zeitstempel, JSON folgt auf den Folgezeilen). */
function parseNotifications(text) {
  const out = [];
  const entries = []; let cur = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (LINE_START.test(line)) { if (cur) entries.push(cur); cur = [line]; } else if (cur) cur.push(line);
  }
  if (cur) entries.push(cur);
  for (const e of entries) {
    if (!/ChatMessageReceived/.test(e[0])) continue;
    const body = e.slice(1).join('\n');
    const start = body.indexOf('{'); const end = body.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    let j; try { j = JSON.parse(body.slice(start, end + 1)); } catch { continue; }
    const m = j.message || j;
    const status = TYPE[m?.type];
    const taskId = String(m?.templateId || '').split(' ')[0];
    if (!status || !/^[0-9a-f]{24}$/i.test(taskId)) continue;
    out.push({ taskId, status, at: e[0].slice(0, 19), key: `${taskId}:${m.type}:${m.dt || e[0].slice(0, 19)}` });
  }
  return out;
}

class EftLogs {
  constructor(s) { this.s = s; this.timer = null; this.offsets = new Map(); this.dir = undefined; this.lastError = null; }
  cfg() { return this.s.settings.get('gaming') || {}; }
  enabled() { return this.cfg().eftLogWatch !== false; }

  /** Spielordner finden: Einstellung → Registry (BSG-Launcher) → übliche Pfade → Steam-Bibliotheken. */
  async gameDir() {
    if (this.dir !== undefined && this.dir) return this.dir;
    const ok = (d) => { try { return !!d && fs.existsSync(path.join(d, 'Logs')); } catch { return false; } };
    // eingestellter Ordner zuerst – dann keine Registry-/Steam-Suche nötig
    if (ok(this.cfg().eftDir)) { this.dir = this.cfg().eftDir; return this.dir; }
    const cands = [];
    if (process.platform === 'win32') {
      const steam = this.s.gaming.steam;
      for (const key of ['HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EscapeFromTarkov', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EscapeFromTarkov']) {
        cands.push(await steam?.regQuery?.(key, 'InstallLocation').catch(() => null));
      }
      cands.push('C:\\Battlestate Games\\EFT', 'C:\\Battlestate Games\\Escape from Tarkov', 'D:\\Battlestate Games\\EFT', 'D:\\Battlestate Games\\Escape from Tarkov');
      for (const lib of (await steam?.libraries?.().catch(() => [])) || []) cands.push(path.join(lib, 'common', 'Escape from Tarkov'), path.join(lib, 'common', 'EscapeFromTarkov'));
    }
    this.dir = cands.filter(Boolean).find(ok) || null;
    return this.dir;
  }

  /** Neuester Log-Ordner (log_JJJJ.MM.TT_…) und seine Benachrichtigungs-Logs. */
  async currentFiles() {
    const dir = await this.gameDir();
    if (!dir) return [];
    const logs = path.join(dir, 'Logs');
    let folders = [];
    try { folders = fs.readdirSync(logs).filter((f) => /^log_/i.test(f)).map((f) => ({ f, t: fs.statSync(path.join(logs, f)).mtimeMs })).sort((a, b) => b.t - a.t); } catch { return []; }
    if (!folders.length) return [];
    const newest = path.join(logs, folders[0].f);
    try { return fs.readdirSync(newest).filter((f) => /notifications.*\.log$/i.test(f)).map((f) => path.join(newest, f)); } catch { return []; }
  }

  seen() { try { return new Set(JSON.parse(this.s.system.meta('eftlogs:seen') || '[]')); } catch { return new Set(); } }

  /** Neue Zeilen lesen und Quest-Ereignisse übernehmen. */
  async poll() {
    const files = await this.currentFiles();
    const events = [];
    for (const f of files) {
      let size; try { size = fs.statSync(f).size; } catch { continue; }
      const from = Math.min(this.offsets.get(f) ?? 0, size);
      if (size === from) continue;
      const fd = fs.openSync(f, 'r');
      try {
        const len = Math.min(size - from, 4 * 1024 * 1024);
        const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, from);
        // nur bis zum letzten vollständigen Eintrag lesen (Spiel schreibt evtl. gerade)
        let text = buf.toString('utf8');
        const cut = text.lastIndexOf('\n'); if (cut >= 0 && from + len === size) text = text.slice(0, cut + 1);
        this.offsets.set(f, from + Buffer.byteLength(text, 'utf8'));
        events.push(...parseNotifications(text));
      } finally { fs.closeSync(fd); }
    }
    return this.apply(events);
  }

  async apply(events) {
    if (!events.length) return [];
    const seen = this.seen();
    const fresh = events.filter((e) => !seen.has(e.key));
    if (!fresh.length) return [];
    const tasks = (await this.s.gaming.tarkov.tasks(this.s.gaming.tracker.tdMode())).value || [];
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const P = this.s.gaming.progress;
    const applied = [];
    for (const e of fresh) {
      seen.add(e.key);
      const t = byId.get(e.taskId);
      if (!t) continue;
      const cur = P.find('eft', 'quest', t.name);
      if (e.status === 'in_progress' && cur?.status === 'done') continue; // Reihenfolge im Log: nie „erledigt“ zurückstufen
      P.upsert('eft', { category: 'quest', name: t.name, status: e.status, source: 'log' });
      applied.push({ name: t.name, status: e.status });
    }
    this.s.system.setMeta('eftlogs:seen', JSON.stringify([...seen].slice(-1000)));
    const done = applied.filter((a) => a.status !== 'in_progress');
    if (done.length) {
      const push = this.s.gaming.tracker.configured() && this.s.gaming.tracker.canWrite();
      this.s.notifications.push({ category: 'gaming', origin: 'client', game: 'eft', dedupeKey: 'eftlog:' + done.map((d) => d.name + d.status).join(','),
        title: done.length === 1 ? `Quest ${done[0].status === 'done' ? 'abgeschlossen' : 'fehlgeschlagen'}: ${done[0].name}` : `${done.length} Quests aktualisiert`,
        body: done.map((d) => `${d.name} (${d.status === 'done' ? 'erledigt' : 'fehlgeschlagen'})`).join(' · ') + (push ? ' – an TarkovTracker übertragen.' : ' – in „Mein Spielstand“ eingetragen.') });
    }
    if (applied.length) log.info(`Aus dem Tarkov-Log: ${applied.map((a) => a.name + '→' + a.status).join(', ')}`);
    return applied;
  }

  /** Beim Spielstart: Ordner suchen, ab jetzt mitlesen (auch was seit Spielstart schon im Log steht). */
  async start() {
    if (this.timer || !this.enabled()) return;
    this.dir = undefined;
    if (!(await this.gameDir())) { this.lastError = 'Tarkov-Ordner nicht gefunden – unter Einstellungen → Gaming eintragen.'; log.info(this.lastError); return; }
    this.lastError = null;
    const tick = () => this.poll().catch((e) => { this.lastError = e.message; log.debug('poll', e); });
    tick();
    this.timer = setInterval(tick, 5000);
    log.info('Tarkov-Log wird mitgelesen: ' + this.dir);
  }
  stop({ final = true } = {}) { if (this.timer) { clearInterval(this.timer); this.timer = null; if (final) this.poll().catch(() => {}); } }
  status() { return { enabled: this.enabled(), watching: !!this.timer, dir: this.dir || null, error: this.lastError }; }
}

module.exports = { EftLogs, parseNotifications };
