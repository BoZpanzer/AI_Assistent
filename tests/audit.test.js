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
