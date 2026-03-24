# openclaw-protectfs

macFUSE-based protective filesystem for the OpenClaw directory on macOS.

This repo is organized into incremental tasks under `tasks/`.

## Quick links
- Current task: `tasks/STATUS.md`

## High-level goals
- Mount over `~/.openclaw` with path compatibility
- Workspace plaintext passthrough
- Everything else encrypted at rest and fail-closed
- Strict access: sensitive reads/writes only by OpenClaw gateway (PID + binary hash) and only while wrapper is alive
