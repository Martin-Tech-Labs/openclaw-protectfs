const test = require('node:test');
const assert = require('node:assert/strict');

const { assertSafeRelative, isPlaintextPath, classifyPath } = require('../lib/policy-v1');

test('policy-v1: assertSafeRelative normalizes and rejects traversal', () => {
  assert.equal(assertSafeRelative('a/b/../c'), 'a/c');
  assert.throws(() => assertSafeRelative('../a'), /traversal/i);
  assert.throws(() => assertSafeRelative('a/../../b'), /traversal/i);
});

test('policy-v1: assertSafeRelative rejects absolute and backslash paths', () => {
  assert.throws(() => assertSafeRelative('/etc/passwd'), /absolute/i);
  assert.throws(() => assertSafeRelative('a\\b'), /backslash/i);
});

test('policy-v1: plaintext passthrough for workspace/** and workspace-joao/**', () => {
  assert.equal(isPlaintextPath('workspace/file.txt'), true);
  assert.equal(isPlaintextPath('workspace-joao/note.md'), true);
  assert.equal(isPlaintextPath('workspace'), true);
  assert.equal(isPlaintextPath('workspace-joao'), true);

  assert.equal(isPlaintextPath('workspacex/file.txt'), false);
  assert.equal(isPlaintextPath('secrets/key'), false);
});

test('policy-v1: classifyPath marks non-workspace paths as encrypted + access-checked', () => {
  const a = classifyPath('secrets/key');
  assert.equal(a.storage, 'encrypted');
  assert.equal(a.requiresGatewayAccessChecks, true);

  const b = classifyPath('workspace/file.txt');
  assert.equal(b.storage, 'plaintext');
  assert.equal(b.requiresGatewayAccessChecks, false);
});
