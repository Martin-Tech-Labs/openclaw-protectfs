# Task 09 — FUSEFS core acceptance tests (allow/deny behavior)

## Goal
Add higher-level acceptance/behavioral tests that verify the FUSE core enforces *policy outcomes* correctly (allow/deny/readonly, etc.) for common filesystem operations.

This fills the remaining gap called out under **PLAN 02-fusefs-core**: we have unit-ish coverage, but not enough end-to-end confidence around what the mounted filesystem actually allows/denies.

## Scope
- Add acceptance tests that mount the filesystem (or use the closest practical harness) and exercise real operations:
  - read file
  - write file
  - create file
  - mkdir/rmdir
  - rename
  - unlink
  - chmod/chown (if supported / explicitly denied)
- Validate **deny** paths fail *closed* with clear error codes.
- Validate **allow** paths succeed and produce expected side effects.

## Acceptance criteria
- [ ] New acceptance test suite exists (document where/how to run it)
- [ ] Tests cover at least: read, write, create, rename, unlink, mkdir
- [ ] Denied operations are rejected reliably (no flaky timing)
- [ ] CI runs these tests (or they’re gated behind an explicit tag with documented rationale)
- [ ] `npm test` (or repo’s test command) passes locally

## Notes / design
- Prefer running tests against a temp directory with deterministic fixtures.
- Keep mount lifecycle explicit and robust (timeouts, cleanup, unmount even on failure).
- If running a real mount is too heavy for CI, add a clear split:
  - fast mocked tests (default)
  - acceptance tests (opt-in, e.g. `TEST_ACCEPTANCE=1`), but still runnable on a dev machine.

## How to run
For now, the repo does not implement a real macFUSE mount. The acceptance suite is therefore
implemented as **core contract tests** (logic-only) that validate allow/deny outcomes.

Run:
- `npm test`

Files:
- `fusefs/src/core.js`
- `fusefs/test/core-acceptance.test.js`
