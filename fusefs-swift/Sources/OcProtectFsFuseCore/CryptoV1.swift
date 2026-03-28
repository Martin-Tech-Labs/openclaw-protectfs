import Foundation
import CryptoKit

// Phase 3 (Issue #109): crypto/policy/authz port.
// This file starts by porting the on-disk encrypted file format used by the Node implementation.
//
// Format (v1):
//   magic "OCFS1" (5 bytes)
//   version (1 byte) = 0x01
//   alg (1 byte) = 0x01 (AES-256-GCM)
//   nonceLen (1 byte) = 12
//   nonce (12 bytes)
//   ciphertext (...)
//   tag (16 bytes)
//
// AEAD AAD = header (magic+version+alg+nonceLen+nonce)

enum OcfsCrypto {
  enum Initial {
    static let fileMagic = Data("OCFS1".utf8)
    static let fileVersion: UInt8 = 0x01
    static let algAes256Gcm: UInt8 = 0x01
    static let nonceLen = 12
    static let tagLen = 16
  }

  struct DecodeError: Error, CustomStringConvertible {
    let description: String
  }

  /// Encode an encrypted file blob (Node-compatible).
  ///
  /// - Parameters:
  ///   - dek: 32-byte data encryption key
  ///   - plaintext: file contents
  ///   - nonce: optional 12-byte nonce (for tests). If nil, a random nonce is generated.
  static func encodeEncryptedFileV1(dek: Data, plaintext: Data, nonce: Data? = nil) throws -> Data {
    guard dek.count == 32 else { throw DecodeError(description: "dek must be 32 bytes") }

    let useNonce: Data
    if let nonce {
      guard nonce.count == Initial.nonceLen else { throw DecodeError(description: "nonce must be 12 bytes") }
      useNonce = nonce
    } else {
      var b = [UInt8](repeating: 0, count: Initial.nonceLen)
      _ = SecRandomCopyBytes(kSecRandomDefault, b.count, &b)
      useNonce = Data(b)
    }

    var header = Data()
    header.append(Initial.fileMagic)
    header.append(contentsOf: [Initial.fileVersion, Initial.algAes256Gcm, UInt8(Initial.nonceLen)])
    header.append(useNonce)

    let key = SymmetricKey(data: dek)
    let nonce = try AES.GCM.Nonce(data: useNonce)

    let sealed = try AES.GCM.seal(plaintext, using: key, nonce: nonce, authenticating: header)

    guard sealed.tag.count == Initial.tagLen else {
      throw DecodeError(description: "unexpected auth tag length")
    }

    var out = Data()
    out.append(header)
    out.append(sealed.ciphertext)
    out.append(sealed.tag)
    return out
  }

  /// Decode a v1 encrypted blob (Node-compatible) and return plaintext.
  static func decodeEncryptedFileV1(dek: Data, blob: Data) throws -> Data {
    guard dek.count == 32 else { throw DecodeError(description: "dek must be 32 bytes") }

    let minLen = Initial.fileMagic.count + 3 + Initial.nonceLen + Initial.tagLen
    guard blob.count >= minLen else { throw DecodeError(description: "ciphertext blob too small") }

    let magic = blob.subdata(in: 0..<Initial.fileMagic.count)
    guard magic == Initial.fileMagic else { throw DecodeError(description: "bad magic") }

    let version = blob[Initial.fileMagic.count + 0]
    let alg = blob[Initial.fileMagic.count + 1]
    let nonceLen = Int(blob[Initial.fileMagic.count + 2])

    guard version == Initial.fileVersion else { throw DecodeError(description: "unsupported version: \(version)") }
    guard alg == Initial.algAes256Gcm else { throw DecodeError(description: "unsupported alg: \(alg)") }
    guard nonceLen == Initial.nonceLen else { throw DecodeError(description: "unsupported nonceLen: \(nonceLen)") }

    let headerLen = Initial.fileMagic.count + 3 + Initial.nonceLen
    let header = blob.subdata(in: 0..<headerLen)
    let nonceData = blob.subdata(in: (Initial.fileMagic.count + 3)..<headerLen)

    let tagStart = blob.count - Initial.tagLen
    let ciphertext = blob.subdata(in: headerLen..<tagStart)
    let tag = blob.subdata(in: tagStart..<blob.count)

    let key = SymmetricKey(data: dek)
    let nonce = try AES.GCM.Nonce(data: nonceData)

    let sealed = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
    return try AES.GCM.open(sealed, using: key, authenticating: header)
  }
}
