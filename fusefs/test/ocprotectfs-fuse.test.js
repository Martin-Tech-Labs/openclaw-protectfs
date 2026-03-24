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

function fsyncFileSafe(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r+');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // best-effort: some backends/filesystems may not support fsync in all cases
  }
}

function fsyncDirSafe(dirPath) {
  try {
    const fd = fs.openSync(dirPath, 'r');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // best-effort: fsync on directories is not portable
  }
}

test('ocprotectfs-fuse: best-effort real mount passthrough + fail-closed (skipped in CI)', async (t) => {
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

test('ocprotectfs-fuse: best-effort real mount editor-style atomic save (workspace passthrough) (skipped in CI)', async (t) => {
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

    // Simulate an editor atomic-save pattern:
    // 1) write tmp
    // 2) fsync tmp
    // 3) rename(tmp -> file) (possibly overwriting)
    // 4) fsync parent dir (best-effort)

    const workspaceDir = path.join(mountpoint, 'workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });

    const finalName = 'note.txt';
    const tmpName = `${finalName}.tmp`;

    const finalMount = path.join(workspaceDir, finalName);
    const tmpMount = path.join(workspaceDir, tmpName);

    // initial save
    fs.writeFileSync(tmpMount, 'v1');
    fsyncFileSafe(tmpMount);
    fs.renameSync(tmpMount, finalMount);
    fsyncDirSafe(workspaceDir);

    // overwrite save
    fs.writeFileSync(tmpMount, 'v2');
    fsyncFileSafe(tmpMount);
    fs.renameSync(tmpMount, finalMount);
    fsyncDirSafe(workspaceDir);

    assert.equal(fs.readFileSync(finalMount, 'utf8'), 'v2');

    // Backstore should match plaintext for workspace passthrough.
    const backFile = path.join(backstore, 'workspace', finalName);
    assert.equal(fs.readFileSync(backFile, 'utf8'), 'v2');
    assert.equal(fs.existsSync(path.join(backstore, 'workspace', tmpName)), false);
  } finally {
    p.kill('SIGTERM');
    await new Promise((resolve) => p.on('close', () => resolve()));
  }
});

test('ocprotectfs-fuse: best-effort real mount temp/swap file patterns (workspace passthrough) (skipped in CI)', async (t) => {
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

    const workspaceDir = path.join(mountpoint, 'workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });

    const patterns = ['.swp', '.DS_Store', '.~lock.note.txt#'];

    for (const name of patterns) {
      const fp = path.join(workspaceDir, name);
      fs.writeFileSync(fp, `tmp:${name}`);
      fsyncFileSafe(fp);
      fs.unlinkSync(fp);
      assert.equal(fs.existsSync(fp), false);

      // Backstore should reflect the same final state (no stray temp files).
      const backFp = path.join(backstore, 'workspace', name);
      assert.equal(fs.existsSync(backFp), false);
    }
  } finally {
    p.kill('SIGTERM');
    await new Promise((resolve) => p.on('close', () => resolve()));
  }
});

test('ocprotectfs-fuse: best-effort real mount chmod/utimens/fsync/statfs (workspace passthrough) (skipped in CI)', async (t) => {
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

    const workspaceDir = path.join(mountpoint, 'workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });

    const fp = path.join(workspaceDir, 'meta.txt');
    fs.writeFileSync(fp, 'meta');

    // chmod
    fs.chmodSync(fp, 0o600);
    const st1 = fs.statSync(fp);
    assert.equal(st1.mode & 0o777, 0o600);

    // utimens
    const t0 = new Date('2020-01-02T03:04:05Z');
    fs.utimesSync(fp, t0, t0);
    const st2 = fs.statSync(fp);
    assert.ok(Math.abs(st2.mtimeMs - t0.getTime()) < 2000);

    // fsync should not error (exercise fsync op)
    {
      const fd = fs.openSync(fp, 'r+');
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    }

    // statfs should work on mountpoint / workspace dir
    const sfs = fs.statfsSync(workspaceDir);
    assert.ok(sfs && typeof sfs.bsize === 'number' && sfs.bsize > 0);

    // backstore remains plaintext
    const backFp = path.join(backstore, 'workspace', 'meta.txt');
    assert.equal(fs.readFileSync(backFp, 'utf8'), 'meta');
  } finally {
    p.kill('SIGTERM');
    await new Promise((resolve) => p.on('close', () => resolve()));
  }
});

test('ocprotectfs-fuse: best-effort real mount encrypted-at-rest (skipped in CI)', async (t) => {
  if (!canAttemptRealMount()) {
    t.skip('requires macOS + macFUSE + fuse-native');
    return;
  }

  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ocpfs-fuse-'));
  const backstore = path.join(base, 'backstore');
  const mountpoint = path.join(base, 'mountpoint');
  fs.mkdirSync(backstore);
  fs.mkdirSync(mountpoint);

  // 32-byte KEK, base64
  const kek = Buffer.alloc(32, 7).toString('base64');

  const p = spawn(process.execPath, [FUSE_BIN, '--backstore', backstore, '--mountpoint', mountpoint], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      OCPROTECTFS_GATEWAY_ACCESS_ALLOWED: '1',
      OCPROTECTFS_KEK_B64: kek,
    },
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

    const mountFile = path.join(mountpoint, 'secret.txt');
    const backFile = path.join(backstore, 'secret.txt');
    const dekFile = path.join(backstore, 'secret.txt.ocpfs.dek');

    fs.writeFileSync(mountFile, 'super secret');

    // ciphertext on disk
    const back = fs.readFileSync(backFile);
    const plaintext = Buffer.from('super secret');
    if (back.includes(plaintext)) {
      throw new Error('expected ciphertext not to contain plaintext');
    }

    // sidecar exists on disk but is hidden from mount
    assert.ok(fs.existsSync(dekFile));
    assert.throws(() => fs.readFileSync(path.join(mountpoint, 'secret.txt.ocpfs.dek')), /ENOENT|not found/i);
  } finally {
    p.kill('SIGTERM');
    await new Promise((resolve) => p.on('close', () => resolve()));
  }
});
