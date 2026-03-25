# Supervisor lifecycle (ocprotectfs)

This document describes the *current* supervisor lifecycle contract.

## Roles

- **Supervisor (`wrapper/ocprotectfs.js`)**
  - Validates config, prepares directories
  - Performs legacy migration out of the mountpoint (Task 06)
  - Creates a liveness unix socket inside the mountpoint (Task 05)
  - Spawns **FUSE** first and (optionally) waits for readiness
  - Spawns **Gateway** once FUSE is ready
  - Supervises both processes and shuts down the other if either dies

- **FUSE process (`--fuse-bin …`)**
  - Responsible for mounting the filesystem at `--mountpoint`
  - Expected to unmount during its own shutdown when it receives SIGTERM/SIGINT

- **Gateway process (`--gateway-bin …`)**
  - OpenClaw gateway
  - Expected to exit promptly on SIGTERM/SIGINT

## Startup sequence

1. Supervisor validates paths and enforces strict permissions on `--backstore` and `--mountpoint`.
2. Supervisor migrates any pre-existing files *out of the mountpoint* to avoid data being hidden once the filesystem is mounted over it.
3. Supervisor creates the liveness socket at:
   - `${mountpoint}/.ocpfs.sock`
4. Supervisor starts the FUSE process (detached process group) and waits for a `READY` line on stdout/stderr if `--require-fuse-ready` is enabled.
5. Supervisor starts the gateway process (detached process group).

## Readiness / fail-closed

When `--require-fuse-ready` is set:

- If the supervisor does not observe `READY` within `--fuse-ready-timeout-ms`, it will:
  - terminate the FUSE process group
  - remove the liveness socket
  - exit with a stable, non-zero error code (`EXIT.FUSE_NOT_READY`)

This is the core "fail closed" behavior: don’t start gateway unless FUSE is known-good.

## Shutdown sequence

The supervisor handles **SIGINT** and **SIGTERM**.

On shutdown, it:

1. Sends SIGTERM to the gateway process group (if running)
2. Sends SIGTERM to the FUSE process group (if running)
3. Waits up to `--shutdown-timeout-ms` for both to exit
4. Escalates to SIGKILL if necessary
5. Removes the liveness socket

If shutdown times out, supervisor exits with `EXIT.SHUTDOWN`.

## Unmount behavior (important)

On shutdown the supervisor performs a **best-effort unmount** of the mountpoint.

- First it terminates the gateway + FUSE process groups (SIGTERM → SIGKILL escalation).
- Then it invokes an unmount command (platform-dependent) and **ignores failures**.
  - macOS: `umount <mountpoint>` (and `umount -f` as a fallback)
  - Linux: `fusermount -u <mountpoint>` (and `umount <mountpoint>` as a fallback)

Rationale: the FUSE daemon should normally unmount itself on SIGTERM/SIGINT, but a conservative best-effort unmount helps avoid leaving a stale mount behind.

## Known limitations / TODOs

- Unmount is best-effort only: the supervisor does not currently verify that the mount is actually gone (it avoids parsing `mount` output across platforms).
- Supervisor currently expects FUSE readiness to be signaled by a `READY` line; if this contract changes, `--require-fuse-ready` will need updates.

## Tests

See `wrapper/test/lifecycle.test.js` for process-group shutdown and supervision behavior, and `wrapper/test/livenessSocket.test.js` for socket creation/removal.
