# STATUS

## Current (PLAN)
- Plan task: 09-fusefs-core-acceptance-tests
- Focus: add higher-level acceptance tests for allow/deny behavior in the FUSE core.
- Status: starting.

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
- LEGACY 05-fail-closed-ready: done (PR #10)

## Next (PLAN)
- 09-fusefs-core-acceptance-tests

## Definition of Done (per PR)
For non-trivial PRs:
- [ ] Task markdown updated with acceptance criteria and notes
- [ ] Tests added/updated (unit + mocks where needed)
- [ ] `make test` (or equivalent) passes locally
- [ ] Security notes for access-control / crypto changes
- [ ] PR description includes: What/Why/How/Test Plan/Risks
