const path = require('node:path');

// Task 04 — Path policy + safety helpers.
//
// This module defines the initial *path classification* rules for ProtectFS.
// It is intentionally independent of macFUSE bindings so it can be unit tested.
//
// Policy (from tasks/01-design.md):
// - Plaintext passthrough for selected top-level prefixes (default: workspace/** and workspace-joao/**)
// - Encrypt-at-rest for everything else
//
// Notes:
// - FUSE paths are expected to be POSIX-like relative paths (no leading slash).
// - We defensively reject suspicious relative paths (`..`, backslashes, NUL).

const DEFAULT_PLAINTEXT_PREFIXES = Object.freeze(['workspace', 'workspace-joao']);

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

function normalizePlaintextPrefixes(prefixes) {
  if (prefixes == null) return null;
  if (!Array.isArray(prefixes)) throw new Error('plaintextPrefixes must be an array');

  const out = [];
  for (const p of prefixes) {
    const s = String(p).trim();
    if (!s) continue;
    if (s.includes('/')) throw new Error('plaintext prefix must be a single path segment');
    if (s === '.' || s === '..') throw new Error('invalid plaintext prefix');
    out.push(s);
  }

  // De-dupe while preserving order.
  return out.filter((p, i) => out.indexOf(p) === i);
}

function parseEnvPlaintextPrefixes() {
  const v = process.env.OCPROTECTFS_PLAINTEXT_PREFIXES;
  if (v == null) return null;

  // Allow explicit empty string to mean “no passthrough prefixes”.
  const s = String(v).trim();
  if (s.length === 0) return [];

  return normalizePlaintextPrefixes(s.split(',').map((x) => x.trim()));
}

function getPlaintextPrefixes(opts) {
  const fromOpts = normalizePlaintextPrefixes(opts && opts.plaintextPrefixes);
  if (fromOpts) return fromOpts;

  const fromEnv = parseEnvPlaintextPrefixes();
  if (fromEnv) return fromEnv;

  return DEFAULT_PLAINTEXT_PREFIXES;
}

function isPlaintextPath(rel, opts = {}) {
  const clean = assertSafeRelative(rel);
  if (clean === '.') return false;
  const [first] = clean.split('/');

  const prefixes = getPlaintextPrefixes(opts);
  return prefixes.includes(first);
}

function classifyPath(rel, opts = {}) {
  const clean = assertSafeRelative(rel);

  if (isPlaintextPath(clean, opts)) {
    return {
      rel: clean,
      storage: 'plaintext',
      // Plaintext paths are intended for collaborative/dev content.
      // Access control for them is out-of-scope for initial.
      requiresGatewayAccessChecks: false,
      reason: 'passthrough prefix',
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
  DEFAULT_PLAINTEXT_PREFIXES,
  assertSafeRelative,
  isPlaintextPath,
  classifyPath,
};
