const path = require('node:path');

// Task 04 — Path policy + safety helpers.
//
// This module defines the v1 *path classification* rules for ProtectFS.
// It is intentionally independent of macFUSE bindings so it can be unit tested.
//
// Policy (from tasks/01-design.md):
// - Plaintext passthrough for `workspace/**` and `workspace-joao/**`
// - Encrypt-at-rest for everything else
//
// Notes:
// - FUSE paths are expected to be POSIX-like relative paths (no leading slash).
// - We defensively reject suspicious relative paths (`..`, backslashes, NUL).

function assertSafeRelative(rel) {
  if (typeof rel !== 'string') throw new Error('rel must be a string');
  if (rel.length === 0) return '.';
  if (rel.includes('\\')) throw new Error('backslash not allowed in relative paths');
  if (rel.includes('\0')) throw new Error('NUL not allowed in paths');

  // Treat all paths as POSIX so policy is stable across platforms.
  if (rel.startsWith('/')) throw new Error('absolute paths not allowed');

  const norm = path.posix.normalize(rel);

  // normalize("a/..") => "."; normalize("../a") => "../a"
  const parts = norm.split('/');
  if (parts.some((p) => p === '..')) throw new Error('path traversal not allowed');

  return norm;
}

function isPlaintextPath(rel) {
  const clean = assertSafeRelative(rel);
  if (clean === '.') return false;
  const [first] = clean.split('/');
  return first === 'workspace' || first === 'workspace-joao';
}

function classifyPath(rel) {
  const clean = assertSafeRelative(rel);

  if (isPlaintextPath(clean)) {
    return {
      rel: clean,
      storage: 'plaintext',
      // Plaintext paths are intended for collaborative/dev content.
      // Access control for them is out-of-scope for v1.
      requiresGatewayAccessChecks: false,
      reason: 'workspace passthrough',
    };
  }

  return {
    rel: clean,
    storage: 'encrypted',
    // Encrypted paths are considered sensitive; future FUSE ops should enforce
    // gateway identity + liveness checks before allowing reads/writes.
    requiresGatewayAccessChecks: true,
    reason: 'default encrypted',
  };
}

module.exports = {
  assertSafeRelative,
  isPlaintextPath,
  classifyPath,
};
