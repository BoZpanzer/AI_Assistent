'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { nowIso, safeJson } = require('../core/util');
const log = require('../core/logger').scope('drive-backup');

/**
 * Automatische Sicherung von JARVIS nach Google Drive (Standard: Ordner „coding“).
 * - einmal pro Tag (nicht während eines Spiels), zusätzlich „Jetzt sichern“
 * - Datenbank + Karten; KEINE Schlüssel/Passwörter/Anmeldungen (die bleiben nur auf dem PC, DPAPI)
 * - JARVIS rührt in Drive nur seine eigenen Sicherungsdateien an (Markierung appProperties.jarvis=backup)
 *   und behält die neuesten N; alles andere im Ordner bleibt unangetastet
 */
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const WRITE_SCOPE = 'https://www.googleapis.com/auth/drive';
const FOLDER = 'application/vnd.google-apps.folder';
const q = (v) => String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

class DriveBackup {
  constructor(s) { this.s = s; this.running = false; }

  cfg() { return this.s.settings.get('backupDrive') || {}; }
  granted() { return this.s.google.isConnected() && (this.s.settings.get('google')?.scopes || []).includes(WRITE_SCOPE); }
  status() {
    const st = safeJson(this.s.system.meta('drivebackup:status'), {}) || {};
    return { ...st, blocked: 'private-data', enabled: false, folder: this.cfg().folder || 'coding', keep: this.cfg().keep || 14, granted: this.granted(), connected: this.s.google.isConnected(), running: this.running };
  }
  setStatus(patch) {
    const st = { ...(safeJson(this.s.system.meta('drivebackup:status'), {}) || {}), ...patch };
    this.s.system.setMeta('drivebackup:status', JSON.stringify(st));
    this.s.bus.emit('backup:drive', this.status());
  }

  api(method, p, opts) { return this.s.google.api(method, p, opts, API); }

  /** Find (or create) a folder path like "coding" or "coding/JARVIS" below My Drive. */
  async folderId(folderPath) {
    let parent = 'root';
    for (const name of String(folderPath || 'coding').split('/').map((x) => x.trim()).filter(Boolean)) {
      const d = await this.api('GET', '/files', { query: { q: `name = '${q(name)}' and mimeType = '${FOLDER}' and '${parent}' in parents and trashed = false`, fields: 'files(id,name)', pageSize: 5, spaces: 'drive' } });
      if (d.files?.length) { parent = d.files[0].id; continue; }
      const c = await this.api('POST', '/files', { query: { fields: 'id' }, body: { name, mimeType: FOLDER, parents: [parent] } });
      parent = c.id;
    }
    return parent;
  }

  async upload() { throw new Error('Private: vollständige Backups dürfen den PC nicht verlassen. Bitte lokal sichern.'); }

  /** Keep the newest `keep` JARVIS backups in the folder, delete older ones (only our own files). */
  async prune(parentId, keep) {
    const d = await this.api('GET', '/files', { query: { q: `'${parentId}' in parents and appProperties has { key='jarvis' and value='backup' } and trashed = false`, fields: 'files(id,name,createdTime)', orderBy: 'createdTime desc', pageSize: 100, spaces: 'drive' } });
    const old = (d.files || []).slice(Math.max(1, keep));
    for (const f of old) await this.api('DELETE', '/files/' + f.id).catch((e) => log.warn('Alte Sicherung nicht gelöscht', e));
    return old.length;
  }

  /** Run a backup now (or when due). */
  async run() { return { skipped: 'private-data', message: 'Cloud-Backup gesperrt; lokale Sicherung verwenden.' }; }
}

module.exports = { DriveBackup, WRITE_SCOPE };
