# openclaw-protectfs

[![CI](https://github.com/Martin-Tech-Labs/openclaw-protectfs/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Martin-Tech-Labs/openclaw-protectfs/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)


macFUSE-based protective filesystem overlay for OpenClaw on macOS.

## Status
- **V1: COMPLETE** (see `tasks/STATUS.md` for the canonical tracker)

## What problem this solves
OpenClaw stores sensitive data under `~/.openclaw` (sessions, profiles, internal state). Tools and other same-user processes can often read those files.

This project provides a **path-compatible** mount over `~/.openclaw` that:
- keeps workspace data usable and plaintext
- stores everything else **encrypted at rest**
- enforces a **fail-closed** access policy for sensitive paths

## Components
- **Wrapper (`ocprotectfs-wrapper`)**
  - obtains the Key Encryption Key (KEK) from macOS Keychain (user presence)
  - mounts the FUSE filesystem at `~/.openclaw`
  - starts OpenClaw gateway as a child process
  - maintains a liveness socket so the FUSE layer can fail-closed if wrapper/gateway die

- **FUSE daemon (`ocprotectfs-fuse`)**
  - implements filesystem operations (getattr/readdir/open/read/write/rename/unlink/…)
  - classifies paths (workspace passthrough vs encrypted)
  - encrypts/decrypts non-workspace file contents
  - hides sidecar metadata files from the mounted view

- **Backstore (`~/.openclaw.real`)**
  - real on-disk storage
  - workspace subtree is stored as plaintext
  - sensitive subtree is stored as ciphertext + sidecars

- **OpenClaw gateway**
  - performs normal OpenClaw operations and reads/writes via the mounted `~/.openclaw`

## What are FUSE and macFUSE?
- **FUSE** (Filesystem in Userspace) lets you implement a filesystem in a normal user-space process.
- **macFUSE** is the macOS kernel extension + tooling that enables FUSE filesystems on macOS.

In this project, macFUSE routes file operations on `~/.openclaw` into our FUSE daemon, which then enforces policy and reads/writes the backstore.

## Policy (v1)
- Plaintext passthrough:
  - `~/.openclaw/workspace/**`
  - `~/.openclaw/workspace-joao/**`

- Encrypted-at-rest (everything else under `~/.openclaw/**`)
  - stored encrypted in `~/.openclaw.real`
  - each encrypted file has a wrapped per-file DEK sidecar `*.ocpfs.dek` (hidden from mount)

- Fail-closed rules for encrypted paths
  - deny access unless wrapper/gateway checks pass (v1 currently includes bring-up gating; see Security notes)

## Architecture diagram
```mermaid
flowchart TB
  subgraph UserSpace[User space: agent]
    W[wrapper — ocprotectfs-wrapper]
    F[FUSE daemon — ocprotectfs-fuse]
    G[OpenClaw gateway]
  end

  subgraph FS[Filesystem]
    M[mountpoint: ~/.openclaw]
    B[backstore: ~/.openclaw.real]
    K[Keychain item: KEK]
  end

  W -->|starts| F
  W -->|spawns| G
  W -->|gets KEK user presence| K
  W -->|passes KEK in-memory| F

  G -->|file ops| M
  M -->|FUSE ops| F
  F -->|plaintext passthrough| B
  F -->|encrypt/decrypt non-workspace| B
```

## Crypto diagram
```mermaid
flowchart LR
  P[Plaintext file bytes] -->|encrypt with per-file DEK| C[Ciphertext file]
  KEK[KEK Keychain-derived] -->|wrap/unwrap| DEK[DEK per file]
  DEK -->|AEAD XChaCha20-Poly1305| C
  C -->|decrypt| P
  DEK --> S[Sidecar: *.ocpfs.dek — wrapped DEK + metadata]
```

## Installation (developer)
### Prerequisites
- macOS
- macFUSE installed and enabled
- Node.js (use the same node runtime you use for OpenClaw)

### Clone + install
```bash
gh repo clone Martin-Tech-Labs/openclaw-protectfs
cd openclaw-protectfs
npm install
npm test
```

## Running (operator)
### First run / migration
On first mount, existing `~/.openclaw` contents are migrated into `~/.openclaw.real` (atomic rename) and a marker is written.

### Start wrapper
Run the wrapper which mounts FUSE and starts the gateway.

(Exact command names/flags are in-repo; this README is the single operator entrypoint.)

## Secrets / key storage
- **KEK**: stored in macOS Keychain (never written to disk)
- **DEKs**: per-file, wrapped by KEK and stored in `*.ocpfs.dek` sidecars in the backstore
- **Ciphertext**: stored in `~/.openclaw.real` for all non-workspace paths

## Security notes (v1)
Some bring-up flows use explicit env gates for testing (e.g. allowing gateway access checks). Those are not intended as the final trust boundary; the intended boundary is wrapper/gateway liveness + identity checks enforced at the FUSE layer.

## Repo workflow
- Work is tracked under `tasks/`.
- Toby authors PRs; Joao reviews (max 2 rounds).




## Running (v1)

### Environment variables (bring-up)
For v1 bring-up there is an explicit gate to fail closed unless authorized:
- `OCPROTECTFS_GATEWAY_ACCESS_ALLOWED=1`: enables encrypted-path access checks (bring-up/testing gate)

KEK handling (recommended):
- Wrapper retrieves/creates KEK from macOS Keychain (`service=ocprotectfs`, `account=kek`).
- Wrapper passes KEK to the FUSE daemon in-memory via an anonymous pipe FD (`--kek-fd`).

Legacy/testing-only:
- `OCPROTECTFS_KEK_B64`: base64-encoded 32-byte KEK (do not use for production runs)

### Start wrapper (spawns FUSE + gateway)
Wrapper entrypoint:

```bash
node wrapper/ocprotectfs.js --help
```

Example (best-effort) invocation:

```bash
# Use the repo's fuse daemon + the existing OpenClaw gateway node entry.
export OCPROTECTFS_GATEWAY_ACCESS_ALLOWED=1

# KEK will be retrieved/created in Keychain and passed to FUSE via FD (no env secret).
node wrapper/ocprotectfs.js   --require-fuse-ready   --fuse-bin "$(command -v node)"   --fuse-arg "$(pwd)/fusefs/ocprotectfs-fuse.js"   --gateway-bin "$(command -v node)"   --gateway-arg "/Users/agent/openclaw/node_modules/openclaw/dist/index.js"   --gateway-arg gateway   --gateway-arg --port   --gateway-arg 18789
```

## Safety / rollback

To stop and roll back:
1) Stop the wrapper process (SIGINT / SIGTERM).
2) Ensure the mount is unmounted (`umount ~/.openclaw` or the wrapper's best-effort unmount).
3) If you need to restore the original directory layout:
   - move `~/.openclaw` aside
   - move `~/.openclaw.real` back to `~/.openclaw`

## Contributing
- Canonical plan: `tasks/PLAN.md`
- Current status: `tasks/STATUS.md`
