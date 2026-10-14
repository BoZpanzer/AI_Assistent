'use strict';
const { sha256 } = require('../core/util');
const { sapValue, courseName, zonedToUtc } = require('./ics');
const { parseMetadata } = require('./campusresults');
const log = require('../core/logger').scope('campusexams');

/**
 * Prüfungen aus Campus Dual automatisch in den Klausurmodus übernehmen.
 * Quellen:
 *  1. Stundenplan-Abos (Campus Dual oder als Vorlesungsplan markiert): Termine mit „Klausur“, „Prüfung“, „Exam“, „Testat“ im Titel (ohne „Vorbereitung“/„Einsicht“).
 *  2. Prüfungsanmeldung (ZBA_EXAM_REGISTRATION_SRV): Listen werden wie bei den Ergebnissen über $metadata gesucht.
 * Neue Prüfungen werden als Klausur angelegt (nur lokal, umkehrbar). Lerneinheiten werden NICHT automatisch
 * eingetragen – der Klausurmodus schlägt sie vor, der Nutzer bestätigt.
 */
const SRV = '/sap/opu/odata/sap/ZBA_EXAM_REGISTRATION_SRV';
const EXAM_TITLE = /(klausur|prüfung|pruefung|\bexam\b|testat|\bmündl)/i;
const NOT_EXAM = /(vorbereitung|einsicht|anmeldung|abmeldung|nachbesprechung|repetitorium)/i;
const SET_RE = /exam|pruef|prüf|registr|booking|appoint|termin|leistung/i;

/** Prüfungstermine aus beliebigen OData-Datensätzen (Titel + Datum/Uhrzeit + Raum heuristisch). */
function examsFromRecords(records, zone = 'Europe/Berlin') {
  const list = (records || []).map((r) => Object.fromEntries(Object.entries(r || {}).filter(([k, v]) => k !== '__metadata' && (v === null || typeof v !== 'object'))));
  if (!list.length) return [];
  const keys = Object.keys(list[0]);
  const kind = (k) => list.map((r) => sapValue(String(r[k] ?? ''))).find(Boolean)?.kind;
  const dateK = keys.find((k) => ['date', 'datetime'].includes(kind(k)) && /(exam|pruef|prüf|termin|date|datum|beg|start)/i.test(k) && !/(anmeld|regist|book|end|bis|deadline|frist|changed|created)/i.test(k));
  const timeK = keys.find((k) => kind(k) === 'time' && /(beg|start|von|zeit|time|uhr)/i.test(k));
  const str = (re, not) => keys.find((k) => re.test(k) && !(not && not.test(k)) && list.some((r) => typeof r[k] === 'string' && r[k].trim() && !sapValue(r[k]) && !/^\d+$/.test(r[k].trim())));
  const titleK = str(/(stext|title|titel|modul|module|short|text|name|bez|description|course|exam)/i, /(id$|key$|nr$|status|room|raum|type)/i);
  const roomK = str(/(room|raum|ort|location|gebaeude)/i);
  if (!dateK || !titleK) return [];
  const out = [];
  for (const r of list) {
    const d = sapValue(String(r[dateK] ?? '')); if (!d) continue;
    const t = timeK ? sapValue(String(r[timeK] ?? '')) : null;
    const h = t ? t.h : d.kind === 'datetime' ? d.h : 8; const mi = t ? t.mi : d.kind === 'datetime' ? d.mi : 0;
    const iso = d.kind === 'datetime' && d.utc && d.ms != null && !t ? new Date(d.ms).toISOString() : new Date(zonedToUtc(d.y, d.mo, d.d, h, mi, 0, zone)).toISOString();
    out.push({ title: String(r[titleK]).trim(), date: iso, room: roomK ? String(r[roomK] || '').trim() : '', timeKnown: !!t || d.kind === 'datetime', source: 'Campus Dual (Prüfungsanmeldung)' });
  }
  return out;
}

class CampusExams {
  constructor(s) { this.s = s; this.busy = null; }
  enabled() { return this.s.settings.get('campusDualExams')?.enabled !== false; }
  map() { try { return JSON.parse(this.s.system.meta('campusdual:exams:map') || '{}'); } catch { return {}; } }
  saveMap(m) { this.s.system.setMeta('campusdual:exams:map', JSON.stringify(m)); }

  /** Klausurtermine aus dem Campus-Dual-Stundenplan (lokale Kopie, kein Netz). */
  fromTimetable() {
    const feeds = this.s.db.all("SELECT id FROM calendar_feeds WHERE kind IN ('campusdual','campusdual-session') OR lecture=1").map((f) => 'feed:' + f.id);
    if (!feeds.length) return [];
    const evs = this.s.calendar.list(new Date().toISOString(), new Date(Date.now() + 400 * 86400000).toISOString(), { calendars: feeds });
    return evs.filter((e) => EXAM_TITLE.test(e.title || '') && !NOT_EXAM.test(e.title || '')).map((e) => ({ title: e.title, date: e.start, room: e.location || '', timeKnown: !e.allDay, source: 'Campus-Dual-Stundenplan' }));
  }

  /** Prüfungsanmeldungen aus Campus Dual (nur mit Anmeldung; Feldnamen werden zur Anpassung gemerkt). */
  async fromService() {
    const feeds = this.s.feeds;
    const xml = await feeds.campusDualGet(`${SRV}/$metadata?sap-client=100`, { json: false });
    const sets = parseMetadata(xml).map((x) => x.name).filter((n) => SET_RE.test(n) && !/(tile|parameter)/i.test(n)).slice(0, 6);
    const out = []; const sources = [];
    for (const name of sets) {
      try {
        const j = await feeds.campusDualJson(`${SRV}/${name}?sap-client=100&$top=500`);
        const recs = j?.d?.results || [];
        sources.push({ set: name, count: recs.length, fields: recs[0] ? Object.keys(recs[0]).filter((k) => k !== '__metadata') : [] });
        out.push(...examsFromRecords(recs));
      } catch (e) { if (e.expired) throw e; sources.push({ set: name, count: 0, error: e.message.slice(0, 120) }); }
    }
    this.s.system.setMeta('campusdual:exams:sources', JSON.stringify(sources));
    return out;
  }

  sync({ withService = true } = {}) {
    if (!this.busy) this.busy = this._sync({ withService }).finally(() => { this.busy = null; });
    return this.busy;
  }

  async _sync({ withService }) {
    if (!this.enabled()) return { skipped: 'disabled' };
    let found = this.fromTimetable();
    let serviceError = null;
    if (withService && this.s.campusResults && (await this.s.campusResults.available())) {
      try { found = found.concat(await this.fromService()); } catch (e) { serviceError = e.message; log.info('Prüfungsanmeldung nicht lesbar: ' + e.message); }
    }
    const now = Date.now();
    const upcoming = found.filter((x) => Date.parse(x.date) > now && x.title);
    // gleiche Prüfung aus beiden Quellen nur einmal (Kursname + Tag)
    const byKey = new Map();
    for (const x of upcoming) {
      const k = sha256(courseName(x.title).toLowerCase() + '|' + x.date.slice(0, 10)).slice(0, 16);
      if (!byKey.has(k) || (!byKey.get(k).timeKnown && x.timeKnown)) byKey.set(k, { ...x, key: k });
    }
    const map = this.map();
    const created = []; const moved = [];
    for (const x of byKey.values()) {
      // Gleiche Prüfung mit verschobenem Datum? → Zuordnung über den Kursnamen
      const course = courseName(x.title).toLowerCase();
      const prevKey = map[x.key] ? x.key : Object.keys(map).find((k) => map[k].course === course && map[k].date !== x.date && Date.parse(map[k].date) > now);
      const examId = prevKey ? map[prevKey].examId : null;
      const ex = examId ? this.s.exams.get(examId) : null;
      if (ex) {
        if (ex.date !== new Date(x.date).toISOString()) { this.s.exams.update(ex.id, { date: x.date }); moved.push({ ...x, from: ex.date }); }
        if (prevKey !== x.key) delete map[prevKey];
        map[x.key] = { examId: ex.id, course, date: x.date };
        continue;
      }
      if (prevKey && !ex) continue; // vom Nutzer gelöscht → nicht wieder anlegen
      try {
        const e = this.s.exams.create({ title: x.title.slice(0, 160), subject: courseName(x.title).slice(0, 120), date: x.date, notes: [`Aus ${x.source} übernommen.`, x.room ? `Raum: ${x.room}` : '', x.timeKnown ? '' : 'Uhrzeit unbekannt – bitte prüfen.'].filter(Boolean).join(' ').slice(0, 2000) });
        map[x.key] = { examId: e.id, course, date: x.date };
        created.push({ ...x, examId: e.id });
      } catch (err) { log.warn('Klausur nicht angelegt', err); }
    }
    this.saveMap(map);
    const fmt = (iso) => new Date(iso).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
    if (created.length) this.s.notifications.push({ category: 'study', origin: 'system', dedupeKey: 'cd-exams:' + created.map((c) => c.key).join(','), title: created.length === 1 ? 'Neue Prüfung aus Campus Dual' : `${created.length} neue Prüfungen aus Campus Dual`, body: created.slice(0, 4).map((c) => `${c.title} am ${fmt(c.date)}`).join(' · ') + ' – im Klausurmodus angelegt. Dort kannst du dir einen Lernplan vorschlagen lassen.' });
    if (moved.length) this.s.notifications.push({ category: 'study', origin: 'system', dedupeKey: 'cd-exams-moved:' + moved.map((c) => c.key).join(','), title: 'Prüfungstermin geändert', body: moved.slice(0, 4).map((c) => `${c.title}: jetzt ${fmt(c.date)} (vorher ${fmt(c.from)})`).join(' · ') });
    this.s.system.setMeta('campusdual:exams:status', JSON.stringify({ at: new Date().toISOString(), found: byKey.size, created: created.length, moved: moved.length, serviceError }));
    return { found: byKey.size, created, moved, serviceError };
  }
}

module.exports = { CampusExams, examsFromRecords, EXAM_TITLE };
