'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { encode, decode } = require('../core/mobile-sync-crypto');

/** Explicit, offline file handoff only. No OneDrive credentials or network side effects. */
class MobileSync {
  constructor(services) { this.s = services; }
  snapshot(type) {
    if (type === 'settings') return { exportedAt: new Date().toISOString(), settings: this.s.settings.all() };
    if (type === 'knowledge') return { exportedAt: new Date().toISOString(),
      entries: this.s.db.all('SELECT * FROM knowledge ORDER BY updated_at DESC LIMIT 10000').map(r => this.s.brain.toPublic(r)) };
    throw new Error('Unbekannter Bereich');
  }
  exportFile(type, password, directory) {
    if (!['knowledge', 'settings'].includes(type)) throw new Error('Unbekannter Bereich');
    const bundle = encode(type, this.snapshot(type), password);
    const base = path.resolve(directory);
    fs.mkdirSync(base, { recursive: true, mode: 0o700 });
    const dest = path.join(base, 'jarvis-' + type + '.encrypted.json');
    const tmp = dest + '.' + require('node:crypto').randomUUID() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(bundle), { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, dest);
    return { file: dest, type, exportedAt: new Date().toISOString() };
  }
  inspectFile(type, password, file) {
    if (!['knowledge', 'settings'].includes(type)) throw new Error('Unbekannter Bereich');
    if (fs.statSync(file).size > 16 * 1024 * 1024) throw new Error('Sync-Datei zu groß');
    return decode(JSON.parse(fs.readFileSync(file, 'utf8')), password, type);
  }
}
module.exports = { MobileSync };
