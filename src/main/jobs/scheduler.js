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
    this.add('housekeeping', 24 * 3600_000, async () => { s.notifications.prune(); s.system.autoBackup(); }, { initialDelayMs: 5 * 60_000 });
    this.add('update-check', 24 * 3600_000, () => s.system.checkUpdates({ silent: true }), { initialDelayMs: 3 * 60_000 });
    this.add('lol-live', 5_000, async () => {
      if (!s.settings.get('gaming').lolLiveCoach) return;
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
