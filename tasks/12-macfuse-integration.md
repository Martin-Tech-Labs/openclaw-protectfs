# Task 12 — macFUSE integration (spike + plan)

## Why this task exists

The repository currently has strong *logic-only* modules (policy, crypto, core authorization) and a robust wrapper lifecycle.
However, `fusefs/ocprotectfs-fuse.js` is still a placeholder that **does not mount a filesystem**.

V1 readiness in `docs/design-v1.md` requires an actual FUSE daemon that:
- mounts over `~/.openclaw` backed by `~/.openclaw.real`
- enforces plaintext passthrough vs encrypted-at-rest paths
- enforces strict gateway-only access checks for sensitive operations

This task is a **spike + concrete plan** for getting a real macFUSE mount into place while keeping the codebase testable.

## Goal

Choose an implementation strategy for the FUSE daemon on macOS and define an incremental path to:
1) mount successfully (passthrough)
2) wire in `core-v1` authorization
3) wire in `crypto-v1` for encrypted-at-rest files
4) add best-effort acceptance tests

## Constraints / assumptions

- macOS target (macFUSE installed for real mounts)
- CI likely cannot mount FUSE (permissions / kernel extension), so:
  - unit tests must cover the logic
  - acceptance tests must be mockable and/or best-effort and skippable
- Wrapper contract is already defined in `docs/wrapper-lifecycle.md`:
  - FUSE must print `READY` when mounted and ready
  - wrapper may enforce `--require-fuse-ready`

## Options (implementation strategies)

### Option A — Node FUSE bindings (preferred if viable)
Use a Node library that binds to libfuse / macFUSE.

Pros:
- keep most code in Node (aligns with current repo)
- easy to call existing JS modules (`policy-v1`, `crypto-v1`, `core-v1`)

Cons / unknowns:
- macOS support quality varies by library
- native build + headers needed (node-gyp)

Candidate libraries to evaluate:
- `fuse-native`
- `fuse-bindings`

### Option B — Small native FUSE daemon + JS policy/crypto via IPC
Write a minimal native daemon (Swift/Go/Rust/C++) for macFUSE operations.
Delegate policy/crypto decisions to a JS sidecar via a local IPC (unix socket).

Pros:
- macFUSE integration can be more “first-class”

Cons:
- significantly more complexity
- need to design/secure IPC protocol

### Option C — Defer true mount; ship “ProtectFS as policy toolkit”
Make it explicit that v1 is **logic-only** and does not provide an actual mounted filesystem.

Pros:
- lowest effort

Cons:
- does not satisfy the v1 readiness definition in `docs/design-v1.md`

## Proposed approach

Proceed with **Option A** first.

Implement the FUSE daemon incrementally:

### Step 1: minimal passthrough mount
- `fusefs/ocprotectfs-fuse.js` becomes a real mount (no crypto yet)
- operations: getattr, readdir, open, read, write, create, rename, unlink, mkdir, rmdir
- path mapping: `rel` → `${backstore}/${rel}`
- print `READY` only after mount is complete

### Step 2: core authorization hooks
- on every operation, call `authorizeOp({ op, rel, gatewayAccessAllowed })`
- `gatewayAccessAllowed` becomes true only when liveness + gateway checks pass
- initially implement only liveness socket ping (wrapper-alive) + gateway pid alive
  - caller PID check and executable hash check require macFUSE context access; may be added after we confirm the bindings expose it reliably

### Step 3: encrypted-at-rest for non-plaintext paths
- for encrypted paths:
  - store ciphertext in backstore format specified in `docs/design-v1.md` (`OCFS1` + AES-256-GCM)
  - keep plaintext paths as direct passthrough
- DEK provisioning: (plan)
  - wrapper already handles keychain/dek-store work in tasks 04/??
  - FUSE daemon should receive DEK via an env var pointing to a unix socket, or via stdin-only handoff (avoid env for secrets)
  - keep tests using a stub DEK

### Step 4: acceptance tests
- add a test suite that can run locally on macOS with macFUSE installed
- in CI:
  - skip if mount not permitted (detect via env flag or probing)

## Deliverables
- A short “spike report” section added here once we pick the library (Option A candidates)
- A follow-up implementation task file once the library is confirmed

## Acceptance criteria (for this planning PR)
- [ ] `tasks/STATUS.md` updated with a concrete Next item pointing at this task
- [ ] This task file clearly states:
  - the current gap (no real mount)
  - viable options
  - a proposed incremental approach
  - initial acceptance criteria for the implementation follow-up
- [ ] No code behavior changes; `npm test` still passes
