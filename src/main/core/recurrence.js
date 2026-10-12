'use strict';
/**
 * Recurrence rules shared by tasks and local calendar events.
 * Rule object: { freq: 'daily'|'weekly'|'monthly'|'yearly', interval?: n,
 *                byDay?: ['MO'..'SU'], until?: ISO, count?: n }
 */
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const DAY_DE = { MO: 'Mo', TU: 'Di', WE: 'Mi', TH: 'Do', FR: 'Fr', SA: 'Sa', SU: 'So' };

function normalize(rule) {
  if (!rule) return null;
  if (typeof rule === 'string') rule = fromRRule(rule);
  const freq = ['daily', 'weekly', 'monthly', 'yearly'].includes(rule.freq) ? rule.freq : null;
  if (!freq) return null;
  const out = { freq, interval: Math.max(1, Math.min(365, parseInt(rule.interval || 1, 10) || 1)) };
  if (Array.isArray(rule.byDay)) {
    const d = rule.byDay.map((x) => String(x).toUpperCase().slice(0, 2)).filter((x) => DAYS.includes(x));
    if (d.length) out.byDay = [...new Set(d)];
  }
  if (rule.until && !isNaN(Date.parse(rule.until))) out.until = new Date(rule.until).toISOString();
  if (rule.count) out.count = Math.max(1, parseInt(rule.count, 10));
  return out;
}

/** Next occurrence strictly after `after` (Date), anchored on `start`. */
function next(startIso, rule, after = new Date()) {
  rule = normalize(rule);
  if (!rule) return null;
  const start = new Date(startIso);
  if (isNaN(start)) return null;
  const until = rule.until ? new Date(rule.until) : null;
  let cur = new Date(start);
  let guard = 0;
  let n = 0;
  const step = (d) => {
    const z = new Date(d);
    if (rule.freq === 'daily') z.setDate(z.getDate() + rule.interval);
    else if (rule.freq === 'weekly') z.setDate(z.getDate() + (rule.byDay ? 1 : 7 * rule.interval));
    else if (rule.freq === 'monthly') { const day = start.getDate(); z.setDate(1); z.setMonth(z.getMonth() + rule.interval); z.setDate(Math.min(day, daysIn(z))); }
    else if (rule.freq === 'yearly') z.setFullYear(z.getFullYear() + rule.interval);
    return z;
  };
  const matches = (d) => {
    if (rule.freq !== 'weekly' || !rule.byDay) return true;
    if (!rule.byDay.includes(DAYS[d.getDay()])) return false;
    if (rule.interval > 1) {
      const weeks = Math.floor((startOfWeek(d) - startOfWeek(start)) / (7 * 86400000));
      return weeks % rule.interval === 0;
    }
    return true;
  };
  while (guard++ < 5000) {
    if (matches(cur)) {
      n++;
      if (rule.count && n > rule.count) return null;
      if (until && cur > until) return null;
      if (cur > after) return cur.toISOString();
    }
    cur = step(cur);
  }
  return null;
}

/** All occurrences in [from, to). */
function between(startIso, rule, from, to, limit = 500) {
  const out = [];
  const start = new Date(startIso);
  if (start >= from && start < to) out.push(start.toISOString());
  let cursor = new Date(Math.max(start.getTime(), from.getTime() - 1));
  if (start < from) cursor = new Date(from.getTime() - 1);
  let guard = 0;
  while (guard++ < limit) {
    const n = next(startIso, rule, cursor);
    if (!n) break;
    const d = new Date(n);
    if (d >= to) break;
    if (!out.includes(n)) out.push(n);
    cursor = d;
  }
  return out;
}

function daysIn(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
function startOfWeek(d) { const z = new Date(d); z.setHours(0, 0, 0, 0); z.setDate(z.getDate() - ((z.getDay() + 6) % 7)); return z; }

function toRRule(rule) {
  rule = normalize(rule);
  if (!rule) return null;
  let s = `RRULE:FREQ=${rule.freq.toUpperCase()}`;
  if (rule.interval > 1) s += `;INTERVAL=${rule.interval}`;
  if (rule.byDay) s += `;BYDAY=${rule.byDay.join(',')}`;
  if (rule.count) s += `;COUNT=${rule.count}`;
  if (rule.until) s += `;UNTIL=${rule.until.replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`;
  return s;
}

function fromRRule(str) {
  const body = String(str).replace(/^RRULE:/i, '');
  const parts = Object.fromEntries(body.split(';').map((p) => p.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.toUpperCase(), v]));
  const rule = { freq: (parts.FREQ || '').toLowerCase(), interval: parts.INTERVAL };
  if (parts.BYDAY) rule.byDay = parts.BYDAY.split(',').map((x) => x.replace(/^[+-]?\d+/, ''));
  if (parts.COUNT) rule.count = parts.COUNT;
  if (parts.UNTIL) {
    const u = parts.UNTIL;
    rule.until = u.length >= 8 ? `${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}T${u.length > 9 ? `${u.slice(9, 11)}:${u.slice(11, 13)}:${u.slice(13, 15)}Z` : '23:59:59Z'}` : undefined;
  }
  return rule;
}

function describe(rule) {
  rule = normalize(rule);
  if (!rule) return '';
  const every = rule.interval > 1;
  if (rule.freq === 'daily') return every ? `Alle ${rule.interval} Tage` : 'Täglich';
  if (rule.freq === 'weekly') {
    const d = rule.byDay ? ` (${rule.byDay.map((x) => DAY_DE[x]).join(', ')})` : '';
    return (every ? `Alle ${rule.interval} Wochen` : 'Wöchentlich') + d;
  }
  if (rule.freq === 'monthly') return every ? `Alle ${rule.interval} Monate` : 'Monatlich';
  return every ? `Alle ${rule.interval} Jahre` : 'Jährlich';
}

module.exports = { normalize, next, between, toRRule, fromRRule, describe };
