# PLAN 10 — Wrapper test hygiene (lifecycle)

## Goal
Improve wrapper lifecycle test diagnostics and correctness by fixing a parameter typo that prevents stderr/stdout capture from being included in failure messages.

## Why
`wrapper/test/lifecycle.test.js` uses a helper `waitForFile()` that can include captured wrapper output when a wait times out or the wrapper exits early.

In the `gateway exit triggers fuse shutdown` test, the call site passes `captureLabel`, but the helper expects `capture`. This silently disables capture for that test, making failures harder to debug.

## Acceptance criteria
- [ ] `wrapper/test/lifecycle.test.js` uses the correct `capture` option in all `waitForFile()` calls.
- [ ] `npm test` / `make test` passes locally.

## Notes
- No behavior change to production wrapper code; test-only fix.
