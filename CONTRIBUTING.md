# Contributing

This repo follows a two-hats workflow:

- **Toby**: authors tasks/PRs and implements changes.
- **Joao**: reviews PRs with a DoD checklist and either approves or leaves comments.

## Review policy
- Max **2 review rounds** per PR (Joao must approve by round 2).
- PRs must resolve review discussions before merge.

## PR DoD (non-trivial changes)
- Clear PR description: What / Why / How / Test plan / Risks
- Tests (unit + mocks as needed)
- Security notes for access-control / crypto changes

## Task tracking
- `tasks/STATUS.md` is the single source of truth for the current task and review rounds.
