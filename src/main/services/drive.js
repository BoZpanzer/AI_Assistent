'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { nowIso } = require('../core/util');
const log = require('../core/logger').scope('drive');

/**
 * Google-Drive-Quelle fürs Studium: spiegelt einen Drive-Ordner (Standard
 * „Goodnotes“) nur lesend in einen lokalen Cache. Die normale Indexierung
 * (Study) arbeitet dann auf diesem Cache – Unterordner werden zu Fächern.
 * Inkrementell über md5/Änderungszeit, gelöschte Dateien verschwinden.
 */
const DRIVE = 'https://www.googleapis.com/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const FOLDER = 'application/vnd.google-apps.folder';
const EXPORT = { // Google-eigene Formate → PDF
  'application/vnd.google-apps.document': '.pdf',
  'application/vnd.google-apps.presentation': '.pdf',
};
const MAX_FILE = 200 * 1024 * 1024;

const safeName = (n) => String(n).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 120) || '_';

class Drive {
  constructor(s) { this.s = s; this.syncing = false; this.status = { lastSync: null, error: null, files: 0, changed: 0 }; }

  cfg() { return this.s.settings.get('study') || {}; }
  active() { return this.cfg().source === 'drive'; }
  granted() { return (this.s.settings.get('google')?.scopes || []).includes(SCOPE) && this.s.google.isConnected(); }
  folderName() { return this.cfg().driveFolder || 'Goodnotes'; }
  root() { return path.join(this.s.paths.data, 'drive', safeName(this.folderName())); }
  manifestFile() { return path.join(this.root(), '.jarvis-drive.json'); }

  readManifest() { try { return JSON.parse(fs.readFileSync(this.manifestFile(), 'utf8')); } catch { return { files: {} }; } }
  writeManifest(m) { fs.mkdirSync(this.root(), { recursive: true }); fs.writeFileSync(this.manifestFile(), JSON.stringify(m)); }

  api(p, query) { return this.s.google.api('GET', p, { query }, DRIVE); }

  /** Folders with this name (to pick from if there are several). */
  async findFolders(name = this.folderName()) {
    const q = `name = '${String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and mimeType = '${FOLDER}' and trashed = false`;
    const d = await this.api('/files', { q, fields: 'files(id,name,modifiedTime,parents)', pageSize: 20, spaces: 'drive', supportsAllDrives: true, includeItemsFromAllDrives: true });
    return (d.files || []).map((f) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime }));
  }

  async listChildren(id) {
    const out = []; let pageToken;
    do {
      const d = await this.api('/files', { q: `'${id}' in parents and trashed = false`, fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,md5Checksum,size)', pageSize: 1000, pageToken, supportsAllDrives: true, includeItemsFromAllDrives: true });
      out.push(...(d.files || []));
      pageToken = d.nextPageToken;
    } while (pageToken && out.length < 20000);
    return out;
  }

  supported(f) {
    if (EXPORT[f.mimeType]) return true;
    const ext = path.extname(f.name).slice(1).toLowerCase();
    return (this.cfg().formats || ['pdf', 'docx', 'pptx', 'txt', 'md', 'ipynb']).includes(ext);
  }

  async download(f, dest) {
    const token = await this.s.google.token();
    const url = EXPORT[f.mimeType] ? `${DRIVE}/files/${f.id}/export?mimeType=application/pdf` : `${DRIVE}/files/${f.id}?alt=media&supportsAllDrives=true`;
    const r = await this.s.fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error(`Download „${f.name}“ fehlgeschlagen (HTTP ${r.status})`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_FILE) throw new Error(`„${f.name}“ ist zu groß`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = dest + '.part';
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, dest);
    if (f.modifiedTime) { const t = new Date(f.modifiedTime); try { fs.utimesSync(dest, t, t); } catch { /* ignore */ } }
  }

  /** Mirror the Drive folder into the local cache. */
  async sync({ force = false } = {}) {
    if (!this.active()) return { skipped: 'not-active' };
    if (!this.granted()) throw new Error('Google Drive ist noch nicht freigegeben – in den Einstellungen unter Studium „Google Drive verbinden“ klicken.');
    if (this.syncing) return { skipped: 'running' };
    this.syncing = true;
    this.s.bus.emit('drive:status', { ...this.status, syncing: true });
    try {
      let folderId = this.cfg().driveFolderId;
      if (!folderId) {
        const found = await this.findFolders();
        if (!found.length) throw new Error(`Kein Ordner „${this.folderName()}“ in deinem Google Drive gefunden.`);
        folderId = found[0].id;
        this.s.settings.update({ study: { driveFolderId: folderId } });
      }
      const man = force ? { files: {} } : this.readManifest();
      const seen = new Set(); let changed = 0; let count = 0; const errors = [];
      const walk = async (id, rel, depth) => {
        if (depth > 6) return;
        for (const f of await this.listChildren(id)) {
          if (f.mimeType === FOLDER) { await walk(f.id, path.join(rel, safeName(f.name)), depth + 1); continue; }
          if (!this.supported(f)) continue;
          const name = EXPORT[f.mimeType] ? safeName(f.name) + EXPORT[f.mimeType] : safeName(f.name);
          const relPath = path.join(rel, name);
          seen.add(f.id); count++;
          const prev = man.files[f.id];
          const local = path.join(this.root(), relPath);
          const same = prev && prev.rel === relPath && (f.md5Checksum ? prev.md5 === f.md5Checksum : prev.modified === f.modifiedTime) && fs.existsSync(local);
          if (same) continue;
          try {
            if (prev && prev.rel !== relPath) fs.rmSync(path.join(this.root(), prev.rel), { force: true }); // umbenannt/verschoben
            await this.download(f, local);
            man.files[f.id] = { rel: relPath, md5: f.md5Checksum || null, modified: f.modifiedTime || null };
            changed++;
          } catch (e) { errors.push(e.message); log.warn('Drive-Datei', e); }
        }
      };
      await walk(folderId, '', 0);
      for (const [fid, info] of Object.entries(man.files)) {
        if (!seen.has(fid)) { fs.rmSync(path.join(this.root(), info.rel), { force: true }); delete man.files[fid]; changed++; }
      }
      this.writeManifest(man);
      this.status = { lastSync: nowIso(), error: errors.length ? `${errors.length} Datei(en) nicht geladen: ${errors[0]}` : null, files: count, changed };
      log.info(`Drive „${this.folderName()}“: ${count} Dateien, ${changed} geändert`);
      if (changed) await this.s.study.scan();
      return this.status;
    } catch (e) {
      this.status = { ...this.status, error: e.message };
      throw e;
    } finally {
      this.syncing = false;
      this.s.bus.emit('drive:status', { ...this.status, syncing: false });
    }
  }

  publicStatus() { return { ...this.status, syncing: this.syncing, active: this.active(), granted: this.granted(), folder: this.folderName(), connected: this.s.google.isConnected() }; }
}

module.exports = { Drive, DRIVE_SCOPE: SCOPE, safeName };
