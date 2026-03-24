# Task 16 — expand real-mount editor ops + wrapper-integrated e2e + local macFUSE prerequisites

## Goal
Expand the **real macFUSE mount** coverage to include common editor/file-manager operations that require additional FUSE ops:

- `chmod`
- `utimens` (mtime/atime updates)
- `fsync`
- `statfs`

Also add a **wrapper-integrated end-to-end test** that verifies the wrapper can spawn the real FUSE daemon, wait for readiness, and successfully serve basic workspace passthrough I/O.

Finally, document **local macFUSE prerequisites** so contributors can run the best-effort real-mount suite.

## Why
- Editors and OS services often call metadata + filesystem ops in addition to basic read/write.
- Missing ops can surface as intermittent failures (save dialogs, atomic save, permission tweaks, “disk full” checks via statfs).
- A wrapper-level e2e test catches wiring regressions that pure fuse tests can’t.

## Scope
- Implement + wire these ops in `fusefs/lib/fuse-ops-v1.js`:
  - `chmod`, `utimens`, `fsync`, `statfs`
- Extend best-effort real-mount tests in `fusefs/test/ocprotectfs-fuse.test.js`
- Add wrapper e2e test in `wrapper/test/**` (skipped when prerequisites missing)
- Add local prerequisites doc under `docs/`

## Acceptance criteria
- [x] `npm test` passes in CI (real-mount tests are skipped when prerequisites are missing)
- [x] On a local macOS machine with macFUSE + `fuse-native`, the real-mount suite runs and covers chmod/utimens/fsync/statfs
- [x] Wrapper e2e test proves: wrapper starts fuse, detects READY, and workspace passthrough works end-to-end
- [x] Local macFUSE prerequisites are documented and linked from README

## Implementation notes
- Implemented ops in `fusefs/lib/fuse-ops-v1.js`: `chmod`, `utimens`, `fsync`, `statfs`.
- Hardened `utimens` to accept both `Date` values and timespec-like objects (`{tv_sec,tv_nsec}`), which `fuse-native` may supply.
- Real-mount coverage lives in `fusefs/test/ocprotectfs-fuse.test.js` (best-effort + skipped without prerequisites).
- Wrapper-integrated e2e coverage lives in `wrapper/test/e2e-real-mount.test.js` (best-effort + skipped without prerequisites).
- Local prerequisites documented in `docs/local-macfuse.md` and linked from the repo README.

## Notes / risks
- `fsync` and `statfs` behavior can vary by filesystem; keep assertions minimal (e.g., statfs bsize > 0).
- Real mounts can leave stale mounts behind on crashes; tests must always attempt clean shutdown.
