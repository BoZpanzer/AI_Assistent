'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { zipSync } = require('fflate');
const { resolveWhisperPaths } = require('../src/main/voice/local-whisper');

test('bundled resources/voice is used automatically on first launch', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-voice-bundle-'));
  try {
    const dir = path.join(root, 'voice');
    fs.mkdirSync(dir);
    const executable = path.join(dir, 'whisper-cli.exe');
    const model = path.join(dir, 'ggml-base.bin');
    fs.writeFileSync(executable, 'binary-fixture');
    fs.writeFileSync(model, 'model-fixture');
    assert.deepEqual(resolveWhisperPaths({}, { resourcesPath: root }), { executable, model, bundled: true });
    assert.deepEqual(resolveWhisperPaths({ whisperExecutable: 'missing', whisperModel: 'missing' }, { resourcesPath: root }),
      { executable, model, bundled: true }, 'older invalid manual config does not break new installer');
    const user = path.join(root, 'custom.exe');
    const customModel = path.join(root, 'custom-model.bin');
    fs.writeFileSync(user, 'custom');
    fs.writeFileSync(customModel, 'custom model');
    assert.deepEqual(resolveWhisperPaths({ whisperExecutable: user, whisperModel: customModel }, { resourcesPath: root }),
      { executable: user, model: customModel, bundled: false });
    fs.rmSync(model);
    assert.throws(() => resolveWhisperPaths({}, { resourcesPath: root }), /Spracheingabe/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('build downloads only verified, size-bounded HTTPS artifacts', async () => {
  const { downloadVerified } = await import('../scripts/build-whisper-assets.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-voice-download-'));
  const data = Buffer.from('mock package to test checksum');
  const sha256 = crypto.createHash('sha256').update(data).digest('hex');
  const url = 'https://example.org/voice.zip';
  try {
    const destination = path.join(dir, 'verified.zip');
    const fetched = () => Promise.resolve(new Response(data, { status: 200 }));
    const saved = await downloadVerified({ url, sha256, maxBytes: 1000 }, destination, fetched);
    assert.equal(saved, data.length);
    assert.deepEqual(fs.readFileSync(destination), data);
    await assert.rejects(downloadVerified({ url, sha256: '0'.repeat(64), maxBytes: 1000 }, destination + '.bad', fetched), /SHA-256 mismatch/);
    assert.equal(fs.existsSync(destination + '.bad'), false);
    await assert.rejects(downloadVerified({ url, sha256, maxBytes: 3 }, destination + '.oversize', fetched), /size limit/);
    assert.equal(fs.existsSync(destination + '.oversize'), false);
    await assert.rejects(downloadVerified({ url: 'http://example.org/voice.zip', sha256, maxBytes: 1000 }, destination + '.http', fetched), /Invalid/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Whisper ZIP unpacking extracts only the intended executable and DLLs, never paths', async () => {
  const { extractEngine, assets } = await import('../scripts/build-whisper-assets.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-voice-zip-'));
  try {
    const zip = path.join(dir, 'engine.zip');
    const body = zipSync({
      'build/bin/whisper-cli.exe': Buffer.from('exe'),
      'build/bin/ggml.dll': Buffer.from('dll'),
      '../outside.txt': Buffer.from('should not unpack'),
      'readme.md': Buffer.from('not executable'),
    });
    fs.writeFileSync(zip, body);
    const dest = path.join(dir, 'unpacked');
    fs.mkdirSync(dest);
    assert.deepEqual(extractEngine(zip, dest).sort(), ['ggml.dll', 'whisper-cli.exe']);
    assert.deepEqual(fs.readdirSync(dest).sort(), ['ggml.dll', 'whisper-cli.exe']);
    assert.equal(fs.existsSync(path.join(dir, 'outside.txt')), false);
    assert.match(assets.model.sha256, /^[0-9a-f]{64}$/);
    const corrupt = path.join(dir, 'no-exe.zip');
    fs.writeFileSync(corrupt, zipSync({ 'lib.dll': Buffer.from('only library') }));
    assert.throws(() => extractEngine(corrupt, dest), /whisper-cli/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
