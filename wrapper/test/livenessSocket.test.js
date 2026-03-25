const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const { EXIT } = require('../src/run');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForExists(p, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(p)) return;
    await sleep(20);
  }
  throw new Error(`timeout waiting for path to exist: ${p}`);
}

function spawnWrapper({ cwd, backstore, mountpoint, fuseScript, gatewayScript, shutdownTimeoutMs = 1000 }) {
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
  });
}

async function connectOnce(sockPath) {
  return await new Promise((resolve, reject) => {
    const s = net.connect(sockPath);
    let buf = '';
    s.on('data', (d) => (buf += d.toString('utf8')));
    s.once('error', reject);
    s.once('end', () => resolve(buf));
  });
}

test('wrapper liveness socket: created, answers OK, removed on SIGTERM', async () => {
  // Keep paths short: unix socket paths have small length limits on macOS.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'o-'));
  const backstore = path.join(dir, 'b');
  const mountpoint = path.join(dir, 'm');

  const fuseScript = path.join(dir, 'fuse.js');
  fs.writeFileSync(
    fuseScript,
    [
      'console.log("READY");',
      'setInterval(() => {}, 1000);',
    ].join('\n'),
  );

  const gatewayStarted = path.join(dir, 'gateway.started');
  const gatewayScript = path.join(dir, 'gateway.js');
  fs.writeFileSync(
    gatewayScript,
    [
      'const fs = require("node:fs");',
      `fs.writeFileSync(${JSON.stringify(gatewayStarted)}, 'started');`,
      'setInterval(() => {}, 1000);',
    ].join('\n'),
  );

  const wrapper = spawnWrapper({ cwd: dir, backstore, mountpoint, fuseScript, gatewayScript, shutdownTimeoutMs: 1500 });
  const sockPath = path.join(mountpoint, '.ocpfs.sock');

  try {
    await waitForExists(sockPath);

    const reply = await connectOnce(sockPath);
    assert.match(reply, /OK/);

    // Ensure the wrapper reached the supervise() stage (signal handler installed).
    await waitForExists(gatewayStarted);

    wrapper.kill('SIGTERM');
    const exit = await new Promise((resolve) => wrapper.once('exit', (code, signal) => resolve({ code, signal })));
    assert.equal(exit.signal, null);
    assert.equal(exit.code, EXIT.OK);

    // Socket should be removed.
    for (let i = 0; i < 50; i++) {
      if (!fs.existsSync(sockPath)) break;
      await sleep(20);
    }
    assert.equal(fs.existsSync(sockPath), false);
  } finally {
    try {
      wrapper.kill('SIGKILL');
    } catch (_) {
      // ignore
    }
  }
});

test('wrapper liveness socket: fails if socket path is occupied by non-socket', async () => {
  // Keep paths short: unix socket paths have small length limits on macOS.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'o-'));
  const backstore = path.join(dir, 'b');
  const mountpoint = path.join(dir, 'm');
  fs.mkdirSync(mountpoint, { recursive: true, mode: 0o700 });

  const sockPath = path.join(mountpoint, '.ocpfs.sock');
  fs.writeFileSync(sockPath, 'not a socket');

  const fuseScript = path.join(dir, 'fuse.js');
  fs.writeFileSync(
    fuseScript,
    [
      'console.log("READY");',
      'setInterval(() => {}, 1000);',
    ].join('\n'),
  );

  const gatewayScript = path.join(dir, 'gateway.js');
  fs.writeFileSync(
    gatewayScript,
    [
      'setInterval(() => {}, 1000);',
    ].join('\n'),
  );

  const wrapper = spawnWrapper({ cwd: dir, backstore, mountpoint, fuseScript, gatewayScript, shutdownTimeoutMs: 500 });

  try {
    const exit = await new Promise((resolve) => wrapper.once('exit', (code, signal) => resolve({ code, signal })));
    assert.equal(exit.signal, null);
    assert.equal(exit.code, EXIT.LIVENESS);
  } finally {
    try {
      wrapper.kill('SIGKILL');
    } catch (_) {
      // ignore
    }
  }
});
