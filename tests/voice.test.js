'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempCore } = require('./helpers');

test('Voice is local only: no Gemini Live session, no audio channel, no Live model role', async () => {
  const { core, cleanup } = tempCore();
  try {
    core.secrets.set('gemini.api_key', 'test'); await core.gemini.discover();
    assert.equal(core.voice.isOpen(), false);
    assert.equal(typeof core.voice.start, 'undefined', 'kein Cloud-Sprachmodus mehr');
    assert.equal(core.settings.get('models').live, undefined);
    assert.equal(core.settings.get('cloud').features.voice, undefined);
    const src = fs.readFileSync(path.join(__dirname, '../src/main/preload.js'), 'utf8');
    assert.doesNotMatch(src, /voice:audio|sendAudio/, 'kein Audio-Kanal vom Renderer zum Hauptprozess');
    assert.ok(!fs.existsSync(path.join(__dirname, '../src/main/voice/live.js')));
  } finally { cleanup(); }
});

test('Standby by command: microphone pauses, the wake word wakes JARVIS again', async () => {
  const { core, cleanup } = tempCore();
  try {
    const events = []; core.bus.on('voice:standby', (e) => events.push(e));
    let out = await core.orchestrator.execute('voice_standby', {}, { conversationId: 'x' });
    assert.equal(out.response.ok, true); assert.match(out.response.note, /Mikrofon/);
    core.settings.update({ voice: { wakeWord: true } });
    out = await core.orchestrator.execute('voice_standby', {}, { conversationId: 'x' });
    assert.match(out.response.note, /Hey Jarvis/);
    assert.deepEqual(events.map((e) => e.wakeEnabled), [false, true]);
  } finally { cleanup(); }
});
