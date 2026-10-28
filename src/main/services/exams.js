'use strict';
const { id, nowIso, startOfDay, normText } = require('../core/util');
const { validate } = require('../core/validate');
const log = require('../core/logger').scope('exams');

/**
 * Klausurmodus: Rückwärtsplanung von Lerneinheiten bis zur Prüfung.
 * Vorschläge werden nur berechnet; erst „Übernehmen“ (Bestätigung) trägt
 * sie in den Kalender ein. Verpasste Einheiten werden erkannt und auf
 * Wunsch neu verteilt.
 */
const EXAM_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  title: { type: 'string', minLength: 1, maxLength: 160 }, subject: { type: 'string', maxLength: 120 },
  date: { type: 'string', format: 'date-time' }, targetHours: { type: 'number', minimum: 1, maximum: 300 },
  sessionMinutes: { type: 'integer', minimum: 25, maximum: 240 }, notes: { type: 'string', maxLength: 2000 } } };

const DAY = 86400000;
const fmtDay = (iso) => new Date(iso).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

class Exams {
  constructor(s) { this.s = s; this.db = s.db; }

  toPublic(r) {
    const sess = this.db.all('SELECT * FROM exam_sessions WHERE exam_id=? ORDER BY start_at', r.id);
    const mins = (x) => (Date.parse(x.end_at) - Date.parse(x.start_at)) / 60000;
    const done = sess.filter((x) => x.status === 'done').reduce((a, x) => a + mins(x), 0);
    const now = Date.now();
    const planned = sess.filter((x) => x.status === 'planned' && Date.parse(x.start_at) > now - 2 * 3600_000);
    return {
      id: r.id, title: r.title, subject: r.subject, date: r.date, targetHours: r.target_hours, sessionMinutes: r.session_minutes, notes: r.notes, archived: !!r.archived,
      daysLeft: Math.round((startOfDay(new Date(r.date)) - startOfDay()) / DAY), // round: Tage mit 23/25 h (Zeitumstellung)
      hoursDone: +(done / 60).toFixed(1), hoursPlanned: +(planned.reduce((a, x) => a + mins(x), 0) / 60).toFixed(1),
      missed: sess.filter((x) => x.status === 'missed').length,
      nextSession: planned[0] ? this.sessionPublic(planned[0]) : null,
      sessions: sess.map((x) => this.sessionPublic(x)),
    };
  }
  sessionPublic(x) { return { id: x.id, examId: x.exam_id, start: x.start_at, end: x.end_at, topic: x.topic, status: x.status, eventId: x.event_id }; }

  list({ archived = false } = {}) {
    return this.db.all(`SELECT * FROM exams ${archived ? '' : 'WHERE archived=0'} ORDER BY date`).map((r) => this.toPublic(r));
  }
  get(eid) { const r = this.db.get('SELECT * FROM exams WHERE id=?', eid); return r ? this.toPublic(r) : null; }

  /** Find by id, title or subject (for chat/voice). */
  find(ref) {
    if (!ref) { const l = this.list(); return l.length === 1 ? l[0] : null; }
    const byId = this.get(ref); if (byId) return byId;
    const n = normText(ref);
    const l = this.list();
    return l.find((x) => normText(x.title) === n || normText(x.subject) === n) || l.find((x) => normText(x.title).includes(n) || n.includes(normText(x.title)) || (x.subject && (normText(x.subject).includes(n) || n.includes(normText(x.subject))))) || null;
  }

  create(input) {
    const v = validate(EXAM_SCHEMA, input);
    if (!v.ok) throw new Error(v.errors.join('; '));
    const d = v.value;
    if (!d.title || !d.date) throw new Error('Titel und Datum der Klausur fehlen');
    if (Date.parse(d.date) < Date.now() - DAY) throw new Error('Das Klausurdatum liegt in der Vergangenheit');
    const eid = id('ex'); const now = nowIso();
    this.db.run('INSERT INTO exams(id,title,subject,date,target_hours,session_minutes,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
      eid, d.title.trim(), (d.subject || '').trim(), new Date(d.date).toISOString(), d.targetHours || 15, d.sessionMinutes || 90, d.notes || '', now, now);
    this.changed();
    return this.get(eid);
  }

  update(eid, patch) {
    const r = this.db.get('SELECT * FROM exams WHERE id=?', eid);
    if (!r) throw new Error('Klausur nicht gefunden');
    const v = validate(EXAM_SCHEMA, patch);
    if (!v.ok) throw new Error(v.errors.join('; '));
    const d = v.value;
    this.db.run('UPDATE exams SET title=?, subject=?, date=?, target_hours=?, session_minutes=?, notes=?, updated_at=? WHERE id=?',
      d.title ?? r.title, d.subject ?? r.subject, d.date ? new Date(d.date).toISOString() : r.date, d.targetHours ?? r.target_hours, d.sessionMinutes ?? r.session_minutes, d.notes ?? r.notes, nowIso(), eid);
    this.changed();
    return this.get(eid);
  }

  archive(eid) { this.db.run('UPDATE exams SET archived=1, updated_at=? WHERE id=?', nowIso(), eid); this.changed(); return true; }
  async remove(eid, { deleteEvents = true } = {}) {
    if (deleteEvents) await this.removeFutureEvents(eid);
    this.db.run('DELETE FROM exams WHERE id=?', eid); this.changed(); return true;
  }

  /**
   * Compute (but do not save) study sessions from tomorrow until the day
   * before the exam, inside free calendar slots.
   */
  proposePlan(eid, { from } = {}) {
    const ex = this.db.get('SELECT * FROM exams WHERE id=?', eid);
    if (!ex) throw new Error('Klausur nicht gefunden');
    const cfg = this.s.settings.get('study') || {};
    const dur = ex.session_minutes;
    const maxPerDay = cfg.maxSessionsPerDay || 2;
    const [ph, pm] = String(cfg.preferredTime || '16:00').split(':').map(Number);
    const doneMin = this.db.all("SELECT start_at, end_at FROM exam_sessions WHERE exam_id=? AND status='done'", eid).reduce((a, x) => a + (Date.parse(x.end_at) - Date.parse(x.start_at)) / 60000, 0);
    const needed = Math.max(0, ex.target_hours * 60 - doneMin);
    const count = Math.ceil(needed / dur);
    const examDay = startOfDay(new Date(ex.date));
    let start = from ? new Date(from) : startOfDay(new Date(startOfDay().getTime() + DAY + 3600_000));
    if (start < new Date()) start = new Date(Math.ceil(Date.now() / 900000) * 900000);
    if (!count) return { examId: eid, sessions: [], needed: 0, shortfall: 0, note: 'Lernziel bereits erreicht.' };
    if (start >= examDay) return { examId: eid, sessions: [], needed: count, shortfall: count, note: 'Bis zur Klausur bleibt kein ganzer Tag mehr.' };
    // Existing future planned sessions of THIS exam are replaced → don't count them as busy
    const own = new Set(this.db.all("SELECT event_id FROM exam_sessions WHERE exam_id=? AND status='planned' AND event_id IS NOT NULL", eid).map((x) => x.event_id));
    const busyIgnore = (e) => own.has(e.id);
    const slots = this.freeSlots(start, examDay, dur, busyIgnore);
    // Candidate start per day: as close to the preferred time as possible
    const byDay = new Map();
    for (const sl of slots) {
      const k = startOfDay(new Date(sl.start)).getTime();
      (byDay.get(k) || byDay.set(k, []).get(k)).push(sl);
    }
    const days = [...byDay.keys()].sort((a, b) => a - b);
    const pickInDay = (k, taken) => {
      const pref = new Date(k); pref.setHours(ph, pm, 0, 0);
      let best = null;
      for (const sl of byDay.get(k)) {
        const s0 = Date.parse(sl.start), e0 = Date.parse(sl.end);
        let st = Math.min(Math.max(pref.getTime(), s0), e0 - dur * 60000);
        st = Math.ceil(st / 900000) * 900000;
        if (st + dur * 60000 > e0) continue;
        // keep 30 min between sessions on the same day
        if (taken.some((t) => st < t + (dur + 30) * 60000 && st + (dur + 30) * 60000 > t)) {
          const alt = Math.ceil((Math.max(...taken) + (dur + 30) * 60000) / 900000) * 900000;
          if (alt >= s0 && alt + dur * 60000 <= e0) st = alt; else continue;
        }
        const score = Math.abs(st - pref.getTime());
        if (!best || score < best.score) best = { st, score };
      }
      return best?.st ?? null;
    };
    // Bias toward the exam: positions biased to later days
    const perDay = new Map(days.map((k) => [k, []]));
    const order = [];
    for (let i = 0; i < count; i++) order.push(Math.min(days.length - 1, Math.floor(Math.pow((i + 0.5) / count, 0.75) * days.length)));
    const sessions = [];
    for (const idx of order) {
      // nearest day (prefer the target, then later, then earlier) with capacity
      const cand = [...days.keys()].sort((a, b) => Math.abs(a - idx) - Math.abs(b - idx) || b - a);
      for (const j of cand) {
        const k = days[j]; const taken = perDay.get(k);
        if (taken.length >= maxPerDay) continue;
        const st = pickInDay(k, taken);
        if (st == null) continue;
        taken.push(st);
        sessions.push({ start: new Date(st).toISOString(), end: new Date(st + dur * 60000).toISOString() });
        break;
      }
    }
    sessions.sort((a, b) => a.start.localeCompare(b.start));
    // Topics: subject documents in order; the last session(s) are review
    const docs = ex.subject ? this.s.study.documents({ subject: ex.subject, limit: 50 }).reverse() : [];
    sessions.forEach((x, i) => {
      if (i === sessions.length - 1 && sessions.length >= 3) x.topic = 'Wiederholung & Probeklausur';
      else if (i === sessions.length - 2 && sessions.length >= 6) x.topic = 'Schwachstellen wiederholen';
      else if (docs.length) x.topic = docs[i % docs.length].title;
      else x.topic = `Lernblock ${i + 1}`;
    });
    return {
      examId: eid, title: ex.title, sessions, needed: count, shortfall: Math.max(0, count - sessions.length),
      hours: +(sessions.length * dur / 60).toFixed(1), replaces: own.size,
      note: sessions.length < count ? `Nur ${sessions.length} von ${count} Einheiten passen in freie Zeiten – evtl. längere Einheiten oder mehr pro Tag erlauben.` : null,
    };
  }

  freeSlots(from, to, dur, ignore) {
    // Own planned sessions (which a replan replaces) do not count as busy.
    const busy = this.s.calendar.list(from, to).filter((e) => !e.allDay && !ignore(e)).map((e) => ({ start: e.start, end: e.end }));
    return slotsFrom(from, to, dur, busy);
  }

  /** Save sessions + calendar entries (called after confirmation). Replaces future planned sessions. */
  async applyPlan(eid, sessions) {
    const ex = this.db.get('SELECT * FROM exams WHERE id=?', eid);
    if (!ex) throw new Error('Klausur nicht gefunden');
    if (!Array.isArray(sessions) || !sessions.length) throw new Error('Keine Lerneinheiten');
    if (sessions.length > 80) throw new Error('Zu viele Einheiten');
    const replaced = await this.removeFutureEvents(eid);
    const created = []; const now = nowIso();
    for (const x of sessions) {
      if (isNaN(Date.parse(x.start)) || isNaN(Date.parse(x.end))) continue;
      let ev = null;
      try {
        ev = await this.s.calendar.create({ title: `📚 ${ex.title}: ${String(x.topic || 'Lernen').slice(0, 120)}`, start: x.start, end: x.end, description: `Lerneinheit für „${ex.title}“ (${new Date(ex.date).toLocaleDateString('de-DE')}). Geplant von JARVIS.` });
      } catch (e) { log.warn('Kalendereintrag fehlgeschlagen', e); }
      const sid = id('es');
      this.db.run('INSERT INTO exam_sessions(id,exam_id,start_at,end_at,topic,event_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)', sid, eid, x.start, x.end, String(x.topic || '').slice(0, 200), ev?.id || null, 'planned', now, now);
      created.push({ id: sid, eventId: ev?.id || null });
    }
    this.changed();
    return { created: created.length, replaced, sessionIds: created.map((c) => c.id) };
  }

  /** Remove future planned sessions (and their calendar entries). */
  async removeFutureEvents(eid) {
    const rows = this.db.all("SELECT * FROM exam_sessions WHERE exam_id=? AND status IN ('planned','missed') AND start_at>?", eid, nowIso());
    for (const r of rows) {
      if (r.event_id) await this.s.calendar.remove(r.event_id).catch(() => {});
      this.db.run('DELETE FROM exam_sessions WHERE id=?', r.id);
    }
    // missed sessions in the past stay as history but lose their calendar entry link
    return rows.length;
  }

  async undoApply(sessionIds = []) {
    for (const sid of sessionIds) {
      const r = this.db.get('SELECT * FROM exam_sessions WHERE id=?', sid);
      if (!r) continue;
      if (r.event_id) await this.s.calendar.remove(r.event_id).catch(() => {});
      this.db.run('DELETE FROM exam_sessions WHERE id=?', sid);
    }
    this.changed();
    return true;
  }

  setSessionStatus(sid, status) {
    if (!['planned', 'done', 'missed', 'skipped'].includes(status)) throw new Error('Ungültiger Status');
    const r = this.db.get('SELECT * FROM exam_sessions WHERE id=?', sid);
    if (!r) throw new Error('Lerneinheit nicht gefunden');
    this.db.run('UPDATE exam_sessions SET status=?, updated_at=? WHERE id=?', status, nowIso(), sid);
    this.changed();
    return this.sessionPublic({ ...r, status });
  }

  /** "Ich hab heute 2 h Mathe gelernt" → today's planned session done, or an ad-hoc done entry. */
  logStudy(ref, minutes = null, topic = '') {
    const ex = this.find(ref);
    if (!ex) throw new Error('Keine passende Klausur gefunden – lege sie zuerst an.');
    const today = this.db.get("SELECT * FROM exam_sessions WHERE exam_id=? AND status IN ('planned','missed') AND start_at>=? AND start_at<? ORDER BY start_at LIMIT 1", ex.id, startOfDay().toISOString(), startOfDay(new Date(startOfDay().getTime() + DAY + 3600_000)).toISOString());
    if (today && !minutes) { this.setSessionStatus(today.id, 'done'); return { exam: ex.title, session: today.id, minutes: (Date.parse(today.end_at) - Date.parse(today.start_at)) / 60000 }; }
    const m = Math.max(10, Math.min(600, Number(minutes) || ex.sessionMinutes));
    if (today) this.setSessionStatus(today.id, 'done');
    else {
      const end = new Date(); const start = new Date(end.getTime() - m * 60000);
      this.db.run('INSERT INTO exam_sessions(id,exam_id,start_at,end_at,topic,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)', id('es'), ex.id, start.toISOString(), end.toISOString(), String(topic || 'Eigenständig gelernt').slice(0, 200), 'done', nowIso(), nowIso());
      this.changed();
    }
    return { exam: ex.title, minutes: m, hoursDone: this.get(ex.id).hoursDone, target: ex.targetHours };
  }

  /** Hourly: mark missed sessions and nudge once per exam and day. */
  checkMissed() {
    const cutoff = new Date(Date.now() - 2 * 3600_000).toISOString();
    const rows = this.db.all("SELECT s.*, e.title FROM exam_sessions s JOIN exams e ON e.id=s.exam_id WHERE s.status='planned' AND s.end_at<? AND e.archived=0", cutoff);
    const byExam = new Map();
    for (const r of rows) { this.db.run("UPDATE exam_sessions SET status='missed', updated_at=? WHERE id=?", nowIso(), r.id); byExam.set(r.exam_id, r.title); }
    for (const [eid, title] of byExam) {
      const ex = this.get(eid);
      if (!ex || ex.daysLeft < 1) continue;
      this.s.notifications.push({ category: 'study', origin: 'exam', dedupeKey: `exam-missed:${eid}:${new Date().toISOString().slice(0, 10)}`,
        title: `Lerneinheit verpasst: ${title}`,
        body: `Noch ${ex.daysLeft} Tage bis zur Klausur, ${ex.hoursDone}/${ex.targetHours} h gelernt. Sag „Jarvis, plane ${title} neu“ – ich verteile den Rest auf deine freien Zeiten.` });
    }
    if (byExam.size) this.changed();
    // Archive exams that are over
    this.db.run('UPDATE exams SET archived=1 WHERE archived=0 AND date<?', new Date(Date.now() - DAY).toISOString());
    return byExam.size;
  }

  /** Short text for the system prompt (exams within 30 days). */
  contextText() {
    const soon = this.list().filter((x) => x.daysLeft >= 0 && x.daysLeft <= 30);
    if (!soon.length) return '';
    return 'Anstehende Klausuren:\n' + soon.map((x) => `- ${x.title}${x.subject ? ' (' + x.subject + ')' : ''} am ${fmtDay(x.date)} – in ${x.daysLeft} Tagen; ${x.hoursDone}/${x.targetHours} h gelernt${x.missed ? `, ${x.missed} Einheit(en) verpasst` : ''}${x.nextSession ? `; nächste Einheit ${fmtDay(x.nextSession.start)} ${fmtTime(x.nextSession.start)}` : x.hoursPlanned ? '' : '; noch kein Lernplan'}`).join('\n');
  }

  todaySessions() {
    const from = startOfDay().toISOString(); const to = startOfDay(new Date(startOfDay().getTime() + DAY + 3600_000)).toISOString();
    return this.db.all('SELECT s.*, e.title FROM exam_sessions s JOIN exams e ON e.id=s.exam_id WHERE s.start_at>=? AND s.start_at<? ORDER BY s.start_at', from, to)
      .map((x) => ({ ...this.sessionPublic(x), exam: x.title }));
  }

  changed() { this.s.bus.emit('exams:changed', {}); }
}

/** Free intervals of ≥ dur minutes per day (08:00–22:00) outside busy ranges. */
function slotsFrom(from, to, dur, busyList) {
  const busy = busyList.map((b) => [Date.parse(b.start), Date.parse(b.end)]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (let d = startOfDay(from); d < to; d = new Date(d.getTime() + DAY + 3600_000), d = startOfDay(d)) {
    let cur = new Date(d); cur.setHours(8, 0, 0, 0);
    const end = new Date(d); end.setHours(22, 0, 0, 0);
    if (cur < from) cur = new Date(Math.ceil(from.getTime() / 900000) * 900000);
    for (const [bs, be] of busy) {
      if (be <= cur.getTime() || bs >= end.getTime()) continue;
      if (bs - cur.getTime() >= dur * 60000) out.push({ start: cur.toISOString(), end: new Date(bs).toISOString() });
      cur = new Date(Math.max(cur.getTime(), be));
    }
    if (end - cur >= dur * 60000) out.push({ start: cur.toISOString(), end: end.toISOString() });
  }
  return out;
}

module.exports = { Exams, slotsFrom };
