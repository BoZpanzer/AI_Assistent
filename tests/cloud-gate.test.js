'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempCore, fakeSdk } = require('./helpers');
const { createCore } = require('../src/main/app-core');

const withKey = async (core) => { core.secrets.set('gemini.api_key', 'AIza-test-key-123456789'); await core.gemini.discover(); };

test('Every Gemini SDK use in src/main goes through the central gate (static check)', () => {
  const root = path.join(__dirname, '../src/main');
  const offenders = [];
  const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) {
    const src = fs.readFileSync(p, 'utf8');
    if (p.endsWith(path.join('providers', 'gemini.js'))) continue;
    if (/gemini\.client\(\)|\.models\.generateContent|\.live\.connect\(|new [\w.]*GoogleGenAI/.test(src)) offenders.push(path.relative(root, p));
  } } };
  walk(root);
  assert.deepEqual(offenders, []);
});

test('client() refuses to work outside the gate', async () => {
  const { core, cleanup } = tempCore();
  try { await withKey(core); assert.throws(() => core.gemini.client(), /außerhalb der zentralen Kostenkontrolle/); } finally { cleanup(); }
});

test('Strict local mode: no request reaches the Gemini SDK on any path', async () => {
  const { core, fake, cleanup } = tempCore({ local: true, script: [{ text: 'lokal beantwortet' }] });
  try {
    await withKey(core);
    const before = fake.requests.length;
    core.settings.update({ cloud: { mode: 'local' }, localLLM: { model: 'qwen3.5:4b' } });
    const conv = core.conversations.create('Gaming', 'gaming');
    const msg = await core.orchestrator.chat({ conversationId: conv.id, text: 'Erklär mir das Map-Tracking in LoL' });
    assert.match(msg.content, /Lokal beantwortet/);
    assert.ok(fake.requests.slice(before).every((r) => r.local), 'only the local model was used');
    await assert.rejects(core.gemini.research('Patch'), /Lokaler Modus/);
    await assert.rejects(core.gemini.ping(), /Lokaler Modus/);
    await assert.rejects(core.gemini.discover(), /Lokaler Modus/);
    await assert.rejects(core.gemini.generate({ feature: 'vision', contents: [{ role: 'user', parts: [{ text: 'x' }] }] }), /Lokaler Modus/);
    core.settings.update({ cloud: { features: { voice: true } } });
    await assert.rejects(core.voice.start({ conversationId: conv.id, cloudAudioApproved: true }), /Lokaler Modus/);
    assert.equal(fake.requests.filter((r) => !r.local).length, before, 'no cloud request at all');
  } finally { cleanup(); }
});

test('Cloud blocked and no local model: visible message, no cloud call, no silent fallback', async () => {
  const { core, fake, cleanup } = tempCore();
  try {
    await withKey(core);
    core.settings.update({ cloud: { features: { chat: false } } });
    const conv = core.conversations.create('Uni', 'study');
    const msg = await core.orchestrator.chat({ conversationId: conv.id, text: 'Fasse die Vorlesung zusammen' });
    assert.equal(msg.meta.error, true); assert.match(msg.content, /ausgeschaltet/);
    assert.equal(fake.requests.length, 0);
  } finally { cleanup(); }
});

test('Local model failure never triggers a cloud call', async () => {
  const { core, fake, cleanup } = tempCore();
  try {
    await withKey(core);
    core.settings.update({ localLLM: { model: 'qwen3.5:4b', port: 9 } }); // nothing listens there
    const conv = core.conversations.create('Privat', 'private');
    const msg = await core.orchestrator.chat({ conversationId: conv.id, text: 'Meine Miete ist zu hoch' });
    assert.equal(msg.meta.error, true);
    assert.equal(fake.requests.length, 0);
  } finally { cleanup(); }
});

test('Daily budget: parallel requests are reserved up front; the second one is blocked locally', async () => {
  const gate = []; const fk = fakeSdk([]);
  class G extends fk.sdk.GoogleGenAI {
    constructor(o) { super(o); this.models.generateContent = async () => new Promise((r) => gate.push(() => r({ text: 'ok', usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 } }))); }
  }
  const { core, cleanup } = tempCore({ genaiSdk: { GoogleGenAI: G } });
  try {
    await withKey(core);
    const est = core.gemini.estimate('gemini-3.8-flash', { contents: [{ role: 'user', parts: [{ text: 'x' }] }], maxOut: 4096 });
    // budget fits exactly one reservation
    core.settings.update({ aiBudget: { dailyEur: est * 0.86 * 1.5, sessionEur: 0, monthlyEur: 0 } });
    const a = core.gemini.generate({ feature: 'games', contents: [{ role: 'user', parts: [{ text: 'x' }] }] });
    await new Promise((r) => setImmediate(r));
    await assert.rejects(core.gemini.generate({ feature: 'games', contents: [{ role: 'user', parts: [{ text: 'y' }] }] }), /Tagesbudget/);
    assert.equal(gate.length, 1, 'second request never reached the SDK');
    gate[0](); assert.equal(await a, 'ok');
    // after settling, the real (small) usage replaces the reservation
    assert.ok(core.costGuard.status().today < est * 0.86 * 0.1);
  } finally { cleanup(); }
});

test('Budget survives restarts; unfinished reservations of a crashed run keep counting', () => {
  const { core, dir } = tempCore();
  core.settings.update({ aiBudget: { dailyEur: 1, sessionEur: 0 } });
  core.costGuard.reserve({ feature: 'chat', model: 'gemini-3.8-flash', estUsd: 0.5 }); // never settled (crash)
  const done = core.costGuard.reserve({ feature: 'chat', model: 'gemini-3.8-flash', estUsd: 0.2 });
  core.costGuard.settle(done, { usage: { in: 100000, out: 20000 } });
  const today = core.costGuard.status().today;
  core.stop();
  const again = createCore({ dataDir: dir, version: '3.0.0', fetch: async () => { throw new Error('offline'); } });
  try {
    const st = again.costGuard.status();
    assert.ok(Math.abs(st.today - today) < 1e-6, 'restart does not reset the daily budget');
    assert.equal(st.session, 0, 'session budget restarts with JARVIS');
    assert.equal(again.db.get("SELECT COUNT(*) AS n FROM ai_ledger WHERE status='unsettled'").n, 1);
    assert.ok(st.today >= 0.5 * 0.86, 'unsettled reservation counted with its estimate');
  } finally { again.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Rejected requests cost nothing and identical invalid requests are not re-sent', async () => {
  let calls = 0; const fk = fakeSdk([]);
  class G extends fk.sdk.GoogleGenAI {
    constructor(o) { super(o); this.models.generateContent = async () => { calls++; throw Object.assign(new Error('400 INVALID_ARGUMENT: bad schema'), { status: 400 }); }; }
  }
  const { core, cleanup } = tempCore({ genaiSdk: { GoogleGenAI: G } });
  try {
    await withKey(core);
    const req = { feature: 'lol', json: true, dedupe: true, contents: [{ role: 'user', parts: [{ text: 'Matchup' }] }] };
    await assert.rejects(core.gemini.generate(req), /400/);
    await assert.rejects(core.gemini.generate(req), /nicht automatisch wiederholt/);
    assert.equal(calls, 1);
    assert.equal(core.costGuard.status().today, 0);
  } finally { cleanup(); }
});

test('Limited parallelism: background work is skipped while the cloud is busy; timeout aborts and keeps the estimate', async () => {
  const fk = fakeSdk([]);
  class G extends fk.sdk.GoogleGenAI { constructor(o) { super(o); this.models.generateContent = async () => new Promise(() => {}); } }
  const { core, cleanup } = tempCore({ genaiSdk: { GoogleGenAI: G } });
  try {
    await withKey(core);
    core.settings.update({ cloud: { maxConcurrent: 1, timeoutSec: 10 } });
    const hanging = core.gemini.cloud('games', (m, signal) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(signal.reason))), { estUsd: 0.001, timeoutMs: 50 });
    await assert.rejects(core.gemini.generate({ feature: 'news', background: true, contents: [{ role: 'user', parts: [{ text: 'x' }] }] }), /ausgelastet/);
    await assert.rejects(hanging, /Zeitlimit/);
    assert.ok(core.costGuard.status().today > 0, 'aborted request keeps its estimate (may have been billed)');
  } finally { cleanup(); }
});

test('Pause (cloud.setMode local) aborts running requests and stops Gemini Live', async () => {
  const { core, cleanup } = tempCore();
  try {
    await withKey(core);
    const running = core.gemini.cloud('games', (m, signal) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(signal.reason))), { estUsd: 0.001 });
    let stopped = 0; const orig = core.voice.stop.bind(core.voice); core.voice.stop = (...a) => { stopped++; return orig(...a); };
    core.voice.session = { close() {} }; // simulate an open Live session
    await new Promise((r) => setTimeout(r, 5)); // request is now in flight
    core.settings.update({ cloud: { mode: 'local' } });
    await assert.rejects(running, /pausiert/);
    assert.ok(stopped >= 1);
  } finally { cleanup(); }
});

test('Gemini Live: budget per voice session stops the session visibly; streamed minutes are counted', async () => {
  const { core, cleanup } = tempCore();
  try {
    await withKey(core);
    core.settings.update({ cloud: { features: { voice: true } }, voice: { cloudMaxEur: 0.01 }, aiBudget: { dailyEur: 5, sessionEur: 5 } });
    let closed = 0;
    core.gemini.liveConnect = async ({ model }) => ({ session: { close: () => { closed++; }, sendRealtimeInput: () => {}, sendClientContent: () => {} }, ledger: core.costGuard.reserve({ feature: 'voice', model, estUsd: 0.005 }) });
    core.gemini.requireModel = () => 'gemini-3.8-live';
    const conv = core.conversations.create('Spiel', 'gaming');
    const states = []; core.bus.on('voice:state', (s) => states.push(s));
    await core.voice.start({ conversationId: conv.id, cloudAudioApproved: true });
    core.voice.sendAudio(Buffer.alloc(32000 * 60)); // one minute of PCM
    await core.voice.onMessage({ usageMetadata: { promptTokenCount: 5000, promptTokensDetails: [{ modality: 'AUDIO', tokenCount: 5000 }], responseTokenCount: 200 } });
    assert.equal(core.voice.isOpen(), false);
    assert.ok(closed >= 1);
    assert.ok(states.some((s) => s.state === 'error' && /Budget je Sprachsitzung/.test(s.error)));
    const row = core.db.get("SELECT status, usd FROM ai_ledger WHERE feature='voice'");
    assert.equal(row.status, 'done'); assert.ok(row.usd >= 0.005, 'at least the streamed audio minute is counted');
  } finally { cleanup(); }
});
