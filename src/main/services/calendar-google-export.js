'use strict';
const crypto = require('node:crypto');

// Source of truth: JARVIS for local events, Campus Dual/ICS for subscribed events.
// Google copies are tagged. Google edits to those copies are never silently overwritten.
const MAX_EVENTS = 3000;
const TASK_SOURCE = 'task';
const HASH = (s) => crypto.createHash('sha256').update(s).digest('hex');
const httpStatus = (e) => Number(e?.status || e?.code) || (/(\b404\b|\b409\b)/.test(String(e?.message)) ? Number(String(e.message).match(/\b(404|409)\b/)[1]) : 0);

function eligible(row) {
  return !!(row && (row.calendar_id === 'local' || String(row.calendar_id).startsWith('feed:')) &&
    row.sync_state !== 'pending_delete' && row.status !== 'cancelled' && row.start_at && row.end_at);
}

function googleId(row) {
  return 'jarvis' + HASH(row.calendar_id + ':' + row.id).slice(0, 40);
}

function localDate(iso) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}

// Compare only content JARVIS owns. Ignore Google's etag, timestamps and organizer fields.
function contentHash(ev) {
  const dateValue = (x) => x?.date ? x.date : x?.dateTime ? new Date(x.dateTime).toISOString() : '';
  return HASH(JSON.stringify([
    ev.summary || '', ev.description || '', ev.location || '',
    dateValue(ev.start), dateValue(ev.end),
    [...(ev.recurrence || [])].sort(),
    // Erinnerungszeiten nur, wenn eigene gesetzt sind – ältere Kopien behalten so ihren Fingerabdruck
    ...(ev.reminders?.useDefault === false && ev.reminders.overrides?.length
      ? [ev.reminders.overrides.map((o) => (o.method || 'popup') + ':' + o.minutes).sort()] : []),
  ]));
}

function payload(row) {
  if (!eligible(row)) throw new Error('Ungültiger JARVIS-Termin');
  const allDay = !!row.all_day;
  const ev = {
    id: googleId(row),
    summary: row.title,
    description: row.description || '',
    location: row.location || '',
    start: allDay ? { date: localDate(row.start_at) } : { dateTime: new Date(row.start_at).toISOString() },
    end: allDay ? { date: localDate(row.end_at) } : { dateTime: new Date(row.end_at).toISOString() },
    ...(row.rrule ? { recurrence: [row.rrule] } : {}),
  };
  ev.extendedProperties = { private: {
    jarvisMirror: '1',
    jarvisSource: row.calendar_id,
    jarvisSourceId: row.id,
    jarvisFingerprint: contentHash(ev),
  } };
  return ev;
}

function owned(ev) {
  const tags = ev.extendedProperties?.private;
  return tags?.jarvisMirror === '1' && typeof tags.jarvisSourceId === 'string' &&
    (tags.jarvisSource === 'local' || tags.jarvisSource === TASK_SOURCE || String(tags.jarvisSource).startsWith('feed:'));
}

function remoteUnchanged(ev) {
  return owned(ev) && ev.extendedProperties.private.jarvisFingerprint === contentHash(ev);
}

function freshSource(db, source, now) {
  if (source === 'local' || source === TASK_SOURCE) return true;
  if (!String(source).startsWith('feed:')) return false;
  const feed = db.get('SELECT last_fetch,last_error FROM calendar_feeds WHERE id=?', source.slice(5));
  // A feed that was removed, has errors or was not refreshed recently cannot
  // justify deleting its Google copies (especially on a new installation).
  return !!(feed?.last_fetch && !feed.last_error &&
    now - Date.parse(feed.last_fetch) >= 0 &&
    now - Date.parse(feed.last_fetch) < 24 * 3600_000);
}

/**
 * Gleicht eine fertige Menge JARVIS-Kopien mit einem Google-Kalender ab.
 * items: Map<googleEventId, body>. Gelöscht werden nur JARVIS-eigene, in Google unveränderte Kopien
 * aus frischen Quellen – im Zeitfenster, oder (pruneAll) unabhängig davon, z. B. beim Umzug in eigene Kalender.
 */
async function mirrorCalendar({ db, google, calendarId, items, from, to, pruneAll = false }) {
  const remote = await google.listMirroredEvents(calendarId);
  if (!Array.isArray(remote)) throw new Error('Google-Antwort unvollständig');
  const mirrors = new Map(remote.filter(owned).map((ev) => [ev.id, ev]));
  const result = { created: 0, updated: 0, unchanged: 0, deleted: 0, conflicts: 0, failed: 0, retained: 0 };

  for (const [eventId, body] of items) {
    const tags = body.extendedProperties.private;
    let existing = mirrors.get(eventId);
    try {
      if (!existing) {
        try { await google.insertEvent(calendarId, body); result.created++; continue; }
        catch (e) {
          if (httpStatus(e) !== 409) throw e;
          // A concurrent writer or ID collision: verify ownership before patch.
          existing = await google.getEvent(calendarId, eventId);
        }
      }
      if (!owned(existing) || existing.extendedProperties.private.jarvisSource !== tags.jarvisSource ||
          existing.extendedProperties.private.jarvisSourceId !== tags.jarvisSourceId || !remoteUnchanged(existing)) {
        result.conflicts++; continue;
      }
      if (contentHash(existing) === tags.jarvisFingerprint) {
        result.unchanged++; continue;
      }
      await google.patchEvent(calendarId, eventId, body);
      result.updated++;
    } catch (e) { result.failed++; }
  }

  const now = Date.now();
  for (const [eventId, ev] of mirrors) {
    if (items.has(eventId)) continue;
    // Only delete events that were created by this export, inside its window,
    // when the source is known fresh. Never delete normal Google appointments.
    if (!remoteUnchanged(ev) || !freshSource(db, ev.extendedProperties.private.jarvisSource, now)) {
      result.retained++; continue;
    }
    const start = ev.start?.date || ev.start?.dateTime;
    const stamp = Date.parse(start || '');
    if (!pruneAll && !(stamp >= Date.parse(from) && stamp < Date.parse(to))) {
      result.retained++; continue;
    }
    try {
      await google.deleteEvent(calendarId, eventId);
      result.deleted++;
    } catch (e) { if (httpStatus(e) === 404) result.deleted++; else result.failed++; }
  }
  return result;
}

function sourceRows(db, from, to) {
  const rows = db.all(
    "SELECT * FROM events WHERE ((start_at>=? AND start_at<?) OR (calendar_id='local' AND rrule IS NOT NULL)) AND (calendar_id='local' OR calendar_id IN (SELECT 'feed:' || id FROM calendar_feeds WHERE lecture=1)) ORDER BY start_at LIMIT 3001",
    from, to,
  );
  if (rows.length > MAX_EVENTS) throw new Error('Zu viele JARVIS-Termine; kein unvollständiger Abgleich');
  return rows;
}

async function exportToGoogle({ db, google, calendarId, from, to }) {
  if (!google?.isConnected()) throw new Error('Google Kalender ist nicht verbunden');
  if (!calendarId || calendarId === 'local' || String(calendarId).startsWith('feed:'))
    throw new Error('Google-Zielkalender fehlt');
  const cal = db.get('SELECT id,writable FROM calendars WHERE id=?', calendarId);
  if (!cal?.writable) throw new Error('Google-Zielkalender ist nicht beschreibbar');
  if (!(Date.parse(from) < Date.parse(to))) throw new Error('Ungültiger Zeitraum');
  const rows = sourceRows(db, from, to);
  // Must retrieve the complete mirror list before any writes/deletions (inside mirrorCalendar).
  // If the provider fails, never guess that the Google calendar is empty.
  const items = new Map(rows.filter(eligible).map((r) => [googleId(r), payload(r)]));
  return mirrorCalendar({ db, google, calendarId, items, from, to });
}

// ---------------------------------------------------------------------------
// Übertragung je Art: eigene Google-Kalender für Termine, Geburtstage, Todos, Erinnerungen, Uni

const KINDS = [
  { id: 'termine', name: 'JARVIS · Termine', color: '#4285f4', description: 'Termine aus JARVIS (automatisch übertragen)' },
  { id: 'geburtstage', name: 'JARVIS · Geburtstage', color: '#f691b2', description: 'Geburtstage aus JARVIS (automatisch übertragen)' },
  { id: 'todos', name: 'JARVIS · Todos', color: '#fad165', description: 'Offene Aufgaben mit Fälligkeit aus JARVIS (automatisch übertragen)' },
  { id: 'erinnerungen', name: 'JARVIS · Erinnerungen', color: '#ff7537', description: 'Erinnerungen aus JARVIS (automatisch übertragen)' },
  { id: 'uni', name: 'JARVIS · Uni', color: '#9a9cff', description: 'Vorlesungen, Prüfungen, Lerneinheiten und Abgaben aus JARVIS (automatisch übertragen)' },
];
const KIND_IDS = KINDS.map((k) => k.id);
const TODO_MINUTES = 30;
const REMINDER_MINUTES = 15;

/** Art eines Termins: Vorlesungsplan → Uni; sonst nach Kategorie (Geburtstag, Prüfung/Lernen/Abgabe) oder Termin. */
function eventKind(row) {
  if (String(row.calendar_id).startsWith('feed:')) return 'uni';
  const { categorize } = require('./calendar');
  const cat = categorize(row.title, '', row.event_type);
  if (cat?.id === 'birthday') return 'geburtstage';
  if (cat && ['exam', 'study', 'deadline'].includes(cat.id)) return 'uni';
  return 'termine';
}

/** Art einer Aufgabe: mit Erinnerungszeit → Erinnerung, sonst Todo. */
function taskKind(t) { return t.reminder_minutes !== null && t.reminder_minutes !== undefined ? 'erinnerungen' : 'todos'; }

function taskEligible(t) {
  return !!(t && t.id && t.title && t.status === 'open' && t.due_at && Number.isFinite(Date.parse(t.due_at)));
}

function nextDay(ymd) {
  const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Google-Kopie einer offenen Aufgabe (Todo oder Erinnerung) zur Fälligkeit. */
function taskPayload(t) {
  if (!taskEligible(t)) throw new Error('Ungültige JARVIS-Aufgabe');
  const kind = taskKind(t);
  const due = Date.parse(t.due_at);
  const allDay = !!t.all_day;
  const day = localDate(t.due_at);
  const ev = {
    id: googleId({ calendar_id: TASK_SOURCE, id: t.id }),
    summary: t.title,
    description: t.notes || '',
    location: '',
    start: allDay ? { date: day } : { dateTime: new Date(due).toISOString() },
    end: allDay ? { date: nextDay(day) } : { dateTime: new Date(due + (kind === 'erinnerungen' ? REMINDER_MINUTES : TODO_MINUTES) * 60000).toISOString() },
  };
  if (kind === 'erinnerungen') {
    ev.reminders = { useDefault: false, overrides: [{ method: 'popup', minutes: Math.max(0, Math.min(40320, Math.round(Number(t.reminder_minutes) || 0))) }] };
  }
  ev.extendedProperties = { private: {
    jarvisMirror: '1',
    jarvisSource: TASK_SOURCE,
    jarvisSourceId: t.id,
    jarvisKind: kind,
    jarvisFingerprint: contentHash(ev),
  } };
  return ev;
}

/** Alle JARVIS-Inhalte nach Art sortiert: Map<kind, Map<googleId, body>>. */
function collectByKind(db, from, to) {
  const out = new Map(KIND_IDS.map((k) => [k, new Map()]));
  for (const r of sourceRows(db, from, to)) {
    if (!eligible(r)) continue;
    out.get(eventKind(r)).set(googleId(r), payload(r));
  }
  const tasks = db.all("SELECT * FROM tasks WHERE status='open' AND due_at IS NOT NULL AND due_at>=? AND due_at<? ORDER BY due_at LIMIT 3001", from, to);
  if (tasks.length > MAX_EVENTS) throw new Error('Zu viele JARVIS-Aufgaben; kein unvollständiger Abgleich');
  for (const t of tasks) {
    if (!taskEligible(t)) continue;
    out.get(taskKind(t)).set(googleId({ calendar_id: TASK_SOURCE, id: t.id }), taskPayload(t));
  }
  return out;
}

/**
 * Stellt die eigenen JARVIS-Kalender in Google sicher (gespeicherte ID → gleicher Name → neu anlegen).
 * Es werden nur Kalender verwendet, die dem Konto gehören. Bestehende Kalender werden nie umbenannt oder gelöscht.
 */
async function ensureCalendars({ google, saved = {}, kinds = KIND_IDS, timeZone }) {
  const list = (await google.listCalendars())?.items;
  if (!Array.isArray(list)) throw new Error('Google-Kalenderliste unvollständig');
  const own = list.filter((c) => c.accessRole === 'owner');
  const targets = {}; const created = [];
  for (const k of KINDS) {
    if (!kinds.includes(k.id)) { if (saved[k.id] && own.some((c) => c.id === saved[k.id])) targets[k.id] = saved[k.id]; continue; }
    let cal = own.find((c) => c.id === saved[k.id]) || own.find((c) => (c.summary || '') === k.name);
    if (!cal) {
      cal = await google.createCalendar({ summary: k.name, description: k.description, timeZone });
      if (!cal?.id) throw new Error('Google-Kalender „' + k.name + '“ konnte nicht angelegt werden');
      created.push(k.name);
      try { await google.setCalendarColor(cal.id, k.color); } catch { /* nur Farbe */ }
    }
    targets[k.id] = cal.id;
  }
  return { targets, created };
}

const emptyResult = () => ({ created: 0, updated: 0, unchanged: 0, deleted: 0, conflicts: 0, failed: 0, retained: 0 });

/**
 * Überträgt alles aus dem JARVIS-Kalender in die eigenen Google-Kalender je Art.
 * Abgeschaltete Arten werden aus ihrem Google-Kalender entfernt (nur unveränderte JARVIS-Kopien).
 */
async function exportByKind({ db, google, targets, kinds = KIND_IDS, from, to }) {
  if (!google?.isConnected()) throw new Error('Google Kalender ist nicht verbunden');
  if (!(Date.parse(from) < Date.parse(to))) throw new Error('Ungültiger Zeitraum');
  const all = collectByKind(db, from, to);
  const total = emptyResult(); const byKind = {};
  for (const k of KIND_IDS) {
    const calendarId = targets?.[k];
    if (!calendarId) continue;
    const enabled = kinds.includes(k);
    const r = await mirrorCalendar({ db, google, calendarId, items: enabled ? all.get(k) : new Map(), from, to, pruneAll: !enabled });
    byKind[k] = { ...r, entries: enabled ? all.get(k).size : 0 };
    for (const key of Object.keys(total)) total[key] += r[key];
  }
  return { ...total, byKind };
}

/**
 * Einmaliger Umzug: Kopien der früheren Übertragung (alles in einem Kalender) werden aus anderen
 * beschreibbaren Kalendern entfernt – nur JARVIS-eigene und in Google unveränderte. Normale Google-Termine bleiben.
 */
async function cleanupLegacy({ db, google, calendarIds }) {
  const total = emptyResult();
  for (const calendarId of calendarIds) {
    const r = await mirrorCalendar({ db, google, calendarId, items: new Map(), from: new Date(0).toISOString(), to: new Date(0).toISOString(), pruneAll: true });
    for (const key of Object.keys(total)) total[key] += r[key];
  }
  return total;
}

module.exports = {
  eligible, googleId, contentHash, payload, owned, remoteUnchanged, freshSource, exportToGoogle, mirrorCalendar,
  KINDS, KIND_IDS, eventKind, taskKind, taskEligible, taskPayload, collectByKind, ensureCalendars, exportByKind, cleanupLegacy,
};
