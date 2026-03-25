# STATUS

## Current (PLAN)
- Current focus: **Post-PLAN 19 verification**
  - Re-run/verify the real-mount tests with the Keychain/FD KEK path on macOS.
  - Update README/operator docs with any final operator notes from the real-mount verification.

## Recently completed
- **PLAN 19-keychain-kek-e2e** — merged as PR **#49** (Keychain KEK + FD handoff; no env secret).

## Baseline v1 complete
The baseline v1 (env-based bring-up, encrypted-at-rest, policy enforcement, real mount tests, README) is complete.

## Next
- If the real-mount verification finds gaps: fix and add tests/docs.
- If everything is solid: consider declaring **V1 COMPLETE** and do final bookkeeping (STATUS/README).

## Definition of Done (per PR)
For non-trivial PRs:
- [ ] Task markdown updated with acceptance criteria and notes
- [ ] Tests added/updated (unit + mocks where needed)
- [ ] `npm test` passes locally
- [ ] Security notes for access-control / crypto changes
- [ ] PR description includes: What/Why/How/Test Plan/Risks


## Backlog (queued)
- PLAN 20-repo-layout-tests: restructure into src/ + test/ + acceptance tests folder; README test instructions
- PLAN 21-testability-di-keychain: formalize IKeychain + DI/mocking for keychain/process boundaries; add integration tests
- PLAN 22-coverage-improvements: add coverage tooling + thresholds; expand tests to raise coverage
- PLAN 23-owasp-pass-fixes: OWASP-oriented review + fixes + document remaining limitations
- PLAN 24-macos-ci-strategy: add macos CI job + clarify macFUSE runner constraints; optional self-hosted runner path
