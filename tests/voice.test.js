'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tempCore } = require('./helpers');
const { STANDBY_RE } = require('../src/main/voice/live');

for (const privacy of ['private', 'study', 'gaming']) {
  test(`Live: kein Cloud-Audio oder Verlauf für ${privacy}, auch mit gültigem API-Schlüssel`, async () => {
    const { core, cleanup } = tempCore(); let connections = 0;
    try {
      core.secrets.set('gemini.api_key', 'test'); await core.gemini.discover();
      core.gemini.client().live.connect = async () => { connections++; throw Error('must not connect'); };
      const c = core.conversations.create('Test', privacy);
      core.conversations.add(c.id, { role: 'user', content: 'SECRET_FAMILY' });
      await assert.rejects(core.voice.start({ conversationId: c.id }), /Datenschutz/);
      core.voice.sendAudio(Buffer.alloc(2560));
      assert.equal(connections, 0); assert.equal(core.voice.isOpen(), false);
      assert.equal(core.conversations.messages(c.id).length, 1);
    } finally { cleanup(); }
  });
}
test('Standby-Befehle lokal erkennen; ohne Sitzung keine vorgetäuschte Aktion', async () => {
  for (const s of ['Geh in den Standby.', 'Jarvis, Pause!', 'schlaf jetzt']) assert.ok(STANDBY_RE.test(s));
  assert.equal(STANDBY_RE.test('Wie lange dauert der Standby meines PCs?'), false);
  const { core, cleanup } = tempCore();
  try {
    const out = await core.orchestrator.execute('voice_standby', {}, { conversationId: 'x' });
    assert.equal(out.response.ok, false);
  } finally { cleanup(); }
});


test('Gemini Live needs explicit per-session consent and a non-private conversation', async () => {
  const { core, cleanup } = tempCore();
  try {
    let connects = 0;
    core.gemini.hasKey = () => true;
    core.gemini.model = () => null;
    core.gemini.requireModel = () => 'live-test-model';
    core.voice.connect = async function () {
      connects++;
      this.session = { close: () => {}, sendRealtimeInput: () => {} };
      this.setState('listening');
    };
    const privateChat = core.conversations.create('Privat', 'private');
    const study = core.conversations.create('Uni', 'study');
    const gaming = core.conversations.create('Spiel', 'gaming');

    await assert.rejects(core.voice.start({ conversationId: privateChat.id, cloudAudioApproved: true }), /Datenschutz/);
    await assert.rejects(core.voice.start({ conversationId: study.id }), /Datenschutz/);
    await assert.rejects(core.voice.start({ conversationId: gaming.id, cloudAudioApproved: 'true' }), /Datenschutz/);
    await assert.rejects(core.voice.start({ conversationId: 'missing', cloudAudioApproved: true }), /Datenschutz/);
    assert.equal(connects, 0, 'neither a denied nor invalid conversation starts a cloud connection');

    await core.voice.start({ conversationId: study.id, cloudAudioApproved: true });
    assert.equal(connects, 1);
    assert.equal(core.voice.conversationId, study.id);
    assert.equal(core.voice.isOpen(), true);

    // Switching the same conversation to private must close the active session.
    core.conversations.markPrivate(study.id);
    assert.equal(core.voice.isOpen(), false);
    await assert.rejects(core.voice.start({ conversationId: study.id, cloudAudioApproved: true }), /Datenschutz/);
    assert.equal(connects, 1);

    await core.voice.start({ conversationId: gaming.id, cloudAudioApproved: true });
    assert.equal(connects, 2);
    core.voice.stop();
  } finally { cleanup(); }
});

test('Audio frames and text are not forwarded after a live conversation becomes private', async () => {
  const { core, cleanup } = tempCore();
  try {
    core.gemini.hasKey = () => true;
    core.gemini.model = () => null;
    core.gemini.requireModel = () => 'live-test-model';
    let frames = 0, turns = 0;
    core.voice.connect = async function () {
      this.session = {
        sendRealtimeInput: () => { frames++; },
        sendClientContent: () => { turns++; },
        close: () => {},
      };
      this.setState('listening');
    };
    const c = core.conversations.create('Uni', 'study');
    await core.voice.start({ conversationId: c.id, cloudAudioApproved: true });
    core.voice.sendAudio(Buffer.alloc(320));
    assert.equal(frames, 1);
    core.conversations.markPrivate(c.id);
    core.voice.sendAudio(Buffer.alloc(320));
    assert.equal(core.voice.sendText('Vertraulich'), false);
    assert.equal(frames, 1);
    assert.equal(turns, 0);
  } finally { cleanup(); }
});
