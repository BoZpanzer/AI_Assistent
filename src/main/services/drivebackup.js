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
 * - Drei getrennte Dateien: Einstellungen (*.jarvis-settings), Schlüssel (*.jarvis-keys) und komplette Sicherung
 *   (Daten + Karten, *.jarvisbak). Alle VOR dem Hochladen mit deinem Backup-Passwort verschlüsselt
 *   (scrypt + AES-256-GCM). Google sieht nur unlesbare Daten; ohne Passwort kein Upload.
 * - JARVIS rührt in Drive nur seine eigenen Sicherungsdateien an (Markierung appProperties.jarvis=backup)
 *   und behält die neuesten N; alles andere im Ordner bleibt unangetastet
 */
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const WRITE_SCOPE = 'https://www.googleapis.com/auth/drive';
const FOLDER = 'application/vnd.google-apps.folder';
const PARTS = { settings: 'Einstellungen', keys: 'Schlüssel', full: 'komplett' };
const q = (v) => String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

class DriveBackup {
  constructor(s) { this.s = s; this.running = false; }

  cfg() { return this.s.settings.get('backupDrive') || {}; }
  granted() { return this.s.google.isConnected() && (this.s.settings.get('google')?.scopes || []).includes(WRITE_SCOPE); }
  status() {
    const st = safeJson(this.s.system.meta('drivebackup:status'), {}) || {};
    return { ...st, enabled: !!this.cfg().enabled, hasPassword: this.s.secrets.has('backup.password'), folder: this.cfg().folder || 'coding', keep: this.cfg().keep || 14, granted: this.granted(), connected: this.s.google.isConnected(), running: this.running };
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

  async upload(buf, name, parentId, part = 'full') {
    const token = await this.s.google.token();
    const init = await this.s.fetch(`${UPLOAD}?uploadType=resumable&fields=id,name,size`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(buf.length) },
      body: JSON.stringify({ name, parents: [parentId], mimeType: 'application/octet-stream', appProperties: { jarvis: 'backup', part }, description: `JARVIS-Sicherung (${PARTS[part]}, ${this.s.version}) von ${os.hostname()} – verschlüsselt, nur mit dem Backup-Passwort lesbar` }),
    });
    if (!init.ok) throw new Error(`Drive-Upload konnte nicht starten (HTTP ${init.status})`);
    const loc = init.headers.get('location');
    if (!loc || !/^https:\/\/www\.googleapis\.com\//.test(loc)) throw new Error('Drive-Upload: unerwartete Antwort');
    // Content-Length setzt Chromium selbst – manuell gesetzt bricht net.fetch mit ERR_INVALID_ARGUMENT ab
    const r = await this.s.fetch(loc, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: buf });
    if (!r.ok) throw new Error(`Drive-Upload fehlgeschlagen (HTTP ${r.status})`);
    return r.json();
  }

  /** Je Teil (Einstellungen, Schlüssel, Komplett) die neuesten `keep` behalten, ältere löschen (nur eigene Dateien). */
  async prune(parentId, keep, part = 'full') {
    const d = await this.api('GET', '/files', { query: { q: `'${parentId}' in parents and appProperties has { key='jarvis' and value='backup' } and trashed = false`, fields: 'files(id,name,createdTime,appProperties)', orderBy: 'createdTime desc', pageSize: 300, spaces: 'drive' } });
    const mine = (d.files || []).filter((f) => (f.appProperties?.part || 'full') === part);
    const old = mine.slice(Math.max(1, keep));
    for (const f of old) await this.api('DELETE', '/files/' + f.id).catch((e) => log.warn('Alte Sicherung nicht gelöscht', e));
    return old.length;
  }

  /** Run a backup now (or when due). */
  async run({ force = false } = {}) {
    const c = this.cfg();
    if (!force && !c.enabled) return { skipped: 'disabled' };
    if (!this.granted()) throw new Error('JARVIS hat noch keinen Schreibzugriff auf Google Drive – „Drive-Backup aktivieren“ klicken.');
    const password = this.s.secrets.get('backup.password');
    if (!password) throw new Error('Für das Drive-Backup zuerst ein Backup-Passwort festlegen (gleich darunter, „Backup-Passwort“) – damit wird die Sicherung vor dem Hochladen verschlüsselt.');
    if (this.running) return { skipped: 'running' };
    if (!force) {
      const last = this.status().lastSuccess;
      if (last && Date.now() - Date.parse(last) < (c.intervalHours || 24) * 3600_000 - 10 * 60_000) return { skipped: 'not-due' };
    }
    this.running = true;
    this.s.bus.emit('backup:drive', this.status());
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const tmp = path.join(os.tmpdir(), `JARVIS-Backup-${stamp}-${process.pid}.zip`);
    const kv = require('../core/keyvault');
    try {
      // drei getrennte Dateien: Einstellungen, Schlüssel, komplette Sicherung (Daten + Karten) – alle verschlüsselt
      const { availableModels, ...settings } = this.s.settings.all(); // eslint-disable-line no-unused-vars
      const files = [
        { part: 'settings', name: `JARVIS-Einstellungen-${stamp}.jarvis-settings`, buf: kv.sealBuffer(Buffer.from(JSON.stringify({ app: 'JARVIS', kind: 'settings', version: this.s.version, exported: nowIso(), settings })), password) },
        { part: 'keys', name: `JARVIS-Schluessel-${stamp}.jarvis-keys`, buf: Buffer.from(JSON.stringify(kv.seal(this.s.secrets.all(), password))) },
      ];
      this.s.system.createBackup(tmp, { secrets: false, keys: false });
      files.push({ part: 'full', name: `JARVIS-Backup-${stamp}.jarvisbak`, buf: kv.sealBuffer(fs.readFileSync(tmp), password) });
      const parent = await this.folderId(c.folder || 'coding');
      let removed = 0; const uploaded = [];
      for (const f of files) {
        const up = await this.upload(f.buf, f.name, parent, f.part);
        removed += await this.prune(parent, c.keep || 14, f.part);
        uploaded.push({ part: f.part, name: f.name, size: f.buf.length, id: up.id });
      }
      const size = uploaded.reduce((a, x) => a + x.size, 0);
      const name = uploaded.find((x) => x.part === 'full').name;
      this.setStatus({ lastSuccess: nowIso(), lastFile: name, lastSize: size, lastFiles: uploaded.map((x) => x.name), lastError: null, removed });
      log.info(`Drive-Backup (verschlüsselt, 3 Dateien) hochgeladen: ${Math.round(size / 1024)} KB, ${removed} alte entfernt`);
      return { ok: true, file: name, files: uploaded, size, removed };
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
