// Bundle the verified Windows Piper TTS runtime (MIT) and the default German voice
// "thorsten" (medium, CC0). Runs ONLY when building Windows releases, never on app startup.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { downloadVerified, sha256 } from './build-whisper-assets.mjs';
const require = createRequire(import.meta.url);
const { unzipSync } = require('fflate');
const { VOICES, DEFAULT_VOICE } = require('../src/main/voice/piper-voices.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundleDir = path.join(root, 'build', 'piper-runtime');
const engine = Object.freeze({
  url: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip',
  sha256: 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea',
  maxBytes: 40 * 1024 * 1024,
});

/** Extract piper/ (piper.exe, DLLs, espeak-ng-data/**) without path traversal. */
function extractEngine(zipPath, destination) {
  const entries = unzipSync(new Uint8Array(fs.readFileSync(zipPath)));
  let exe = false; let n = 0;
  for (const [name, bytes] of Object.entries(entries)) {
    const rel = name.replace(/\\/g, '/').replace(/^piper\//, '');
    if (!rel || rel.endsWith('/')) continue;
    if (rel.split('/').some((p) => p === '..' || p === '') || path.isAbsolute(rel)) throw new Error('Unsafe path in Piper archive: ' + name);
    if (bytes.length > 64 * 1024 * 1024) throw new Error('Unexpected Piper archive contents');
    const out = path.join(destination, ...rel.split('/'));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(bytes));
    if (rel.toLowerCase() === 'piper.exe') exe = true;
    n++;
  }
  if (!exe) throw new Error('Official Piper archive has no piper.exe');
  if (!fs.existsSync(path.join(destination, 'espeak-ng-data'))) throw new Error('Piper archive lacks espeak-ng-data');
  return n;
}

async function buildPiperBundle({ download = downloadVerified } = {}) {
  const stage = bundleDir + '-stage';
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(path.join(stage, 'voices'), { recursive: true });
  try {
    console.log('▶ Sprachausgabe: Piper 2023.11.14-2 (Windows x64) laden und prüfen');
    const zip = path.join(stage, 'piper.zip');
    await download(engine, zip);
    if (sha256(zip) !== engine.sha256) throw new Error('Piper runtime verification failed');
    const files = extractEngine(zip, stage);
    fs.rmSync(zip);
    const v = VOICES.find((x) => x.id === DEFAULT_VOICE);
    console.log('▶ Sprachausgabe: Standardstimme ' + v.id + ' laden und prüfen');
    for (const f of v.files) {
      const out = path.join(stage, 'voices', f.name);
      await download({ url: f.url, sha256: f.sha256, maxBytes: f.size + 1024 }, out);
      if (sha256(out) !== f.sha256) throw new Error('Voice verification failed: ' + f.name);
    }
    fs.writeFileSync(path.join(stage, 'TTS-SOURCES.txt'), [
      'Piper 2023.11.14-2 (MIT): https://github.com/rhasspy/piper – ZIP SHA-256 ' + engine.sha256,
      'Enthält espeak-ng (GPL-3.0, Quelltext: https://github.com/espeak-ng/espeak-ng) und onnxruntime (MIT).',
      'Stimme ' + v.id + ' (' + v.license + '): https://huggingface.co/rhasspy/piper-voices',
    ].join('\r\n'));
    fs.rmSync(bundleDir, { recursive: true, force: true });
    fs.renameSync(stage, bundleDir);
    console.log('✔ Sprachausgabe gebündelt: ' + files + ' Dateien + ' + v.id);
  } catch (e) {
    fs.rmSync(stage, { recursive: true, force: true });
    throw e;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildPiperBundle().catch((e) => { console.error('::error title=Piper bundle failed::' + e.message); process.exitCode = 1; });
}
export { engine, extractEngine, buildPiperBundle };
