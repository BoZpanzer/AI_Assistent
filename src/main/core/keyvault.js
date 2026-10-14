'use strict';
const crypto = require('node:crypto');

/**
 * Schlüssel-Sicherung mit eigenem Passwort (für Backups und den Umzug auf einen anderen PC).
 * Windows-DPAPI-Daten sind nur auf demselben Windows-Konto lesbar; diese Datei dagegen mit dem
 * Backup-Passwort überall. Verfahren: scrypt (N=2^15, r=8, p=1) → AES-256-GCM. Ohne Passwort wertlos.
 * Nicht enthalten: kurzlebige Sitzungen (z. B. Campus-Dual-Cookies) und das Backup-Passwort selbst.
 */
const EXCLUDE = /^(backup\.password|campusdual\.cookies)$/;
const KDF = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new Error('Das Backup-Passwort braucht mindestens 8 Zeichen.');
  if (pw.length > 200) throw new Error('Passwort zu lang');
}

function seal(secrets, password) {
  checkPassword(password);
  const data = Object.fromEntries(Object.entries(secrets || {}).filter(([k, v]) => !EXCLUDE.test(k) && typeof v === 'string' && v));
  const salt = crypto.randomBytes(16); const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32, KDF);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(data), 'utf8'), c.final()]);
  return { app: 'JARVIS', kind: 'keys', v: 1, kdf: 'scrypt', N: KDF.N, r: KDF.r, p: KDF.p, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: enc.toString('base64'), count: Object.keys(data).length, created: new Date().toISOString() };
}

function open(bundle, password) {
  const b = typeof bundle === 'string' ? JSON.parse(bundle) : bundle;
  if (!b || b.app !== 'JARVIS' || b.kind !== 'keys' || b.v !== 1) throw new Error('Keine JARVIS-Schlüsseldatei');
  if (typeof password !== 'string' || !password) throw new Error('Passwort fehlt');
  const key = crypto.scryptSync(password, Buffer.from(b.salt, 'base64'), 32, { N: b.N || KDF.N, r: b.r || 8, p: b.p || 1, maxmem: KDF.maxmem });
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(b.iv, 'base64'));
  d.setAuthTag(Buffer.from(b.tag, 'base64'));
  let txt;
  try { txt = Buffer.concat([d.update(Buffer.from(b.data, 'base64')), d.final()]).toString('utf8'); } catch { throw new Error('Falsches Backup-Passwort (oder Datei beschädigt).'); }
  return JSON.parse(txt);
}

module.exports = { seal, open, checkPassword, EXCLUDE };
