'use strict';
const { seal, open } = require('../core/keyvault');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { zipSync, unzipSync } = require('fflate');
const { id, nowIso, sha256, startOfDay, endOfDay } = require('../core/util');
const log = require('../core/logger').scope('system');

/** System status, backups, legacy import and signed update checks. */
class System {
  constructor(s) { this.s = s; this.update = null; }

  meta(key) { return this.s.db.get('SELECT value FROM meta WHERE key=?', key)?.value ?? null; }
  setMeta(key, value) { this.s.db.run('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value)); }

  status() {
    const s = this.s;
    const mem = process.memoryUsage();
    return {
      version: s.version, dataDir: s.paths.data, schema: s.db.version,
      gemini: { configured: s.gemini.hasKey(), models: s.settings.get('models'), usage: s.gemini.usage },
      google: s.calendar.status(), study: s.study.status(), brain: s.brain.overview(),
      voice: { state: s.voice?.state || 'off' }, game: s.gaming.context.state(),
      secretsProtected: s.secrets.available(), memoryMB: Math.round(mem.rss / 1048576), uptimeMin: Math.round(process.uptime() / 60),
      update: this.update,
    };
  }

  // ---------- Backups ----------
  backupDir() { return path.join(this.s.paths.data, 'backups'); }

  /** Tagesmarker (Briefing, Verbrauch …) älter als `days` Tage entfernen – sonst wächst die Tabelle endlos. */
  pruneMeta(days = 120) {
    const cut = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const rows = this.s.db.all("SELECT key FROM meta WHERE key GLOB '*[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'");
    let n = 0;
    for (const r of rows) { const d = r.key.match(/(\d{4}-\d{2}-\d{2})/)?.[1]; if (d && d < cut) { this.s.db.run('DELETE FROM meta WHERE key=?', r.key); n++; } }
    try { require('../core/logger').rotate(); } catch { /* ignore */ }
    return n;
  }

  /**
   * Full backup: DB snapshot + encrypted secrets + map images → .zip
   * secrets=false (Drive): Schlüssel/Passwörter/Sitzungen bleiben auf dem PC – sie sind ohnehin nur mit
   * deinem Windows-Konto entschlüsselbar und hätten in der Cloud nur Risiko, keinen Nutzen.
   */
  createBackup(dest, { secrets = true } = {}) {
    const tmp = this.s.db.snapshot('export');
    const files = { 'jarvis.sqlite3': new Uint8Array(fs.readFileSync(tmp)), 'manifest.json': Buffer.from(JSON.stringify({ app: 'JARVIS', version: this.s.version, schema: this.s.db.version, created: nowIso(), host: os.hostname() })) };
    const sec = path.join(this.s.paths.data, 'secrets.json');
    if (secrets && fs.existsSync(sec)) files['secrets.json'] = new Uint8Array(fs.readFileSync(sec));
    // Mit Backup-Passwort: alle Schlüssel zusätzlich passwortgeschützt (auf jedem PC wiederherstellbar)
    const bpw = this.s.secrets.get('backup.password');
    if (bpw) { try { files['keys.jarvis.json'] = Buffer.from(JSON.stringify(seal(this.s.secrets.all(), bpw))); } catch (e) { log.warn('Schlüssel nicht gesichert', e); } }
    const mapsDir = path.join(this.s.paths.data, 'maps');
    if (fs.existsSync(mapsDir)) {
      for (const g of fs.readdirSync(mapsDir)) for (const f of fs.readdirSync(path.join(mapsDir, g))) files[`maps/${g}/${f}`] = new Uint8Array(fs.readFileSync(path.join(mapsDir, g, f)));
    }
    const zip = zipSync(files, { level: 6 });
    const out = dest || path.join(this.backupDir(), `JARVIS-Backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.zip`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, zip);
    fs.rmSync(tmp, { force: true });
    return { file: out, size: zip.length };
  }

  autoBackup() {
    const key = 'autobackup:' + new Date().toISOString().slice(0, 10);
    if (this.meta(key)) return null;
    const r = this.createBackup(path.join(this.backupDir(), 'auto', `auto-${new Date().toISOString().slice(0, 10)}.zip`));
    this.setMeta(key, '1');
    const dir = path.join(this.backupDir(), 'auto');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.zip')).sort();
    const keep = Math.max(1, Math.min(100, this.s.settings.get('localBackup')?.keep || 7));
    for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.rmSync(path.join(dir, f), { force: true });
    return r;
  }

  listBackups() {
    const out = [];
    for (const sub of ['', 'auto']) {
      const d = path.join(this.backupDir(), sub);
      if (!fs.existsSync(d)) continue;
      for (const f of fs.readdirSync(d)) if (/\.(zip|sqlite3)$/.test(f)) { const st = fs.statSync(path.join(d, f)); out.push({ file: path.join(d, f), name: f, size: st.size, at: st.mtime.toISOString(), auto: sub === 'auto' }); }
    }
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }

  /** Validate a backup and stage it; applied on next start (before the DB opens). */
  stageRestore(file, { password } = {}) {
    const buf = fs.readFileSync(file);
    let dbBytes; let secrets = null; let keysBundle = null;
    if (file.endsWith('.zip')) {
      const z = unzipSync(new Uint8Array(buf));
      const man = z['manifest.json'] ? JSON.parse(Buffer.from(z['manifest.json']).toString()) : null;
      if (!man || man.app !== 'JARVIS' || !z['jarvis.sqlite3']) throw new Error('Keine gültige JARVIS-Sicherung');
      dbBytes = Buffer.from(z['jarvis.sqlite3']); secrets = z['secrets.json'] ? Buffer.from(z['secrets.json']) : null;
      keysBundle = z['keys.jarvis.json'] ? Buffer.from(z['keys.jarvis.json']).toString('utf8') : null;
    } else dbBytes = buf;
    const probe = path.join(os.tmpdir(), 'jarvis-restore-probe-' + crypto.randomBytes(4).toString('hex') + '.sqlite3');
    fs.writeFileSync(probe, dbBytes);
    try {
      const d = new DatabaseSync(probe, { readOnly: true });
      const ok = d.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE name IN ('tasks','knowledge','conversations')").get().c === 3;
      const integrity = d.prepare('PRAGMA quick_check').get();
      d.close();
      if (!ok || Object.values(integrity)[0] !== 'ok') throw new Error('Sicherung ist beschädigt oder unvollständig');
    } finally { fs.rmSync(probe, { force: true }); }
    const stage = path.join(this.s.paths.data, 'restore-pending');
    fs.mkdirSync(stage, { recursive: true });
    fs.writeFileSync(path.join(stage, 'jarvis.sqlite3'), dbBytes);
    // Schlüssel aus der Sicherung nur übernehmen, wenn sie auf DIESEM PC/Windows-Konto lesbar sind –
    // sonst würden funktionierende Schlüssel durch unlesbare ersetzt (z. B. Sicherung von einem anderen PC)
    let secretsNote = null;
    if (secrets) {
      let readable = false;
      try { const j = JSON.parse(secrets.toString('utf8')); const v = Object.values(j)[0]; readable = !v || typeof this.s.secrets.cipher.decrypt(Buffer.from(v, 'base64')) === 'string'; } catch { readable = false; }
      if (readable) fs.writeFileSync(path.join(stage, 'secrets.json'), secrets);
      else secretsNote = 'Die Schlüssel in der Sicherung stammen von einem anderen PC/Windows-Konto – deine aktuellen Schlüssel bleiben erhalten.';
    }
    // Passwortgeschützte Schlüssel: nur nötig, wenn die DPAPI-Schlüssel hier nicht lesbar sind (anderer PC)
    let keysRestored = 0;
    if (keysBundle && (!secrets || secretsNote)) {
      if (!password) { fs.rmSync(stage, { recursive: true, force: true }); return { staged: false, needsPassword: true, keysInBackup: JSON.parse(keysBundle).count || 0 }; }
      const keys = open(keysBundle, password);
      for (const [k, v] of Object.entries(keys)) this.s.secrets.set(k, v);
      keysRestored = Object.keys(keys).length;
      secretsNote = `${keysRestored} Schlüssel aus der Sicherung übernommen.`;
    }
    return { staged: true, restartRequired: true, secretsNote, keysRestored };
  }

  /** Called at startup BEFORE the database is opened. */
  static applyPendingRestore(dataDir) {
    const stage = path.join(dataDir, 'restore-pending');
    const src = path.join(stage, 'jarvis.sqlite3');
    if (!fs.existsSync(src)) return false;
    const dbFile = path.join(dataDir, 'jarvis.sqlite3');
    const bdir = path.join(dataDir, 'backups');
    fs.mkdirSync(bdir, { recursive: true });
    if (fs.existsSync(dbFile)) fs.copyFileSync(dbFile, path.join(bdir, `vor-wiederherstellung-${Date.now()}.sqlite3`));
    for (const ext of ['', '-wal', '-shm']) fs.rmSync(dbFile + ext, { force: true });
    fs.renameSync(src, dbFile);
    const sec = path.join(stage, 'secrets.json');
    if (fs.existsSync(sec)) fs.renameSync(sec, path.join(dataDir, 'secrets.json'));
    fs.rmSync(stage, { recursive: true, force: true });
    return true;
  }

  // ---------- Legacy import (JARVIS 1.x / 2.0 Python versions) ----------
  legacyCandidates() {
    const out = [];
    const local = process.env.LOCALAPPDATA;
    const cands = [];
    if (local) cands.push(path.join(local, 'JARVIS', 'local', 'jarvis.sqlite3'), path.join(local, 'JARVIS', 'local', 'nexus.sqlite3'));
    cands.push(path.join(os.homedir(), '.local', 'share', 'JARVIS', 'local', 'jarvis.sqlite3'));
    for (const c of cands) if (fs.existsSync(c)) out.push({ file: c, size: fs.statSync(c).size, imported: !!this.s.db.get('SELECT 1 x FROM imports WHERE fingerprint=?', sha256(fs.readFileSync(c))) });
    return out;
  }

  importLegacy(file) {
    const s = this.s;
    const fp = sha256(fs.readFileSync(file));
    if (s.db.get('SELECT 1 x FROM imports WHERE fingerprint=?', fp)) return { skipped: true, reason: 'Bereits importiert' };
    s.db.snapshot('vor-altimport');
    const old = new DatabaseSync(file, { readOnly: true });
    const has = (t) => !!old.prepare('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=?').get(t);
    const counts = { tasks: 0, memories: 0, messages: 0, events: 0, research: 0 };
    const prioMap = { high: 'high', hoch: 'high', low: 'low', niedrig: 'low' };
    const repMap = { daily: { freq: 'daily' }, weekly: { freq: 'weekly' }, monthly: { freq: 'monthly' }, yearly: { freq: 'yearly' } };
    const domainMap = { persoenlich: 'personal', personal: 'personal', projekt: 'projects', projects: 'projects', schule: 'study', studium: 'study', study: 'study', gaming: 'gaming', idee: 'ideas', ideen: 'ideas', technik: 'technology' };
    try {
      if (has('tasks')) for (const t of old.prepare('SELECT * FROM tasks').all()) {
        try {
          const task = s.tasks.create({ title: String(t.title).slice(0, 300), notes: t.notes || '', priority: prioMap[t.priority] || 'medium', dueAt: t.due_at && !isNaN(Date.parse(t.due_at)) ? new Date(t.due_at).toISOString() : null, recurrence: repMap[t.repeat] || null, source: 'import' });
          if (t.done && !repMap[t.repeat]) s.tasks.complete(task.id, true);
          counts.tasks++;
        } catch (e) { log.debug('Altaufgabe übersprungen', e); }
      }
      if (has('memories')) for (const m of old.prepare('SELECT * FROM memories').all()) {
        const r = s.brain.add({ content: String(m.content).slice(0, 20000), kind: 'memory', domain: domainMap[String(m.category || '').toLowerCase()] || 'personal', sourceType: 'import', sourceRef: 'JARVIS 2.0', tags: m.category ? [String(m.category).slice(0, 40)] : [] });
        if (r.action === 'created') counts.memories++;
      }
      if (has('messages')) {
        const msgs = old.prepare('SELECT * FROM messages ORDER BY created_at').all();
        if (msgs.length) {
          const conv = s.conversations.create('Import aus JARVIS 2.0');
          s.db.tx(() => { for (const m of msgs) { if (!['user', 'assistant'].includes(m.role)) continue; s.db.run('INSERT INTO messages(id,conversation_id,role,content,meta,channel,created_at) VALUES(?,?,?,?,?,?,?)', id('m'), conv.id, m.role, m.content || '', JSON.stringify({ imported: true }), 'text', m.created_at || nowIso()); counts.messages++; } });
        }
      }
      if (has('calendar_events')) for (const e of old.prepare('SELECT * FROM calendar_events').all()) {
        if (!e.start_at || isNaN(Date.parse(e.start_at))) continue;
        const start = new Date(e.start_at).toISOString();
        const end = e.end_at && !isNaN(Date.parse(e.end_at)) ? new Date(e.end_at).toISOString() : new Date(Date.parse(start) + 3600000).toISOString();
        s.db.run(`INSERT INTO events(id,calendar_id,title,description,location,start_at,end_at,sync_state,local_updated) VALUES(?,?,?,?,?,?,?,'local',?)`, id('e'), 'local', e.title, e.description || '', e.location || '', start, end, nowIso());
        counts.events++;
      }
      if (has('research_notes')) for (const r of old.prepare('SELECT * FROM research_notes').all()) {
        s.db.run('INSERT OR IGNORE INTO research(id,query,answer,sources,created_at) VALUES(?,?,?,?,?)', 'imp_' + r.id, r.query, r.result, r.sources || '[]', r.created_at || nowIso());
        counts.research++;
      }
    } finally { old.close(); }
    s.db.run('INSERT INTO imports(fingerprint,kind,at) VALUES(?,?,?)', fp, 'legacy', nowIso());
    s.bus.emit('data:imported', counts);
    return { imported: counts };
  }

  // ---------- Updates → services/updater.js (GitHub Releases, signiert) ----------
  checkUpdates(opts) { return this.s.updater.check(opts); }
  downloadUpdate() { return this.s.updater.download(); }
}

const { cmpVersion } = require('./updater');

/** Compact local daily briefing (no AI call needed). */
function briefing(s) {
  const ev = s.calendar.list(startOfDay(), endOfDay());
  const c = s.tasks.counts();
  const timers = s.gaming.timers().filter((t) => !t.fired);
  const parts = [];
  parts.push(ev.length ? `${ev.length} Termin${ev.length > 1 ? 'e' : ''}: ` + ev.slice(0, 3).map((e) => `${e.allDay ? 'ganztägig' : new Date(e.start).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} ${e.title}`).join(', ') : 'Keine Termine.');
  parts.push(`${c.today} Aufgabe${c.today === 1 ? '' : 'n'} fällig${c.overdue ? `, ${c.overdue} überfällig` : ''}.`);
  if (timers.length) parts.push(`${timers.length} Spiel-Timer laufen.`);
  const text = parts.join(' ');
  s.db.run('INSERT OR REPLACE INTO briefings(day,text,created_at) VALUES(?,?,?)', new Date().toISOString().slice(0, 10), text, nowIso());
  return { text, events: ev.length, tasks: c, timers: timers.length };
}

module.exports = { System, cmpVersion, briefing };
