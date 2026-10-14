'use strict';
/**
 * Rise of Kingdoms – Speedup-Rechner (reine Rechnung, keine Spieldaten aus dem Netz):
 * Inventar je Typ (Universal, Bau, Forschung, Training, Heilung) und Dauer, per Screenshot oder Ansage gepflegt.
 * „Reicht es?“ → typgebundene Speedups zuerst, dann Universal; möglichst wenig Überschuss.
 */
const TYPES = { universal: 'Universal', building: 'Bau', research: 'Forschung', training: 'Training', healing: 'Heilung' };
const DURATIONS = [1, 5, 10, 15, 30, 60, 180, 480, 900, 1440, 4320, 10080, 43200]; // Minuten (1 min … 30 Tage)
const KEY = 'rok:speedups';

function fmtMin(m) {
  m = Math.round(m); const d = Math.floor(m / 1440); const h = Math.floor((m % 1440) / 60); const mm = m % 60;
  return [d ? d + ' T' : '', h ? h + ' h' : '', mm || (!d && !h) ? mm + ' min' : ''].filter(Boolean).join(' ');
}
/** „3d 4h 20m“, „2 Tage 5 Std“, „90“ (Minuten), „1:30:00“ → Minuten. */
function parseDuration(v) {
  if (typeof v === 'number') return v;
  const s = String(v || '').toLowerCase().trim();
  const hms = s.match(/^(?:(\d+)d\s*)?(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
  if (hms) return (Number(hms[1] || 0) * 1440) + Number(hms[2]) * 60 + Number(hms[3]) + Number(hms[4] || 0) / 60;
  let total = 0; let hit = false;
  for (const [re, f] of [[/(\d+(?:[.,]\d+)?)\s*(?:d|t|tag|tage|day|days)\b/, 1440], [/(\d+(?:[.,]\d+)?)\s*(?:h|std|stunde|stunden|hour|hours)\b/, 60], [/(\d+(?:[.,]\d+)?)\s*(?:m|min|minute|minuten)\b/, 1], [/(\d+(?:[.,]\d+)?)\s*(?:s|sek|sekunden)\b/, 1 / 60]]) {
    const m = s.match(re); if (m) { total += parseFloat(m[1].replace(',', '.')) * f; hit = true; }
  }
  if (hit) return total;
  if (/^\d+(?:[.,]\d+)?$/.test(s)) return parseFloat(s.replace(',', '.'));
  throw new Error('Dauer nicht verstanden: ' + v);
}

class Rok {
  constructor(s) { this.s = s; }
  inventory() {
    let inv = {}; try { inv = JSON.parse(this.s.gaming.context.getState(KEY) || '{}'); } catch { inv = {}; }
    const out = {}; for (const t of Object.keys(TYPES)) out[t] = Object.fromEntries(DURATIONS.map((d) => [d, Number(inv[t]?.[d] || 0)]));
    return out;
  }
  totals(inv = this.inventory()) { return Object.fromEntries(Object.keys(TYPES).map((t) => [t, DURATIONS.reduce((a, d) => a + d * inv[t][d], 0)])); }
  /** entries: [{ type, minutes|duration, count }] – setzt die Anzahl (nicht addieren). */
  set(entries) {
    const inv = this.inventory();
    for (const e of entries || []) {
      if (!TYPES[e.type]) throw new Error('Typ unbekannt: ' + e.type);
      const m = Math.round(parseDuration(e.minutes ?? e.duration));
      if (!DURATIONS.includes(m)) throw new Error(`Diese Speedup-Dauer gibt es nicht: ${fmtMin(m)}`);
      const n = Math.max(0, Math.floor(Number(e.count) || 0));
      inv[e.type][m] = n;
    }
    this.s.gaming.context.setState(KEY, inv);
    this.s.bus.emit('game:data', { game: 'rok' });
    return this.state();
  }
  state() { const inv = this.inventory(); const t = this.totals(inv); return { inventory: inv, totals: t, totalsText: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, fmtMin(v)])), types: TYPES, durations: DURATIONS }; }

  /** Reicht es für need Minuten (type: building/research/training/healing)? */
  calc(type, need, inv = this.inventory()) {
    if (!TYPES[type] || type === 'universal') throw new Error('Typ: building, research, training oder healing');
    let rest = Math.round(parseDuration(need));
    const needMin = rest;
    const use = [];
    const pool = [...DURATIONS.map((d) => ({ type, d, n: inv[type][d] })), ...DURATIONS.map((d) => ({ type: 'universal', d, n: inv.universal[d] }))].filter((x) => x.n > 0);
    const take = (x, k) => { use.push({ type: x.type, minutes: x.d, count: k }); x.n -= k; rest -= k * x.d; };
    // 1) typgebundene Speedups zuerst: größte, die nicht über das Ziel hinausschießen
    for (const x of pool.filter((p) => p.type === type).sort((a, b) => b.d - a.d)) { const k = Math.min(x.n, Math.floor(rest / x.d)); if (k > 0) take(x, k); }
    // 2) Rest: Variante A (auffüllen + kleinster passender) gegen Variante B (ein einzelner passender) – weniger Überschuss gewinnt
    if (rest > 0) {
      const sim = (greedy) => {
        const p2 = pool.map((x) => ({ ...x })); let r = rest; const u = [];
        if (greedy) for (const x of p2.filter((q) => q.n > 0).sort((a, b) => b.d - a.d || (a.type === type ? -1 : 1))) { const k = Math.min(x.n, Math.floor(r / x.d)); if (k > 0) { u.push([x, k]); x.n -= k; r -= k * x.d; } }
        if (r > 0) { const fit = p2.filter((x) => x.n > 0 && x.d >= r).sort((a, b) => a.d - b.d || (a.type === type ? -1 : 1))[0]; if (fit) { u.push([fit, 1]); fit.n--; r -= fit.d; } }
        return { u, r, items: u.reduce((a, [, k]) => a + k, 0) };
      };
      const A = sim(true); const B = sim(false);
      const pick = B.r <= 0 && (A.r > 0 || -B.r < -A.r || (-B.r === -A.r && B.items < A.items)) ? B : A;
      for (const [x, k] of pick.u) take(pool.find((q) => q.type === x.type && q.d === x.d), k);
    }
    const merged = [];
    for (const u of use) { const m = merged.find((x) => x.type === u.type && x.minutes === u.minutes); if (m) m.count += u.count; else merged.push({ ...u }); }
    const t = this.totals(inv); const have = t[type] + t.universal;
    return {
      type, typeLabel: TYPES[type], need: needMin, needText: fmtMin(needMin), have, haveText: fmtMin(have), enough: rest <= 0,
      missing: rest > 0 ? rest : 0, missingText: rest > 0 ? fmtMin(rest) : null, overshoot: rest < 0 ? -rest : 0,
      plan: merged.map((u) => ({ ...u, label: `${u.count}× ${fmtMin(u.minutes)} ${TYPES[u.type]}` })),
    };
  }
}

module.exports = { Rok, parseDuration, fmtMin, TYPES, DURATIONS };
