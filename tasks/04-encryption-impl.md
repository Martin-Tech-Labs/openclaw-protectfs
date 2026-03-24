# Task 04 — Encryption implementation (DEK/KEK)

## Goal
Implement at-rest encryption for the backstore and key management sufficient to support a real “protective” filesystem.

## Notes
- This task will likely need a dedicated design doc update before implementation.
- Be explicit about threat model, key lifecycle, and user presence requirements.

## Acceptance criteria (draft)
- Define the crypto scheme and key hierarchy (DEK/KEK) in docs.
- Implement encryption/decryption for file contents in the backstore.
- Keys are stored/retrieved using macOS Keychain (or a stubbed interface if the real integration is deferred).
- Add tests for:
  - encryption round-trip
  - incorrect key handling / corruption
  - metadata format/versioning
- `make test` passes locally.

## Risks
- Crypto is easy to get wrong. Prefer using well-vetted primitives/APIs and keep format/versioning simple.
