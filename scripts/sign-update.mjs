// Signiert ein Release: erzeugt release/update.json für den In-App-Updater.
// Aufruf (CI): UPDATE_PRIVATE_KEY="<PEM>" node scripts/sign-update.mjs
// Prüft die Signatur anschließend mit build/update-public-key.pem gegen –
// passt der private Schlüssel nicht zum eingebauten öffentlichen, bricht der Build ab.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const file = 'JARVIS_Setup.exe';
const setup = path.join(root, 'release', file);
const key = process.env.UPDATE_PRIVATE_KEY;
if (!key || !key.includes('PRIVATE KEY')) { console.error('✖ UPDATE_PRIVATE_KEY fehlt (GitHub → Settings → Secrets → Actions).'); process.exit(1); }
if (!fs.existsSync(setup)) { console.error('✖ ' + setup + ' fehlt – erst „npm run dist:win“.'); process.exit(1); }

const buf = fs.readFileSync(setup);
const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
const version = pkg.version;
const msg = Buffer.from(`jarvis-update\n${version}\n${sha256}\n${file}`);
const signature = crypto.sign(null, msg, crypto.createPrivateKey(key)).toString('base64');

const pubFile = path.join(root, 'build', 'update-public-key.pem');
if (!fs.existsSync(pubFile)) { console.error('✖ build/update-public-key.pem fehlt – ohne ihn kann die App Updates nicht prüfen.'); process.exit(1); }
if (!crypto.verify(null, msg, fs.readFileSync(pubFile, 'utf8'), Buffer.from(signature, 'base64'))) {
  console.error('✖ Privater Schlüssel passt NICHT zu build/update-public-key.pem.'); process.exit(1);
}

// Release-Notizen aus CHANGELOG.md („## 3.3.0 …“ bis zur nächsten „## “-Überschrift)
let notes = '';
try {
  const cl = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const m = cl.match(new RegExp(`^## \\[?${version.replace(/\./g, '\\.')}\\]?[^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'));
  notes = (m?.[1] || '').trim();
} catch { /* optional */ }

const manifest = { version, file, sha256, size: buf.length, notes, signature, created: new Date().toISOString() };
fs.writeFileSync(path.join(root, 'release', 'update.json'), JSON.stringify(manifest, null, 2));
fs.writeFileSync(path.join(root, 'release', 'RELEASE_NOTES.md'), (notes || `JARVIS ${version}`) + `\n\n---\nSHA-256 (JARVIS_Setup.exe): \`${sha256}\`\n`);
console.log(`✔ update.json für ${version} signiert (${(buf.length / 1048576).toFixed(1)} MB, sha256 ${sha256.slice(0, 12)}…)`);
