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
