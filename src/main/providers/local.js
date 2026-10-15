'use strict';
const http = require('node:http');
function jsonSchema(s) { if (!s || typeof s !== 'object') return s; if (Array.isArray(s)) return s.map(jsonSchema); return Object.fromEntries(Object.entries(s).map(([k,v]) => [k, k === 'type' && typeof v === 'string' ? v.toLowerCase() : jsonSchema(v)])); }
/** Ollama on this PC only: numeric loopback, no proxy, DNS, redirect or cloud fallback. */
class LocalLLM {
  constructor(settings) { this.settings = settings; }
  cfg() { return { port: 11434, model: '', ...(this.settings.get('localLLM') || {}) }; }
  request(path, payload, signal) {
    const { port } = this.cfg();
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Ungültiger lokaler Port');
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path, method: payload ? 'POST' : 'GET', signal,
        headers: { 'Content-Type': 'application/json' } }, (res) => {
        let body = ''; res.setEncoding('utf8');
        res.on('data', (c) => { body += c; if (body.length > 8 * 1024 * 1024) req.destroy(new Error('Lokale Antwort zu groß')); });
        res.on('end', () => { try {
          if (res.statusCode !== 200) throw new Error('Lokales Modell nicht verfügbar (HTTP ' + res.statusCode + ')');
          resolve(JSON.parse(body));
        } catch (e) { reject(e); } });
        res.on('error', reject);
      });
      req.setTimeout(180000, () => req.destroy(new Error('Zeitlimit des lokalen Modells erreicht')));
      req.on('error', () => reject(new Error('Lokales LLM nicht erreichbar. Ollama starten und ein lokal installiertes Modell in Einstellungen → Lokale KI auswählen. Keine Daten wurden an eine Cloud-KI gesendet.')));
      req.end(payload ? JSON.stringify(payload) : undefined);
    });
  }
  async models(signal) {
    const r = await this.request('/api/tags', null, signal);
    return (r.models || []).filter((m) => !m.remote_host && !m.remote_model && !/cloud/i.test(m.name)).map((m) => m.name);
  }
  async stepStream({ system, contents, tools = [], signal, onText = () => {}, json, schema }) {
    const model = this.cfg().model;
    if (!model || /cloud/i.test(model)) throw new Error('Bitte ein lokal installiertes Ollama-Modell auswählen (keine Cloud-Modelle).');
    const installed = await this.models(signal);
    if (!installed.includes(model)) throw new Error('Das ausgewählte Modell ist nicht lokal installiert.');
    const details = await this.request('/api/show', { model }, signal);
    if (details.remote_host || details.remote_model || !details.model_info || !Object.keys(details.model_info).length) throw new Error('Modell ist nicht als lokales Modell verifizierbar.');
    const messages = [{ role: 'system', content: system || '' }];
    for (const c of contents || []) {
      const parts = c.parts || [];
      if (parts.some((p) => p.inlineData)) throw new Error('Bilder sind im privaten Textmodus noch nicht unterstützt. Bitte Text lokal extrahieren.');
      const calls = parts.filter((p) => p.functionCall).map((p) => ({ function: { name: p.functionCall.name, arguments: p.functionCall.args } }));
      const text = parts.filter((p) => p.text).map((p) => p.text).join('\n');
      if (text || calls.length) messages.push({ role: c.role === 'model' ? 'assistant' : 'user', content: text, ...(calls.length ? { tool_calls: calls } : {}) });
      for (const p of parts) if (p.functionResponse) messages.push({ role: 'tool', tool_name: p.functionResponse.name, content: JSON.stringify(p.functionResponse.response) });
    }
    const declarations = tools.flatMap((t) => t.functionDeclarations || []).map(({ name, description, parameters }) => ({ type: 'function', function: { name, description, parameters: jsonSchema(parameters) } }));
    const r = await this.request('/api/chat', { model, messages, stream: false, ...(declarations.length ? { tools: declarations } : {}), ...(json ? { format: schema || 'json' } : {}) }, signal);
    if (!r.message) throw new Error('Ungültige Antwort des lokalen Modells');
    const text = r.message.content || ''; onText(text);
    const functionCalls = (r.message.tool_calls || []).map((t, i) => ({ id: 'local-' + i, name: t.function.name, args: t.function.arguments }));
    return { text, functionCalls, parts: [...(text ? [{ text }] : []), ...functionCalls.map((functionCall) => ({ functionCall }))] };
  }
  async generate(opts) { const r = await this.stepStream(opts); return opts.json ? JSON.parse(r.text) : r.text; }
}
module.exports = { LocalLLM };
