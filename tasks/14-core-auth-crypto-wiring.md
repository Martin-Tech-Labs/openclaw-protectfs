# Task 14 — core-v1 authorization + crypto-v1 encrypted-at-rest wiring

## Goal
Wire the existing `core-v1` (authorization checks) and `crypto-v1` (encrypted-at-rest) logic into the **real** macFUSE mount path so that:

- `workspace/**` and `workspace-joao/**` behave as plaintext passthrough (per policy)
- all other paths are treated as **encrypted** and **access-checked**
- enforcement fails closed if gateway checks are missing/unavailable

## Scope
- FUSE mount daemon (`fusefs/ocprotectfs-fuse.js`)
- Policy layer (`policy-v1`) integration as needed
- Any glue code required to call gateway checks and apply crypto transforms

## Non-goals (for this task)
- Full editor-compat parity (`chmod/chown/utimens/fsync/statfs`) unless required for correctness
- Performance optimization (batching, caching)

## Plan (proposed)
1. Identify the single “source of truth” function that classifies a FUSE path into:
   - plaintext passthrough
   - encrypted + needs gateway authorization
2. For each FUSE op implemented in Task 13:
   - apply classification
   - if encrypted: map fuse path -> encrypted backing path and perform crypto transform
   - enforce gateway check before performing the operation
3. Ensure path-safety invariants:
   - reject traversal/escape attempts
   - refuse symlink surprises (match existing hardening stance)
4. Tests
   - unit tests for classification + path mapping
   - wrapper lifecycle tests to ensure fail-closed behavior remains true with the real mount daemon

## Acceptance criteria
- [ ] `npm test` passes
- [ ] Unit tests cover wiring for:
  - plaintext passthrough for `workspace/**` without gateway
  - fail-closed deny for encrypted paths without gateway
  - encrypted-at-rest behavior when gateway + KEK are present (ciphertext on disk + DEK sidecar)
- [ ] Encrypted paths are unreadable in the backstore (ciphertext on disk)
- [ ] Gateway authorization is required for encrypted paths; missing gateway -> deny (fail closed)
- [ ] Plaintext workspace paths remain usable without gateway

## Notes / risks
- Careful with errno mapping: operations must return correct negative errno values to avoid confusing apps.
- Avoid exposing any decrypted bytes to disk (temporary files) during read/write.
- Current wiring uses env-based stubs for v1 bring-up:
  - `OCPROTECTFS_GATEWAY_ACCESS_ALLOWED=1` gates encrypted-path access (default deny).
  - `OCPROTECTFS_KEK_B64` provides the 32-byte KEK (base64) for decrypt/encrypt.
- Encrypted file content is stored at the same relative backstore path as ciphertext, with a sidecar wrapped-DEK at `*.ocpfs.dek`.
