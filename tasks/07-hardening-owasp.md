# 07 — Hardening (OWASP-ish)

Goal: do a conservative security hardening pass on wrapper + fuse components.

This task is intentionally checklist-driven. Prefer changes that are low-risk, measurable (tests), and align with the threat model in `tasks/PLAN.md`.

## Scope

- Input validation / path safety
- Process execution safety
- Least-privilege filesystem operations
- Robust fail-closed behavior
- Logging hygiene (no secrets, no overly chatty logs)
- Dependency hygiene

## Out of scope

- Large refactors without tests
- New cryptography schemes
- UX polish / docs-only work (unless needed for security clarity)

## Checklist / Acceptance criteria

### Wrapper
- [x] Ensure all filesystem writes use safe permissions (e.g. `0o600` for secret-ish markers; `0o700` for private dirs) and do not inherit overly-open umask defaults.
- [x] Ensure marker / socket / pidfile paths are validated and cannot be redirected via symlinks.
- [x] Ensure child process spawning uses explicit argv arrays (no shell) everywhere.
- [x] Ensure environment passed to child processes is minimal and explicit (no accidental leakage).
- [ ] Ensure logs never print secrets / key material / unredacted paths that may contain usernames (keep practical; don’t over-sanitize).

### FUSE shim / core
- [ ] Ensure all user-controlled paths are normalized and validated (already have `policy` helpers; confirm coverage for edge cases).
- [ ] Ensure deny-by-default on unexpected operations.
- [ ] Ensure any temporary files are created safely (`mkdtemp`, no predictable names).

### Tests
- [x] Add unit tests for at least 2–3 hardening items above (permissions, symlink rejection, env minimization, etc.).
- [x] `make test` passes.

### Docs / Notes
- [ ] Document any security-relevant behavior changes briefly in the PR description.

## Notes / Implementation notes

Implemented:

- `wrapper/src/safe-fs.js`:
  - `safeAtomicWriteFile(path, data, {mode})` writes via a random, `open('wx')`-created temp file + `fsync` + `rename`, then `chmod`s to avoid umask widening.
  - Refuses symlink path components and refuses writing to an existing symlink leaf.
- `wrapper/src/migrate.js` now uses `safeAtomicWriteFile` for `.ocpfs.migrating.json` / `.ocpfs.migrated.json` markers.
- `wrapper/src/run.js` now uses `buildChildEnv()` to pass a small allow-listed environment + `OCPROTECTFS_LIVENESS_SOCK` to child processes.

Still open / follow-ups:

- Logging hygiene is mostly OK today (no key material is logged), but we still log mountpoint/backstore paths and legacy migration destination paths. Decide whether to redact or keep as-is for operability.
- FUSE core is still a skeleton; deny-by-default and path normalization checks should be revisited when real ops are implemented.
