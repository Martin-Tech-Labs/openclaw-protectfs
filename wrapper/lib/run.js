const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const { migrateLegacyOpenclaw } = require('./migrate');

const EXIT = {
  OK: 0,
  CONFIG: 2,
  PREPARE_FS: 3,
  LIVENESS: 4,
  MIGRATION: 5,
  FUSE_START: 10,
  FUSE_NOT_READY: 12,
  GATEWAY_START: 11,
  FUSE_DIED: 20,
  GATEWAY_DIED: 21,
  SHUTDOWN: 30,
};

function log(msg) {
  const ts = new Date().toISOString();
  process.stderr.write(`${ts} ${msg}\n`);
}

function teeChildOutput(child, name) {
  // Mirror child output to our stderr so users still see logs, while allowing
  // the wrapper to also inspect stdout/stderr for readiness signals.
  if (child.stdout) child.stdout.on('data', (d) => process.stderr.write(`[${name}:stdout] ${d}`));
  if (child.stderr) child.stderr.on('data', (d) => process.stderr.write(`[${name}:stderr] ${d}`));
}

function buildChildEnv(extraEnv = {}) {
  // Hardening: do not leak our full environment into child processes.
  // Keep a pragmatic allow-list for common process execution on macOS.
  const allow = [
    'PATH',
    'HOME',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TERM',
    'SHELL',
    'USER',
    'LOGNAME',
  ];

  const env = {};
  for (const k of allow) {
    if (Object.prototype.hasOwnProperty.call(process.env, k)) env[k] = process.env[k];
  }

  return { ...env, ...extraEnv };
}

async function waitForReady(child, opts) {
  const timeoutMs = opts && Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 2000;
  const needle = (opts && opts.line) || 'READY';

  const start = Date.now();
  return await new Promise((resolve) => {
    let bufOut = '';
    let bufErr = '';

    const tryConsume = (which, chunk) => {
      const s = chunk.toString('utf8');
      if (which === 'out') bufOut += s;
      else bufErr += s;

      const combined = bufOut + '\n' + bufErr;
      if (combined.includes(needle)) {
        cleanup();
        resolve({ ok: true, ms: Date.now() - start });
      }
    };

    const onExit = () => {
      cleanup();
      resolve({ ok: false, reason: 'exited', ms: Date.now() - start });
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve({ ok: false, reason: 'timeout', ms: Date.now() - start });
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      if (child.stdout) child.stdout.off('data', onOut);
      if (child.stderr) child.stderr.off('data', onErr);
      child.off('exit', onExit);
    };

    const onOut = (d) => tryConsume('out', d);
    const onErr = (d) => tryConsume('err', d);

    if (child.stdout) child.stdout.on('data', onOut);
    if (child.stderr) child.stderr.on('data', onErr);
    child.once('exit', onExit);
  });
}

function validateConfig(cfg) {
  if (!cfg) throw new Error('config missing');
  if (!cfg.backstore || !cfg.mountpoint) throw new Error('backstore and mountpoint must be set');
  if (!cfg.fuseBin) throw new Error('fuse-bin must be set');
  if (!cfg.gatewayBin) throw new Error('gateway-bin must be set');
  if (!Number.isFinite(cfg.shutdownTimeoutMs) || cfg.shutdownTimeoutMs <= 0)
    throw new Error('shutdown-timeout-ms must be > 0');
}

function assertNoSymlinkParents(absPath) {
  if (!path.isAbsolute(absPath)) throw new Error(`path must be absolute: ${absPath}`);

  const root = path.parse(absPath).root;
  // Walk from the root down, checking each existing path component.
  const rel = absPath.slice(root.length);
  const parts = rel.split(path.sep).filter(Boolean);

  let cur = root;
  for (const part of parts) {
    cur = path.join(cur, part);
    try {
      const st = fs.lstatSync(cur);
      if (st.isSymbolicLink()) {
        // macOS has historical symlinks like /var -> /private/var. These are
        // stable system paths and commonly appear in temp directories.
        // We still reject symlinks in user-controlled path components.
        if (cur === '/var' || cur === '/tmp') continue;
        throw new Error(`refusing symlink path component: ${cur}`);
      }
    } catch (e) {
      if (e && e.code === 'ENOENT') return;
      throw e;
    }
  }
}

function prepareDir(p, mode) {
  if (!path.isAbsolute(p)) throw new Error(`path must be absolute: ${p}`);
  const clean = path.resolve(p);

  // Hardening: reject symlinks anywhere in the path, not just the leaf.
  assertNoSymlinkParents(clean);

  try {
    const st = fs.lstatSync(clean);
    if (st.isSymbolicLink()) throw new Error(`refusing symlink path: ${clean}`);
    if (!st.isDirectory()) throw new Error(`path exists but is not a directory: ${clean}`);

    // Hardening: refuse overly-permissive directories (group/world writable).
    if ((st.mode & 0o022) !== 0) throw new Error(`refusing group/world-writable directory: ${clean}`);

    // Best-effort: ensure directory is at least as strict as requested.
    if (Number.isFinite(mode)) {
      try {
        fs.chmodSync(clean, mode);
      } catch (_) {
        // ignore
      }
    }

    return;
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      fs.mkdirSync(clean, { recursive: true, mode });
      // Ensure final perms aren't widened by umask.
      if (Number.isFinite(mode)) {
        try {
          fs.chmodSync(clean, mode);
        } catch (_) {
          // ignore
        }
      }
      return;
    }
    throw err;
  }
}

async function createLivenessSocket(mountpoint) {
  // Keep socket filename short to avoid unix domain socket path length limits
  // on macOS (sun_path is ~104 bytes).
  const sockPath = path.join(mountpoint, '.ocpfs.sock');

  // If a stale socket exists, remove it. If a non-socket exists, refuse.
  try {
    const st = fs.lstatSync(sockPath);
    if (st.isSocket()) fs.unlinkSync(sockPath);
    else throw new Error(`refusing to replace non-socket path: ${sockPath}`);
  } catch (e) {
    if (e && e.code !== 'ENOENT') throw e;
  }

  const server = net.createServer((c) => {
    // Simple contract: accept connections to prove wrapper is alive.
    c.end('OK\n');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(sockPath, () => resolve());
  });

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;

    await new Promise((resolve) => server.close(() => resolve()));
    try {
      fs.unlinkSync(sockPath);
    } catch (_) {
      // ignore
    }
  };

  return { path: sockPath, close };
}

async function run(cfg) {
  validateConfig(cfg);

  if (cfg.requireFuseReady) log('ocprotectfs: fail-closed enforcement enabled (require READY before gateway)');
  else log('ocprotectfs: NOTE: Task 02 skeleton; fail-closed enforcement disabled (gateway may start without READY)');

  try {
    prepareDir(cfg.backstore, 0o700);
    prepareDir(cfg.mountpoint, 0o700);
  } catch (e) {
    log(`prepare dirs failed: ${e.message}`);
    return EXIT.PREPARE_FS;
  }

  // Task 06: migrate any legacy content out of the mountpoint before we mount
  // over it (otherwise the data becomes hidden).
  const mig = migrateLegacyOpenclaw({ mountpoint: cfg.mountpoint, backstore: cfg.backstore });
  if (!mig.ok) {
    log(`migration failed: ${mig.code}: ${mig.message}`);
    return EXIT.MIGRATION;
  }
  if (mig.migrated) log(`migration complete: moved legacy mountpoint content to ${mig.legacyDir}`);

  // Task 05: liveness socket contract (v1)
  // - wrapper creates a unix socket in the mountpoint
  // - wrapper passes its path to both fuse and gateway via env
  // - wrapper removes the socket on shutdown
  let liveness;
  try {
    liveness = await createLivenessSocket(cfg.mountpoint);
    log(`liveness socket: ${liveness.path}`);
  } catch (e) {
    log(`liveness socket failed: ${e.message}`);
    return EXIT.LIVENESS;
  }

  const childEnv = buildChildEnv({ OCPROTECTFS_LIVENESS_SOCK: liveness.path });

  const fuse = spawn(cfg.fuseBin, cfg.fuseArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: childEnv,
  });
  fuse.unref();
  teeChildOutput(fuse, 'fuse');
  log(`starting fuse: ${cfg.fuseBin} ${cfg.fuseArgs.join(' ')}`);

  if (!fuse.pid) {
    await liveness.close();
    return EXIT.FUSE_START;
  }
  log(`fuse started pid=${fuse.pid}`);

  // Rudimentary readiness detection (Task 03): proceed once the fuse process
  // prints a READY line, or after a short timeout for legacy placeholders.
  const readyTimeoutMs = Number.isFinite(cfg.fuseReadyTimeoutMs) ? cfg.fuseReadyTimeoutMs : 2000;
  const ready = await waitForReady(fuse, { timeoutMs: readyTimeoutMs, line: 'READY' });
  if (ready.ok) {
    log(`fuse reported ready after ${ready.ms}ms`);
  } else {
    if (cfg.requireFuseReady) {
      log(`fuse readiness not detected (${ready.reason}); failing closed`);
      try {
        // Give the child a brief chance to run any early init (like writing a
        // pidfile) before we send termination signals. This makes behavior more
        // deterministic under heavy load and tiny readiness timeouts.
        await sleep(100);

        await shutdownBoth(fuse.pid, null, cfg.shutdownTimeoutMs);
      } catch (e) {
        // Best-effort: failing closed should still return a stable exit code
        // even if teardown times out.
        log(`shutdown error while failing closed: ${e.message}`);
      }
      await liveness.close();
      return EXIT.FUSE_NOT_READY;
    }
    log(`fuse readiness not detected (${ready.reason}); continuing`);
  }

  const gateway = spawn(cfg.gatewayBin, cfg.gatewayArgs, { stdio: 'inherit', detached: true, env: childEnv });
  gateway.unref();
  log(`starting gateway: ${cfg.gatewayBin} ${cfg.gatewayArgs.join(' ')}`);
  if (!gateway.pid) {
    await shutdownBoth(fuse.pid, null, cfg.shutdownTimeoutMs);
    await liveness.close();
    return EXIT.GATEWAY_START;
  }
  log(`gateway started pid=${gateway.pid}`);

  const code = await supervise(fuse, gateway, cfg.shutdownTimeoutMs, liveness);
  await liveness.close();
  return code;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function supervise(fuse, gateway, timeoutMs, liveness) {
  let done = false;

  const onSignal = async (sig) => {
    if (done) return;
    done = true;
    log(`signal ${sig} received; shutting down`);
    try {
      await shutdownBoth(fuse.pid, gateway.pid, timeoutMs);
      if (liveness) await liveness.close();
      process.exit(EXIT.OK);
    } catch (e) {
      log(`shutdown error: ${e.message}`);
      if (liveness) await liveness.close();
      process.exit(EXIT.SHUTDOWN);
    }
  };

  process.once('SIGINT', () => onSignal('SIGINT'));
  process.once('SIGTERM', () => onSignal('SIGTERM'));

  const fuseExit = onceExit(fuse, 'fuse');
  const gwExit = onceExit(gateway, 'gateway');

  const first = await Promise.race([fuseExit, gwExit]);
  if (done) return EXIT.OK;
  done = true;

  log(`${first.name} exited (code=${first.code}); shutting down`);
  await shutdownBoth(fuse.pid, gateway.pid, timeoutMs);
  if (liveness) await liveness.close();
  return first.name === 'fuse' ? EXIT.FUSE_DIED : EXIT.GATEWAY_DIED;
}

function onceExit(child, name) {
  return new Promise((resolve) => {
    // Child might have already exited before we attached listeners.
    if (child.exitCode !== null || child.signalCode) {
      const code = child.signalCode ? 128 : child.exitCode;
      return resolve({ name, code: Number.isFinite(code) ? code : 0 });
    }

    child.once('exit', (code, signal) => {
      if (signal) return resolve({ name, code: 128 });
      resolve({ name, code: Number.isFinite(code) ? code : 0 });
    });
  });
}

async function shutdownBoth(fusePid, gatewayPid, timeoutMs) {
  // TODO (Task 03+): unmount mountpoint cleanly.
  if (gatewayPid) terminateProcessGroup(gatewayPid, 'SIGTERM');
  if (fusePid) terminateProcessGroup(fusePid, 'SIGTERM');

  // Hardening: if callers configure an extremely small timeout, still allow a
  // minimal grace period before escalating to SIGKILL. The polling interval is
  // 50ms, so timeouts smaller than that would otherwise skip the wait entirely.
  const effectiveTimeoutMs = Math.max(Number(timeoutMs) || 0, 50);

  const deadline = Date.now() + effectiveTimeoutMs;
  while (Date.now() < deadline) {
    const gwAlive = gatewayPid ? isAlive(gatewayPid) : false;
    const fuseAlive = fusePid ? isAlive(fusePid) : false;
    if (!gwAlive && !fuseAlive) return;
    await sleep(50);
  }

  if (gatewayPid) terminateProcessGroup(gatewayPid, 'SIGKILL');
  if (fusePid) terminateProcessGroup(fusePid, 'SIGKILL');
  throw new Error('timeout waiting for children to exit');
}

function terminateProcessGroup(pid, sig) {
  // Best-effort: try process group first (detached children), then fall back to
  // direct PID kill in case the platform did not create a new group.
  try {
    // Negative PID targets the process group when the child is spawned detached.
    process.kill(-pid, sig);
    return;
  } catch (_) {
    // fall through
  }

  try {
    process.kill(pid, sig);
  } catch (_) {
    // ignore
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { run, validateConfig, prepareDir, waitForReady, buildChildEnv, EXIT };
