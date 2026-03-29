# STATUS

## Initial
- **Initial: COMPLETE** (baseline implementation + tests + operator docs).
- Last updated: 2026-03-25 (bookkeeping)
- Bookkeeping: this repo heartbeat/loop cron can be disabled unless you want post-initial verification work (see below).

## Current focus

### Swift rewrite (#87)
- **Current item:** #87 (Swift FUSE): keep Swift components building in CI
- **Status:** In Review (PR #131)
- Review rounds: 1

Current PRs:
- PR #131: fusefs-swift: add SwiftPM unit tests for core policy
  - Latest update: fix macOS CI by making FUSE daemon targets/products opt-in in Package.swift (env-gated) so `swift test` doesn’t link libfuse on runners
  - Awaiting: CI green + Joao review

Recently:
- PR #130 merged: fusefs-swift: factor core module so CI can compile without macFUSE

Recently:
- PR #126 merged: Swift FUSE: encrypted-at-rest ops + liveness-gated authz (Refs #109).
- Phase 1-3 sub-issues (#107/#108/#109) are marked Done in the project.

Next:
- Add CI build coverage for `fusefs-swift` (SwiftPM compile) alongside existing `supervisor-swift` tests. (DONE: core module compiled in CI; executable build still opt-in when macFUSE headers are present.)
- Follow-up: add a SwiftPM test target for `fusefs-swift` once its internal logic is factored into testable modules.

### Post-PLAN 19 verification (confidence pass)
Focus: verify the Keychain/FD KEK path with the *real mount* on macOS.

- Real-mount tests run **by default** on macOS when prerequisites exist (macFUSE + `fuse-native`). (On very new Node majors they may auto-skip unless forced.)
- In CI, real-mount tests are skipped by default; set `OCPROTECTFS_RUN_REAL_MOUNT_TESTS=1` to force-enable.

- [x] Unit tests: `npm test` / `make test` exit cleanly on Node v25.6.1 (local run 2026-03-25). If hangs recur, investigate open handles / Node test runner behavior; CI runs `make test` on ubuntu-latest.
- [ ] Real mount verification on macOS (with macFUSE installed):
  - [ ] Wrapper mounts `~/.openclaw` over an existing OpenClaw install.
  - [ ] Keychain prompt appears on first run and KEK is stored at:
        `service=ocprotectfs`, `account=kek`.
  - [ ] Workspace paths remain plaintext + writable.
  - [ ] Non-workspace paths are encrypted-at-rest in `~/.openclaw.real`.
  - [ ] Fail-closed behavior holds when wrapper/gateway die.
  - [ ] Operator notes in README updated if any surprises.

## Recently completed
- **#88 Quickstart one-command script** — merged as PR **#116** (scripts/quickstart.sh + README snippet + self-validating KEK check + randomized smoke token).
- **PLAN 21-testability-di-keychain** — formalized Keychain/KEK DI points (explicit keychain instance + injectable `getOrCreateKey32`) and added test coverage for the DI boundary.
- **PLAN 20-repo-layout-tests** — repo layout already in src/ + test/ + acceptance/ (wrapper + fusefs); README updated to document layout + test commands.
- **PLAN 19-keychain-kek-e2e** — merged as PR **#49** (Keychain KEK + FD handoff; no env secret).
- **PLAN 25-license-badges** — done (MIT LICENSE + README badges), merged as PR **#53**.

## Backlog (queued)
- (none — see “Post-PLAN 19 verification” checklist above)

## Final bookkeeping
- This file/README now explicitly declare **Initial: COMPLETE**.
- Recommendation: disable the protectfs repo heartbeat cron (this loop) unless you want post-initial verification work.

- PLAN 27-readme-tldr-setup: add README TL;DR with clone/build/install/migrate/keychain/run/verify/rollback steps
