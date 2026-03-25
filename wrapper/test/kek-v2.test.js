const assert = require('node:assert');
const test = require('node:test');
const crypto = require('node:crypto');

const { InMemoryKeychain } = require('../src/keychain');
const { resolveKekV2 } = require('../src/kek-v2');

function makeAdapter({ privateKey, publicKeyPem }) {
  return {
    ensureKeypair: async () => ({ publicKeyPem }),
    decrypt: async ({ ciphertext }) => {
      const pt = crypto.privateDecrypt(
        {
          key: privateKey,
          oaepHash: 'sha256',
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        },
        ciphertext,
      );
      return pt;
    },
  };
}

test('resolveKekV2: creates random KEK, stores wrapped, then can re-resolve', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const keywrap = makeAdapter({ privateKey, publicKeyPem });

  const keychain = new InMemoryKeychain();

  const a = await resolveKekV2({ keychain, keywrap, service: 'svc', accountWrapped: 'acc', keyTag: 'tag' });
  assert.strictEqual(a.source, 'keychain-wrapped');
  assert.strictEqual(a.kek.length, 32);

  const b = await resolveKekV2({ keychain, keywrap, service: 'svc', accountWrapped: 'acc', keyTag: 'tag' });
  assert.deepStrictEqual(b.kek, a.kek);
});

