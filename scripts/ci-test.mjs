// Runs the test suite and, on failure, reports each failing test as a GitHub
// Actions annotation (visible in the run summary without opening logs).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = fs.readdirSync(path.join(root, 'tests')).filter((f) => /\.test\.m?js$/.test(f)).map((f) => path.join('tests', f));
const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const out = (r.stdout || '') + (r.stderr || '');
process.stdout.write(out);
if (r.status !== 0 && process.env.GITHUB_ACTIONS) {
  const lines = out.split(/\r?\n/);
  let n = 0;
  for (let i = 0; i < lines.length && n < 10; i++) {
    const m = lines[i].match(/^\s*not ok \d+ - (.*)$/);
    if (!m) continue;
    const detail = lines.slice(i + 1, i + 40).join('\n').split(/\n\s*\.\.\.\s*\n/)[0];
    const msg = (detail.match(/error: \|?-?\s*([\s\S]*?)\n\s+code:/)?.[1] || detail).replace(/\s+/g, ' ').slice(0, 900);
    console.log(`::error title=${m[1].replace(/[:,]/g, ' ').slice(0, 120)}::${msg.replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}`);
    n++;
  }
}
process.exit(r.status ?? 1);
