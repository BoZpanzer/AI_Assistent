// Wake-word pipeline test with synthetic speech (espeak-ng) — runs the real worker code + ONNX models.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { scoreWav } from './wakeword/harness.mjs';

// Die Audio-Erkennung (ONNX/WASM, ohne Threads) dauert auf langsamen Windows-Runnern
// mehrere Minuten. Dort wird sie übersprungen – sie läuft vollständig im Linux-Job
// (tests.yml), und der Smoke-Test der gebauten App prüft, dass die Modelle laden.
const SKIP = process.env.JARVIS_SKIP_WAKEWORD_AUDIO === '1' ? 'auf diesem CI-Runner zu langsam (läuft im Linux-Job)' : false;
const F = (n) => fileURLToPath(new URL(`./wakeword/fixtures/${n}.wav`, import.meta.url));

test('„Hey Jarvis“ wird lokal erkannt (en-US, en-GB Synthese)', { timeout: 600000, skip: SKIP }, async () => {
  for (const f of ['hey_en-us', 'hey_en-gb']) {
    const r = await scoreWav(F(f));
    assert.ok(r.wakeAt > 0, `${f}: nicht erkannt (max ${r.max})`);
  }
});

test('Keine Fehlauslösung bei anderer Sprache', { timeout: 600000, skip: SKIP }, async () => {
  for (const f of ['neg1', 'neg2']) {
    const r = await scoreWav(F(f));
    assert.equal(r.wakeAt, -1, `${f}: Fehlauslösung (max ${r.max})`);
  }
});
