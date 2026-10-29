'use strict';
const { id, nowIso, startOfDay, endOfDay } = require('../core/util');
const { validate } = require('../core/validate');
const rec = require('../core/recurrence');
const log = require('../core/logger').scope('calendar');

const EVENT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    title: { type: 'string', minLength: 1, maxLength: 300 },
    start: { type: 'string', format: 'date-time' },
    end: { type: 'string', format: 'date-time' },
    allDay: { type: 'boolean' },
    location: { type: 'string', maxLength: 500 },
    description: { type: 'string', maxLength: 8000 },
    calendarId: { type: 'string', maxLength: 300 },
    color: { type: 'string', enum: ['auto', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'] },
    recurrence: { type: 'object', nullable: true, properties: {
      freq: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'yearly'] }, interval: { type: 'integer' },
      byDay: { type: 'array', items: { type: 'string' } }, until: { type: 'string' }, count: { type: 'integer' } } },
  },
};

const LOCAL_CAL = 'local';

/** Google-Terminfarben (colorId → Name/Hex), wie in Google Kalender. */
const COLORS = {
  1: ['Lavendel', '#7986cb'], 2: ['Salbei', '#33b679'], 3: ['Traube', '#8e24aa'], 4: ['Flamingo', '#e67c73'],
  5: ['Banane', '#f6bf26'], 6: ['Mandarine', '#f4511e'], 7: ['Pfau', '#039be5'], 8: ['Graphit', '#616161'],
  9: ['Heidelbeere', '#3f51b5'], 10: ['Basilikum', '#0b8043'], 11: ['Tomate', '#d50000'],
};
/** Automatische Kategorien (Farbe + Symbol), wenn keine eigene Farbe gesetzt ist. */
const CATEGORIES = [
  { id: 'birthday', label: 'Geburtstag', color: '#f472b6', icon: '🎂', test: (t, cal, type) => type === 'birthday' || /geburtstag|birthday|\bgeb\.?\b|b-?day/i.test(t) || /geburtstag|birthday/i.test(cal) },
  { id: 'holiday', label: 'Feiertag', color: '#34d399', icon: '🎉', test: (t, cal) => /feiertag|holiday/i.test(cal) || /^(neujahr|karfreitag|ostermontag|pfingstmontag|tag der deutschen einheit|reformationstag|heiligabend|silvester|1\. weihnachtstag|2\. weihnachtstag|christi himmelfahrt|fronleichnam|buß- und bettag)/i.test(t) },
  { id: 'exam', label: 'Prüfung', color: '#f87171', icon: '📝', test: (t) => /klausur|prüfung|pruefung|exam|testat/i.test(t) },
  { id: 'deadline', label: 'Abgabe', color: '#fb7185', icon: '⏰', test: (t) => /abgabe|deadline|frist/i.test(t) },
  { id: 'study', label: 'Lernen', color: '#a78bfa', icon: '📚', test: (t) => /^📚|lernen|lerneinheit|wiederholung/i.test(t) },
  { id: 'vacation', label: 'Urlaub', color: '#fbbf24', icon: '🌴', test: (t) => /urlaub|ferien|vacation|reise/i.test(t) },
  { id: 'health', label: 'Gesundheit', color: '#2dd4bf', icon: '🩺', test: (t) => /arzt|zahnarzt|termin beim|physio|impfung/i.test(t) },
  { id: 'sport', label: 'Sport', color: '#fb923c', icon: '🏃', test: (t) => /training|gym|fitness|sport|laufen|fußball|fussball/i.test(t) },
];
function categorize(title, calName, type) {
  for (const c of CATEGORIES) if (c.test(String(title || ''), String(calName || ''), type)) return c;
  return null;
}
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin';

/**
 * Calendar service — single implementation used by chat, voice, UI and jobs.
 * Google events are cached locally (window sync) so reads are instant and
 * work offline. Writes go to Google immediately; on network failure they are
 * queued (pending_*) and pushed on the next sync. Local-only events are kept
 * in the pseudo calendar "local" and never leave the machine.
 */
class Calendar {
  constructor(ctx) {
    this.db = ctx.db; this.bus = ctx.bus; this.google = ctx.google; this.settings = ctx.settings;
    this.syncing = false;
    this.lastSync = null; this.lastError = null;
    this.ensureLocal();
    // Änderungen an Terminen/Aufgaben → kurz danach nach Google übertragen (nicht während eines Abgleichs)
    const soon = () => { if (this.syncing) this._exportPending = true; else this.exportSoon(); };
    this.bus?.on?.('tasks:changed', soon);
    this.bus?.on?.('calendar:changed', soon);
  }

  /** Google-Kalender, die JARVIS für die Übertragung je Art angelegt hat. */
  exportTargets() { return Object.values(this.settings.get('google').exportCalendars || {}).filter(Boolean); }

  exportSoon(ms = 3000) {
    const g = this.settings.get('google');
    if (!g.exportLocalToGoogle || !this.connected()) return;
    clearTimeout(this._export);
    this._export = setTimeout(() => this.sync().catch(() => {}), ms);
    this._export.unref?.();
  }

  ensureLocal() {
    this.db.run("INSERT OR IGNORE INTO calendars(id,name,color,is_primary,selected,writable) VALUES('local','JARVIS (nur lokal)','#22d3ee',0,1,1)");
  }

  connected() { return this.google?.isConnected() || false; }

  defaultCalendarId() {
    if (!this.connected()) return LOCAL_CAL;
    const s = this.settings.get('google').defaultCalendarId;
    if (s && this.db.get('SELECT id FROM calendars WHERE id=?', s)) return s;
    const p = this.db.get("SELECT id FROM calendars WHERE is_primary=1");
    return p ? p.id : LOCAL_CAL;
  }

  toPublic(r) {
    const cal = this.db.get('SELECT name,color,writable FROM calendars WHERE id=?', r.calendar_id);
    const cat = categorize(r.title, cal?.name, r.event_type);
    const own = r.color && COLORS[r.color] ? COLORS[r.color][1] : null;
    return {
      id: r.id, calendarId: r.calendar_id, calendarName: cal?.name || r.calendar_id, calendarColor: cal?.color || '#22d3ee',
      color: own || cat?.color || cal?.color || '#22d3ee', colorId: r.color || 'auto', category: cat?.id || null, categoryLabel: cat?.label || null, icon: cat?.icon || null, eventType: r.event_type || null,
      title: r.title, description: r.description, location: r.location, start: r.start_at, end: r.end_at, allDay: !!r.all_day,
      recurrence: r.rrule ? rec.fromRRule(r.rrule) : null, recurring: !!(r.rrule || r.recurring_event_id),
      source: r.calendar_id === LOCAL_CAL ? 'local' : String(r.calendar_id).startsWith('feed:') ? 'feed' : 'google', syncState: r.sync_state, readOnly: String(r.calendar_id).startsWith('feed:') || (cal ? !cal.writable : false),
      conflict: r.sync_state === 'conflict' ? JSON.parse(r.conflict_data || 'null') : null,
    };
  }

  /** Events overlapping [from, to). Local recurring events are expanded. */
  list(from, to, { calendars } = {}) {
    const f = new Date(from), t = new Date(to);
    const rows = this.db.all(`SELECT e.* FROM events e JOIN calendars c ON c.id=e.calendar_id
      WHERE c.selected=1 AND e.sync_state<>'pending_delete' AND e.status<>'cancelled'
      AND ((e.rrule IS NULL AND e.start_at < ? AND e.end_at > ?) OR (e.rrule IS NOT NULL AND e.calendar_id='local'))
      ORDER BY e.start_at`, t.toISOString(), f.toISOString());
    const out = [];
    for (const r of rows) {
      if (calendars && !calendars.includes(r.calendar_id)) continue;
      if (r.rrule && r.calendar_id === LOCAL_CAL) {
        const dur = Date.parse(r.end_at) - Date.parse(r.start_at);
        for (const s of rec.between(r.start_at, rec.fromRRule(r.rrule), new Date(f.getTime() - dur), t)) {
          const ev = this.toPublic(r);
          ev.start = s; ev.end = new Date(Date.parse(s) + dur).toISOString(); ev.instanceOf = r.id;
          out.push(ev);
        }
      } else out.push(this.toPublic(r));
    }
    return out.sort((a, b) => a.start.localeCompare(b.start));
  }

  today() { return this.list(startOfDay(), endOfDay()); }
  get(eventId) { const r = this.db.get('SELECT * FROM events WHERE id=?', eventId); return r ? this.toPublic(r) : null; }
  calendars() {
    const own = new Set(this.exportTargets());
    return this.db.all('SELECT * FROM calendars ORDER BY id<>\'local\', is_primary DESC, name').filter((c) => !own.has(c.id)).map((c) => ({
      id: c.id, name: c.name, color: c.color, primary: !!c.is_primary, selected: !!c.selected, writable: !!c.writable, syncedAt: c.synced_at,
    }));
  }
  selectCalendar(calId, selected) {
    this.db.run('UPDATE calendars SET selected=? WHERE id=?', selected ? 1 : 0, calId);
    this.bus.emit('calendar:changed', {});
  }

  normalizeInput(input, partial = false) {
    const v = validate(EVENT_SCHEMA, input);
    if (!v.ok) throw new Error(v.errors.join('; '));
    const d = v.value;
    if (!partial) {
      if (!d.title) throw new Error('Titel fehlt');
      if (!d.start) throw new Error('Startzeit fehlt');
    }
    if (d.allDay && d.start) {
      // Ganztägig: auf lokale Mitternacht runden, Ende exklusiv (Tag danach 00:00)
      const s0 = new Date(d.start); s0.setHours(0, 0, 0, 0);
      let e0 = d.end ? new Date(d.end) : new Date(s0);
      if (e0.getHours() || e0.getMinutes() || e0.getSeconds() || e0 <= s0) { e0.setHours(0, 0, 0, 0); e0.setDate(e0.getDate() + 1); }
      if (e0 <= s0) { e0 = new Date(s0); e0.setDate(e0.getDate() + 1); }
      d.start = s0.toISOString(); d.end = e0.toISOString();
    }
    if (d.start && !d.end) d.end = new Date(Date.parse(d.start) + 3600000).toISOString();
    if (d.start && d.end && Date.parse(d.end) <= Date.parse(d.start)) throw new Error('Ende liegt vor dem Beginn');
    return d;
  }

  toGoogle(d) {
    const ev = {};
    if (d.title !== undefined) ev.summary = d.title;
    if (d.description !== undefined) ev.description = d.description;
    if (d.location !== undefined) ev.location = d.location;
    if (d.start) {
      if (d.allDay) {
        ev.start = { date: localDate(d.start) };
        ev.end = { date: localDate(d.end) === localDate(d.start) ? localDate((() => { const z = new Date(d.start); return new Date(z.getFullYear(), z.getMonth(), z.getDate() + 1); })()) : localDate(d.end) };
      } else {
        ev.start = { dateTime: new Date(d.start).toISOString(), timeZone: tz() };
        ev.end = { dateTime: new Date(d.end).toISOString(), timeZone: tz() };
      }
    }
    if (d.recurrence !== undefined) ev.recurrence = d.recurrence ? [rec.toRRule(d.recurrence)] : [];
    if (d.color !== undefined) ev.colorId = d.color && d.color !== 'auto' ? String(d.color) : null;
    ev.extendedProperties = { private: { createdBy: 'JARVIS' } };
    return ev;
  }

  upsertFromGoogle(calId, g) {
    const start = g.start?.dateTime || (g.start?.date ? new Date(g.start.date + 'T00:00:00').toISOString() : null);
    const end = g.end?.dateTime || (g.end?.date ? new Date(g.end.date + 'T00:00:00').toISOString() : start);
    if (!start) return;
    const existing = this.db.get('SELECT * FROM events WHERE calendar_id=? AND google_id=?', calId, g.id);
    if (existing && existing.sync_state === 'conflict') return; // user decides
    if (existing && ['pending_update', 'pending_delete'].includes(existing.sync_state)) {
      if (existing.remote_updated && g.updated && g.updated > existing.remote_updated) {
        // Changed on both sides → conflict, keep local edit, store remote version for the user to decide.
        this.db.run("UPDATE events SET sync_state='conflict', conflict_data=? WHERE id=?",
          JSON.stringify({ remoteTitle: g.summary || '', remoteStart: start, remoteEnd: end, remoteUpdated: g.updated }), existing.id);
      }
      return;
    }
    const vals = [g.summary || '(ohne Titel)', g.description || '', g.location || '', new Date(start).toISOString(), new Date(end).toISOString(),
      g.start?.date ? 1 : 0, g.start?.timeZone || null, (g.recurrence || []).find((x) => x.startsWith('RRULE')) || null, g.recurringEventId || null,
      g.status || 'confirmed', g.etag || null, g.updated || null, nowIso(), g.colorId || null, g.eventType && g.eventType !== 'default' ? g.eventType : null];
    if (existing) {
      this.db.run(`UPDATE events SET title=?,description=?,location=?,start_at=?,end_at=?,all_day=?,time_zone=?,rrule=?,recurring_event_id=?,status=?,etag=?,remote_updated=?,local_updated=?,color=?,event_type=?,sync_state='synced',conflict_data=NULL WHERE id=?`, ...vals, existing.id);
    } else {
      this.db.run(`INSERT INTO events(title,description,location,start_at,end_at,all_day,time_zone,rrule,recurring_event_id,status,etag,remote_updated,local_updated,color,event_type,id,calendar_id,google_id,sync_state)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'synced')`, ...vals, id('e'), calId, g.id);
    }
  }

  /** Creates an event (Google if connected, else local). */
  async create(input) {
    this.ensureLocal();
    const d = this.normalizeInput(input);
    const privacy = require('../core/privacy');
    let calId = d.calendarId || LOCAL_CAL;
    if (calId !== LOCAL_CAL) {
      const own = new Set(this.exportTargets());
      if (privacy.isPrivate() || ['primary', 'default', 'jarvis'].includes(String(calId).toLowerCase()) || own.has(calId)) {
        calId = LOCAL_CAL;
      } else {
        if (!this.connected()) throw new Error('Google ist nicht verbunden');
        if (!this.settings.get('google').exportLocalToGoogle) throw new Error('Google-Schreibzugriff ist deaktiviert');
        const cal = this.db.get('SELECT * FROM calendars WHERE id=?', calId);
        if (!cal) throw new Error('Kalender nicht gefunden');
        if (!cal.writable) throw new Error('Dieser Kalender ist schreibgeschützt');
      }
    }
    const eid = id('e');
    const now = nowIso();
    this.db.run(`INSERT INTO events(id,calendar_id,title,description,location,start_at,end_at,all_day,time_zone,rrule,sync_state,local_updated,color)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, eid, calId, d.title, d.description || '', d.location || '', new Date(d.start).toISOString(),
    new Date(d.end).toISOString(), d.allDay ? 1 : 0, tz(), d.recurrence ? rec.toRRule(d.recurrence) : null, calId === LOCAL_CAL ? 'local' : 'pending_create', now, d.color && d.color !== 'auto' ? d.color : null);
    if (calId !== LOCAL_CAL) {
      try {
        const g = await this.google.insertEvent(calId, this.toGoogle(d));
        this.db.run("UPDATE events SET google_id=?, etag=?, remote_updated=?, sync_state='synced' WHERE id=?", g.id, g.etag, g.updated, eid);
        if (g.recurrence) this.syncSoon();
      } catch (e) {
        log.warn('Termin wird später synchronisiert', e);
        this.bus.emit('calendar:changed', {});
        return { ...this.get(eid), pending: true, warning: 'Google nicht erreichbar – Termin wird automatisch nachgetragen.' };
      }
    }
    this.bus.emit('calendar:changed', {});
    return this.get(eid);
  }

  async update(eventId, patch) {
    const r = this.db.get('SELECT * FROM events WHERE id=?', eventId);
    if (!r) throw new Error('Termin nicht gefunden');
    if (String(r.calendar_id).startsWith('feed:')) throw new Error('Termine aus einem abonnierten Stundenplan sind schreibgeschützt');
    if (r.calendar_id !== LOCAL_CAL) {
      const cal = this.db.get('SELECT writable FROM calendars WHERE id=?', r.calendar_id);
      if (!cal?.writable) throw new Error('Importierte Termine sind schreibgeschützt. Bitte einen lokalen Termin anlegen.');
    }
    const d = this.normalizeInput(patch, true);
    if (d.start && !patch.end) d.end = new Date(Date.parse(d.start) + (Date.parse(r.end_at) - Date.parse(r.start_at))).toISOString();
    const cols = { title: d.title, description: d.description, location: d.location, start_at: d.start && new Date(d.start).toISOString(), end_at: d.end && new Date(d.end).toISOString(), all_day: d.allDay === undefined ? undefined : (d.allDay ? 1 : 0) };
    if (d.recurrence !== undefined) cols.rrule = d.recurrence ? rec.toRRule(d.recurrence) : null;
    if (d.color !== undefined) cols.color = d.color && d.color !== 'auto' ? d.color : null;
    const sets = []; const vals = [];
    for (const [k, v] of Object.entries(cols)) if (v !== undefined || (k === 'color' && d.color !== undefined)) { sets.push(`${k}=?`); vals.push(v ?? null); }
    sets.push('local_updated=?'); vals.push(nowIso());
    if (r.calendar_id !== LOCAL_CAL) { sets.push("sync_state=CASE WHEN sync_state='pending_create' THEN 'pending_create' ELSE 'pending_update' END"); }
    this.db.run(`UPDATE events SET ${sets.join(',')} WHERE id=?`, ...vals, eventId);
    const privacy = require('../core/privacy');
    if (r.calendar_id !== LOCAL_CAL && r.google_id && !privacy.isPrivate()) {
      try {
        const full = this.db.get('SELECT * FROM events WHERE id=?', eventId);
        const g = await this.google.patchEvent(r.calendar_id, r.google_id, this.toGoogle({
          title: full.title, description: full.description, location: full.location, start: full.start_at, end: full.end_at, allDay: !!full.all_day,
          ...(d.recurrence !== undefined ? { recurrence: d.recurrence } : {}),
          ...(d.color !== undefined ? { color: d.color } : {}),
        }));
        this.db.run("UPDATE events SET etag=?, remote_updated=?, sync_state='synced', conflict_data=NULL WHERE id=?", g.etag, g.updated, eventId);
      } catch (e) { log.warn('Änderung wird später synchronisiert', e); }
    }
    this.bus.emit('calendar:changed', {});
    return this.get(eventId);
  }

  async remove(eventId) {
    const r = this.db.get('SELECT * FROM events WHERE id=?', eventId);
    if (!r) throw new Error('Termin nicht gefunden');
    if (String(r.calendar_id).startsWith('feed:')) throw new Error('Termine aus einem abonnierten Stundenplan sind schreibgeschützt'); 
    if (r.calendar_id === LOCAL_CAL || !r.google_id) {
      this.db.run('DELETE FROM events WHERE id=?', eventId);
    } else {
      this.db.run("UPDATE events SET sync_state='pending_delete', local_updated=? WHERE id=?", nowIso(), eventId);
      try {
        await this.google.deleteEvent(r.calendar_id, r.google_id);
        this.db.run('DELETE FROM events WHERE id=?', eventId);
      } catch (e) {
        if (e.status === 404 || e.status === 410) this.db.run('DELETE FROM events WHERE id=?', eventId);
        else log.warn('Löschen wird später synchronisiert', e);
      }
    }
    this.bus.emit('calendar:changed', {});
    return { id: eventId, title: r.title, start: r.start_at };
  }

  /** Resolve a conflict: keep 'local' (push) or 'remote' (discard local edit). */
  async resolveConflict(eventId, keep) {
    const r = this.db.get('SELECT * FROM events WHERE id=?', eventId);
    if (!r || r.sync_state !== 'conflict') throw new Error('Kein Konflikt vorhanden');
    if (keep === 'remote') {
      const g = await this.google.getEvent(r.calendar_id, r.google_id);
      this.db.run("UPDATE events SET sync_state='synced', conflict_data=NULL WHERE id=?", eventId);
      this.upsertFromGoogle(r.calendar_id, g);
    } else {
      this.db.run("UPDATE events SET sync_state='pending_update', remote_updated=? WHERE id=?", JSON.parse(r.conflict_data || '{}').remoteUpdated || null, eventId);
      await this.sync();
    }
    this.bus.emit('calendar:changed', {});
    return this.get(eventId);
  }

  syncSoon() { clearTimeout(this._soon); this._soon = setTimeout(() => this.sync().catch(() => {}), 1500); }

  /** Push pending local changes, then pull the window [-30d, +180d]. */
  async sync() {
    if (!this.connected() || this.syncing) return { skipped: true };
    this.syncing = true;
    this.bus.emit('calendar:sync', { state: 'running' });
    try {
      const cl = await this.google.listCalendars();
      const ids = new Set();
      for (const c of cl.items || []) {
        ids.add(c.id);
        const writable = ['owner', 'writer'].includes(c.accessRole) ? 1 : 0;
        this.db.run(`INSERT INTO calendars(id,name,color,is_primary,selected,writable) VALUES(?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color, is_primary=excluded.is_primary, writable=excluded.writable`,
        c.id, c.summaryOverride || c.summary || c.id, c.backgroundColor || '#38bdf8', c.primary ? 1 : 0, c.primary ? 1 : (c.selected ? 1 : 0), writable);
      }
      for (const c of this.db.all("SELECT id FROM calendars WHERE id<>'local' AND id NOT LIKE 'feed:%'")) {
        if (!ids.has(c.id)) { this.db.run('DELETE FROM events WHERE calendar_id=?', c.id); this.db.run('DELETE FROM calendars WHERE id=?', c.id); }
      }
      // Push queue
      for (const r of this.db.all("SELECT * FROM events WHERE sync_state IN ('pending_create','pending_update','pending_delete') AND calendar_id<>'local' AND calendar_id NOT LIKE 'feed:%'")) {
        try {
          const body = this.toGoogle({ title: r.title, description: r.description, location: r.location, start: r.start_at, end: r.end_at, allDay: !!r.all_day, recurrence: r.rrule ? rec.fromRRule(r.rrule) : undefined, color: r.color || 'auto' });
          if (r.sync_state === 'pending_create') {
            const g = await this.google.insertEvent(r.calendar_id, body);
            this.db.run("UPDATE events SET google_id=?, etag=?, remote_updated=?, sync_state='synced' WHERE id=?", g.id, g.etag, g.updated, r.id);
          } else if (r.sync_state === 'pending_update') {
            const remote = await this.google.getEvent(r.calendar_id, r.google_id);
            if (r.remote_updated && remote.updated > r.remote_updated) {
              this.db.run("UPDATE events SET sync_state='conflict', conflict_data=? WHERE id=?", JSON.stringify({ remoteTitle: remote.summary, remoteStart: remote.start?.dateTime || remote.start?.date, remoteEnd: remote.end?.dateTime || remote.end?.date, remoteUpdated: remote.updated }), r.id);
              continue;
            }
            const g = await this.google.patchEvent(r.calendar_id, r.google_id, body);
            this.db.run("UPDATE events SET etag=?, remote_updated=?, sync_state='synced' WHERE id=?", g.etag, g.updated, r.id);
          } else {
            await this.google.deleteEvent(r.calendar_id, r.google_id).catch((e) => { if (![404, 410].includes(e.status)) throw e; });
            this.db.run('DELETE FROM events WHERE id=?', r.id);
          }
        } catch (e) { log.warn('Push fehlgeschlagen für ' + r.id, e); }
      }
      // Pull window
      const timeMin = new Date(Date.now() - 30 * 86400000).toISOString();
      const timeMax = new Date(Date.now() + 180 * 86400000).toISOString();
      const exportCals = new Set(this.exportTargets());
      for (const c of this.db.all("SELECT id FROM calendars WHERE id<>'local' AND id NOT LIKE 'feed:%' AND selected=1")) {
        if (exportCals.has(c.id)) continue; // enthält nur JARVIS-Kopien
        const items = await this.google.listEvents(c.id, { timeMin, timeMax });
        const seen = new Set();
        this.db.tx(() => {
          for (const g of items) {
            if (g.status === 'cancelled') continue;
            // JARVIS/ICS mirrors already exist as source events. Never display
            // their Google copies as a second calendar entry.
            const p = g.extendedProperties?.private;
            if (p && (p.jarvisMirror === '1' ||
                (p.jarvisSourceId && (p.jarvisSource === 'local' || String(p.jarvisSource).startsWith('feed:'))))) continue;
            seen.add(g.id);
            this.upsertFromGoogle(c.id, g);
          }
          // Remove synced events in window that disappeared remotely
          for (const r of this.db.all("SELECT id, google_id FROM events WHERE calendar_id=? AND sync_state='synced' AND start_at>=? AND start_at<=?", c.id, timeMin, timeMax)) {
            if (r.google_id && !seen.has(r.google_id)) this.db.run('DELETE FROM events WHERE id=?', r.id);
          }
          this.db.run('UPDATE calendars SET synced_at=? WHERE id=?', nowIso(), c.id);
        });
      }
      if (this.settings.get('google').exportLocalToGoogle) {
        this.lastMirror = await this.exportAll({ from: timeMin, to: timeMax });
        if (this.lastMirror?.failed) {
          const reasons = Object.entries(this.lastMirror.reasons || {}).slice(0, 3).map(([reason, count]) => `${reason} (${count}x)`).join('; ');
          throw new Error(`${this.lastMirror.failed} Google-Kalendereintraege nicht uebertragen: ${reasons}`);
        }
      }
      this.lastSync = nowIso(); this.lastError = null;
      this.bus.emit('calendar:changed', {});
      return { ok: true, at: this.lastSync, mirror: this.lastMirror || null };
    } catch (e) {
      this.lastError = e.message;
      log.warn('Sync fehlgeschlagen', e);
      throw e;
    } finally {
      this.syncing = false;
      this.bus.emit('calendar:sync', { state: 'idle', at: this.lastSync, error: this.lastError });
      if (this._exportPending) { this._exportPending = false; this.exportSoon(); }
    }
  }

  /**
   * Alles aus dem JARVIS-Kalender in eigene Google-Kalender je Art übertragen
   * (Termine, Geburtstage, Todos, Erinnerungen, Uni). Legt fehlende Kalender an.
   */
  async exportAll({ from, to } = {}) {
    const ex = require('./calendar-google-export');
    const g = this.settings.get('google');
    from = from || new Date(Date.now() - 30 * 86400000).toISOString();
    to = to || new Date(Date.now() + 180 * 86400000).toISOString();
    const kinds = ex.KIND_IDS.filter((k) => (g.exportKinds || {})[k] !== false);
    const { targets, created } = await ex.ensureCalendars({ google: this.google, saved: g.exportCalendars || {}, kinds, timeZone: tz() });
    if (JSON.stringify(targets) !== JSON.stringify(g.exportCalendars || {})) this.settings.update({ google: { exportCalendars: targets } });
    const result = await ex.exportByKind({ db: this.db, google: this.google, targets, kinds, from, to });
    // Einmalig: Kopien der früheren Übertragung (alles in einem Kalender) dort entfernen
    if (!result.failed && !this.db.get("SELECT value FROM meta WHERE key='gcal:legacy-cleaned'")) {
      const own = new Set(Object.values(targets));
      const legacy = this.db.all("SELECT id FROM calendars WHERE writable=1 AND id<>'local' AND id NOT LIKE 'feed:%'").map((c) => c.id).filter((id) => !own.has(id));
      try {
        result.legacy = await ex.cleanupLegacy({ db: this.db, google: this.google, calendarIds: legacy });
        if (!result.legacy.failed) this.db.run("INSERT OR REPLACE INTO meta(key,value) VALUES('gcal:legacy-cleaned',?)", nowIso());
      } catch (e) { log.warn('Alte Google-Kopien nicht aufgeräumt', e); }
    }
    result.createdCalendars = created;
    result.at = nowIso();
    this.lastMirror = result;
    if (result.failed) {
      const top = Object.entries(result.reasons || {}).sort((a, b) => b[1] - a[1])[0];
      throw Object.assign(new Error('Google-Kalender-Übertragung: ' + result.failed + ' Eintrag/Einträge nicht übertragen' + (top ? ` (Grund: ${top[0]})` : '')), { result });
    }
    return result;
  }

  status() {
    return {
      connected: this.connected(), account: this.settings.get('google').account, lastSync: this.lastSync, error: this.lastError,
      syncing: this.syncing, pending: this.db.get("SELECT COUNT(*) c FROM events WHERE sync_state LIKE 'pending_%'").c,
      conflicts: this.db.get("SELECT COUNT(*) c FROM events WHERE sync_state='conflict'").c,
      mirror: this.lastMirror || null,
    };
  }

  /**
   * Free slots between `from` and `to` of at least `minutes`, inside daily
   * working hours, avoiding events and timed tasks.
   */
  freeSlots({ from, to, minutes = 60, dayStart = '08:00', dayEnd = '22:00', busyExtra = [] }) {
    const f = new Date(from), t = new Date(to);
    const busy = this.list(f, t).filter((e) => !e.allDay).map((e) => [Date.parse(e.start), Date.parse(e.end)]);
    for (const b of busyExtra) busy.push([Date.parse(b.start), Date.parse(b.end)]);
    busy.sort((a, b) => a[0] - b[0]);
    const slots = [];
    const [sh, sm] = dayStart.split(':').map(Number);
    const [eh, em] = dayEnd.split(':').map(Number);
    // Tag für Tag per Kalender (nicht + 24 h – an der Zeitumstellung verrutschte sonst jeder folgende Tag)
    for (let d = startOfDay(f); d < t; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      let cur = new Date(d); cur.setHours(sh, sm, 0, 0);
      const end = new Date(d); end.setHours(eh, em, 0, 0);
      if (cur < f) cur = new Date(Math.ceil(f.getTime() / 900000) * 900000);
      for (const [bs, be] of busy) {
        if (be <= cur.getTime() || bs >= end.getTime()) continue;
        if (bs - cur.getTime() >= minutes * 60000) slots.push({ start: cur.toISOString(), end: new Date(bs).toISOString() });
        cur = new Date(Math.max(cur.getTime(), be));
      }
      if (end - cur >= minutes * 60000) slots.push({ start: cur.toISOString(), end: end.toISOString() });
    }
    return slots;
  }
}

function localDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

module.exports = { Calendar, EVENT_SCHEMA, LOCAL_CAL, COLORS, CATEGORIES, categorize };

