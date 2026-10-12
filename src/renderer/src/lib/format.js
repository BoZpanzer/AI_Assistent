const DE = 'de-DE';
export const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString(DE, { hour: '2-digit', minute: '2-digit' }) : '');
export const fmtDate = (iso, o = { day: '2-digit', month: '2-digit', year: 'numeric' }) => (iso ? new Date(iso).toLocaleDateString(DE, o) : '');
export const fmtDateLong = (d = new Date()) => new Date(d).toLocaleDateString(DE, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString(DE, { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

export function isToday(iso) { const d = new Date(iso); const n = new Date(); return d.toDateString() === n.toDateString(); }
export function relDay(iso) {
  if (!iso) return '';
  const d = new Date(iso); const n = new Date();
  const diff = Math.round((new Date(d.toDateString()) - new Date(n.toDateString())) / 86400000);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  if (diff === -1) return 'Gestern';
  return fmtDate(iso, { day: '2-digit', month: 'short' });
}
export function ago(iso) {
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.round(s / 60)} Min`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} Std.`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'vor 1 Tag' : `vor ${d} Tagen`;
}
export function countdown(iso) {
  let s = Math.max(0, Math.round((new Date(iso) - Date.now()) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  if (d) return `${d}T ${h}h ${String(m).padStart(2, '0')}m`;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
export const PRIO = { high: 'Hoch', medium: 'Mittel', low: 'Niedrig' };
export const PRIO_COLOR = { high: 'var(--red)', medium: 'var(--yellow)', low: 'var(--text-3)' };
export function catColor(cat) {
  const map = { studium: '#38bdf8', gesundheit: '#4ade80', organisation: '#94a3b8', persönlich: '#38bdf8', privat: '#a78bfa', gaming: '#f472b6', arbeit: '#fb923c', routine: '#4ade80' };
  return map[String(cat || '').toLowerCase()] || '#22d3ee';
}
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fromLocalInput(v) { return v ? new Date(v).toISOString() : null; }
