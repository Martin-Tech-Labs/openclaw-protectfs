const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const nodePolicy = require('../../fusefs/src/policy');

function buildHelper() {
  // Gate to macOS so ubuntu-latest CI (no Swift toolchain) stays green.
  if (process.platform !== 'darwin') return null;

  try {
    execFileSync('swiftc', ['--version'], { stdio: 'ignore' });
  } catch {
    return null;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocpfs-swift-policy-'));
  const bin = path.join(tmp, 'policy-interop');

  const repoRoot = path.resolve(__dirname, '..', '..');
  const fuseSwift = path.join(repoRoot, 'fusefs-swift');

  execFileSync('swiftc', [
    '-O',
    path.join(fuseSwift, 'Sources', 'OcProtectFsFuse', 'Policy.swift'),
    path.join(fuseSwift, 'scripts', 'policy-interop', 'main.swift'),
    '-o',
    bin,
  ], { cwd: fuseSwift, stdio: 'inherit' });

  return bin;
}

function run(bin, args, env = {}) {
  return execFileSync(bin, args, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  }).trim();
}

function runFail(bin, args, env = {}) {
  try {
    run(bin, args, env);
    throw new Error('expected command to fail');
  } catch (e) {
    // execFileSync throws; pull stderr from message if present.
    const m = String(e.stderr || e.message || '');
    return m.trim();
  }
}

function withEnv(k, v, fn) {
  const old = process.env[k];
  if (v === undefined) {
    delete process.env[k];
  } else {
    process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    if (old === undefined) delete process.env[k];
    else process.env[k] = old;
  }
}

test('fusefs-swift: policy interop (Swift<->Node)', { skip: process.platform !== 'darwin' }, () => {
  const bin = buildHelper();
  if (!bin) return;

  // Normalization parity.
  {
    const cases = [
      { in: '', out: '.' },
      { in: '.', out: '.' },
      { in: 'a', out: 'a' },
      { in: 'a//b', out: 'a/b' },
      { in: 'a/./b', out: 'a/b' },
      { in: 'a/..', out: '.' },
      { in: 'a/b/..', out: 'a' },
    ];

    for (const tc of cases) {
      const node = nodePolicy.assertSafeRelative(tc.in);
      assert.equal(node, tc.out);

      const swift = run(bin, ['normalize', tc.in]);
      assert.equal(swift, tc.out);
    }
  }

  // Rejections parity (messages).
  {
    const bad = [
      { in: '/abs', msg: 'absolute paths not allowed' },
      { in: '../a', msg: 'path traversal not allowed' },
      { in: 'a/../../b', msg: 'path traversal not allowed' },
      { in: 'a\\b', msg: 'backslash not allowed in relative paths' },
    ];

    for (const tc of bad) {
      const input = tc.make ? tc.make() : tc.in;

      assert.throws(() => nodePolicy.assertSafeRelative(input), (e) => String(e.message).includes(tc.msg));

      const err = runFail(bin, ['normalize', input]);
      assert.ok(err.includes(tc.msg), err);
    }
  }

  // Classification parity with default prefixes.
  {
    const cases = [
      { rel: '.', storage: 'encrypted' },
      { rel: 'workspace/a.txt', storage: 'plaintext' },
      { rel: 'secrets/a.txt', storage: 'encrypted' },
    ];

    for (const tc of cases) {
      const node = nodePolicy.classifyPath(tc.rel);
      const swift = JSON.parse(run(bin, ['classify', tc.rel]));
      assert.equal(node.storage, tc.storage);
      assert.deepEqual(swift, node);
    }
  }

  // Classification parity with env override.
  withEnv('OCPROTECTFS_PLAINTEXT_PREFIXES', 'workspace,notes', () => {
    const nodeA = nodePolicy.classifyPath('notes/x.txt');
    const swiftA = JSON.parse(run(bin, ['classify', 'notes/x.txt'], { OCPROTECTFS_PLAINTEXT_PREFIXES: 'workspace,notes' }));
    assert.deepEqual(swiftA, nodeA);

    const nodeB = nodePolicy.classifyPath('workspace/x.txt');
    const swiftB = JSON.parse(run(bin, ['classify', 'workspace/x.txt'], { OCPROTECTFS_PLAINTEXT_PREFIXES: 'workspace,notes' }));
    assert.deepEqual(swiftB, nodeB);

    const nodeC = nodePolicy.classifyPath('secrets/x.txt');
    const swiftC = JSON.parse(run(bin, ['classify', 'secrets/x.txt'], { OCPROTECTFS_PLAINTEXT_PREFIXES: 'workspace,notes' }));
    assert.deepEqual(swiftC, nodeC);
  });
});
