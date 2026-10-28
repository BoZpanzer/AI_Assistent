'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { technical } = require('../src/main/core/errors');
const privacy = require('../src/main/core/privacy');

test('Technische Fehler werden verständlich (keine SQLite-/JS-Meldungen in der Oberfläche)', () => {
  assert.match(technical(new Error('Provided value cannot be bound to SQLite parameter 1.')).message, /Angabe fehlt oder der Eintrag wurde nicht gefunden/);
  assert.equal(technical(new TypeError("Cannot read properties of undefined (reading 'goals')")).message, 'Angabe „goals“ fehlt oder ist ungültig.');
  assert.equal(technical(new TypeError("Cannot read properties of undefined (reading 'trim')")).message, 'Angabe fehlt oder ist ungültig.');
  assert.match(technical(new TypeError("Cannot destructure property 'x' of 'undefined'")).message, /„x“/);
  assert.match(technical(new RangeError('Invalid time value')).message, /Datum/);
  assert.match(technical(new TypeError('a.b is not a function')).message, /Interner Fehler/);
  const ok = new Error('Titel fehlt'); assert.equal(technical(ok), ok, 'verständliche Meldungen bleiben unverändert');
});

test('„Ich spiele gerade …“: Spielkontext lässt sich im Chat setzen (öffentlich und privat)', () => {
  for (const scope of ['general', 'gaming', 'study']) assert.ok(privacy.cloudTools(scope).has('set_game_context'), scope);
  assert.ok(privacy.LOCAL_TOOLS.has('set_game_context'));
});

test('„Trag morgen um 16 Uhr Mathe lernen ein“ ist eine Assistenz-Aktion → privat/lokal (auch mit vielen Wörtern dazwischen)', () => {
  for (const t of ['Trag morgen um 16 Uhr Mathe lernen ein', 'trag mir am 3.11. um 14:30 Zahnarzt ein', 'Leg mir für Freitag eine Aufgabe Mathe an']) assert.equal(privacy.personalText(t), true, t);
  assert.equal(privacy.personalText('Erklär mir Ableitungen'), false);
});

test('Vollbild-Erkennung: Spiele zählen als Zocken, Videos/Browser nur als Vollbild, Desktop gar nicht', () => {
  const { parseLine } = require('../src/main/fullscreen');
  const d = [{ x: 0, y: 0, width: 1920, height: 1080 }];
  assert.deepEqual(parseLine('3|HellDivers2|0,0,1920,1080', d), { fullscreen: true, gameLike: true, proc: 'helldivers2', d3d: true });
  assert.equal(parseLine('1|eldenring|0,0,1920,1080', d).gameLike, true, 'randloses Vollbild über das Fensterrechteck');
  const yt = parseLine('2|chrome|0,0,1920,1080', d); assert.equal(yt.fullscreen, true); assert.equal(yt.gameLike, false);
  assert.equal(parseLine('1|explorer|0,0,1920,1080', d).fullscreen, false, 'Desktop');
  assert.equal(parseLine('1|code|0,0,1920,1040', d).fullscreen, false, 'maximiertes Fenster ist kein Vollbild');
  assert.equal(parseLine('4|powerpnt|0,0,1920,1080', d).gameLike, false);
});

test('Unbekanntes Vollbild-Spiel zählt als Zocken (Figur weg, Google-Stimme), Video nur Figur weg', () => {
  const { tempCore } = require('./helpers');
  const { core, cleanup } = tempCore();
  try {
    const ev = []; core.bus.on('game:running', (e) => ev.push(e));
    core.gaming.context.setFullscreen({ fullscreen: true, gameLike: true, proc: 'helldivers2' });
    assert.equal(core.gaming.context.state().gaming, true); assert.equal(core.localLLM.isGaming(), true);
    core.gaming.context.setFullscreen({ fullscreen: true, gameLike: false, proc: 'chrome' });
    assert.equal(core.gaming.context.state().gaming, false); assert.equal(core.gaming.context.state().fullscreen, true);
    core.gaming.context.setFullscreen({ fullscreen: false, gameLike: false, proc: '' });
    assert.equal(core.gaming.context.state().fullscreen, false);
    assert.equal(ev.length, 3);
  } finally { cleanup(); }
});

test('Falsch eingeordnet: „↺ öffentlich“ beantwortet dieselbe Frage nochmal über Gemini, „↺ privat“ lokal', async () => {
  const { tempCore } = require('./helpers');
  const { core, fake, cleanup } = tempCore({ local: true, script: [{ text: 'lokal: kenne ich nicht' }, { text: 'Gemini: so geht Wave-Management' }, { text: 'lokal: zweite' }] });
  try {
    core.secrets.set('gemini.api_key', 'AIza-x'); await core.gemini.discover();
    core.settings.update({ localLLM: { model: 'qwen3.5:4b' } });
    const cid = core.conversations.create('C').id;
    const a = await core.orchestrator.chat({ conversationId: cid, text: 'Was steht morgen in meinem Kalender?' });
    assert.equal(a.meta.scope, 'private');
    const b = await core.orchestrator.reroute({ conversationId: cid, messageId: a.id, as: 'public' });
    assert.match(b.content, /Gemini/); assert.notEqual(b.meta.scope, 'private');
    assert.equal(fake.requests.filter((r) => !r.local).length >= 1, true);
    const c = await core.orchestrator.reroute({ conversationId: cid, messageId: a.id, as: 'private' });
    assert.match(c.content, /lokal/); assert.equal(c.meta.scope, 'private');
  } finally { cleanup(); }
});
