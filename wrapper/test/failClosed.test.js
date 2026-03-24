const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { run, EXIT } = require('../lib/run');

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

test('run: requireFuseReady fails closed (kills fuse; does not start gateway)', async () => {
  // Keep paths short: unix socket paths have small length limits on macOS.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'o-'));
  const backstore = path.join(dir, 'b');
  const mountpoint = path.join(dir, 'm');
  const markerGateway = path.join(dir, 'gateway.started');
  const fusePidFile = path.join(dir, 'fuse.pid');

  const fuseScript = path.join(dir, 'fuse.js');
  fs.writeFileSync(
    fuseScript,
    [
      'const fs = require("node:fs");',
      `fs.writeFileSync(${JSON.stringify(fusePidFile)}, String(process.pid));`,
      '// Intentionally do NOT print READY',
      'setInterval(() => {}, 1000);',
    ].join('\n')
  );

  const gatewayScript = path.join(dir, 'gateway.js');
  fs.writeFileSync(
    gatewayScript,
    [
      'const fs = require("node:fs");',
      `fs.writeFileSync(${JSON.stringify(markerGateway)}, 'started');`,
      'setInterval(() => {}, 1000);',
    ].join('\n')
  );

  const cfg = {
    backstore,
    mountpoint,
    fuseBin: process.execPath,
    fuseArgs: [fuseScript],
    requireFuseReady: true,
    fuseReadyTimeoutMs: 100,

    gatewayBin: process.execPath,
    gatewayArgs: [gatewayScript],

    shutdownTimeoutMs: 1000,
  };

  const code = await run(cfg);
  assert.equal(code, EXIT.FUSE_NOT_READY);

  // Gateway should never have been spawned.
  assert.equal(fs.existsSync(markerGateway), false);

  // The fuse process should have been terminated.
  const pid = Number(fs.readFileSync(fusePidFile, 'utf8'));
  for (let i = 0; i < 20; i++) {
    if (!isAlive(pid)) break;
    await sleep(50);
  }
  assert.equal(isAlive(pid), false);
});
