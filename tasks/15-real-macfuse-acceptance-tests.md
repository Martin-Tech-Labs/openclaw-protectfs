# Task 15 — real macFUSE acceptance tests (editor ops)

## Goal
Add **best-effort acceptance tests** that run against a **real macFUSE mount** (when available locally) to catch regressions that mocked tests can’t.

These tests should focus on **common editor/workflow operations** (atomic save patterns, rename/replace, temp files, fsync) and ensure:

- `workspace/**` (and `workspace-joao/**`) remain **plaintext passthrough**
- encrypted-by-policy paths remain **fail-closed by default**
- when `OCPROTECTFS_GATEWAY_ACCESS_ALLOWED=1` + `OCPROTECTFS_KEK_B64` are provided, encrypted-at-rest behavior holds

## Why
Mocked FUSE tests can miss:
- macFUSE-specific behavior/quirks
- missing ops that editors assume (rename-over, fsync, readdir consistency)
- subtle errno mapping differences

A small suite of local-only real-mount tests gives high confidence without making CI flaky.

## Scope
- Add/expand tests under `fusefs/test/**` using Node’s built-in test runner (`node:test`).
- Detect macFUSE + `fuse-native` availability and **skip** when not present.
- Keep the tests **serial** and **best-effort**, with clear timeouts and cleanup.

## Non-goals
- Making CI run real mounts (CI environments typically can’t load macFUSE kext/system extension)
- Exhaustive coverage of every possible POSIX behavior

## Proposed test cases (initial)
1. **Atomic save (workspace passthrough)**
   - write `file.tmp` then `rename(file.tmp, file)`
   - `fsync` file and parent dir when possible
   - verify backstore matches plaintext
2. **Replace existing file via rename-over**
   - create `file` then write `file.tmp` and rename over
   - verify content updated and no stray temp files in backstore
3. **Temp/swap file patterns**
   - create/delete `.swp`, `.~lock.*#`, `.DS_Store` (where relevant)
   - ensure create/unlink works and doesn’t break mount
4. **Fail-closed check for encrypted-by-policy path**
   - attempt write under mount root (e.g. `secret.txt`) with no gateway env -> expect `EACCES`/`EPERM`

## Acceptance criteria
- [ ] `npm test` passes in CI (real-mount tests are skipped when prerequisites are missing)
- [ ] On a local macOS machine with macFUSE + `fuse-native`, the real-mount suite runs and passes
- [ ] At least one test covers a realistic editor atomic-save sequence (`write tmp` → `fsync` → `rename over`)
- [ ] Tests use bounded timeouts and always attempt to unmount/terminate the FUSE process

## Local prerequisites (for running these tests)
- macOS
- macFUSE installed (`/Library/Filesystems/macfuse.fs`)
- `fuse-native` available/working for the current Node version

## Notes / risks
- Real mounts can be flaky if the mountpoint is busy; keep tests isolated under a unique `mkdtemp`.
- Unmount can take time; prefer process SIGTERM and allow a short grace period.
- `fsync` on directories is not portable; guard and tolerate `EINVAL`/`EPERM`.
