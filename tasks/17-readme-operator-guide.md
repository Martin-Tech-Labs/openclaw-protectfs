# PLAN 17 — README + operator guide (install/run/secrets/diagrams)

## Goal
Make **initial** operable by someone who didn’t write the code:

- A clear top-level README that points to the right docs.
- A concrete operator guide for install/config/run.
- Explicit documentation of **secrets**: what exists, where it lives, what’s encrypted, and what is *not*.
- Diagrams included (or linked) so the architecture can be understood quickly.

## Acceptance criteria
- [ ] `README.md` has an “Operator quickstart” section with links to:
  - `docs/operator-guide.md`
  - `docs/wrapper-lifecycle.md`
  - `docs/local-macfuse.md`
- [ ] `docs/operator-guide.md` covers:
  - prerequisites (macOS + macFUSE + Node)
  - install steps (`npm install`, `npm test`)
  - configuration/secrets (KEK/DEK, Keychain, env bring-up gates)
  - run flow (migration, mount, start wrapper/gateway)
  - troubleshooting and rollback
  - diagrams (Mermaid, embedded or linked)
- [ ] `tasks/STATUS.md` updated to mark PLAN 17 done.

## Notes
- This task is documentation-only, but should still run `npm test` locally before PR.
