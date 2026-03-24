# Wrapper lifecycle (ocprotectfs)

This document describes the *current* wrapper lifecycle contract.

## Roles

- **Wrapper (`wrapper/ocprotectfs.js`)**
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

1. Wrapper validates paths and enforces strict permissions on `--backstore` and `--mountpoint`.
2. Wrapper migrates any pre-existing files *out of the mountpoint* to avoid data being hidden once the filesystem is mounted over it.
3. Wrapper creates the liveness socket at:
   - `${mountpoint}/.ocpfs.sock`
4. Wrapper starts the FUSE process (detached process group) and waits for a `READY` line on stdout/stderr if `--require-fuse-ready` is enabled.
5. Wrapper starts the gateway process (detached process group).

## Readiness / fail-closed

When `--require-fuse-ready` is set:

- If the wrapper does not observe `READY` within `--fuse-ready-timeout-ms`, it will:
  - terminate the FUSE process group
  - remove the liveness socket
  - exit with a stable, non-zero error code (`EXIT.FUSE_NOT_READY`)

This is the core "fail closed" behavior: don’t start gateway unless FUSE is known-good.

## Shutdown sequence

The wrapper handles **SIGINT** and **SIGTERM**.

On shutdown, it:

1. Sends SIGTERM to the gateway process group (if running)
2. Sends SIGTERM to the FUSE process group (if running)
3. Waits up to `--shutdown-timeout-ms` for both to exit
4. Escalates to SIGKILL if necessary
5. Removes the liveness socket

If shutdown times out, wrapper exits with `EXIT.SHUTDOWN`.

## Unmount behavior (important)

The wrapper currently **does not** invoke `umount` / `diskutil unmount` itself.

- Clean unmount is expected to happen as part of the FUSE process’s own SIGTERM/SIGINT handling.
- There is an explicit TODO in `wrapper/lib/run.js`:
  - `// TODO (Task 03+): unmount mountpoint cleanly.`

This keeps the wrapper conservative: it focuses on process supervision and fail-closed behavior, and avoids making assumptions about unmount mechanics across macFUSE versions.

## Tests

See `wrapper/test/lifecycle.test.js` for process-group shutdown and supervision behavior, and `wrapper/test/livenessSocket.test.js` for socket creation/removal.
