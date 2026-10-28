'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tempCore } = require('./helpers');

test('Figur: Eingabe → „denkt“, Antwort live und fertig, Fehler sichtbar – nur für Chat/Sprache', async () => {
  const { core, cleanup } = tempCore({ local: true, script: [{ text: 'Um 14 Uhr hast du Zahnarzt, danach ist frei.' }] });
  try {
    core.settings.update({ localLLM: { model: 'qwen3.5:4b' } });
    const ev = [];
    for (const t of ['pet:input', 'pet:delta', 'pet:answer']) core.bus.on(t, (d) => ev.push([t, d]));
    const conv = core.conversations.create('Chat');
    const msg = await core.orchestrator.chat({ conversationId: conv.id, text: 'Was steht heute in meinem Kalender?' });
    assert.equal(ev[0][0], 'pet:input');
    assert.equal(ev[0][1].messageId, msg.id);
    const answer = ev.find((e) => e[0] === 'pet:answer');
    assert.match(answer[1].text, /Zahnarzt/); assert.equal(answer[1].messageId, msg.id);
    assert.ok(ev.some((e) => e[0] === 'pet:delta' && /Zahnarzt/.test(e[1].text)));
    // Kein Modell, kein Schlüssel → Fehler landet auch in der Blase
    core.settings.update({ localLLM: { model: '' } });
    ev.length = 0;
    await core.orchestrator.chat({ conversationId: core.conversations.create('X').id, text: 'Erklär mir Wave-Management in LoL' });
    assert.ok(ev.find((e) => e[0] === 'pet:answer' && e[1].error));
  } finally { cleanup(); }
});

test('Figur: Standard-Einstellungen und Schema', () => {
  const { core, cleanup } = tempCore();
  try {
    assert.deepEqual(core.settings.get('pet'), { enabled: true, walk: true, overlay: true, size: 1 });
    core.settings.update({ pet: { size: 1.4, walk: false } });
    assert.equal(core.settings.get('pet').size, 1.4); assert.equal(core.settings.get('pet').walk, false);
  } finally { cleanup(); }
});
