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

test('run: requireFuseReady returns stable exit code even if shutdown times out', async () => {
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
      '// Intentionally do NOT print READY',
      'setInterval(() => {}, 1000);',
    ].join('\n')
  );

  const cfg = {
    backstore,
    mountpoint,
    fuseBin: process.execPath,
    fuseArgs: [fuseScript],
    requireFuseReady: true,
    fuseReadyTimeoutMs: 50,

    // Use a tiny shutdown timeout so shutdownBoth is likely to time out and throw.
    gatewayBin: '/bin/sleep',
    gatewayArgs: ['1000000'],

    shutdownTimeoutMs: 1,
  };

  const code = await run(cfg);
  assert.equal(code, EXIT.FUSE_NOT_READY);

  // Wait briefly for the fuse shim to write its pidfile. When `requireFuseReady`
  // fails very quickly (and shutdown timeouts are tiny), some platforms can end
  // up killing the child before the file hits disk.
  for (let i = 0; i < 50; i++) {
    if (fs.existsSync(fusePidFile)) break;
    await sleep(5);
  }
  assert.ok(fs.existsSync(fusePidFile), `expected pidfile to exist: ${fusePidFile}`);

  const pid = Number(fs.readFileSync(fusePidFile, 'utf8'));
  // Even if the wrapper reports a stable code, it should have tried to kill fuse.
  for (let i = 0; i < 50; i++) {
    if (!isAlive(pid)) break;
    await sleep(20);
  }
  assert.equal(isAlive(pid), false);
});
