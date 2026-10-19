'use strict';
/**
 * Lokale Sprachausgabe mit Piper (neuronale TTS, nur CPU, offline).
 * - Programm + Standardstimme liegen im Installer (resources/tts), geprüft per SHA-256 beim Build.
 * - Weitere Stimmen nur nach ausdrücklichem Klick, Download mit fester Prüfsumme nach <Daten>/voices.
 * - Ein Satz nach dem anderen; während eines Spiels mit niedriger Priorität.
 * Kein Text verlässt den PC.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { VOICES, DEFAULT_VOICE } = require('./piper-voices');
const log = require('../core/logger').scope('tts');

const TIMEOUT_MS = 45000;
const exists = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };

class Piper {
  constructor({ dataDir, resourcesPath = process.resourcesPath, fetch, settings, isGaming = () => false, run = spawn, voices = VOICES }) {
    this.voices = voices; this.dataDir = dataDir; this.resourcesPath = resourcesPath; this.fetch = fetch; this.settings = settings; this.isGaming = isGaming; this.run = run;
    this.queue = Promise.resolve(); this.downloads = new Map();
  }

  cfg() { return this.settings.get('voice')?.tts || {}; }
  bundledDir() { return this.resourcesPath && path.isAbsolute(this.resourcesPath) ? path.join(this.resourcesPath, 'tts') : null; }
  userDir() { return path.join(this.dataDir, 'voices'); }
  executable() {
    const custom = this.cfg().piperExecutable;
    if (custom && exists(custom)) return custom;
    const d = this.bundledDir();
    const exe = d && path.join(d, process.platform === 'win32' ? 'piper.exe' : 'piper');
    return exe && exists(exe) ? exe : null;
  }

  /** Pfad einer installierten Stimme (mitgeliefert oder heruntergeladen) oder null. */
  voiceFile(id) {
    const v = this.voices.find((x) => x.id === id);
    if (!v) return null;
    for (const dir of [this.bundledDir() && path.join(this.bundledDir(), 'voices'), this.userDir()].filter(Boolean)) {
      const model = path.join(dir, v.id + '.onnx');
      if (exists(model) && exists(model + '.json')) return model;
    }
    return null;
  }

  status() {
    const exe = this.executable();
    const c = this.cfg();
    const voices = this.voices.map((v) => ({
      id: v.id, label: v.label, quality: v.quality, license: v.license, bundled: !!v.bundled,
      sizeMB: Math.round(v.files.reduce((a, f) => a + f.size, 0) / 1048576), installed: !!this.voiceFile(v.id),
      removable: !v.bundled && exists(path.join(this.userDir(), v.id + '.onnx')),
      styles: v.styles ? v.styles.map(([id, label]) => ({ id, label })) : null, speakers: v.speakers || null,
      downloading: this.downloads.get(v.id) || null,
    }));
    return { available: !!exe, engine: c.engine || 'piper', voice: c.voice || DEFAULT_VOICE, voices };
  }

  /** Stimme laden (nur auf Klick). Prüft Größe und SHA-256, schreibt erst nach erfolgreicher Prüfung. */
  async install(id) {
    const v = this.voices.find((x) => x.id === id);
    if (!v) throw new Error('Unbekannte Stimme');
    if (this.voiceFile(id)) return this.status();
    if (this.downloads.has(id)) throw new Error('Download läuft bereits');
    fs.mkdirSync(this.userDir(), { recursive: true });
    const total = v.files.reduce((a, f) => a + f.size, 0);
    let done = 0;
    this.downloads.set(id, { progress: 0 });
    const temps = [];
    try {
      for (const f of v.files) {
        const r = await this.fetch(f.url, { signal: AbortSignal.timeout(20 * 60000) });
        if (!r.ok || !r.body) throw new Error('Download fehlgeschlagen (HTTP ' + r.status + ')');
        const tmp = path.join(this.userDir(), f.name + '.download'); temps.push(tmp);
        const hash = crypto.createHash('sha256'); const out = fs.createWriteStream(tmp);
        let bytes = 0;
        const reader = r.body.getReader ? r.body.getReader() : null;
        if (!reader) throw new Error('Download nicht lesbar');
        for (;;) {
          const { value, done: end } = await reader.read();
          if (end) break;
          bytes += value.length; done += value.length;
          if (bytes > f.size + 1024) throw new Error('Datei größer als erwartet – abgebrochen');
          hash.update(value);
          if (!out.write(Buffer.from(value))) await new Promise((res) => out.once('drain', res));
          this.downloads.set(id, { progress: Math.min(0.99, done / total) });
        }
        await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
        if (hash.digest('hex') !== f.sha256) throw new Error('Prüfsumme stimmt nicht – Stimme wurde nicht übernommen');
      }
      v.files.forEach((f, i) => fs.renameSync(temps[i], path.join(this.userDir(), f.name)));
      log.info('Stimme installiert: ' + id);
      return this.status();
    } catch (e) {
      for (const t of temps) fs.rmSync(t, { force: true });
      throw e;
    } finally { this.downloads.delete(id); }
  }

  remove(id) {
    const v = this.voices.find((x) => x.id === id);
    if (!v || v.bundled) throw new Error('Diese Stimme kann nicht entfernt werden');
    for (const f of v.files) fs.rmSync(path.join(this.userDir(), f.name), { force: true });
    return this.status();
  }

  /** Sprecher-ID für Stimmen mit Stilen/mehreren Sprechern. */
  speakerId(model, voice, c) {
    const v = this.voices.find((x) => x.id === voice);
    if (v?.styles) {
      try { const map = JSON.parse(fs.readFileSync(model + '.json', 'utf8')).speaker_id_map || {}; const id = map[c.style || 'neutral']; return Number.isInteger(id) ? id : null; } catch { return null; }
    }
    if (v?.speakers) return Math.max(0, Math.min(v.speakers - 1, Math.round(Number(c.speaker) || 0)));
    return null;
  }

  /**
   * Text → WAV (Buffer). Einstellungen: voice, style/speaker, speed (0.6–1.6), pitch (0.8–1.25).
   * Die Tonhöhe wird beim Abspielen über die Abspielrate verändert; damit das Tempo gleich bleibt,
   * spricht Piper entsprechend langsamer (length_scale × pitch).
   */
  synthesize(text, override = {}) {
    const job = this.queue.then(() => this._synth(text, override));
    this.queue = job.catch(() => {});
    return job;
  }

  async _synth(text, override) {
    const c = { ...this.cfg(), ...override };
    const exe = this.executable();
    if (!exe) throw new Error('Lokale Sprachausgabe (Piper) ist nicht installiert.');
    const voice = c.voice || DEFAULT_VOICE;
    const model = this.voiceFile(voice) || this.voiceFile(DEFAULT_VOICE);
    if (!model) throw new Error('Keine Stimme installiert.');
    const line = String(text || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 1500);
    if (!line) throw new Error('Kein Text');
    const speed = Math.max(0.6, Math.min(1.6, Number(c.speed) || 1));
    const pitch = Math.max(0.8, Math.min(1.25, Number(c.pitch) || 1));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-tts-'));
    const out = path.join(dir, 'out.wav');
    const args = ['--model', model, '--output_file', out, '--length_scale', (pitch / speed).toFixed(3), '--sentence_silence', '0.15'];
    const sp = this.speakerId(model, voice, c);
    if (sp != null) args.push('--speaker', String(sp));
    const engineDir = path.dirname(exe);
    if (fs.existsSync(path.join(engineDir, 'espeak-ng-data'))) args.push('--espeak_data', path.join(engineDir, 'espeak-ng-data'));
    try {
      await new Promise((resolve, reject) => {
        const child = this.run(exe, args, { cwd: engineDir, windowsHide: true, shell: false, stdio: ['pipe', 'ignore', 'pipe'] });
        let err = '';
        const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } reject(new Error('Sprachausgabe: Zeitlimit erreicht')); }, TIMEOUT_MS);
        if (this.isGaming() && child.pid) { try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* ignore */ } }
        child.stderr?.on('data', (b) => { err = (err + b.toString()).slice(-600); });
        child.on('error', (e) => { clearTimeout(timer); reject(new Error('Piper konnte nicht starten: ' + e.message)); });
        child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Piper beendet mit Code ' + code + (err ? ': ' + err.split('\n').filter(Boolean).pop() : ''))); });
        child.stdin.end(line + '\n', 'utf8');
      });
      const wav = fs.readFileSync(out);
      if (wav.length < 100) throw new Error('Sprachausgabe leer');
      return { wav, pitch, voice };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
}

module.exports = { Piper, VOICES, DEFAULT_VOICE };
