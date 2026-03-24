const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { readEncryptedFile, writeEncryptedFile, sidecarDekPath } = require('../lib/encrypted-file-v1');

test('encrypted-file-v1: writes ciphertext + sidecar, reads back plaintext', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ocpfs-enc-'));
  const realPath = path.join(base, 'secret.txt');

  const kek = crypto.randomBytes(32);
  const pt = Buffer.from('top secret payload', 'utf8');

  // create file (DEK sidecar is created automatically)
  const { dek } = readEncryptedFile({ kek, realPath, createIfMissing: true });
  writeEncryptedFile({ dek, realPath, plaintext: pt });

  assert.ok(fs.existsSync(realPath), 'ciphertext file should exist');
  assert.ok(fs.existsSync(sidecarDekPath(realPath)), 'DEK sidecar should exist');

  const onDisk = fs.readFileSync(realPath);
  assert.notEqual(onDisk.toString('utf8'), pt.toString('utf8'), 'disk content should not be plaintext');

  const r = readEncryptedFile({ kek, realPath, createIfMissing: false });
  assert.equal(r.plaintext.toString('utf8'), pt.toString('utf8'));
});
