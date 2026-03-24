const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const EXIT = {
  OK: 0,
  CONFIG: 2,
  PREPARE_FS: 3,
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

function prepareDir(p, mode) {
  if (!path.isAbsolute(p)) throw new Error(`path must be absolute: ${p}`);
  const clean = path.resolve(p);

  try {
    const st = fs.lstatSync(clean);
    if (st.isSymbolicLink()) throw new Error(`refusing symlink path: ${clean}`);
    if (!st.isDirectory()) throw new Error(`path exists but is not a directory: ${clean}`);
    return;
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      fs.mkdirSync(clean, { recursive: true, mode });
      return;
    }
    throw err;
  }
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

  const fuse = spawn(cfg.fuseBin, cfg.fuseArgs, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  fuse.unref();
  teeChildOutput(fuse, 'fuse');
  log(`starting fuse: ${cfg.fuseBin} ${cfg.fuseArgs.join(' ')}`);

  if (!fuse.pid) return EXIT.FUSE_START;
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
        await shutdownBoth(fuse.pid, null, cfg.shutdownTimeoutMs);
      } catch (e) {
        // Best-effort: failing closed should still return a stable exit code
        // even if teardown times out.
        log(`shutdown error while failing closed: ${e.message}`);
      }
      return EXIT.FUSE_NOT_READY;
    }
    log(`fuse readiness not detected (${ready.reason}); continuing`);
  }

  const gateway = spawn(cfg.gatewayBin, cfg.gatewayArgs, { stdio: 'inherit', detached: true });
  gateway.unref();
  log(`starting gateway: ${cfg.gatewayBin} ${cfg.gatewayArgs.join(' ')}`);
  if (!gateway.pid) {
    await shutdownBoth(fuse.pid, null, cfg.shutdownTimeoutMs);
    return EXIT.GATEWAY_START;
  }
  log(`gateway started pid=${gateway.pid}`);

  return await supervise(fuse, gateway, cfg.shutdownTimeoutMs);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function supervise(fuse, gateway, timeoutMs) {
  let done = false;

  const onSignal = async (sig) => {
    if (done) return;
    done = true;
    log(`signal ${sig} received; shutting down`);
    try {
      await shutdownBoth(fuse.pid, gateway.pid, timeoutMs);
      process.exit(EXIT.OK);
    } catch (e) {
      log(`shutdown error: ${e.message}`);
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
  return first.name === 'fuse' ? EXIT.FUSE_DIED : EXIT.GATEWAY_DIED;
}

function onceExit(child, name) {
  return new Promise((resolve) => {
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

  const deadline = Date.now() + timeoutMs;
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
  try {
    // Negative PID targets the process group when the child is spawned detached.
    process.kill(-pid, sig);
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

module.exports = { run, validateConfig, prepareDir, waitForReady, EXIT };
