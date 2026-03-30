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
