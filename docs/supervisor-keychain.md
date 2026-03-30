# Swift supervisor: Keychain KEK + ACL notes

This repo stores the **KEK** (Key Encryption Key) in the user Keychain under:

- service: `ocprotectfs`
- account: `kek`

The Swift supervisor resolves the KEK at runtime and passes it to the FUSE daemon via an **anonymous pipe** (`--kek-fd 3`). The KEK is **never written to disk**.

## When Keychain is used

To avoid hanging automated runs, Keychain is only used when:

- platform is macOS (`darwin`)
- not running in CI (`CI` env not truthy)
- **interactive** session (TTY)

Otherwise an **ephemeral random** KEK is generated (tests/CI only).

## User-presence (TouchID / password)

When writing the KEK item, the supervisor attempts to use `SecAccessControl` with `userPresence`.
This means reads may prompt for TouchID/password depending on system policy.

## Best-effort ACL pinning to the supervisor binary

The supervisor also attempts a best-effort “trusted application” ACL pinning step:

- It uses legacy macOS Keychain ACLs (`SecTrustedApplication`) and tries to restrict the item to the current executable path.
- This may fail on some macOS versions/policies (or conflict with `SecAccessControl`). If it fails, the supervisor retries without pinning.

### Code-signing the supervisor

To make ACL pinning meaningful, the supervisor executable should be code-signed.
Example (ad-hoc signing):

```bash
codesign -s - -f --timestamp=none ./path/to/ocprotectfs-supervisor
codesign -dv --verbose=4 ./path/to/ocprotectfs-supervisor
```

### Inspecting the Keychain item

You can inspect the Keychain entry with the `security` CLI:

```bash
security find-generic-password -s ocprotectfs -a kek -g
```

(Depending on Keychain policy, this may prompt.)

### How to verify ACL linkage (trusted app restriction)

Because Keychain ACL UX/details vary by macOS version, treat this as a **best-effort operator check**:

1) Open **Keychain Access**
2) Search for:
   - **Kind:** “application password” (generic password)
   - **Name/service:** `ocprotectfs`
   - **Account:** `kek`
3) Open the item → **Access Control** tab
4) Confirm the supervisor binary (or your signed wrapper that embeds/execs it) is listed under “Always allow access by these applications”.

Notes:
- If the supervisor is **not code-signed**, ACL pinning is weaker/meaningless. (Ad-hoc signing is still better than unsigned.)
- If the system refuses/ignores ACL pinning (or it conflicts with `SecAccessControl`), the supervisor falls back to storing the item **without** trusted-app pinning.

### Best-effort macOS Keychain integration test (local)

CI generally cannot satisfy **user-presence** prompts, so we keep Keychain integration as **opt-in**.

To run the macOS Keychain round-trip test locally:

```bash
cd supervisor-swift
OCPROTECTFS_RUN_KEYCHAIN_TESTS=1 swift test
```

This test writes/reads/deletes a throwaway generic-password item **without** user-presence access control (to avoid prompts).