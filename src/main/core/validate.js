'use strict';
/**
 * Minimal JSON-schema validator for tool arguments and IPC payloads.
 * Supports: type (string|number|integer|boolean|object|array), enum,
 * required, properties, additionalProperties:false, items, minLength,
 * maxLength, minimum, maximum, maxItems, pattern, format: 'date-time'.
 * Unknown keys are dropped when additionalProperties === false.
 * Returns { ok, value, errors } — value is a cleaned deep copy.
 */
function validate(schema, input, path = '$') {
  const errors = [];
  const value = walk(schema, input, path, errors);
  return { ok: errors.length === 0, value, errors };
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function walk(s, v, p, errors) {
  if (!s) return v;
  if (v === undefined) return undefined;
  const t = String(s.type || '').toLowerCase();
  if (s.nullable && v === null) return null;
  if (t) {
    const actual = typeOf(v);
    const okType = t === actual || (t === 'number' && actual === 'integer');
    if (!okType) {
      // Gentle coercion for numbers/booleans that LLMs sometimes stringify.
      if ((t === 'number' || t === 'integer') && typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) v = Number(v);
      else if (t === 'boolean' && (v === 'true' || v === 'false')) v = v === 'true';
      else { errors.push(`${p}: erwartet ${t}, erhalten ${actual}`); return undefined; }
      if (t === 'integer' && !Number.isInteger(v)) { errors.push(`${p}: erwartet Ganzzahl`); return undefined; }
    }
  }
  if (s.enum && !s.enum.includes(v)) { errors.push(`${p}: ungültiger Wert`); return undefined; }
  if (t === 'string') {
    if (s.minLength != null && v.length < s.minLength) errors.push(`${p}: zu kurz`);
    if (s.maxLength != null && v.length > s.maxLength) errors.push(`${p}: zu lang (max ${s.maxLength})`);
    if (s.pattern && !new RegExp(s.pattern).test(v)) errors.push(`${p}: Format ungültig`);
    if (s.format === 'date-time' && isNaN(Date.parse(v))) errors.push(`${p}: kein gültiges Datum`);
    return v;
  }
  if (t === 'number' || t === 'integer') {
    if (!Number.isFinite(v)) { errors.push(`${p}: keine endliche Zahl`); return undefined; }
    if (s.minimum != null && v < s.minimum) errors.push(`${p}: kleiner als ${s.minimum}`);
    if (s.maximum != null && v > s.maximum) errors.push(`${p}: größer als ${s.maximum}`);
    return v;
  }
  if (t === 'array') {
    if (s.maxItems != null && v.length > s.maxItems) errors.push(`${p}: zu viele Einträge`);
    return v.slice(0, s.maxItems ?? v.length).map((x, i) => walk(s.items, x, `${p}[${i}]`, errors));
  }
  if (t === 'object') {
    const out = {};
    const props = s.properties || {};
    for (const r of s.required || []) if (v[r] === undefined || v[r] === null) errors.push(`${p}.${r}: fehlt`);
    for (const [k, val] of Object.entries(v)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      if (props[k]) out[k] = walk(props[k], val, `${p}.${k}`, errors);
      else if (s.additionalProperties !== false) out[k] = val;
    }
    return out;
  }
  return v;
}

/** Convert our schema dialect to Gemini's (uppercase types, no unsupported keys). */
function toGeminiSchema(s) {
  if (!s || typeof s !== 'object') return s;
  const out = {};
  if (s.type) out.type = String(s.type).toUpperCase();
  for (const k of ['description', 'enum', 'format', 'nullable', 'minimum', 'maximum', 'minItems', 'maxItems', 'required']) {
    if (s[k] !== undefined) out[k] = s[k];
  }
  if (out.format && !['date-time', 'enum'].includes(out.format)) delete out.format;
  if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
  if (s.items) out.items = toGeminiSchema(s.items);
  return out;
}

module.exports = { validate, toGeminiSchema };
