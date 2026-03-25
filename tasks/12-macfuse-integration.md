# Task 12 — macFUSE integration (spike + plan)

## Why this task exists

The repository currently has strong *logic-only* modules (policy, crypto, core authorization) and a robust wrapper lifecycle.
However, `fusefs/ocprotectfs-fuse.js` is still a placeholder that **does not mount a filesystem**.

Initial readiness in `docs/design.md` requires an actual FUSE daemon that:
- mounts over `~/.openclaw` backed by `~/.openclaw.real`
- enforces plaintext passthrough vs encrypted-at-rest paths
- enforces strict gateway-only access checks for sensitive operations

This task is a **spike + concrete plan** for getting a real macFUSE mount into place while keeping the codebase testable.

## Goal

Choose an implementation strategy for the FUSE daemon on macOS and define an incremental path to:
1) mount successfully (passthrough)
2) wire in `core` authorization
3) wire in `crypto` for encrypted-at-rest files
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
- easy to call existing JS modules (`policy`, `crypto`, `core`)

Cons / unknowns:
- macOS support quality varies by library
- native build + headers needed (node-gyp) unless prebuilds are shipped

Candidate libraries:
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
Make it explicit that initial is **logic-only** and does not provide an actual mounted filesystem.

Pros:
- lowest effort

Cons:
- does not satisfy the initial readiness definition in `docs/design.md`

## Spike report (decision)

### Decision: use `fuse-native`

Proceed with **Option A** using **`fuse-native`** as the binding.

Rationale:
- Explicit macOS support (docs mention macOS options like `displayFolder` and OSXFUSE/macFUSE licensing).
- N-API support (prebuilds are commonly shipped; reduces friction across Node versions).
- API is a direct fit for this repo: a single Node process implements handlers and can call `core` / `crypto` in-process (no IPC).

Notes / caveats to plan around:
- Still requires macFUSE to be installed and configured on developer machines.
- The FUSE handler surface is broad; we should start with a *minimal* set of operations required by OpenClaw’s wrapper + common usage.
- CI will almost certainly not run a real mount; acceptance tests must be skippable.

Non-goals for the first implementation pass:
- Perfect macOS-specific “caller PID / signing” enforcement. We’ll start with wrapper-level liveness checks, then add stronger process identity checks if the binding exposes reliable context.

## Proposed approach (incremental)

Implement the FUSE daemon in 4 increments.

### Step 1: minimal passthrough mount (first implementation PR)

Goal: prove we can mount reliably and satisfy the wrapper lifecycle contract.

Plan:
- Replace `fusefs/ocprotectfs-fuse.js` placeholder with a real `fuse-native` mount.
- Support a minimal set of ops needed for basic usage:
  - `init`
  - `getattr`, `readdir`
  - `open`, `release`, `read`, `write`
  - `create`, `unlink`, `rename`
  - `mkdir`, `rmdir`
  - (add `truncate` / `ftruncate` if needed by common editors)
- Path mapping:
  - FUSE `path` is absolute-from-mount (e.g. `/foo/bar`)
  - compute `rel = path.slice(1)` (carefully handle `/`)
  - map to `real = path.join(backstoreRoot, rel)`
- “READY” contract:
  - print `READY` only inside the `mount()` callback (i.e. after a successful mount).
  - ensure errors print a single-line error + exit non-zero.

### Step 2: `core` authorization hooks

Goal: deny sensitive operations unless the wrapper/gateway is considered “the caller”.

Plan:
- Introduce a small adapter API inside the FUSE daemon:
  - `authorizeOrErr({ op, rel }) -> 0 | -EPERM`
- Start with wrapper-level liveness checks only:
  - validate wrapper “alive socket” / lease file (whatever the repo already uses)
  - validate gateway PID is alive (best-effort)
- Enforce authorization on:
  - all mutating ops (create/write/rename/unlink/mkdir/rmdir/truncate)
  - and optionally on reads for encrypted paths

Future hardening (only if binding supports it):
- Stronger “caller identity” using request context (PID/uid/gid) + allowlist.

### Step 3: encrypted-at-rest for non-plaintext paths (`crypto`)

Goal: plaintext for allowed paths; encrypted backing store for everything else.

Plan:
- Plaintext paths: direct passthrough to backstore.
- Encrypted paths:
  - in backstore store ciphertext format defined in `docs/design.md` (`OCFS1` + AES-256-GCM).
  - implement read path: read ciphertext file → decrypt → serve plaintext bytes.
  - implement write path: buffer writes (or block-aligned strategy) → encrypt → write ciphertext.

Key provisioning plan:
- Avoid env vars for secrets.
- Preferred: wrapper passes DEK via stdin (one-shot) or via a dedicated unix domain socket created with strict perms.
- Tests should use a deterministic stub DEK.

### Step 4: acceptance tests (best-effort)

Goal: locally verifiable behavior without requiring CI FUSE mounts.

Plan:
- Add a macOS-only test script that:
  - mounts into a temp dir
  - performs a small set of fs operations
  - asserts backstore effects
  - unmounts cleanly
- In CI, skip if macFUSE is not present or mounting is not permitted.

## Follow-up work items (implementation tasks)

### Task 13 (follow-up): macFUSE passthrough mount using `fuse-native`

Acceptance criteria:
- [ ] `ocprotectfs` wrapper can start the FUSE daemon and receive `READY`.
- [ ] Mount succeeds on macOS with macFUSE installed.
- [ ] Basic ops work: `ls`, `cat`, `mkdir`, `touch`, `rm`, `mv` inside the mount.
- [ ] Unmount is clean (no hung process); wrapper stop path works.
- [ ] Unit tests continue to pass (`npm test`).
- [ ] Optional (best-effort) local-only mount test exists and can be skipped in CI.

Risks:
- Native build friction on developer machines (Xcode CLT / node-gyp).
- macFUSE permission / configuration issues.
- Missing ops needed by real-world programs (e.g. editors triggering `ftruncate`, `fsync`, xattrs).

## Acceptance criteria (for this planning PR)

- [ ] `tasks/STATUS.md` updated with a concrete Next item pointing at the follow-up implementation.
- [ ] This task file clearly states:
  - the current gap (no real mount)
  - viable options
  - a chosen library and rationale
  - a proposed incremental approach
  - initial acceptance criteria + risks for the follow-up implementation
- [ ] No code behavior changes; `npm test` still passes
