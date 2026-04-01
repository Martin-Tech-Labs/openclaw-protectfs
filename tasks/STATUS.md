# STATUS

## Initial
- **Initial: COMPLETE** (baseline implementation + tests + operator docs).
- Last updated: 2026-03-29 (bookkeeping)
- Bookkeeping: this repo heartbeat/loop cron can be disabled unless you want post-initial verification work (see below).

## Current focus

### Swift supervisor rewrite (#86)
- **Status:** Done
- Completed phases:
  - #112 (Phase 1) — merged as PR #146
  - #113 (Phase 2) — merged as PR #148
  - #114 (Phase 3) — merged as PR #150 (2026-03-30)

Completed in this arc:
- #112 (Phase 1) — merged as PR #146
- #113 (Phase 2) — merged as PR #148
- #114 (Phase 3) — merged as PR #150

Merged PRs:
- #150: supervisor-swift: Keychain KEK + fd handoff (Refs #114)
- #148: supervisor-swift: process lifecycle + liveness socket (Closes #113)
- #146: supervisor-swift: add XCTest harness target (Closes #112)
- #142: fusefs: make Swift FUSE daemon default on macOS (Closes #87)

Recently merged:
- PR #140: fusefs-swift: clear encrypted-handle dirty flag after flush (Refs #87)
- PR #139: fusefs-swift: flush open handles on FUSE destroy
- PR #136: fusefs-swift: accept --plaintext-prefix in swift daemon (Refs #87)
- PR #135: fusefs: add --impl swift delegator (Refs #87)
- PR #132: fusefs-swift: test crypto + DEK format parity
- PR #131: fusefs-swift: add SwiftPM unit tests for core policy
- PR #130: fusefs-swift: factor core module so CI can compile without macFUSE

Notes:
- Phase 1-3 sub-issues (#107/#108/#109) are marked Done in the project.
- CI compile coverage for the `fusefs-swift` core module is in place; executable build remains opt-in when macFUSE headers are present.

### Post-PLAN 19 verification (confidence pass)
- **Current item:** Real mount verification on macOS
Focus: verify the Keychain/FD KEK path with the *real mount* on macOS.

- Real-mount tests run **by default** on macOS when prerequisites exist (macFUSE + `fuse-native`).
- In CI, real-mount tests are skipped by default; set `OCPROTECTFS_RUN_REAL_MOUNT_TESTS=1` to force-enable.
- Opt-out: set `OCPROTECTFS_SKIP_REAL_MOUNT_TESTS=1`.

- [x] Unit tests: `npm test` / `make test` exit cleanly on Node v25.6.1 (local run 2026-04-01). Real-mount tests are skipped on Node >= 25 by default (known `fuse-native` instability); use Node 22/24 LTS (recommended) or set `OCPROTECTFS_RUN_REAL_MOUNT_TESTS=1` to force. If hangs recur, investigate open handles / Node test runner behavior; CI runs `make test` on ubuntu-latest.
- [ ] Real mount verification on macOS (with macFUSE installed):
  - Helper script (best-effort, safe temp mount by default): `bash scripts/real-mount-verify.sh`
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
- #152 — Real-mount tests: deterministic guard + docs for Node 25.x fuse-native instability (macOS)
  - Result: real-mount tests and legacy `--impl node` now fail/skip with a clear message on Node >= 25 unless explicitly forced.
  - Docs: README notes supported Node versions (22/24 LTS) and override env vars.

## Backlog (queued)
- (none)

## In progress

## Final bookkeeping
- This file/README now explicitly declare **Initial: COMPLETE**.
- Recommendation: disable the protectfs repo heartbeat cron (this loop) unless you want post-initial verification work.

- PLAN 27-readme-tldr-setup: add README TL;DR with clone/build/install/migrate/keychain/run/verify/rollback steps
