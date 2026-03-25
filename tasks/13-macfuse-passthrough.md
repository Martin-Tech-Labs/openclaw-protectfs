# Task 13 — minimal macFUSE passthrough mount (fuse-native)

## Goal

Replace the placeholder `fusefs/ocprotectfs-fuse.js` with a **real** macFUSE mount implemented with `fuse-native`.

This is the smallest possible step that proves:
- the wrapper can launch a FUSE daemon,
- the daemon **mounts successfully**,
- the daemon prints `READY` **only after** a successful mount,
- basic POSIX-ish operations work as passthrough to the backstore.

## Why

Initial readiness (see `tasks/12-macfuse-integration.md` + `docs/design.md`) requires an actual filesystem mount.
The repo already has a strong wrapper lifecycle contract (`docs/wrapper-lifecycle.md`) but the FUSE process was only a keepalive stub.

## Scope

- Implement a minimal passthrough filesystem:
  - mount over `--mountpoint`
  - back files by `--backstore`
  - map FUSE paths (e.g. `/foo/bar`) to `${backstore}/foo/bar`
- Implement a minimal set of ops needed for basic usage (`ls`, `cat`, `touch`, `mv`, `rm`, `mkdir`)
- Ensure clean-ish shutdown behavior on SIGINT/SIGTERM (best-effort unmount)

Non-goals:
- `core` authZ enforcement
- `crypto` encrypted-at-rest behavior
- perfect coverage of all macOS filesystem edge cases (xattrs, symlinks, etc.)

## Acceptance criteria

- [ ] `fusefs/ocprotectfs-fuse.js` mounts a real filesystem with `fuse-native` (macOS + macFUSE).
- [ ] The process prints `READY` **only** after the mount callback succeeds.
- [ ] Basic passthrough operations work locally:
  - [ ] `ls` / `readdir`
  - [ ] `cat` / `read`
  - [ ] `touch` / `create`
  - [ ] `rm` / `unlink`
  - [ ] `mv` / `rename`
  - [ ] `mkdir` / `rmdir`
- [ ] Wrapper stop path does not hang the FUSE process (best-effort unmount on SIGTERM).
- [ ] `npm test` passes.
- [ ] A best-effort mount test exists and is **skipped** automatically when mounting is not available (CI, non-macOS, missing macFUSE).

## Notes / risks

- `fuse-native` is a native addon. To keep CI green, it is added as an **optional dependency**; tests that require a real mount must be skippable.
- Not all operations are implemented yet; some apps/editors may trigger missing ops (`fsync`, xattrs, `statfs`, etc.). Follow-up work should add ops incrementally as needed.
