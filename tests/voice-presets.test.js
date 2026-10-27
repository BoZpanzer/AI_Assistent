'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tempCore, fakeSdk } = require('./helpers');
const { resolve, publicPresets } = require('../src/main/voice/voice-presets');

test('Voice presets: J.A.R.V.I.S./Alya map to own voices per engine (OmniVoice, Piper); unknown preset or missing voice → Standard', () => {
  const base = { preset: 'jarvis', voice: 'de_DE-thorsten-medium', pitch: 1, speed: 1 };
  const j = resolve(base);
  assert.equal(j.omniInstruct, 'male, middle-aged, low pitch'); assert.equal(j.omniSeed, 1); assert.equal(j.pitch, 0.9);
  const a = resolve({ ...base, preset: 'alya' }, { isInstalled: () => false });
  assert.match(a.omniInstruct, /^female/); assert.equal(a.voice, 'de_DE-thorsten-medium', 'Kerstin fehlt → Standardstimme'); assert.equal(a.pitch, 1); assert.equal(a.presetFallback, true);
  assert.equal(resolve({ ...base, preset: 'gibtsnicht' }).preset, 'standard');
  assert.equal(resolve({ ...base, omni: { voices: { jarvis: 'male, elderly' }, seeds: { jarvis: 7 } } }).omniInstruct, 'male, elderly');
  assert.equal(resolve({ ...base, omni: { seeds: { jarvis: 7 } } }).omniSeed, 7);
  assert.deepEqual(publicPresets().map((p) => p.id), ['standard', 'jarvis', 'alya']);
});

test('Voice output is local only: Gemini is never asked for audio, presets switch without any AI call, previews are cached', async () => {
  const sdk = fakeSdk([], { models: ['gemini-3.8-flash', 'gemini-3.8-flash-lite-tts'] });
  const { core, cleanup } = tempCore({ genaiSdk: sdk.sdk });
  try {
    core.secrets.set('gemini.api_key', 'PAID'); await core.gemini.discover();
    let local = 0; core.tts.synthesize = async (t, o) => { local++; return { wav: Buffer.from('RIFFlocal' + t + o.voice), pitch: o.pitch || 1, voice: o.voice }; };
    core.settings.update({ voice: { tts: { preset: 'jarvis' } } });
    const r = await core.speech.synthesize('Guten Abend.');
    assert.equal(r.engine, 'piper', 'ohne OmniVoice → einfache lokale Stimme'); assert.equal(r.preset, 'jarvis');
    await core.speech.synthesize('Hey!', { override: { preset: 'alya' }, preview: true });
    const again = await core.speech.synthesize('Hey!', { override: { preset: 'alya' }, preview: true });
    assert.equal(again.cached, true);
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
