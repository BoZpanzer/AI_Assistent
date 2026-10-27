'use strict';
/**
 * Lokale KI-Stimme „OmniVoice“ (k2-fsa, 0.6B, Deutsch + Englisch) auf der eigenen Grafikkarte.
 * - Nur auf ausdrücklichen Klick installiert (≈ 5–6 GB): uv (feste Version + SHA-256) → Python 3.12 →
 *   PyTorch (CUDA, sonst CPU) → omnivoice → Modell. Alles unter <Daten>/omnivoice, mit einem Klick entfernbar.
 * - Ein kleiner Python-Dienst hält das Modell geladen (nur 127.0.0.1, Zufallstoken, beendet sich mit JARVIS).
 * - Stimmen werden beschrieben (z. B. „male, middle-aged, low pitch“), keine echte Person. Für eine gleichbleibende
 *   Stimme erzeugt der Dienst pro Profil einmal eine Referenz und klont diese danach.
 * - J.A.R.V.I.S. und Alya haben feste, mitgelieferte Stimmen (Vorlage wird geklont); „neu würfeln“ erzeugt eine neue.
 * Kein Text verlässt den PC.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const log = require('../core/logger').scope('omnivoice');

const UV = Object.freeze({
  version: '0.12.24',
  url: 'https://github.com/astral-sh/uv/releases/download/0.12.24/uv-x86_64-pc-windows-msvc.zip',
  size: 15685515,
  sha256: '7c38608c8a18ee137d748a1773053b07ec8f3a30fab49aebaa6f4e4efeceb019',
});
const PKG = Object.freeze({ python: '3.12', torch: '2.8.0', torchaudio: '2.8.0', omnivoice: '0.2.1', cuda: 'https://download.pytorch.org/whl/cu126', cpu: 'https://download.pytorch.org/whl/cpu' });
const MODEL = 'k2-fsa/OmniVoice';
const SIZE_GB = 6;
const STEPS = [['uv', 'Installationshelfer laden'], ['python', 'Python einrichten'], ['torch', 'PyTorch laden (größter Teil)'], ['omnivoice', 'OmniVoice installieren'], ['model', 'Stimmmodell laden und testen']];
const exists = (f) => { try { fs.statSync(f); return true; } catch { return false; } };

class OmniVoice {
  constructor(s, { run = spawn, platform = process.platform, uv = UV } = {}) {
    this.s = s; this.run = run; this.platform = platform; this.uv = uv;
    this.dir = path.join(s.paths.data, 'omnivoice');
    this.proc = null; this.port = 0; this.token = ''; this.device = ''; this.starting = null;
    this.installing = null; this.lastError = '';
    this.queue = Promise.resolve();
  }

  cfg() { return this.s.settings.get('voice')?.tts?.omni || {}; }
  win() { return this.platform === 'win32'; }
  uvExe() { return path.join(this.dir, 'uv', this.win() ? 'uv.exe' : 'uv'); }
  python() { return path.join(this.dir, 'venv', this.win() ? 'Scripts/python.exe' : 'bin/python'); }
  marker() { return path.join(this.dir, 'installed.json'); }
  installed() { return exists(this.marker()) && exists(this.python()); }
  info() { try { return JSON.parse(fs.readFileSync(this.marker(), 'utf8')); } catch { return {}; } }

  /** Darf die Stimme gerade laufen? (installiert und eingeschaltet – auch beim Zocken) */
  allowed() { return this.installed() && this.cfg().enabled !== false; }

  status() {
    return {
      supported: this.win(), installed: this.installed(), enabled: this.cfg().enabled !== false,
      running: !!this.proc && !!this.port, starting: !!this.starting, device: this.device || this.info().device || '', allowed: this.allowed(),
      installing: this.installing, error: this.lastError, sizeGB: SIZE_GB, steps: STEPS.map(([id, label]) => ({ id, label })),
    };
  }
  emit() { this.s.bus?.emit('omnivoice:status', this.status()); }
  step(id, extra = {}) { this.installing = { step: id, label: STEPS.find((x) => x[0] === id)?.[1] || id, index: STEPS.findIndex((x) => x[0] === id), total: STEPS.length, startedAt: this.installing?.startedAt || Date.now(), ...extra }; this.emit(); }

  /** Befehl ausführen, Ausgabe ins Installationsprotokoll. */
  exec(cmd, args, { env = {}, timeoutMs = 60 * 60000 } = {}) {
    return new Promise((resolve, reject) => {
      const logFile = path.join(this.dir, 'install.log');
      const out = fs.createWriteStream(logFile, { flags: 'a' });
      out.write(`\n> ${path.basename(cmd)} ${args.join(' ')}\n`);
      let tail = '';
      const child = this.run(cmd, args, { cwd: this.dir, windowsHide: true, shell: false, env: { ...process.env, ...this.env(), ...env } });
      const onData = (b) => { const t = b.toString(); out.write(t); tail = (tail + t).slice(-1500); const last = t.trim().split(/\r?\n/).pop(); if (last && this.installing) { this.installing.detail = last.slice(0, 140); this.emit(); } };
      child.stdout?.on('data', onData); child.stderr?.on('data', onData);
      const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } reject(new Error('Zeitlimit bei ' + path.basename(cmd))); }, timeoutMs);
      child.on('error', (e) => { clearTimeout(timer); out.end(); reject(e); });
      child.on('close', (code) => { clearTimeout(timer); out.end(); code === 0 ? resolve(tail) : reject(new Error(`${path.basename(cmd)} beendet mit Code ${code}: ${tail.trim().split(/\r?\n/).slice(-2).join(' ').slice(0, 300)}`)); });
    });
  }
  env() {
    return {
      UV_PYTHON_INSTALL_DIR: path.join(this.dir, 'python'), UV_CACHE_DIR: path.join(this.dir, 'cache'), UV_NO_CONFIG: '1',
      HF_HOME: path.join(this.dir, 'hf'), HF_HUB_DISABLE_TELEMETRY: '1', PYTHONUTF8: '1', PYTHONNOUSERSITE: '1',
    };
  }

  /** NVIDIA-Grafikkarte vorhanden? (nvidia-smi gehört zum Treiber) */
  async hasNvidia() {
    try { const out = await this.execQuiet('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader']); return out.trim().split(/\r?\n/)[0] || ''; } catch { return ''; }
  }
  execQuiet(cmd, args) {
    return new Promise((resolve, reject) => {
      let out = '';
      const c = this.run(cmd, args, { windowsHide: true, shell: false });
      c.stdout?.on('data', (b) => { out += b; }); c.on('error', reject);
      c.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error('code ' + code))));
    });
  }

  /** Download mit fester Größe und Prüfsumme. */
  async download(url, size, sha256) {
    const r = await this.s.fetch(url, { signal: AbortSignal.timeout(10 * 60000) });
    if (!r.ok) throw new Error('Download fehlgeschlagen (HTTP ' + r.status + ')');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length !== size) throw new Error('Download hat eine unerwartete Größe – abgebrochen');
    if (crypto.createHash('sha256').update(buf).digest('hex') !== sha256) throw new Error('Prüfsumme stimmt nicht – abgebrochen');
    return buf;
  }

  /** Installation (nur auf Klick). Läuft im Hintergrund; Fortschritt über status()/Ereignis. */
  install() {
    if (!this.win()) throw new Error('Die lokale KI-Stimme gibt es nur unter Windows.');
    if (this.installing) throw new Error('Installation läuft bereits');
    this.lastError = '';
    this.installing = { step: 'uv', startedAt: Date.now() };
    const job = this._install().then(() => { this.installing = null; this.emit(); return this.status(); }, (e) => {
      this.installing = null; this.lastError = e.message; log.warn('Installation fehlgeschlagen: ' + e.message); this.emit(); throw e;
    });
    job.catch(() => {});
    return { started: true };
  }

  async _install() {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.rmSync(this.marker(), { force: true });
    this.step('uv');
    if (!exists(this.uvExe())) {
      const zip = await this.download(this.uv.url, this.uv.size, this.uv.sha256);
      const { unzipSync } = require('fflate');
      const files = unzipSync(new Uint8Array(zip), { filter: (f) => /(^|\/)uv\.exe$/.test(f.name) });
      const entry = Object.entries(files)[0];
      if (!entry) throw new Error('uv.exe fehlt im Archiv');
      fs.mkdirSync(path.dirname(this.uvExe()), { recursive: true });
      fs.writeFileSync(this.uvExe(), Buffer.from(entry[1]));
    }
    this.step('python');
    await this.exec(this.uvExe(), ['venv', path.join(this.dir, 'venv'), '--python', PKG.python, '--python-preference', 'only-managed', '--clear']);
    this.step('torch');
    const gpu = await this.hasNvidia();
    const index = gpu ? PKG.cuda : PKG.cpu;
    await this.exec(this.uvExe(), ['pip', 'install', '--python', this.python(), `torch==${PKG.torch}`, `torchaudio==${PKG.torchaudio}`, '--index-url', index]);
    this.step('omnivoice');
    await this.exec(this.uvExe(), ['pip', 'install', '--python', this.python(), `omnivoice==${PKG.omnivoice}`, 'soundfile']);
    try { await this.exec(this.uvExe(), ['cache', 'clean'], { timeoutMs: 10 * 60000 }); } catch { /* Platz sparen ist optional */ }
    fs.writeFileSync(this.marker(), JSON.stringify({ at: new Date().toISOString(), gpu, device: gpu ? 'cuda' : 'cpu', uv: this.uv.version, ...PKG }, null, 2));
    this.step('model');
    await this.start(); // lädt das Modell beim ersten Mal von Hugging Face
    await this.synthesize('Test.', {});
  }

  /** Alles entfernen (Dienst beenden, Ordner löschen). */
  async remove() {
    if (this.installing) throw new Error('Installation läuft noch');
    this.stop();
    await new Promise((r) => setTimeout(r, 800));
    fs.rmSync(this.dir, { recursive: true, force: true });
    this.lastError = ''; this.device = '';
    this.emit();
    return this.status();
  }

  /** Dienst starten (Modell laden). Gibt den Port zurück. */
  start() {
    if (this.proc && this.port) return Promise.resolve(this.port);
    if (this.starting) return this.starting;
    if (!exists(this.python())) return Promise.reject(new Error('Lokale KI-Stimme ist nicht installiert'));
    const script = path.join(this.dir, 'server.py');
    fs.writeFileSync(script, fs.readFileSync(path.join(__dirname, 'omnivoice_server.py')));
    this.token = crypto.randomBytes(24).toString('hex');
    this.starting = new Promise((resolve, reject) => {
      const child = this.run(this.python(), ['-I', script], {
        cwd: this.dir, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...this.env(), JARVIS_TTS_TOKEN: this.token, JARVIS_TTS_REFS: path.join(this.dir, 'refs') },
      });
      this.proc = child;
      const logFile = fs.createWriteStream(path.join(this.dir, 'server.log'), { flags: 'w' });
      let err = '';
      const timer = setTimeout(() => { reject(new Error('Stimmmodell lädt zu lange (Zeitlimit)')); this.stop(); }, 30 * 60000);
      child.stderr?.on('data', (b) => { logFile.write(b); err = (err + b.toString()).slice(-800); });
      child.stdout?.on('data', (b) => {
        const m = b.toString().match(/READY (\d+) (\S+)/);
        if (m) { clearTimeout(timer); this.port = Number(m[1]); this.device = m[2]; this.lastError = ''; log.info('OmniVoice bereit auf ' + this.device); this.emit(); resolve(this.port); }
      });
      child.on('error', (e) => { clearTimeout(timer); this.proc = null; reject(e); });
      child.on('close', (code) => {
        clearTimeout(timer); logFile.end();
        const was = this.port; this.proc = null; this.port = 0;
        if (!was) reject(new Error('Stimmdienst beendet (Code ' + code + ')' + (err ? ': ' + err.trim().split(/\r?\n/).pop().slice(0, 200) : '')));
        this.emit();
      });
    }).finally(() => { this.starting = null; });
    this.emit();
    return this.starting;
  }

  stop() {
    const p = this.proc; this.proc = null; this.port = 0;
    if (p) { try { p.stdin?.end(); } catch { /* ignore */ } try { p.kill(); } catch { /* ignore */ } }
    this.emit();
  }

  /** Beim App-Start vorwärmen, damit der erste Satz schnell kommt. */
  warmup() { if (this.allowed() && this.cfg().preload !== false) this.start().catch((e) => { this.lastError = e.message; log.info('Vorwärmen fehlgeschlagen: ' + e.message); }); }

  /** Satz → WAV-Buffer. Ein Satz nach dem anderen. */
  /** Pfad der mitgelieferten Vorlage für ein Profil (nur Startwert 1 und ohne eigene Beschreibung), sonst null. */
  bundledRef(preset, seed, customInstruct) {
    if (Number(seed) !== 1 || customInstruct || !BUNDLED[preset]) return null;
    const dst = path.join(this.dir, 'refs', 'bundled-' + BUNDLED[preset]);
    if (!exists(dst)) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, fs.readFileSync(path.join(__dirname, 'refs', BUNDLED[preset]))); }
    return dst;
  }

  synthesize(text, { instruct, ref = 'default', seed = 1, speed, refAudio, refText } = {}) {
    const job = this.queue.then(async () => {
      const port = await this.start();
      const r = await this.s.fetch(`http://127.0.0.1:${port}/tts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Token': this.token },
        body: JSON.stringify({ text: String(text).slice(0, 1500), instruct, ref, seed, speed, language: 'de', ref_audio: refAudio || undefined, ref_text: refAudio ? refText : undefined }), signal: AbortSignal.timeout(120000),
      });
      if (!r.ok) throw new Error('Lokale KI-Stimme: ' + ((await r.text().catch(() => '')).slice(0, 200) || 'HTTP ' + r.status));
      const wav = Buffer.from(await r.arrayBuffer());
      if (wav.length < 100) throw new Error('Lokale KI-Stimme hat kein Audio geliefert');
      return wav;
    });
    this.queue = job.catch(() => {});
    return job;
  }

  /** Stimme eines Profils neu würfeln: neuer Startwert → neue Referenz beim nächsten Satz (alte bleibt liegen, klein). */
  reroll(preset) {
    const seeds = { ...(this.s.settings.get('voice')?.tts?.omni?.seeds || {}) };
    seeds[preset] = ((Number(seeds[preset]) || 1) % 1000000) + 1;
    this.s.settings.update({ voice: { tts: { omni: { seeds } } } });
    return { seed: seeds[preset] };
  }
  /** Zurück zur mitgelieferten Stimme. */
  resetVoice(preset) {
    const seeds = { ...(this.s.settings.get('voice')?.tts?.omni?.seeds || {}) }; seeds[preset] = 1;
    const voices = { ...(this.s.settings.get('voice')?.tts?.omni?.voices || {}) }; voices[preset] = '';
    this.s.settings.update({ voice: { tts: { omni: { seeds, voices } } } });
    return { seed: 1 };
  }
}

/** Mitgelieferte Stimmen (aus OmniVoice-Beschreibungen erzeugt, keine echte Person) – Text der Aufnahmen. */
const REF_TEXT = 'Okay, kurzer Recap: Du bist Support mit Malphite. Die Botlane ist gegen Caitlyn und Lux schwer, wart auf den Jungler für den Gank, hol dir Control Wards und spar dir dein Ultimate für den Teamfight am Drachen. Nach dem Recall roamst du Mid, aber pass auf Skillshots auf.';
const BUNDLED = Object.freeze({ jarvis: 'jarvis.wav', alya: 'alya.wav' });

module.exports = { OmniVoice, UV, PKG, STEPS, REF_TEXT, BUNDLED };
