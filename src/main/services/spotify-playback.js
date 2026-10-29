'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
let child = null;
let latest = { playing: false, updatedAt: 0 };
let lastAttempt = 0;
function scriptPath() {
  return path.join(__dirname, 'spotify-session.ps1').replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
}
function stop() {
  const p = child; child = null; latest = { playing: false, updatedAt: 0 };
  if (p) p.kill();
}
function start() {
  if (process.platform !== 'win32' || child || Date.now() - lastAttempt < 15000) return;
  lastAttempt = Date.now();
  try {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath()], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    child = p;
    let buf = '';
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', chunk => {
      buf += chunk;
      if (buf.length > 4096) buf = buf.slice(-1024);
      let n;
      while ((n = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, n).trim(); buf = buf.slice(n + 1);
        if (line === 'PLAYING' || line === 'STOPPED') latest = { playing: line === 'PLAYING', updatedAt: Date.now() };
      }
    });
    p.on('error', () => { if (child === p) { child = null; latest.playing = false; } });
    p.on('exit', () => { if (child === p) { child = null; latest.playing = false; } });
    p.unref();
  } catch { child = null; }
}
function status() {
  if (child && Date.now() - latest.updatedAt > 15000 && Date.now() - lastAttempt > 15000) stop();
  start();
  return { playing: Date.now() - latest.updatedAt < 12000 && latest.playing, source: 'windows-media-session' };
}
module.exports = { status, stop, scriptPath };
