const crypto = require('node:crypto');
const { sealAes256Gcm, openAes256Gcm, Initial: CRYPTO_V1, randomKey32 } = require('./crypto');

// initial DEK/KEK hierarchy.
//
// - KEK: 32-byte secret stored in macOS Keychain (wrapper responsibility).
// - DEK: 32-byte secret used to encrypt file contents.
// - DEK is stored on disk only in wrapped form (encrypted under KEK).
//
// This module defines a small, versioned "wrapped DEK" format.

const Initial = {
  WRAPPED_DEK_MAGIC: Buffer.from('OCDEK1', 'utf8'),
  WRAPPED_DEK_VERSION: 0x01,
  NONCE_LEN: CRYPTO_V1.NONCE_LEN,
  TAG_LEN: CRYPTO_V1.TAG_LEN,
  DEK_LEN: 32,
};

function newDek() {
  return randomKey32();
}

function encodeWrappedDekV1({ kek, dek }) {
  if (!Buffer.isBuffer(kek) || kek.length !== 32) throw new Error('kek must be 32 bytes');
  if (!Buffer.isBuffer(dek) || dek.length !== Initial.DEK_LEN) throw new Error('dek must be 32 bytes');

  const nonce = crypto.randomBytes(Initial.NONCE_LEN);
  const header = Buffer.concat([Initial.WRAPPED_DEK_MAGIC, Buffer.from([Initial.WRAPPED_DEK_VERSION, Initial.NONCE_LEN]), nonce]);

  const { ciphertext, tag } = sealAes256Gcm({ key: kek, nonce, aad: header, plaintext: dek });
  return Buffer.concat([header, ciphertext, tag]);
}

function decodeWrappedDekV1({ kek, blob }) {
  if (!Buffer.isBuffer(kek) || kek.length !== 32) throw new Error('kek must be 32 bytes');
  if (!Buffer.isBuffer(blob)) throw new Error('blob must be a Buffer');

  const minLen = Initial.WRAPPED_DEK_MAGIC.length + 2 + Initial.NONCE_LEN + Initial.DEK_LEN + Initial.TAG_LEN;
  if (blob.length < minLen) throw new Error('wrapped DEK blob too small');

  const magic = blob.subarray(0, Initial.WRAPPED_DEK_MAGIC.length);
  if (!magic.equals(Initial.WRAPPED_DEK_MAGIC)) throw new Error('bad wrapped DEK magic');

  const version = blob[Initial.WRAPPED_DEK_MAGIC.length + 0];
  const nonceLen = blob[Initial.WRAPPED_DEK_MAGIC.length + 1];
  if (version !== Initial.WRAPPED_DEK_VERSION) throw new Error(`unsupported wrapped DEK version: ${version}`);
  if (nonceLen !== Initial.NONCE_LEN) throw new Error(`unsupported wrapped DEK nonceLen: ${nonceLen}`);

  const headerLen = Initial.WRAPPED_DEK_MAGIC.length + 2 + Initial.NONCE_LEN;
  const header = blob.subarray(0, headerLen);
  const nonce = blob.subarray(Initial.WRAPPED_DEK_MAGIC.length + 2, headerLen);

  const tag = blob.subarray(blob.length - Initial.TAG_LEN);
  const ciphertext = blob.subarray(headerLen, blob.length - Initial.TAG_LEN);

  const dek = openAes256Gcm({ key: kek, nonce, aad: header, ciphertext, tag });
  if (dek.length !== Initial.DEK_LEN) throw new Error('unexpected DEK length');
  return dek;
}

module.exports = {
  Initial,
  newDek,
  encodeWrappedDekV1,
  decodeWrappedDekV1,
};
