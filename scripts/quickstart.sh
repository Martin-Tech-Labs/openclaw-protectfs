#!/usr/bin/env bash
set -euo pipefail

# Quickstart script for openclaw-protectfs.
#
# Refs #88 (quickstart). Does NOT use GitHub closing keywords.
#
# What it does (best-effort, fail-closed):
# - checks macOS + macFUSE presence
# - starts the supervisor (wrapper) with the Node FUSE daemon
# - runs a small smoke test for plaintext passthrough vs encrypted-at-rest
# - prints rollback/unmount instructions
#
# Notes:
# - This script defaults to using a dummy gateway (/bin/sleep) so you can
#   validate the mount + encryption behavior without starting OpenClaw.
# - To run a real OpenClaw gateway under supervision, set GATEWAY_CMD.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

MOUNTPOINT_DEFAULT="${HOME}/.openclaw"
BACKSTORE_DEFAULT="${HOME}/.openclaw.real"

MOUNTPOINT="${MOUNTPOINT:-$MOUNTPOINT_DEFAULT}"
BACKSTORE="${BACKSTORE:-$BACKSTORE_DEFAULT}"

# Default: dummy gateway for smoke testing.
GATEWAY_CMD_DEFAULT="/bin/sleep 1000000"
GATEWAY_CMD="${GATEWAY_CMD:-$GATEWAY_CMD_DEFAULT}"

# Parsed form (used by wrapper flags)
GATEWAY_BIN="${GATEWAY_BIN:-}" 
GATEWAY_ARGS=()

NODE_BIN="${NODE_BIN:-$(command -v node || true)}"

fatal() {
  echo "ERROR: $*" >&2
  exit 2
}

info() {
  echo "[quickstart] $*" >&2
}

need_bin() {
  local b="$1"
  command -v "$b" >/dev/null 2>&1 || fatal "missing required binary: $b"
}

require_macos() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    fatal "this quickstart requires macOS (Darwin)"
  fi
}

require_macfuse() {
  if [[ ! -d /Library/Filesystems/macfuse.fs && ! -d /Library/Filesystems/osxfuse.fs ]]; then
    fatal "macFUSE does not appear installed (expected /Library/Filesystems/macfuse.fs). Install + approve the system extension first. See docs/local-macfuse.md"
  fi
}

parse_gateway_cmd() {
  # Split GATEWAY_CMD into argv safely (simple whitespace split).
  # If you need quoting/escaping, prefer exporting GATEWAY_BIN + GATEWAY_ARGS.
  if [[ -n "${GATEWAY_BIN:-}" ]]; then
    return 0
  fi

  # shellcheck disable=SC2206
  local parts=( $GATEWAY_CMD )
  if [[ ${#parts[@]} -lt 1 ]]; then
    fatal "GATEWAY_CMD was empty"
  fi

  GATEWAY_BIN="${parts[0]}"
  GATEWAY_ARGS=("${parts[@]:1}")
}

cleanup() {
  if [[ -n "${WRAPPER_PID:-}" ]]; then
    info "stopping supervisor pid=${WRAPPER_PID}"
    kill -TERM "${WRAPPER_PID}" 2>/dev/null || true

    # Best-effort wait; wrapper should unmount on shutdown.
    for _ in $(seq 1 40); do
      if ! mount | grep -q "on ${MOUNTPOINT} "; then
        break
      fi
      sleep 0.1
    done
  fi
}

main() {
  require_macos
  require_macfuse

  need_bin bash
  need_bin grep
  need_bin mount
  need_bin cat
  need_bin sed

  if [[ -z "$NODE_BIN" ]]; then
    fatal "node not found on PATH"
  fi

  cd "$REPO_ROOT"

  parse_gateway_cmd

  info "repo: ${REPO_ROOT}"
  info "mountpoint: ${MOUNTPOINT}"
  info "backstore: ${BACKSTORE}"
  info "gateway: ${GATEWAY_BIN} ${GATEWAY_ARGS[*]-}"

  info "starting supervisor (wrapper) in background..."

  local gw_args=()
  if [[ ${#GATEWAY_ARGS[@]} -gt 0 ]]; then
    for a in "${GATEWAY_ARGS[@]}"; do
      gw_args+=(--gateway-arg "$a")
    done
  fi

  set +e
  "$NODE_BIN" wrapper/ocprotectfs.js \
    --require-fuse-ready \
    --backstore "$BACKSTORE" \
    --mountpoint "$MOUNTPOINT" \
    --fuse-bin "$NODE_BIN" \
    --fuse-arg "$REPO_ROOT/fusefs/ocprotectfs-fuse.js" \
    --gateway-bin "$GATEWAY_BIN" \
    "${gw_args[@]}" \
    >/tmp/ocprotectfs-quickstart.out 2>/tmp/ocprotectfs-quickstart.err &
  WRAPPER_PID=$!
  set -e

  trap cleanup EXIT

  info "waiting for mount..."
  for _ in $(seq 1 80); do
    if mount | grep -q "on ${MOUNTPOINT} "; then
      break
    fi
    sleep 0.1
  done

  if ! mount | grep -q "on ${MOUNTPOINT} "; then
    info "wrapper stdout:"
    sed -n '1,200p' /tmp/ocprotectfs-quickstart.out >&2 || true
    info "wrapper stderr:"
    sed -n '1,200p' /tmp/ocprotectfs-quickstart.err >&2 || true
    fatal "mount did not appear at ${MOUNTPOINT}"
  fi

  info "mount detected. running smoke test..."

  local ws_file="${MOUNTPOINT}/workspace/_ocpfs_smoketest.txt"
  local secret_file="${MOUNTPOINT}/_ocpfs_smoketest_secret.txt"

  mkdir -p "$(dirname "$ws_file")"

  echo "hello" >"$ws_file"
  echo "secret" >"$secret_file"

  # Mounted view should show plaintext.
  if [[ "$(cat "$secret_file")" != "secret" ]]; then
    fatal "mounted view did not return expected plaintext"
  fi

  # Backstore should not contain the literal secret bytes.
  if grep -R "secret" "$BACKSTORE" >/dev/null 2>&1; then
    fatal "found plaintext 'secret' in backstore (${BACKSTORE}); encryption-at-rest appears broken"
  fi

  info "OK: workspace passthrough + encrypted-at-rest smoke test passed"

  cat >&2 <<EOF

Rollback / unmount:
- Stop the supervisor (this script will stop it automatically on exit).
- If needed, manually unmount:  umount "${MOUNTPOINT}"  (or: umount -f "${MOUNTPOINT}")
- Backstore is at: ${BACKSTORE}

To run with a real OpenClaw gateway under supervision:
- Export GATEWAY_CMD to a foreground gateway command, e.g.:
    GATEWAY_CMD='openclaw gateway start --foreground'
  (Exact command may vary; ensure it stays in the foreground.)
EOF
}

main "$@"
