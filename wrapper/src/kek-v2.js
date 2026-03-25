const crypto = require('node:crypto');

const { parseWrappedKekV2, wrapKekV2 } = require('./keywrap');

function _assertKey32(name, buf) {
  if (!Buffer.isBuffer(buf)) throw new Error(`${name} must be a Buffer`);
  if (buf.length !== 32) throw new Error(`${name} must be 32 bytes`);
}

/**
 * @typedef {Object} IKeywrapAdapter
 * @property {(args:{tag:string})=>Promise<{publicKeyPem:string}>} ensureKeypair
 * @property {(args:{tag:string,ciphertext:Buffer})=>Promise<Buffer>} decrypt
 */

/**
 * Resolve KEK using keywrap v2: store wrapped KEK in Keychain, unwrap via Keychain-held private key.
 *
 * This is designed so the raw KEK does not need to be stored exportably.
 *
 * @param {Object} args
 * @param {import('./keychain').IKeychain} args.keychain
 * @param {IKeywrapAdapter} args.keywrap
 * @param {string} [args.service]
 * @param {string} [args.accountWrapped]
 * @param {string} [args.keyTag]
 * @param {(n:number)=>Buffer} [args.randomBytes]
 * @returns {Promise<{kek:Buffer, source:'keychain-wrapped'}>}
 */
async function resolveKekV2(args) {
  if (!args || !args.keychain) throw new Error('keychain required');
  if (!args.keywrap) throw new Error('keywrap adapter required');

  const keychain = args.keychain;
  const keywrap = args.keywrap;
  const randomBytes = args.randomBytes || crypto.randomBytes;

  const service = args.service || 'ocprotectfs';
  const accountWrapped = args.accountWrapped || 'kek.v2.wrapped';
  const keyTag = args.keyTag || 'ocprotectfs.kekwrap.v2';

  const existingWrapped = await keychain.getGenericPassword({ service, account: accountWrapped });
  if (existingWrapped) {
    const { ciphertext } = parseWrappedKekV2(existingWrapped);
    const kek = await keywrap.decrypt({ tag: keyTag, ciphertext });
    _assertKey32('kek', kek);
    return { kek, source: 'keychain-wrapped' };
  }

  // Create a random KEK, wrap it to the Keychain public key, store wrapped bytes.
  const { publicKeyPem } = await keywrap.ensureKeypair({ tag: keyTag });
  if (!publicKeyPem || typeof publicKeyPem !== 'string') throw new Error('keywrap.ensureKeypair must return publicKeyPem');

  const kek = randomBytes(32);
  _assertKey32('kek', kek);

  const wrapped = wrapKekV2({ kek, publicKey: publicKeyPem });
  await keychain.setGenericPassword({ service, account: accountWrapped, secret: wrapped });

  return { kek, source: 'keychain-wrapped' };
}

module.exports = {
  resolveKekV2,
};
