'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const log = require('../../core/logger').scope('eftlogs');

// Tarkov-Karten-IDs aus dem Spiel-Log → tarkov.dev-Namen
const LOCATION = { bigmap: 'customs', factory4_day: 'factory', factory4_night: 'factory', interchange: 'interchange', laboratory: 'the-lab', lighthouse: 'lighthouse', rezervbase: 'reserve', shoreline: 'shoreline', tarkovstreets: 'streets-of-tarkov', woods: 'woods', sandbox: 'ground-zero', sandbox_high: 'ground-zero', labyrinth: 'the-labyrinth', terminal: 'terminal' };
/** Karte des aktuellen Raids aus dem Application-Log („… Location: bigmap, …“). */
function parseLocation(text) {
  let last = null;
  for (const m of String(text).matchAll(/Location:\s*([A-Za-z0-9_]+)/g)) last = m[1];
  return last ? { id: last, map: LOCATION[last.toLowerCase()] || null } : null;
}
/**
 * Position aus dem Dateinamen eines Tarkov-Screenshots, z. B.
 * „2024-08-28[21-07]_-213.31, 1.24, -47.97_0.00119, -0.95218, 0.00379, 0.30552_14.53 (0).png“
 * → x, y, z (Spielkoordinaten) und Blickrichtung (Vorwärtsvektor fx/fz aus der Rotation).
 */
function parseScreenshotName(name) {
  const n = '(-?\\d+(?:\\.\\d+)?)';
  const m = String(name).match(new RegExp(`_${n}, ${n}, ${n}_${n}, ${n}, ${n}, ${n}_`));
  if (!m) return null;
  const [x, y, z, qx, qy, qz, qw] = m.slice(1, 8).map(Number);
  if (![x, y, z, qx, qy, qz, qw].every(Number.isFinite)) return null;
  const fx = 2 * (qx * qz + qw * qy); const fz = 1 - 2 * (qx * qx + qy * qy);
  const len = Math.hypot(fx, fz) || 1;
  return { x, y, z, fx: fx / len, fz: fz / len };
}


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
  constructor(s) { this.s = s; this.timer = null; this.offsets = new Map(); this.dir = undefined; this.lastError = null; this.location = null; this.shotsSeen = null; this.pendingMove = new Map(); }
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
    try { return fs.readdirSync(newest).filter((f) => /(notifications|application).*\.log$/i.test(f)).map((f) => path.join(newest, f)); } catch { return []; }
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
        if (/application/i.test(path.basename(f))) {
          const loc = parseLocation(text);
          if (loc && loc.id !== this.location?.id) { this.location = { ...loc, at: new Date().toISOString() }; if (loc.map) this.s.gaming.setLastMap('eft', loc.map); log.info('Raid-Karte: ' + loc.id); }
        } else events.push(...parseNotifications(text));
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

  /** Tarkov-Screenshot-Ordner (Dokumente\Escape from Tarkov\Screenshots, auch mit OneDrive). */
  shotsDir() {
    const home = os.homedir();
    const cands = [this.cfg().eftScreenshotsDir, ...['Documents', 'Dokumente', 'OneDrive\\Documents', 'OneDrive\\Dokumente'].map((d) => path.join(home, d, 'Escape from Tarkov', 'Screenshots'))];
    return cands.filter(Boolean).find((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } }) || null;
  }

  /** Neue Screenshots → Position auf der Karte (nur Dateinamen, das Bild wird nicht gelesen). */
  pollShots() {
    const dir = this.shotsDir();
    if (!dir) return null;
    let files = []; try { files = fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|bmp)$/i.test(f)); } catch { return null; }
    if (!this.shotsSeen) { this.shotsSeen = new Set(files); return null; } // vorhandene ignorieren
    let pos = null;
    for (const f of files) {
      if (this.shotsSeen.has(f)) continue;
      this.shotsSeen.add(f);
      const p = parseScreenshotName(f);
      if (p) { pos = p; this.pendingMove.set(f, { size: -1, since: Date.now() }); }
    }
    this.moveShots(dir);
    if (!pos) return null;
    const map = this.location?.map || this.s.gaming.lastMap('eft')?.map || null;
    return this.s.gaming.setEftPosition({ ...pos, map });
  }

  /** Eigener Ordner für Positions-Screenshots (Unterordner „JARVIS Positionen“). */
  posDir(dir = this.shotsDir()) { return dir ? path.join(dir, 'JARVIS Positionen') : null; }

  /**
   * Gelesene Positions-Screenshots in den eigenen Ordner verschieben – erst, wenn Tarkov die Datei
   * fertig geschrieben hat (Größe zweimal gleich, mind. 1,5 s alt). Nur Dateien mit Positionsangabe im Namen.
   */
  moveShots(dir) {
    if (this.cfg().eftMoveShots === false || !this.pendingMove.size) return 0;
    const dest = this.posDir(dir);
    let moved = 0;
    for (const [f, st] of this.pendingMove) {
      const src = path.join(dir, f);
      let size; try { size = fs.statSync(src).size; } catch { this.pendingMove.delete(f); continue; }
      if (size !== st.size || Date.now() - st.since < 1500) { st.size = size; continue; }
      try { fs.mkdirSync(dest, { recursive: true }); fs.renameSync(src, path.join(dest, f)); moved++; this.pendingMove.delete(f); } catch (e) {
        if (Date.now() - st.since > 60000) this.pendingMove.delete(f); // gesperrt o. Ä. → aufgeben
        log.debug('verschieben', e);
      }
    }
    return moved;
  }

  /** Positions-Screenshots älter als N Tage löschen (nur im eigenen Ordner; 0 = behalten). */
  cleanupShots(now = Date.now()) {
    const days = Number(this.cfg().eftShotKeepDays ?? 7);
    const dest = this.posDir();
    if (!dest || !(days > 0)) return 0;
    let n = 0;
    let files = []; try { files = fs.readdirSync(dest); } catch { return 0; }
    for (const f of files) {
      if (!/\.(png|jpe?g|bmp)$/i.test(f) || !parseScreenshotName(f)) continue;
      const fp = path.join(dest, f);
      try { if (now - fs.statSync(fp).mtimeMs > days * 86400000) { fs.rmSync(fp, { force: true }); n++; } } catch { /* ignore */ }
    }
    if (n) log.info(`${n} alte Positions-Screenshots gelöscht`);
    return n;
  }

  /** Beim Spielstart: Ordner suchen, ab jetzt mitlesen (auch was seit Spielstart schon im Log steht). */
  async start() {
    if (this.timer || !this.enabled()) return;
    this.dir = undefined;
    if (!(await this.gameDir())) { this.lastError = 'Tarkov-Ordner nicht gefunden – unter Einstellungen → Gaming eintragen.'; log.info(this.lastError); return; }
    this.lastError = null;
    this.shotsSeen = null; this.location = null;
    let n = 0;
    // Screenshots alle 2 s (Position soll schnell erscheinen), Logs alle 6 s
    const tick = () => {
      try { this.pollShots(); } catch (e) { log.debug('shots', e); }
      if (n % 900 === 0) try { this.cleanupShots(); } catch { /* ignore */ }
      if (n++ % 3 === 0) this.poll().catch((e) => { this.lastError = e.message; log.debug('poll', e); });
    };
    tick();
    this.timer = setInterval(tick, 2000);
    log.info('Tarkov-Log wird mitgelesen: ' + this.dir);
  }
  stop({ final = true } = {}) {
    if (!this.timer) return;
    clearInterval(this.timer); this.timer = null;
    if (final) {
      this.poll().catch(() => {});
      // restliche Screenshots noch verschieben, dann alte aufräumen
      setTimeout(() => { try { const d = this.shotsDir(); if (d) { for (const st of this.pendingMove.values()) st.since = 0; this.moveShots(d); this.moveShots(d); } this.cleanupShots(); } catch { /* ignore */ } }, 2000).unref?.();
    }
  }
  status() { return { enabled: this.enabled(), watching: !!this.timer, dir: this.dir || null, error: this.lastError, screenshots: this.shotsDir(), location: this.location }; }
}

module.exports = { EftLogs, parseNotifications, parseLocation, parseScreenshotName, LOCATION };
