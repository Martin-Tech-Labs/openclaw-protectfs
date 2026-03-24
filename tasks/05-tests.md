# Task 05 — Tests (acceptance + policy + wrapper/fuse lifecycle)

## Goal
Raise confidence that ProtectFS behaves safely and predictably under common OpenClaw workflows.

## Scope (v1)
- Add/expand **acceptance-style tests** around wrapper + FUSE skeleton lifecycle:
  - wrapper fails closed when `--require-fuse-ready` and READY is not observed
  - wrapper cleanly shuts down child process groups on signal / child exit
  - wrapper shuts down the *other* child when one dies (FUSE→gateway and gateway→FUSE)
- Add a minimal **liveness socket contract**:
  - wrapper creates a unix socket in the mountpoint (short name to avoid macOS path limits)
  - wrapper passes socket path to both children via `OCPROTECTFS_LIVENESS_SOCK`
  - wrapper removes the socket on shutdown
- Add tests for **path policy enforcement hooks** as FUSE layer becomes real (future tasks):
  - plaintext vs encrypted path classification influences storage decisions
  - encrypted paths require gateway access checks (hook only for now)

## Notes
- Many tests are already present (crypto, keychain, wrapper run, fuse skeleton readiness). This task is about tightening lifecycle and adding any missing edge cases.

## Acceptance criteria
- [x] `make test` covers wrapper shutdown/lifecycle edge cases (SIGTERM, child death, process-group teardown).
- [x] Tests cover wrapper liveness socket contract (create/connect/remove; occupied path fails closed).
- [x] Tests remain deterministic (no long sleeps; use short timeouts).
- [x] Document any known limitations in `tasks/STATUS.md`.

## Implementation notes
- Several tests intentionally use very short temp paths (`/tmp/o-*`) because unix socket paths have small length limits on macOS; long `/var/folders/.../ocpfs-*` paths can cause `listen EINVAL`.
