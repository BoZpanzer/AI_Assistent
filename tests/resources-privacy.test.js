'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { LocalLLM, exposureWarning } = require('../src/main/providers/local');
const { transcribeLocal } = require('../src/main/voice/local-whisper');
const { tempCore } = require('./helpers');

test('Local LLM while gaming: CPU only, 2 threads, unload immediately; optional pause for background work', async () => {
  let cfg = { model: 'qwen3.5:4b', threads: 6, whileGaming: 'cpu' };
  const llm = new LocalLLM({ get: () => cfg });
  assert.deepEqual(llm.runtimeOptions(), { options: { num_ctx: 4096, num_thread: 6 }, keep_alive: '2m' });
  llm.isGaming = () => true;
  assert.deepEqual(llm.runtimeOptions(), { options: { num_ctx: 4096, num_thread: 2, num_gpu: 0 }, keep_alive: '0s' });
  cfg = { ...cfg, whileGaming: 'pause' };
  await assert.rejects(llm.stepStream({ background: true, contents: [] }), /pausiert/);
});

test('Local LLM runs one request at a time; background work is not queued', async () => {
  const llm = new LocalLLM({ get: () => ({ model: 'm' }) });
  let release; llm._step = () => new Promise((r) => { release = r; });
  const first = llm.stepStream({});
  await assert.rejects(llm.stepStream({ background: true }), /beschäftigt/);
  release({ text: 'ok' }); assert.equal((await first).text, 'ok');
});

test('Ollama network exposure is detected', () => {
  assert.match(exposureWarning({ OLLAMA_HOST: '0.0.0.0:11434' }), /im Netzwerk erreichbar/);
  assert.equal(exposureWarning({ OLLAMA_HOST: '127.0.0.1:11434' }), null);
  assert.equal(exposureWarning({}), null);
});

test('Whisper gets an explicit thread limit and low priority while gaming', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-'));
  const exe = path.join(dir, process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'); fs.writeFileSync(exe, '');
  const model = path.join(dir, 'm.bin'); fs.writeFileSync(model, '');
  let args;
  const run = (_e, a) => { args = a; const c = new EventEmitter(); c.pid = undefined; c.kill = () => {}; setImmediate(() => { fs.writeFileSync(a[a.indexOf('-of') + 1] + '.txt', 'hallo'); c.emit('close', 0); }); return c; };
  try {
    await transcribeLocal({ audio: Buffer.alloc(32000).toString('base64'), executable: exe, model, threads: 2, lowPriority: true }, { run });
    assert.equal(args[args.indexOf('-t') + 1], '2');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Privacy: screenshots are not kept by default; stored data can be listed and deleted', async () => {
  const { core, cleanup } = tempCore();
  try {
    core.platform.captureScreen = async () => ({ data: Buffer.from('IMG'), width: 10, height: 10, scope: 'window' });
    core.gaming.context.setActive('eft');
    const shot = await core.screen.capture();
    assert.equal(shot.file, null); assert.equal(shot.scope, 'window');
    assert.equal(fs.existsSync(path.join(core.paths.data, 'screens')), false);
    core.settings.update({ screen: { keepScreenshots: true } });
    const kept = await core.screen.capture();
    assert.ok(fs.existsSync(kept.file));
    assert.equal(core.system.dataSummary().screenshots.files, 1);
    core.system.clearData('screenshots');
    assert.equal(core.system.dataSummary().screenshots.files, 0);
    core.db.run("INSERT INTO game_cache(key,value,source,fetched_at,expires_at) VALUES('k','1','s','2026-01-01','2027-01-01')");
    core.system.clearData('gameCache');
    assert.equal(core.system.dataSummary().gameCache.entries, 0);
    assert.throws(() => core.system.clearData('everything'), /Unbekannter Bereich/);
    // window hints come from the active game's process names (no full desktop by default)
    assert.ok(core.screen.windowHints().includes('EscapeFromTarkov'));
  } finally { cleanup(); }
});

test('Cost ledger stores no content (only metadata)', () => {
  const { core, cleanup } = tempCore();
  try {
    const cols = core.db.all('PRAGMA table_info(ai_ledger)').map((c) => c.name);
    assert.deepEqual(cols.sort(), ['at', 'cached_tok', 'day', 'est_usd', 'feature', 'id', 'in_tok', 'model', 'out_tok', 'status', 'think_tok', 'usd'].sort());
  } finally { cleanup(); }
});
