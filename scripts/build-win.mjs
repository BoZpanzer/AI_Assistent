// Windows release build (runs on Windows AND cross-builds on Linux/macOS):
// 1. electron-builder → release/win-unpacked (JARVIS.exe + runtime)
// 2. resedit → embed icon + version info into JARVIS.exe (no Wine needed)
// 3. makensis → release/JARVIS_Setup.exe (per-user installer with uninstaller)
// 4. SHA-256 + update manifest template
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const out = path.join(root, 'release');
const unpacked = path.join(out, 'win-unpacked');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });

fs.rmSync(unpacked, { recursive: true, force: true });
console.log('▶ electron-builder (win x64, dir)');
run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['electron-builder', '--win', '--x64', '--dir', '--publish', 'never'], { shell: process.platform === 'win32' });

const exe = path.join(unpacked, 'JARVIS.exe');
if (!fs.existsSync(exe)) throw new Error('JARVIS.exe wurde nicht erzeugt');

console.log('▶ Icon & Versionsinfo einbetten (resedit)');
const ResEdit = require('resedit');
const data = fs.readFileSync(exe);
const exeObj = ResEdit.NtExecutable.from(data, { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exeObj);
const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(root, 'build', 'icon.ico')));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const groupId = groups.length ? groups[0].id : 1;
const lang = groups.length ? groups[0].lang : 1033;
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, iconFile.icons.map((i) => i.data));
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] || ResEdit.Resource.VersionInfo.createEmpty();
const [a, b, c] = pkg.version.split('.').map(Number);
vi.setFileVersion(a, b, c, 0, 1033);
vi.setProductVersion(a, b, c, 0, 1033);
vi.setStringValues({ lang: 1033, codepage: 1200 }, {
  ProductName: 'JARVIS', FileDescription: 'JARVIS – Personal Intelligence System', CompanyName: 'BoZ', LegalCopyright: '© 2026 BoZ',
  OriginalFilename: 'JARVIS.exe', InternalName: 'JARVIS', FileVersion: pkg.version, ProductVersion: pkg.version,
});
vi.outputToResourceEntries(res.entries);
res.outputResource(exeObj);
fs.writeFileSync(exe, Buffer.from(exeObj.generate()));

console.log('▶ Installer (NSIS)');
const makensis = process.platform === 'win32' ? findWinMakensis() : 'makensis';
const setup = path.join(out, 'JARVIS_Setup.exe');
fs.rmSync(setup, { force: true });
run(makensis, ['-V2', '-INPUTCHARSET', 'UTF8', `-DVERSION=${pkg.version}`, `-DSRCDIR=${unpacked}`, `-DOUTFILE=${setup}`, path.join(root, 'build', 'installer.nsi')], { cwd: path.join(root, 'build') });

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const sums = { 'JARVIS.exe': sha(exe), 'JARVIS_Setup.exe': sha(setup) };
fs.writeFileSync(path.join(out, 'SHA256SUMS.txt'), Object.entries(sums).map(([f, h]) => `${h}  ${f}`).join('\n') + '\n');
fs.writeFileSync(path.join(out, 'update-channel.example.json'), JSON.stringify({ version: pkg.version, url: 'https://example.com/JARVIS_Setup.exe', sha256: sums['JARVIS_Setup.exe'], notes: 'Release ' + pkg.version, signature: '<ed25519-Signatur, siehe docs/UPDATES.md>' }, null, 2));
const mb = (f) => (fs.statSync(f).size / 1048576).toFixed(1) + ' MB';
console.log(`✔ ${exe} (${mb(exe)})\n✔ ${setup} (${mb(setup)})`);

function findWinMakensis() {
  const cands = [process.env.MAKENSIS, 'C:\\Program Files (x86)\\NSIS\\makensis.exe', 'C:\\Program Files\\NSIS\\makensis.exe'].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  return 'makensis';
}
