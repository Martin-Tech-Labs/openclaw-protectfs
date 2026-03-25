# Task 06 — Migration + Mount

## Goal
Provide a safe, repeatable way to transition an existing OpenClaw install from an unprotected directory layout to the ProtectFS layout:

- **Mountpoint**: `~/.openclaw` (what OpenClaw already uses)
- **Backstore**: `~/.openclaw.real` (encrypted-at-rest for non-workspace paths)

## Problem statement
Users may already have data in `~/.openclaw` from previous installs. ProtectFS must:

- avoid data loss
- be idempotent (safe to run multiple times)
- behave safely on partial migrations / interrupted runs

## Scope
- Add a **migration step** in wrapper startup (or a helper script invoked by wrapper) that:
  - detects whether `~/.openclaw` already contains “legacy” data
  - moves that legacy data into the backstore in a reversible way (or copies + verifies, then moves)
  - leaves a clear marker that migration has been completed
- Ensure wrapper can **mount over** `~/.openclaw` safely (future: real macFUSE mount), including:
  - refusing to proceed if the mountpoint is not in an expected state
  - clear error messages + exit codes for common failure modes

## Non-goals
- Fully automatic rollback on every failure scenario (but do not destroy data; fail closed).
- Supporting arbitrary mountpoint paths beyond the existing flags.

## Proposed behavior
- Introduce a marker file in backstore, e.g. `~/.openclaw.real/.ocpfs.migrated.json` (JSON).
- Use an in-progress marker `~/.openclaw.real/.ocpfs.migrating.json` to detect interrupted runs.
- On startup, before launching FUSE/gateway:
  - If mountpoint is empty (or only contains expected wrapper-managed artifacts), do nothing.
  - If mountpoint contains legacy content and marker is missing:
    - move legacy content into backstore under a deterministic directory (e.g. `backstore/.legacy-openclaw/<timestamp>/...`) **or** into the normal backstore layout if already defined.
    - write marker after a successful move.
  - If marker exists, do not re-migrate.

## Acceptance criteria
- [x] Migration is **idempotent** and does not delete data.
- [x] Wrapper fails closed if mountpoint/backstore are in an unsafe state.
- [x] `make test` includes unit tests for migration decision logic (empty mountpoint, legacy content present, marker present, partial migration).
- [x] `tasks/STATUS.md` updated with any known limitations.

## Notes / risks
- macOS mount/unmount edge cases may require additional recovery logic; keep initial behavior conservative.
- Be careful to avoid traversing symlinks during migration.
- We treat a stale `.ocpfs.sock` in the mountpoint as safe wrapper noise; anything else triggers migration.
