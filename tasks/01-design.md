# Task 01 — Design spec

## Goal
Write a concrete initial design spec for the macFUSE protective filesystem + wrapper.

## Requirements (from Martin)
- Mount over existing OpenClaw dir: mountpoint `~/.openclaw`
- Backstore at `~/.openclaw.real`
- Path policy:
  - plaintext passthrough for `workspace/**` and `workspace-joao/**`
  - encrypt-at-rest for everything else
- Access control (sensitive paths): allow only if
  - caller PID == gateway PID (strict)
  - gateway binary hash matches trusted SHA-256
  - wrapper liveness ok
  - gateway liveness ok
  - otherwise deny
- Wrapper:
  - starts FUSE first, gateway second
  - stays alive while gateway alive
  - if wrapper exits: FUSE must fail-closed for sensitive
- Crypto:
  - AEAD per-file encryption
  - wrapper retrieves key from Keychain with user presence
  - keychain ACL pinned to wrapper; wrapper passes key to FUSE in-memory (unix socket)
- Testing expectations:
  - unit tests with mocks
  - acceptance tests where possible
  - OWASP-aligned notes

## Deliverable
- `docs/design.md` with:
  - threat model + non-goals
  - directory layout
  - policy rules
  - process identity/liveness checks
  - key management approach
  - crypto format (file header)
  - required FUSE ops list
  - test plan

## Acceptance criteria
- Design doc is specific enough to implement without ambiguity.
- Explicitly calls out known fragilities (PID reuse, helper processes, etc.) and mitigations.
