# Task 04 — Policy (path classification + access-control hooks)

## Goal
Define and implement the v1 **path policy** for ProtectFS so the rest of the codebase can make consistent decisions about:

- which paths are stored plaintext vs encrypted-at-rest
- which paths should be considered **sensitive** and therefore require gateway identity + liveness checks

This task deliberately focuses on *pure logic* (no macFUSE bindings) so it is testable today.

## Policy (v1)
- Plaintext passthrough for:
  - `workspace/**`
  - `workspace-joao/**`
- Encrypt-at-rest for everything else.

## Security notes / limitations
- The policy module rejects suspicious relative paths (absolute paths, traversal `..`, backslashes, NUL). This is defense-in-depth.
- **Access control is not enforced yet** in the FUSE layer (the current FUSE process is a skeleton). The policy module marks encrypted paths as `requiresGatewayAccessChecks=true` as a hook for future FUSE ops.
- Plaintext paths currently do **not** require gateway checks (by design), because they are intended for collaborative/dev content and would otherwise break common tooling.

## Deliverables
- `fusefs/lib/policy-v1.js` with:
  - `assertSafeRelative(rel)`
  - `isPlaintextPath(rel)`
  - `classifyPath(rel)`
- Unit tests in `fusefs/test/policy-v1.test.js`

## Acceptance criteria
- [x] Plaintext passthrough classification matches design (`workspace/**`, `workspace-joao/**`).
- [x] Default classification for all other paths is encrypted.
- [x] Suspicious paths are rejected (`..`, absolute paths, backslashes).
- [x] `make test` passes.
