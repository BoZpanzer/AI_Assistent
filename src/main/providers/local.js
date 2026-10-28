'use strict';
const log = require('../core/logger').scope('local-ai');
const http = require('node:http');
const LOCAL_TIERS = Object.freeze([
  { id: 'ultra', model: 'qwen3.5:0.8b', label: 'Ultra-Leicht', memoryGB: 2 },
  { id: 'light', model: 'qwen3.5:2b', label: 'Leicht', memoryGB: 4 },
  { id: 'balanced', model: 'qwen3.5:4b', label: 'Ausgewogen', memoryGB: 8 },
  { id: 'strong', model: 'qwen3.5:9b', label: 'Stark', memoryGB: 16 },
  { id: 'maximum', model: 'qwen3.5:27b', label: 'Maximum', memoryGB: 32 },
]);
/**
 * Empfehlung für einen Gaming-PC: das lokale Modell konkurriert mit dem Spiel um RAM/VRAM.
 * Darum höchstens „Ausgewogen“ (4B), auch bei viel RAM; größere Stufen bleiben wählbar.
 */
function recommendedTier(ramGB, vramGB = 0) {
  // Mit gemessenem Grafikspeicher: das Modell soll hineinpassen (4B ≈ 3,5 GB, 9B ≈ 6,5 GB, plus Kontext) und dem Spiel Platz lassen
  if (vramGB >= 3 && ramGB >= 16) return vramGB >= 16 ? 'strong' : vramGB >= 6 ? 'balanced' : 'light';
  if (ramGB >= 16) return 'balanced';
  if (ramGB >= 8) return 'light';
  return 'ultra';
}
/** Ollama lauscht standardmäßig nur auf 127.0.0.1; ein gesetztes OLLAMA_HOST=0.0.0.0 macht es im Netz erreichbar. */
function exposureWarning(env = process.env) {
  const h = String(env.OLLAMA_HOST || '').trim();
  if (!h) return null;
  const host = h.replace(/^https?:\/\//, '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return ['127.0.0.1', 'localhost', '::1'].includes(host) ? null : `OLLAMA_HOST=${h}: Ollama ist damit im Netzwerk erreichbar. Empfohlen: OLLAMA_HOST=127.0.0.1:11434.`;
}
function jsonSchema(s) { if (!s || typeof s !== 'object') return s; if (Array.isArray(s)) return s.map(jsonSchema); return Object.fromEntries(Object.entries(s).map(([k,v]) => [k, k === 'type' && typeof v === 'string' ? v.toLowerCase() : jsonSchema(v)])); }
/** Ollama on this PC only: numeric loopback, no proxy, DNS, redirect or cloud fallback. */
/**
 * Ressourcen: höchstens eine lokale Anfrage gleichzeitig (Warteschlange max. 3), begrenzte Threads und
 * Kontextgröße, Modell wird nach kurzer Zeit wieder entladen (keep_alive). Während ein Spiel läuft:
 * 'cpu' = Modell ohne GPU (VRAM bleibt fürs Spiel), 'pause' = keine lokalen Hintergrundaufgaben.
 * Ein Fehler hier löst NIE einen Cloud-Aufruf aus.
 */
class LocalLLM {
  constructor(settings) { this.settings = settings; this.busy = 0; this.queue = []; this.isGaming = () => false; }
  cfg() { return { port: 11434, model: '', keepAlive: '2m', threads: 4, numCtx: 8192, whileGaming: 'cpu', ...(this.settings.get('localLLM') || {}) }; }
  /** Ollama-Optionen je Anfrage (beim Spielen: weniger Threads, auf Wunsch nur CPU, sofort entladen). */
  runtimeOptions() {
    const c = this.cfg(); const gaming = this.isGaming();
    // Beim Zocken kleinerer Kontext (spart Speicher); sonst reicht der Kontext für Anweisungen + Werkzeuge + Gespräch (≈ 4–5k Tokens)
    const options = { num_ctx: gaming ? Math.min(4096, c.numCtx) : c.numCtx, num_thread: gaming ? Math.min(2, c.threads) : c.threads };
    if (gaming && c.whileGaming === 'cpu') options.num_gpu = 0;
    return { options, keep_alive: gaming ? '0s' : c.keepAlive };
  }
  async slot(background) {
    if (background && this.isGaming() && this.cfg().whileGaming === 'pause') throw new Error('Lokale KI pausiert, während ein Spiel läuft (Einstellungen → Lokale KI).');
    if (this.busy < 1) { this.busy++; return; }
    if (background || this.queue.length >= 3) throw new Error('Lokale KI ist gerade beschäftigt – bitte gleich erneut versuchen.');
    await new Promise((r) => this.queue.push(r));
    this.busy++;
  }
  free() { this.busy = Math.max(0, this.busy - 1); this.queue.shift()?.(); }
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
  /** Windows-only, explicit action. winget verifies installer metadata; no shell interpolation. */
  async installOllama() {
    if (process.platform !== 'win32') throw new Error('Automatische Installation ist nur unter Windows verfügbar.');
    const { spawn } = require('node:child_process');
    return new Promise((resolve, reject) => {
      const child = spawn('winget', ['install', '--id', 'Ollama.Ollama', '--exact',
        '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity'], { windowsHide: true, shell: false });
      let output = '';
      child.stdout.on('data', b => { output = (output + b.toString()).slice(-3000); });
      child.stderr.on('data', b => { output = (output + b.toString()).slice(-3000); });
      child.on('error', () => reject(new Error('Windows-Paketmanager winget nicht gefunden. Ollama bitte über die offizielle Website installieren.')));
      child.on('close', code => code === 0 ? resolve({ installed: true }) : reject(new Error('Ollama-Installation fehlgeschlagen (Code ' + code + '). ' + output.slice(-400))));
    });
  }
  async status() {
    const os = require('node:os');
    const ramGB = Math.round(os.totalmem() / 1073741824);
    const gpus = await this.gpus().catch(() => []);
    const vramGB = gpus.reduce((m, g) => Math.max(m, g.totalGB || 0), 0);
    const c = this.cfg(); const base = { tiers: LOCAL_TIERS, ramGB, gpus, vramGB, recommended: recommendedTier(ramGB, vramGB), selected: c.model, gaming: !!this.isGaming(), whileGaming: c.whileGaming, numCtx: c.numCtx, last: this.last || null };
    try {
      const installed = await this.models();
      return { ...base, online: true, installed, loaded: await this.loaded(), exposure: exposureWarning() };
    } catch (_) {
      return { ...base, online: false, installed: [], loaded: [] };
    }
  }
  /** Ollama im Hintergrund starten (Windows: die installierte App, sonst `ollama serve`) und warten, bis es antwortet. */
  async startOllama() {
    if ((await this.status()).online) return { online: true };
    const { spawn } = require('node:child_process'); const fs = require('node:fs'); const path = require('node:path');
    const app = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama app.exe') : '';
    const run = (cmd, args) => new Promise((resolve) => {
      try { const c = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true, shell: false }); c.on('error', () => resolve(false)); c.unref(); setTimeout(() => resolve(true), 400); } catch { resolve(false); }
    });
    const started = (app && fs.existsSync(app) && await run(app, [])) || await run('ollama', ['serve']);
    if (!started) throw new Error('Ollama ist nicht installiert. Installiere es über „Ollama installieren (Windows)“ oder von ollama.com.');
    for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 1000)); if ((await this.status()).online) return { online: true }; }
    throw new Error('Ollama wurde gestartet, antwortet aber nicht auf Port ' + this.cfg().port + '. Port in den Einstellungen prüfen oder Ollama manuell starten.');
  }
  /** Explicit user action only. Never pull an arbitrary URL or remote/cloud model. */
  async installTier(model, onProgress = () => {}) {
    if (!LOCAL_TIERS.some(t => t.model === model)) throw new Error('Unbekanntes lokales Modell');
    const { port } = this.cfg();
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Ungültiger lokaler Port');
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: '/api/pull', method: 'POST',
        headers: { 'Content-Type': 'application/json' } }, res => {
        let body = ''; res.setEncoding('utf8');
        // Ollama streamt Fortschritt als Zeilen-JSON ({status, completed, total}) – wir geben ihn weiter
        let buf = ''; let err = ''; let last = null;
        const line = (l) => { if (!l.trim()) return; try { const j = JSON.parse(l); if (j.error) err = String(j.error); else { last = j; onProgress({ model, status: j.status || '', completed: j.completed || 0, total: j.total || 0 }); } } catch { /* ignore */ } };
        res.on('data', chunk => { buf += chunk; let i; while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); } if (buf.length > 1024 * 1024) req.destroy(new Error('Antwort zu groß')); });
        res.on('end', () => {
          line(buf);
          if (res.statusCode !== 200) return reject(new Error('Ollama-Download fehlgeschlagen (HTTP ' + res.statusCode + (err ? ': ' + err : '') + ')'));
          if (err) return reject(new Error(err));
          if (!last || last.status !== 'success') return reject(new Error('Download wurde unterbrochen. Beim erneuten Klick macht Ollama dort weiter, wo es aufgehört hat.'));
          resolve({ status: 'success' });
        });
      });
      req.setTimeout(30 * 60 * 1000, () => req.destroy(new Error('Modell-Download: Zeitlimit erreicht (30 Minuten ohne Daten)')));
      req.on('error', (e) => reject(new Error(/ECONNREFUSED|ECONNRESET/.test(e.code || '') ? 'Ollama ist nicht erreichbar (läuft es?).' : e.message)));
      req.end(JSON.stringify({ model, stream: true }));
    });
  }
  /** Letzte Anfrage merken (Dauer, Tokens, Tempo) – damit „warum so langsam?“ in den Einstellungen sichtbar ist. */
  noteRun(model, r, ctx, ms) {
    const ns = (v) => Number(v || 0) / 1e9;
    const prompt = r.prompt_eval_count || 0; const out = r.eval_count || 0;
    const last = { at: Date.now(), model, seconds: Math.round(ms / 100) / 10, loadSeconds: Math.round(ns(r.load_duration) * 10) / 10, promptTokens: prompt, promptSeconds: Math.round(ns(r.prompt_eval_duration) * 10) / 10,
      outTokens: out, tokPerSec: ns(r.eval_duration) > 0 ? Math.round((out / ns(r.eval_duration)) * 10) / 10 : 0, ctx, truncated: !!ctx && prompt >= ctx - 8 };
    this.last = last;
    log.info(`Lokale KI: ${last.seconds} s gesamt (Laden ${last.loadSeconds} s, Prompt ${prompt} Tokens in ${last.promptSeconds} s, Antwort ${out} Tokens, ${last.tokPerSec} Tok/s)`);
    if (last.truncated) log.warn(`Lokale KI: Eingabe füllt den ganzen Kontext (${prompt} von ${ctx} Tokens) – Anfang wird abgeschnitten. Kontext in den Einstellungen erhöhen.`);
  }
  /** Grafikkarten + Grafikspeicher (NVIDIA per nvidia-smi, sonst Windows-Registry). Kurz zwischengespeichert. */
  async gpus() {
    if (this._gpu && Date.now() - this._gpu.at < 4000) return this._gpu.list;
    const { execFile } = require('node:child_process');
    const run = (cmd, args, timeout = 5000) => new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 1 << 20 }, (err, out) => resolve(err ? '' : String(out))));
    let list = [];
    const smi = process.platform === 'win32' ? ['nvidia-smi', 'C:\\Windows\\System32\\nvidia-smi.exe', 'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe'] : ['nvidia-smi'];
    for (const exe of smi) {
      const out = await run(exe, ['--query-gpu=name,memory.total,memory.used,memory.free', '--format=csv,noheader,nounits']);
      list = out.split(/\r?\n/).map((l) => l.split(',').map((x) => x.trim())).filter((p) => p.length >= 4 && Number(p[1]) > 0)
        .map((p) => ({ name: p[0], totalGB: Math.round(Number(p[1]) / 102.4) / 10, usedGB: Math.round(Number(p[2]) / 102.4) / 10, freeGB: Math.round(Number(p[3]) / 102.4) / 10, source: 'nvidia-smi' }));
      if (list.length) break;
    }
    if (!list.length && process.platform === 'win32') {
      const ps = "$r=@(); Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue | ForEach-Object { $p=Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue; if ($p.'HardwareInformation.qwMemorySize') { $r += [pscustomobject]@{ name=[string]$p.DriverDesc; total=[int64]$p.'HardwareInformation.qwMemorySize' } } }; ConvertTo-Json -Compress -InputObject @($r)";
      try {
        const j = JSON.parse((await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], 8000)).trim() || '[]');
        list = (Array.isArray(j) ? j : [j]).filter((g) => g && g.total > 0).map((g) => ({ name: g.name, totalGB: Math.round(g.total / 1073741824 * 10) / 10, usedGB: null, freeGB: null, source: 'registry' }));
      } catch { /* ignore */ }
    }
    this._gpu = { at: Date.now(), list };
    return list;
  }
  /** Was Ollama gerade im Speicher hält und wie viel davon auf der Grafikkarte liegt (/api/ps). */
  async loaded() {
    try {
      const r = await this.request('/api/ps', null);
      return (r.models || []).filter((m) => !m.remote_host).map((m) => ({ name: m.name, sizeGB: Math.round((m.size || 0) / 107374182.4) / 10, vramGB: Math.round((m.size_vram || 0) / 107374182.4) / 10, onGpuPct: m.size ? Math.round(((m.size_vram || 0) / m.size) * 100) : 0, ctx: m.context_length || null }));
    } catch { return []; }
  }
  async models(signal) {
    const r = await this.request('/api/tags', null, signal);
    return (r.models || []).filter((m) => !m.remote_host && !m.remote_model && !/cloud/i.test(m.name)).map((m) => m.name);
  }
  async stepStream(opts) {
    await this.slot(opts.background);
    try { return await this._step(opts); } finally { this.free(); }
  }
  async _step({ system, contents, tools = [], signal, onText = () => {}, json, schema }) {
    const model = this.cfg().model;
    if (!model) throw new Error('Keine lokale KI eingerichtet. Private Fragen (Termine, Finanzen, eigene Daten) beantwortet nur die lokale KI auf deinem PC, damit nichts davon ins Internet geht – Einstellungen → Lokale KI.');
    if (/cloud/i.test(model)) throw new Error('Bitte ein lokal installiertes Ollama-Modell auswählen (keine Cloud-Modelle).');
    const installed = await this.models(signal);
    if (!installed.includes(model)) throw new Error('Das ausgewählte Modell ist nicht lokal installiert.');
    const details = await this.request('/api/show', { model }, signal);
    if (details.remote_host || details.remote_model || !details.model_info || !Object.keys(details.model_info).length) throw new Error('Modell ist nicht als lokales Modell verifizierbar.');
    // Kleine lokale Modelle fragen sonst gern „Soll ich nachsehen?“ statt das Werkzeug zu benutzen, oder schmücken Daten aus
    const rules = tools.length ? '\n\nRegeln für dich: Wenn ein Werkzeug die Frage beantworten kann, rufe es sofort auf – frag nie vorher um Erlaubnis. Nenne nur, was die Werkzeuge zurückgeben; erfinde keine Orte, Personen oder Zahlen dazu. Antworte kurz.' : '';
    const messages = [{ role: 'system', content: (system || '') + rules }];
    for (const c of contents || []) {
      const parts = c.parts || [];
      if (parts.some((p) => p.inlineData)) throw new Error('Bilder sind im privaten Textmodus noch nicht unterstützt. Bitte Text lokal extrahieren.');
      const calls = parts.filter((p) => p.functionCall).map((p) => ({ function: { name: p.functionCall.name, arguments: p.functionCall.args } }));
      const text = parts.filter((p) => p.text).map((p) => p.text).join('\n');
      if (text || calls.length) messages.push({ role: c.role === 'model' ? 'assistant' : 'user', content: text, ...(calls.length ? { tool_calls: calls } : {}) });
      for (const p of parts) if (p.functionResponse) messages.push({ role: 'tool', tool_name: p.functionResponse.name, content: JSON.stringify(p.functionResponse.response) });
    }
    const declarations = tools.flatMap((t) => t.functionDeclarations || []).map(({ name, description, parameters }) => ({ type: 'function', function: { name, description, parameters: jsonSchema(parameters) } }));
    const rt = this.runtimeOptions();
    const body = { model, messages, stream: false, ...rt, ...(declarations.length ? { tools: declarations } : {}), ...(json ? { format: schema || 'json' } : {}) };
    const t0 = Date.now();
    // Qwen3.5 „denkt“ sonst standardmäßig minutenlang im Verborgenen – für Assistenz-Antworten abgeschaltet (Modelle ohne Denkmodus: ohne den Parameter wiederholen)
    let r;
    try { r = await this.request('/api/chat', { ...body, think: false }, signal); }
    catch (e) { if (!/HTTP 400/.test(String(e.message))) throw e; r = await this.request('/api/chat', body, signal); }
    this.noteRun(model, r, rt.options.num_ctx, Date.now() - t0);
    if (!r.message) throw new Error('Ungültige Antwort des lokalen Modells');
    const text = r.message.content || ''; onText(text);
    const functionCalls = (r.message.tool_calls || []).map((t, i) => ({ id: 'local-' + i, name: t.function.name, args: t.function.arguments }));
    return { text, functionCalls, parts: [...(text ? [{ text }] : []), ...functionCalls.map((functionCall) => ({ functionCall }))] };
  }
  async generate(opts) { const r = await this.stepStream(opts); return opts.json ? JSON.parse(r.text) : r.text; }
}
module.exports = { LocalLLM, LOCAL_TIERS, recommendedTier, exposureWarning };
