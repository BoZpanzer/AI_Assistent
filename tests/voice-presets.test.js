'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tempCore, fakeSdk } = require('./helpers');
const { resolve, publicPresets } = require('../src/main/voice/voice-presets');

test('Voice presets: J.A.R.V.I.S./Alya map to own voices per engine; unknown preset or missing voice → Standard', () => {
  const base = { preset: 'jarvis', cloudVoice: 'Kore', voice: 'de_DE-thorsten-medium', pitch: 1, speed: 1 };
  const j = resolve(base);
  assert.equal(j.cloudVoice, 'Charon'); assert.match(j.cloudStyle, /tiefe/); assert.equal(j.pitch, 0.9);
  const a = resolve({ ...base, preset: 'alya' }, { isInstalled: () => false });
  assert.equal(a.cloudVoice, 'Leda'); assert.equal(a.voice, 'de_DE-thorsten-medium', 'Kerstin fehlt → Standardstimme'); assert.equal(a.pitch, 1); assert.equal(a.presetFallback, true);
  assert.equal(resolve({ ...base, preset: 'gibtsnicht' }).preset, 'standard');
  assert.equal(resolve({ ...base, preset: 'standard' }).cloudVoice, 'Kore', 'Standard bleibt unverändert');
  assert.equal(resolve({ ...base, elevenVoices: { jarvis: 'abc123' } }).elevenVoiceId, 'abc123');
  assert.deepEqual(publicPresets().map((p) => p.id), ['standard', 'jarvis', 'alya']);
  assert.ok(!JSON.stringify(publicPresets()).includes('api_key'));
});

const MODELS = ['gemini-3.8-flash', 'gemini-2.5-flash-lite', 'gemini-3.8-flash-lite-tts'];
function ttsSdk(log) {
  const sdk = fakeSdk([], { models: MODELS });
  const Orig = sdk.sdk.GoogleGenAI;
  sdk.sdk.GoogleGenAI = class extends Orig { constructor(o) { super(o); this.models.generateContent = async (req) => { log.push(req); return { usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 300, candidatesTokensDetails: [{ modality: 'AUDIO', tokenCount: 300 }] }, candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: Buffer.alloc(2400).toString('base64') } }] } }] }; }; } };
  return sdk;
}

test('Voice presets: switching needs no LLM call, the chosen preset is used for all replies, previews are cached', async () => {
  const log = [];
  const { core, cleanup } = tempCore({ genaiSdk: ttsSdk(log).sdk });
  try {
    core.secrets.set('gemini.api_key', 'PAID'); await core.gemini.discover();
    core.settings.update({ voice: { tts: { preset: 'jarvis' } } }); // Wechsel: nur Einstellung, kein Aufruf
    assert.equal(log.length, 0);
    const r = await core.speech.synthesize('Guten Abend.');
    assert.equal(r.engine, 'gemini'); assert.equal(r.preset, 'jarvis');
    const cfg = log[0].config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName;
    assert.equal(cfg, 'Charon'); assert.match(log[0].contents[0].parts[0].text, /britisch/);
    assert.equal(log[0].model, 'gemini-3.8-flash-lite-tts', 'nur das TTS-Modell, kein Sprachmodell');
    // Hörprobe Alya zweimal → zweites Mal aus dem Speicher
    await core.speech.synthesize('Hey!', { override: { preset: 'alya' }, preview: true });
    const n = log.length;
    const again = await core.speech.synthesize('Hey!', { override: { preset: 'alya' }, preview: true });
    assert.equal(again.cached, true); assert.equal(log.length, n);
    assert.equal(log.at(-1).config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Leda');
    // gespeicherte Auswahl bleibt nach „Neustart“ (neue Settings-Instanz liest dieselbe DB)
    assert.equal(core.settings.get('voice').tts.preset, 'jarvis');
  } finally { cleanup(); }
});

test('Voice presets: licensed ElevenLabs voice ID is used when configured (key stays in main), errors fall back', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), key: init?.headers?.['xi-api-key'] });
    if (String(url).includes('elevenlabs')) return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(4800).buffer };
    throw new Error('offline');
  };
  const { core, cleanup } = tempCore({ fetch });
  try {
    core.secrets.set('elevenlabs.api_key', 'sk_test');
    core.settings.update({ voice: { tts: { preset: 'jarvis', elevenVoices: { jarvis: 'VOICE123' } } } });
    core.tts.synthesize = async () => ({ wav: Buffer.from('RIFFlocal'), pitch: 1 });
    const r = await core.speech.synthesize('Willkommen zurück.');
    assert.equal(r.engine, 'elevenlabs');
    assert.match(calls[0].url, /text-to-speech\/VOICE123\?output_format=pcm_24000/); assert.equal(calls[0].key, 'sk_test');
    assert.equal(r.wav.subarray(0, 4).toString(), 'RIFF');
    // private Texte nie an ElevenLabs
    assert.equal((await core.speech.synthesize('privat', { private: true })).engine, 'piper');
    // Zeichengrenze erreicht → lokal
    core.settings.update({ voice: { tts: { elevenDailyChars: 1 } } });
    assert.equal((await core.speech.synthesize('Noch etwas.')).engine, 'piper');
  } finally { cleanup(); }
});
