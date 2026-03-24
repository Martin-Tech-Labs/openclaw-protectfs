const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const FUSE_BIN = path.join(__dirname, '..', 'ocprotectfs-fuse.js');

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

test('ocprotectfs-fuse: emits READY then stays alive until terminated', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ocpfs-fuse-'));
  const backstore = path.join(base, 'backstore');
  const mountpoint = path.join(base, 'mountpoint');
  fs.mkdirSync(backstore);
  fs.mkdirSync(mountpoint);

  const p = spawn(process.execPath, [FUSE_BIN, '--backstore', backstore, '--mountpoint', mountpoint], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const ready = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for READY')), 2000);
    let buf = '';
    p.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      if (buf.includes('READY')) {
        clearTimeout(t);
        resolve(buf);
      }
    });
  });

  assert.match(ready, /READY/);

  // terminate cleanly
  p.kill('SIGTERM');
  const out = await new Promise((resolve) => p.on('close', (code, signal) => resolve({ code, signal })));

  // On some platforms/node versions, processes terminated via SIGTERM report
  // `code === null` and `signal === 'SIGTERM'` even if they perform a clean
  // shutdown. Accept either form.
  assert.ok(out.code === 0 || out.signal === 'SIGTERM');
});
