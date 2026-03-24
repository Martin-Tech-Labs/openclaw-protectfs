# 11 — Wrapper best-effort unmount

Goal: have the wrapper attempt a best-effort unmount of the mountpoint during shutdown so we don't leave stale FUSE mounts behind.

## Scope

- Implement best-effort unmount during wrapper shutdown.
- Add a regression test asserting the wrapper invokes `umount` (via PATH override).
- Update lifecycle documentation accordingly.

## Out of scope

- Robust mount-detection / verification across platforms.
- Wrapper-owned mount lifecycle (performing the mount itself).

## Acceptance criteria

- [x] Wrapper attempts unmount during shutdown (after terminating child processes).
- [x] Wrapper ignores unmount failures (best-effort only).
- [x] New test covers unmount invocation.
- [x] `make test` passes.
