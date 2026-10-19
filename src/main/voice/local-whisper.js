'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

/**
 * Offline speech-to-text via an explicitly installed whisper.cpp executable.
 * The process is launched without a shell, with no cloud API calls or network fallback.
 * Temporary WAV/transcript files are deleted after each transcription.
 */
const SAMPLE_RATE = 16000;
const MAX_SECONDS = 30;
const MAX_BYTES = SAMPLE_RATE * 2 * MAX_SECONDS;
const MIN_BYTES = SAMPLE_RATE; // >= 0.5 second
const TIMEOUT_MS = 120000;

function pcmToWav(pcm) {
  if (!Buffer.isBuffer(pcm) || pcm.length < MIN_BYTES || pcm.length > MAX_BYTES || pcm.length % 2) {
    throw new Error('Lokale Sprachaufnahme muss zwischen 0,5 und 30 Sekunden liegen.');
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function decodePcm(audio) {
  if (typeof audio !== 'string' || audio.length > Math.ceil(MAX_BYTES / 3) * 4 + 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(audio)) {
    throw new Error('Ungültige lokale Sprachaufnahme.');
  }
  return pcmToWav(Buffer.from(audio, 'base64'));
}

function checkInstallation(executable, model) {
  if (!executable || !model || !path.isAbsolute(executable) || !path.isAbsolute(model)) {
    throw new Error('Lokale Spracheingabe: Bitte whisper-cli und ein deutsches Whisper-Modell unter Einstellungen → Sprache auswählen.');
  }
  for (const [p, label] of [[executable, 'whisper-cli'], [model, 'Whisper-Modell']]) {
    let stat;
    try { stat = fs.statSync(p); } catch { throw new Error(label + ' wurde nicht gefunden. Bitte den Pfad in den Spracheinstellungen prüfen.'); }
    if (!stat.isFile()) throw new Error(label + ' ist keine Datei.');
  }
  if (process.platform === 'win32' && path.extname(executable).toLowerCase() !== '.exe') {
    throw new Error('Auf Windows muss whisper-cli.exe ausgewählt werden.');
  }
}

/** Locate an embedded runtime in the installed Electron resources directory.
 * Custom paths still work for development/advanced users. If they are missing,
 * use the bundled, checksum-verified Windows runtime. No auto-download at runtime.
 */
function resolveWhisperPaths(settings = {}, { resourcesPath = process.resourcesPath } = {}) {
  const custom = { executable: settings.whisperExecutable || '', model: settings.whisperModel || '' };
  try {
    checkInstallation(custom.executable, custom.model);
    return { ...custom, bundled: false };
  } catch { /* custom files missing: try official packaged defaults */ }
  if (resourcesPath && path.isAbsolute(resourcesPath)) {
    const bundled = {
      executable: path.join(resourcesPath, 'voice', 'whisper-cli.exe'),
      model: path.join(resourcesPath, 'voice', 'ggml-base.bin'),
    };
    try {
      checkInstallation(bundled.executable, bundled.model);
      return { ...bundled, bundled: true };
    } catch { /* packaged runtime absent */ }
  }
  // Keep useful error messages in development; never fall back to a cloud service.
  checkInstallation(custom.executable, custom.model);
  throw new Error('Lokales Whisper fehlt. Bitte die JARVIS-Version mit mitgelieferter Spracheingabe installieren.');
}

/**
 * threads: CPU-Threads für whisper.cpp (beim Gaming von der IPC-Schicht auf 2 begrenzt).
 * lowPriority: Prozess auf „niedriger als normal“ setzen, damit das Spiel Vorrang behält.
 */
async function transcribeLocal({ audio, executable, model, threads = 4, lowPriority = false }, { run = spawn, timeoutMs = TIMEOUT_MS } = {}) {
  checkInstallation(executable, model);
  const wav = decodePcm(audio);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-voice-'));
  const input = path.join(dir, 'input.wav');
  const output = path.join(dir, 'transcription');
  try {
    fs.writeFileSync(input, wav, { mode: 0o600, flag: 'wx' });
    const t = Math.max(1, Math.min(16, Number.isInteger(threads) ? threads : 4));
    const args = ['-m', model, '-f', input, '-l', 'de', '-t', String(t), '-nt', '-otxt', '-of', output];
    await new Promise((resolve, reject) => {
      let child;
      try { child = run(executable, args, { shell: false, windowsHide: true, stdio: 'ignore' }); }
      catch { return reject(new Error('Whisper konnte nicht gestartet werden.')); }
      if (lowPriority && child?.pid) { try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not permitted: keep default */ } }
      let settled = false;
      const finish = (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        e ? reject(e) : resolve();
      };
      const timer = setTimeout(() => {
        try { child.kill(); } catch { /* already stopped */ }
        finish(new Error('Lokale Spracherkennung hat zu lange gedauert.'));
      }, timeoutMs);
      child.once('error', () => finish(new Error('Whisper konnte nicht gestartet werden.')));
      child.once('close', (code) => finish(code === 0 ? null : new Error('Lokale Spracherkennung fehlgeschlagen (Whisper-Exit ' + code + ').')));
    });
    const file = output + '.txt';
    const stat = fs.statSync(file);
    if (stat.size > 16 * 1024) throw new Error('Whisper-Transkript ist zu groß.');
    const text = fs.readFileSync(file, 'utf8').trim();
    if (!text) throw new Error('Keine Sprache erkannt. Bitte deutlicher sprechen.');
    return text.slice(0, 4000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { decodePcm, pcmToWav, checkInstallation, resolveWhisperPaths, transcribeLocal, MAX_SECONDS, MAX_BYTES, SAMPLE_RATE };
