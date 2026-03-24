# Task 04 — Encryption implementation (DEK/KEK)

## Goal
Implement at-rest encryption for the backstore and key management sufficient to support a real “protective” filesystem.

## Notes
- This task will likely need a dedicated design doc update before implementation.
- Be explicit about threat model, key lifecycle, and user presence requirements.

## Acceptance criteria
- [x] Define the crypto scheme and key hierarchy (DEK/KEK) in docs.
- [x] Implement encryption/decryption for file contents in the backstore (versioned file format).
- [x] Keys are stored/retrieved using macOS Keychain (**or** a stubbed interface when running tests).
- [x] Add tests for:
  - [x] encryption round-trip
  - [x] incorrect key handling / corruption
  - [x] metadata format/versioning
- [x] `make test` passes locally.

## Implementation notes
- v1 uses **AES-256-GCM** (Node built-in `crypto`) rather than XChaCha20-Poly1305 to avoid extra native deps.
- Introduced a small, versioned wrapped-DEK blob format (`OCDEK1`) to store DEK encrypted under KEK.
- Encrypted file format (`OCFS1`) authenticates its header via AEAD AAD.

## Risks
- Crypto is easy to get wrong. Prefer using well-vetted primitives/APIs and keep format/versioning simple.
