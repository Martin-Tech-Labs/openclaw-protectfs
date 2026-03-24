# STATUS

## Current (PLAN)
- Plan task: **Task 12 — macFUSE integration (spike + plan)**
- Focus: pick a concrete implementation strategy for a real macFUSE mount and define follow-up implementation steps.
- Status: planning in progress (this PR).

## Done / mostly done
- PLAN 00-design: done (PR #2)
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
- Implement Task 12 follow-up: choose a Node FUSE binding library and ship a minimal passthrough mount that prints `READY` only after mount.

## Definition of Done (per PR)
For non-trivial PRs:
- [ ] Task markdown updated with acceptance criteria and notes
- [ ] Tests added/updated (unit + mocks where needed)
- [ ] `make test` (or equivalent) passes locally
- [ ] Security notes for access-control / crypto changes
- [ ] PR description includes: What/Why/How/Test Plan/Risks
