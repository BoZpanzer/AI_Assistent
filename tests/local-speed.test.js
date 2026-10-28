'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const privacy = require('../src/main/core/privacy');
const { LocalLLM, recommendedTier } = require('../src/main/providers/local');

test('Lokale Werkzeuge: Grundstock + passende Themen, nie etwas außerhalb von LOCAL_TOOLS', () => {
  const base = privacy.localToolsFor('Was kann ich heute alles tun?');
  assert.ok(base.has('get_today_overview') && base.has('list_events'));
  assert.ok(!base.has('add_expense') && !base.has('log_workout'), 'Finanz-/Trainingswerkzeuge nur bei passendem Thema');
  assert.ok(base.size <= 16, 'klein genug: ' + base.size);
  const fin = privacy.localToolsFor('Ich habe 12 Euro für Mensa ausgegeben');
  assert.ok(fin.has('add_expense') && fin.has('finance_overview'));
  // Folgefrage „ja, bitte“ behält das Thema der letzten Nachrichten
  const follow = privacy.localToolsFor(['Plan die Klausur Mathe', 'ja bitte']);
  assert.ok(follow.has('plan_exam'));
  for (const n of privacy.localToolsFor('league tarkov geld training klausur geburtstag einkauf stimme')) assert.ok(privacy.LOCAL_TOOLS.has(n), n);
});

test('Empfehlung nutzt gemessenen Grafikspeicher (RTX 2070 Super, 8 GB → 4B), ohne Messung wie bisher', () => {
  assert.equal(recommendedTier(32, 8), 'balanced');
  assert.equal(recommendedTier(32, 4), 'light');
  assert.equal(recommendedTier(32, 24), 'strong');
  assert.equal(recommendedTier(32), 'balanced');
  assert.equal(recommendedTier(8), 'light');
});

function fake(handler) { return new Promise((resolve) => { const srv = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(srv)); }); }
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b ? JSON.parse(b) : null)); });

test('Lokale Anfrage: Denkmodus aus, Kontext 8192, Messwerte werden gemerkt; ältere Modelle ohne „think“ laufen trotzdem', async () => {
  const seen = [];
  const srv = await fake(async (req, res) => {
    const j = await body(req); res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen3.5:4b' }] }));
    if (req.url === '/api/show') return res.end(JSON.stringify({ model_info: { a: 1 } }));
    if (req.url === '/api/ps') return res.end(JSON.stringify({ models: [{ name: 'qwen3.5:4b', size: 4e9, size_vram: 0, context_length: 8192 }] }));
    seen.push(j);
    if (j.think === false && seen.length === 1) { res.statusCode = 400; return res.end('{"error":"does not support thinking"}'); }
    res.end(JSON.stringify({ message: { content: 'Hallo' }, prompt_eval_count: 3000, prompt_eval_duration: 6e9, eval_count: 20, eval_duration: 4e9, load_duration: 1e9, total_duration: 11e9 }));
  });
  try {
    const llm = new LocalLLM({ get: () => ({ port: srv.address().port, model: 'qwen3.5:4b' }) });
    const r = await llm.stepStream({ system: 's', contents: [{ role: 'user', parts: [{ text: 'hi' }] }], tools: [] });
    assert.equal(r.text, 'Hallo');
    assert.equal(seen[0].think, false); assert.equal(seen[1].think, undefined, 'zweiter Versuch ohne think');
    assert.equal(seen[0].options.num_ctx, 8192);
    assert.equal(llm.last.promptTokens, 3000); assert.equal(llm.last.tokPerSec, 5); assert.equal(llm.last.truncated, false);
    const ld = await llm.loaded(); assert.equal(ld[0].onGpuPct, 0);
    const st = await llm.status(); assert.equal(st.online, true); assert.ok(Array.isArray(st.gpus)); assert.equal(st.loaded[0].name, 'qwen3.5:4b'); assert.equal(st.last.model, 'qwen3.5:4b');
  } finally { srv.close(); }
});

test('Spielmodus: kleiner Kontext, nur CPU', () => {
  const llm = new LocalLLM({ get: () => ({}) }); llm.isGaming = () => true;
  const o = llm.runtimeOptions();
  assert.equal(o.options.num_gpu, 0); assert.equal(o.options.num_ctx, 4096); assert.equal(o.keep_alive, '0s');
});
