# Swift FUSE Daemon Rewrite (Issue #87)

Goal: replace the current Node.js FUSE daemon (`fusefs/ocprotectfs-fuse.js` + `fusefs/src/**`) with a **native macOS Swift executable** backed by **macFUSE**, while preserving:

- on-disk encryption format
- policy semantics (plaintext prefixes, fail-closed liveness enforcement)
- supervisor <-> daemon interface contracts (KEK via FD, READY signaling)

This document is the implementation plan + interface contract so we can migrate incrementally without breaking existing workflows.

## Non-goals (first migration)

- Changing encryption (DEK/KEK format, file layout)
- Changing mountpoint/backstore defaults
- Windows/Linux support (macOS + macFUSE only)

## Current behavior (baseline)

Today the Node daemon:

- uses `fuse-native` to mount a filesystem at `--mountpoint`
- reads the KEK from an **anonymous pipe FD** (`--kek-fd <n>`) and derives per-file DEKs
- enforces policy:
  - plaintext prefixes allowed
  - everything else is encrypted + access is **fail-closed** unless liveness socket is present
- signals readiness by printing a `READY` line (observed by the supervisor when `--require-fuse-ready` is set)

## Target architecture

A single Swift executable, tentatively: `ocprotectfs-fuse`.

Core responsibilities:

1. **Mount + dispatch (macFUSE)**
   - Bind FUSE operations (open/read/write/readdir/getattr/rename/unlink/etc)
   - Maintain inode/path bookkeeping sufficient for tests and expected semantics

2. **Crypto + format compatibility**
   - Preserve the exact encrypted file format currently implemented in `fusefs/src/encrypted-file.js`.
   - Preserve `crypto.js` behavior: AEAD mode, nonce sizes, header layout.

3. **Policy enforcement**
   - Preserve `policy.js` semantics.
   - Preserve fail-closed behavior tied to the liveness UNIX socket.

4. **Supervisor contract**
   - Read KEK via `--kek-fd <n>` (32 bytes)
   - Read `OCPROTECTFS_LIVENESS_SOCK` from env
   - Emit `READY` exactly once when mount is established and daemon is serving operations

## CLI contract (v0)

Mirror the current Node CLI surface so `wrapper/` (Node supervisor) and future Swift supervisor can launch it without changes.

Required flags:

- `--mountpoint <path>`
- `--backstore <path>`
- `--kek-fd <n>`
- `--plaintext-prefix <path>` (repeatable)

Optional flags:

- `--debug` (verbose logs)
- `--print-ready` (default true; for tests)

## Migration strategy (incremental)

### Phase 0: land design + skeleton (this PR)

- Add this design doc
- Add a Swift Package skeleton that builds a placeholder executable (not yet used)

### Phase 1: reuse JS crypto semantics as a spec

- Freeze the on-disk format by documenting:
  - header bytes
  - AEAD details
  - key derivation
  - file layout
- Add cross-language “golden vector” tests:
  - JS produces ciphertext that Swift can decrypt and vice-versa

### Phase 2: implement non-mount core in Swift

- Implement:
  - KEK FD reading
  - DEK store behavior
  - encrypted file read/write/append semantics
  - policy checks + liveness socket probe

### Phase 3: mount operations

- Add macFUSE bindings (likely via a small C shim or Swift bridging header)
- Implement required ops to satisfy unit + acceptance tests

### Phase 4: switch runtime behind a flag

- Supervisor chooses between:
  - Node daemon: `node fusefs/ocprotectfs-fuse.js`
  - Swift daemon: `./fusefs-swift/.build/release/ocprotectfs-fuse`

### Phase 5: make Swift default + remove Node

## Open questions / risks

- Best Swift<->macFUSE integration path (C shim vs existing Swift wrapper)
- Correctness of rename/link semantics for encrypted paths
- Performance considerations (streaming crypto, page sizes)

## Acceptance criteria

- `npm test` remains green throughout migration.
- The real-mount acceptance suite passes on a macOS machine with macFUSE.
- The supervisor/daemon interface remains stable:
  - KEK via FD
  - `READY` line contract
  - liveness socket fail-closed gate
