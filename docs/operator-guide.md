# Operator Guide (v1)

This guide explains how to install, configure, and run **openclaw-protectfs**.

## What it is
A macFUSE-based protective filesystem overlay for OpenClaw on macOS:

- Mountpoint: `~/.openclaw` (path-compatible with OpenClaw)
- Backstore: `~/.openclaw.real`

Policy:
- `workspace/**` and `workspace-joao/**`: plaintext passthrough
- everything else: **encrypted at rest** in backstore + **fail-closed** access control

## Architecture
See diagrams:
- `docs/diagrams/architecture.mmd`
- `docs/diagrams/crypto.mmd`

## Prerequisites
- macOS
- macFUSE installed + enabled
- Node.js (matches your OpenClaw install; wrapper uses node runtime)

## Install
1) Clone repo
2) `npm install`
3) `npm test`

## Configure
### KEK (Key Encryption Key)
- Stored in **macOS Keychain** (v1)
- Access requires **user presence** (password prompt on Mac mini)

### Runtime env (v1 bring-up)
V1 currently uses an explicit bring-up gate to fail closed unless authorized:
- `OCPROTECTFS_GATEWAY_ACCESS_ALLOWED=1` enables encrypted-path access checks.
- `OCPROTECTFS_KEK_B64` must be set to a base64 32-byte KEK for encryption.

(These env gates are placeholders for bring-up/testing. They are **not** the final security boundary; the intended boundary is wrapper+gateway liveness + PID/binary identity checks enforced at the FUSE layer.)

## Run
### First run / migration
- Existing `~/.openclaw` contents are migrated into `~/.openclaw.real`.
- A marker file prevents repeated migration.

### Start wrapper
Run the wrapper which mounts FUSE and starts the gateway.

## Secrets and what is encrypted
### Encrypted at rest
All non-workspace paths under `~/.openclaw.real` are stored as ciphertext.

### Sidecar files
Per-file wrapped DEKs are stored as `*.ocpfs.dek` in the backstore and hidden from the mount view.

### Keychain
The KEK lives in Keychain (never written to disk).

## Troubleshooting
- If mount fails, wrapper should fail closed and avoid starting the gateway.
- Use the best-effort unmount commands printed by the wrapper logs.

## Rollback
- Stop wrapper
- Unmount
- Move `~/.openclaw.real` back to `~/.openclaw` if needed



## Rendering diagrams
GitHub can render Mermaid diagrams when embedded in Markdown fenced blocks.
For convenience, the diagrams are also embedded below.

### Architecture diagram
```mermaid
flowchart TB
  subgraph UserSpace[User space: agent]
    W[wrapper (ocprotectfs-wrapper)]
    F[FUSE daemon (ocprotectfs-fuse)]
    G[openclaw-gateway]
  end

  subgraph FS[Filesystem]
    M[(mountpoint ~/.openclaw)]
    B[(backstore ~/.openclaw.real)]
    K[(Keychain: KEK)]
  end

  W -->|starts| F
  W -->|spawns| G
  W -->|gets KEK (user presence)| K
  W -->|passes KEK in-memory| F

  G -->|file ops| M
  M -->|FUSE ops| F
  F -->|plaintext passthrough| B
  F -->|encrypt/decrypt non-workspace| B
```

### Crypto diagram
```mermaid
flowchart LR
  P[Plaintext file bytes] -->|encrypt with per-file DEK| C[Ciphertext file]
  KEK[KEK (Keychain-derived)] -->|wrap/unwrap| DEK[DEK (per file)]
  DEK -->|AEAD XChaCha20-Poly1305| C
  C -->|decrypt| P
  DEK --> S[Sidecar *.ocpfs.dek (wrapped DEK + metadata)]
```
