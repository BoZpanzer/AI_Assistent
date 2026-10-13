'use strict';
const { id, nowIso } = require('../core/util');

/**
 * In-app notification center + optional OS toast.
 * `origin` makes the source explicit: 'timer' (own estimate), 'api' (official
 * interface), 'web' (verified external info), 'note', 'system', 'calendar' …
 */
const ORIGIN_LABEL = {
  timer: 'Eigener Timer (Zeitabschätzung)',
  api: 'Offizielle Schnittstelle',
  web: 'Externe Quelle',
  note: 'Eigene Notiz',
  system: 'System',
  calendar: 'Kalender',
  task: 'Aufgaben',
  study: 'Studium',
  briefing: 'Tagesbriefing',
  client: 'Spiel-Client (lokal)',
  exam: 'Klausurplan',
  github: 'GitHub',
  telegram: 'Telegram',
  tracker: 'TarkovTracker',
};

class Notifications {
  constructor(ctx) {
    this.db = ctx.db; this.bus = ctx.bus; this.settings = ctx.settings;
    this.toast = ctx.platform?.toast || null; // (title, body) => void
  }

  inQuietHours(d = new Date()) {
    const q = this.settings.get('quietHours');
    if (!q?.enabled) return false;
    const mins = d.getHours() * 60 + d.getMinutes();
    const p = (s) => { const [h, m] = String(s).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
    const a = p(q.from), b = p(q.to);
    return a <= b ? mins >= a && mins < b : mins >= a || mins < b;
  }

  /**
   * @param {{category:string,title:string,body?:string,origin?:string,game?:string,dedupeKey?:string,toast?:boolean}} n
   */
  push(n) {
    const item = {
      id: id('n'), category: n.category || 'system', title: String(n.title).slice(0, 200), body: String(n.body || '').slice(0, 1000),
      origin: n.origin || 'system', game: n.game || null, dedupe_key: n.dedupeKey || null, created_at: nowIso(), read: 0,
    };
    try {
      this.db.run('INSERT INTO notifications(id,category,title,body,origin,game,dedupe_key,created_at,read) VALUES(?,?,?,?,?,?,?,?,0)',
        item.id, item.category, item.title, item.body, item.origin, item.game, item.dedupe_key, item.created_at);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return null; // already delivered
      throw e;
    }
    const pub = this.toPublic(item);
    this.bus.emit('notification', pub);
    const cats = this.settings.get('notifyCategories') || {};
    if (n.toast !== false && this.settings.get('notifications') && cats[item.category] !== false && !this.inQuietHours() && this.toast) {
      try { this.toast(item.title, item.body); } catch { /* ignore */ }
    }
    return pub;
  }

  toPublic(r) {
    return { id: r.id, category: r.category, title: r.title, body: r.body, origin: r.origin, originLabel: ORIGIN_LABEL[r.origin] || r.origin, game: r.game, createdAt: r.created_at, read: !!r.read };
  }

  list({ limit = 50, unreadOnly = false, category, excludeGame } = {}) {
    let sql = 'SELECT * FROM notifications WHERE 1=1';
    const p = [];
    if (unreadOnly) sql += ' AND read=0';
    if (category) { sql += ' AND category=?'; p.push(category); }
    if (excludeGame) { sql += ' AND (game IS NULL OR game<>?)'; p.push(excludeGame); }
    sql += ' ORDER BY created_at DESC LIMIT ?'; p.push(Math.min(200, limit));
    return this.db.all(sql, ...p).map((r) => this.toPublic(r));
  }
  markRead(ids) {
    if (ids === 'all') this.db.run('UPDATE notifications SET read=1');
    else for (const i of ids || []) this.db.run('UPDATE notifications SET read=1 WHERE id=?', i);
    this.bus.emit('notifications:changed', {});
  }
  remove(nid) { this.db.run('DELETE FROM notifications WHERE id=?', nid); this.bus.emit('notifications:changed', {}); }
  unreadCount() { return this.db.get('SELECT COUNT(*) c FROM notifications WHERE read=0').c; }
  prune(days = 60) { this.db.run("DELETE FROM notifications WHERE read=1 AND created_at < ?", new Date(Date.now() - days * 86400000).toISOString()); }
}

module.exports = { Notifications, ORIGIN_LABEL };
