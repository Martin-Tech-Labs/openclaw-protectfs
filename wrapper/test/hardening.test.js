const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { safeAtomicWriteFile } = require('../lib/safe-fs');
const { buildChildEnv } = require('../lib/run');

test('safeAtomicWriteFile writes file with requested mode and contents', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocpfs-hardening-'));
  const filePath = path.join(dir, 'marker.json');

  safeAtomicWriteFile(filePath, '{"ok":true}\n', { mode: 0o600 });

  const data = fs.readFileSync(filePath, 'utf8');
  assert.equal(data, '{"ok":true}\n');

  const st = fs.statSync(filePath);
  assert.equal(st.mode & 0o777, 0o600);
});

test('safeAtomicWriteFile refuses to write to an existing symlink target path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocpfs-hardening-'));
  const real = path.join(dir, 'real.json');
  const link = path.join(dir, 'link.json');

  fs.writeFileSync(real, 'REAL\n', { mode: 0o600 });
  fs.symlinkSync(real, link);

  assert.throws(() => safeAtomicWriteFile(link, 'X\n', { mode: 0o600 }), /symlink/);
  assert.equal(fs.readFileSync(real, 'utf8'), 'REAL\n');
});

test('buildChildEnv does not leak non-allowlisted env vars', () => {
  const old = process.env.OCPFS_SECRET;
  process.env.OCPFS_SECRET = 'shh';

  try {
    const env = buildChildEnv({ OCPROTECTFS_LIVENESS_SOCK: '/tmp/sock' });
    assert.equal(env.OCPROTECTFS_LIVENESS_SOCK, '/tmp/sock');
    assert.equal(env.OCPFS_SECRET, undefined);

    // Sanity: if PATH exists in parent, it should be forwarded.
    if (process.env.PATH) assert.equal(env.PATH, process.env.PATH);
  } finally {
    if (old === undefined) delete process.env.OCPFS_SECRET;
    else process.env.OCPFS_SECRET = old;
  }
});
