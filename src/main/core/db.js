'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const MIGRATIONS = require('./migrations');
const log = require('./logger').scope('db');

/**
 * Thin wrapper around node:sqlite (built into Electron's Node — no native
 * modules to ship). Versioned migrations; automatic snapshot before any
 * schema change of an existing database.
 */
class Database {
  constructor(file, { backupDir } = {}) {
    this.file = file;
    this.backupDir = backupDir;
    const existed = file !== ':memory:' && fs.existsSync(file);
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=4000; PRAGMA temp_store=MEMORY;');
    this.cache = new Map();
    this.migrate(existed);
  }

  get version() {
    return this.db.prepare('PRAGMA user_version').get().user_version;
  }

  migrate(existed) {
    const current = this.version;
    const target = MIGRATIONS.length;
    if (current > target) throw new Error(`Datenbank stammt aus einer neueren JARVIS-Version (Schema ${current} > ${target}).`);
    if (current === target) return;
    if (existed && current > 0 && this.backupDir) {
      const snap = this.snapshot(`vor-migration-v${current}-zu-v${target}`);
      log.info(`Sicherung vor Migration: ${snap}`);
    }
    for (let v = current; v < target; v++) {
      this.tx(() => {
        MIGRATIONS[v](this.db);
        this.db.exec(`PRAGMA user_version=${v + 1}`);
      });
      log.info(`Schema migriert auf v${v + 1}`);
    }
  }

  /** Consistent online copy of the database (VACUUM INTO). */
  snapshot(label = 'backup') {
    fs.mkdirSync(this.backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(this.backupDir, `jarvis-${label}-${stamp}.sqlite3`);
    this.db.prepare('VACUUM INTO ?').run(dest);
    return dest;
  }

  stmt(sql) {
    let s = this.cache.get(sql);
    if (!s) { s = this.db.prepare(sql); this.cache.set(sql, s); }
    return s;
  }
  all(sql, ...p) { return this.stmt(sql).all(...p); }
  get(sql, ...p) { return this.stmt(sql).get(...p); }
  run(sql, ...p) { return this.stmt(sql).run(...p); }
  exec(sql) { return this.db.exec(sql); }

  tx(fn) {
    if (this._inTx) return fn();
    this._inTx = true;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    } finally {
      this._inTx = false;
    }
  }

  close() { try { this.db.close(); } catch { /* ignore */ } }
}

module.exports = { Database };
