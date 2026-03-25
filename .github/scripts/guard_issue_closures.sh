#!/usr/bin/env bash
set -euo pipefail

BODY_FILE="${1:-}"
TITLE_FILE="${2:-}"

body=""
title=""

if [[ -n "$BODY_FILE" && -f "$BODY_FILE" ]]; then
  body="$(cat "$BODY_FILE")"
fi
if [[ -n "$TITLE_FILE" && -f "$TITLE_FILE" ]]; then
  title="$(cat "$TITLE_FILE")"
fi

text="$title
$body"

# If a PR is marked partial/scaffold/WIP, it must not contain closing keywords.
if echo "$text" | grep -Eiq 'PARTIAL:|Scaffold: true|Partial: true|WIP: true'; then
  if echo "$text" | grep -Eiq '\b(closes|fixes|resolves)\s*#\d+\b'; then
    echo "ERROR: PR contains closing keywords (Closes/Fixes/Resolves #n) but is marked partial/scaffold/WIP." >&2
    echo "Use Refs/Part of/Relates to instead, or remove partial/scaffold wording if the issue is fully complete." >&2
    exit 2
  fi
fi

echo "OK: issue closure guard passed."
