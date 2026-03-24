const test = require('node:test');
const assert = require('node:assert/strict');

const {
  randomKey32,
  encodeEncryptedFileV1,
  decodeEncryptedFileV1,
  V1: FILE_V1,
} = require('../lib/crypto-v1');

const { newDek, encodeWrappedDekV1, decodeWrappedDekV1, V1: DEK_V1 } = require('../lib/dek-store-v1');

test('crypto-v1: encrypt/decrypt roundtrip', () => {
  const dek = randomKey32();
  const plaintext = Buffer.from('hello secret world', 'utf8');

  const blob = encodeEncryptedFileV1({ dek, plaintext });
  const out = decodeEncryptedFileV1({ dek, blob });

  assert.equal(out.toString('utf8'), plaintext.toString('utf8'));
  // quick sanity: should not contain plaintext in blob
  assert.equal(blob.includes(plaintext), false);
});

test('crypto-v1: wrong key fails', () => {
  const dek = randomKey32();
  const dek2 = randomKey32();
  const plaintext = Buffer.from('hello secret world', 'utf8');

  const blob = encodeEncryptedFileV1({ dek, plaintext });
  assert.throws(() => decodeEncryptedFileV1({ dek: dek2, blob }));
});

test('crypto-v1: tamper detection (ciphertext)', () => {
  const dek = randomKey32();
  const plaintext = Buffer.from('attack at dawn', 'utf8');

  const blob = Buffer.from(encodeEncryptedFileV1({ dek, plaintext }));
  // flip a bit somewhere after the header
  const headerLen = FILE_V1.FILE_MAGIC.length + 3 + FILE_V1.NONCE_LEN;
  blob[headerLen + 1] ^= 0x01;

  assert.throws(() => decodeEncryptedFileV1({ dek, blob }));
});

test('crypto-v1: version mismatch rejected', () => {
  const dek = randomKey32();
  const plaintext = Buffer.from('x', 'utf8');

  const blob = Buffer.from(encodeEncryptedFileV1({ dek, plaintext }));
  // overwrite version byte
  blob[FILE_V1.FILE_MAGIC.length] = 0x02;
  assert.throws(() => decodeEncryptedFileV1({ dek, blob }), /unsupported version/);
});

test('dek-store-v1: wrap/unwrap roundtrip', () => {
  const kek = randomKey32();
  const dek = newDek();
  const blob = encodeWrappedDekV1({ kek, dek });
  const out = decodeWrappedDekV1({ kek, blob });
  assert.equal(out.equals(dek), true);
});

test('dek-store-v1: wrong KEK fails', () => {
  const kek = randomKey32();
  const kek2 = randomKey32();
  const dek = newDek();
  const blob = encodeWrappedDekV1({ kek, dek });
  assert.throws(() => decodeWrappedDekV1({ kek: kek2, blob }));
});

test('dek-store-v1: version mismatch rejected', () => {
  const kek = randomKey32();
  const dek = newDek();
  const blob = Buffer.from(encodeWrappedDekV1({ kek, dek }));
  blob[DEK_V1.WRAPPED_DEK_MAGIC.length] = 0x02;
  assert.throws(() => decodeWrappedDekV1({ kek, blob }), /unsupported wrapped DEK version/);
});
