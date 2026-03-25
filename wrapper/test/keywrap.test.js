const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { wrapKekV2, unwrapKekV2 } = require('../src/keywrap');

test('keywrap v2: wraps + unwraps 32-byte KEK (rsa-oaep-sha256)', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicExponent: 0x10001,
  });

  const kek = crypto.randomBytes(32);
  const wrapped = wrapKekV2({ kek, publicKey });
  assert.ok(Buffer.isBuffer(wrapped));
  assert.ok(wrapped.length > 32);

  const out = unwrapKekV2({ wrapped, privateKey });
  assert.deepEqual(out, kek);
});

test('keywrap v2: rejects non-32-byte KEK', () => {
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(() => wrapKekV2({ kek: Buffer.alloc(31), publicKey }), /32 bytes/);
});

test('keywrap v2: rejects malformed envelope', () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

  assert.throws(() => unwrapKekV2({ wrapped: Buffer.from('nope'), privateKey }), /too short/);

  const badMagic = Buffer.concat([Buffer.from('NOPE'), Buffer.from([0x02, 0x00, 0x00])]);
  assert.throws(() => unwrapKekV2({ wrapped: badMagic, privateKey }), /bad magic/);

  const badVer = Buffer.concat([Buffer.from('OCKW'), Buffer.from([0x03, 0x00, 0x00])]);
  assert.throws(() => unwrapKekV2({ wrapped: badVer, privateKey }), /unsupported version/);
});
