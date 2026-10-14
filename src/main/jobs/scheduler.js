'use strict';
const { dayKey } = require('../core/util');
const log = require('../core/logger').scope('jobs');

/**
 * One cooperative scheduler instead of many background loops.
 * Each job has an interval, a "heavy" flag (skipped while gaming when the
 * user enabled resource reduction) and never runs concurrently with itself.
 */
class Scheduler {
  constructor(s) {
    this.s = s; this.jobs = []; this.timer = null; this.running = new Set(); this.lastRun = {};
  }

  add(name, everyMs, fn, { heavy = false, initialDelayMs = 0 } = {}) {
    this.jobs.push({ name, everyMs, fn, heavy, next: Date.now() + initialDelayMs });
  }

  gamingReduced() {
    return this.s.settings.get('gaming').reduceWhileGaming && this.s.gaming.context.state().gaming;
  }

  start() {
    const s = this.s;
    this.add('reminders', 30_000, async () => {
      for (const r of s.tasks.dueReminders()) {
        s.tasks.markReminded(r.key);
        const nick = s.settings.get('nickname') || 'Chef';
        s.notifications.push({ category: 'tasks', origin: 'task', dedupeKey: 'rem:' + r.key, title: r.task.title, body: `${nick}, Erinnerung: ${r.task.title}${r.task.dueAt ? ' – fällig ' + new Date(r.task.dueAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : ''}` });
      }
      s.gaming.checkTimers();
      s.confirmations.gc();
    });
    this.add('calendar-sync', 60_000, async () => {
      const mins = s.settings.get('google').syncIntervalMinutes || 15;
      if (!s.calendar.connected() || !s.settings.get('google').calendarSync) return;
      if (Date.now() - (this.lastRun['calendar-sync:real'] || 0) < mins * 60_000) return;
      this.lastRun['calendar-sync:real'] = Date.now();
      await s.calendar.sync();
    }, { initialDelayMs: 8_000 });
    // Kalender-Abos (z. B. Campus-Dual-Stundenplan): alle 15 Minuten, ersetzt Einträge komplett → entfernte Termine verschwinden
    this.add('calendar-feeds', 15 * 60_000, async () => { if (s.db.get('SELECT COUNT(*) c FROM calendar_feeds').c) await s.feeds.refreshAll(); }, { initialDelayMs: 20_000 });
    // Klausurmodus: verpasste Lerneinheiten erkennen, vorbei gegangene Klausuren archivieren
    this.add('exam-missed', 3600_000, async () => s.exams.checkMissed(), { initialDelayMs: 2 * 60_000 });
    // Prüfungen aus Campus Dual (Stundenplan-Abo + Prüfungsanmeldung) → Klausurmodus; alle 6 h
    this.add('campusdual-exams', 6 * 3600_000, async () => { if (s.campusExams.enabled()) await s.campusExams.sync(); }, { heavy: true, initialDelayMs: 6 * 60_000 });
    s.bus.on('feeds:changed', () => { clearTimeout(this._examT); this._examT = setTimeout(() => !s.stopped && s.campusExams.sync({ withService: false }).catch(() => {}), 5000); });
    // Gemini-Budget: Hochrechnung prüfen, bei 80 % warnen, bei 95 % Sparstufe
    this.add('cost-guard', 20 * 60_000, async () => { if (s.gemini.hasKey()) s.costGuard.check(); }, { initialDelayMs: 60_000 });
    // Campus Dual: neue Prüfungsergebnisse? (nur wenn angemeldet oder Zugangsdaten gespeichert; Standard alle 3 h)
    this.add('campusdual-results', 15 * 60_000, async () => {
      const cfg = s.settings.get('campusDualResults') || {};
      if (cfg.enabled === false || !(await s.campusResults.available())) return;
      const last = Date.parse(s.campusResults.status().lastCheck || 0) || 0;
      if (Date.now() - last < (cfg.intervalHours || 3) * 3600_000) return;
      await s.campusResults.check({ notify: true });
    }, { heavy: true, initialDelayMs: 4 * 60_000 });
    // Steam: neue Spiele (≥ Mindest-Spielzeit) als Game-Seite anlegen, Updates melden – 1× pro Stunde, nicht beim Zocken
    // Google-Drive-Backup (Standard 1× täglich, Ordner „coding“) – prüft stündlich, ob fällig
    this.add('drive-backup', 3600_000, async () => {
      if (!s.settings.get('backupDrive')?.enabled || !s.driveBackup.granted()) return;
      try { await s.driveBackup.run(); } catch (e) {
        s.notifications.push({ category: 'system', origin: 'system', dedupeKey: 'drive-backup-fail:' + new Date().toISOString().slice(0, 10), title: 'Drive-Backup fehlgeschlagen', body: e.message });
        throw e;
      }
    }, { heavy: true, initialDelayMs: 3 * 60_000 });
    this.add('steam', 3600_000, async () => {
      if (process.platform !== 'win32' || !(await s.gaming.steam.root())) return;
      const g = s.settings.get('gaming');
      if (g.steamAutoImport !== false) await s.gaming.steam.importProfiles({ minMinutes: g.steamMinMinutes ?? 1 });
      const ups = await s.gaming.steam.updates();
      const pending = ups.filter((u) => !u.updating);
      if (pending.length) s.notifications.push({ category: 'gaming', origin: 'client', dedupeKey: 'steam-updates:' + new Date().toISOString().slice(0, 10) + ':' + pending.map((u) => u.appid).join(','),
        title: `${pending.length} Steam-Spiel${pending.length > 1 ? 'e brauchen' : ' braucht'} ein Update`, body: pending.slice(0, 5).map((u) => u.name).join(', ') + ' – unter Gaming → Steam starten.' });
    }, { heavy: true, initialDelayMs: 50_000 });
    this.add('drive-sync', 20 * 60_000, async () => { if (s.drive.active() && s.drive.granted() && s.settings.get('study').enabled) await s.drive.sync(); }, { heavy: true, initialDelayMs: 40_000 });
    this.add('study-scan', 6 * 3600_000, () => s.study.scan(), { heavy: true, initialDelayMs: 25_000 });
    this.add('embeddings', 5 * 60_000, () => s.vectors.backfill({ maxItems: 150 }), { heavy: true, initialDelayMs: 60_000 });
    this.add('auto-vision', 10 * 60_000, () => s.study.autoVision(4), { heavy: true, initialDelayMs: 120_000 });
    this.add('brain-maintenance', 24 * 3600_000, () => s.brain.maintain(), { heavy: true, initialDelayMs: 10 * 60_000 });
    this.add('web-refresh', 24 * 3600_000, async () => {
      const changed = await s.web.refreshSaved();
      for (const c of changed) s.notifications.push({ category: 'system', origin: 'web', title: 'Quelle aktualisiert', body: `${c.title} (Version ${c.version})`, dedupeKey: `web:${c.id}:${c.version}` });
    }, { heavy: true, initialDelayMs: 30 * 60_000 });
    this.add('daily', 60_000, async () => {
      const p = s.settings.get('proactive');
      const today = dayKey();
      const now = new Date();
      const [h, m] = String(p.briefingTime || '08:00').split(':').map(Number);
      const due = now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
      if (!due) return;
      if (p.dailyBriefing && s.system.meta('briefing:' + today) == null) {
        s.system.setMeta('briefing:' + today, '1');
        const b = s.briefing();
        s.notifications.push({ category: 'briefing', origin: 'briefing', title: 'Dein Tagesbriefing', body: b.text, dedupeKey: 'brief:' + today });
      }
      if (p.overdueReminders && s.system.meta('overdue:' + today) == null) {
        s.system.setMeta('overdue:' + today, '1');
        const n = s.tasks.counts().overdue;
        if (n) s.notifications.push({ category: 'tasks', origin: 'task', title: `${n} überfällige Aufgabe${n > 1 ? 'n' : ''}`, body: 'Öffne „Aufgaben → Überfällig“, um sie neu zu planen.', dedupeKey: 'overdue:' + today });
      }
    });
    this.add('housekeeping', 24 * 3600_000, async () => { s.notifications.prune(); s.system.pruneMeta(); s.system.autoBackup(); }, { initialDelayMs: 5 * 60_000 });
    // Alle 6 h nach Updates schauen – nie während eines Spiels (heavy), installiert wird nur auf Klick.
    this.add('update-check', 6 * 3600_000, async () => { if (s.settings.get('updateCheck') !== false) await s.updater.check({ silent: true }); }, { heavy: true, initialDelayMs: 2 * 60_000 });
    this.add('lol-sync', 10 * 60_000, async () => {
      const L = s.gaming.league;
      if (!(await L.lcuCreds())) return; // Client nicht offen → nichts tun
      await L.syncFromClient();
      await L.deepSync({ limit: 20 }).catch(() => {}); // Timelines für die Fehleranalyse
    }, { heavy: true, initialDelayMs: 90_000 });
    // Client gerade gestartet → Matches gleich abgleichen (Spiele von unterwegs/anderen PCs)
    s.bus.on('game:client', ({ league }) => { if (league) setTimeout(() => this.runNow('lol-sync'), 25_000); });
    // Täglicher Systemcheck: meldet Probleme (z. B. Google-API nicht aktiviert, Gemini ohne Guthaben) mit Lösung
    this.add('diagnostics', 24 * 3600_000, async () => {
      const list = await require('../services/diagnostics').runDiagnostics(s);
      const bad = list.filter((x) => x.status === 'error');
      s.system.setMeta('diagnostics:last', JSON.stringify({ at: new Date().toISOString(), list }));
      if (bad.length) s.notifications.push({ category: 'system', origin: 'system', dedupeKey: 'diag:' + new Date().toISOString().slice(0, 10) + ':' + bad.map((x) => x.id).join(','), title: `Systemcheck: ${bad.length} Problem${bad.length > 1 ? 'e' : ''}`, body: bad.map((x) => `${x.name}: ${x.detail}`).join(' · ').slice(0, 400) + ' – Einstellungen → Systemcheck' });
    }, { heavy: true, initialDelayMs: 3 * 60_000 });
    this.add('tarkovtracker', 30 * 60_000, async () => {
      if (!s.gaming.tracker.configured() || s.settings.get('gaming').tarkovTrackerSync === false) return;
      await s.gaming.tracker.sync();
    }, { initialDelayMs: 45_000 });
    // Nach einer Tarkov-Session sofort abgleichen
    s.bus.on('game:running', ({ stopped = [] }) => { if (stopped.includes('eft')) setTimeout(() => this.runNow('tarkovtracker'), 30_000); });
    this.add('lol-live', 5_000, async () => {
      const g = s.settings.get('gaming');
      if (!g.lolLiveCoach && g.lolObjectives === false) return;
      const st = s.gaming.context.state();
      if (!st.running.some((p) => p.id === 'league')) return;
      const live = await s.gaming.league.live();
      s.bus.emit('lol:live', live);
    });
    this.timer = setInterval(() => this.tick(), 5_000);
    this.tick();
  }

  async tick() {
    const now = Date.now();
    const reduced = this.gamingReduced();
    for (const j of this.jobs) {
      if (j.next > now || this.running.has(j.name)) continue;
      if (j.heavy && reduced) { j.next = now + 60_000; continue; }
      j.next = now + j.everyMs;
      this.running.add(j.name);
      Promise.resolve().then(j.fn).catch((e) => log.warn(`Job ${j.name} fehlgeschlagen`, e)).finally(() => { this.running.delete(j.name); this.lastRun[j.name] = Date.now(); });
    }
  }

  runNow(name) { const j = this.jobs.find((x) => x.name === name); if (j) j.next = 0; this.tick(); }
  stop() { clearInterval(this.timer); }
}

module.exports = { Scheduler };
