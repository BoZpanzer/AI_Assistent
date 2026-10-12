// Wake-word pipeline test with synthetic speech (espeak-ng) — runs the real worker code + ONNX models.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreWav } from './wakeword/harness.mjs';

const F = (n) => new URL(`./wakeword/fixtures/${n}.wav`, import.meta.url).pathname;

test('„Hey Jarvis“ wird lokal erkannt (en-US, en-GB Synthese)', { timeout: 240000 }, async () => {
  for (const f of ['hey_en-us', 'hey_en-gb']) {
    const r = await scoreWav(F(f));
    assert.ok(r.wakeAt > 0, `${f}: nicht erkannt (max ${r.max})`);
  }
});

test('Keine Fehlauslösung bei anderer Sprache', { timeout: 240000 }, async () => {
  for (const f of ['neg1', 'neg2']) {
    const r = await scoreWav(F(f));
    assert.equal(r.wakeAt, -1, `${f}: Fehlauslösung (max ${r.max})`);
  }
});
