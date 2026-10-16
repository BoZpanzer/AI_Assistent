'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

test('release version is consistent across npm package, lockfile and changelog', () => {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const changelog = read('CHANGELOG.md');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.match(changelog, new RegExp('^## ' + pkg.version.replace(/\./g, '\\.') + '(?:\\s|$)', 'm'),
    'update dialog must have useful release notes for this version');
});

test('release pipeline validates bundled offline speech after installation before publishing', () => {
  const flow = read('.github/workflows/release.yml');
  const testIndex = flow.indexOf('name: Installer installieren, starten und deinstallieren');
  const signingIndex = flow.indexOf('name: Update-Manifest signieren');
  const publishIndex = flow.indexOf('name: GitHub-Release veröffentlichen');
  assert.ok(testIndex > 0 && signingIndex > testIndex && publishIndex > signingIndex,
    'release cannot be published until install/uninstall smoke and signing succeed');
  assert.match(flow, /Test-Path "\$dir\\resources\\voice\\whisper-cli\.exe"/);
  assert.match(flow, /Test-Path "\$dir\\resources\\voice\\ggml-base\.bin"/);
  assert.match(flow, /--smoke/);
  assert.match(flow, /SHA256/i);
  assert.match(flow, /scripts\/sign-update\.mjs/);
});
