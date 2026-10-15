'use strict';
const crypto = require('node:crypto');

// Source of truth: JARVIS for local events, Campus Dual/ICS for subscribed events.
// Google copies are tagged. Google edits to those copies are never silently overwritten.
const MAX_EVENTS = 3000;
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
    (tags.jarvisSource === 'local' || String(tags.jarvisSource).startsWith('feed:'));
}

function remoteUnchanged(ev) {
  return owned(ev) && ev.extendedProperties.private.jarvisFingerprint === contentHash(ev);
}

function freshSource(db, source, now) {
  if (source === 'local') return true;
  if (!String(source).startsWith('feed:')) return false;
  const feed = db.get('SELECT last_fetch,last_error FROM calendar_feeds WHERE id=?', source.slice(5));
  // A feed that was removed, has errors or was not refreshed recently cannot
  // justify deleting its Google copies (especially on a new installation).
  return !!(feed?.last_fetch && !feed.last_error &&
    now - Date.parse(feed.last_fetch) >= 0 &&
    now - Date.parse(feed.last_fetch) < 24 * 3600_000);
}

async function exportToGoogle({ db, google, calendarId, from, to }) {
  if (!google?.isConnected()) throw new Error('Google Kalender ist nicht verbunden');
  if (!calendarId || calendarId === 'local' || String(calendarId).startsWith('feed:'))
    throw new Error('Google-Zielkalender fehlt');
  const cal = db.get('SELECT id,writable FROM calendars WHERE id=?', calendarId);
  if (!cal?.writable) throw new Error('Google-Zielkalender ist nicht beschreibbar');
  if (!(Date.parse(from) < Date.parse(to))) throw new Error('Ungültiger Zeitraum');

  const rows = db.all(
    "SELECT * FROM events WHERE ((start_at>=? AND start_at<?) OR (calendar_id='local' AND rrule IS NOT NULL)) AND (calendar_id='local' OR calendar_id LIKE 'feed:%') ORDER BY start_at LIMIT 3001",
    from, to,
  );
  if (rows.length > MAX_EVENTS) throw new Error('Zu viele JARVIS-Termine; kein unvollständiger Abgleich');
  // Must retrieve the complete mirror list before any writes/deletions. If the
  // provider fails, never guess that the Google calendar is empty.
  const remote = await google.listMirroredEvents(calendarId);
  if (!Array.isArray(remote)) throw new Error('Google-Antwort unvollständig');
  const mirrors = new Map(remote.filter(owned).map((ev) => [ev.id, ev]));
  const sources = new Map(rows.filter(eligible).map((r) => [googleId(r), r]));
  const result = { created: 0, updated: 0, unchanged: 0, deleted: 0, conflicts: 0, failed: 0, retained: 0 };

  for (const [eventId, row] of sources) {
    const body = payload(row);
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
      if (!owned(existing) || existing.extendedProperties.private.jarvisSource !== row.calendar_id ||
          existing.extendedProperties.private.jarvisSourceId !== row.id || !remoteUnchanged(existing)) {
        result.conflicts++; continue;
      }
      if (contentHash(existing) === body.extendedProperties.private.jarvisFingerprint) {
        result.unchanged++; continue;
      }
      await google.patchEvent(calendarId, eventId, body);
      result.updated++;
    } catch (e) { result.failed++; }
  }

  const now = Date.now();
  for (const [eventId, ev] of mirrors) {
    if (sources.has(eventId)) continue;
    // Only delete events that were created by this export, inside its window,
    // when the source is known fresh. Never delete normal Google appointments.
    if (!remoteUnchanged(ev) || !freshSource(db, ev.extendedProperties.private.jarvisSource, now)) {
      result.retained++; continue;
    }
    const start = ev.start?.date || ev.start?.dateTime;
    const stamp = Date.parse(start || '');
    if (!(stamp >= Date.parse(from) && stamp < Date.parse(to))) {
      result.retained++; continue;
    }
    try {
      await google.deleteEvent(calendarId, eventId);
      result.deleted++;
    } catch (e) { if (httpStatus(e) === 404) result.deleted++; else result.failed++; }
  }
  return result;
}

module.exports = { eligible, googleId, contentHash, payload, owned, remoteUnchanged, freshSource, exportToGoogle };
