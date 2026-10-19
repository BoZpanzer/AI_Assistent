'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LOCAL_TIERS, recommendedTier, LocalLLM } = require('../src/main/providers/local');
test('five distinct local tiers, no remote/cloud model', () => {
  assert.equal(LOCAL_TIERS.length, 5);
  assert.equal(new Set(LOCAL_TIERS.map(t => t.model)).size, 5);
  assert.ok(LOCAL_TIERS.every(t => /^qwen3\.5:(0\.8b|2b|4b|9b|27b)$/.test(t.model)));
});
test('16 GB laptop and 32 GB desktop receive conservative recommendations', () => {
  assert.equal(recommendedTier(16), 'balanced');
  assert.equal(recommendedTier(32), 'balanced', 'Gaming-PC: lokales Modell darf dem Spiel nicht den Grafikspeicher nehmen');
  assert.equal(recommendedTier(4), 'ultra');
});
test('download refuses unknown model without network call', async () => {
  const llm = new LocalLLM({ get: () => ({ port: 11434 }) });
  await assert.rejects(llm.installTier('qwen3.5:999b'), /Unbekanntes/);
  await assert.rejects(llm.installTier('some-cloud-model'), /Unbekanntes/);
});
