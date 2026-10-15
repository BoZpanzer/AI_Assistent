'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness({ getUserMedia, addModule } = {}) {
  const state = { settings: { voice: { inputDeviceId: 'old-headset' } }, conversationId: 'a' };
  let stopped = 0, contexts = 0;
  const posts = [];
  const stream = { getTracks: () => [{ stop: () => stopped++ }], getAudioTracks: () => [{ readyState: 'live' }] };
  class Context {
    constructor() { contexts++; this.state = 'suspended'; this.audioWorklet = { addModule: addModule || (async () => {}) }; }
    async close() { this.state = 'closed'; }
    async resume() { this.state = 'running'; }
    createMediaStreamSource() { return { connect() {} }; }
    createGain() { return { gain: {}, connect() { return this; } }; }
  }
  class Worklet {
    constructor() { this.port = { postMessage: m => posts.push(m) }; }
    connect() { return { connect() {} }; }
  }
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/src/lib/audio.js'), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, '') + '\nglobalThis.engine = audio;';
  const sandbox = { AudioContext: Context, AudioWorkletNode: Worklet, navigator: { mediaDevices: { getUserMedia: getUserMedia || (async () => stream) } },
    on() {}, rpc: async () => ({}), getState: () => state, setState: patch => Object.assign(state, patch), toast() {}, ask: async () => true,
    speechSynthesis: { cancel() {} }, atob: x => Buffer.from(x, 'base64').toString('binary'), setTimeout, clearTimeout };
  vm.runInNewContext(source, sandbox);
  return { audio: sandbox.engine, state, stream, posts, stopped: () => stopped, contexts: () => contexts };
}

test('concurrent microphone starts share one stream and resume the audio context', async () => {
  const h = harness(); await Promise.all([h.audio.ensureMic(), h.audio.ensureMic()]);
  assert.equal(h.contexts(), 1); assert.equal(h.audio.inCtx.state, 'running');
  h.audio.releaseMicIfIdle(); assert.equal(h.stopped(), 1);
});

test('a disconnected configured microphone falls back to the system default', async () => {
  const requests = []; let h;
  h = harness({ getUserMedia: async constraints => {
    requests.push(structuredClone(constraints));
    if (requests.length === 1) throw Object.assign(Error('gone'), { name: 'NotFoundError' });
    return h.stream;
  } });
  await h.audio.ensureMic();
  assert.equal(requests[0].audio.deviceId.exact, 'old-headset'); assert.equal(requests[1].audio.deviceId, undefined);
  h.audio.releaseMicIfIdle();
});

test('failed microphone worklet setup releases the device and allows a clean retry', async () => {
  let attempts = 0;
  const h = harness({ addModule: async () => { if (++attempts === 1) throw Error('load failed'); } });
  await assert.rejects(h.audio.ensureMic(), /load failed/);
  assert.equal(h.stopped(), 1); assert.equal(h.audio.stream, null);
  await h.audio.ensureMic(); assert.equal(h.audio.inCtx.state, 'running'); h.audio.releaseMicIfIdle();
});

test('interruption during asynchronous player startup discards queued speech', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const h = harness({ addModule: () => gate });
  const a = h.audio.play('AAA='), b = h.audio.play('AAA=');
  h.audio.flush(); release(); await Promise.all([a, b]);
  assert.equal(h.contexts(), 1); assert.equal(h.posts.filter(m => m.type === 'push').length, 0);
});
