#!/usr/bin/env bash
set -euo pipefail

# real-mount-verify.sh
#
# Purpose:
#   Best-effort *local* confidence pass for the macOS real-mount behavior.
#   This is meant to support Issue #161 (Post-PLAN19 verification).
#
# Safety defaults:
#   - By default, uses a temporary mount/backstore under /tmp so it does NOT touch your real ~/.openclaw.
#   - To test against a real OpenClaw install, pass explicit --mountpoint/--backstore.
#
# Examples:
#   # Safe temp sandbox:
#   bash scripts/real-mount-verify.sh
#
#   # Real OpenClaw paths (DANGEROUS: will mount over ~/.openclaw):
#   bash scripts/real-mount-verify.sh --mountpoint "$HOME/.openclaw" --backstore "$HOME/.openclaw.real"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Prefer /private/tmp over /tmp on macOS. On macOS, /tmp is typically a symlink to
# /private/tmp, and macFUSE can be picky about symlinked mountpoint paths.
MOUNTPOINT="${MOUNTPOINT:-/private/tmp/ocprotectfs-verify/mount}"
BACKSTORE="${BACKSTORE:-/private/tmp/ocprotectfs-verify/backstore}"

# Parse minimal flags (avoid extra deps)
while [[ $# -gt 0 ]]; do
  case "$1" in
    --mountpoint)
      MOUNTPOINT="$2"; shift 2 ;;
    --backstore)
      BACKSTORE="$2"; shift 2 ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "SKIP: macOS only (requires macFUSE)."
  exit 0
fi

# macFUSE presence check (best-effort)
if [[ ! -d /Library/Filesystems/macfuse.fs ]]; then
  echo "SKIP: macFUSE not detected at /Library/Filesystems/macfuse.fs"
  echo "Install macFUSE, then re-run."
  exit 0
fi

cd "$ROOT_DIR"

# Node 25.x is known to be unstable with the *legacy* Node fuse-native implementation on macOS.
# This verification script forces the preferred Swift daemon path, so Node major version
# should not matter in practice.
#
# If you explicitly force the legacy Node impl (OCPROTECTFS_FUSE_IMPL=node), we keep the
# old guard to avoid confusing SIGSEGV crashes.
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [[ "${OCPROTECTFS_FUSE_IMPL:-}" == "node" ]] && [[ "$NODE_MAJOR" -ge 25 ]] && [[ "${OCPROTECTFS_RUN_REAL_MOUNT_TESTS:-}" != "1" ]]; then
  echo "SKIP: Node ${NODE_MAJOR}.x detected (known fuse-native instability on macOS for OCPROTECTFS_FUSE_IMPL=node)."
  echo "      Prefer the Swift daemon (default on macOS), use Node 22/24 LTS, or force with:"
  echo "        OCPROTECTFS_RUN_REAL_MOUNT_TESTS=1 bash scripts/real-mount-verify.sh"
  exit 0
fi

# Ensure dependencies exist (do not auto-install; keep script side-effect light)
if [[ ! -d node_modules ]]; then
  echo "ERROR: node_modules/ missing. Run: npm install" >&2
  exit 1
fi

# Build Swift components (required for preferred macOS path)
export OCPROTECTFS_BUILD_FUSEFS_SWIFT=1
make swift-build >/dev/null

SWIFT_BIN="$ROOT_DIR/fusefs-swift/.build/debug/ocprotectfs-fuse"
if [[ ! -x "$SWIFT_BIN" ]]; then
  echo "ERROR: expected Swift FUSE binary at: $SWIFT_BIN" >&2
  exit 1
fi

mkdir -p "$MOUNTPOINT" "$BACKSTORE"

SECRET="ocpfs_secret_$RANDOM"

with_timeout() {
  local SECS="$1"; shift
  # perl is available by default on macOS and gives us a simple alarm-based timeout.
  perl -e 'my $t=shift; alarm $t; exec @ARGV' "$SECS" "$@"
}

is_mounted() {
  # macOS mount output contains: "... on <mountpoint> (....)"
  # In some shells, `mount` may not be on PATH; prefer /sbin/mount.
  local MOUNT_BIN="mount"
  if [[ -x /sbin/mount ]]; then MOUNT_BIN="/sbin/mount"; fi
  "$MOUNT_BIN" | grep -F " on $MOUNTPOINT " >/dev/null 2>&1
}

cleanup() {
  # Attempt unmount + kill any background wrapper
  if [[ -n "${WRAPPER_PID:-}" ]]; then
    kill "$WRAPPER_PID" >/dev/null 2>&1 || true
    wait "$WRAPPER_PID" >/dev/null 2>&1 || true
  fi

  # Best-effort unmount (ignore failures)
  if [[ -x /sbin/umount ]]; then
    with_timeout 5 /sbin/umount "$MOUNTPOINT" >/dev/null 2>&1 || with_timeout 5 /sbin/umount -f "$MOUNTPOINT" >/dev/null 2>&1 || true
  else
    with_timeout 5 umount "$MOUNTPOINT" >/dev/null 2>&1 || with_timeout 5 umount -f "$MOUNTPOINT" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# Start supervisor with dummy gateway so we can verify mount/encryption in isolation.
# NOTE: --fuse-bin is 'node' because we launch the Node entrypoint which then spawns Swift.
# The swift binary is selected via env.
export OCPROTECTFS_FUSE_SWIFT_BIN="$SWIFT_BIN"

# This script is intended to be run interactively for the Keychain prompt.
# In non-interactive environments (cron/CI), the wrapper intentionally avoids
# Keychain access to prevent hangs, so the KEK will be ephemeral.
if [[ ! -t 0 ]] || [[ ! -t 1 ]]; then
  echo "NOTE: non-interactive session detected; Keychain-backed KEK verification may be skipped." >&2
  echo "      Run from an interactive terminal to validate Keychain prompts/ACL behavior." >&2
fi

node wrapper/ocprotectfs.js \
  --mountpoint "$MOUNTPOINT" \
  --backstore "$BACKSTORE" \
  --require-fuse-ready \
  --fuse-bin node \
  --fuse-arg fusefs/ocprotectfs-fuse.js \
  --plaintext-prefix workspace \
  --gateway-bin /bin/sleep \
  --gateway-arg 1000000 \
  >/tmp/ocprotectfs-verify.log 2>&1 &
WRAPPER_PID=$!

# Give FUSE a moment to come up (wrapper already waits for READY).
sleep 1

if ! kill -0 "$WRAPPER_PID" >/dev/null 2>&1; then
  echo "FAIL: wrapper exited early; see /tmp/ocprotectfs-verify.log" >&2
  exit 1
fi

if ! is_mounted; then
  echo "FAIL: mountpoint did not appear mounted at: $MOUNTPOINT" >&2
  echo "      See /tmp/ocprotectfs-verify.log" >&2
  exit 1
fi

# 1) Workspace plaintext passthrough + writable
with_timeout 5 mkdir -p "$MOUNTPOINT/workspace"
with_timeout 5 bash -c 'echo "hello" > "$1"' _ "$MOUNTPOINT/workspace/_ocpfs_smoketest.txt"

# 2) Encrypted-at-rest outside workspace

with_timeout 5 bash -c 'echo "$SECRET" > "$1"' _ "$MOUNTPOINT/_ocpfs_smoketest_secret.txt"

# The mounted view should show plaintext...
if ! with_timeout 5 grep -q "$SECRET" "$MOUNTPOINT/_ocpfs_smoketest_secret.txt"; then
  echo "FAIL: mounted view did not show expected plaintext" >&2
  exit 1
fi

# ...but the backstore should not contain the plaintext secret.
if with_timeout 10 grep -R "$SECRET" "$BACKSTORE" >/dev/null 2>&1; then
  echo "FAIL: found plaintext secret in backstore at $BACKSTORE" >&2
  exit 1
fi

# 3) Keychain KEK existence (best-effort)
# This should succeed once the supervisor has created the KEK.
# Note: depending on Keychain ACL policy, this may require user presence.
if with_timeout 5 security find-generic-password -s ocprotectfs -a kek >/dev/null 2>&1; then
  echo "OK: Keychain item exists (service=ocprotectfs account=kek)"
else
  echo "WARN: Keychain item not found yet (service=ocprotectfs account=kek)" >&2
  echo "      If this is the first run, you may need to approve a Keychain prompt and re-run." >&2
fi

# 4) Fail-closed smoke check (best-effort): after killing supervisor, encrypted-path access should fail.
kill "$WRAPPER_PID" >/dev/null 2>&1 || true
wait "$WRAPPER_PID" >/dev/null 2>&1 || true
WRAPPER_PID=""

# If liveness gating is working, encrypted-path read should fail quickly once
# the wrapper process exits.
if perl -e 'alarm 2; exec @ARGV' cat "$MOUNTPOINT/_ocpfs_smoketest_secret.txt" >/dev/null 2>&1; then
  echo "FAIL: able to read encrypted-path file after wrapper exit (expected fail-closed)." >&2
  echo "      Check logs: /tmp/ocprotectfs-verify.log" >&2
  exit 1
else
  echo "OK: access appears fail-closed after wrapper exit (read failed or timed out)."
fi

echo "OK: real-mount verification passed for mountpoint=$MOUNTPOINT backstore=$BACKSTORE"
echo "Log: /tmp/ocprotectfs-verify.log"
