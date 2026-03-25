# Task 02 — Wrapper skeleton

## Goal
Create a minimal, testable wrapper CLI that:
- prepares the backstore + mountpoint directories safely
- starts the FUSE daemon first, then starts the OpenClaw gateway
- supervises both processes and shuts down cleanly

This task is **not** implementing the real FUSE filesystem or the full security model yet.

## Notes
- The wrapper is the future “root of trust” (see `docs/design.md`).
- For Task 02 we accept a **placeholder FUSE process** (e.g. `sleep`) and a placeholder gateway command.
- We must be careful about filesystem safety: no destructive behavior, refuse symlinks, require absolute paths.

## Acceptance criteria
- A CLI binary exists (name: `ocprotectfs`) with flags for:
  - `--backstore` (default `~/.openclaw.real`)
  - `--mountpoint` (default `~/.openclaw`)
  - `--fuse-bin` + repeatable `--fuse-arg`
  - `--gateway-bin` + repeatable `--gateway-arg`
  - `--shutdown-timeout`
- Wrapper behavior:
  - validates/creates backstore + mountpoint directories (no destructive behavior)
  - starts FUSE first, gateway second
  - supervises both; on signal or child exit, terminates the other
  - logs key lifecycle events with useful context
  - returns stable non-zero exit codes for start/supervision failures
- Unit tests cover:
  - config validation
  - directory safety checks (absolute path, reject symlink)
- `make test` passes locally.

## Future TODO (explicitly deferred)
- Real macFUSE mount + readiness detection.
- Unmount on shutdown.
- Keychain DEK retrieval with user presence.
- Liveness socket and FUSE fail-closed enforcement.
- Gateway executable hashing + PID pinning.
