const crypto = require('node:crypto');

const { MacOSSecurityCliKeychain, getOrCreateKey32 } = require('./keychain');

/**
 * Resolve the KEK (Key Encryption Key) to use for this run.
 *
 * Production target is macOS (darwin) in a real interactive user session.
 * In CI and on non-darwin platforms, we intentionally avoid Keychain and use an
 * ephemeral random KEK to keep tests non-interactive and deterministic.
 *
 * Dependency-injection friendly so tests can cover the decision logic without
 * spawning real processes or touching the real Keychain.
 *
 * @param {Object} args
 * @param {string} [args.platform] e.g. process.platform
 * @param {Object} [args.env] e.g. process.env
 * @param {(n:number)=>Buffer} [args.randomBytes] crypto.randomBytes-like
 *
 * // Keychain DI options:
 * @param {{getGenericPassword: Function, setGenericPassword: Function}} [args.keychain] Explicit keychain instance (preferred in tests)
 * @param {()=>({getGenericPassword: Function, setGenericPassword: Function})} [args.keychainFactory] Factory for production/advanced tests
 * @param {typeof getOrCreateKey32} [args.getOrCreateKey32] Override for tests (spy/mocking)
 *
 * @param {string} [args.service]
 * @param {string} [args.account]
 * @returns {Promise<{kek: Buffer, source: 'ephemeral'|'keychain'}>}
 */
async function resolveKek(args = {}) {
  const platform = args.platform || process.platform;
  const env = args.env || process.env;
  const randomBytes = args.randomBytes || crypto.randomBytes;
  const service = args.service || 'ocprotectfs';
  const account = args.account || 'kek';

  // Keep CI deterministic and non-interactive.
  // - Linux CI isn't the production target.
  // - GitHub-hosted macOS runners generally cannot access an interactive user Keychain.
  if (platform !== 'darwin' || env.CI === 'true') {
    return { kek: randomBytes(32), source: 'ephemeral' };
  }

  const getOrCreate = args.getOrCreateKey32 || getOrCreateKey32;

  let keychain = args.keychain;
  if (!keychain) {
    const keychainFactory =
      args.keychainFactory ||
      (() => {
        return new MacOSSecurityCliKeychain();
      });
    keychain = keychainFactory();
  }

  const kek = await getOrCreate({
    keychain,
    service,
    account,
    createRandomKey32: () => randomBytes(32),
  });

  return { kek, source: 'keychain' };
}

/**
 * Write the KEK to the FUSE child over a dedicated pipe.
 *
 * @param {Object} args
 * @param {Buffer} args.kek
 * @param {import('node:stream').Writable} args.stream
 * @param {(msg: string)=>void} [args.log]
 */
async function writeKekToPipe({ kek, stream, log }) {
  if (!Buffer.isBuffer(kek) || kek.length !== 32) throw new Error('kek must be a 32-byte Buffer');
  if (!stream || typeof stream.write !== 'function') throw new Error('missing KEK pipe stream');

  // Swallow pipe errors that can occur during teardown.
  if (typeof stream.on === 'function') {
    stream.on('error', (err) => {
      if (typeof log === 'function') log(`kek: pipe error (ignored): ${err && err.code ? err.code : err.message}`);
    });
  }

  await new Promise((resolve, reject) => {
    stream.write(kek, (e) => (e ? reject(e) : resolve()));
  });

  if (typeof stream.end === 'function') {
    await new Promise((resolve) => stream.end(resolve));
  }
}

module.exports = {
  resolveKek,
  writeKekToPipe,
};
