const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { makeFuseOps } = require('../src/fuse-ops-v1');

const FakeFuse = {
  EACCES: 13,
  ENOENT: 2,
  EBADF: 9,
  EINVAL: 22,
};

function tmpDir() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ocpfs-ops-'));
  return base;
}

function pCreate(ops, p) {
  return new Promise((resolve) => {
    ops.create(p, 0o644, (code, handle) => resolve({ code, handle }));
  });
}

function pOpen(ops, p, flags) {
  return new Promise((resolve) => {
    ops.open(p, flags, (code, handle) => resolve({ code, handle }));
  });
}

function pRelease(ops, p, handle) {
  return new Promise((resolve) => {
    ops.release(p, handle, (code) => resolve(code));
  });
}

function pWrite(ops, p, handle, data, pos = 0) {
  const buf = Buffer.from(data);
  return new Promise((resolve) => {
    ops.write(p, handle, buf, buf.length, pos, (code) => resolve(code));
  });
}

function pRead(ops, p, handle, len, pos = 0) {
  const buf = Buffer.alloc(len);
  return new Promise((resolve) => {
    ops.read(p, handle, buf, len, pos, (n) => resolve(buf.subarray(0, n)));
  });
}

function pReaddir(ops, p) {
  return new Promise((resolve) => {
    ops.readdir(p, (code, entries) => resolve({ code, entries }));
  });
}

function pChmod(ops, p, mode) {
  return new Promise((resolve) => {
    ops.chmod(p, mode, (code) => resolve(code));
  });
}

function pUtimens(ops, p, atime, mtime) {
  return new Promise((resolve) => {
    ops.utimens(p, atime, mtime, (code) => resolve(code));
  });
}

function pStatfs(ops, p) {
  return new Promise((resolve) => {
    ops.statfs(p, (code, st) => resolve({ code, st }));
  });
}

test('fuse-ops-v1 wiring: plaintext workspace is passthrough without gateway', async () => {
  const backstore = tmpDir();

  const { ops } = makeFuseOps({
    backstore,
    Fuse: FakeFuse,
    gatewayAccessAllowed: false,
    kek: null,
  });

  // ensure parent dir exists
  fs.mkdirSync(path.join(backstore, 'workspace'), { recursive: true });

  const { code, handle } = await pCreate(ops, '/workspace/hello.txt');
  assert.equal(code, 0);
  assert.ok(handle);

  const w = await pWrite(ops, '/workspace/hello.txt', handle, 'hello');
  assert.equal(w, 5);

  const r = await pRead(ops, '/workspace/hello.txt', handle, 5);
  assert.equal(r.toString('utf8'), 'hello');

  const rel = await pRelease(ops, '/workspace/hello.txt', handle);
  assert.equal(rel, 0);

  const onDisk = fs.readFileSync(path.join(backstore, 'workspace', 'hello.txt'), 'utf8');
  assert.equal(onDisk, 'hello');
});

test('fuse-ops-v1 wiring: encrypted paths fail closed without gateway', async () => {
  const backstore = tmpDir();

  const { ops } = makeFuseOps({
    backstore,
    Fuse: FakeFuse,
    gatewayAccessAllowed: false,
    kek: null,
  });

  const out = await pCreate(ops, '/secret.txt');
  assert.equal(out.code, -FakeFuse.EACCES);
});

test('fuse-ops-v1 wiring: encrypted paths require KEK even when gateway allowed', async () => {
  const backstore = tmpDir();

  const { ops } = makeFuseOps({
    backstore,
    Fuse: FakeFuse,
    gatewayAccessAllowed: true,
    kek: null,
  });

  const out = await pCreate(ops, '/secret.txt');
  assert.equal(out.code, -FakeFuse.EACCES);
});

test('fuse-ops-v1 wiring: encrypted paths write ciphertext + DEK sidecar, and read returns plaintext', async () => {
  const backstore = tmpDir();
  const kek = Buffer.alloc(32, 7);

  const { ops } = makeFuseOps({
    backstore,
    Fuse: FakeFuse,
    gatewayAccessAllowed: true,
    kek,
  });

  const { code, handle } = await pCreate(ops, '/secret.txt');
  assert.equal(code, 0);

  const plaintext = 'top secret string';
  const w = await pWrite(ops, '/secret.txt', handle, plaintext);
  assert.equal(w, plaintext.length);

  const rel = await pRelease(ops, '/secret.txt', handle);
  assert.equal(rel, 0);

  const real = path.join(backstore, 'secret.txt');
  const realDek = path.join(backstore, 'secret.txt.ocpfs.dek');
  assert.ok(fs.existsSync(real), 'ciphertext file should exist');
  assert.ok(fs.existsSync(realDek), 'DEK sidecar should exist');

  const cipherBuf = fs.readFileSync(real);
  assert.ok(!cipherBuf.includes(Buffer.from(plaintext)), 'ciphertext must not contain plaintext bytes');

  // Ensure open+read returns plaintext.
  const opened = await pOpen(ops, '/secret.txt', fs.constants.O_RDONLY);
  assert.equal(opened.code, 0);
  const got = await pRead(ops, '/secret.txt', opened.handle, 1024);
  assert.equal(got.toString('utf8'), plaintext);
  await pRelease(ops, '/secret.txt', opened.handle);

  // Ensure sidecar is hidden in readdir.
  const rd = await pReaddir(ops, '/');
  assert.equal(rd.code, 0);
  assert.deepEqual(rd.entries.sort(), ['secret.txt']);
});

test('fuse-ops-v1 wiring: chmod/utimens/statfs are wired for plaintext workspace', async () => {
  const backstore = tmpDir();

  const { ops } = makeFuseOps({
    backstore,
    Fuse: FakeFuse,
    gatewayAccessAllowed: false,
    kek: null,
  });

  fs.mkdirSync(path.join(backstore, 'workspace'), { recursive: true });

  const { code, handle } = await pCreate(ops, '/workspace/meta.txt');
  assert.equal(code, 0);
  await pWrite(ops, '/workspace/meta.txt', handle, 'x');

  const chmodCode = await pChmod(ops, '/workspace/meta.txt', 0o600);
  assert.equal(chmodCode, 0);

  // Exercise utimens with both Date and timespec-like objects (as fuse-native may pass).
  const t = new Date('2020-01-02T03:04:05Z');
  const utCode1 = await pUtimens(ops, '/workspace/meta.txt', t, t);
  assert.equal(utCode1, 0);

  const ts = {
    tv_sec: Math.floor(t.getTime() / 1000),
    tv_nsec: (t.getTime() % 1000) * 1e6,
  };
  const utCode2 = await pUtimens(ops, '/workspace/meta.txt', ts, ts);
  assert.equal(utCode2, 0);

  const sfs = await pStatfs(ops, '/workspace');
  assert.equal(sfs.code, 0);
  assert.ok(sfs.st && typeof sfs.st.bsize === 'number');

  await pRelease(ops, '/workspace/meta.txt', handle);

  const st = fs.statSync(path.join(backstore, 'workspace', 'meta.txt'));
  assert.equal(st.mode & 0o777, 0o600);
  assert.ok(Math.abs(st.mtimeMs - t.getTime()) < 2000);
});
