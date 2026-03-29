import Foundation
import Testing
@testable import OcProtectFsFuseCore

@Test func cryptoV1RoundTripDeterministicHeader() throws {
  let dek = Data(repeating: 0x11, count: 32)
  let nonce = Data(repeating: 0x22, count: OcfsCrypto.Initial.nonceLen)
  let plaintext = Data("hello world".utf8)

  let blob = try OcfsCrypto.encodeEncryptedFileV1(dek: dek, plaintext: plaintext, nonce: nonce)

  // Header layout sanity check.
  #expect(blob.count >= OcfsCrypto.Initial.fileMagic.count + 3 + OcfsCrypto.Initial.nonceLen + OcfsCrypto.Initial.tagLen)

  let headerLen = OcfsCrypto.Initial.fileMagic.count + 3 + OcfsCrypto.Initial.nonceLen
  let header = blob.subdata(in: 0..<headerLen)

  var expectedHeader = Data()
  expectedHeader.append(OcfsCrypto.Initial.fileMagic)
  expectedHeader.append(contentsOf: [
    OcfsCrypto.Initial.fileVersion,
    OcfsCrypto.Initial.algAes256Gcm,
    UInt8(OcfsCrypto.Initial.nonceLen)
  ])
  expectedHeader.append(nonce)

  #expect(header == expectedHeader)

  let decoded = try OcfsCrypto.decodeEncryptedFileV1(dek: dek, blob: blob)
  #expect(decoded == plaintext)
}

@Test func cryptoV1RejectsBadMagic() throws {
  let dek = Data(repeating: 0x11, count: 32)
  let nonce = Data(repeating: 0x22, count: OcfsCrypto.Initial.nonceLen)
  let plaintext = Data("abc".utf8)

  var blob = try OcfsCrypto.encodeEncryptedFileV1(dek: dek, plaintext: plaintext, nonce: nonce)
  blob[0] = 0x00

  #expect(throws: Error.self) {
    _ = try OcfsCrypto.decodeEncryptedFileV1(dek: dek, blob: blob)
  }
}

@Test func cryptoV1RejectsTamperedTag() throws {
  let dek = Data(repeating: 0x11, count: 32)
  let nonce = Data(repeating: 0x22, count: OcfsCrypto.Initial.nonceLen)
  let plaintext = Data("abc".utf8)

  var blob = try OcfsCrypto.encodeEncryptedFileV1(dek: dek, plaintext: plaintext, nonce: nonce)

  // Flip one bit in the auth tag.
  blob[blob.count - 1] ^= 0x01

  #expect(throws: Error.self) {
    _ = try OcfsCrypto.decodeEncryptedFileV1(dek: dek, blob: blob)
  }
}

@Test func cryptoV1RejectsWrongDekLength() throws {
  let badDek = Data(repeating: 0x11, count: 31)
  let nonce = Data(repeating: 0x22, count: OcfsCrypto.Initial.nonceLen)

  #expect(throws: Error.self) {
    _ = try OcfsCrypto.encodeEncryptedFileV1(dek: badDek, plaintext: Data(), nonce: nonce)
  }

  #expect(throws: Error.self) {
    _ = try OcfsCrypto.decodeEncryptedFileV1(dek: badDek, blob: Data())
  }
}
