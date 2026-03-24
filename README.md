# openclaw-protectfs

macFUSE-based protective filesystem for the OpenClaw directory on macOS.

This repo is organized into incremental tasks under `tasks/`.

## Quick links
- Current task: `tasks/STATUS.md`
- Operator guide: `docs/operator-guide.md`
- Wrapper lifecycle: `docs/wrapper-lifecycle.md`
- Local macFUSE prerequisites (real-mount tests): `docs/local-macfuse.md`

## High-level goals
- Mount over `~/.openclaw` with path compatibility
- Workspace plaintext passthrough
- Everything else encrypted at rest and fail-closed
- Strict access: sensitive reads/writes only by OpenClaw gateway (PID + binary hash) and only while wrapper is alive

## Operator quickstart (v1)
- Read: `docs/operator-guide.md`
  - install/prereqs
  - what is encrypted vs plaintext
  - where secrets live (Keychain)
  - how to run + rollback
- For wrapper behavior and shutdown/unmount guarantees: `docs/wrapper-lifecycle.md`
- For running the best-effort real-mount tests locally: `docs/local-macfuse.md`
