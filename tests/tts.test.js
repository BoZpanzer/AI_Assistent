'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { speakable } = require('../src/main/voice/speakable');
const { Piper, VOICES, DEFAULT_VOICE } = require('../src/main/voice/piper');

const LOL = `*(Hinweis: Der League-Client ist aktuell nicht aktiv verbunden.)*

Hier ist die Auswertung deiner letzten 5 Matches (**1 Sieg, 4 Niederlagen**):

### 1. Match-Übersicht
* **Sett (Niederlage, 48 Min):** 1/10/9 – 4.7 CS/min, 25% KP
* **Irelia (Niederlage, 23 Min):** 3/9/2 – 6.4 CS/min, 36% KP

---

### 2. Die wichtigsten Fehlermuster
1. **Frühe Tode & Ganks (Höchste Priorität)**
   * Du stirbst im Schnitt **2-mal vor Minute 14** (in 3 von 5 Spielen).
   * Bei Minute 10 liegst du **-15 CS** hinten, bei Minute 15 **-695 Gold**. 🎉
   * Mehr: [Guide](https://example.com/x)`;

test('Speech version: no markdown symbols, numbers and units spoken naturally, long answers shortened', () => {
  const full = speakable(LOL, { full: true }).text;
  assert.doesNotMatch(full, /[*#|`🎉]|https?:/);
  assert.match(full, /1, 10, 9/);
  assert.match(full, /4,7 CS pro Minute/);
  assert.match(full, /25 Prozent Kill-Beteiligung/);
  assert.match(full, /minus 695 Gold/);
  assert.match(full, /Frühe Tode und Ganks/);
  assert.match(full, /Mehr: Guide/);
  const short = speakable(LOL);
  assert.ok(short.truncated);
  assert.match(short.text, /Den Rest findest du im Chat\.$/);
  assert.ok(short.text.length < 600);
  assert.equal(short.parts[0], 'Hinweis: Der League-Client ist aktuell nicht aktiv verbunden.', 'erster Satz allein → Ausgabe startet sofort');
  assert.ok(speakable('Kurz und gut.').parts.length === 1 && !speakable('Kurz und gut.').truncated);
});

function setup({ gaming = false, fail = false } = {}) {
  const res = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-res-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-data-'));
  const exe = path.join(res, 'tts', process.platform === 'win32' ? 'piper.exe' : 'piper');
  fs.mkdirSync(path.join(res, 'tts', 'voices'), { recursive: true });
  fs.mkdirSync(path.join(res, 'tts', 'espeak-ng-data'));
  fs.writeFileSync(exe, '');
  fs.writeFileSync(path.join(res, 'tts', 'voices', DEFAULT_VOICE + '.onnx'), 'x');
  fs.writeFileSync(path.join(res, 'tts', 'voices', DEFAULT_VOICE + '.onnx.json'), '{}');
  const calls = [];
  const run = (cmd, args) => {
    const c = new EventEmitter(); c.pid = undefined; c.kill = () => {};
    c.stderr = new EventEmitter(); let input = '';
    c.stdin = { end: (t) => { input = t; setImmediate(() => { if (!fail) fs.writeFileSync(args[args.indexOf('--output_file') + 1], Buffer.alloc(2000, 1)); c.emit('close', fail ? 1 : 0); }); } };
    calls.push({ cmd, args, get input() { return input; } });
    return c;
  };
  let cfg = { tts: {} };
  const p = new Piper({ dataDir: data, resourcesPath: res, settings: { get: () => cfg }, run, isGaming: () => gaming });
  return { p, calls, res, data, setCfg: (t) => { cfg = { tts: t }; }, cleanup: () => { fs.rmSync(res, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); } };
}

test('Piper: bundled default voice, speed and pitch become length_scale, one line of text, temp files removed', async () => {
  const { p, calls, cleanup, setCfg } = setup();
  try {
    assert.equal(p.status().available, true);
    assert.equal(p.status().voices.find((v) => v.id === DEFAULT_VOICE).installed, true);
    setCfg({ speed: 1.25, pitch: 1.1 });
    const r = await p.synthesize('Hallo\nWelt');
    assert.equal(r.wav.length, 2000); assert.equal(r.pitch, 1.1);
    const a = calls[0].args;
    assert.equal(a[a.indexOf('--length_scale') + 1], (1.1 / 1.25).toFixed(3));
    assert.ok(a.includes('--espeak_data'));
    assert.equal(calls[0].input, 'Hallo Welt\n');
    assert.equal(fs.existsSync(path.dirname(a[a.indexOf('--output_file') + 1])), false, 'Temp-Ordner gelöscht');
    // Nicht installierte Stimme → Standardstimme statt Fehler
    setCfg({ voice: 'de_DE-thorsten-high' });
    await p.synthesize('Test');
    assert.ok(calls[1].args[calls[1].args.indexOf('--model') + 1].endsWith(DEFAULT_VOICE + '.onnx'));
  } finally { cleanup(); }
});

test('Piper: style voices map the mood to the speaker id from the voice config', async () => {
  const { p, calls, res, cleanup, setCfg } = setup();
  try {
    const id = 'de_DE-thorsten_emotional-medium';
    fs.writeFileSync(path.join(res, 'tts', 'voices', id + '.onnx'), 'x');
    fs.writeFileSync(path.join(res, 'tts', 'voices', id + '.onnx.json'), JSON.stringify({ speaker_id_map: { amused: 0, angry: 1, neutral: 4, whisper: 7 } }));
    setCfg({ voice: id, style: 'whisper' });
    await p.synthesize('Psst');
    assert.equal(calls[0].args[calls[0].args.indexOf('--speaker') + 1], '7');
  } finally { cleanup(); }
});

test('Piper: failures are reported (fallback to Windows voice happens in the UI)', async () => {
  const { p, cleanup } = setup({ fail: true });
  try { await assert.rejects(p.synthesize('x'), /Code 1/); } finally { cleanup(); }
  const none = new Piper({ dataDir: os.tmpdir(), resourcesPath: '/does/not/exist', settings: { get: () => ({}) } });
  await assert.rejects(none.synthesize('x'), /nicht installiert/);
});

test('Voice download: only on request, checksum verified, nothing kept on mismatch', async () => {
  const body = Buffer.from('voice-bytes');
  const good = crypto.createHash('sha256').update(body).digest('hex');
  const stream = () => ({ ok: true, status: 200, body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(body)); c.close(); } }) });
  const mk = (sha) => [{ id: 'v1', label: 'Test', quality: '', license: 'CC0', files: [{ name: 'v1.onnx', url: 'https://x/v1.onnx', size: body.length, sha256: sha }, { name: 'v1.onnx.json', url: 'https://x/v1.onnx.json', size: body.length, sha256: sha }] }];
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-dl-'));
  try {
    const bad = new Piper({ dataDir: data, resourcesPath: '/nope', settings: { get: () => ({}) }, fetch: async () => stream(), voices: mk('0'.repeat(64)) });
    await assert.rejects(bad.install('v1'), /Prüfsumme/);
    assert.deepEqual(fs.readdirSync(path.join(data, 'voices')), []);
    const ok = new Piper({ dataDir: data, resourcesPath: '/nope', settings: { get: () => ({}) }, fetch: async () => stream(), voices: mk(good) });
    const st = await ok.install('v1');
    assert.equal(st.voices[0].installed, true); assert.equal(st.voices[0].removable, true);
    ok.remove('v1');
    assert.equal(ok.status().voices[0].installed, false);
    await assert.rejects(ok.install('unbekannt'), /Unbekannte Stimme/);
  } finally { fs.rmSync(data, { recursive: true, force: true }); }
});

test('Voice catalog: free licences only, pinned checksums, default voice is bundled', () => {
  for (const v of VOICES) {
    assert.match(v.license, /^CC0|^CC BY 4\.0/);
    for (const f of v.files) { assert.match(f.sha256, /^[0-9a-f]{64}$/); assert.match(f.url, /^https:\/\/huggingface\.co\/rhasspy\/piper-voices\/resolve\/v1\.0\.0\//); assert.ok(f.size > 0); }
  }
  assert.ok(VOICES.find((v) => v.id === DEFAULT_VOICE).bundled);
});
