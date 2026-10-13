'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { nowIso } = require('../core/util');
const log = require('../core/logger').scope('updater');

/**
 * Updates aus GitHub Releases (öffentliches oder privates Repo).
 *
 * Ein Release enthält `JARVIS_Setup.exe` und `update.json`:
 *   { version, file, sha256, size, notes, signature }
 * signature = Ed25519 über "jarvis-update\n<version>\n<sha256>\n<file>"
 * mit dem privaten Release-Schlüssel (GitHub-Secret). Der öffentliche
 * Schlüssel steckt in der App (build/update-public-key.pem).
 *
 * Installiert wird nur, wenn Signatur UND SHA-256 stimmen. Vorher wird
 * automatisch eine Datensicherung erstellt. Nie während eines Spiels
 * automatisch prüfen, nie ungefragt installieren.
 */
const API = 'https://api.github.com';
const MAX_SETUP = 400 * 1024 * 1024;

function cmpVersion(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}

function signedMessage(m) { return Buffer.from(`jarvis-update\n${m.version}\n${String(m.sha256).toLowerCase()}\n${m.file}`); }

class Updater {
  constructor(s) {
    this.s = s;
    this.state = { state: 'idle', current: s.version };
    this.downloaded = null;
  }

  repo() {
    const r = String(this.s.settings.get('updateRepo') || this.s.updateRepo || '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
    return /^[\w.-]+\/[\w.-]+$/.test(r) ? r : null;
  }
  token() { return this.s.secrets.get('github.token') || ''; }
  configured() { return !!this.repo() || !!this.s.settings.get('updateChannelUrl'); }

  set(patch) {
    this.state = { ...this.state, ...patch, current: this.s.version };
    this.s.bus.emit('update:state', this.public());
    return this.public();
  }
  public() { const { asset, manifest, ...rest } = this.state; return { ...rest, repo: this.repo(), keyInstalled: !!this.s.updatePublicKey, downloaded: !!this.downloaded }; }

  async gh(pathName, { accept = 'application/vnd.github+json' } = {}) {
    const headers = { Accept: accept, 'User-Agent': 'JARVIS-Desktop', 'X-GitHub-Api-Version': '2022-11-28' };
    if (this.token()) headers.Authorization = 'Bearer ' + this.token();
    const r = await this.s.fetch(API + pathName, { headers, signal: AbortSignal.timeout(20000) });
    if (r.status === 404) throw new Error(this.token() ? 'Repo oder Release nicht gefunden (Token-Rechte prüfen)' : 'Repo nicht gefunden – bei einem privaten Repo bitte einen GitHub-Token hinterlegen');
    if (r.status === 401) throw new Error('GitHub hat den Token abgelehnt');
    if (r.status === 403) throw new Error('GitHub-Abfragelimit erreicht – später erneut versuchen');
    if (!r.ok) throw new Error('GitHub antwortet mit HTTP ' + r.status);
    return r;
  }

  /** Download a release asset (works for public and private repos). */
  async assetResponse(asset) {
    if (!this.token()) {
      const r = await this.s.fetch(asset.browser_download_url, { headers: { 'User-Agent': 'JARVIS-Desktop' } });
      if (!r.ok) throw new Error('Download fehlgeschlagen: HTTP ' + r.status);
      return r;
    }
    // Private repo: API asset URL; GitHub redirects to a signed storage URL → follow WITHOUT the token.
    const headers = { Accept: 'application/octet-stream', 'User-Agent': 'JARVIS-Desktop', Authorization: 'Bearer ' + this.token() };
    let r = await this.s.fetch(asset.url, { headers, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const loc = r.headers.get('location');
      if (!loc || !/^https:\/\//.test(loc)) throw new Error('Ungültige Weiterleitung beim Download');
      r = await this.s.fetch(loc, { headers: { 'User-Agent': 'JARVIS-Desktop' } });
    }
    if (!r.ok) throw new Error('Download fehlgeschlagen: HTTP ' + r.status);
    return r;
  }

  verify(m) {
    const pub = this.s.updatePublicKey;
    if (!pub || !m?.signature) return false;
    try { return crypto.verify(null, signedMessage(m), pub, Buffer.from(m.signature, 'base64')); } catch { return false; }
  }

  async check({ silent = false } = {}) { // eslint-disable-line no-unused-vars
    if (!this.repo()) {
      if (this.s.settings.get('updateChannelUrl')) return this.checkLegacy({ silent });
      return this.set({ state: 'not-configured', checkedAt: nowIso() });
    }
    if (['downloading', 'installing'].includes(this.state.state)) return this.public();
    this.set({ state: 'checking', error: null });
    try {
      let rel;
      try { rel = await (await this.gh(`/repos/${this.repo()}/releases/latest`)).json(); } catch (e) {
        // 404 kann „kein Release“ ODER „kein Zugriff“ heißen → am Repo selbst unterscheiden
        if (!/nicht gefunden/.test(e.message)) throw e;
        const repoOk = await this.gh(`/repos/${this.repo()}`).then(() => true, () => false);
        if (repoOk) return this.set({ state: 'no-release', checkedAt: nowIso(), error: null, version: null });
        throw new Error(this.token() ? 'Kein Zugriff auf das Repo – stimmt der Name, und darf der Token dieses Repo lesen (Contents: Read-only)?' : 'Repo nicht gefunden – bei einem privaten Repo bitte einen GitHub-Token hinterlegen');
      }
      const assets = rel.assets || [];
      const manAsset = assets.find((a) => a.name === 'update.json');
      if (!manAsset) throw new Error(`Release ${rel.tag_name} enthält keine update.json`);
      const m = await (await this.assetResponse(manAsset)).json();
      if (!m.version || !/^[0-9a-f]{64}$/i.test(m.sha256 || '') || !/^[\w.-]+\.exe$/.test(m.file || '')) throw new Error('Ungültiges Update-Manifest');
      const setup = assets.find((a) => a.name === m.file);
      if (!setup) throw new Error(`Release enthält ${m.file} nicht`);
      const newer = cmpVersion(m.version, this.s.version) > 0;
      const signed = this.verify(m);
      const notes = String(m.notes || rel.body || '').slice(0, 6000);
      this.set({ state: newer ? 'available' : 'current', version: m.version, notes, signed, size: setup.size, publishedAt: rel.published_at, releaseUrl: rel.html_url, checkedAt: nowIso(), error: null, asset: setup, manifest: m });
      if (newer) this.notify(m.version, signed); // dedupe: one notification per version
      return this.public();
    } catch (e) {
      log.warn('Update-Prüfung fehlgeschlagen', e);
      return this.set({ state: 'error', error: e.message, checkedAt: nowIso() });
    }
  }

  notify(version, signed) {
    this.s.notifications.push({ category: 'system', origin: 'system', dedupeKey: 'update:' + version,
      title: `JARVIS ${version} ist verfügbar`,
      body: signed ? 'Klick oben auf „Aktualisieren“ – deine Daten bleiben erhalten.' : 'Achtung: Das Update ist nicht gültig signiert und wird nicht automatisch installiert.' });
  }

  /** Legacy: single manifest URL (kept for older setups). */
  async checkLegacy({ silent }) {
    try {
      const url = this.s.settings.get('updateChannelUrl');
      const r = await this.s.fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('Update-Server antwortet mit ' + r.status);
      const m = await r.json();
      if (!m.version || !m.url || !/^https:\/\//.test(m.url) || !/^[0-9a-f]{64}$/i.test(m.sha256 || '')) throw new Error('Ungültiges Update-Manifest');
      const pub = this.s.updatePublicKey;
      let signed = false;
      try { signed = !!pub && crypto.verify(null, Buffer.from(`${m.version}\n${m.sha256.toLowerCase()}\n${m.url}`), pub, Buffer.from(m.signature || '', 'base64')); } catch { signed = false; }
      const newer = cmpVersion(m.version, this.s.version) > 0;
      this.set({ state: newer ? 'available' : 'current', version: m.version, notes: m.notes || '', signed, checkedAt: nowIso(), error: null, asset: { browser_download_url: m.url, size: 0 }, manifest: { ...m, file: path.basename(new URL(m.url).pathname) || 'JARVIS_Setup.exe' }, legacy: true });
      if (newer) this.notify(m.version, signed);
      return this.public();
    } catch (e) { return this.set({ state: 'error', error: e.message, checkedAt: nowIso() }); }
    finally { void silent; }
  }

  /** Download + verify. Returns the installer path. */
  async download() {
    const st = this.state;
    if (st.state !== 'available' && st.state !== 'error') throw new Error('Kein Update verfügbar');
    if (!st.manifest || !st.asset) throw new Error('Bitte zuerst nach Updates suchen');
    if (!st.signed) throw new Error('Das Update ist nicht gültig signiert – automatische Installation gesperrt. Lade es bei Bedarf manuell vom Release herunter.');
    const m = st.manifest;
    this.set({ state: 'downloading', progress: 0, error: null });
    try {
      const r = st.legacy ? await this.s.fetch(st.asset.browser_download_url) : await this.assetResponse(st.asset);
      if (!r.ok) throw new Error('Download fehlgeschlagen: HTTP ' + r.status);
      const total = Number(r.headers.get('content-length')) || st.size || m.size || 0;
      const hash = crypto.createHash('sha256');
      const file = path.join(os.tmpdir(), `JARVIS_Setup_${m.version}.exe`);
      // Erst unter neutralem Namen und in großen Blöcken schreiben: Virenscanner prüfen eine
      // wachsende .exe sonst bei jedem kleinen Schreibvorgang neu – das bremst den Download massiv.
      const part = file + '.download';
      fs.rmSync(part, { force: true });
      const fd = fs.openSync(part, 'w');
      let got = 0; let lastEmit = 0; const t0 = Date.now();
      let pending = []; let pendingBytes = 0;
      const flush = () => { if (pendingBytes) { fs.writeSync(fd, Buffer.concat(pending, pendingBytes)); pending = []; pendingBytes = 0; } };
      const reader = r.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          got += value.length;
          if (got > MAX_SETUP) throw new Error('Download zu groß');
          hash.update(value);
          pending.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength)); pendingBytes += value.length;
          if (pendingBytes >= 8 * 1024 * 1024) flush();
          if (Date.now() - lastEmit > 400) {
            lastEmit = Date.now();
            const secs = Math.max(0.5, (Date.now() - t0) / 1000);
            const speed = got / secs; // Bytes/s
            this.set({ progress: total ? Math.min(0.99, got / total) : null, received: got, total: total || null, speed: Math.round(speed), eta: total ? Math.round((total - got) / Math.max(1, speed)) : null });
          }
        }
        flush();
      } finally { fs.closeSync(fd); }
      fs.rmSync(file, { force: true });
      fs.renameSync(part, file);
      if (hash.digest('hex') !== String(m.sha256).toLowerCase()) { fs.rmSync(file, { force: true }); throw new Error('Prüfsumme stimmt nicht – Update verworfen.'); }
      try { this.s.system.createBackup(path.join(this.s.system.backupDir(), `vor-update-${m.version}.zip`)); } catch (e) { log.warn('Sicherung vor Update fehlgeschlagen', e); }
      this.downloaded = { file, version: m.version };
      this.set({ state: 'ready', progress: 1 });
      return file;
    } catch (e) {
      this.set({ state: 'available', progress: null, error: e.message });
      throw e;
    }
  }
}

module.exports = { Updater, cmpVersion, signedMessage };
