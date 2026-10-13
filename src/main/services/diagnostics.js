'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { friendlyError, isPayment, isQuota } = require('../providers/gemini');

/**
 * Systemcheck: prüft jede Verbindung wirklich (kleine, echte Abfragen) und sagt bei Problemen,
 * was zu tun ist. Status: ok | warn (läuft eingeschränkt) | error (geht nicht) | info (optional/aus).
 * `fix` ist ein Lösungs-Knopf: { label, url } öffnet eine Seite, { label, action } springt in JARVIS.
 * Nichts wird verändert; nur lesende Testanfragen (Gemini: eine Mini-Anfrage).
 */
const FIX_RE = /\s*⟨fix:([^|⟩]+)\|([^⟩]+)⟩/;
function splitFix(msg) {
  const m = String(msg || '').match(FIX_RE);
  if (!m) return { detail: String(msg || ''), fix: null };
  const target = m[2].trim();
  return { detail: String(msg).replace(m[0], ''), fix: target.startsWith('action:') ? { label: m[1].trim(), action: target.slice(7) } : { label: m[1].trim(), url: target } };
}
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what}: keine Antwort nach ${ms / 1000} s`)), ms))]);

async function runDiagnostics(s, { live = true } = {}) {
  const out = [];
  const check = async (id, name, fn, { optional = false } = {}) => {
    const t0 = Date.now();
    try {
      const r = (await fn()) || {};
      out.push({ id, name, status: r.status || 'ok', detail: r.detail || 'OK', fix: r.fix || null, ms: Date.now() - t0, ok: (r.status || 'ok') !== 'error' });
    } catch (e) {
      const { detail, fix } = splitFix(friendlyError(e));
      out.push({ id, name, status: optional ? 'warn' : 'error', detail, fix, ms: Date.now() - t0, ok: false });
    }
  };

  // ---- Grundlagen
  await check('db', 'Datenbank', () => ({ detail: 'Schema v' + s.db.version + ', ' + s.db.get('PRAGMA quick_check').quick_check }));
  await check('secrets', 'Sichere Schlüsselablage', () => (s.secrets.available() ? { detail: 'Windows-DPAPI aktiv' } : { status: 'warn', detail: 'Schlüssel werden nicht mit Windows verschlüsselt (nur auf Windows verfügbar).' }));
  await check('disk', 'Speicherplatz', () => {
    let free = null;
    try { const st = fs.statfsSync(s.paths.data); free = (st.bavail * st.bsize) / 1024 ** 3; } catch { /* ältere Node-Version */ }
    if (free == null) return { status: 'info', detail: 'nicht ermittelbar' };
    return free < 1 ? { status: 'warn', detail: `Nur noch ${free.toFixed(1)} GB frei – Sicherungen und Index könnten fehlschlagen.` } : { detail: `${free.toFixed(0)} GB frei` };
  });

  // ---- Gemini
  await check('gemini', 'Gemini (KI)', async () => {
    if (!s.gemini.hasKey()) return { status: 'error', detail: 'Kein Gemini-API-Schlüssel hinterlegt.', fix: { label: 'Schlüssel eintragen', action: 'settings' } };
    const model = s.gemini.model('fast');
    if (!model) return { status: 'error', detail: 'Kein passendes Modell gefunden – Modellprüfung ausführen.', fix: { label: 'Einstellungen', action: 'settings' } };
    if (!live) return { detail: model };
    try {
      await withTimeout(s.gemini.client().models.generateContent({ model, contents: [{ role: 'user', parts: [{ text: 'Antworte nur mit OK.' }] }], config: { maxOutputTokens: 5, temperature: 0 } }), 20000, 'Gemini');
      return { detail: `${model} antwortet` };
    } catch (e) {
      const { detail, fix } = splitFix(friendlyError(e));
      return { status: isPayment(e) || /API key|abgelehnt/i.test(detail) ? 'error' : isQuota(e) ? 'warn' : 'error', detail, fix: fix || { label: 'AI Studio öffnen', url: 'https://aistudio.google.com/' } };
    }
  });

  // ---- Google
  const g = s.settings.get('google') || {};
  const scopes = g.scopes || [];
  const study = s.settings.get('study') || {};
  const backup = s.settings.get('backupDrive') || {};
  const needDrive = (study.enabled && study.source === 'drive') || backup.enabled;
  await check('google', 'Google-Konto', () => (s.google.isConnected() ? { detail: g.account ? `verbunden als ${g.account}` : 'verbunden' } : { status: needDrive ? 'error' : 'info', detail: 'Nicht verbunden – Kalender-Sync, Drive und Backup sind aus.', fix: { label: 'Google verbinden', action: 'settings' } }));
  if (s.google.isConnected()) {
    await check('gcal', 'Google Kalender', async () => {
      if (!live) return { detail: 'verbunden' };
      await withTimeout(s.google.api('GET', '/users/me/calendarList', { query: { maxResults: 1 } }), 15000, 'Google Kalender');
      const err = s.calendar.status?.().error;
      return err ? { status: 'warn', ...splitFix(err) } : { detail: 'erreichbar' };
    });
    if (needDrive) {
      await check('gdrive', 'Google Drive', async () => {
        if (!scopes.some((x) => /auth\/drive/.test(x))) return { status: 'error', detail: 'JARVIS hat noch keinen Drive-Zugriff.', fix: { label: 'Google neu verbinden', action: 'settings' } };
        if (!live) return { detail: 'Zugriff erteilt' };
        await withTimeout(s.google.api('GET', '/files', { query: { pageSize: 1, fields: 'files(id)' } }, 'https://www.googleapis.com/drive/v3'), 15000, 'Google Drive');
        return { detail: 'erreichbar' };
      });
    }
  }
  if (backup.enabled) {
    await check('backup', 'Drive-Backup', () => {
      const st = s.driveBackup.status();
      if (!st.granted) return { status: 'error', detail: 'Kein Schreibzugriff auf Drive – „Drive-Backup aktivieren“ erneut klicken.', fix: { label: 'Zu den Einstellungen', action: 'settings' } };
      if (st.lastError) return { status: 'warn', ...splitFix(st.lastError) };
      return { detail: st.lastSuccess ? `letzte Sicherung ${new Date(st.lastSuccess).toLocaleString('de-DE')}` : 'noch keine Sicherung' };
    });
  }
  if (study.enabled) {
    await check('study', 'Studienunterlagen', () => {
      if (study.source === 'drive') return s.study.enabled() ? { detail: `Drive-Ordner „${study.driveFolder || 'Goodnotes'}“` } : { status: 'warn', detail: 'Drive-Quelle gewählt, aber kein Drive-Zugriff.', fix: { label: 'Einstellungen', action: 'settings' } };
      return s.study.checkFolder(s.study.root()).ok ? { detail: 'Ordner lesbar' } : { status: 'error', detail: 'Studienordner nicht lesbar – Pfad prüfen.', fix: { label: 'Einstellungen', action: 'settings' } };
    });
  }

  // ---- Kalender-Abos
  for (const f of s.feeds.list()) {
    await check('feed:' + f.id, `Kalender-Abo „${f.name}“`, () => (f.error ? { status: 'error', ...splitFix(f.error), fix: splitFix(f.error).fix || { label: 'Zum Kalender', action: 'calendar' } } : { detail: `${f.events} Termine${f.lastFetch ? ', aktualisiert ' + new Date(f.lastFetch).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : ''}` }));
  }

  // ---- Gaming
  await check('league', 'League of Legends', async () => {
    const L = s.gaming.league;
    const n = s.db.get('SELECT COUNT(*) c FROM lol_matches').c;
    const client = await L.lcuCreds().catch(() => null);
    if (client) return { detail: `Client läuft · ${n} Ranked-Spiele gespeichert` };
    return { status: 'info', detail: n ? `Client nicht offen · ${n} Ranked-Spiele gespeichert (Analyse geht trotzdem)` : 'Noch keine Matches – einmal den League-Client starten.' };
  }, { optional: true });
  if (process.platform === 'win32') {
    await check('steam', 'Steam', async () => ((await s.gaming.steam.root()) ? { detail: 'Bibliothek gefunden' } : { status: 'info', detail: 'Steam nicht gefunden – falls installiert, Ordner unter Gaming eintragen.', fix: { label: 'Einstellungen', action: 'settings' } }), { optional: true });
  }

  // ---- Updates
  await check('updates', 'Updates', async () => {
    const u = s.updater;
    if (!u.configured()) return { status: 'warn', detail: 'Keine Update-Quelle eingerichtet.', fix: { label: 'Einstellungen', action: 'settings' } };
    if (!s.updatePublicKey && !u.s.updatePublicKey) return { status: 'warn', detail: 'Kein Signaturschlüssel eingebaut – Updates können nicht geprüft werden.' };
    if (!live) return { detail: u.repo() || 'eingerichtet' };
    await withTimeout(u.check({ silent: true }), 20000, 'Update-Prüfung');
    const r = u.public();
    if (r.state === 'error') return { status: 'warn', ...splitFix(r.error || 'Update-Prüfung fehlgeschlagen') };
    return { detail: r.state === 'available' ? `Version ${r.version} verfügbar` : `aktuell (${s.version})` };
  });

  // ---- Lokale Sicherung
  await check('localbackup', 'Lokale Sicherung', () => {
    const dir = path.join(s.paths.data, 'backups', 'auto');
    let newest = null;
    try { for (const f of fs.readdirSync(dir)) { const t = fs.statSync(path.join(dir, f)).mtimeMs; if (!newest || t > newest) newest = t; } } catch { /* noch keine */ }
    if (!newest) return { status: 'info', detail: 'Noch keine automatische Sicherung (erfolgt täglich).' };
    const days = (Date.now() - newest) / 86400000;
    return days > 3 ? { status: 'warn', detail: `Letzte Sicherung vor ${Math.floor(days)} Tagen.` } : { detail: 'letzte ' + new Date(newest).toLocaleDateString('de-DE') };
  });
  return out;
}

module.exports = { runDiagnostics, splitFix };
