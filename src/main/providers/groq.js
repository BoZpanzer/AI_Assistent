'use strict';
const log = require('../core/logger').scope('groq');

/**
 * Groq – kostenloser Anbieter für NICHT-private Nachrichten (Free-Plan, OpenAI-kompatible Schnittstelle).
 * Reihenfolge für öffentliche Fragen: Groq (gratis, sehr schnell) → Gemini (Guthaben/Budget) → lokales Modell.
 * - Läuft nie für private Nachrichten: jede Anfrage geht über s.fetch (privacy.assertExternal).
 * - Kein Bild-Input (dafür bleibt Gemini).
 * - Erschöpftes Kontingent (429) → bis zur angegebenen Wartezeit bzw. bis morgen übersprungen; der Aufrufer weicht aus.
 * Free-Plan (Stand Okt. 2026, je Modell): ca. 30 Anfragen/min, 1 000/Tag, 8 000 Token/min, 200 000 Token/Tag.
 */
const BASE = 'https://api.groq.com/openai/v1';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

function jsonSchema(s) {
  if (!s || typeof s !== 'object') return s;
  if (Array.isArray(s)) return s.map(jsonSchema);
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, k === 'type' && typeof v === 'string' ? v.toLowerCase() : jsonSchema(v)]));
}

/** Gemini-Verlauf (contents/parts) → OpenAI-Nachrichten. Werkzeug-Aufrufe bekommen fortlaufende IDs. */
function toMessages(system, contents) {
  const messages = system ? [{ role: 'system', content: String(system) }] : [];
  const open = []; let n = 0;
  for (const c of contents || []) {
    const parts = c.parts || [];
    if (parts.some((p) => p.inlineData)) throw Object.assign(new Error('Bilder gehen nicht über Groq'), { code: 'GROQ_UNSUPPORTED' });
    const text = parts.filter((p) => typeof p.text === 'string' && p.text).map((p) => p.text).join('\n');
    const calls = parts.filter((p) => p.functionCall).map((p) => {
      const id = 'call_' + (n++);
      open.push({ id, name: p.functionCall.name });
      return { id, type: 'function', function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) } };
    });
    if (c.role === 'model') {
      if (text || calls.length) messages.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else {
      for (const p of parts) if (p.functionResponse) {
        const i = open.findIndex((o) => o.name === p.functionResponse.name);
        const id = i >= 0 ? open.splice(i, 1)[0].id : 'call_' + (n++);
        messages.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(p.functionResponse.response ?? {}) });
      }
      if (text) messages.push({ role: 'user', content: text });
    }
  }
  return messages;
}

class Groq {
  constructor(s) { this.s = s; this.exhaustedUntil = 0; }
  cfg() { return { enabled: true, model: DEFAULT_MODEL, ...(this.s.settings.get('cloud')?.groq || {}) }; }
  hasKey() { return !!this.s.secrets.get('groq.api_key'); }

  /** Darf Groq gerade für eine öffentliche Nachricht genutzt werden? */
  available() {
    const cc = this.s.settings.get('cloud') || {};
    if (!this.hasKey() || this.cfg().enabled === false || cc.mode === 'local' || cc.features?.chat === false) return false;
    if (require('../core/privacy').isPrivate()) return false;
    return !(this.exhaustedUntil > Date.now());
  }

  day() { return require('../services/costguard').localDay(); }
  count() { return Number(this.s.db.get('SELECT value FROM meta WHERE key=?', 'groq:req:' + this.day())?.value || 0); }
  bump() { this.s.db.run('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'groq:req:' + this.day(), String(this.count() + 1)); }

  /** 429 → Pause (Retry-After, sonst Minuten- bzw. Tageslimit). */
  exhausted(res, body) {
    const after = Number(res.headers?.get?.('retry-after'));
    const daily = /per day|\bRPD\b|\bTPD\b|tokens per day|requests per day/i.test(body);
    const ms = daily ? 6 * 3600_000 : Number.isFinite(after) && after > 0 ? Math.min(3600, after) * 1000 + 500 : 65_000;
    this.exhaustedUntil = Date.now() + ms;
    log.info(`Groq-Kontingent ${daily ? 'für heute' : 'kurz'} erschöpft – nutze Gemini/lokal (${Math.round(ms / 1000)} s)`);
  }

  async request(payload, signal) {
    try { return await this.send(payload, signal); } catch (e) {
      // Modell kennt die Denk-Parameter nicht → einmal ohne
      if (e.status === 400 && /reasoning/i.test(e.message) && ('reasoning_effort' in payload || 'include_reasoning' in payload)) {
        const { reasoning_effort: _a, include_reasoning: _b, ...rest } = payload;
        return this.send(rest, signal);
      }
      throw e;
    }
  }

  async send(payload, signal) {
    const key = this.s.secrets.get('groq.api_key');
    if (!key) throw Object.assign(new Error('Kein Groq-Schlüssel'), { code: 'GROQ_OFF' });
    this.bump();
    const res = await this.s.fetch(BASE + '/chat/completions', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(payload) });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 429) this.exhausted(res, body);
      if (res.status === 401) this.exhaustedUntil = Date.now() + 10 * 60_000; // falscher Schlüssel: nicht bei jeder Nachricht neu versuchen
      const msg = res.status === 401 ? 'Groq-Schlüssel wurde abgelehnt (Einstellungen → Gemini / KI → Groq).' : `Groq HTTP ${res.status}: ${body.slice(0, 200)}`;
      throw Object.assign(new Error(msg), { status: res.status, code: 'GROQ_HTTP' });
    }
    return res;
  }

  /**
   * Ein Modellschritt mit Streaming. Gibt { text, functionCalls, parts } zurück (wie Gemini/lokal).
   * Fehler werfen – der Aufrufer weicht dann auf Gemini/lokal aus.
   */
  async stepStream({ system, contents, tools = [], signal, onText = () => {}, maxOut = 2048, temperature }) {
    const declarations = tools.flatMap((t) => t.functionDeclarations || []).map(({ name, description, parameters }) => ({ type: 'function', function: { name, description, parameters: jsonSchema(parameters) || { type: 'object', properties: {} } } }));
    const model = this.cfg().model || DEFAULT_MODEL;
    const payload = {
      model, messages: toMessages(system, contents), stream: true, max_completion_tokens: maxOut,
      ...(/gpt-oss/.test(model) ? { reasoning_effort: 'low', include_reasoning: false } : {}),
      ...(temperature != null ? { temperature } : {}),
      ...(declarations.length ? { tools: declarations, tool_choice: 'auto' } : {}),
    };
    const res = await this.request(payload, signal);
    let text = ''; const calls = []; let buf = '';
    const handle = (line) => {
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') return;
      let j; try { j = JSON.parse(data); } catch { return; }
      if (j.error) throw new Error('Groq: ' + (j.error.message || 'Fehler'));
      const d = j.choices?.[0]?.delta || {};
      if (d.content) { text += d.content; onText(d.content); }
      for (const tc of d.tool_calls || []) {
        const c = (calls[tc.index ?? calls.length] ||= { id: tc.id || '', name: '', args: '' });
        if (tc.id) c.id = tc.id;
        if (tc.function?.name) c.name += tc.function.name;
        if (tc.function?.arguments) c.args += tc.function.arguments;
      }
    };
    const dec = new TextDecoder();
    const reader = res.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); handle(line); }
    }
    if (buf.trim()) handle(buf.trim());
    const functionCalls = calls.filter((c) => c?.name).map((c, i) => {
      let args = {}; try { args = c.args ? JSON.parse(c.args) : {}; } catch { args = {}; }
      return { id: c.id || 'groq-' + i, name: c.name, args };
    });
    return { text, functionCalls, model, parts: [...(text ? [{ text }] : []), ...functionCalls.map((functionCall) => ({ functionCall }))] };
  }

  /** Kurze Hintergrundaufgabe mit JSON-Antwort (z. B. Brain-Lernschritt). */
  async generate({ system, contents, json = false, schema, maxOut = 600, temperature = 0.2, signal }) {
    const sys = json && schema ? `${system}\n\nAntworte NUR mit JSON nach diesem Schema:\n${JSON.stringify(schema)}` : system;
    const model = this.cfg().model || DEFAULT_MODEL;
    const res = await this.request({
      model, messages: toMessages(sys, contents), stream: false, max_completion_tokens: maxOut, temperature,
      ...(/gpt-oss/.test(model) ? { reasoning_effort: 'low', include_reasoning: false } : {}),
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }, signal);
    const j = await res.json();
    const out = j.choices?.[0]?.message?.content || '';
    return json ? JSON.parse(out) : out;
  }

  /** Schlüssel prüfen (Modellliste, kostet nichts). */
  async test(key) {
    const res = await this.s.fetch(BASE + '/models', { headers: { Authorization: 'Bearer ' + String(key || '').trim() } });
    if (!res.ok) throw new Error(res.status === 401 ? 'Groq-Schlüssel ungültig' : 'Groq nicht erreichbar (HTTP ' + res.status + ')');
    const j = await res.json();
    return { ok: true, models: (j.data || []).map((m) => m.id) };
  }

  status() { return { hasKey: this.hasKey(), enabled: this.cfg().enabled !== false, model: this.cfg().model, today: this.count(), pausedUntil: this.exhaustedUntil > Date.now() ? new Date(this.exhaustedUntil).toISOString() : null }; }
}

module.exports = { Groq, toMessages, DEFAULT_MODEL };
