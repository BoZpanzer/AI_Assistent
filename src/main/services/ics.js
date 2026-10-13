'use strict';
const fs = require('node:fs');
const { id, nowIso, sha256, normText } = require('../core/util');
const { assertPublicUrl } = require('./web');
const rec = require('../core/recurrence');
const log = require('../core/logger').scope('ics');

/**
 * Stundenplan-/Kalender-Abos im iCalendar-Format (.ics-Link oder Datei),
 * z. B. der DHSN-Stundenplan. Nur lesend: Termine landen in einem eigenen,
 * schreibgeschützten Kalender „feed:<id>“. Wiederholungen werden beim Import
 * in Einzeltermine aufgelöst (−30 … +365 Tage), inkl. EXDATE und
 * geänderter Einzeltermine (RECURRENCE-ID).
 */
const MAX_BYTES = 5 * 1024 * 1024;
const WIN_TZ = { 'W. Europe Standard Time': 'Europe/Berlin', 'Central Europe Standard Time': 'Europe/Budapest', 'Romance Standard Time': 'Europe/Paris', 'GMT Standard Time': 'Europe/London', UTC: 'UTC' };

// ---------- Parser ----------
function unfold(text) { return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, ''); }
function unescape(v) { return String(v).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1'); }

function parseLine(line) {
  // NAME;PARAM=a;PARAM2="b:c":value
  let i = 0; let inQ = false;
  for (; i < line.length; i++) { const c = line[i]; if (c === '"') inQ = !inQ; else if (c === ':' && !inQ) break; }
  const head = line.slice(0, i); const value = line.slice(i + 1);
  const [name, ...ps] = head.split(';');
  const params = {};
  for (const p of ps) { const [k, ...v] = p.split('='); params[k.toUpperCase()] = v.join('=').replace(/^"|"$/g, ''); }
  return { name: name.toUpperCase(), params, value };
}

/** Offset (ms) of an IANA zone at a given instant. */
function tzOffset(zone, ts) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ts;
}
function zonedToUtc(y, mo, d, h, mi, s, zone) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let ts = guess - tzOffset(zone, guess);
  ts = guess - tzOffset(zone, ts); // second pass handles DST edges
  return ts;
}
function validZone(z) { try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return true; } catch { return false; } }

function zoneOf(params = {}) {
  let zone = params.TZID ? WIN_TZ[params.TZID] || params.TZID.replace(/^\/+/, '') : null;
  return zone && validZone(zone) ? zone : null;
}

/** → { iso, allDay } */
function parseDate(value, params = {}) {
  const v = String(value).trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) { const t = Date.parse(v); return isNaN(t) ? null : { iso: new Date(t).toISOString(), allDay: false }; }
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined || params.VALUE === 'DATE') return { iso: new Date(+y, +mo - 1, +d).toISOString(), allDay: true };
  if (z) return { iso: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0))).toISOString(), allDay: false };
  const zone = zoneOf(params);
  if (!zone) return { iso: new Date(+y, +mo - 1, +d, +h, +mi, +(s || 0)).toISOString(), allDay: false }; // floating → local
  return { iso: new Date(zonedToUtc(+y, +mo, +d, +h, +mi, +(s || 0), zone)).toISOString(), allDay: false };
}

function parseDuration(v) {
  const m = String(v).match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const ms = ((+m[2] || 0) * 7 * 86400 + (+m[3] || 0) * 86400 + (+m[4] || 0) * 3600 + (+m[5] || 0) * 60 + (+m[6] || 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

function parseRRule(v) {
  const p = Object.fromEntries(String(v).split(';').map((x) => x.split('=')).map(([k, val]) => [k.toUpperCase(), val]));
  const freq = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' }[p.FREQ];
  if (!freq) return null;
  const r = { freq, interval: +(p.INTERVAL || 1) };
  if (p.BYDAY) r.byDay = p.BYDAY.split(',').map((x) => x.replace(/^[+-]?\d+/, '')).filter(Boolean);
  if (p.UNTIL) r.until = parseDate(p.UNTIL)?.iso;
  if (p.COUNT) r.count = +p.COUNT;
  return r;
}

/** Parse ICS text → { name, events: [{uid, title, location, description, start, end, allDay, rrule, exdates[], recurrenceId, status}] } */
function parseIcs(text) {
  const lines = unfold(text).split('\n');
  const events = []; let cur = null; let depth = 0; let calName = '';
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const l = parseLine(raw);
    if (l.name === 'BEGIN') { if (l.value.toUpperCase() === 'VEVENT' && depth === 0) cur = { exdates: [], params: {} }; else if (cur) depth++; continue; }
    if (l.name === 'END') { if (cur && depth > 0) { depth--; continue; } if (l.value.toUpperCase() === 'VEVENT' && cur) { events.push(cur); cur = null; } continue; }
    if (!cur) { if (l.name === 'X-WR-CALNAME') calName = unescape(l.value); continue; }
    if (depth > 0) continue; // inside VALARM etc.
    switch (l.name) {
      case 'UID': cur.uid = l.value.trim(); break;
      case 'SUMMARY': cur.title = unescape(l.value).trim(); break;
      case 'LOCATION': cur.location = unescape(l.value).trim(); break;
      case 'DESCRIPTION': cur.description = unescape(l.value).trim(); break;
      case 'STATUS': cur.status = l.value.trim().toUpperCase(); break;
      case 'DTSTART': { const d = parseDate(l.value, l.params); if (d) { cur.start = d.iso; cur.allDay = d.allDay; cur.tz = zoneOf(l.params); } break; }
      case 'DTEND': { const d = parseDate(l.value, l.params); if (d) cur.end = d.iso; break; }
      case 'DURATION': cur.duration = parseDuration(l.value); break;
      case 'RRULE': cur.rrule = parseRRule(l.value); break;
      case 'EXDATE': for (const v of l.value.split(',')) { const d = parseDate(v, l.params); if (d) cur.exdates.push(d.iso); } break;
      case 'RECURRENCE-ID': { const d = parseDate(l.value, l.params); if (d) cur.recurrenceId = d.iso; break; }
      default: break;
    }
  }
  const out = [];
  for (const e of events) {
    if (!e.start) continue;
    if (!e.end) e.end = new Date(Date.parse(e.start) + (e.duration ?? (e.allDay ? 86400000 : 3600000))).toISOString();
    delete e.params; delete e.duration;
    e.title = e.title || '(ohne Titel)'; e.uid = e.uid || sha256(e.title + e.start).slice(0, 16);
    out.push(e);
  }
  return { name: calName, events: out };
}

/** Expand to concrete instances within [from, to). */
function expand(events, from, to) {
  const overrides = new Map();
  for (const e of events) if (e.recurrenceId) overrides.set(e.uid + '|' + Date.parse(e.recurrenceId), e);
  const out = [];
  for (const e of events) {
    if (e.recurrenceId) continue;
    const dur = Date.parse(e.end) - Date.parse(e.start);
    let starts = e.rrule ? rec.between(e.start, e.rrule, new Date(from.getTime() - dur), to, 2000) : [e.start];
    // Wiederholungen behalten die Uhrzeit in der Zeitzone des Termins (Sommer-/Winterzeit),
    // unabhängig von der Zeitzone dieses Rechners.
    if (e.rrule && e.tz) starts = starts.map((x) => keepWallTime(e.start, x, e.tz));
    const ex = new Set(e.exdates.map((x) => Date.parse(x)));
    for (const s of starts) {
      const t = Date.parse(s);
      if (ex.has(t)) continue;
      const ov = overrides.get(e.uid + '|' + t);
      const inst = ov ? { ...ov, rrule: null } : { ...e, start: s, end: new Date(t + dur).toISOString() };
      if (inst.status === 'CANCELLED') continue;
      if (Date.parse(inst.end) <= from.getTime() || Date.parse(inst.start) >= to.getTime()) continue;
      out.push({ uid: e.uid, title: inst.title, location: inst.location || '', description: inst.description || '', start: inst.start, end: inst.end, allDay: !!inst.allDay });
    }
  }
  // Overrides that moved an instance into the window but whose master was not expanded there
  for (const ov of overrides.values()) {
    if (ov.status === 'CANCELLED') continue;
    if (out.some((x) => x.uid === ov.uid && x.start === ov.start)) continue;
    if (Date.parse(ov.end) > from.getTime() && Date.parse(ov.start) < to.getTime() && !events.some((m) => !m.recurrenceId && m.uid === ov.uid && m.rrule)) out.push({ uid: ov.uid, title: ov.title, location: ov.location || '', description: ov.description || '', start: ov.start, end: ov.end, allDay: !!ov.allDay });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

function wallParts(iso, zone) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, +x.value || x.value]));
  return p;
}
function keepWallTime(startIso, instIso, zone) {
  const days = Math.round((Date.parse(instIso) - Date.parse(startIso)) / 86400000);
  const p = wallParts(startIso, zone);
  return new Date(zonedToUtc(+p.year, +p.month, +p.day + days, +p.hour, +p.minute, +p.second, zone)).toISOString();
}

// ---------- Feeds ----------
class Feeds {
  constructor(s) { this.s = s; this.db = s.db; }

  list() {
    return this.db.all('SELECT * FROM calendar_feeds ORDER BY created_at').map((f) => ({
      id: f.id, name: f.name, url: f.url ? f.url.replace(/([?&](?:token|key|auth|hash)=)[^&]+/gi, '$1…') : null, kind: f.kind, color: f.color, lecture: !!f.lecture,
      lastFetch: f.last_fetch, error: f.last_error, events: this.db.get('SELECT COUNT(*) c FROM events WHERE calendar_id=?', 'feed:' + f.id).c,
    }));
  }

  async add({ name, url, file, color = '#a78bfa', lecture = true }) {
    let kind = 'url'; let clean = null;
    if (file) { kind = 'file'; if (!/\.ics$/i.test(file) || !fs.existsSync(file)) throw new Error('Bitte eine .ics-Datei wählen'); clean = file; }
    else {
      clean = String(url || '').trim().replace(/^webcals?:\/\//i, 'https://');
      await assertPublicUrl(clean);
    }
    const fid = id('feed');
    this.db.run('INSERT INTO calendar_feeds(id,name,url,kind,color,lecture,created_at) VALUES(?,?,?,?,?,?,?)', fid, String(name || 'Stundenplan').slice(0, 80), clean, kind, color, lecture ? 1 : 0, nowIso());
    this.db.run('INSERT OR REPLACE INTO calendars(id,name,color,is_primary,selected,writable) VALUES(?,?,?,0,1,0)', 'feed:' + fid, String(name || 'Stundenplan').slice(0, 80), color);
    try { const r = await this.refresh(fid); return { id: fid, ...r }; } catch (e) { return { id: fid, error: e.message }; }
  }

  remove(fid) {
    this.db.tx(() => {
      this.db.run('DELETE FROM events WHERE calendar_id=?', 'feed:' + fid);
      this.db.run('DELETE FROM calendars WHERE id=?', 'feed:' + fid);
      this.db.run('DELETE FROM calendar_feeds WHERE id=?', fid);
    });
    this.s.bus.emit('calendar:changed', {}); this.s.bus.emit('feeds:changed', {});
    return true;
  }

  update(fid, patch) {
    const f = this.db.get('SELECT * FROM calendar_feeds WHERE id=?', fid);
    if (!f) throw new Error('Abo nicht gefunden');
    const name = patch.name !== undefined ? String(patch.name).slice(0, 80) : f.name;
    const color = patch.color || f.color; const lecture = patch.lecture !== undefined ? (patch.lecture ? 1 : 0) : f.lecture;
    this.db.run('UPDATE calendar_feeds SET name=?, color=?, lecture=? WHERE id=?', name, color, lecture, fid);
    this.db.run('UPDATE calendars SET name=?, color=? WHERE id=?', name, color, 'feed:' + fid);
    this.s.bus.emit('calendar:changed', {}); this.s.bus.emit('feeds:changed', {});
    return true;
  }

  async fetchText(f) {
    if (f.kind === 'file') return fs.readFileSync(f.url, 'utf8');
    let u = await assertPublicUrl(f.url); let res;
    for (let hop = 0; hop < 4; hop++) {
      res = await this.s.fetch(u.toString(), { redirect: 'manual', headers: { 'User-Agent': 'JARVIS-Desktop/3', Accept: 'text/calendar,text/plain;q=0.8,*/*;q=0.5', ...(f.etag ? { 'If-None-Match': f.etag } : {}) }, signal: AbortSignal.timeout(20000) });
      if ([301, 302, 303, 307, 308].includes(res.status)) { u = await assertPublicUrl(new URL(res.headers.get('location'), u).toString()); continue; }
      break;
    }
    if (res.status === 304) return null;
    if (!res.ok) throw new Error('Kalender-Abo antwortet mit HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('Kalenderdatei zu groß');
    this.db.run('UPDATE calendar_feeds SET etag=? WHERE id=?', res.headers.get('etag') || null, f.id);
    return buf.toString('utf8');
  }

  async refresh(fid) {
    const f = this.db.get('SELECT * FROM calendar_feeds WHERE id=?', fid);
    if (!f) throw new Error('Abo nicht gefunden');
    try {
      const text = await this.fetchText(f);
      if (text === null) { this.db.run('UPDATE calendar_feeds SET last_fetch=?, last_error=NULL WHERE id=?', nowIso(), fid); return { unchanged: true }; }
      if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Keine gültige iCalendar-Datei (.ics)');
      const hash = sha256(text);
      if (hash === f.content_hash) { this.db.run('UPDATE calendar_feeds SET last_fetch=?, last_error=NULL WHERE id=?', nowIso(), fid); return { unchanged: true }; }
      const parsed = parseIcs(text);
      const from = new Date(Date.now() - 30 * 86400000); const to = new Date(Date.now() + 365 * 86400000);
      const inst = expand(parsed.events, from, to).slice(0, 5000);
      const cal = 'feed:' + fid; const now = nowIso();
      this.db.tx(() => {
        this.db.run('DELETE FROM events WHERE calendar_id=?', cal);
        for (const e of inst) {
          this.db.run(`INSERT OR REPLACE INTO events(id,calendar_id,title,description,location,start_at,end_at,all_day,sync_state,local_updated)
            VALUES(?,?,?,?,?,?,?,?,'synced',?)`, 'f_' + sha256(fid + '|' + e.uid + '|' + e.start).slice(0, 22), cal, e.title.slice(0, 300), e.description.slice(0, 4000), e.location.slice(0, 500), e.start, e.end, e.allDay ? 1 : 0, now);
        }
        this.db.run('UPDATE calendar_feeds SET content_hash=?, last_fetch=?, last_error=NULL WHERE id=?', hash, now, fid);
      });
      log.info(`Abo „${f.name}“: ${inst.length} Termine`);
      this.s.bus.emit('calendar:changed', {}); this.s.bus.emit('feeds:changed', {});
      return { events: inst.length, calendarName: parsed.name };
    } catch (e) {
      this.db.run('UPDATE calendar_feeds SET last_fetch=?, last_error=? WHERE id=?', nowIso(), e.message.slice(0, 300), fid);
      this.s.bus.emit('feeds:changed', {});
      throw e;
    }
  }

  async refreshAll() {
    const out = [];
    for (const f of this.db.all('SELECT id FROM calendar_feeds')) out.push(await this.refresh(f.id).catch((e) => ({ error: e.message })));
    return out;
  }

  /** Lecture events (from feeds marked as timetable) in a range, with related notes. */
  lectures(from, to, { withNotes = true } = {}) {
    const feeds = this.db.all('SELECT id FROM calendar_feeds WHERE lecture=1').map((f) => 'feed:' + f.id);
    if (!feeds.length) return [];
    const evs = this.s.calendar.list(from, to, { calendars: feeds }).filter((e) => !e.allDay);
    return evs.map((e) => ({ ...e, course: courseName(e.title), notes: withNotes && this.s.settings.get('study')?.linkLectures !== false ? this.s.study.relatedNotes(e.title, { limit: 3 }) : [] }));
  }
}

/** „V Mathematik II (CS24-1) Raum 2.14“ → „Mathematik II“ */
function courseName(title) {
  return String(title || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^(?:V|Ü|UE|S|P|Vorl\.?|Vorlesung|Übung|Seminar|Praktikum|Labor|Klausur|Prüfung)\s*[:\-–]?\s+/i, '')
    .replace(/\b(?:Raum|Rm\.?|Hörsaal|HS)\s*[\w.\-]+/gi, ' ')
    .replace(/\b[A-Z]{2,4}\d{2}(?:-\d)?\b/g, ' ')
    .replace(/[,;\-–]\s*(?:V|Ü|Vorlesung|Übung|Seminar|Praktikum|Labor)\.?\s*$/i, '')
    .replace(/\s+/g, ' ').replace(/[\s,;\-–]+$/, '').trim() || String(title || '');
}

module.exports = { Feeds, parseIcs, expand, parseDate, courseName, zonedToUtc };
