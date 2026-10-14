'use strict';
const { normText, safeJson, nowIso } = require('../core/util');
const log = require('../core/logger').scope('birthdays');

/**
 * Geburtstage aus dem Brain → Kalender.
 * Erkennt Geburtstage in Brain-Einträgen (feste deutsche/englische Satzmuster, kein KI-Code)
 * und legt dafür einen ganztägigen, jährlichen Termin „Geburtstag: <Name>“ an.
 * - ändert sich das Datum im Brain, wird der Termin angepasst
 * - verschwindet der Eintrag, wird nur ein von JARVIS angelegter Termin wieder entfernt
 * - existiert schon ein Geburtstagstermin mit Name + Datum (z. B. aus Google), wird nichts doppelt angelegt
 */
const MONTHS = { jan: 1, januar: 1, january: 1, jänner: 1, feb: 2, februar: 2, february: 2, mär: 3, mar: 3, märz: 3, maerz: 3, march: 3, apr: 4, april: 4, mai: 5, may: 5, jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, okt: 10, oct: 10, oktober: 10, october: 10, nov: 11, november: 11, dez: 12, dec: 12, dezember: 12, december: 12 };
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const DATE_RE = new RegExp(String.raw`(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})\.\s?(\d{1,2})\.(?:\s?(\d{4}|\d{2})\b)?|(\d{1,2})\.?\s+(${MONTH_RE})\.?(?:\s+(\d{4}))?`, 'i');
const KEYWORD = /geburtstag|geboren|\bgeb\.|birthday|b-?day/i;
const NAME = String.raw`((?:[Mm]ein(?:e|er|es)? |[Dd]ie |[Dd]er |[Uu]nser(?:e)? )?[\p{Lu}][\p{L}'’-]*(?: (?:von |van |de )?[\p{Lu}][\p{L}'’-]*){0,2})`;
const NOT_NAMES = new Set(['ich', 'der', 'die', 'das', 'am', 'im', 'er', 'sie', 'es', 'ihr', 'sein', 'seine', 'ihre', 'heute', 'morgen', 'geburtstag', 'geburtstage', 'geboren', 'birthday', 'jahrgang', 'datum', 'notiz', 'erinnerung', 'wichtig', 'hat', 'ist', 'wird', 'termin']);
const RELATIONS = /^(?:schwester|bruder|mutter|vater|mama|papa|oma|opa|tante|onkel|cousine?|freund(?:in)?|kolleg(?:e|in)|mitbewohner(?:in)?|chef(?:in)?|nichte|neffe|sohn|tochter|frau|mann|partner(?:in)?|freundin|schwager|schwägerin|patenkind|pate|patin)$/i;
const PATTERNS = [
  new RegExp(String.raw`(?:Geburtstag|Birthday)\s+(?:von|vom|of)\s+${NAME}`, 'u'),
  new RegExp(String.raw`${NAME}\s+(?:hat|has)\b[^.\n]{0,40}?\b(?:Geburtstag|birthday)`, 'u'),
  new RegExp(String.raw`${NAME}\s+(?:wurde|ist|was)\b[^.\n]{0,40}?\b(?:geboren|born)`, 'u'),
  new RegExp(String.raw`${NAME}(?:'s|’s|')?\s+(?:Geburtstag|Birthday|B-?day)\b`, 'u'),
  new RegExp(String.raw`${NAME}\s*[(,:–-]\s*(?:geb\.|geboren|Geburtstag|\*)`, 'u'),
  new RegExp(String.raw`(?:Geburtstag|Birthday|B-?day)\s*[:–-]?\s*${NAME}`, 'u'),
];

function parseDate(text) {
  const m = DATE_RE.exec(text);
  if (!m) return null;
  let d, mo, y = null;
  if (m[1]) { y = +m[1]; mo = +m[2]; d = +m[3]; } else if (m[4]) { d = +m[4]; mo = +m[5]; if (m[6]) y = m[6].length === 2 ? (+m[6] > (new Date().getFullYear() % 100) ? 1900 : 2000) + +m[6] : +m[6]; } else { d = +m[7]; mo = MONTHS[m[8].toLowerCase()]; if (m[9]) y = +m[9]; }
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  if (d > new Date(2000, mo, 0).getDate()) return null; // 2000 = Schaltjahr → 29.02. erlaubt
  if (y && (y < 1900 || y > new Date().getFullYear())) y = null;
  return { month: mo, day: d, year: y, index: m.index, length: m[0].length };
}

function cleanName(raw) {
  if (!raw) return null;
  let n = raw.trim().replace(/['’]s?$/, '').replace(/\s+/g, ' ');
  const words = n.split(' ');
  while (words.length && NOT_NAMES.has(words[words.length - 1].toLowerCase())) words.pop();
  n = words.join(' ');
  if (!n || NOT_NAMES.has(n.toLowerCase()) || n.length < 2) return null;
  if (/^mein(e|er|es)?$/i.test(n)) return null;
  n = n.replace(/^(?:mein(?:e|er|es)?|unser(?:e)?|die|der) /i, '');
  const w = n.split(' ');
  if (w.length >= 2 && RELATIONS.test(w[0])) n = `${w.slice(1).join(' ')} (${w[0]})`;
  return n.length >= 2 ? n : null;
}

/** Find birthdays in a piece of text. Returns [{ name, month, day, year }]. */
function findBirthdays(text, { title = '' } = {}) {
  const out = [];
  const lines = [];
  for (const raw of String(text || '').split(/\n|(?<=\p{Ll}{2}[.!?])\s+(?=\p{Lu})/u)) {
    // „Mama hat am 24.12. Geburtstag und Papa am 1.1.“ → zwei Abschnitte, Stichwort gilt für beide
    const parts = (raw.match(new RegExp(DATE_RE.source, 'gi')) || []).length > 1 ? raw.split(/\s+und\s+|\s*[;,]\s+(?=\p{Lu})/u) : [raw];
    for (const p of parts) lines.push({ text: p, kw: KEYWORD.test(raw), multi: parts.length > 1 });
  }
  const titleIsList = /geburtstag|birthday/i.test(title);
  for (const { text: line, kw, multi } of lines) {
    const date = parseDate(line);
    if (!date) continue;
    let name = null;
    if (kw) {
      const plain = line.slice(0, date.index) + ' ' + line.slice(date.index + date.length);
      for (const re of PATTERNS) { const m = re.exec(plain); if (m && (name = cleanName(m[1]))) break; }
      if (!name && multi) { const m = new RegExp(String.raw`^\s*${NAME}\s+(?:am|on|:)`, 'u').exec(plain); if (m) name = cleanName(m[1]); }
      if (!name && /\b(?:ich|mein(?:em)?)\b/i.test(line.slice(0, date.index)) && /\b(?:ich habe|ich hab|ich bin|ich wurde|mein(?:em)? (?:Geburtstag|Geburtsdatum))\b/i.test(line)) name = 'ich';
    }
    if (!name && titleIsList) {
      // Listen wie „Geburtstage“ → „Max: 12.03.“ / „Lisa – 4. Mai“
      const m = new RegExp(String.raw`^\s*[-•*]?\s*${NAME}\s*[:–-]`, 'u').exec(line);
      if (m) name = cleanName(m[1]);
    }
    if (!name && KEYWORD.test(title) && !kw && lines.length <= 2) {
      const m = new RegExp(String.raw`(?:Geburtstag|Birthday)\s*(?:von|vom|of|:|–|-)?\s*${NAME}`, 'u').exec(title);
      if (m) name = cleanName(m[1]);
    }
    if (name) out.push({ name, month: date.month, day: date.day, year: date.year });
  }
  return out;
}

const pad = (n) => String(n).padStart(2, '0');
const label = (name) => (name === 'ich' ? 'Mein Geburtstag' : `Geburtstag: ${name}`);

class Birthdays {
  constructor(s) {
    this.s = s; this.timer = null; this.running = null;
    s.bus.on('brain:changed', () => this.schedule());
  }

  enabled() { return this.s.settings.get('birthdaysToCalendar') !== false; }
  state() { return safeJson(this.s.system.meta('birthdays:map'), {}) || {}; }
  saveState(m) { this.s.system.setMeta('birthdays:map', JSON.stringify(m)); }

  schedule(ms = 2000) {
    if (!this.enabled()) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync().catch((e) => log.warn('Geburtstage nicht übernommen', e)), ms);
    this.timer.unref?.();
  }
  stop() { clearTimeout(this.timer); }

  /** Birthdays currently found in the Brain, keyed by normalized name. */
  collect() {
    const rows = this.s.db.all("SELECT id,title,content FROM knowledge WHERE archived=0 AND (content LIKE '%eburtstag%' OR content LIKE '%eboren%' OR content LIKE '%geb.%' OR content LIKE '%irthday%' OR content LIKE '%-day%' OR title LIKE '%eburtstag%' OR title LIKE '%irthday%')");
    const found = {};
    for (const r of rows) {
      for (const b of findBirthdays(r.content, { title: r.title })) {
        const key = normText(b.name);
        // neuere Einträge gewinnen nicht automatisch – erster Fund mit Jahr bevorzugt
        if (!found[key] || (!found[key].year && b.year)) found[key] = { ...b, kid: r.id };
      }
    }
    return found;
  }

  /** Existing birthday event for this person on this day (e.g. from Google Contacts). */
  existing(name, month, day) {
    const nn = normText(name === 'ich' ? 'mein geburtstag' : name);
    const rows = this.s.db.all("SELECT id,title,start_at,all_day,rrule FROM events WHERE (event_type='birthday' OR title LIKE '%eburtstag%' OR title LIKE '%irthday%')");
    return rows.find((e) => {
      const d = new Date(e.start_at);
      return normText(e.title).includes(nn) && d.getMonth() + 1 === month && d.getDate() === day;
    }) || null;
  }

  async sync() {
    if (this.running) return this.running;
    this.running = this._sync().finally(() => { this.running = null; });
    return this.running;
  }

  async _sync() {
    if (!this.enabled()) return { created: 0, updated: 0, removed: 0 };
    const found = this.collect();
    const map = this.state();
    let created = 0, updated = 0, removed = 0;
    const year = new Date().getFullYear();
    for (const [key, b] of Object.entries(found)) {
      const date = `${pad(b.month)}-${pad(b.day)}`;
      const prev = map[key];
      const desc = `Aus deinem JARVIS-Brain${b.year ? ` · geboren ${b.year}` : ''}`;
      const start = new Date(year, b.month - 1, b.day).toISOString();
      const ev = prev?.eventId ? this.s.db.get('SELECT id FROM events WHERE id=?', prev.eventId) : null;
      if (ev) {
        if (prev.date !== date || prev.year !== b.year) {
          await this.s.calendar.update(prev.eventId, { start, allDay: true, description: desc });
          map[key] = { ...prev, date, year: b.year, kid: b.kid, at: nowIso() }; updated++;
        }
        continue;
      }
      if (prev?.eventId && !ev) { map[key] = { ...prev, eventId: null, userDeleted: true }; continue; } // Nutzer hat den Termin gelöscht → nicht neu anlegen
      if (prev?.userDeleted && prev.date === date) continue;
      if (this.existing(b.name, b.month, b.day)) { map[key] = { name: b.name, date, year: b.year, kid: b.kid, eventId: null, external: true }; continue; }
      const e = await this.s.calendar.create({ title: label(b.name), start, allDay: true, recurrence: { freq: 'yearly' }, description: desc });
      map[key] = { name: b.name, date, year: b.year, kid: b.kid, eventId: e.id, at: nowIso() }; created++;
      this.s.notifications?.push?.({ category: 'calendar', origin: 'system', dedupeKey: 'bday:' + key + ':' + date, title: '🎂 Geburtstag eingetragen', body: `${b.name === 'ich' ? 'Dein Geburtstag' : b.name} – ${b.day}.${b.month}. (jährlich)` });
    }
    for (const [key, m] of Object.entries(map)) {
      if (found[key]) continue;
      if (m.eventId && this.s.db.get('SELECT id FROM events WHERE id=?', m.eventId)) {
        try { await this.s.calendar.remove(m.eventId); removed++; } catch (e) { log.warn('Geburtstagstermin nicht entfernt', e); continue; }
      }
      delete map[key];
    }
    this.saveState(map);
    if (created || updated || removed) log.info(`Geburtstage: ${created} neu, ${updated} geändert, ${removed} entfernt`);
    return { created, updated, removed, total: Object.keys(found).length };
  }

  /** Nächste Geburtstage (Tage bis dahin, Alter falls Jahr bekannt). */
  upcoming(days = 60, now = new Date()) {
    const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Object.values(this.collect()).filter((b) => b.name !== 'ich').map((b) => {
      let d = new Date(t0.getFullYear(), b.month - 1, b.day); if (d < t0) d = new Date(t0.getFullYear() + 1, b.month - 1, b.day);
      const inDays = Math.round((d - t0) / 86400000);
      return { name: b.name, month: b.month, day: b.day, date: `${d.getFullYear()}-${String(b.month).padStart(2, '0')}-${String(b.day).padStart(2, '0')}`, inDays, turns: b.year ? d.getFullYear() - b.year : null, ideas: safeJson(this.s.system.meta(`birthday:gifts:${normText(b.name)}:${d.getFullYear()}`), null) };
    }).filter((b) => b.inDays <= days).sort((a, b) => a.inDays - b.inDays);
  }

  /** Was im Brain über die Person steht (für Geschenkideen). */
  facts(name) {
    const first = String(name).replace(/\s*\(.*\)$/, '').split(' ')[0];
    if (first.length < 2) return [];
    return this.s.db.all("SELECT title, content FROM knowledge WHERE archived=0 AND (title LIKE ? OR content LIKE ?) ORDER BY updated_at DESC LIMIT 12", `%${first}%`, `%${first}%`)
      .map((r) => `${r.title ? r.title + ': ' : ''}${String(r.content).slice(0, 300)}`);
  }

  /** Geschenkideen aus den Brain-Einträgen (KI, einmal pro Person und Jahr gespeichert). */
  async giftIdeas(name, { force = false } = {}) {
    const b = this.upcoming(366).find((x) => normText(x.name) === normText(name));
    const year = b ? b.date.slice(0, 4) : String(new Date().getFullYear());
    const key = `birthday:gifts:${normText(name)}:${year}`;
    if (!force) { const c = safeJson(this.s.system.meta(key), null); if (c) return c; }
    const facts = this.facts(name);
    const r = await this.s.gemini.generate({ feature: 'life', model: this.s.gemini.requireModel('fast'), temperature: 0.7, json: true,
      schema: { type: 'object', required: ['ideas'], properties: { ideas: { type: 'array', items: { type: 'object', required: ['idea', 'why'], properties: { idea: { type: 'string' }, why: { type: 'string' }, budget: { type: 'string' } } } } } },
      system: 'Du schlägst 4 konkrete, persönliche Geschenkideen auf Deutsch vor. Begründe jede kurz mit dem, was über die Person bekannt ist (nur aus den Notizen, nichts erfinden). Gibt es wenig Infos, sag das in why und schlag eher Universelles vor. Studentenbudget beachten (meist 10–40 €).',
      contents: [{ role: 'user', parts: [{ text: `Person: ${name}${b?.turns ? ` (wird ${b.turns})` : ''}\nNotizen aus meinem Brain:\n${facts.length ? facts.map((f) => '- ' + f).join('\n') : '(keine weiteren Notizen)'}` }] }] });
    const out = { at: new Date().toISOString(), basedOn: facts.length, ideas: (r?.ideas || []).slice(0, 4) };
    this.s.system.setMeta(key, JSON.stringify(out));
    return out;
  }

  /** Täglich: 7 Tage vorher Erinnerung (mit Geschenkideen, wenn Gemini verfügbar), am Vortag nochmal kurz. */
  async remind(now = new Date()) {
    if (this.s.settings.get('life')?.birthdayGifts === false) return 0;
    let n = 0;
    for (const b of this.upcoming(7, now)) {
      if (b.inDays === 7) {
        let ideas = null;
        if (this.s.gemini.hasKey()) ideas = await this.giftIdeas(b.name).catch((e) => { log.debug('gifts', e); return null; });
        const body = `${b.name} hat am ${b.day}.${b.month}. Geburtstag${b.turns ? ` (wird ${b.turns})` : ''}.${ideas?.ideas?.length ? ' Ideen: ' + ideas.ideas.map((x) => x.idea).join(' · ') : ''}`;
        if (this.s.notifications.push({ category: 'system', origin: 'system', dedupeKey: `bday7:${normText(b.name)}:${b.date}`, title: `In einer Woche: Geburtstag von ${b.name}`, body })) n++;
      }
      if (b.inDays === 1 && this.s.notifications.push({ category: 'system', origin: 'system', dedupeKey: `bday1:${normText(b.name)}:${b.date}`, title: `Morgen: Geburtstag von ${b.name}`, body: 'Geschenk besorgt?' })) n++;
    }
    return n;
  }

  list() {
    const map = this.state();
    return Object.values(this.collect()).map((b) => ({ ...b, eventId: map[normText(b.name)]?.eventId || null, external: !!map[normText(b.name)]?.external }));
  }
}

module.exports = { Birthdays, findBirthdays, parseDate };
