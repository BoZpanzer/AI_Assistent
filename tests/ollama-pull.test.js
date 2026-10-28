'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { LocalLLM } = require('../src/main/providers/local');

function fake(handler) {
  return new Promise((resolve) => { const srv = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(srv)); });
}
const llm = (port) => new LocalLLM({ get: () => ({ port }) });

test('Ollama-Download: Fortschritt wird gemeldet, Erfolg nur bei „success“', async () => {
  const srv = await fake((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      assert.equal(JSON.parse(b).stream, true);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write('{"status":"pulling manifest"}\n{"status":"downloading","completed":50,"total":100}\n');
      res.end('{"status":"success"}\n');
    });
  });
  try {
    const seen = [];
    const r = await llm(srv.address().port).installTier('qwen3.5:4b', (p) => seen.push(p));
    assert.equal(r.status, 'success');
    assert.ok(seen.some((p) => p.total === 100 && p.completed === 50));
  } finally { srv.close(); }
});

test('Ollama-Download: Fehlermeldung von Ollama kommt lesbar an, abgebrochener Stream ist ein Fehler', async () => {
  let mode = 'err';
  const srv = await fake((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200); res.end(mode === 'err' ? '{"error":"pull model manifest: file does not exist"}\n' : '{"status":"downloading","completed":1,"total":9}\n'); }); });
  try {
    const l = llm(srv.address().port);
    await assert.rejects(() => l.installTier('qwen3.5:4b'), /file does not exist/);
    mode = 'cut';
    await assert.rejects(() => l.installTier('qwen3.5:4b'), /unterbrochen/);
  } finally { srv.close(); }
});

test('Ollama-Download: nicht erreichbar → klare Meldung; fremde Modelle werden abgelehnt', async () => {
  await assert.rejects(() => llm(1).installTier('qwen3.5:4b'), /nicht erreichbar/);
  await assert.rejects(() => llm(1).installTier('evil/model'), /Unbekanntes/);
});
