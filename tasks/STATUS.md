# STATUS

## Initial
- **Initial: COMPLETE** (baseline implementation + tests + operator docs).
- Last updated: 2026-03-25 (bookkeeping)
- Bookkeeping: this repo heartbeat/loop cron can be disabled unless you want post-initial verification work (see below).

## Current focus
### Quickstart one-command script (#88)
- **Current item:** #88 (Quickstart: one-command setup script)
- **PR:** #116
- **Status:** In Review
- **Review rounds:** 0

### Swift supervisor rewrite (#86) — Phase 1 (scaffold)
- **Current item:** #86 (Rewrite supervisor as native Swift executable)
- **Phase issue:** #112
- **PR:** #115
- **Status:** In Review
- **Review rounds:** 1

Follow-ups (tracked as separate issues):
- #113 (process lifecycle + liveness socket)
- #114 (Keychain KEK management + ACL pinning)

### Swift rewrite (#87) — Phase 1 in review
- **Current item:** #107 (Swift FUSE package + minimal mount skeleton)
- **PR:** #111
- **Status:** In Review
- **Review rounds:** 0

Notes:
- This PR is intentionally non-functional; it must not use closing keywords.
- Follow-ups tracked in #108 and #109.

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
