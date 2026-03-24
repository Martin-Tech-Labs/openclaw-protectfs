const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXIT = {
  OK: 0,
  FUSE_DIED: 20,
  GATEWAY_DIED: 21,
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

async function waitForFile(p, { timeoutMs = 2000, proc, capture } = {}) {
  const deadline = Date.now() + timeoutMs;
  const cap = () => {
    try {
      return typeof capture === 'function' ? capture() : capture;
    } catch (_) {
      return '';
    }
  };

  while (Date.now() < deadline) {
    if (fs.existsSync(p)) return;
    if (proc && proc.exitCode !== null) {
      const label = cap();
      throw new Error(`process exited while waiting for file: ${p} (exitCode=${proc.exitCode})${label ? `\n${label}` : ''}`);
    }
    await sleep(20);
  }
  const label = cap();
  throw new Error(`timeout waiting for file: ${p}${label ? `\n${label}` : ''}`);
}

function spawnWrapper({ cwd, backstore, mountpoint, fuseScript, gatewayScript, shutdownTimeoutMs = 1000, env = {} }) {
  const wrapperBin = path.join(__dirname, '..', 'ocprotectfs.js');
  const args = [
    wrapperBin,
    '--backstore',
    backstore,
    '--mountpoint',
    mountpoint,
    '--fuse-bin',
    process.execPath,
    '--fuse-arg',
    fuseScript,
    '--gateway-bin',
    process.execPath,
    '--gateway-arg',
    gatewayScript,
    '--require-fuse-ready',
    '--fuse-ready-timeout-ms',
    '500',
    '--shutdown-timeout-ms',
    String(shutdownTimeoutMs),
  ];

  return spawn(process.execPath, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
}

test('wrapper lifecycle: SIGTERM shuts down fuse+gateway process groups', async () => {
  // Keep paths short: unix socket paths have small length limits on macOS.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'o-'));
  const backstore = path.join(dir, 'b');
  const mountpoint = path.join(dir, 'm');

  const fusePidFile = path.join(dir, 'fuse.pid');
  const fuseChildPidFile = path.join(dir, 'fuse.child.pid');
  const gatewayPidFile = path.join(dir, 'gateway.pid');
  const gatewayChildPidFile = path.join(dir, 'gateway.child.pid');

  const fuseScript = path.join(dir, 'fuse.js');
  fs.writeFileSync(
    fuseScript,
    [
      'const fs = require("node:fs");',
      'const { spawn } = require("node:child_process");',
      `fs.writeFileSync(${JSON.stringify(fusePidFile)}, String(process.pid));`,
      'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);',
      `fs.writeFileSync(${JSON.stringify(fuseChildPidFile)}, String(child.pid));`,
      'console.log("READY");',
      'setInterval(() => {}, 1000);',
    ].join('\n'),
  );

  const gatewayScript = path.join(dir, 'gateway.js');
  fs.writeFileSync(
    gatewayScript,
    [
      'const fs = require("node:fs");',
      'const { spawn } = require("node:child_process");',
      `fs.writeFileSync(${JSON.stringify(gatewayPidFile)}, String(process.pid));`,
      'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);',
      `fs.writeFileSync(${JSON.stringify(gatewayChildPidFile)}, String(child.pid));`,
      'setInterval(() => {}, 1000);',
    ].join('\n'),
  );

  const wrapper = spawnWrapper({ cwd: dir, backstore, mountpoint, fuseScript, gatewayScript, shutdownTimeoutMs: 1500 });

  let buf = '';
  if (wrapper.stderr) wrapper.stderr.on('data', (d) => (buf += d.toString('utf8')));
  if (wrapper.stdout) wrapper.stdout.on('data', (d) => (buf += d.toString('utf8')));

  try {
    await waitForFile(fusePidFile, { proc: wrapper, capture: () => buf });
    await waitForFile(fuseChildPidFile, { proc: wrapper, capture: () => buf });
    await waitForFile(gatewayPidFile, { proc: wrapper, capture: () => buf });
    await waitForFile(gatewayChildPidFile, { proc: wrapper, capture: () => buf });

    // Give the wrapper a brief moment to finish its supervise() wiring.
    await sleep(50);

    wrapper.kill('SIGTERM');

    const exit = await new Promise((resolve) => wrapper.once('exit', (code, signal) => resolve({ code, signal })));
    assert.equal(exit.signal, null);
    assert.equal(exit.code, EXIT.OK);

    const fusePid = Number(fs.readFileSync(fusePidFile, 'utf8'));
    const fuseChildPid = Number(fs.readFileSync(fuseChildPidFile, 'utf8'));
    const gatewayPid = Number(fs.readFileSync(gatewayPidFile, 'utf8'));
    const gatewayChildPid = Number(fs.readFileSync(gatewayChildPidFile, 'utf8'));

    // Wrapper uses process-group kills; verify both the daemon and its child are gone.
    for (let i = 0; i < 50; i++) {
      if (!isAlive(fusePid) && !isAlive(fuseChildPid) && !isAlive(gatewayPid) && !isAlive(gatewayChildPid)) break;
      await sleep(50);
    }

    assert.equal(isAlive(fusePid), false);
    assert.equal(isAlive(fuseChildPid), false);
    assert.equal(isAlive(gatewayPid), false);
    assert.equal(isAlive(gatewayChildPid), false);
  } finally {
    try {
      wrapper.kill('SIGKILL');
    } catch (_) {
      // ignore
    }
  }
});

test('wrapper lifecycle: SIGINT shuts down fuse+gateway process groups', async () => {
  // Keep paths short: unix socket paths have small length limits on macOS.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'o-'));
  const backstore = path.join(dir, 'b');
  const mountpoint = path.join(dir, 'm');

  const fusePidFile = path.join(dir, 'fuse.pid');
  const fuseChildPidFile = path.join(dir, 'fuse.child.pid');
  const gatewayPidFile = path.join(dir, 'gateway.pid');
  const gatewayChildPidFile = path.join(dir, 'gateway.child.pid');

  const fuseScript = path.join(dir, 'fuse.js');
  fs.writeFileSync(
    fuseScript,
    [
      'const fs = require("node:fs");',
      'const { spawn } = require("node:child_process");',
      `fs.writeFileSync(${JSON.stringify(fusePidFile)}, String(process.pid));`,
      'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);',
      `fs.writeFileSync(${JSON.stringify(fuseChildPidFile)}, String(child.pid));`,
      'console.log("READY");',
      'setInterval(() => {}, 1000);',
    ].join('\n'),
  );

  const gatewayScript = path.join(dir, 'gateway.js');
  fs.writeFileSync(
    gatewayScript,
    [
      'const fs = require("node:fs");',
      'const { spawn } = require("node:child_process");',
      `fs.writeFileSync(${JSON.stringify(gatewayPidFile)}, String(process.pid));`,
      'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);',
      `fs.writeFileSync(${JSON.stringify(gatewayChildPidFile)}, String(child.pid));`,
      'setInterval(() => {}, 1000);',
    ].join('\n'),
  );

  const wrapper = spawnWrapper({ cwd: dir, backstore, mountpoint, fuseScript, gatewayScript, shutdownTimeoutMs: 1500 });

  let buf = '';
  if (wrapper.stderr) wrapper.stderr.on('data', (d) => (buf += d.toString('utf8')));
  if (wrapper.stdout) wrapper.stdout.on('data', (d) => (buf += d.toString('utf8')));

  try {
    await waitForFile(fusePidFile, { proc: wrapper, capture: () => buf });
    await waitForFile(fuseChildPidFile, { proc: wrapper, capture: () => buf });
    await waitForFile(gatewayPidFile, { proc: wrapper, capture: () => buf });
    await waitForFile(gatewayChildPidFile, { proc: wrapper, capture: () => buf });

    // Give the wrapper a brief moment to finish its supervise() wiring.
    await sleep(50);

    wrapper.kill('SIGINT');

    const exit = await new Promise((resolve) => wrapper.once('exit', (code, signal) => resolve({ code, signal })));
    assert.equal(exit.signal, null);
    assert.equal(exit.code, EXIT.OK);

    const fusePid = Number(fs.readFileSync(fusePidFile, 'utf8'));
    const fuseChildPid = Number(fs.readFileSync(fuseChildPidFile, 'utf8'));
    const gatewayPid = Number(fs.readFileSync(gatewayPidFile, 'utf8'));
    const gatewayChildPid = Number(fs.readFileSync(gatewayChildPidFile, 'utf8'));

    for (let i = 0; i < 50; i++) {
      if (!isAlive(fusePid) && !isAlive(fuseChildPid) && !isAlive(gatewayPid) && !isAlive(gatewayChildPid)) break;
      await sleep(50);
    }

    assert.equal(isAlive(fusePid), false);
    assert.equal(isAlive(fuseChildPid), false);
    assert.equal(isAlive(gatewayPid), false);
    assert.equal(isAlive(gatewayChildPid), false);
  } finally {
    try {
      wrapper.kill('SIGKILL');
    } catch (_) {
      // ignore
    }
  }
});

test('wrapper lifecycle: fuse exit triggers gateway shutdown (EXIT.FUSE_DIED)', async () => {
  // Keep paths short: unix socket paths have small length limits on macOS.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'o-'));
  const backstore = path.join(dir, 'b');
  const mountpoint = path.join(dir, 'm');

  const gatewayPidFile = path.join(dir, 'gateway.pid');

  const fuseScript = path.join(dir, 'fuse.js');
  fs.writeFileSync(
    fuseScript,
    [
      'console.log("READY");',
      // Exit shortly after ready.
      'setTimeout(() => process.exit(0), 80);',
    ].join('\n'),
  );

  const gatewayScript = path.join(dir, 'gateway.js');
  fs.writeFileSync(
    gatewayScript,
    [
      'const fs = require("node:fs");',
      `fs.writeFileSync(${JSON.stringify(gatewayPidFile)}, String(process.pid));`,
      'setInterval(() => {}, 1000);',
    ].join('\n'),
  );

  const wrapper = spawnWrapper({ cwd: dir, backstore, mountpoint, fuseScript, gatewayScript, shutdownTimeoutMs: 1500 });

  let buf = '';
  if (wrapper.stderr) wrapper.stderr.on('data', (d) => (buf += d.toString('utf8')));
  if (wrapper.stdout) wrapper.stdout.on('data', (d) => (buf += d.toString('utf8')));

  let gatewayPid = null;

  try {
    await waitForFile(gatewayPidFile, { proc: wrapper, capture: () => buf });
    gatewayPid = Number(fs.readFileSync(gatewayPidFile, 'utf8'));

    const exit = await new Promise((resolve) => wrapper.once('exit', (code, signal) => resolve({ code, signal })));
    assert.equal(exit.signal, null);
    assert.equal(exit.code, EXIT.FUSE_DIED, `expected exit code ${EXIT.FUSE_DIED} but got ${exit.code}`);

    for (let i = 0; i < 50; i++) {
      if (!isAlive(gatewayPid)) break;
      await sleep(50);
    }
    assert.equal(isAlive(gatewayPid), false, `gateway pid still alive after fuse exit: ${gatewayPid}`);
  } finally {
    try {
      wrapper.kill('SIGKILL');
    } catch (_) {
      // ignore
    }
    if (gatewayPid && isAlive(gatewayPid)) {
      try {
        process.kill(-gatewayPid, 'SIGKILL');
      } catch (_) {
        try {
          process.kill(gatewayPid, 'SIGKILL');
        } catch (_) {
          // ignore
        }
      }
    }
  }
});

test('wrapper lifecycle: gateway exit triggers fuse shutdown (EXIT.GATEWAY_DIED)', async () => {
  // Keep paths short: unix socket paths have small length limits on macOS.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'o-'));
  const backstore = path.join(dir, 'b');
  const mountpoint = path.join(dir, 'm');

  const fusePidFile = path.join(dir, 'fuse.pid');

  const fuseScript = path.join(dir, 'fuse.js');
  fs.writeFileSync(
    fuseScript,
    [
      'const fs = require("node:fs");',
      `fs.writeFileSync(${JSON.stringify(fusePidFile)}, String(process.pid));`,
      'console.log("READY");',
      'setInterval(() => {}, 1000);',
    ].join('\n'),
  );

  const gatewayScript = path.join(dir, 'gateway.js');
  fs.writeFileSync(
    gatewayScript,
    [
      // Exit shortly after start.
      'setTimeout(() => process.exit(0), 80);',
    ].join('\n'),
  );

  const wrapper = spawnWrapper({ cwd: dir, backstore, mountpoint, fuseScript, gatewayScript, shutdownTimeoutMs: 1500 });

  let buf = '';
  if (wrapper.stderr) wrapper.stderr.on('data', (d) => (buf += d.toString('utf8')));
  if (wrapper.stdout) wrapper.stdout.on('data', (d) => (buf += d.toString('utf8')));

  let fusePid = null;

  try {
    await waitForFile(fusePidFile, { proc: wrapper, capture: () => buf });
    fusePid = Number(fs.readFileSync(fusePidFile, 'utf8'));

    const exit = await new Promise((resolve) => wrapper.once('exit', (code, signal) => resolve({ code, signal })));
    assert.equal(exit.signal, null);
    assert.equal(exit.code, EXIT.GATEWAY_DIED, `expected exit code ${EXIT.GATEWAY_DIED} but got ${exit.code}`);

    for (let i = 0; i < 50; i++) {
      if (!isAlive(fusePid)) break;
      await sleep(50);
    }
    assert.equal(isAlive(fusePid), false, `fuse pid still alive after gateway exit: ${fusePid}`);
  } finally {
    try {
      wrapper.kill('SIGKILL');
    } catch (_) {
      // ignore
    }
    if (fusePid && isAlive(fusePid)) {
      try {
        process.kill(-fusePid, 'SIGKILL');
      } catch (_) {
        try {
          process.kill(fusePid, 'SIGKILL');
        } catch (_) {
          // ignore
        }
      }
    }
  }
});

test('wrapper lifecycle: best-effort unmount invoked on shutdown', async () => {
  // Keep paths short: unix socket paths have small length limits on macOS.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'o-'));
  const backstore = path.join(dir, 'b');
  const mountpoint = path.join(dir, 'm');

  // Put the fake binary under the repo (not os.tmpdir) to avoid noexec mounts
  // on some macOS setups.
  const binDir = fs.mkdtempSync(path.join(__dirname, 'bin-'));

  // Fake `umount` on PATH so we can assert the wrapper attempted cleanup.
  const umountBin = path.join(binDir, 'umount');
  fs.writeFileSync(umountBin, ['#!/bin/sh', 'exit 0'].join('\n'), { mode: 0o755 });

  const fuseScript = path.join(dir, 'fuse.js');
  fs.writeFileSync(
    fuseScript,
    ['console.log("READY");', 'setInterval(() => {}, 1000);'].join('\n'),
  );

  const gatewayScript = path.join(dir, 'gateway.js');
  fs.writeFileSync(gatewayScript, ['setInterval(() => {}, 1000);'].join('\n'));

  const wrapper = spawnWrapper({
    cwd: dir,
    backstore,
    mountpoint,
    fuseScript,
    gatewayScript,
    shutdownTimeoutMs: 1500,
    env: {
      PATH: `${binDir}`,
    },
  });

  let buf = '';
  if (wrapper.stderr) wrapper.stderr.on('data', (d) => (buf += d.toString('utf8')));
  if (wrapper.stdout) wrapper.stdout.on('data', (d) => (buf += d.toString('utf8')));

  try {
    // Wait until the wrapper has completed its early setup (mountpoint exists,
    // liveness socket created) so shutdown triggers unmount logic.
    await waitForFile(path.join(mountpoint, '.ocpfs.sock'), { proc: wrapper });

    // Give the wrapper a moment to attach SIGTERM/SIGINT handlers in supervise().
    await sleep(100);

    wrapper.kill('SIGTERM');

    const exit = await new Promise((resolve) => wrapper.once('exit', (code, signal) => resolve({ code, signal })));
    assert.equal(exit.signal, null);
    assert.equal(exit.code, EXIT.OK);

    assert.match(buf, /unmount cmd: umount/, `expected wrapper to attempt umount on shutdown; output was:\n${buf}`);
  } finally {
    try {
      wrapper.kill('SIGKILL');
    } catch (_) {
      // ignore
    }
    try {
      fs.rmSync(binDir, { recursive: true, force: true });
    } catch (_) {
      // ignore
    }
  }
});

