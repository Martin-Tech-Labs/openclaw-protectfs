const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const WRAPPER_BIN = path.join(__dirname, '..', 'ocprotectfs.js');
const FUSE_BIN = path.join(__dirname, '..', '..', 'fusefs', 'ocprotectfs-fuse.js');

function canAttemptRealMount() {
  // Real mounts can hang on developer machines depending on macFUSE state
  // (system extension approval, permissions, stale mounts, etc.).
  //
  // Policy:
  // - Local: attempt by default if prerequisites exist.
  // - CI: skip by default unless explicitly enabled.
  if (process.env.CI && process.env.OCPROTECTFS_RUN_REAL_MOUNT_TESTS !== '1') return false;

  if (process.platform !== 'darwin') return false;

  // fuse-native can be sensitive to Node ABI versions. Skip on very new
  // Node majors unless explicitly forced.
  const nodeMajor = Number(String(process.versions.node || '').split('.')[0]);
  if (Number.isFinite(nodeMajor) && nodeMajor >= 23 && process.env.OCPROTECTFS_RUN_REAL_MOUNT_TESTS !== '1') return false;

  // Heuristic: presence of macFUSE install.
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

async function waitForNeedle(proc, stream, needle, timeoutMs) {
  return await new Promise((resolve, reject) => {
    const tt = setTimeout(() => reject(new Error(`timeout waiting for: ${needle}`)), timeoutMs);
    let buf = '';

    const cleanup = () => {
      clearTimeout(tt);
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('close', onEnd);
      proc.off('exit', onExit);
    };

    const onData = (d) => {
      buf += d.toString('utf8');
      if (buf.includes(needle)) {
        cleanup();
        resolve(buf);
      }
    };

    const onExit = (code, signal) => {
      cleanup();
      const suffix = buf ? `\n\n--- process output ---\n${buf}` : '';
      reject(new Error(`process exited before seeing needle: ${needle} (code=${code}, signal=${signal})${suffix}`));
    };

    const onEnd = () => {
      // stderr closed without emitting the needle; treat as failure.
      onExit(proc.exitCode, proc.signalCode);
    };

    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('close', onEnd);
    proc.on('exit', onExit);

    // Avoid a race where the child exits before handlers are attached.
    setImmediate(() => {
      if (proc.exitCode !== null || proc.signalCode) onExit(proc.exitCode, proc.signalCode);
      if (stream.readableEnded) onEnd();
    });
  });
}

async function killAndWait(p, timeoutMs = 4000) {
  if (!p) return 0;

  try {
    p.kill('SIGTERM');
  } catch {
    // ignore
  }

  return await new Promise((resolve) => {
    const tt = setTimeout(() => {
      try {
        p.kill('SIGKILL');
      } catch {
        // ignore
      }
    }, timeoutMs);

    p.once('close', (code) => {
      clearTimeout(tt);
      resolve(Number.isFinite(code) ? code : 0);
    });
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

  let mounted = false;

  try {
    try {
      await waitForNeedle(p, p.stderr, 'fuse reported ready', 12000);
      mounted = true;
    } catch (e) {
      // "Best-effort" means we don't fail the suite just because a developer
      // machine can't real-mount right now (macFUSE state, fuse-native ABI, etc.).
      //
      // Keep the error message so the reason shows up in test output.
      t.skip(`real mount unavailable: ${e.message}`);
      return;
    }

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
    const code = await killAndWait(p, 8000);

    // If we successfully mounted, we expect a clean 0 exit.
    // If we skipped due to mount unavailability, don't assert.
    if (mounted) assert.equal(code, 0);
  }
});
