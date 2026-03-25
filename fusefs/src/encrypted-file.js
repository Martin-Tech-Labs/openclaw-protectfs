const fs = require('node:fs');
const path = require('node:path');

const { encodeEncryptedFileV1, decodeEncryptedFileV1 } = require('./crypto');
const { newDek, encodeWrappedDekV1, decodeWrappedDekV1 } = require('./dek-store');

function sidecarDekPath(realPath) {
  return `${realPath}.ocpfs.dek`;
}

function assertKey32(name, buf) {
  if (!Buffer.isBuffer(buf) || buf.length !== 32) throw new Error(`${name} must be 32 bytes`);
}

function loadOrCreateDek({ kek, realPath, createIfMissing }) {
  assertKey32('kek', kek);
  const dekPath = sidecarDekPath(realPath);

  try {
    const wrapped = fs.readFileSync(dekPath);
    return decodeWrappedDekV1({ kek, blob: wrapped });
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      if (!createIfMissing) {
        const err = new Error('missing DEK sidecar');
        err.code = 'EACCES';
        throw err;
      }
      const dek = newDek();
      const wrapped = encodeWrappedDekV1({ kek, dek });
      fs.mkdirSync(path.dirname(realPath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(dekPath, wrapped, { mode: 0o600 });
      return dek;
    }
    throw e;
  }
}

function readEncryptedFile({ kek, realPath, createIfMissing = false }) {
  const dek = loadOrCreateDek({ kek, realPath, createIfMissing });

  try {
    const blob = fs.readFileSync(realPath);
    const plaintext = decodeEncryptedFileV1({ dek, blob });
    return { dek, plaintext };
  } catch (e) {
    if (e && e.code === 'ENOENT') return { dek, plaintext: Buffer.alloc(0) };
    const err = new Error('ciphertext decode failed');
    err.code = 'EACCES';
    throw err;
  }
}

function writeEncryptedFile({ dek, realPath, plaintext }) {
  assertKey32('dek', dek);
  if (!Buffer.isBuffer(plaintext)) throw new Error('plaintext must be a Buffer');

  const blob = encodeEncryptedFileV1({ dek, plaintext });
  fs.mkdirSync(path.dirname(realPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(realPath, blob, { mode: 0o600 });
}

module.exports = {
  sidecarDekPath,
  readEncryptedFile,
  writeEncryptedFile,
};
