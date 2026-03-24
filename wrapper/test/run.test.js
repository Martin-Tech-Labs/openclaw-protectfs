const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validateConfig, prepareDir } = require('../lib/run');

test('validateConfig: requires required fields', () => {
  assert.throws(() => validateConfig(null));
  assert.throws(() => validateConfig({}));
  assert.throws(() => validateConfig({ backstore: '/a', mountpoint: '/b', fuseBin: '', gatewayBin: '/bin/sleep', shutdownTimeoutMs: 1000 }));

  assert.doesNotThrow(() =>
    validateConfig({
      backstore: '/a',
      mountpoint: '/b',
      fuseBin: '/bin/sleep',
      fuseArgs: ['1'],
      gatewayBin: '/bin/sleep',
      gatewayArgs: ['1'],
      shutdownTimeoutMs: 1000,
    })
  );
});

test('prepareDir: creates directory when missing', () => {
  const base = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ocpfs-'));
  const p = path.join(base, 'newdir');
  prepareDir(p, 0o700);
  const st = fs.statSync(p);
  assert.equal(st.isDirectory(), true);
});

test('prepareDir: rejects symlink', () => {
  const base = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ocpfs-'));
  const target = path.join(base, 'target');
  fs.mkdirSync(target);
  const link = path.join(base, 'link');
  fs.symlinkSync(target, link);
  assert.throws(() => prepareDir(link, 0o700), /refusing symlink/);
});

test('prepareDir: rejects non-absolute path', () => {
  assert.throws(() => prepareDir('relative/path', 0o700), /absolute/);
});
