'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tempCore, fakeSdk } = require('./helpers');
const { resolve, publicPresets } = require('../src/main/voice/voice-presets');

test('Voice presets: J.A.R.V.I.S./Alya map to own OmniVoice voices; unknown preset → Standard', () => {
  const base = { preset: 'jarvis', speed: 1 };
  const j = resolve(base);
  assert.equal(j.omniInstruct, 'male, middle-aged, low pitch'); assert.equal(j.omniSeed, 1);
  assert.match(resolve({ ...base, preset: 'alya' }).omniInstruct, /^female/);
  assert.equal(resolve({ ...base, preset: 'gibtsnicht' }).preset, 'standard');
  assert.equal(resolve({ ...base, omni: { voices: { jarvis: 'male, elderly' }, seeds: { jarvis: 7 } } }).omniInstruct, 'male, elderly');
  assert.equal(resolve({ ...base, omni: { seeds: { jarvis: 7 } } }).omniSeed, 7);
  assert.deepEqual(publicPresets().map((p) => p.id), ['standard', 'jarvis', 'alya']);
});

test('Nur KI-Stimme und Google-Stimme: ohne beide klare Meldung, kein Gemini-Audio; Google nur für Nicht-Privates; Hörproben im Cache', async () => {
  const sdk = fakeSdk([], { models: ['gemini-3.8-flash', 'gemini-3.8-flash-lite-tts'] });
  let google = 0;
  const fetch = async (url) => { if (String(url).includes('texttospeech')) { google++; return { ok: true, status: 200, json: async () => ({ audioContent: Buffer.from('RIFF' + 'x'.repeat(60)).toString('base64') }) }; } throw new Error('offline'); };
  const { core, cleanup } = tempCore({ genaiSdk: sdk.sdk, fetch });
  try {
    core.settings.update({ voice: { tts: { preset: 'jarvis' } } });
    // KI-Stimme nicht installiert, kein Schlüssel → keine Stimme (kein Piper/Windows mehr)
    await assert.rejects(core.speech.synthesize('Guten Abend.'), /Keine Stimme verfügbar.*nicht installiert/);
    core.secrets.set('gemini.api_key', 'PAID'); await core.gemini.discover();
    const r = await core.speech.synthesize('Guten Abend.');
    assert.equal(r.engine, 'cloud', 'KI-Stimme fehlt → Google-Stimme'); assert.equal(r.preset, 'jarvis');
    await assert.rejects(core.speech.synthesize('Dein Termin.', { private: true }), /privat/);
    await core.speech.synthesize('Hey!', { override: { preset: 'alya', engine: 'cloud' } });
    const again = await core.speech.synthesize('Hey!', { override: { preset: 'alya', engine: 'cloud' } });
    assert.equal(again.cached, true); assert.equal(google, 2);
    assert.equal(sdk.requests.length, 0, 'keine Gemini-Anfrage für Sprache');
    assert.ok(!core.gemini.model('tts'), 'keine TTS-Rolle mehr');
  } finally { cleanup(); }
});

test('Voice switch by voice/text command: no AI call, persists, questions and plain mentions are ignored', async () => {
  const { parseVoiceCommand } = require('../src/main/voice/voice-presets');
  const yes = [['Stimme auf Alya', 'alya'], ['Jarvis, wechsel die Stimme zu Alya', 'alya'], ['Hey Jarvis nimm die Jarvis Stimme', 'jarvis'], ['sprich wieder normal', 'standard'],
    ['stell deine Stimme auf Standard', 'standard'], ['Nimm die Anime-Stimme', 'alya'], ['Stimme J.A.R.V.I.S.', 'jarvis'], ['Jarvis, Stimme auf Alia', 'alya']];
  for (const [t, id] of yes) assert.equal(parseVoiceCommand(t), id, t);
  for (const t of ['Welche Stimme hast du gerade?', 'Jarvis, wie spät ist es?', 'Alya ist cool', 'Wie klingt die Alya Stimme?', 'Schreib eine lange Nachricht an Tim, dass ich morgen beim Training die normale Strecke laufe und meine Stimme heiser ist']) assert.equal(parseVoiceCommand(t), null, t);

  const sdk = fakeSdk([]);
  const { core, cleanup } = tempCore({ genaiSdk: sdk.sdk });
  try {
    core.secrets.set('gemini.api_key', 'K');
    const conv = core.conversations.create('t');
    const r = await core.orchestrator.chat({ conversationId: conv.id, text: 'Jarvis, Stimme auf Alya', channel: 'voice' });
    assert.match(r.content, /Alya/); assert.equal(core.settings.get('voice').tts.preset, 'alya');
    assert.equal(sdk.requests.length, 0, 'kein KI-Aufruf');
    const t = await core.orchestrator.execute('set_voice', { preset: 'jarvis' }, { conversationId: conv.id, channel: 'voice' });
    assert.equal(t.response.preset, 'jarvis'); assert.equal(core.settings.get('voice').tts.preset, 'jarvis');
  } finally { cleanup(); }
});
