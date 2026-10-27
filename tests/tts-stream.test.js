'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { SentenceStream } = require('../src/main/voice/sentence-stream');

function engine({ synthMs = 5 } = {}) {
  const state = { settings: { voice: { tts: {} } } };
  const synths = []; const played = [];
  const rpc = async (m, p) => {
    if (m === 'tts.prepare') return { parts: [p.text] };
    if (m === 'tts.synthesize') { synths.push(p.text); await new Promise((r) => setTimeout(r, synthMs)); return { audio: Buffer.from(p.text).toString('base64'), pitch: 1 }; }
    return {};
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/src/lib/audio.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\nglobalThis.engine = audio;';
  const sandbox = { on() {}, rpc, getState: () => state, setState: (p) => Object.assign(state, p), toast() {}, speechSynthesis: { cancel() {} }, atob: (x) => Buffer.from(x, 'base64').toString('binary'), setTimeout, clearTimeout, Promise };
  vm.runInNewContext(source, sandbox);
  const a = sandbox.engine;
  a.playWav = async (b64) => { played.push(Buffer.from(b64, 'base64').toString()); await new Promise((r) => setTimeout(r, 10)); };
  return { a, synths, played };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('Vorlesen startet beim ersten Satz, Reihenfolge bleibt, nächster Block wird schon berechnet', async () => {
  const { a, played } = engine();
  a.speakStream({ id: 'm1', text: 'Okay, Chef.' });
  await wait(30);
  assert.deepEqual(played, ['Okay, Chef.'], 'erster Satz läuft, bevor die Antwort fertig ist');
  a.speakStream({ id: 'm1', text: 'Zweiter Block.' });
  a.speakStream({ id: 'm1', text: 'Dritter Block.' });
  a.speakStream({ id: 'm1', text: '', done: true });
  await wait(120);
  assert.deepEqual(played, ['Okay, Chef.', 'Zweiter Block.', 'Dritter Block.']);
});

test('Stopp bricht ab; spätere Blöcke derselben Antwort werden nicht mehr gesprochen', async () => {
  const { a, played } = engine();
  a.speakStream({ id: 'm2', text: 'Eins.' });
  await wait(25);
  a.stopSpeech();
  a.speakStream({ id: 'm2', text: 'Zwei.' }); a.speakStream({ id: 'm2', text: '', done: true });
  await wait(60);
  assert.deepEqual(played, ['Eins.']);
  // neue Antwort spricht wieder
  a.speakStream({ id: 'm3', text: 'Neu.' }); a.speakStream({ id: 'm3', text: '', done: true });
  await wait(60);
  assert.deepEqual(played, ['Eins.', 'Neu.']);
});

test('Satzzerlegung: erster Satz sofort, dann Blöcke; Kurzfassung mit Hinweis; Code wird nicht vorgelesen', () => {
  const out = []; const s = new SentenceStream({ emit: (e) => out.push(e), id: 'x' });
  const txt = 'Okay, Chef. Malphite ist stark gegen Caitlyn, weil du mit Q Druck machst. Hol dir früh Wards und warte auf den Jungler. ```js\nconst a = 1. b = 2.\n``` Nach dem Recall Mid roamen. ' + 'Sehr langer Satz mit vielen Wörtern. '.repeat(20);
  for (const ch of txt.match(/.{1,5}/gs)) s.push(ch);
  s.end();
  const texts = out.map((o) => o.text);
  assert.equal(texts[0], 'Okay, Chef.');
  assert.ok(texts.every((t) => !/const a/.test(t)), 'kein Code');
  assert.ok(texts.includes('Den Rest findest du im Chat.'));
  assert.equal(out.at(-1).done, true);
  assert.ok(texts.join(' ').length < 600);
});
