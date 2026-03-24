# STATUS

## Current (PLAN)
- Implementation task: **Task 13 — minimal macFUSE passthrough mount (fuse-native)**
- Focus: replace placeholder FUSE process with real passthrough mount; print `READY` only after mount.
- Status: in progress.

## Done / mostly done
- PLAN 00-design: done (PR #2)
- PLAN 12-macfuse-integration: done (plan + decision)
- PLAN 01-wrapper: mostly done (PR #3, #4)
  - gaps: document clean shutdown/unmount behavior; ensure wrapper owns mount lifecycle; add tests around lifecycle.
- PLAN 02-fusefs-core: mostly done (PR #6)
  - gaps: confirm full required ops for OpenClaw behavior; add acceptance tests around allow/deny behavior.
- PLAN 03-encryption: done (PR #8)
- PLAN 05-tests: done (PR #16)
- PLAN 06-migration-mount: done (PR #18)
- PLAN 07-hardening-owasp: done (PR #22)
- PLAN 08-wrapper-lifecycle-docs-tests: done (PR #26)
- PLAN 09-fusefs-core-acceptance-tests: done (PR #25)
- PLAN 10-wrapper-test-hygiene: done (PR #28)
- PLAN 11-wrapper-unmount: done (PR #30)
- LEGACY 05-fail-closed-ready: done (PR #10)

## Next (PLAN)
- After Task 13: wire in `core-v1` authorization + `crypto-v1` encrypted-at-rest behavior.

## Definition of Done (per PR)
For non-trivial PRs:
- [ ] Task markdown updated with acceptance criteria and notes
- [ ] Tests added/updated (unit + mocks where needed)
- [ ] `make test` (or equivalent) passes locally
- [ ] Security notes for access-control / crypto changes
- [ ] PR description includes: What/Why/How/Test Plan/Risks
