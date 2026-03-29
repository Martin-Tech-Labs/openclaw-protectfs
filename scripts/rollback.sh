#!/usr/bin/env bash
set -euo pipefail

# ocprotectfs rollback/uninstall helper
#
# Goals:
# - cleanly stop supervisor/gateway (best effort: SIGTERM detected processes)
# - unmount FUSE overlay
# - restore original ~/.openclaw directory layout
# - optional: copy *decrypted* view from mountpoint to a destination directory
#
# Default paths match wrapper/ocprotectfs.js.

MOUNTPOINT="${HOME}/.openclaw"
BACKSTORE="${HOME}/.openclaw.real"
YES=0
RESTORE_LAYOUT=0
DECRYPT_TO=""

usage() {
  cat <<EOF
Usage:
  bash scripts/rollback.sh [options]

Options:
  --mountpoint <path>       Mountpoint (default: ~/.openclaw)
  --backstore <path>        Backstore directory (default: ~/.openclaw.real)

  --restore-layout          Move aside mountpoint dir and move backstore -> mountpoint
                            (only after unmount; refuses if paths look unsafe)

  --decrypt-to <path>       Copy the *plaintext* view currently visible at the mountpoint
                            into <path> (must not already exist)
                            NOTE: requires the mount to be active and readable.

  --yes                     Non-interactive: assume "yes" for prompts
  -h, --help                Show help

Examples:
  # 1) If ocprotectfs is running, first stop it in its terminal (recommended), then:
  bash scripts/rollback.sh --restore-layout

  # 2) If you want a full plaintext export before unmounting:
  bash scripts/rollback.sh --decrypt-to "$HOME/openclaw-plaintext-export" --restore-layout
EOF
}

die() { echo "error: $*" >&2; exit 2; }

confirm() {
  local prompt="$1"
  if [[ "$YES" == "1" ]]; then
    return 0
  fi
  read -r -p "$prompt [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]]
}

is_safe_path() {
  local p="$1"
  # Refuse empty, root, or home itself.
  [[ -n "$p" ]] || return 1
  [[ "$p" != "/" ]] || return 1
  [[ "$p" != "$HOME" ]] || return 1
  # Refuse weird relative paths.
  [[ "$p" == /* ]] || return 1
  return 0
}

is_mounted() {
  local mp="$1"
  if command -v mount >/dev/null 2>&1; then
    # macOS: mount output includes "on <mp> ("
    mount | grep -F " on ${mp} (" >/dev/null 2>&1 && return 0
    # linux-ish fallback
    mount | grep -F " ${mp} " >/dev/null 2>&1 && return 0
  fi
  return 1
}

best_effort_stop_supervisor() {
  # We cannot reliably stop a parent process tree without explicit pidfiles.
  # Best effort: look for the wrapper entrypoint and ask before SIGTERM.
  local pids=""

  if command -v pgrep >/dev/null 2>&1; then
    # Match the canonical entrypoint path and name.
    pids="$(pgrep -f "wrapper/ocprotectfs\.js" || true)"
  fi

  if [[ -z "$pids" ]]; then
    return 0
  fi

  echo "Detected ocprotectfs supervisor processes (best effort):" >&2
  ps -o pid=,ppid=,command= -p ${pids} >&2 || true

  if confirm "Send SIGTERM to these processes?"; then
    kill -TERM ${pids} || true
    # Give it a moment to unmount in its own shutdown handler.
    sleep 1
  fi
}

unmount_mountpoint() {
  local mp="$1"

  if ! is_mounted "$mp"; then
    echo "Mountpoint is not mounted: ${mp}" >&2
    return 0
  fi

  echo "Unmounting: ${mp}" >&2

  if command -v umount >/dev/null 2>&1; then
    umount "$mp" 2>/dev/null || true
  fi

  # Linux FUSE fallback
  if is_mounted "$mp" && command -v fusermount >/dev/null 2>&1; then
    fusermount -u "$mp" 2>/dev/null || true
  fi

  if is_mounted "$mp"; then
    die "failed to unmount ${mp}. Stop the supervisor and unmount manually, then re-run."
  fi
}

copy_plaintext_view() {
  local mp="$1"
  local dest="$2"

  [[ -n "$dest" ]] || die "--decrypt-to requires a path"

  if [[ -e "$dest" ]]; then
    die "decrypt destination already exists: ${dest}"
  fi

  if ! is_mounted "$mp"; then
    die "--decrypt-to requires the mountpoint to be actively mounted: ${mp}"
  fi

  echo "Copying plaintext view from ${mp} -> ${dest}" >&2

  if ! confirm "Proceed with plaintext export copy?"; then
    die "aborted"
  fi

  mkdir -p "$dest"

  # Prefer rsync when available (preserves perms, symlinks, etc.).
  if command -v rsync >/dev/null 2>&1; then
    rsync -aHAX --numeric-ids "$mp/" "$dest/"
  else
    # macOS cp supports -a (archive). This is best-effort.
    cp -a "$mp/." "$dest/"
  fi

  echo "Plaintext export completed: ${dest}" >&2
}

restore_layout() {
  local mp="$1"
  local bs="$2"

  is_safe_path "$mp" || die "unsafe mountpoint path: ${mp}"
  is_safe_path "$bs" || die "unsafe backstore path: ${bs}"

  if is_mounted "$mp"; then
    die "refusing to restore layout while mount is active: ${mp}"
  fi

  if [[ ! -d "$bs" ]]; then
    die "backstore does not exist or is not a directory: ${bs}"
  fi

  local ts
  ts="$(date +%Y%m%d-%H%M%S)"
  local backup="${mp}.rollback.${ts}"

  echo "Restoring original layout:" >&2
  echo "- move aside: ${mp} -> ${backup}" >&2
  echo "- restore:   ${bs} -> ${mp}" >&2

  if ! confirm "Proceed with directory moves?"; then
    die "aborted"
  fi

  if [[ -e "$mp" ]]; then
    mv "$mp" "$backup"
  fi

  mv "$bs" "$mp"

  echo "Layout restored. Backup kept at: ${backup}" >&2
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --mountpoint) MOUNTPOINT="$2"; shift 2;;
      --backstore) BACKSTORE="$2"; shift 2;;
      --restore-layout) RESTORE_LAYOUT=1; shift;;
      --decrypt-to) DECRYPT_TO="$2"; shift 2;;
      --yes) YES=1; shift;;
      -h|--help) usage; exit 0;;
      *) die "unknown arg: $1";;
    esac
  done

  is_safe_path "$MOUNTPOINT" || die "unsafe mountpoint path: ${MOUNTPOINT}"
  is_safe_path "$BACKSTORE" || die "unsafe backstore path: ${BACKSTORE}"

  best_effort_stop_supervisor

  if [[ -n "$DECRYPT_TO" ]]; then
    copy_plaintext_view "$MOUNTPOINT" "$DECRYPT_TO"
  fi

  unmount_mountpoint "$MOUNTPOINT"

  if [[ "$RESTORE_LAYOUT" == "1" ]]; then
    restore_layout "$MOUNTPOINT" "$BACKSTORE"
  fi

  echo "Done." >&2
}

main "$@"
