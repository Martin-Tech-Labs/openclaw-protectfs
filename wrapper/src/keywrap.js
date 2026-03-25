const crypto = require('node:crypto');

// V2 scaffolding: wrap/unwrap a 32-byte KEK via an asymmetric key.
//
// Goal (Issue #78): use a macOS Keychain / Secure Enclave non-exportable private
// key to unwrap the KEK, so the raw KEK never needs to be stored exportably.
//
// This module intentionally keeps the interface small and testable; platform-
// specific key management (Secure Enclave) will live behind a separate adapter.

function _assertKey32(name, buf) {
  if (!Buffer.isBuffer(buf)) throw new Error(`${name} must be a Buffer`);
  if (buf.length !== 32) throw new Error(`${name} must be 32 bytes`);
}

function parseWrappedKekV2(wrapped) {
  if (!Buffer.isBuffer(wrapped)) throw new Error('wrapped must be a Buffer');

  if (wrapped.length < 4 + 1 + 2) throw new Error('wrapped too short');
  const magic = wrapped.subarray(0, 4).toString('utf8');
  if (magic !== 'OCKW') throw new Error('wrapped: bad magic');
  const ver = wrapped.readUInt8(4);
  if (ver !== 0x02) throw new Error(`wrapped: unsupported version ${ver}`);
  const ctLen = wrapped.readUInt16BE(5);
  const ct = wrapped.subarray(7);
  if (ct.length !== ctLen) throw new Error('wrapped: length mismatch');

  return { ver, ciphertext: ct };
}

/**
 * Wrap a 32-byte KEK using RSA-OAEP-SHA256.
 *
 * @param {Object} args
 * @param {Buffer} args.kek 32-byte key encryption key
 * @param {string|Buffer|crypto.KeyObject} args.publicKey Public key (PEM or KeyObject)
 * @returns {Buffer} opaque wrapped bytes
 */
function wrapKekV2({ kek, publicKey }) {
  _assertKey32('kek', kek);
  if (!publicKey) throw new Error('publicKey required');

  const ct = crypto.publicEncrypt(
    {
      key: publicKey,
      oaepHash: 'sha256',
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    },
    kek,
  );

  // Simple binary envelope:
  // [ 'O' 'C' 'K' 'W' ] [0x02] [lenBE16] [ciphertext]
  const magic = Buffer.from('OCKW');
  const ver = Buffer.from([0x02]);
  if (ct.length > 0xffff) throw new Error('ciphertext too large');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(ct.length, 0);
  return Buffer.concat([magic, ver, len, ct]);
}

/**
 * Unwrap a 32-byte KEK using RSA-OAEP-SHA256.
 *
 * @param {Object} args
 * @param {Buffer} args.wrapped Wrapped bytes created by wrapKekV2
 * @param {string|Buffer|crypto.KeyObject} args.privateKey Private key (PEM or KeyObject)
 * @returns {Buffer} kek 32-byte Buffer
 */
function unwrapKekV2({ wrapped, privateKey }) {
  const { ciphertext: ct } = parseWrappedKekV2(wrapped);
  if (!privateKey) throw new Error('privateKey required');

  const kek = crypto.privateDecrypt(
    {
      key: privateKey,
      oaepHash: 'sha256',
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    },
    ct,
  );

  _assertKey32('kek', kek);
  return kek;
}

module.exports = {
  parseWrappedKekV2,
  wrapKekV2,
  unwrapKekV2,
};
