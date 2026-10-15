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
