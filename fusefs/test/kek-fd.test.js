const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const FUSE_BIN = path.join(__dirname, '..', 'ocprotectfs-fuse.js');
const STUB = path.join(__dirname, '_stub-fuse-native.js');

async function runFuseWithKek({ kekBuf, env = {}, extraArgs = [] }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ocpfs-kekfd-'));
  const backstore = path.join(base, 'backstore');
  const mountpoint = path.join(base, 'mountpoint');
  fs.mkdirSync(backstore);
  fs.mkdirSync(mountpoint);

  const args = ['-r', STUB, FUSE_BIN, '--backstore', backstore, '--mountpoint', mountpoint, ...extraArgs];

  // fd 3 is an anonymous pipe used for KEK transport.
  const p = spawn(process.execPath, args, {
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });

  // Write KEK (or partial KEK) to fd 3 then close.
  p.stdio[3].write(kekBuf);
  p.stdio[3].end();

  const out = await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    p.stderr.on('data', (d) => (stderr += d.toString('utf8')));

    let ready = false;
    const timer = setTimeout(() => {
      if (!ready) p.kill('SIGTERM');
    }, 2000);

    p.stdout.on('data', () => {
      if (!ready && stdout.includes('READY')) {
        ready = true;
        clearTimeout(timer);
        p.kill('SIGTERM');
      }
    });

    p.on('close', (code) => resolve({ code, stdout, stderr }));
  });

  return out;
}

test('ocprotectfs-fuse: --kek-fd reads exactly 32 bytes', async () => {
  const kek = Buffer.alloc(32, 7);
  const res = await runFuseWithKek({ kekBuf: kek, extraArgs: ['--kek-fd', '3'] });
  assert.equal(res.code, 0);
  assert.match(res.stdout, /READY/);
});

test('ocprotectfs-fuse: --kek-fd takes precedence over env', async () => {
  const kek = Buffer.alloc(32, 7);

  // If env was used, this would fail length validation (decodes to 1 byte).
  const badEnv = { OCPROTECTFS_KEK_B64: Buffer.from([1]).toString('base64') };

  const res = await runFuseWithKek({ kekBuf: kek, env: badEnv, extraArgs: ['--kek-fd', '3'] });
  assert.equal(res.code, 0);
  assert.match(res.stdout, /READY/);
});

test('ocprotectfs-fuse: wrong-length KEK on fd fails fast', async () => {
  const kek = Buffer.alloc(31, 7);
  const res = await runFuseWithKek({ kekBuf: kek, extraArgs: ['--kek-fd', '3'] });
  assert.equal(res.code, 2);
  assert.match(res.stderr, /wrong length/i);
});
