import Foundation
import CryptoKit

// Phase 3 (Issue #109): wrapped DEK store parity with fusefs/src/dek-store.js.
//
// Wrapped DEK format (v1):
//   magic "OCDEK1" (6 bytes)
//   version (1 byte) = 0x01
//   nonceLen (1 byte) = 12
//   nonce (12 bytes)
//   ciphertext (32 bytes)
//   tag (16 bytes)
//
// AEAD AAD = header (magic+version+nonceLen+nonce)

enum DekStoreV1 {
  enum Const {
    static let magic = Data("OCDEK1".utf8)
    static let version: UInt8 = 0x01
    static let nonceLen = 12
    static let dekLen = 32
    static let tagLen = 16
  }

  struct DekError: Error, CustomStringConvertible {
    let description: String
  }

  static func newDek() -> Data {
    var b = [UInt8](repeating: 0, count: Const.dekLen)
    _ = SecRandomCopyBytes(kSecRandomDefault, b.count, &b)
    return Data(b)
  }

  static func encodeWrappedDek(kek: Data, dek: Data, nonce: Data? = nil) throws -> Data {
    guard kek.count == 32 else { throw DekError(description: "kek must be 32 bytes") }
    guard dek.count == Const.dekLen else { throw DekError(description: "dek must be 32 bytes") }

    let useNonce: Data
    if let nonce {
      guard nonce.count == Const.nonceLen else { throw DekError(description: "nonce must be 12 bytes") }
      useNonce = nonce
    } else {
      var b = [UInt8](repeating: 0, count: Const.nonceLen)
      _ = SecRandomCopyBytes(kSecRandomDefault, b.count, &b)
      useNonce = Data(b)
    }

    var header = Data()
    header.append(Const.magic)
    header.append(contentsOf: [Const.version, UInt8(Const.nonceLen)])
    header.append(useNonce)

    let key = SymmetricKey(data: kek)
    let nonce = try AES.GCM.Nonce(data: useNonce)
    let sealed = try AES.GCM.seal(dek, using: key, nonce: nonce, authenticating: header)

    guard sealed.ciphertext.count == Const.dekLen else { throw DekError(description: "unexpected ciphertext length") }
    guard sealed.tag.count == Const.tagLen else { throw DekError(description: "unexpected tag length") }

    var out = Data()
    out.append(header)
    out.append(sealed.ciphertext)
    out.append(sealed.tag)
    return out
  }

  static func decodeWrappedDek(kek: Data, blob: Data) throws -> Data {
    guard kek.count == 32 else { throw DekError(description: "kek must be 32 bytes") }

    let minLen = Const.magic.count + 2 + Const.nonceLen + Const.dekLen + Const.tagLen
    guard blob.count >= minLen else { throw DekError(description: "wrapped DEK blob too small") }

    let magic = blob.subdata(in: 0..<Const.magic.count)
    guard magic == Const.magic else { throw DekError(description: "bad wrapped DEK magic") }

    let version = blob[Const.magic.count + 0]
    let nonceLen = Int(blob[Const.magic.count + 1])
    guard version == Const.version else { throw DekError(description: "unsupported wrapped DEK version: \(version)") }
    guard nonceLen == Const.nonceLen else { throw DekError(description: "unsupported wrapped DEK nonceLen: \(nonceLen)") }

    let headerLen = Const.magic.count + 2 + Const.nonceLen
    let header = blob.subdata(in: 0..<headerLen)
    let nonceData = blob.subdata(in: (Const.magic.count + 2)..<headerLen)

    let tagStart = blob.count - Const.tagLen
    let ciphertext = blob.subdata(in: headerLen..<tagStart)
    let tag = blob.subdata(in: tagStart..<blob.count)

    let key = SymmetricKey(data: kek)
    let nonce = try AES.GCM.Nonce(data: nonceData)
    let sealed = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)

    let dek = try AES.GCM.open(sealed, using: key, authenticating: header)
    guard dek.count == Const.dekLen else { throw DekError(description: "unexpected DEK length") }
    return dek
  }
}
