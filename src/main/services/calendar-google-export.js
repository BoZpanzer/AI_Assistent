'use strict';
const crypto = require('node:crypto');

/** Explicit Google Calendar copy of JARVIS-local and subscribed lecture events. */
function eligible(row) {
  return row && (row.calendar_id === 'local' || String(row.calendar_id).startsWith('feed:')) &&
    row.sync_state !== 'pending_delete' && row.status !== 'cancelled' && Boolean(row.start_at) && Boolean(row.end_at);
}
function googleId(row) {
  return 'jarvis' + crypto.createHash('sha256').update(row.calendar_id + ':' + (row.google_id || row.id)).digest('hex').slice(0, 40);
}
function payload(row) {
  if (!eligible(row)) throw new Error('Ungültiger JARVIS-Termin');
  const allDay = !!row.all_day;
  const day = (x) => new Date(x).toISOString().slice(0, 10);
  return { id: googleId(row), summary: row.title,
    description: row.description || '', location: row.location || '',
    start: allDay ? { date: day(row.start_at) } : { dateTime: new Date(row.start_at).toISOString() },
    end: allDay ? { date: day(row.end_at) } : { dateTime: new Date(row.end_at).toISOString() },
    extendedProperties: { private: { jarvisSource: row.calendar_id, jarvisSourceId: row.id } } };
}
async function exportToGoogle({ db, google, calendarId, from, to }) {
  if (!google?.isConnected()) throw new Error('Google Kalender ist nicht verbunden');
  if (!calendarId || calendarId === 'local' || String(calendarId).startsWith('feed:')) throw new Error('Google-Zielkalender fehlt');
  const cal = db.get('SELECT id,writable FROM calendars WHERE id=?', calendarId);
  if (!cal?.writable) throw new Error('Google-Zielkalender ist nicht beschreibbar');
  const rows = db.all("SELECT * FROM events WHERE start_at>=? AND start_at<? AND (calendar_id='local' OR calendar_id LIKE 'feed:%') ORDER BY start_at LIMIT 3000", from, to);
  let created = 0, updated = 0, failed = 0;
  for (const row of rows.filter(eligible)) {
    const ev = payload(row);
    try {
      await google.insertEvent(calendarId, ev); created++;
    } catch (error) {
      // Deterministic event IDs prevent duplicates on repeated export.
      if (error.status === 409 || error.code === 409 || /\b409\b/.test(error.message || '')) {
        try { await google.patchEvent(calendarId, ev.id, ev); updated++; } catch { failed++; }
      } else failed++;
    }
  }
  return { created, updated, failed };
}
module.exports = { eligible, googleId, payload, exportToGoogle };
