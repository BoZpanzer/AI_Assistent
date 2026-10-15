// Bundle a verified Windows whisper.cpp CPU runtime and multilingual base model.
// Runs ONLY when building Windows releases, never on app startup. No runtime network.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
const require = createRequire(import.meta.url);
const { unzipSync } = require('fflate');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundleDir = path.join(root, 'build', 'whisper-runtime');
const assets = Object.freeze({
  engine: Object.freeze({
    url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip',
    sha256: 'f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c',
    maxBytes: 32 * 1024 * 1024,
  }),
  model: Object.freeze({
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
    maxBytes: 190 * 1024 * 1024,
  }),
});

function sha256(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
    return h.digest('hex');
  } finally { fs.closeSync(fd); }
}

async function downloadVerified(asset, output, fetchImpl = fetch) {
  if (!/^https:\/\//.test(asset.url) || !/^[0-9a-f]{64}$/.test(asset.sha256)) throw new Error('Invalid bundled voice asset manifest');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temp = output + '.download';
  fs.rmSync(temp, { force: true });
  try {
    const response = await fetchImpl(asset.url, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok || !response.body || new URL(response.url || asset.url).protocol !== 'https:') {
      throw new Error('Verified voice asset download failed (HTTP ' + response.status + ')');
    }
    let bytes = 0;
    const hash = crypto.createHash('sha256');
    const bound = new Transform({
      transform(chunk, _encoding, done) {
        bytes += chunk.length;
        if (bytes > asset.maxBytes) done(new Error('Voice asset exceeds download size limit'));
        else { hash.update(chunk); done(null, chunk); }
      },
    });
    await pipeline(Readable.fromWeb(response.body), bound, fs.createWriteStream(temp, { flags: 'wx' }));
    const found = hash.digest('hex');
    if (found !== asset.sha256) throw new Error('Voice asset SHA-256 mismatch. Refusing to package unverified code or model.');
    fs.renameSync(temp, output);
    return bytes;
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

function extractEngine(zipPath, destination) {
  const input = fs.readFileSync(zipPath);
  if (input.length > assets.engine.maxBytes) throw new Error('Whisper runtime archive too large');
  const entries = unzipSync(new Uint8Array(input));
  const copied = new Set();
  let executable = false;
  for (const [name, bytes] of Object.entries(entries)) {
    const filename = path.posix.basename(name.replace(/\\/g, '/'));
    const lower = filename.toLowerCase();
    if (!(lower === 'whisper-cli.exe' || /^[a-z0-9_.-]+\.dll$/.test(lower))) continue;
    if (bytes.length > 64 * 1024 * 1024 || copied.has(lower)) throw new Error('Unexpected Whisper runtime archive contents');
    fs.writeFileSync(path.join(destination, filename), Buffer.from(bytes));
    copied.add(lower);
    if (lower === 'whisper-cli.exe') executable = true;
  }
  if (!executable) throw new Error('Official Whisper archive has no whisper-cli.exe');
  return [...copied];
}

async function buildBundle({ download = downloadVerified } = {}) {
  // Separate staging folder + atomic replacement. Never retain unverified binaries
  // from a previous build.
  const stage = bundleDir + '-stage';
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  const archive = path.join(stage, 'engine.zip');
  const model = path.join(stage, 'ggml-base.bin');
  try {
    console.log('▶ Offline voice: download and verify whisper.cpp b5130 (Windows x64)');
    await download(assets.engine, archive);
    if (sha256(archive) !== assets.engine.sha256) throw new Error('Whisper runtime verification failed');
    const extracted = extractEngine(archive, stage);
    fs.rmSync(archive);
    console.log('▶ Offline voice: download and verify multilingual ggml-base.bin (~148 MB)');
    await download(assets.model, model);
    if (sha256(model) !== assets.model.sha256) throw new Error('Whisper model verification failed');
    fs.writeFileSync(path.join(stage, 'VOICE-SOURCES.txt'), [
      'whisper.cpp b5130 (MIT): https://github.com/ggml-org/whisper.cpp',
      'Model ggml-base.bin (multilingual): https://huggingface.co/ggerganov/whisper.cpp',
      'Whisper ZIP SHA-256: ' + assets.engine.sha256,
      'Model SHA-256: ' + assets.model.sha256,
    ].join('\r\n'));
    fs.rmSync(bundleDir, { recursive: true, force: true });
    fs.renameSync(stage, bundleDir);
    console.log('✔ Voice bundled: ' + extracted.join(', ') + ', ggml-base.bin');
  } catch (e) {
    fs.rmSync(stage, { recursive: true, force: true });
    throw e;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildBundle().catch((e) => { console.error('::error title=Voice bundle failed::' + e.message); process.exitCode = 1; });
}
export { assets, sha256, downloadVerified, extractEngine, buildBundle };
