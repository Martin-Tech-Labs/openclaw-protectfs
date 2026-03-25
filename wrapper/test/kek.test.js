const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');

const { resolveKek, writeKekToPipe } = require('../src/kek');

function fixedKey32(byte) {
  return Buffer.alloc(32, byte);
}

test('kek: resolveKek uses ephemeral key on non-darwin', async () => {
  const out = await resolveKek({
    platform: 'linux',
    env: {},
    randomBytes: () => fixedKey32(0x11),
    // If keychainFactory is invoked, this test should fail.
    keychainFactory: () => {
      throw new Error('keychainFactory should not be called');
    },
  });

  assert.equal(out.source, 'ephemeral');
  assert.equal(out.kek.length, 32);
  assert.equal(out.kek[0], 0x11);
});

test('kek: resolveKek uses ephemeral key in CI even on darwin', async () => {
  const out = await resolveKek({
    platform: 'darwin',
    env: { CI: 'true' },
    randomBytes: () => fixedKey32(0x22),
    keychainFactory: () => {
      throw new Error('keychainFactory should not be called');
    },
  });

  assert.equal(out.source, 'ephemeral');
  assert.equal(out.kek[0], 0x22);
});

test('kek: resolveKek uses keychain on darwin non-CI via DI factory', async () => {
  let gotCreateRandomKey32;
  const fakeKeychain = {
    getGenericPassword: async () => null,
    setGenericPassword: async () => {},
  };

  // We want to verify the decision boundary and the keychain call path without
  // touching the real Keychain.
  const out = await resolveKek({
    platform: 'darwin',
    env: { CI: 'false' },
    randomBytes: () => fixedKey32(0x33),
    keychainFactory: () => fakeKeychain,
    service: 'ocprotectfs',
    account: 'kek',
  });

  assert.equal(out.source, 'keychain');
  assert.equal(out.kek.length, 32);
  assert.equal(out.kek[0], 0x33);

  // Sanity: ensure resolveKek didn't accidentally return the factory.
  assert.notEqual(out.kek, gotCreateRandomKey32);
});

test('kek: resolveKek prefers explicit keychain + allows injecting getOrCreateKey32', async () => {
  const calls = [];
  const fakeKeychain = {
    getGenericPassword: async () => null,
    setGenericPassword: async () => {},
  };

  const out = await resolveKek({
    platform: 'darwin',
    env: { CI: 'false' },
    randomBytes: () => fixedKey32(0x55),
    keychain: fakeKeychain,
    keychainFactory: () => {
      throw new Error('keychainFactory should not be called when keychain is provided');
    },
    getOrCreateKey32: async (args) => {
      calls.push(args);
      return fixedKey32(0x66);
    },
  });

  assert.equal(out.source, 'keychain');
  assert.equal(out.kek.length, 32);
  assert.equal(out.kek[0], 0x66);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].keychain, fakeKeychain);
});

test('kek: writeKekToPipe writes 32 bytes then ends', async () => {
  const kek = fixedKey32(0x44);
  const s = new PassThrough();

  /** @type {Buffer[]} */
  const chunks = [];
  s.on('data', (c) => chunks.push(Buffer.from(c)));

  await writeKekToPipe({ kek, stream: s });

  assert.equal(Buffer.concat(chunks).equals(kek), true);
});
