'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tempCore } = require('./helpers');

/** Fake Gemini Live endpoint: records client messages, lets the test push server messages. */
function fakeLive() {
  const state = { connects: [], sessions: [] };
  const connect = async ({ model, config, callbacks }) => {
    const s = { model, config, callbacks, sent: [], toolResponses: [], clientContent: [], closed: false,
      sendRealtimeInput: (m) => s.sent.push(m), sendToolResponse: (m) => s.toolResponses.push(m), sendClientContent: (m) => s.clientContent.push(m), close: () => { s.closed = true; } };
    state.connects.push({ model, config });
    state.sessions.push(s);
    setTimeout(() => callbacks.onopen?.(), 0);
    return s;
  };
  return { state, connect };
}

async function setup() {
  const t = tempCore();
  const live = fakeLive();
  t.core.secrets.set('gemini.api_key', 'AIza-test-key-123456789');
  await t.core.gemini.discover();
  const client = t.core.gemini.client();
  client.live.connect = live.connect;
  const events = [];
  for (const e of ['voice:state', 'voice:audio', 'voice:interrupted', 'voice:transcript']) t.core.bus.on(e, (d) => events.push([e, d]));
  return { ...t, live, events };
}
const tick = () => new Promise((r) => setTimeout(r, 10));

test('Live: Verbindung mit bestätigtem Modell, gemeinsamen Werkzeugen und Verlauf', async () => {
  const { core, live, cleanup } = await setup();
  const cid = core.conversations.current().id;
  core.conversations.add(cid, { role: 'user', content: 'Hallo Jarvis' });
  core.conversations.add(cid, { role: 'assistant', content: 'Hallo Chef!' });
  await core.voice.start({ conversationId: cid });
  const c = live.state.connects[0];
  assert.equal(c.model, 'gemini-3.8-live');
  assert.deepEqual(c.config.responseModalities, ['AUDIO']);
  assert.ok(c.config.tools[0].functionDeclarations.some((f) => f.name === 'create_event'), 'gleiche Werkzeuge wie im Chat');
  assert.ok(c.config.contextWindowCompression, 'Kontextkompression aktiv');
  assert.ok(c.config.inputAudioTranscription && c.config.outputAudioTranscription);
  assert.equal(live.state.sessions[0].clientContent[0].turns.length, 2, 'Textverlauf wird geteilt');
  assert.equal(core.voice.state, 'listening');
  core.voice.stop();
  cleanup();
});

test('Live: Audio raus, Unterbrechung (interrupted), Transkripte landen im selben Gespräch', async () => {
  const { core, live, events, cleanup } = await setup();
  await core.voice.start();
  const s = live.state.sessions[0];
  core.voice.sendAudio(Buffer.alloc(2560));
  assert.equal(s.sent[0].audio.mimeType, 'audio/pcm;rate=16000');
  const msg = (m) => s.callbacks.onmessage(m);
  msg({ serverContent: { inputTranscription: { text: 'Wie spät ist es?' } } });
  msg({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AAAA' } }] }, outputTranscription: { text: 'Es ist' } } });
  await tick();
  assert.equal(core.voice.state, 'speaking');
  msg({ serverContent: { interrupted: true } });
  await tick();
  assert.ok(events.some(([e]) => e === 'voice:interrupted'), 'Wiedergabe wird sofort gestoppt');
  assert.equal(core.voice.state, 'listening');
  const msgs = core.conversations.messages(core.voice.conversationId);
  assert.equal(msgs.at(-2).content, 'Wie spät ist es?');
  assert.match(msgs.at(-1).content, /Es ist …/);
  assert.equal(msgs.at(-1).channel, 'voice');
  core.voice.stop();
  cleanup();
});

test('Live: Werkzeugaufruf + Sprach-Bestätigung nur mit echter mündlicher Zustimmung', async () => {
  const { core, live, cleanup } = await setup();
  await core.voice.start();
  const s = live.state.sessions[0];
  const start = new Date(Date.now() + 86400000).toISOString();
  await s.callbacks.onmessage({ toolCall: { functionCalls: [{ id: 'c1', name: 'create_event', args: { title: 'Mathe lernen', start } }] } });
  await tick();
  assert.equal(s.toolResponses[0].functionResponses[0].response.status, 'awaiting_user_confirmation');
  // Model tries to confirm without the user saying yes → refused
  await s.callbacks.onmessage({ toolCall: { functionCalls: [{ id: 'c2', name: 'confirm_pending_action', args: { approve: true } }] } });
  await tick();
  assert.match(s.toolResponses[1].functionResponses[0].response.error, /Keine eindeutige mündliche Zustimmung/);
  assert.equal(core.calendar.list(new Date(), new Date(Date.now() + 3 * 86400000)).length, 0);
  // User says yes → accepted
  s.callbacks.onmessage({ serverContent: { inputTranscription: { text: 'Ja, trag es ein.' } } });
  await s.callbacks.onmessage({ toolCall: { functionCalls: [{ id: 'c3', name: 'confirm_pending_action', args: { approve: true } }] } });
  await tick();
  assert.equal(s.toolResponses[2].functionResponses[0].response.done, true);
  assert.equal(core.calendar.list(new Date(), new Date(Date.now() + 3 * 86400000)).length, 1);
  core.voice.stop();
  cleanup();
});

test('Live: Session-Resumption bei GoAway, Extended-Thinking mit NON_BLOCKING-Werkzeugen', async () => {
  const { core, live, cleanup } = await setup();
  await core.voice.start();
  const s = live.state.sessions[0];
  s.callbacks.onmessage({ sessionResumptionUpdate: { resumable: true, newHandle: 'handle-42' } });
  s.callbacks.onmessage({ goAway: { timeLeft: '5s' } });
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(live.state.connects.length, 2);
  assert.equal(live.state.connects[1].config.sessionResumption.handle, 'handle-42');
  assert.ok(s.closed);
  core.voice.stop();
  core.settings.update({ voice: { extendedThinking: true } });
  await core.voice.start();
  const c = live.state.connects.at(-1);
  assert.equal(c.model, 'gemini-3.8-live-extended-thinking');
  assert.ok(c.config.tools[0].functionDeclarations.every((f) => f.behavior === 'NON_BLOCKING'));
  assert.deepEqual(c.config.thinkingConfig, { thinkingLevel: 'low' });
  core.voice.stop();
  cleanup();
});

test('Live: „Geh in den Standby“ → kurz bestätigen, dann pausieren und nur noch auf „Hey Jarvis“ hören', async () => {
  const { STANDBY_RE } = require('../src/main/voice/live');
  for (const t of ['Geh in den Standby.', 'Jarvis, Pause!', 'gehe bitte in den Stand-by-Modus', 'schlaf jetzt', 'Hey Jarvis, Standby']) assert.ok(STANDBY_RE.test(t), t);
  for (const t of ['Wie lange dauert der Standby meines PCs?', 'Mach eine Pause von 5 Minuten in meinem Kalender', 'Ich gehe schlafen um elf']) assert.ok(!STANDBY_RE.test(t), t);
  const { core, live, cleanup } = await setup();
  const standby = []; core.bus.on('voice:standby', (d) => standby.push(d));
  await core.voice.start();
  const s = live.state.sessions[0];
  s.callbacks.onmessage({ serverContent: { inputTranscription: { text: 'Geh in den Standby.' } } });
  assert.equal(core.settings.get('voice').wakeWord, true, 'Wake-Word wird für den Standby eingeschaltet');
  assert.equal(core.voice.state, 'listening', 'erst bestätigen lassen');
  s.callbacks.onmessage({ serverContent: { outputTranscription: { text: 'Alles klar.' }, turnComplete: true } });
  await tick();
  assert.equal(core.voice.state, 'standby'); assert.equal(s.closed, true);
  assert.equal(standby.at(-1).pending, false);
  // Als Werkzeug (z. B. im Text-Chat) ohne offene Sitzung: ehrliche Antwort
  const out = await core.orchestrator.execute('voice_standby', {}, { conversationId: 'x', channel: 'text' });
  assert.equal(out.response.ok, false);
  // Wake-Word → Sitzung wird mit Resumption fortgesetzt
  await core.voice.start();
  assert.equal(core.voice.state, 'listening'); assert.equal(live.state.connects.length, 2);
  core.voice.stop(); cleanup();
});
