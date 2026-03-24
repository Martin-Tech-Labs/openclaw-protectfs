# STATUS

## Current (PLAN)
- Plan task: **PLAN 19-keychain-kek-e2e**
- Focus: make Keychain the real operator path for KEK (user presence) and pass KEK to FUSE without env.
- Status: not started.

## Baseline v1 complete
The baseline v1 (env-based bring-up, encrypted-at-rest, policy enforcement, real mount tests, README) is complete.

## Next
- After PLAN 19: re-verify real-mount tests with Keychain path and update README.

## Definition of Done (per PR)
For non-trivial PRs:
- [ ] Task markdown updated with acceptance criteria and notes
- [ ] Tests added/updated (unit + mocks where needed)
- [ ] `npm test` passes locally
- [ ] Security notes for access-control / crypto changes
- [ ] PR description includes: What/Why/How/Test Plan/Risks
