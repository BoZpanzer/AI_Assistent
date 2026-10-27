'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { tempCore } = require('./helpers');
const { OmniVoice, PKG } = require('../src/main/voice/omnivoice');
const { localPronunciation } = require('../src/main/voice/speech');

/** Fake-Prozesse: uv/nvidia-smi enden sofort, der Python-Dienst meldet READY. */
function fakeRun(calls) {
  return (cmd, args, opts) => {
    calls.push({ cmd: path.basename(cmd), args, env: opts?.env });
    const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter();
    c.stdin = { end() {} }; c.kill = () => setImmediate(() => c.emit('close', 0));
    setImmediate(() => {
      if (args.includes('-I')) { c.stdout.emit('data', Buffer.from('READY 4567 cuda:0\n')); return; }
      if (cmd === 'nvidia-smi') c.stdout.emit('data', Buffer.from('NVIDIA GeForce RTX 2070 SUPER, 8192 MiB\n'));
      if (/uv/.test(path.basename(cmd)) && args[0] === 'venv') fs.mkdirSync(path.join(args[1], 'Scripts'), { recursive: true }), fs.writeFileSync(path.join(args[1], 'Scripts', 'python.exe'), '');
      c.stdout.emit('data', Buffer.from('ok\n')); c.emit('close', 0);
    });
    return c;
  };
}
const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(400)]);

test('OmniVoice: install only via uv with pinned checksum, CUDA PyTorch on NVIDIA, service with token, game rule frees VRAM', async () => {
  const { zipSync } = require('fflate');
  const zip = Buffer.from(zipSync({ 'uv.exe': new Uint8Array([1, 2, 3]) }));
  const uv = { version: 't', url: 'https://example/uv.zip', size: zip.length, sha256: crypto.createHash('sha256').update(zip).digest('hex') };
  const posts = [];
  const fetch = async (url, init) => {
    if (url === uv.url) return new Response(zip);
    throw new Error('offline ' + url);
  };
  const { core, cleanup } = tempCore({ fetch });
  try {
    const calls = [];
    const httpPost = async (port, p, token, json) => { assert.equal(port, 4567); assert.equal(p, '/tts'); posts.push({ headers: { 'X-Token': token }, body: json }); return { status: 200, body: wav }; };
    const o = new OmniVoice(core, { run: fakeRun(calls), platform: 'win32', uv, httpPost });
    core.omnivoice = o;
    assert.equal(o.allowed(), false, 'nicht installiert');
    o.install();
    for (let i = 0; i < 100 && o.installing; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(o.lastError, ''); assert.ok(o.installed());
    const torch = calls.find((c) => c.args.includes(`torch==${PKG.torch}`));
    assert.ok(torch.args.includes(PKG.cuda), 'NVIDIA → CUDA-PyTorch');
    assert.ok(calls.some((c) => c.args.includes(`omnivoice==${PKG.omnivoice}`)));
    assert.match(calls.find((c) => c.args.includes('-I')).env.JARVIS_TTS_TOKEN, /^[0-9a-f]{48}$/);
    assert.equal(posts.length, 1, 'Testsatz nach der Installation'); assert.equal(posts[0].headers['X-Token'].length, 48);
    assert.equal(o.status().device, 'cuda:0');

    // auch beim Zocken an (Tarkov)
    core.gaming.context.running = ['eft']; assert.equal(o.allowed(), true);
    core.gaming.context.running = [];
    // Sprachausgabe nutzt die lokale KI-Stimme mit Profilbeschreibung + Eindeutschung
    core.settings.update({ voice: { tts: { engine: 'auto', preset: 'jarvis' } } });
    const r = await core.speech.synthesize('Wart auf den Jungler für den Gank.');
    assert.equal(r.engine, 'omnivoice');
    const last = posts.at(-1).body;
    assert.equal(last.text, 'Wart auf den Dschungler für den Gänk.');
    assert.equal(last.instruct, 'male, middle-aged, low pitch'); assert.match(last.ref, /^jarvis-1-/);
    assert.match(last.ref_audio, /bundled-jarvis\.wav$/, 'mitgelieferte J.A.R.V.I.S.-Stimme'); assert.ok(fs.existsSync(last.ref_audio)); assert.match(last.ref_text, /Recap/);
    // neu würfeln → neue Referenz
    o.reroll('jarvis');
    await core.speech.synthesize('Noch ein Satz.');
    assert.match(posts.at(-1).body.ref, /^jarvis-2-/); assert.equal(posts.at(-1).body.ref_audio, undefined, 'gewürfelt → aus Beschreibung');
    o.resetVoice('jarvis'); await core.speech.synthesize('Wieder original.');
    assert.match(posts.at(-1).body.ref_audio, /bundled-jarvis/);
    // private Texte bleiben lokal → dürfen die lokale KI-Stimme nutzen
    const p = await core.speech.synthesize('Mein Arzttermin ist morgen.', { private: true });
    assert.equal(p.engine, 'omnivoice');

    await o.remove(); assert.equal(o.installed(), false);
  } finally { cleanup(); }
});

test('OmniVoice: wrong checksum aborts; other platforms are not offered; pronunciation for German speech', async () => {
  const fetch = async () => new Response(Buffer.from('falsch'));
  const { core, cleanup } = tempCore({ fetch });
  try {
    const o = new OmniVoice(core, { run: fakeRun([]), platform: 'win32', uv: { url: 'x', size: 6, sha256: '0'.repeat(64) } });
    o.install();
    for (let i = 0; i < 100 && o.installing; i++) await new Promise((r) => setTimeout(r, 20));
    assert.match(o.lastError, /Prüfsumme/); assert.equal(o.installed(), false);
    assert.throws(() => new OmniVoice(core, { platform: 'linux' }).install(), /nur unter Windows/);
    assert.equal(localPronunciation('Dein Ultimate im Jungle, Recap'), 'Dein Altimet im Dschungel, Riekäp');
  } finally { cleanup(); }
});

test('OmniVoice: local HTTP call has no 5-minute fetch limit, sends the token, honours its own timeout', async () => {
  const http = require('node:http');
  const { localPost } = require('../src/main/voice/omnivoice');
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { if (JSON.parse(b).slow) return; setTimeout(() => { res.writeHead(req.headers['x-token'] === 'T' ? 200 : 403); res.end(req.headers['x-token'] === 'T' ? 'RIFFdata' : 'no'); }, 30); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const { port } = srv.address();
    const ok = await localPost(port, '/tts', 'T', { text: 'x' }, 5000);
    assert.equal(ok.status, 200); assert.equal(ok.body.toString(), 'RIFFdata');
    assert.equal((await localPost(port, '/tts', 'falsch', { text: 'x' }, 5000)).status, 403);
    await assert.rejects(localPost(port, '/tts', 'T', { slow: true }, 100), /Zeitlimit/);
  } finally { srv.closeAllConnections?.(); srv.close(); }
});
