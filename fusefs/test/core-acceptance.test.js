const test = require('node:test');
const assert = require('node:assert/strict');

const { OPS, authorizeOp } = require('../lib/core-v1');

// Task 09 — “acceptance” tests for FUSE core policy outcomes.
//
// These tests deliberately avoid a real macFUSE mount (not implemented yet).
// Instead, they validate the core contract we expect the future FUSE layer to
// enforce for real filesystem operations.

const WRITE_OPS = [
  OPS.WRITE,
  OPS.CREATE,
  OPS.MKDIR,
  OPS.RMDIR,
  OPS.RENAME,
  OPS.UNLINK,
  OPS.CHMOD,
  OPS.CHOWN,
];

const READ_OPS = [OPS.READ];

test('core-v1: plaintext workspace operations are allowed without gateway checks', () => {
  for (const op of [...READ_OPS, ...WRITE_OPS]) {
    const res = authorizeOp({ op, rel: 'workspace/notes.txt', gatewayAccessAllowed: false });
    assert.equal(res.ok, true, `expected allow for op=${op}`);
  }
});

test('core-v1: encrypted paths fail closed when gateway checks are missing', () => {
  for (const op of [...READ_OPS, ...WRITE_OPS]) {
    const res = authorizeOp({ op, rel: 'secrets/db.sqlite', gatewayAccessAllowed: false });
    assert.equal(res.ok, false, `expected deny for op=${op}`);
    assert.equal(res.code, 'EACCES');
  }
});

test('core-v1: encrypted paths are allowed when gateway checks pass', () => {
  for (const op of [...READ_OPS, ...WRITE_OPS]) {
    const res = authorizeOp({ op, rel: 'secrets/db.sqlite', gatewayAccessAllowed: true });
    assert.equal(res.ok, true, `expected allow for op=${op}`);
  }
});

test('core-v1: denies unknown ops', () => {
  const res = authorizeOp({ op: 'frobnicate', rel: 'workspace/x', gatewayAccessAllowed: false });
  assert.deepEqual(res, { ok: false, code: 'EINVAL', reason: 'unknown op: frobnicate' });
});

test('core-v1: rejects unsafe relative paths (fail closed)', () => {
  assert.throws(() => authorizeOp({ op: OPS.READ, rel: '../etc/passwd', gatewayAccessAllowed: true }), {
    message: /path traversal not allowed/,
  });
});
