import Foundation

// Tiny helper binary compiled by Node tests.
// Usage:
//   crypto-interop encode <dekHex> <nonceHex> <plaintextBase64>
//   crypto-interop decode <dekHex> <blobBase64>

func hexToData(_ hex: String) -> Data {
  var bytes: [UInt8] = []
  bytes.reserveCapacity(hex.count / 2)

  var i = hex.startIndex
  while i < hex.endIndex {
    let j = hex.index(i, offsetBy: 2)
    let b = UInt8(hex[i..<j], radix: 16)!
    bytes.append(b)
    i = j
  }
  return Data(bytes)
}

let args = CommandLine.arguments
if args.count < 2 {
  fputs("usage: crypto-interop <encode|decode> ...\n", stderr)
  exit(2)
}

switch args[1] {
case "encode":
  if args.count != 5 {
    fputs("usage: crypto-interop encode <dekHex> <nonceHex> <plaintextBase64>\n", stderr)
    exit(2)
  }
  let dek = hexToData(args[2])
  let nonce = hexToData(args[3])
  let plaintext = Data(base64Encoded: args[4])!

  let blob = try OcfsCrypto.encodeEncryptedFileV1(dek: dek, plaintext: plaintext, nonce: nonce)
  print(blob.base64EncodedString())

case "decode":
  if args.count != 4 {
    fputs("usage: crypto-interop decode <dekHex> <blobBase64>\n", stderr)
    exit(2)
  }
  let dek = hexToData(args[2])
  let blob = Data(base64Encoded: args[3])!

  let plaintext = try OcfsCrypto.decodeEncryptedFileV1(dek: dek, blob: blob)
  print(plaintext.base64EncodedString())

default:
  fputs("unknown mode\n", stderr)
  exit(2)
}
