'use strict';
const fs = require('node:fs');
const path = require('node:path');
const logger = require('./logger');

/**
 * Secret store. In the packaged app the cipher is Electron safeStorage,
 * which on Windows is DPAPI bound to the logged-in Windows user (the same
 * protection the Windows Credential Manager uses for generic credentials).
 * Values never leave the main process and never reach the renderer.
 *
 * In tests (plain Node) an in-memory cipher is injected.
 */
class Secrets {
  constructor(file, cipher) {
    this.file = file;
    this.cipher = cipher; // { available():bool, encrypt(str):Buffer, decrypt(Buffer):str }
    this.data = {};
    this.load();
  }
  load() {
    try {
      if (!fs.existsSync(this.file)) return;
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [k, b64] of Object.entries(raw)) {
        try {
          const v = this.cipher.decrypt(Buffer.from(b64, 'base64'));
          this.data[k] = v;
          logger.registerSecret(v);
        } catch { /* unreadable on this machine/user — ignore */ }
      }
    } catch { /* corrupt file — start empty */ }
  }
  persist() {
    const out = {};
    for (const [k, v] of Object.entries(this.data)) out[k] = this.cipher.encrypt(v).toString('base64');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(out), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  available() { return this.cipher.available(); }
  get(key) { return this.data[key] || ''; }
  has(key) { return !!this.data[key]; }
  set(key, value) {
    if (!this.cipher.available()) throw new Error('Sichere Speicherung ist auf diesem System nicht verfügbar.');
    if (value) { this.data[key] = String(value); logger.registerSecret(value); } else delete this.data[key];
    this.persist();
  }
  delete(key) { delete this.data[key]; this.persist(); }
  /** Status for UI — never the values. */
  status() { return Object.fromEntries(Object.keys(this.data).map((k) => [k, true])); }
}

/** Test/dev cipher: NOT secure, only used when Electron safeStorage is absent. */
const memoryCipher = {
  available: () => true,
  encrypt: (s) => Buffer.from('dev:' + Buffer.from(s, 'utf8').toString('base64')),
  decrypt: (b) => Buffer.from(b.toString().slice(4), 'base64').toString('utf8'),
};

module.exports = { Secrets, memoryCipher };
