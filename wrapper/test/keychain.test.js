const test = require('node:test');
const assert = require('node:assert/strict');

const { InMemoryKeychain, getOrCreateKey32 } = require('../lib/keychain');

function fixedKey32(byte) {
  return Buffer.alloc(32, byte);
}

test('keychain: getOrCreateKey32 creates then returns existing', async () => {
  const kc = new InMemoryKeychain();

  const k1 = await getOrCreateKey32({
    keychain: kc,
    service: 'ocprotectfs',
    account: 'kek',
    createRandomKey32: () => fixedKey32(0x11),
  });

  const k2 = await getOrCreateKey32({
    keychain: kc,
    service: 'ocprotectfs',
    account: 'kek',
    createRandomKey32: () => fixedKey32(0x22),
  });

  assert.equal(k1.length, 32);
  assert.equal(k2.length, 32);
  assert.equal(k1.equals(k2), true);
  assert.equal(k1[0], 0x11);
});

test('keychain: getOrCreateKey32 rejects wrong length existing', async () => {
  const kc = new InMemoryKeychain();
  await kc.setGenericPassword({ service: 'ocprotectfs', account: 'kek', secret: Buffer.from('short') });

  await assert.rejects(
    () =>
      getOrCreateKey32({
        keychain: kc,
        service: 'ocprotectfs',
        account: 'kek',
        createRandomKey32: () => fixedKey32(0x33),
      }),
    /wrong length/,
  );
});
