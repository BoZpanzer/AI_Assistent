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
    assert.deepEqual(core.settings.get('pet'), { enabled: true, uiAtStart: false, walk: true, overlay: true, size: 1 });
    core.settings.update({ pet: { size: 1.4, walk: false } });
    assert.equal(core.settings.get('pet').size, 1.4); assert.equal(core.settings.get('pet').walk, false);
  } finally { cleanup(); }
});

test('Fenster per Sprache: „zeig dich“ / „Fenster zu“ ohne KI, Fragen zählen nicht', async () => {
  const { parseWindowCommand: p } = require('../src/main/agent/window-command');
  for (const t of ['Jarvis, zeig dich', 'öffne das Fenster', 'komm raus', 'öffne Jarvis']) assert.equal(p(t), 'show', t);
  for (const t of ['Fenster zu', 'versteck dich', 'Hey Jarvis mach das Fenster zu', 'minimier dich', 'geh auf den Desktop']) assert.equal(p(t), 'hide', t);
  for (const t of ['Wie öffne ich das Fenster?', 'zeig mir meine Termine', 'mach dich bereit', 'Erklär mir die Botlane']) assert.equal(p(t), null, t);
  const { core, cleanup } = tempCore();
  try {
    const ev = []; core.bus.on('ui:window', (d) => ev.push(d));
    const msg = await core.orchestrator.chat({ conversationId: core.conversations.create('X').id, text: 'Jarvis, Fenster zu', channel: 'voice' });
    assert.deepEqual(ev, [{ show: false }]); assert.match(msg.content, /Desktop/);
  } finally { cleanup(); }
});

test('„Mach mal die Sprechblase weg“ blendet die Blase aus (ohne KI), Fragen dazu nicht', async () => {
  const { parseBubbleCommand: p } = require('../src/main/agent/window-command');
  for (const t of ['mach mal die sprechblase weg', 'Jarvis, Blase zu', 'Sprechblase ausblenden', 'nimm die Blase weg']) assert.equal(p(t), true, t);
  for (const t of ['Was ist eine Sprechblase?', 'Erklär mir die Blase am Aktienmarkt']) assert.equal(p(t), false, t);
  const { core, cleanup } = tempCore();
  try {
    const ev = []; for (const t of ['pet:answer', 'pet:clear', 'ui:window']) core.bus.on(t, () => ev.push(t));
    await core.orchestrator.chat({ conversationId: core.conversations.create('X').id, text: 'Mach mal die Sprechblase weg', channel: 'voice' });
    assert.deepEqual(ev, ['pet:answer', 'pet:clear']);
  } finally { cleanup(); }
});

test('Standby: „geh in den Standby“ ohne KI → Figur schläft, Sprache aus; neue Nachricht weckt', async () => {
  const { parseStandbyCommand: p } = require('../src/main/agent/window-command');
  for (const t of ['Jarvis, geh in den Standby', 'Standby', 'schlaf jetzt', 'mach mal Pause', 'Gute Nacht Jarvis', 'Standby-Modus']) assert.equal(p(t), true, t);
  for (const t of ['Was ist der Standby-Verbrauch meines PCs?', 'Wie viel Pause brauche ich beim Lernen?', 'schlafen Katzen viel']) assert.equal(p(t), false, t);
  const { core, cleanup } = tempCore();
  try {
    const ev = []; core.bus.on('voice:standby', (d) => ev.push(d.on));
    const cid = core.conversations.create('X').id;
    const m = await core.orchestrator.chat({ conversationId: cid, text: 'Jarvis, geh in den Standby', channel: 'voice' });
    assert.match(m.content, /Pause/); assert.equal(core.voice.standby, true); assert.deepEqual(ev, [true]);
    await core.orchestrator.chat({ conversationId: cid, text: 'Hallo', channel: 'text' });
    assert.equal(core.voice.standby, false); assert.deepEqual(ev, [true, false]);
  } finally { cleanup(); }
});

// ── Stimmung der Figur ──
{
  const { moodFor, thinkPose } = require('../src/main/agent/mood');
  const pose = (q, a, e) => moodFor({ userText: q, answer: a, error: e }).pose;
  test('Stimmung: Begrüßung winkt, Dank freut', () => {
    assert.equal(pose('Hallo Jarvis', 'Hey Chef, was steht an?'), 'wave');
    assert.equal(pose('danke dir', 'Gern geschehen!'), 'happy');
  });
  test('Stimmung: Fehler und schlechte Nachrichten → oops', () => {
    assert.equal(pose('x', 'egal', true), 'oops');
    assert.equal(pose('Wie war mein Match?', 'Leider eine Niederlage: 2/7/4.'), 'oops');
  });
  test('Stimmung: erledigt → happy, Rückfrage → lean (bleibt stehen)', () => {
    assert.equal(pose('Trag Zahnarzt ein', 'Erledigt – Zahnarzt ist am Freitag eingetragen.'), 'happy');
    const m = moodFor({ userText: 'Was steht morgen an?', answer: 'Um 9 Uhr Mathe. Soll ich dir einen Lernblock eintragen?' });
    assert.equal(m.pose, 'lean'); assert.equal(m.ms, 0);
  });
  test('Stimmung: Erklärung/Liste → gesture, sonst idle', () => {
    assert.equal(pose('Erklär mir Wave-Management', 'Darum geht es:\n- Freeze\n- Slow Push'), 'gesture');
    assert.equal(pose('wie spät ist es', 'Es ist 16:12 Uhr.'), 'idle');
  });
  test('Denkpose: schwere Fragen → think_high', () => {
    assert.equal(thinkPose('Warum verliere ich gegen Darius?'), 'think_high');
    assert.equal(thinkPose('Wie spät ist es'), 'think');
  });
}
