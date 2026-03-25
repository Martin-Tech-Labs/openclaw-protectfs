# PLAN (canonical)

This file is the canonical plan Martin expects to track readiness for v1.

## Canonical tasks (Martin)
- 00-design.md
- 01-wrapper.md
- 02-fusefs-core.md
- 03-encryption.md
- 04-policy.md
- 05-tests.md
- 06-migration-mount.md
- 07-hardening-owasp.md

## Mapping to repo history (already merged)
The repo started with a slightly different numbering. Map what is already done:

- Repo Task 00-scaffold (PR #1): repository scaffold/CI (pre-plan setup)
  - https://github.com/Martin-Tech-Labs/openclaw-protectfs/pull/1
- Repo Task 01-design (PR #2): corresponds to **PLAN 00-design** (done)
  - https://github.com/Martin-Tech-Labs/openclaw-protectfs/pull/2
- Repo Task 02-wrapper-skeleton (PR #3, #4): corresponds to **PLAN 01-wrapper** (mostly done)
  - https://github.com/Martin-Tech-Labs/openclaw-protectfs/pull/3
  - https://github.com/Martin-Tech-Labs/openclaw-protectfs/pull/4
- Repo Task 03-fusefs-skeleton (PR #6): corresponds to **PLAN 02-fusefs-core** (mostly done)
  - https://github.com/Martin-Tech-Labs/openclaw-protectfs/pull/6
- Repo Task 04-encryption-impl (PR #8): corresponds to **PLAN 03-encryption** (done)
  - https://github.com/Martin-Tech-Labs/openclaw-protectfs/pull/8

## V1 ready — definition
V1 is considered "ready" when:
- Wrapper + FUSE can mount over `~/.openclaw` backed by `~/.openclaw.real`.
- Plaintext passthrough works for `workspace/**` and `workspace-joao/**`.
- All other paths are encrypted at rest in backstore.
- Sensitive reads/writes are denied unless:
  - wrapper alive
  - gateway alive
  - caller PID == gateway PID
  - gateway executable SHA-256 matches trusted hash
- Fail-closed when wrapper/gateway is not alive.
- Test coverage exists (unit tests + mocked acceptance tests for key behaviors).
- README documents usage + threat model + limitations.


## Added tasks
- PLAN 17-readme-operator-guide: README + diagrams + operator instructions

- PLAN 19-keychain-kek-e2e: wire KEK retrieval/storage via macOS Keychain (user presence) and pass KEK to FUSE without env; update docs


## Follow-up hardening / maintainability
- PLAN 20-repo-layout-tests: restructure into src/ + test/ + acceptance tests folder; README test instructions
- PLAN 21-testability-di-keychain: formalize IKeychain + DI/mocking for keychain/process boundaries; add integration tests
- PLAN 22-coverage-improvements: add coverage tooling + thresholds; expand tests to raise coverage
- PLAN 23-owasp-pass-fixes: OWASP-oriented review + fixes + document remaining limitations
- PLAN 24-macos-ci-strategy: add macos CI job + clarify macFUSE runner constraints; optional self-hosted runner path

- PLAN 25-license-badges: add MIT LICENSE + README badges (CI/license)

- PLAN 26-remove-v1-references: remove v1 references in code/docs; keep only real format/version markers
