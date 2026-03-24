# Task 03 — FUSE FS skeleton

## Goal
Introduce a *real* (still minimal) FUSE filesystem process that can be launched by the wrapper, and provides a basic “pass-through” view of the backstore.

This is still not the full security model, but it should be a concrete, testable step beyond the placeholder `sleep` process.

## Notes
- Keep it simple: mount the backstore at the mountpoint.
- Prefer an implementation strategy that is feasible to test in CI (mocking where required).
- macFUSE specifics can be introduced gradually; prioritize a clean interface and clear lifecycle.

## Acceptance criteria
- A `fusefs/` entrypoint exists (binary/script) that can be used as `--fuse-bin`.
- The wrapper waits for basic readiness (even if rudimentary, e.g. a “ready” stdout line or a Unix socket).
- Unit tests cover:
  - argument parsing / config validation for the fusefs entrypoint
  - readiness signaling logic (mocked)
- `make test` passes locally.

## Future TODO (explicitly deferred)
- Fail-closed enforcement on unexpected FUSE behavior.
- macOS-specific unmount + recovery.
- Hardening: sandbox, code signing, entitlements.
