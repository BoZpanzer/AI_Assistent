'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { decodePcm, pcmToWav, checkInstallation, transcribeLocal, MAX_BYTES } = require('../src/main/voice/local-whisper');

test('local PCM16 WAV conversion is strict, mono, 16 kHz and bounded', () => {
  const pcm = Buffer.alloc(32000, 2); // 1 second
  const wav = pcmToWav(pcm);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.deepEqual(decodePcm(pcm.toString('base64')), wav);
  assert.throws(() => decodePcm('bad-encoded$$$'), /Ungültig/i);
  assert.throws(() => pcmToWav(Buffer.alloc(100)), /0,5 und 30/);
  assert.throws(() => pcmToWav(Buffer.alloc(MAX_BYTES + 2)), /0,5 und 30/);
});

test('offline whisper execution uses no shell, writes only ephemeral files and returns transcript', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-whisper-test-'));
  const model = path.join(data, 'ggml-base.bin');
  const executable = process.execPath;
  fs.writeFileSync(model, Buffer.from('test model fixture'));
  let recordingDir;
  try {
    const run = (command, args, options) => {
      assert.equal(command, executable);
      assert.equal(options.shell, false);
      assert.equal(options.stdio, 'ignore');
      assert.ok(args.includes('-l'));
      assert.ok(args.includes('de'));
      assert.ok(args.includes('-otxt'));
      const input = args[args.indexOf('-f') + 1];
      recordingDir = path.dirname(input);
      const written = fs.readFileSync(input);
      assert.equal(written.toString('ascii', 0, 4), 'RIFF');
      const out = args[args.indexOf('-of') + 1];
      const child = new EventEmitter();
      child.kill = () => {};
      setImmediate(() => {
        fs.writeFileSync(out + '.txt', 'Hallo JARVIS – alles bleibt lokal!');
        child.emit('close', 0);
      });
      return child;
    };
    const text = await transcribeLocal({
      audio: Buffer.alloc(32000).toString('base64'), executable, model,
    }, { run, timeoutMs: 5000 });
    assert.equal(text, 'Hallo JARVIS – alles bleibt lokal!');
    assert.equal(fs.existsSync(recordingDir), false, 'temporary audio and transcript are removed');
  } finally { fs.rmSync(data, { recursive: true, force: true }); }
});

test('missing whisper executable or model never falls back to cloud', async () => {
  const audio = Buffer.alloc(32000).toString('base64');
  let spawned = false;
  await assert.rejects(
    transcribeLocal({ audio, executable: '', model: '' }, { run: () => { spawned = true; } }),
    /Spracheingabe/,
  );
  assert.equal(spawned, false);
  assert.throws(() => checkInstallation('relative-whisper.exe', 'relative-model.bin'), /Spracheingabe/);
});

test('failed offline process removes temporary files and returns an error', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-whisper-test-'));
  const model = path.join(data, 'model.bin');
  fs.writeFileSync(model, 'test');
  let wavDir;
  try {
    const run = (_executable, args) => {
      wavDir = path.dirname(args[args.indexOf('-f') + 1]);
      const child = new EventEmitter();
      child.kill = () => {};
      setImmediate(() => child.emit('close', 1));
      return child;
    };
    await assert.rejects(transcribeLocal({
      audio: Buffer.alloc(32000).toString('base64'),
      executable: process.execPath, model,
    }, { run, timeoutMs: 5000 }), /fehlgeschlagen/);
    assert.equal(fs.existsSync(wavDir), false);
  } finally { fs.rmSync(data, { recursive: true, force: true }); }
});
