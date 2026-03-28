const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { encodeEncryptedFileV1WithNonce, decodeEncryptedFileV1 } = require('../../fusefs/src/crypto');

function hex(buf) {
  return Buffer.from(buf).toString('hex');
}

test('fusefs-swift: crypto v1 format interop (Swift<->Node)', { skip: process.platform !== 'darwin' }, () => {
  // This test compiles Swift sources with `swiftc`.
  // Gate to macOS so ubuntu-latest CI (no Swift toolchain) stays green.
  try {
    execFileSync('swiftc', ['--version'], { stdio: 'ignore' });
  } catch {
    return; // best-effort: treat missing toolchain as a no-op
  }

  // Build a tiny helper from the real Swift sources (no XCTest needed).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocpfs-swift-crypto-'));
  const bin = path.join(tmp, 'crypto-interop');

  const repoRoot = path.resolve(__dirname, '..', '..');
  const fuseSwift = path.join(repoRoot, 'fusefs-swift');

  execFileSync('swiftc', [
    '-O',
    path.join(fuseSwift, 'Sources', 'OcProtectFsFuse', 'CryptoV1.swift'),
    path.join(fuseSwift, 'scripts', 'crypto-interop', 'main.swift'),
    '-o',
    bin,
  ], { cwd: fuseSwift, stdio: 'inherit' });

  // Node -> Swift decode
  {
    const dek = Buffer.alloc(32, 0x11);
    const nonce = Buffer.alloc(12, 0x22);
    const pt = Buffer.from('hello secret world', 'utf8');
    const blob = encodeEncryptedFileV1WithNonce({ dek, nonce, plaintext: pt });

    const outB64 = execFileSync(bin, ['decode', hex(dek), blob.toString('base64')], { encoding: 'utf8' }).trim();
    const out = Buffer.from(outB64, 'base64');
    assert.deepEqual(out, pt);
  }

  // Swift -> Node decode
  {
    const dek = Buffer.alloc(32, 0x33);
    const nonce = Buffer.alloc(12, 0x44);
    const pt = Buffer.from('attack at dawn', 'utf8');

    const blobB64 = execFileSync(bin, ['encode', hex(dek), hex(nonce), pt.toString('base64')], { encoding: 'utf8' }).trim();
    const blob = Buffer.from(blobB64, 'base64');

    const out = decodeEncryptedFileV1({ dek, blob });
    assert.deepEqual(out, pt);
  }
});
