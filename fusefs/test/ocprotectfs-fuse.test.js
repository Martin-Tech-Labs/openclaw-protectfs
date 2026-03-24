const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const FUSE_BIN = path.join(__dirname, '..', 'ocprotectfs-fuse.js');

function canAttemptRealMount() {
  if (process.platform !== 'darwin') return false;

  // Heuristic: presence of macFUSE install.
  if (!fs.existsSync('/Library/Filesystems/macfuse.fs') && !fs.existsSync('/Library/Filesystems/osxfuse.fs')) return false;

  try {
    // Optional dependency: may not be installed in CI.
    // eslint-disable-next-line global-require
    require('fuse-native');
  } catch {
    return false;
  }

  return true;
}

test('ocprotectfs-fuse: --help exits 0', async () => {
  const p = spawn(process.execPath, [FUSE_BIN, '--help'], { stdio: ['ignore', 'pipe', 'pipe'] });

  const out = await new Promise((resolve) => {
    let buf = '';
    p.stdout.on('data', (d) => (buf += d.toString('utf8')));
    p.on('close', (code) => resolve({ code, buf }));
  });

  assert.equal(out.code, 0);
  assert.match(out.buf, /ocprotectfs-fuse/);
});

test('ocprotectfs-fuse: best-effort real mount passthrough (skipped in CI)', async (t) => {
  if (!canAttemptRealMount()) {
    t.skip('requires macOS + macFUSE + fuse-native');
    return;
  }

  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ocpfs-fuse-'));
  const backstore = path.join(base, 'backstore');
  const mountpoint = path.join(base, 'mountpoint');
  fs.mkdirSync(backstore);
  fs.mkdirSync(mountpoint);

  const p = spawn(process.execPath, [FUSE_BIN, '--backstore', backstore, '--mountpoint', mountpoint], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await new Promise((resolve, reject) => {
      const timeoutMs = 8000;
      const tt = setTimeout(() => reject(new Error('timeout waiting for READY (mount)')), timeoutMs);
      let buf = '';
      p.stdout.on('data', (d) => {
        buf += d.toString('utf8');
        if (buf.includes('READY')) {
          clearTimeout(tt);
          resolve();
        }
      });
      p.on('exit', (code) => {
        if (code && code !== 0) {
          clearTimeout(tt);
          reject(new Error(`fuse process exited before READY (code=${code})`));
        }
      });
    });

    // Policy wiring check:
    // - workspace/** is plaintext passthrough
    // - other paths are fail-closed (deny) unless gateway+KEK are provided

    const rel = path.join('workspace', 'hello.txt');
    const mountFile = path.join(mountpoint, rel);
    const backFile = path.join(backstore, rel);

    fs.mkdirSync(path.join(mountpoint, 'workspace'), { recursive: true });
    fs.writeFileSync(mountFile, 'hi from fuse');

    const back = fs.readFileSync(backFile, 'utf8');
    assert.equal(back, 'hi from fuse');

    // Encrypted-by-policy paths should deny by default (fail closed).
    assert.throws(() => fs.writeFileSync(path.join(mountpoint, 'secret.txt'), 'nope'), /EACCES|operation not permitted/i);
  } finally {
    // terminate cleanly
    p.kill('SIGTERM');
    await new Promise((resolve) => p.on('close', () => resolve()));
  }
});
