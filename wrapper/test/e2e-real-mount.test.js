const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const WRAPPER_BIN = path.join(__dirname, '..', 'ocprotectfs.js');
const FUSE_BIN = path.join(__dirname, '..', '..', 'fusefs', 'ocprotectfs-fuse.js');

function canAttemptRealMount() {
  if (process.platform !== 'darwin') return false;
  if (!fs.existsSync('/Library/Filesystems/macfuse.fs') && !fs.existsSync('/Library/Filesystems/osxfuse.fs')) return false;

  try {
    // Optional dependency
    // eslint-disable-next-line global-require
    require('fuse-native');
  } catch {
    return false;
  }

  return true;
}

async function waitForNeedle(stream, needle, timeoutMs) {
  return await new Promise((resolve, reject) => {
    const tt = setTimeout(() => reject(new Error(`timeout waiting for: ${needle}`)), timeoutMs);
    let buf = '';

    const onData = (d) => {
      buf += d.toString('utf8');
      if (buf.includes(needle)) {
        clearTimeout(tt);
        stream.off('data', onData);
        resolve(buf);
      }
    };

    stream.on('data', onData);
  });
}

test('wrapper: best-effort e2e real mount via wrapper + fuse (skipped in CI)', async (t) => {
  if (!canAttemptRealMount()) {
    t.skip('requires macOS + macFUSE + fuse-native');
    return;
  }

  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ocpfs-wrap-e2e-'));
  const backstore = path.join(base, 'backstore');
  const mountpoint = path.join(base, 'mountpoint');
  fs.mkdirSync(backstore);
  fs.mkdirSync(mountpoint);

  // Wrapper spawns fuse as a detached child. We run wrapper itself under node.
  const args = [
    WRAPPER_BIN,
    '--backstore',
    backstore,
    '--mountpoint',
    mountpoint,

    '--require-fuse-ready',
    '--fuse-ready-timeout-ms',
    '8000',

    '--fuse-bin',
    process.execPath,
    '--fuse-arg',
    FUSE_BIN,
    '--fuse-arg',
    '--backstore',
    '--fuse-arg',
    backstore,
    '--fuse-arg',
    '--mountpoint',
    '--fuse-arg',
    mountpoint,

    '--gateway-bin',
    '/bin/sleep',
    '--gateway-arg',
    '1000000',

    '--shutdown-timeout-ms',
    '8000',
  ];

  const p = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });

  try {
    await waitForNeedle(p.stderr, 'fuse reported ready', 12000);

    // Once mounted, workspace should be plaintext passthrough.
    const wsDir = path.join(mountpoint, 'workspace');
    fs.mkdirSync(wsDir, { recursive: true });

    const fp = path.join(wsDir, 'hello.txt');
    fs.writeFileSync(fp, 'hello via wrapper');

    const backFp = path.join(backstore, 'workspace', 'hello.txt');
    assert.equal(fs.readFileSync(backFp, 'utf8'), 'hello via wrapper');

    // Statfs should work via the mount.
    const sfs = fs.statfsSync(wsDir);
    assert.ok(sfs && typeof sfs.bsize === 'number' && sfs.bsize > 0);
  } finally {
    // Wrapper should shutdown cleanly and unmount.
    p.kill('SIGTERM');
    const code = await new Promise((resolve) => p.on('close', (c) => resolve(c)));
    assert.equal(code, 0);
  }
});
