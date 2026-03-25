const assert = require('node:assert');
const test = require('node:test');
const crypto = require('node:crypto');
const { parseWrappedKekV2, wrapKekV2, unwrapKekV2 } = require('../src/keywrap');

test('keywrap v2: wraps + unwraps 32-byte KEK (rsa-oaep-sha256)', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kek = crypto.randomBytes(32);

  const wrapped = wrapKekV2({ kek, publicKey });

  const out = unwrapKekV2({ wrapped, privateKey });
  assert.deepStrictEqual(out, kek);
});

test('keywrap v2: parse extracts ciphertext', () => {
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kek = crypto.randomBytes(32);

  const wrapped = wrapKekV2({ kek, publicKey });
  const parsed = parseWrappedKekV2(wrapped);
  assert.strictEqual(parsed.ver, 0x02);
  assert.ok(Buffer.isBuffer(parsed.ciphertext));
  assert.ok(parsed.ciphertext.length > 0);
});

test('keywrap v2: rejects non-32-byte KEK', () => {
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(() => wrapKekV2({ kek: Buffer.alloc(31), publicKey }), /32 bytes/);
});

test('keywrap v2: rejects malformed envelope', () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

  assert.throws(() => parseWrappedKekV2(Buffer.from('nope')), /too short/);

  const badMagic = Buffer.concat([Buffer.from('NOPE'), Buffer.from([0x02, 0x00, 0x01, 0x00])]);
  assert.throws(() => parseWrappedKekV2(badMagic), /bad magic/);

  const badVer = Buffer.concat([Buffer.from('OCKW'), Buffer.from([0x03, 0x00, 0x00])]);
  assert.throws(() => parseWrappedKekV2(badVer), /unsupported version/);

  const badLen = Buffer.concat([Buffer.from('OCKW'), Buffer.from([0x02, 0x00, 0x02, 0x00])]);
  assert.throws(() => parseWrappedKekV2(badLen), /length mismatch/);

  // unwrap uses parse and should surface parse errors.
  assert.throws(() => unwrapKekV2({ wrapped: Buffer.from('nope'), privateKey }), /too short/);
});
