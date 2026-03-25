const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const { waitForReady } = require('../src/run');

function kill(child) {
  try {
    child.kill('SIGKILL');
  } catch (_) {
    // ignore
  }
}

test('waitForReady: resolves ok when READY appears', async () => {
  // Keep process alive long enough; waitForReady should resolve once READY is printed.
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => console.log("READY"), 50); setInterval(() => {}, 1000);'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const r = await waitForReady(child, { timeoutMs: 500, line: 'READY' });
    assert.equal(r.ok, true);
    assert.equal(typeof r.ms, 'number');
  } finally {
    kill(child);
  }
});

test('waitForReady: resolves not ok on timeout', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const r = await waitForReady(child, { timeoutMs: 100, line: 'READY' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'timeout');
  } finally {
    kill(child);
  }
});
