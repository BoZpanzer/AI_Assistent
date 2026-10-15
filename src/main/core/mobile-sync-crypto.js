'use strict';
const crypto = require('node:crypto');

// Cross-platform v1 envelope. Deliberately separate from full SQLite backups.
// PBKDF2-SHA256 is supported by iOS CommonCrypto; AES-GCM by CryptoKit.
// Always use a unique random salt and nonce; authenticated metadata prevents swapping types.
const ITERATIONS = 600000;
const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = new Set(['knowledge', 'settings', 'calendar', 'daily']);
function derive(password, salt) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new Error('Sync-Passwort muss mindestens 12 Zeichen haben');
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
}
function encode(type, data, password) {
  if (!TYPES.has(type)) throw new Error('Ungültiger Synchronisationsbereich');
  const raw = Buffer.from(JSON.stringify(data), 'utf8');
  if (raw.length > MAX_BYTES) throw new Error('Sync-Daten zu groß');
  const salt = crypto.randomBytes(16), nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', derive(password, salt), nonce);
  const aad = Buffer.from('JARVIS-SYNC-v1:' + type);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(raw), cipher.final()]);
  return { app: 'JARVIS', version: 1, type, kdf: 'PBKDF2-HMAC-SHA256', iterations: ITERATIONS,
    cipher: 'AES-256-GCM', salt: salt.toString('base64'), nonce: nonce.toString('base64'),
    ciphertext: encrypted.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}
function decode(bundle, password, expectedType) {
  if (!bundle || bundle.app !== 'JARVIS' || bundle.version !== 1 || !TYPES.has(bundle.type) ||
      bundle.type !== expectedType || bundle.kdf !== 'PBKDF2-HMAC-SHA256' ||
      bundle.iterations !== ITERATIONS || bundle.cipher !== 'AES-256-GCM') throw new Error('Ungültiges Sync-Format');
  for (const [name, size] of [['salt', 16], ['nonce', 12], ['tag', 16]]) {
    if (typeof bundle[name] !== 'string' || Buffer.from(bundle[name], 'base64').length !== size) throw new Error('Ungültiges Sync-Format');
  }
  if (typeof bundle.ciphertext !== 'string' || bundle.ciphertext.length > MAX_BYTES * 2) throw new Error('Sync-Daten zu groß');
  const decipher = crypto.createDecipheriv('aes-256-gcm', derive(password, Buffer.from(bundle.salt, 'base64')), Buffer.from(bundle.nonce, 'base64'));
  decipher.setAAD(Buffer.from('JARVIS-SYNC-v1:' + bundle.type));
  decipher.setAuthTag(Buffer.from(bundle.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(bundle.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
}
module.exports = { encode, decode, ITERATIONS };
