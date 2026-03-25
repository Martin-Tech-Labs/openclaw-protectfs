const crypto = require('node:crypto');

// v1 crypto primitives and file formats.
//
// Design goals:
// - Use Node's built-in, well-vetted primitives (no custom crypto).
// - Simple versioned formats with authenticated headers.
// - AEAD for confidentiality + integrity.
//
// v1 chooses AES-256-GCM because it's widely supported by Node's crypto.
// (The design doc previously mentioned XChaCha20-Poly1305; we intentionally
// pick a primitive that is guaranteed available without native deps.)

const V1 = {
  FILE_MAGIC: Buffer.from('OCFS1', 'utf8'),
  FILE_VERSION: 0x01,
  ALG_AES_256_GCM: 0x01,
  NONCE_LEN: 12, // recommended size for GCM
  TAG_LEN: 16,
};

function randomKey32() {
  return crypto.randomBytes(32);
}

function sealAes256Gcm({ key, nonce, aad, plaintext }) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('key must be 32 bytes');
  if (!Buffer.isBuffer(nonce) || nonce.length !== V1.NONCE_LEN) throw new Error('nonce must be 12 bytes');
  if (!Buffer.isBuffer(plaintext)) throw new Error('plaintext must be a Buffer');

  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  if (aad && aad.length) cipher.setAAD(aad);

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (tag.length !== V1.TAG_LEN) throw new Error('unexpected auth tag length');

  return { ciphertext, tag };
}

function openAes256Gcm({ key, nonce, aad, ciphertext, tag }) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('key must be 32 bytes');
  if (!Buffer.isBuffer(nonce) || nonce.length !== V1.NONCE_LEN) throw new Error('nonce must be 12 bytes');
  if (!Buffer.isBuffer(ciphertext)) throw new Error('ciphertext must be a Buffer');
  if (!Buffer.isBuffer(tag) || tag.length !== V1.TAG_LEN) throw new Error('tag must be 16 bytes');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  if (aad && aad.length) decipher.setAAD(aad);
  decipher.setAuthTag(tag);

  // crypto throws on auth failure.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function encodeEncryptedFileV1({ dek, plaintext }) {
  if (!Buffer.isBuffer(dek) || dek.length !== 32) throw new Error('dek must be 32 bytes');
  if (!Buffer.isBuffer(plaintext)) throw new Error('plaintext must be a Buffer');

  const nonce = crypto.randomBytes(V1.NONCE_LEN);
  const header = Buffer.concat([
    V1.FILE_MAGIC,
    Buffer.from([V1.FILE_VERSION, V1.ALG_AES_256_GCM, V1.NONCE_LEN]),
    nonce,
  ]);

  const { ciphertext, tag } = sealAes256Gcm({ key: dek, nonce, aad: header, plaintext });
  return Buffer.concat([header, ciphertext, tag]);
}

function decodeEncryptedFileV1({ dek, blob }) {
  if (!Buffer.isBuffer(dek) || dek.length !== 32) throw new Error('dek must be 32 bytes');
  if (!Buffer.isBuffer(blob)) throw new Error('blob must be a Buffer');

  const minLen = V1.FILE_MAGIC.length + 3 + V1.NONCE_LEN + V1.TAG_LEN;
  if (blob.length < minLen) throw new Error('ciphertext blob too small');

  const magic = blob.subarray(0, V1.FILE_MAGIC.length);
  if (!magic.equals(V1.FILE_MAGIC)) throw new Error('bad magic');

  const version = blob[V1.FILE_MAGIC.length + 0];
  const alg = blob[V1.FILE_MAGIC.length + 1];
  const nonceLen = blob[V1.FILE_MAGIC.length + 2];

  if (version !== V1.FILE_VERSION) throw new Error(`unsupported version: ${version}`);
  if (alg !== V1.ALG_AES_256_GCM) throw new Error(`unsupported alg: ${alg}`);
  if (nonceLen !== V1.NONCE_LEN) throw new Error(`unsupported nonceLen: ${nonceLen}`);

  const headerLen = V1.FILE_MAGIC.length + 3 + V1.NONCE_LEN;
  const header = blob.subarray(0, headerLen);
  const nonce = blob.subarray(V1.FILE_MAGIC.length + 3, headerLen);

  const tag = blob.subarray(blob.length - V1.TAG_LEN);
  const ciphertext = blob.subarray(headerLen, blob.length - V1.TAG_LEN);

  return openAes256Gcm({ key: dek, nonce, aad: header, ciphertext, tag });
}

module.exports = {
  V1,
  randomKey32,
  sealAes256Gcm,
  openAes256Gcm,
  encodeEncryptedFileV1,
  decodeEncryptedFileV1,
};
