'use strict';
/**
 * „Was hab ich heute/morgen/nächste Woche zu tun?“ – sofort und ohne KI aus Kalender und Aufgaben beantwortet.
 * Kleine lokale Modelle haben bei solchen Fragen Zeiträume verwechselt, UTC-Zeiten falsch umgerechnet und Termine erfunden;
 * außerdem dauerte es Minuten. Aktionen („trag … ein“, „plane …“) gehen weiter an die KI.
 */
const DAYS = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];
const DAY_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const at = (d, n = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const nextMonday = (d) => at(d, ((8 - d.getDay()) % 7) || 7);

/** → { from, to, label } oder null */
function parseAgendaQuery(text, now = new Date()) {
  const t = String(text || '').toLowerCase().replace(/^(?:hey\s+)?jarvis[,!.\s]+/, '').trim();
  if (!t || t.length > 140) return null;
  if (/(?<![a-zäöüß])(?:trag\w*|eintrag\w*|plan\w*|verschieb\w*|lösch\w*|erstell\w*|leg\w* .{0,20}an|erinner\w*|füg\w*|setz\w*|mach mir|buch\w*)(?![a-zäöüß])/.test(t)) return null;
  const intent = /(?<![a-zäöüß])(?:zu tun|an ?(?:steht|stehen)|ansteht|steht .{0,25}an|vor ?(?:habe|hab)|vor\?|geplant|termine?|aufgaben|programm|los|frei|beschäftigt|uni|vorlesung\w*)(?![a-zäöüß])/.test(t)
    && /(?<![a-zäöüß])(?:was|welche\w*|wie sieht|hab ich|habe ich|zeig|sag mir|gibt'?s|gibt es|steht|stehen|mein\w*)(?![a-zäöüß])/.test(t);
  if (!intent && !/was (?:kann|soll|muss) ich .{0,25}(?:tun|machen)/.test(t)) return null;
  const today = at(now);
  if (/(?<![a-zäöüß])übermorgen(?![a-zäöüß])/.test(t)) return { from: at(today, 2), to: at(today, 3), label: 'Übermorgen' };
  if (/(?<![a-zäöüß])morgen(?![a-zäöüß])/.test(t) && !/(?<![a-zäöüß])(?:heute )?morgen früh(?![a-zäöüß])/.test(t.replace('übermorgen', ''))) return { from: at(today, 1), to: at(today, 2), label: 'Morgen' };
  if (/(?:nächste|naechste|kommende)n? woche/.test(t)) { const m = nextMonday(today); return { from: m, to: at(m, 7), label: 'Nächste Woche' }; }
  if (/(?:diese|dieser|der) woche|die woche|restliche woche|rest der woche/.test(t)) return { from: today, to: nextMonday(today), label: 'Diese Woche' };
  if (/wochenende/.test(t)) { const sat = at(today, (6 - today.getDay() + 7) % 7); return { from: today.getDay() === 0 ? today : sat, to: at(today.getDay() === 0 ? today : sat, today.getDay() === 0 ? 1 : 2), label: 'Am Wochenende' }; }
  const wd = DAYS.findIndex((d) => new RegExp('(?<![a-zäöüß])(?:am )?' + d + '(?![a-zäöüß])').test(t));
  if (wd >= 0) { const d = at(today, (wd - today.getDay() + 7) % 7); return { from: d, to: at(d, 1), label: wd === today.getDay() ? 'Heute' : 'Am ' + DAYS[wd][0].toUpperCase() + DAYS[wd].slice(1) }; }
  if (/(?<![a-zäöüß])heute(?![a-zäöüß])|(?<![a-zäöüß])jetzt(?![a-zäöüß])|(?<![a-zäöüß])gerade(?![a-zäöüß])/.test(t) || /was (?:kann|soll) ich .{0,20}tun/.test(t)) return { from: today, to: at(today, 1), label: 'Heute' };
  return null;
}

const hm = (iso) => { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const dayHead = (d) => `${DAY_SHORT[d.getDay()] === 'So' ? 'Sonntag' : DAYS[d.getDay()][0].toUpperCase() + DAYS[d.getDay()].slice(1)}, ${d.getDate()}.${d.getMonth() + 1}.`;
const place = (loc) => String(loc || '').split(',')[0].trim().slice(0, 40);

/** Antworttext (Markdown) für den Zeitraum. */
function buildAgenda(s, { from, to, label }, now = new Date()) {
  const events = s.calendar.list(from, to);
  const tasks = s.tasks.list({ filter: 'all', limit: 500 }).filter((x) => x.dueAt && Date.parse(x.dueAt) >= from.getTime() && Date.parse(x.dueAt) < to.getTime());
  const days = Math.round((to - from) / 86400000);
  const range = days > 1 ? ` (${from.getDate()}.${from.getMonth() + 1}. – ${at(to, -1).getDate()}.${at(to, -1).getMonth() + 1}.)` : ` (${dayHead(from)})`;
  const out = [`**${label}${range}**`];
  let any = false;
  for (let d = from; d < to; d = at(d, 1)) {
    const a = d.getTime(); const b = at(d, 1).getTime();
    const ev = events.filter((e) => Date.parse(e.start) < b && Date.parse(e.end) > a && !(e.allDay && Date.parse(e.start) < a));
    const tk = tasks.filter((x) => Date.parse(x.dueAt) >= a && Date.parse(x.dueAt) < b);
    if (!ev.length && !tk.length) continue;
    any = true;
    if (days > 1) out.push('', `**${dayHead(d)}**`);
    for (const e of ev) out.push(`- ${e.allDay ? 'ganztägig' : hm(e.start) + '–' + hm(e.end)} ${e.title}${place(e.location) ? ' (' + place(e.location) + ')' : ''}`);
    for (const x of tk) out.push(`- ☐ ${x.title}${x.allDay ? '' : ' (bis ' + hm(x.dueAt) + ')'}`);
  }
  if (!any) out.push('', days > 1 ? 'Keine Termine und keine fälligen Aufgaben in diesem Zeitraum.' : 'Keine Termine und keine fälligen Aufgaben.');
  if (from.getTime() <= now.getTime() && now.getTime() < to.getTime()) {
    const overdue = s.tasks.counts?.().overdue || 0;
    if (overdue) out.push('', `Dazu ${overdue === 1 ? 'eine überfällige Aufgabe' : overdue + ' überfällige Aufgaben'}.`);
  }
  return out.join('\n');
}

module.exports = { parseAgendaQuery, buildAgenda };
