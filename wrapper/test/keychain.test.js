const test = require('node:test');
const assert = require('node:assert/strict');

const { InMemoryKeychain, MacOSSecurityCliKeychain, getOrCreateKey32 } = require('../src/keychain');

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

test('keychain: MacOSSecurityCliKeychain get/set round-trip via injected exec + darwin platform', async () => {
  const calls = [];
  /** @type {Map<string, Buffer>} */
  const store = new Map();

  const execFileSync = (bin, args, opts) => {
    calls.push({ bin, args, opts });

    if (args[0] === 'add-generic-password') {
      const sIdx = args.indexOf('-s');
      const aIdx = args.indexOf('-a');
      const wIdx = args.indexOf('-w');
      const service = args[sIdx + 1];
      const account = args[aIdx + 1];
      const encoded = args[wIdx + 1];
      store.set(`${service}::${account}`, Buffer.from(encoded, 'utf8'));
      return Buffer.from('');
    }

    if (args[0] === 'find-generic-password') {
      const sIdx = args.indexOf('-s');
      const aIdx = args.indexOf('-a');
      const service = args[sIdx + 1];
      const account = args[aIdx + 1];
      const encoded = store.get(`${service}::${account}`);
      if (!encoded) {
        const err = new Error('not found');
        err.code = 44;
        throw err;
      }
      return Buffer.from(encoded);
    }

    throw new Error(`unexpected security args: ${args.join(' ')}`);
  };

  const kc = new MacOSSecurityCliKeychain({
    securityBin: '/bin/security',
    execFileSync,
    platform: () => 'darwin',
  });

  const secret = Buffer.from('hello\u0000world', 'utf8');
  await kc.setGenericPassword({ service: 'ocprotectfs', account: 'kek', secret });

  const out = await kc.getGenericPassword({ service: 'ocprotectfs', account: 'kek' });
  assert.equal(Buffer.isBuffer(out), true);
  assert.equal(out.toString('utf8'), secret.toString('utf8'));

  // Ensure we invoked the security CLI in the expected way.
  assert.equal(calls[0].bin, '/bin/security');
  assert.equal(calls[0].args[0], 'add-generic-password');
  assert.equal(calls[1].args[0], 'find-generic-password');
});

test('keychain: MacOSSecurityCliKeychain returns null when missing item', async () => {
  const execFileSync = () => {
    const err = new Error('not found');
    err.code = 44;
    throw err;
  };

  const kc = new MacOSSecurityCliKeychain({ execFileSync, platform: 'darwin' });
  const out = await kc.getGenericPassword({ service: 'ocprotectfs', account: 'missing' });
  assert.equal(out, null);
});

test('keychain: MacOSSecurityCliKeychain refuses non-darwin platform', async () => {
  const kc = new MacOSSecurityCliKeychain({ platform: 'linux' });
  await assert.rejects(
    () => kc.getGenericPassword({ service: 'ocprotectfs', account: 'kek' }),
    /requires macOS/,
  );
});
