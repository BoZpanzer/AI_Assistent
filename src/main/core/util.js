'use strict';
const crypto = require('node:crypto');

/** Short, sortable, collision-safe id. */
function id(prefix = '') {
  const t = Date.now().toString(36).padStart(9, '0');
  const r = crypto.randomBytes(6).toString('hex');
  return (prefix ? prefix + '_' : '') + t + r;
}

const nowIso = () => new Date().toISOString();

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** Normalised text for duplicate detection. */
function normText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function safeJson(text, fallback = null) {
  try { return JSON.parse(text); } catch { return fallback; }
}

/** Limits concurrent async work. */
function limiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || !queue.length) return;
    active++;
    const { fn, res, rej } = queue.shift();
    Promise.resolve().then(fn).then(res, rej).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((res, rej) => { queue.push({ fn, res, rej }); next(); });
}

/** Local date key YYYY-MM-DD in the system time zone. */
function dayKey(d = new Date()) {
  const z = new Date(d);
  return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`;
}

function startOfDay(d = new Date()) { const z = new Date(d); z.setHours(0, 0, 0, 0); return z; }
function endOfDay(d = new Date()) { const z = new Date(d); z.setHours(23, 59, 59, 999); return z; }

function truncate(s, n) { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

module.exports = { id, nowIso, sha256, normText, clamp, safeJson, limiter, dayKey, startOfDay, endOfDay, truncate };
