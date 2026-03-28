const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

function hasSwift() {
  const r = spawnSync('swift', ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}

function hasFuseHeaders() {
  // macFUSE typically installs headers in /usr/local/include/fuse.
  // GitHub's macos runners generally do not have macFUSE installed.
  const candidates = [
    '/usr/local/include/fuse/fuse.h',
    '/opt/homebrew/include/fuse/fuse.h',
    '/usr/include/fuse/fuse.h',
  ];
  return candidates.some((p) => fs.existsSync(p));
}

test('fusefs-swift: swift build (best-effort on macOS)', { skip: process.platform !== 'darwin' }, () => {
  if (!hasSwift()) {
    test.skip('swift toolchain not available');
    return;
  }

  if (!hasFuseHeaders()) {
    test.skip('macFUSE headers not available (skipping swift build smoke test)');
    return;
  }

  const pkgDir = path.join(__dirname, '..');

  const r = spawnSync('swift', ['build'], {
    cwd: pkgDir,
    encoding: 'utf8',
    env: process.env,
  });

  if (r.status !== 0) {
    // Surface stderr in assertion message for debugging.
    const out = `${r.stdout || ''}\n${r.stderr || ''}`.trim();
    assert.equal(r.status, 0, out || 'swift build failed');
  }
});
