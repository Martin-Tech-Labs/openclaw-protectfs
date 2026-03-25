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

## Issue closing keywords (no partial scaffolds)

**Do not use** GitHub closing keywords in PRs unless the linked issue is actually complete:

- ❌ `Closes #123`, `Fixes #123`, `Resolves #123` in a PR that is partial/scaffold/WIP
- ✅ `Refs #123`, `Part of #123`, `Relates to #123` for scaffolding or incremental work

If incremental work is needed, create a follow-up issue and reference it.

## Review policy override (completeness beats speed)

Joao must cross-check each PR against the linked issue acceptance criteria.

- If the implementation is **partial/incomplete**, Joao must **refuse approval**.
- In this case, the **"max 2 review rounds" rule does not apply**: incomplete work cannot be approved.
- Alternative: request the author create a follow-up issue (and ensure the PR uses `Refs #...` not closing keywords).
