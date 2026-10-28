'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tempCore } = require('./helpers');
const { toMessages } = require('../src/main/providers/groq');

const withKey = async (core) => { core.secrets.set('gemini.api_key', 'AIza-test-key-123456789'); await core.gemini.discover(); };
const sse = (events) => {
  const body = events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join('') + 'data: [DONE]\n\n';
  const bytes = new TextEncoder().encode(body); let sent = false;
  return { ok: true, status: 200, headers: { get: () => null }, body: { getReader: () => ({ read: async () => (sent ? { done: true } : (sent = true, { value: bytes, done: false })) }) } };
};
const textChunks = (t) => (t.match(/.{1,7}/gs) || []).map((c) => ({ choices: [{ delta: { content: c } }] }));

test('Groq: Verlauf mit Werkzeugaufrufen wird korrekt übersetzt (IDs passen zusammen)', () => {
  const m = toMessages('SYS', [
    { role: 'user', parts: [{ text: 'Was kostet die LEDX?' }] },
    { role: 'model', parts: [{ functionCall: { name: 'tarkov_item_value', args: { name: 'LEDX' } } }] },
    { role: 'user', parts: [{ functionResponse: { name: 'tarkov_item_value', response: { flea: 1 } } }] },
  ]);
  assert.equal(m[0].role, 'system');
  assert.equal(m[2].tool_calls[0].id, m[3].tool_call_id);
  assert.equal(m[3].role, 'tool');
});

test('Öffentliche Frage geht zuerst an Groq (gratis) – Gemini wird nicht angefragt; private nie an Groq', async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null }); return sse(textChunks('Malphite ist stark gegen AD-Champions.')); };
  const { core, fake, cleanup } = tempCore({ fetch, local: true, script: [{ text: 'lokal privat' }] });
  try {
    await withKey(core);
    core.secrets.set('groq.api_key', 'gsk_test');
    core.settings.update({ localLLM: { model: 'qwen3.5:4b' } });
    const before = fake.requests.length;
    const conv = core.conversations.create('Chat');
    const msg = await core.orchestrator.chat({ conversationId: conv.id, text: 'Ist Malphite gut gegen Caitlyn in LoL?' });
    assert.match(msg.content, /Malphite ist stark/);
    assert.equal(fake.requests.length, before, 'kein Gemini-/Lokal-Aufruf');
    const g = calls.find((c) => c.url.includes('api.groq.com'));
    assert.ok(g, 'Groq angefragt');
    assert.equal(g.body.messages[0].content, require('../src/main/core/privacy').CLOUD_SYSTEM, 'nur die öffentliche Anweisung, kein persönlicher Kontext');
    // private Nachricht → lokal, kein weiterer Groq-Aufruf
    const n = calls.length;
    const p = await core.orchestrator.chat({ conversationId: conv.id, text: 'Was steht morgen in meinem Kalender?' });
    assert.match(p.content, /lokal privat/);
    assert.equal(calls.filter((c) => c.url.includes('groq')).length, calls.slice(0, n).filter((c) => c.url.includes('groq')).length);
  } finally { cleanup(); }
});

test('Groq-Kontingent leer (429) → dieselbe Frage nahtlos über Gemini; danach wird Groq übersprungen', async () => {
  let groq = 0;
  const fetch = async (url) => { if (String(url).includes('api.groq.com')) { groq++; return { ok: false, status: 429, headers: { get: (h) => (h === 'retry-after' ? '30' : null) }, text: async () => 'Rate limit reached: requests per day (RPD)' }; } throw new Error('offline'); };
  const { core, fake, cleanup } = tempCore({ fetch, script: [{ text: 'Antwort von Gemini.' }, { text: 'Zweite von Gemini.' }] });
  try {
    await withKey(core);
    core.secrets.set('groq.api_key', 'gsk_test');
    const conv = core.conversations.create('Chat');
    const before = fake.requests.length;
    const a = await core.orchestrator.chat({ conversationId: conv.id, text: 'Erklär mir Wave-Management in LoL' });
    assert.match(a.content, /Antwort von Gemini/);
    assert.ok(!a.meta.error);
    assert.equal(fake.requests.length, before + 1);
    const b = await core.orchestrator.chat({ conversationId: conv.id, text: 'Und was ist ein Freeze?' });
    assert.match(b.content, /Zweite von Gemini/);
    assert.equal(groq, 1, 'Groq nach 429 nicht erneut gefragt');
  } finally { cleanup(); }
});

test('Groq-Werkzeugaufruf wird ausgeführt und das Ergebnis zurückgegeben', async () => {
  let n = 0; const bodies = [];
  const fetch = async (url, init) => {
    if (!String(url).includes('api.groq.com')) throw new Error('offline');
    bodies.push(JSON.parse(init.body)); n++;
    if (n === 1) return sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'set_voice', arguments: '{"preset":' } }] } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"alya"}' } }] } }] }]);
    return sse(textChunks('Erledigt, ich bin jetzt Alya.'));
  };
  const { core, cleanup } = tempCore({ fetch });
  try {
    core.secrets.set('groq.api_key', 'gsk_test');
    const conv = core.conversations.create('Chat');
    const msg = await core.orchestrator.chat({ conversationId: conv.id, text: 'Erklär mir kurz, wie man in Valorant besser zielt' });
    assert.match(msg.content, /Alya/);
    assert.equal(core.settings.get('voice').tts.preset, 'alya');
    const second = bodies[1].messages;
    assert.equal(second.at(-1).role, 'tool');
    assert.equal(second.at(-2).tool_calls[0].id, second.at(-1).tool_call_id);
  } finally { cleanup(); }
});

test('Beim Zocken: Google-Stimme statt OmniVoice, Zeichen werden gezählt, Grenze wird eingehalten, privat nie', async () => {
  const sent = [];
  const fetch = async (url, init) => {
    if (String(url).includes('texttospeech.googleapis.com')) { sent.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ audioContent: Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(60)]).toString('base64') }) }; }
    throw new Error('offline');
  };
  const { core, cleanup } = tempCore({ fetch });
  try {
    core.secrets.set('gemini.api_key', 'AIza-test');
    core.localLLM.isGaming = () => true;
    core.tts.synthesize = async () => ({ wav: Buffer.from('PIPER') });
    core.omnivoice.allowed = () => { throw new Error('OmniVoice darf beim Zocken nicht laufen'); };
    core.settings.update({ voice: { tts: { preset: 'jarvis' } } });
    const r = await core.speech.synthesize('Der Jungler kommt Bot.');
    assert.equal(r.engine, 'cloud');
    assert.equal(sent[0].voice.name, 'de-DE-Chirp3-HD-Charon');
    assert.match(sent[0].input.text, /Dschungler/);
    assert.equal(core.cloudTts.used(), sent[0].input.text.length);
    // gleicher Satz → Cache, keine weiteren Zeichen
    await core.speech.synthesize('Der Jungler kommt Bot.');
    assert.equal(sent.length, 1);
    // privat → nie Google
    const p = await core.speech.synthesize('Dein Termin ist um acht.', { private: true });
    assert.equal(p.engine, 'piper'); assert.equal(sent.length, 1);
    // Grenze erreicht → Piper
    core.settings.update({ voice: { tts: { cloud: { monthlyChars: 30 } } } });
    const q = await core.speech.synthesize('Ein ganz anderer, deutlich längerer Satz über den Raid.');
    assert.equal(q.engine, 'piper'); assert.equal(sent.length, 1);
  } finally { cleanup(); }
});

test('Beim Zocken: private Sprachantwort kommt nur als Text ins Overlay, nicht vorgelesen', async () => {
  const { core, cleanup } = tempCore({ local: true, script: [{ text: 'Um 14 Uhr hast du Zahnarzt.' }] });
  try {
    core.settings.update({ localLLM: { model: 'qwen3.5:4b' } });
    core.localLLM.isGaming = () => true;
    const events = [];
    for (const ev of ['overlay:answer', 'tts:stream', 'tts:speak']) core.bus.on(ev, (d) => events.push([ev, d]));
    const conv = core.conversations.create('Chat');
    await core.orchestrator.chat({ conversationId: conv.id, text: 'Was steht heute in meinem Kalender?', channel: 'voice' });
    assert.deepEqual(events.map((e) => e[0]), ['overlay:answer']);
    assert.match(events[0][1].answer, /Zahnarzt/);
  } finally { cleanup(); }
});

test('Spiel startet → OmniVoice wird entladen; Spiel endet → wieder vorgeladen', async () => {
  const { core, cleanup } = tempCore();
  try {
    let stopped = 0; let warmed = 0;
    core.omnivoice.status = () => ({ running: true });
    core.omnivoice.stop = () => { stopped++; };
    core.omnivoice.warmup = () => { warmed++; };
    core.bus.emit('game:running', { running: ['league'], started: ['league'], stopped: [] });
    assert.equal(stopped, 1);
    core.bus.emit('game:running', { running: [], started: [], stopped: ['league'] });
    assert.equal(warmed, 1);
    core.settings.update({ voice: { tts: { cloud: { whileGaming: 'omnivoice' } } } });
    core.bus.emit('game:running', { running: ['league'], started: ['league'], stopped: [] });
    assert.equal(stopped, 1, 'bei „KI-Stimme auch beim Zocken“ bleibt sie geladen');
  } finally { cleanup(); }
});
