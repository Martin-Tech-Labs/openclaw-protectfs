const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { makeFuseOps } = require('../src/fuse-ops-v1');
const { readEncryptedFile, writeEncryptedFile, sidecarDekPath } = require('../src/encrypted-file-v1');

const FakeFuse = {
  EACCES: 13,
  ENOENT: 2,
  EBADF: 9,
  EINVAL: 22,
};

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ocpfs-ops-'));
}

function p(cbStyleFn) {
  return new Promise((resolve) => cbStyleFn(resolve));
}

function pCreate(ops, pth, mode = 0o644) {
  return p((resolve) => ops.create(pth, mode, (code, handle) => resolve({ code, handle })));
}

function pOpen(ops, pth, flags) {
  return p((resolve) => ops.open(pth, flags, (code, handle) => resolve({ code, handle })));
}

function pRelease(ops, pth, handle) {
  return p((resolve) => ops.release(pth, handle, (code) => resolve(code)));
}

function pWrite(ops, pth, handle, data, pos = 0) {
  const buf = Buffer.from(data);
  return p((resolve) => ops.write(pth, handle, buf, buf.length, pos, (code) => resolve(code)));
}

function pRead(ops, pth, handle, len, pos = 0) {
  const buf = Buffer.alloc(len);
  return p((resolve) => ops.read(pth, handle, buf, len, pos, (n) => resolve(buf.subarray(0, n))));
}

function pFsync(ops, pth, handle, datasync = false) {
  return p((resolve) => ops.fsync(pth, handle, datasync, (code) => resolve(code)));
}

function pTruncate(ops, pth, size) {
  return p((resolve) => ops.truncate(pth, size, (code) => resolve(code)));
}

function pChmod(ops, pth, mode) {
  return p((resolve) => ops.chmod(pth, mode, (code) => resolve(code)));
}

function pUtimens(ops, pth, atime, mtime) {
  return p((resolve) => ops.utimens(pth, atime, mtime, (code) => resolve(code)));
}

function pUnlink(ops, pth) {
  return p((resolve) => ops.unlink(pth, (code) => resolve(code)));
}

function pRename(ops, src, dest) {
  return p((resolve) => ops.rename(src, dest, (code) => resolve(code)));
}

function pMkdir(ops, pth, mode = 0o755) {
  return p((resolve) => ops.mkdir(pth, mode, (code) => resolve(code)));
}

function pRmdir(ops, pth) {
  return p((resolve) => ops.rmdir(pth, (code) => resolve(code)));
}

const KEK = Buffer.alloc(32, 7);

test('fuse-ops-v1 coverage: encrypted create/write/fsync/release persists ciphertext + sidecar', async () => {
  const backstore = tmpDir();

  const { ops } = makeFuseOps({
    backstore,
    Fuse: FakeFuse,
    gatewayAccessAllowed: true,
    kek: KEK,
  });

  const { code, handle } = await pCreate(ops, '/secret.txt');
  assert.equal(code, 0);

  const w = await pWrite(ops, '/secret.txt', handle, 'hello');
  assert.equal(w, 5);

  const fsyncCode = await pFsync(ops, '/secret.txt', handle);
  assert.equal(fsyncCode, 0);

  const rel = await pRelease(ops, '/secret.txt', handle);
  assert.equal(rel, 0);

  const real = path.join(backstore, 'secret.txt');
  const out = readEncryptedFile({ kek: KEK, realPath: real, createIfMissing: false });
  assert.equal(out.plaintext.toString('utf8'), 'hello');

  assert.ok(fs.existsSync(sidecarDekPath(real)), 'expected DEK sidecar to exist');
});

test('fuse-ops-v1 coverage: encrypted truncate updates ciphertext', async () => {
  const backstore = tmpDir();
  const real = path.join(backstore, 'secret.txt');

  const { dek } = readEncryptedFile({ kek: KEK, realPath: real, createIfMissing: true });
  writeEncryptedFile({
    dek,
    realPath: real,
    plaintext: Buffer.from('hello world', 'utf8'),
  });

  const { ops } = makeFuseOps({
    backstore,
    Fuse: FakeFuse,
    gatewayAccessAllowed: true,
    kek: KEK,
  });

  const code = await pTruncate(ops, '/secret.txt', 5);
  assert.equal(code, 0);

  const out = readEncryptedFile({ kek: KEK, realPath: real, createIfMissing: false });
  assert.equal(out.plaintext.toString('utf8'), 'hello');
});

test('fuse-ops-v1 coverage: encrypted chmod + utimens attempt to sync sidecar', async () => {
  const backstore = tmpDir();
  const real = path.join(backstore, 'secret.txt');

  // Create ciphertext + sidecar.
  const { dek } = readEncryptedFile({ kek: KEK, realPath: real, createIfMissing: true });
  writeEncryptedFile({ dek, realPath: real, plaintext: Buffer.from('x') });

  const sidecar = sidecarDekPath(real);
  assert.ok(fs.existsSync(sidecar));

  const { ops } = makeFuseOps({
    backstore,
    Fuse: FakeFuse,
    gatewayAccessAllowed: true,
    kek: KEK,
  });

  const chmodCode = await pChmod(ops, '/secret.txt', 0o600);
  assert.equal(chmodCode, 0);

  const stSidecar = fs.statSync(sidecar);
  assert.equal(stSidecar.mode & 0o777, 0o600);

  // Use timespec-like objects to cover conversion branches.
  const ts = { tv_sec: Math.floor(Date.now() / 1000) - 123, tv_nsec: 0 };
  const utimensCode = await pUtimens(ops, '/secret.txt', ts, ts);
  assert.equal(utimensCode, 0);

  const stSidecar2 = fs.statSync(sidecar);
  assert.ok(Math.abs(stSidecar2.mtimeMs - (ts.tv_sec * 1000)) < 2000);
});

test('fuse-ops-v1 coverage: encrypted unlink removes ciphertext and sidecar (best-effort)', async () => {
  const backstore = tmpDir();
  const real = path.join(backstore, 'secret.txt');

  const { dek } = readEncryptedFile({ kek: KEK, realPath: real, createIfMissing: true });
  writeEncryptedFile({ dek, realPath: real, plaintext: Buffer.from('x') });

  const sidecar = sidecarDekPath(real);
  assert.ok(fs.existsSync(real));
  assert.ok(fs.existsSync(sidecar));

  const { ops } = makeFuseOps({
    backstore,
    Fuse: FakeFuse,
    gatewayAccessAllowed: true,
    kek: KEK,
  });

  const code = await pUnlink(ops, '/secret.txt');
  assert.equal(code, 0);

  assert.ok(!fs.existsSync(real));
  assert.ok(!fs.existsSync(sidecar));
});

test('fuse-ops-v1 coverage: rename across plaintext/encrypted boundary is denied', async () => {
  const backstore = tmpDir();
  fs.mkdirSync(path.join(backstore, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(backstore, 'workspace', 'a.txt'), 'a');

  const { ops } = makeFuseOps({
    backstore,
    Fuse: FakeFuse,
    gatewayAccessAllowed: true,
    kek: KEK,
  });

  const code = await pRename(ops, '/workspace/a.txt', '/secret.txt');
  assert.equal(code, -FakeFuse.EACCES);
});

test('fuse-ops-v1 hardening: mkdir/rmdir must not bypass access checks', async () => {
  const backstore = tmpDir();

  const { ops } = makeFuseOps({
    backstore,
    Fuse: FakeFuse,
    gatewayAccessAllowed: false,
    kek: KEK,
  });

  // Encrypted-by-default path (requires gateway access checks).
  const mk = await pMkdir(ops, '/secret-dir', 0o700);
  assert.equal(mk, -FakeFuse.EACCES);
  assert.ok(!fs.existsSync(path.join(backstore, 'secret-dir')));

  // Even if the directory exists already, rmdir should be denied under fail-closed.
  fs.mkdirSync(path.join(backstore, 'secret-dir'));
  const rm = await pRmdir(ops, '/secret-dir');
  assert.equal(rm, -FakeFuse.EACCES);
  assert.ok(fs.existsSync(path.join(backstore, 'secret-dir')));
});
