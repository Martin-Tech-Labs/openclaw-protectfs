import Foundation
import Testing
@testable import OcProtectFsFuseCore

// Node <-> Swift interop vectors.
//
// These fixtures are generated from the Node implementation using:
//   encodeEncryptedFileV1WithNonce({ dek: 0x11*32, nonce: 0x22*12, plaintext: "hello interop" })
//
// Goal: lock in on-disk ciphertext format compatibility for the Swift rewrite.

@Test func nodeInteropEncryptedFileV1VectorRoundTrip() throws {
  let dek = Data(repeating: 0x11, count: 32)
  let nonce = Data(repeating: 0x22, count: OcfsCrypto.Initial.nonceLen)
  let plaintext = Data("hello interop".utf8)

  // Base64 produced by Node (fusefs/src/crypto.js encodeEncryptedFileV1WithNonce).
  let blobB64 = "T0NGUzEBAQwiIiIiIiIiIiIiIiJ/kmslr+/2MZFarFM4rA8SEmbFEdRm0SNMoJvsBw=="
  let nodeBlob = try #require(Data(base64Encoded: blobB64))

  // Node -> Swift decode.
  let decoded = try OcfsCrypto.decodeEncryptedFileV1(dek: dek, blob: nodeBlob)
  #expect(decoded == plaintext)

  // Swift -> Node-compatible encode (deterministic nonce) equals Node bytes.
  let encoded = try OcfsCrypto.encodeEncryptedFileV1(dek: dek, plaintext: plaintext, nonce: nonce)
  #expect(encoded == nodeBlob)
}
