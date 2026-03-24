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
- [ ] Ensure all filesystem writes use safe permissions (e.g. `0o600` for secret-ish markers; `0o700` for private dirs) and do not inherit overly-open umask defaults.
- [ ] Ensure marker / socket / pidfile paths are validated and cannot be redirected via symlinks.
- [ ] Ensure child process spawning uses explicit argv arrays (no shell) everywhere.
- [ ] Ensure environment passed to child processes is minimal and explicit (no accidental leakage).
- [ ] Ensure logs never print secrets / key material / unredacted paths that may contain usernames (keep practical; don’t over-sanitize).

### FUSE shim / core
- [ ] Ensure all user-controlled paths are normalized and validated (already have `policy-v1` helpers; confirm coverage for edge cases).
- [ ] Ensure deny-by-default on unexpected operations.
- [ ] Ensure any temporary files are created safely (`mkdtemp`, no predictable names).

### Tests
- [ ] Add unit tests for at least 2–3 hardening items above (permissions, symlink rejection, env minimization, etc.).
- [ ] `make test` passes.

### Docs / Notes
- [ ] Document any security-relevant behavior changes briefly in the PR description.

## Notes / Ideas

- Consider adding a helper like `safeWriteFileAtomic(path, data, {mode})` that:
  - writes to a temp file in the same dir
  - `fsync`s
  - `rename`s into place
  - rejects if target dir is a symlink

- Consider validating that backstore + mountpoint dirs are owned by the current user and not group/world-writable.
