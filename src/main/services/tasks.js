'use strict';
const { id, nowIso, startOfDay, endOfDay, safeJson } = require('../core/util');
const { validate } = require('../core/validate');
const rec = require('../core/recurrence');

const TASK_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    title: { type: 'string', minLength: 1, maxLength: 300 },
    notes: { type: 'string', maxLength: 20000 },
    category: { type: 'string', maxLength: 60 },
    priority: { type: 'string', enum: ['low', 'medium', 'high'] },
    dueAt: { type: 'string', nullable: true, format: 'date-time' },
    allDay: { type: 'boolean' },
    recurrence: { type: 'object', nullable: true, properties: {
      freq: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'yearly'] }, interval: { type: 'integer', minimum: 1, maximum: 365 },
      byDay: { type: 'array', items: { type: 'string' } }, until: { type: 'string' }, count: { type: 'integer' } } },
    reminderMinutes: { type: 'integer', nullable: true, minimum: 0, maximum: 60 * 24 * 14 },
    parentId: { type: 'string', nullable: true, maxLength: 64 },
    starred: { type: 'boolean' },
    source: { type: 'string', maxLength: 30 },
  },
};

/**
 * Task & routine management. Recurring tasks are a single row whose due date
 * advances when an occurrence is completed; each completion is logged.
 */
class Tasks {
  constructor(ctx) { this.db = ctx.db; this.bus = ctx.bus; this.notifications = ctx.notifications; }

  toPublic(r) {
    if (!r) return null;
    const recurrence = safeJson(r.recurrence, null);
    const due = r.due_at ? new Date(r.due_at) : null;
    return {
      id: r.id, title: r.title, notes: r.notes, category: r.category, priority: r.priority,
      dueAt: r.due_at, allDay: !!r.all_day, recurrence, recurrenceLabel: rec.describe(recurrence),
      reminderMinutes: r.reminder_minutes, parentId: r.parent_id, status: r.status, done: r.status === 'done',
      completedAt: r.completed_at, starred: !!r.starred, source: r.source, createdAt: r.created_at, updatedAt: r.updated_at,
      overdue: r.status === 'open' && !!due && (r.all_day ? endOfDay(due) < new Date() : due < new Date()),
      subtaskTotal: r.sub_total ?? undefined, subtaskDone: r.sub_done ?? undefined,
    };
  }

  log(taskId, action, detail = '') {
    this.db.run('INSERT INTO task_history(task_id,action,detail,at) VALUES(?,?,?,?)', taskId, action, String(detail).slice(0, 500), nowIso());
  }

  changed(t) { this.bus.emit('tasks:changed', { id: t?.id }); }

  create(input) {
    const v = validate(TASK_SCHEMA, input);
    if (!v.ok) throw new Error(v.errors.join('; '));
    const d = v.value;
    if (!d.title) throw new Error('Titel fehlt');
    if (d.parentId && !this.db.get('SELECT id FROM tasks WHERE id=?', d.parentId)) throw new Error('Übergeordnete Aufgabe nicht gefunden');
    const now = nowIso();
    const row = {
      id: id('t'), title: d.title.trim(), notes: d.notes || '', category: d.category || 'Allgemein', priority: d.priority || 'medium',
      due_at: d.dueAt ? new Date(d.dueAt).toISOString() : null, all_day: d.allDay ? 1 : 0,
      recurrence: d.recurrence ? JSON.stringify(rec.normalize(d.recurrence)) : null,
      reminder_minutes: d.reminderMinutes ?? null, parent_id: d.parentId || null, starred: d.starred ? 1 : 0, source: d.source || 'user',
    };
    if (row.recurrence && !row.due_at) row.due_at = new Date().toISOString();
    this.db.run(`INSERT INTO tasks(id,title,notes,category,priority,due_at,all_day,recurrence,reminder_minutes,parent_id,starred,source,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?)`, row.id, row.title, row.notes, row.category, row.priority, row.due_at, row.all_day,
    row.recurrence, row.reminder_minutes, row.parent_id, row.starred, row.source, now, now);
    this.log(row.id, 'created', row.source);
    const t = this.get(row.id);
    this.changed(t);
    return t;
  }

  update(taskId, patch) {
    const cur = this.db.get('SELECT * FROM tasks WHERE id=?', taskId);
    if (!cur) throw new Error('Aufgabe nicht gefunden');
    const v = validate(TASK_SCHEMA, patch);
    if (!v.ok) throw new Error(v.errors.join('; '));
    const d = v.value;
    const map = { title: 'title', notes: 'notes', category: 'category', priority: 'priority', allDay: 'all_day', reminderMinutes: 'reminder_minutes', starred: 'starred' };
    const sets = []; const vals = []; const changes = [];
    for (const [k, col] of Object.entries(map)) {
      if (d[k] === undefined) continue;
      sets.push(`${col}=?`); vals.push(typeof d[k] === 'boolean' ? (d[k] ? 1 : 0) : d[k]); changes.push(k);
    }
    if (d.dueAt !== undefined) { sets.push('due_at=?'); vals.push(d.dueAt ? new Date(d.dueAt).toISOString() : null); changes.push('dueAt'); }
    if (d.recurrence !== undefined) { sets.push('recurrence=?'); vals.push(d.recurrence ? JSON.stringify(rec.normalize(d.recurrence)) : null); changes.push('recurrence'); }
    if (!sets.length) return this.get(taskId);
    sets.push('updated_at=?'); vals.push(nowIso());
    this.db.run(`UPDATE tasks SET ${sets.join(',')} WHERE id=?`, ...vals, taskId);
    this.log(taskId, 'updated', changes.join(','));
    const t = this.get(taskId);
    this.changed(t);
    return t;
  }

  /** Complete (or reopen). Recurring tasks advance to their next occurrence. */
  complete(taskId, done = true) {
    const cur = this.db.get('SELECT * FROM tasks WHERE id=?', taskId);
    if (!cur) throw new Error('Aufgabe nicht gefunden');
    const now = nowIso();
    const rule = safeJson(cur.recurrence, null);
    if (done && rule) {
      const anchor = cur.due_at || now;
      // Skip occurrences that are already in the past (no catch-up storm).
      const after = new Date(Math.max(Date.parse(anchor), Date.now() - 60000));
      const nextDue = rec.next(anchor, rule, after);
      this.log(taskId, 'occurrence_done', cur.due_at || '');
      if (nextDue) {
        this.db.run('UPDATE tasks SET due_at=?, updated_at=? WHERE id=?', nextDue, now, taskId);
        // Reset subtasks for the next round.
        this.db.run("UPDATE tasks SET status='open', completed_at=NULL WHERE parent_id=?", taskId);
      } else {
        this.db.run("UPDATE tasks SET status='done', completed_at=?, updated_at=? WHERE id=?", now, now, taskId);
      }
    } else {
      this.db.run('UPDATE tasks SET status=?, completed_at=?, updated_at=? WHERE id=?', done ? 'done' : 'open', done ? now : null, now, taskId);
      this.log(taskId, done ? 'done' : 'reopened');
    }
    const t = this.get(taskId);
    this.changed(t);
    return t;
  }

  remove(taskId) {
    const cur = this.db.get('SELECT * FROM tasks WHERE id=?', taskId);
    if (!cur) throw new Error('Aufgabe nicht gefunden');
    this.db.run('DELETE FROM tasks WHERE id=?', taskId);
    this.log(taskId, 'deleted', cur.title);
    this.changed({ id: taskId });
    return { id: taskId, title: cur.title };
  }

  get(taskId) {
    const r = this.db.get(`SELECT t.*, (SELECT COUNT(*) FROM tasks s WHERE s.parent_id=t.id) sub_total,
      (SELECT COUNT(*) FROM tasks s WHERE s.parent_id=t.id AND s.status='done') sub_done FROM tasks t WHERE id=?`, taskId);
    if (!r) return null;
    const t = this.toPublic(r);
    t.subtasks = this.db.all('SELECT * FROM tasks WHERE parent_id=? ORDER BY sort, created_at', taskId).map((x) => this.toPublic(x));
    t.attachments = this.db.all('SELECT id,kind,name,ref,created_at FROM task_attachments WHERE task_id=? ORDER BY created_at', taskId)
      .map((a) => ({ id: a.id, kind: a.kind, name: a.name, ref: a.ref, createdAt: a.created_at }));
    t.history = this.db.all('SELECT action,detail,at FROM task_history WHERE task_id=? ORDER BY id DESC LIMIT 30', taskId);
    return t;
  }

  /**
   * filter: all | today | important | overdue | done | upcoming | recurring
   */
  list({ filter = 'all', category, q, limit = 300 } = {}) {
    let sql = `SELECT t.*, (SELECT COUNT(*) FROM tasks s WHERE s.parent_id=t.id) sub_total,
      (SELECT COUNT(*) FROM tasks s WHERE s.parent_id=t.id AND s.status='done') sub_done FROM tasks t WHERE t.parent_id IS NULL`;
    const p = [];
    const sod = startOfDay().toISOString(), eod = endOfDay().toISOString(), now = nowIso();
    if (filter === 'done') sql += " AND t.status='done'";
    else {
      sql += " AND t.status='open'";
      if (filter === 'today') { sql += ' AND t.due_at IS NOT NULL AND t.due_at<=?'; p.push(eod); }
      if (filter === 'important') sql += " AND (t.priority='high' OR t.starred=1)";
      if (filter === 'overdue') { sql += ' AND t.due_at IS NOT NULL AND t.due_at<? AND (t.all_day=0 OR t.due_at<?)'; p.push(now, sod); }
      if (filter === 'upcoming') { sql += ' AND t.due_at>? AND t.recurrence IS NULL'; p.push(eod); }
      if (filter === 'recurring') sql += ' AND t.recurrence IS NOT NULL';
    }
    if (category) { sql += ' AND t.category=?'; p.push(category); }
    if (q) { sql += ' AND (t.title LIKE ? OR t.notes LIKE ?)'; p.push(`%${q}%`, `%${q}%`); }
    sql += filter === 'done' ? ' ORDER BY t.completed_at DESC' : " ORDER BY CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END, t.due_at, CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END";
    sql += ' LIMIT ?'; p.push(Math.min(1000, limit));
    return this.db.all(sql, ...p).map((r) => this.toPublic(r));
  }

  /**
   * Heute relevante Aufgaben fürs Dashboard, nach Priorität sortiert:
   * fällig bis heute Abend (inkl. tägliche/wiederkehrende), überfällige, und wichtige ohne Datum.
   */
  focus(limit = 6) {
    const eod = endOfDay();
    const rank = { high: 0, medium: 1, low: 2 };
    const open = this.list({ filter: 'all', limit: 1000 });
    const rel = open.filter((t) => (t.dueAt && new Date(t.dueAt) <= eod) || (!t.dueAt && (t.priority === 'high' || t.starred)));
    rel.sort((a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1) || (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || (b.starred ? 1 : 0) - (a.starred ? 1 : 0)
      || (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity));
    return rel.slice(0, limit);
  }

  /** Grouped view used by the Aufgaben page. */
  board() {
    const eod = endOfDay();
    const in7 = new Date(Date.now() + 7 * 86400000);
    const open = this.list({ filter: 'all', limit: 1000 });
    const rank = { high: 0, medium: 1, low: 2 };
    const byPrio = (a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1) || (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity);
    const today = open.filter((t) => !t.recurrence && t.dueAt && new Date(t.dueAt) <= eod).sort(byPrio);
    const recurring = open.filter((t) => t.recurrence).sort(byPrio);
    const soon = open.filter((t) => !t.recurrence && t.dueAt && new Date(t.dueAt) > eod && new Date(t.dueAt) <= in7);
    const later = open.filter((t) => !t.recurrence && (!t.dueAt || new Date(t.dueAt) > in7));
    const done = this.list({ filter: 'done', limit: 20 });
    return { today, recurring, soon, later, done, counts: this.counts() };
  }

  counts() {
    const now = nowIso(), eod = endOfDay().toISOString(), sod = startOfDay().toISOString();
    const g = (sql, ...p) => this.db.get(sql, ...p).c;
    return {
      open: g("SELECT COUNT(*) c FROM tasks WHERE status='open' AND parent_id IS NULL"),
      today: g("SELECT COUNT(*) c FROM tasks WHERE status='open' AND parent_id IS NULL AND due_at IS NOT NULL AND due_at<=?", eod),
      overdue: g("SELECT COUNT(*) c FROM tasks WHERE status='open' AND parent_id IS NULL AND due_at IS NOT NULL AND due_at<? AND (all_day=0 OR due_at<?)", now, sod),
      important: g("SELECT COUNT(*) c FROM tasks WHERE status='open' AND parent_id IS NULL AND (priority='high' OR starred=1)"),
      doneToday: g("SELECT COUNT(*) c FROM tasks WHERE status='done' AND completed_at>=?", sod),
    };
  }

  categories() {
    return this.db.all("SELECT category, COUNT(*) c FROM tasks WHERE parent_id IS NULL GROUP BY category ORDER BY c DESC").map((r) => r.category);
  }

  addAttachment(taskId, { kind, name, ref }) {
    if (!this.db.get('SELECT id FROM tasks WHERE id=?', taskId)) throw new Error('Aufgabe nicht gefunden');
    if (!['file', 'link'].includes(kind)) throw new Error('Ungültiger Anhang');
    if (kind === 'link' && !/^https?:\/\//i.test(ref)) throw new Error('Nur http(s)-Links erlaubt');
    const aid = id('a');
    this.db.run('INSERT INTO task_attachments(id,task_id,kind,name,ref,created_at) VALUES(?,?,?,?,?,?)', aid, taskId, kind, String(name).slice(0, 200), String(ref).slice(0, 1000), nowIso());
    this.log(taskId, 'attachment', name);
    this.changed({ id: taskId });
    return this.get(taskId);
  }
  removeAttachment(attId) {
    const a = this.db.get('SELECT * FROM task_attachments WHERE id=?', attId);
    if (!a) return null;
    this.db.run('DELETE FROM task_attachments WHERE id=?', attId);
    this.changed({ id: a.task_id });
    return a;
  }

  /** Reminders that are due now (reminder time passed, not yet sent). */
  dueReminders(now = new Date()) {
    const rows = this.db.all("SELECT * FROM tasks WHERE status='open' AND due_at IS NOT NULL AND due_at<=?", new Date(now.getTime() + 14 * 86400000).toISOString());
    const out = [];
    for (const r of rows) {
      const due = new Date(r.due_at);
      const remind = r.reminder_minutes == null ? (r.all_day ? null : 0) : r.reminder_minutes;
      if (remind == null) continue;
      const at = new Date(due.getTime() - remind * 60000);
      if (at > now || now - at > 6 * 3600000) continue; // window of 6h to avoid stale floods after downtime
      const key = `task:${r.id}:${r.due_at}`;
      if (this.db.get('SELECT key FROM reminder_log WHERE key=?', key)) continue;
      out.push({ key, task: this.toPublic(r) });
    }
    return out;
  }
  markReminded(key) { this.db.run('INSERT OR IGNORE INTO reminder_log(key,at) VALUES(?,?)', key, nowIso()); }
}

module.exports = { Tasks, TASK_SCHEMA };
