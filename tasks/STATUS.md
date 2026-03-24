# STATUS

## Current (PLAN)
- (none)

## Done / mostly done
- PLAN 17-readme-operator-guide: operator README/diagrams for install/run/secrets

- Task 16: expand real-mount editor-ops coverage (chmod/utimens/fsync/statfs), add wrapper-integrated end-to-end test, and document local macFUSE prerequisites.
  - See: `tasks/16-real-mount-editor-ops-plus-wrapper-e2e.md`

- PLAN 00-design: done (PR #2)
- PLAN 12-macfuse-integration: done (plan + decision)
- PLAN 13-macfuse-passthrough: done (PR #33)
- PLAN 14-core-auth-crypto-wiring: done (PR #35)
- PLAN 15-real-macfuse-acceptance-tests: implemented (real-mount tests are best-effort + skipped without prerequisites)
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


## Definition of Done (per PR)
For non-trivial PRs:
- [ ] Task markdown updated with acceptance criteria and notes
- [ ] Tests added/updated (unit + mocks where needed)
- [ ] `make test` (or equivalent) passes locally
- [ ] Security notes for access-control / crypto changes
- [ ] PR description includes: What/Why/How/Test Plan/Risks


## Added tasks
