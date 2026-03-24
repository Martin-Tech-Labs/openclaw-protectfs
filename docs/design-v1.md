# Design v1 — OpenClaw protective filesystem (macFUSE)

## Summary
We provide a FUSE-mounted view at `~/.openclaw` backed by a real directory `~/.openclaw.real`.

- `workspace/**` and `workspace-joao/**` are plaintext passthrough.
- Everything else is stored encrypted at rest in the backstore.
- Decryption/encryption occurs only inside the FUSE daemon, and only when a strict access-control check passes.

A separate wrapper process is the root of trust:
- mounts the FUSE filesystem
- obtains the data-encryption key from Keychain with **user presence**
- spawns the OpenClaw gateway as its child
- provides a liveness socket used by FUSE to fail-closed

## Threat model
### In-scope
- Other arbitrary processes running as the same user (`agent`) should not be able to read sensitive OpenClaw data from disk (only ciphertext).
- Even if they can read `~/.openclaw.real`, they must not obtain plaintext without passing FUSE policy.

### Out-of-scope / non-goals (v1)
- Defending against root / kernel compromise.
- Preventing exfiltration via the gateway itself (if gateway is compromised).
- Perfect defense against PID reuse. Mitigation in v1: the wrapper owns the gateway lifetime; the FUSE daemon validates caller PID == recorded gateway PID AND re-hashes the resolved executable for that PID against the trusted SHA-256 on each sensitive access (with only a very short TTL cache).

## Directory layout
- Mountpoint: `/Users/agent/.openclaw` (FUSE)
- Backstore: `/Users/agent/.openclaw.real`

Policy zones:
- Plaintext:
  - `/Users/agent/.openclaw/workspace/**`
  - `/Users/agent/.openclaw/workspace-joao/**`
- Encrypted:
  - everything else under `/Users/agent/.openclaw/**`

## Wrapper responsibilities
- One-time migration: move existing `~/.openclaw` to `~/.openclaw.real` (atomic rename), create empty mountpoint dir.
- Obtain DEK from Keychain requiring user presence.
- Start FUSE daemon and pass DEK via Unix domain socket (in-memory).
- Start gateway via known node invocation.
- Write state:
  - wrapper PID file
  - gateway PID file
  - trusted gateway executable SHA-256
  - create/hold liveness socket (accepts ping)

If gateway exits, wrapper unmounts (or flips FUSE to deny sensitive operations).

## FUSE daemon design
### Backstore mapping

### Atomicity and crash safety
For encrypted files, writes must be atomic to avoid partial ciphertext:
- write to a temp file in the same directory
- fsync (where supported)
- atomic rename to the target path
- best-effort fsync the parent directory

All FUSE paths map 1:1 to backstore paths under `~/.openclaw.real`.

### Access control
For encrypted paths, allow read/write only if **all** checks pass:
1) wrapper alive: ping liveness unix socket
2) gateway alive: `kill(gatewayPid, 0) == 0`
3) caller PID == gateway PID (from FUSE context)
4) caller executable hash matches trusted gateway hash (hash the resolved executable path for the PID)

Otherwise return `EACCES`.

Plaintext paths are allowed normally (v1) for the same user.

### Liveness check frequency
To avoid TOCTOU overhead on every I/O, cache liveness result for a short TTL (e.g. 250ms) but never cache across failures.

## Crypto
### Algorithm
- AEAD (v1): XChaCha20-Poly1305 (24-byte nonce).

### File format (encrypted backstore)
Each encrypted file stored in backstore contains:
- magic bytes: `OCFS1` (5 bytes)
- version: 1 byte (0x01)
- nonce: 24 bytes (XChaCha20-Poly1305)
- ciphertext+tag (as produced by the AEAD)

Optional future fields: original size, header flags.

### Key management
- DEK stored as Keychain item.
- Keychain item requires user presence.
- ACL pinned to wrapper binary.
- Wrapper passes DEK to FUSE daemon over a unix socket; FUSE never touches Keychain.

## Required filesystem operations (v1)
Minimum set:
- getattr
- readdir
- open
- read
- write
- create
- rename
- unlink

Additional likely needed for correctness:
- mkdir, rmdir
- truncate
- utimens
- flush/fsync

## Testing
### Unit tests (mocked)
- Policy engine: path classification, PID checks, liveness TTL
- Crypto: encrypt/decrypt roundtrips + tamper detection
- Backstore mapping

### Acceptance tests (best-effort)
- Mount FUSE on temp dirs; use fake wrapper socket + fake gateway pid
- Verify:
  - workspace passthrough
  - encrypted backstore does not contain plaintext
  - deny on missing wrapper
  - deny on PID mismatch

## OWASP notes
- Fail closed by default.
- Zeroize key material where possible.
- Avoid passing secrets via env/argv.
- Validate all inputs (paths, sizes).
- Use constant-time comparisons for hashes.
