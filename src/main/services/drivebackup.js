'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { nowIso, safeJson } = require('../core/util');
const log = require('../core/logger').scope('drive-backup');

/**
 * Automatische Sicherung von JARVIS nach Google Drive (Standard: Ordner „coding“).
 * - einmal pro Tag (nicht während eines Spiels), zusätzlich „Jetzt sichern“
 * - die Sicherung ist dieselbe .zip wie lokal (Datenbank + verschlüsselte Schlüssel + Karten);
 *   die Schlüssel bleiben mit Windows-DPAPI verschlüsselt und sind nur auf deinem PC lesbar
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
    return { ...st, enabled: !!this.cfg().enabled, folder: this.cfg().folder || 'coding', keep: this.cfg().keep || 14, granted: this.granted(), connected: this.s.google.isConnected(), running: this.running };
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

  async upload(file, name, parentId) {
    const token = await this.s.google.token();
    const size = fs.statSync(file).size;
    const init = await this.s.fetch(`${UPLOAD}?uploadType=resumable&fields=id,name,size`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/zip', 'X-Upload-Content-Length': String(size) },
      body: JSON.stringify({ name, parents: [parentId], mimeType: 'application/zip', appProperties: { jarvis: 'backup' }, description: `JARVIS-Sicherung (${this.s.version}) von ${os.hostname()}` }),
    });
    if (!init.ok) throw new Error(`Drive-Upload konnte nicht starten (HTTP ${init.status})`);
    const loc = init.headers.get('location');
    if (!loc || !/^https:\/\/www\.googleapis\.com\//.test(loc)) throw new Error('Drive-Upload: unerwartete Antwort');
    // Content-Length setzt Chromium selbst – manuell gesetzt bricht net.fetch mit ERR_INVALID_ARGUMENT ab
    const r = await this.s.fetch(loc, { method: 'PUT', headers: { 'Content-Type': 'application/zip' }, body: fs.readFileSync(file) });
    if (!r.ok) throw new Error(`Drive-Upload fehlgeschlagen (HTTP ${r.status})`);
    return r.json();
  }

  /** Keep the newest `keep` JARVIS backups in the folder, delete older ones (only our own files). */
  async prune(parentId, keep) {
    const d = await this.api('GET', '/files', { query: { q: `'${parentId}' in parents and appProperties has { key='jarvis' and value='backup' } and trashed = false`, fields: 'files(id,name,createdTime)', orderBy: 'createdTime desc', pageSize: 100, spaces: 'drive' } });
    const old = (d.files || []).slice(Math.max(1, keep));
    for (const f of old) await this.api('DELETE', '/files/' + f.id).catch((e) => log.warn('Alte Sicherung nicht gelöscht', e));
    return old.length;
  }

  /** Run a backup now (or when due). */
  async run({ force = false } = {}) {
    const c = this.cfg();
    if (!force && !c.enabled) return { skipped: 'disabled' };
    if (!this.granted()) throw new Error('JARVIS hat noch keinen Schreibzugriff auf Google Drive – in den Einstellungen „Drive-Backup aktivieren“ klicken.');
    if (this.running) return { skipped: 'running' };
    if (!force) {
      const last = this.status().lastSuccess;
      if (last && Date.now() - Date.parse(last) < (c.intervalHours || 24) * 3600_000 - 10 * 60_000) return { skipped: 'not-due' };
    }
    this.running = true;
    this.s.bus.emit('backup:drive', this.status());
    const tmp = path.join(os.tmpdir(), `JARVIS-Backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.zip`);
    try {
      const { size } = this.s.system.createBackup(tmp);
      const parent = await this.folderId(c.folder || 'coding');
      const name = path.basename(tmp);
      const up = await this.upload(tmp, name, parent);
      const removed = await this.prune(parent, c.keep || 14);
      this.setStatus({ lastSuccess: nowIso(), lastFile: name, lastSize: size, lastError: null, removed });
      log.info(`Drive-Backup hochgeladen: ${name} (${Math.round(size / 1024)} KB), ${removed} alte entfernt`);
      return { ok: true, file: name, size, id: up.id, removed };
    } catch (e) {
      this.setStatus({ lastError: e.message, lastAttempt: nowIso() });
      throw e;
    } finally {
      this.running = false;
      fs.rmSync(tmp, { force: true });
      this.s.bus.emit('backup:drive', this.status());
    }
  }
}

module.exports = { DriveBackup, WRITE_SCOPE };
