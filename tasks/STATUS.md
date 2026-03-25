# STATUS

## V1
- **V1: COMPLETE** (baseline implementation + tests + operator docs).

## Post-PLAN 19 verification (confidence pass)
Focus: verify the Keychain/FD KEK path with the *real mount* on macOS.

- [~] Unit tests: assertions pass (all tests green), but on Node v25.6.1 the process can hang after finishing; investigate open handles or Node test runner behavior. CI currently runs `make test` on ubuntu-latest; verify it still exits there.
- [ ] Real mount verification on macOS (with macFUSE installed):
  - [ ] Wrapper mounts `~/.openclaw` over an existing OpenClaw install.
  - [ ] Keychain prompt appears on first run and KEK is stored at:
        `service=ocprotectfs`, `account=kek`.
  - [ ] Workspace paths remain plaintext + writable.
  - [ ] Non-workspace paths are encrypted-at-rest in `~/.openclaw.real`.
  - [ ] Fail-closed behavior holds when wrapper/gateway die.
  - [ ] Operator notes in README updated if any surprises.

## Recently completed
- **PLAN 19-keychain-kek-e2e** — merged as PR **#49** (Keychain KEK + FD handoff; no env secret).

## Backlog (queued)
- PLAN 20-repo-layout-tests: restructure into src/ + test/ + acceptance tests folder; README test instructions
- PLAN 21-testability-di-keychain: formalize IKeychain + DI/mocking for keychain/process boundaries; add integration tests
- PLAN 22-coverage-improvements: add coverage tooling + thresholds; expand tests to raise coverage
- PLAN 23-owasp-pass-fixes: OWASP-oriented review + fixes + document remaining limitations
- PLAN 24-macos-ci-strategy: add macos CI job + clarify macFUSE runner constraints; optional self-hosted runner path

- PLAN 25-license-badges: add MIT LICENSE + README badges (CI/license)

- PLAN 26-remove-v1-references: remove v1 references in code/docs; keep only real format/version markers
