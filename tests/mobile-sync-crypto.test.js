'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { encode, decode } = require('../src/main/core/mobile-sync-crypto');
test('encrypted settings and knowledge roundtrip without plaintext leakage', () => {
  const password = 'correct horse battery staple';
  for (const type of ['knowledge', 'settings']) {
    const original = { value: 'sehr privat', list: [1, 2] };
    const sealed = encode(type, original, password);
    assert.ok(!JSON.stringify(sealed).includes('sehr privat'));
    assert.deepEqual(decode(sealed, password, type), original);
    assert.throws(() => decode(sealed, 'wrong-password-long', type));
    assert.throws(() => decode(sealed, password, type === 'knowledge' ? 'settings' : 'knowledge'));
    const tampered = { ...sealed, ciphertext: Buffer.from('corrupt').toString('base64') };
    assert.throws(() => decode(tampered, password, type));
  }
});
test('sync envelope validates password, types and sizes', () => {
  assert.throws(() => encode('knowledge', {}, 'short'));
  assert.throws(() => encode('secrets', {}, 'correct horse battery staple'));
  assert.throws(() => encode('settings', { value: 'x'.repeat(9 * 1024 * 1024) }, 'correct horse battery staple'));
});
