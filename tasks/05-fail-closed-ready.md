# Task 05 — Fail-closed readiness before starting Gateway

## Goal
Prevent the OpenClaw gateway from starting unless the FUSE daemon is confirmed “ready”, so the system fails closed (no gateway access to an unprotected/unmounted mountpoint).

This is a step towards the wrapper being a real root-of-trust.

## Acceptance criteria
- [ ] Wrapper CLI supports opt-in fail-closed readiness enforcement:
  - [ ] `--require-fuse-ready` (default: off to preserve skeleton placeholder behavior)
  - [ ] `--fuse-ready-timeout-ms <ms>` to configure the readiness wait
- [ ] When `--require-fuse-ready` is enabled and readiness is not detected within the timeout:
  - [ ] wrapper terminates the FUSE process and exits with a stable non-zero exit code (EXIT.FUSE_NOT_READY = 12)
  - [ ] gateway is **not** started
- [ ] Unit tests cover `waitForReady` behavior for:
  - [ ] ready detected
  - [ ] timeout (not ready)
- [ ] `make test` passes locally.

## Notes
- For now, readiness is a log-line based protocol (`READY`). Future work may replace this with a socket-based liveness protocol and/or mountpoint verification.
