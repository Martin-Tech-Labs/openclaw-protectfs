import Foundation
import Testing
@testable import OcProtectFsFuseCore

@Test func dekStoreV1RoundTripDeterministicHeader() throws {
  let kek = Data(repeating: 0x33, count: 32)
  let dek = Data(repeating: 0x44, count: DekStoreV1.Const.dekLen)
  let nonce = Data(repeating: 0x55, count: DekStoreV1.Const.nonceLen)

  let blob = try DekStoreV1.encodeWrappedDek(kek: kek, dek: dek, nonce: nonce)

  let headerLen = DekStoreV1.Const.magic.count + 2 + DekStoreV1.Const.nonceLen
  #expect(blob.count == headerLen + DekStoreV1.Const.dekLen + DekStoreV1.Const.tagLen)

  let header = blob.subdata(in: 0..<headerLen)
  var expectedHeader = Data()
  expectedHeader.append(DekStoreV1.Const.magic)
  expectedHeader.append(contentsOf: [DekStoreV1.Const.version, UInt8(DekStoreV1.Const.nonceLen)])
  expectedHeader.append(nonce)
  #expect(header == expectedHeader)

  let decoded = try DekStoreV1.decodeWrappedDek(kek: kek, blob: blob)
  #expect(decoded == dek)
}

@Test func dekStoreV1RejectsBadMagic() throws {
  let kek = Data(repeating: 0x33, count: 32)
  let dek = Data(repeating: 0x44, count: DekStoreV1.Const.dekLen)
  let nonce = Data(repeating: 0x55, count: DekStoreV1.Const.nonceLen)

  var blob = try DekStoreV1.encodeWrappedDek(kek: kek, dek: dek, nonce: nonce)
  blob[0] = 0x00

  #expect(throws: Error.self) {
    _ = try DekStoreV1.decodeWrappedDek(kek: kek, blob: blob)
  }
}

@Test func dekStoreV1RejectsTamperedCiphertext() throws {
  let kek = Data(repeating: 0x33, count: 32)
  let dek = Data(repeating: 0x44, count: DekStoreV1.Const.dekLen)
  let nonce = Data(repeating: 0x55, count: DekStoreV1.Const.nonceLen)

  var blob = try DekStoreV1.encodeWrappedDek(kek: kek, dek: dek, nonce: nonce)

  // Flip one bit inside the wrapped DEK ciphertext.
  let headerLen = DekStoreV1.Const.magic.count + 2 + DekStoreV1.Const.nonceLen
  blob[headerLen] ^= 0x01

  #expect(throws: Error.self) {
    _ = try DekStoreV1.decodeWrappedDek(kek: kek, blob: blob)
  }
}

@Test func dekStoreV1RejectsWrongKeyLengths() throws {
  let badKek = Data(repeating: 0x33, count: 31)
  let dek = Data(repeating: 0x44, count: DekStoreV1.Const.dekLen)
  let nonce = Data(repeating: 0x55, count: DekStoreV1.Const.nonceLen)

  #expect(throws: Error.self) {
    _ = try DekStoreV1.encodeWrappedDek(kek: badKek, dek: dek, nonce: nonce)
  }

  #expect(throws: Error.self) {
    _ = try DekStoreV1.decodeWrappedDek(kek: badKek, blob: Data())
  }

  let kek = Data(repeating: 0x33, count: 32)
  let badDek = Data(repeating: 0x44, count: 31)
  #expect(throws: Error.self) {
    _ = try DekStoreV1.encodeWrappedDek(kek: kek, dek: badDek, nonce: nonce)
  }
}
