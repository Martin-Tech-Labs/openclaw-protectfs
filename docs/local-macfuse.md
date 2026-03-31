# Local macFUSE prerequisites (for running real-mount tests)

Some tests in this repo are **best-effort** and only run when a **real macFUSE mount** is possible.

They are designed to be **skipped in CI** and to run on a developer’s Mac.

## Requirements

- **macOS** (these tests are Darwin-only)
- **macFUSE installed**
  - Expected install location:
    - `/Library/Filesystems/macfuse.fs`
    - (legacy) `/Library/Filesystems/osxfuse.fs`
  - Note: macFUSE requires approving a **System Extension** in System Settings.
- **Node.js** (prefer an LTS release)
  - Real-mount tests are **skipped by default on Node >= 25** due to observed `fuse-native` instability/segfaults (see #152).
  - Recommended: **Node 22 LTS** (or Node 24 if you already use it).
  - Override: set `OCPROTECTFS_RUN_REAL_MOUNT_TESTS=1` to force an attempt.
- The optional dependency **`fuse-native`** must be installed and loadable
  - The test suite uses `require('fuse-native')` as a readiness heuristic.

## Installing macFUSE

1. Download and install macFUSE from the official site.
2. After install, open **System Settings → Privacy & Security** and approve/allow the macFUSE system extension.
3. Reboot if macOS prompts you to.

(Exact UI wording changes across macOS versions; the key point is that macFUSE is a system component and may require approval.)

## Installing `fuse-native`

`fuse-native` is treated as an **optional** dependency so CI doesn’t have to build it.

On a dev machine, ensure you have build tooling available:

- Xcode Command Line Tools: `xcode-select --install`

Then from repo root:

```bash
npm install
```

If `fuse-native` fails to build, check:

- you’re on a Node version supported by the `fuse-native` release you’re using
- macFUSE is installed and the system extension is enabled

## Running the tests

Real-mount tests run **by default** on macOS when prerequisites exist.

If you’re on a very new Node major and `fuse-native` is unstable, the suite may auto-skip unless you force it with `OCPROTECTFS_RUN_REAL_MOUNT_TESTS=1`.

In CI they are skipped unless explicitly enabled:

```bash
CI=1 OCPROTECTFS_RUN_REAL_MOUNT_TESTS=1 npm test
```

Real-mount tests should either:

- run and pass locally when prerequisites are present, or
- be skipped with a message like: `requires macOS + macFUSE + fuse-native`

## Notes / gotchas

- Real mounts can be flaky if the mountpoint is busy; the tests try to isolate under a fresh `mkdtemp`.
- If a prior run crashed and left a mount around, you may need to unmount it manually.
