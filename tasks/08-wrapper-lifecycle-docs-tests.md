# 08 — Wrapper lifecycle docs + tests

Goal: tighten up wrapper lifecycle documentation and add a small missing regression test.

This is a deliberately small, low-risk follow-on after Task 07.

## Scope

- Document:
  - Who is responsible for mount/unmount
  - Wrapper signal handling and shutdown semantics
  - Known limitations / TODOs
- Add one missing lifecycle test case to improve confidence.

## Out of scope

- Implementing mount/unmount inside the wrapper (still TODO in `wrapper/src/run.js`)
- Large refactors

## Acceptance criteria

- [x] `docs/wrapper-lifecycle.md` explains:
  - Wrapper creates/cleans liveness socket
  - Wrapper starts FUSE first, waits for READY when `--require-fuse-ready`
  - Wrapper starts gateway once FUSE is ready
  - SIGINT/SIGTERM cause wrapper to terminate both child process groups
  - Unmount behavior expectations (FUSE should unmount itself on SIGTERM; wrapper currently does not `umount`)
- [x] Add at least one additional lifecycle test (SIGINT shutdown)
- [x] `make test` passes

## Notes

- Regression test strengthened to assert SIGINT kills full process groups (daemon + child) for both FUSE and gateway.
- Added a short “Known limitations / TODOs” section to wrapper lifecycle docs.
