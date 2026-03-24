# Task 05 — Tests (acceptance + policy + wrapper/fuse lifecycle)

## Goal
Raise confidence that ProtectFS behaves safely and predictably under common OpenClaw workflows.

## Scope (v1)
- Add/expand **acceptance-style tests** around wrapper + FUSE skeleton lifecycle:
  - wrapper fails closed when `--require-fuse-ready` and READY is not observed
  - wrapper cleanly shuts down child process groups on signal / child exit
- Add tests for **path policy enforcement hooks** as FUSE layer becomes real (future tasks):
  - plaintext vs encrypted path classification influences storage decisions
  - encrypted paths require gateway access checks (hook only for now)

## Notes
- Many tests are already present (crypto, keychain, wrapper run, fuse skeleton readiness). This task is about tightening lifecycle and adding any missing edge cases.

## Acceptance criteria
- [ ] `make test` covers wrapper shutdown/lifecycle edge cases (timeouts, child death).
- [ ] Tests remain deterministic (no long sleeps; use short timeouts).
- [ ] Document any known limitations in `tasks/STATUS.md`.
