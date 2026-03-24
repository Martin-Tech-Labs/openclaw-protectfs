const { classifyPath } = require('./policy-v1');

// Task 09 — FUSE core access control (v1)
//
// This is a *logic-only* “core” for ProtectFS FUSE operations.
// It decides whether an operation should be allowed or denied based on:
//  - path policy (plaintext vs encrypted)
//  - whether gateway identity/liveness checks have passed
//
// Rationale:
// The repo does not yet implement a real macFUSE mount. This module provides
// a stable contract + tests for future FUSE bindings.

const OPS = Object.freeze({
  READ: 'read',
  WRITE: 'write',
  CREATE: 'create',
  MKDIR: 'mkdir',
  RMDIR: 'rmdir',
  RENAME: 'rename',
  UNLINK: 'unlink',
  CHMOD: 'chmod',
  CHOWN: 'chown',
  UTIMENS: 'utimens',
  FSYNC: 'fsync',
  STATFS: 'statfs',
});

function isKnownOp(op) {
  return Object.values(OPS).includes(op);
}

function deny(code, reason) {
  return { ok: false, code, reason };
}

function allow(reason) {
  return { ok: true, reason };
}

/**
 * Decide whether a filesystem operation is allowed.
 *
 * @param {object} args
 * @param {string} args.op - operation name (see OPS)
 * @param {string} args.rel - POSIX-like relative path (no leading slash)
 * @param {boolean} [args.gatewayAccessAllowed=false] - whether the wrapper/core
 *   has validated gateway identity + liveness for sensitive operations.
 *
 * @returns {{ok: true, reason: string} | {ok: false, code: string, reason: string}}
 */
function authorizeOp({ op, rel, gatewayAccessAllowed = false }) {
  if (!isKnownOp(op)) return deny('EINVAL', `unknown op: ${String(op)}`);

  // classifyPath also enforces rel safety (no traversal, no absolute paths, ...)
  const cls = classifyPath(rel);

  if (!cls.requiresGatewayAccessChecks) {
    return allow(`policy: plaintext (${cls.reason})`);
  }

  if (!gatewayAccessAllowed) {
    // Fail closed.
    return deny('EACCES', 'gateway access checks required');
  }

  return allow(`policy: encrypted, gateway ok (${cls.reason})`);
}

module.exports = {
  OPS,
  authorizeOp,
};
