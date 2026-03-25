# PLAN 19 — Keychain KEK e2e (no env secret)

## Goal
Make macOS Keychain the **real operator path** for the KEK (Key Encryption Key) and ensure the KEK is **never passed via environment variables**.

This task wires the wrapper to:
- retrieve or create the KEK in Keychain (user presence),
- hand the KEK to the FUSE daemon **in-memory** using a dedicated FD/pipe,
- keep existing unit tests deterministic (still allow env-based KEK for tests/dev if needed).

## Acceptance criteria
- [ ] Wrapper retrieves/creates a 32-byte KEK from macOS Keychain (`service=ocprotectfs`, `account=kek`) and uses it for FUSE.
- [ ] Wrapper passes the KEK to `ocprotectfs-fuse` via an anonymous pipe (FD) and **does not** set `OCPROTECTFS_KEK_B64`.
- [ ] `ocprotectfs-fuse` supports `--kek-fd <n>` (reads exactly 32 bytes) and prefers it over env.
- [ ] Docs updated:
  - remove/soft-deprecate env-based KEK in operator docs,
  - describe the FD handoff contract and Keychain location.
- [ ] `npm test` passes locally.
- [ ] `tasks/STATUS.md` updated.

## Notes
- Threat model: environment variables are easy to leak via `ps e`, crash logs, child process inheritance, and debug tooling.
- FD handoff keeps the secret out of env/argv and limits exposure to the wrapper+fuse process boundary.
