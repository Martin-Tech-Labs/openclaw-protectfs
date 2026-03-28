import Foundation

// Phase 3 (Issue #109): encrypted file + DEK sidecar handling parity with fusefs/src/encrypted-file.js.

public enum EncryptedFile {
  public static func sidecarDekPath(_ realPath: String) -> String {
    "\(realPath).ocpfs.dek"
  }

  public struct EncryptedFileError: Error, CustomStringConvertible {
    public let description: String
    public let code: Int32

    public static func eacces(_ msg: String) -> EncryptedFileError {
      EncryptedFileError(description: msg, code: EACCES)
    }
  }

  public static func loadOrCreateDek(kek: Data, realPath: String, createIfMissing: Bool) throws -> Data {
    let dekPath = sidecarDekPath(realPath)

    do {
      let wrapped = try Data(contentsOf: URL(fileURLWithPath: dekPath))
      return try DekStoreV1.decodeWrappedDek(kek: kek, blob: wrapped)
    } catch let e as CocoaError where e.code == .fileReadNoSuchFile {
      if !createIfMissing {
        throw EncryptedFileError.eacces("missing DEK sidecar")
      }

      let dek = DekStoreV1.newDek()
      let wrapped = try DekStoreV1.encodeWrappedDek(kek: kek, dek: dek)

      let dir = (realPath as NSString).deletingLastPathComponent
      try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true, attributes: [FileAttributeKey.posixPermissions: 0o700])

      // Write with 0600. Use atomic write to avoid partial blobs.
      try wrapped.write(to: URL(fileURLWithPath: dekPath), options: .atomic)
      try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: dekPath)

      return dek
    }
  }

  public static func readEncryptedFile(kek: Data, realPath: String, createIfMissing: Bool = false) throws -> (dek: Data, plaintext: Data) {
    let dek = try loadOrCreateDek(kek: kek, realPath: realPath, createIfMissing: createIfMissing)

    do {
      let blob = try Data(contentsOf: URL(fileURLWithPath: realPath))
      let plaintext = try OcfsCrypto.decodeEncryptedFileV1(dek: dek, blob: blob)
      return (dek, plaintext)
    } catch let e as CocoaError where e.code == .fileReadNoSuchFile {
      return (dek, Data())
    } catch {
      // Map decode errors to EACCES (matches JS behavior).
      throw EncryptedFileError.eacces("ciphertext decode failed")
    }
  }

  public static func writeEncryptedFile(dek: Data, realPath: String, plaintext: Data) throws {
    let blob = try OcfsCrypto.encodeEncryptedFileV1(dek: dek, plaintext: plaintext)

    let dir = (realPath as NSString).deletingLastPathComponent
    try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true, attributes: [FileAttributeKey.posixPermissions: 0o700])

    try blob.write(to: URL(fileURLWithPath: realPath), options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: realPath)
  }
}
