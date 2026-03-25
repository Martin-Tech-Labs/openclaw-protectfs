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

## Scaffold / phased PRs (allowed, but must not block progress)

We allow scaffold/phased PRs **only** when they are explicitly treated as incremental building blocks.

Rules:
- A scaffold/phased PR **must not** use closing keywords (`Closes/Fixes/Resolves #n`). Use `Refs #n`.
- A scaffold/phased PR **must** include a "Follow-up issues" section listing the remaining work as issue numbers.
- Joao must refuse approval if a scaffold PR is missing follow-up issues.

## CHANGES_REQUESTED is not a terminal state

If Joao marks a PR as **CHANGES_REQUESTED**, Toby must attempt to resolve the requested changes:
- If changes are straightforward: implement + push commits.
- If changes require large scope: split into follow-up issues and reduce the PR scope so it can be completed.

**No blocking rule:** the process must always make forward progress (merge a correct incremental PR and keep the parent issue open), rather than leaving PRs stuck indefinitely.
