'use strict';
const fs = require('node:fs');
const path = require('node:path');

/**
 * Small rotating file logger. Every line passes through redact() so that
 * API keys, OAuth tokens and bearer headers never reach disk.
 */
const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z_\-]{20,}/g,                // Google API keys
  /ya29\.[0-9A-Za-z_\-\.]+/g,                // Google access tokens
  /1\/\/[0-9A-Za-z_\-]{20,}/g,               // Google refresh tokens
  /RGAPI-[0-9a-f\-]{20,}/gi,                  // Riot keys
  /(bearer\s+)[^\s"']+/gi,
  /("?(?:api[_-]?key|token|secret|password|client_secret|refresh_token|access_token)"?\s*[:=]\s*"?)[^"\s,}]+/gi,
];
const extraSecrets = new Set();

function redact(text) {
  let s = String(text);
  for (const p of SECRET_PATTERNS) s = s.replace(p, (m, g1) => (g1 && typeof g1 === 'string' && m.startsWith(g1) ? g1 : '') + '[geschützt]');
  for (const v of extraSecrets) if (v && v.length >= 8) s = s.split(v).join('[geschützt]');
  return s;
}

let file = null;
let level = 'info';
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function init(dir, lvl = 'info') {
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'jarvis.log');
  level = lvl;
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 4 * 1024 * 1024) {
      fs.renameSync(file, file + '.1');
    }
  } catch { /* ignore */ }
}

function write(lvl, scope, msg, extra) {
  if (LEVELS[lvl] < LEVELS[level]) return;
  let line = `${new Date().toISOString()} ${lvl.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  if (extra !== undefined) {
    const e = extra instanceof Error ? (extra.stack || extra.message) : (typeof extra === 'string' ? extra : JSON.stringify(extra));
    line += ' ' + e;
  }
  line = redact(line);
  if (process.env.JARVIS_LOG_STDOUT) console.log(line);
  if (file) { try { fs.appendFileSync(file, line + '\n'); } catch { /* ignore */ } }
}

function scope(name) {
  return {
    debug: (m, e) => write('debug', name, m, e),
    info: (m, e) => write('info', name, m, e),
    warn: (m, e) => write('warn', name, m, e),
    error: (m, e) => write('error', name, m, e),
  };
}

function registerSecret(v) { if (v) extraSecrets.add(String(v)); }

module.exports = { init, scope, redact, registerSecret };
