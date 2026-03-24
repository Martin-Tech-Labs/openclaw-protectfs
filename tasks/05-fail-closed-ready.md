# Task 05 — Fail-closed readiness before starting Gateway

## Goal
Prevent the OpenClaw gateway from starting unless the FUSE daemon is confirmed “ready”, so the system fails closed (no gateway access to an unprotected/unmounted mountpoint).

This is a step towards the wrapper being a real root-of-trust.

## Acceptance criteria
- [x] Wrapper CLI supports opt-in fail-closed readiness enforcement:
  - [x] `--require-fuse-ready` (default: off to preserve skeleton placeholder behavior)
  - [x] `--fuse-ready-timeout-ms <ms>` to configure the readiness wait
- [x] When `--require-fuse-ready` is enabled and readiness is not detected within the timeout:
  - [x] wrapper terminates the FUSE process and exits with a stable non-zero exit code (EXIT.FUSE_NOT_READY = 12)
  - [x] gateway is **not** started
- [x] Unit tests cover `waitForReady` behavior for:
  - [x] ready detected
  - [x] timeout (not ready)
- [x] `make test` passes locally.

## Notes
- For now, readiness is a log-line based protocol (`READY`). Future work may replace this with a socket-based liveness protocol and/or mountpoint verification.
- Wrapper returns a stable `EXIT.FUSE_NOT_READY` even if teardown times out (best-effort kill), to avoid masking fail-closed semantics with a generic error code.
