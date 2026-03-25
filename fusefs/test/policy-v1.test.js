const test = require('node:test');
const assert = require('node:assert/strict');

const { assertSafeRelative, isPlaintextPath, classifyPath, DEFAULT_PLAINTEXT_PREFIXES } = require('../src/policy-v1');

test('policy-v1: assertSafeRelative normalizes and rejects traversal', () => {
  assert.equal(assertSafeRelative('a/b/../c'), 'a/c');
  assert.throws(() => assertSafeRelative('../a'), /traversal/i);
  assert.throws(() => assertSafeRelative('a/../../b'), /traversal/i);
});

test('policy-v1: assertSafeRelative rejects absolute and backslash paths', () => {
  assert.throws(() => assertSafeRelative('/etc/passwd'), /absolute/i);
  assert.throws(() => assertSafeRelative('a\\b'), /backslash/i);
});

test('policy-v1: default plaintext passthrough prefixes match legacy behavior', () => {
  assert.deepEqual(DEFAULT_PLAINTEXT_PREFIXES, ['workspace', 'workspace-joao']);

  assert.equal(isPlaintextPath('workspace/file.txt'), true);
  assert.equal(isPlaintextPath('workspace-joao/note.md'), true);
  assert.equal(isPlaintextPath('workspace'), true);
  assert.equal(isPlaintextPath('workspace-joao'), true);

  assert.equal(isPlaintextPath('workspacex/file.txt'), false);
  assert.equal(isPlaintextPath('secrets/key'), false);
});

test('policy-v1: configurable plaintextPrefixes overrides defaults', () => {
  assert.equal(isPlaintextPath('scratch/a.txt', { plaintextPrefixes: ['scratch'] }), true);
  assert.equal(isPlaintextPath('workspace/a.txt', { plaintextPrefixes: ['scratch'] }), false);

  const cls = classifyPath('scratch/a.txt', { plaintextPrefixes: ['scratch'] });
  assert.equal(cls.storage, 'plaintext');
  assert.equal(cls.requiresGatewayAccessChecks, false);
});

test('policy-v1: classifyPath marks non-passthrough paths as encrypted + access-checked', () => {
  const a = classifyPath('secrets/key');
  assert.equal(a.storage, 'encrypted');
  assert.equal(a.requiresGatewayAccessChecks, true);

  const b = classifyPath('workspace/file.txt');
  assert.equal(b.storage, 'plaintext');
  assert.equal(b.requiresGatewayAccessChecks, false);
});

test('policy-v1: env OCPROTECTFS_PLAINTEXT_PREFIXES is used when no explicit plaintextPrefixes provided', () => {
  const prev = process.env.OCPROTECTFS_PLAINTEXT_PREFIXES;
  try {
    process.env.OCPROTECTFS_PLAINTEXT_PREFIXES = 'scratch, tmp';

    assert.equal(isPlaintextPath('scratch/a.txt'), true);
    assert.equal(isPlaintextPath('tmp/b.txt'), true);
    // Defaults should no longer apply when env is set.
    assert.equal(isPlaintextPath('workspace/a.txt'), false);
  } finally {
    if (prev == null) delete process.env.OCPROTECTFS_PLAINTEXT_PREFIXES;
    else process.env.OCPROTECTFS_PLAINTEXT_PREFIXES = prev;
  }
});
