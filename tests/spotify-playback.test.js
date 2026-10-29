'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
function service(platform = 'win32') {
  let now = 20000;
  const children = [];
  const context = { module: { exports: {} }, __dirname: '/app/resources/app.asar/src/main/services', process: { platform }, Date: { now: () => now }, require: name => name === 'node:child_process' ? { spawn: (cmd, args) => {
    const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stdout.setEncoding = () => {};
    p.kill = () => { p.killed = true; }; p.unref = () => {}; p.args = args; children.push(p); return p;
  } } : require(name) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/main/services/spotify-playback.js'), 'utf8'), context);
  return { api: context.module.exports, children, advance: ms => { now += ms; } };
}
test('Spotify: split output, pause/resume, one process and unpacked script', () => {
  const s = service(); assert.equal(s.api.status().playing, false);
  const p = s.children[0]; assert.ok(p.args.includes('/app/resources/app.asar.unpacked/src/main/services/spotify-session.ps1'));
  p.stdout.emit('data', 'PLAY'); assert.equal(s.api.status().playing, false);
  p.stdout.emit('data', 'ING\r\n'); assert.equal(s.api.status().playing, true);
  p.stdout.emit('data', 'STOPPED\n'); assert.equal(s.api.status().playing, false);
  p.stdout.emit('data', 'PLAYING\n'); assert.equal(s.api.status().playing, true);
  assert.equal(s.children.length, 1); s.api.stop(); assert.equal(p.killed, true);
});
test('Spotify: stale data, hung process recovery and crash backoff', () => {
  const s = service(); s.api.status(); const p = s.children[0]; p.stdout.emit('data', 'PLAYING\n');
  s.advance(13000); assert.equal(s.api.status().playing, false);
  s.advance(3000); s.api.status(); assert.equal(p.killed, true); assert.equal(s.children.length, 2);
  s.children[1].emit('error', new Error('unavailable')); s.api.status(); assert.equal(s.children.length, 2);
  s.advance(16000); s.api.status(); assert.equal(s.children.length, 3);
});
test('Spotify: non-Windows is an idle no-op', () => {
  const s = service('linux'); assert.equal(s.api.status().playing, false); assert.equal(s.children.length, 0);
});
test('Alya sequence uses exactly all 22 original RGBA PNGs in front/jump/back/return order', () => {
  const code = fs.readFileSync(path.join(__dirname, '../src/renderer/src/components/AlyaDance.jsx'), 'utf8');
  const prefix = code.slice(code.indexOf('const ROOT'), code.indexOf('// Decode once'));
  const { frames, durations, urls } = vm.runInNewContext(prefix + '\n({frames, durations, urls})');
  assert.equal(urls.length, 22); assert.equal(frames.length, durations.length);
  assert.match(frames[0], /^tanz_vorne/); assert.match(frames[8], /^sprung_vorne_nach_hinten/);
  assert.match(frames[14], /^tanz_hinten/); assert.match(frames[22], /^sprung_hinten_nach_vorne/);
  for (const url of urls) {
    const png = fs.readFileSync(path.join(__dirname, '../src/renderer', url));
    assert.equal(png.subarray(1, 4).toString(), 'PNG'); assert.equal(png.readUInt32BE(16), 320);
    assert.equal(png.readUInt32BE(20), 512); assert.equal(png[25], 6);
  }
});
