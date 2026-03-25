#!/usr/bin/env swift
import Foundation
import Security

struct Err: Error { let msg: String }

func die(_ msg: String) -> Never {
  fputs(msg + "\n", stderr)
  exit(2)
}

func b64(_ data: Data) -> String { data.base64EncodedString() }
func unb64(_ s: String) throws -> Data {
  guard let d = Data(base64Encoded: s) else { throw Err(msg: "invalid base64") }
  return d
}

func pemRSAPublicKey(_ pkcs1: Data) -> String {
  let b64lines = pkcs1.base64EncodedString(options: [.lineLength64Characters, .endLineWithLineFeed])
  return "-----BEGIN RSA PUBLIC KEY-----\n" + b64lines + "-----END RSA PUBLIC KEY-----\n"
}

func keyTagData(_ tag: String) -> Data {
  return tag.data(using: .utf8)!
}

func findPrivateKey(tag: String) -> SecKey? {
  let query: [String: Any] = [
    kSecClass as String: kSecClassKey,
    kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
    kSecAttrApplicationTag as String: keyTagData(tag),
    kSecReturnRef as String: true,
  ]

  var item: CFTypeRef?
  let status = SecItemCopyMatching(query as CFDictionary, &item)
  if status == errSecSuccess { return (item as! SecKey) }
  return nil
}

func ensureKeypair(tag: String) throws -> (privateKey: SecKey, publicKeyPem: String) {
  if let pk = findPrivateKey(tag: tag) {
    guard let pub = SecKeyCopyPublicKey(pk) else { throw Err(msg: "failed to copy public key") }
    var err: Unmanaged<CFError>?
    guard let pubBytes = SecKeyCopyExternalRepresentation(pub, &err) as Data? else {
      throw (err?.takeRetainedValue() as Error?) ?? Err(msg: "failed to export public key")
    }
    return (pk, pemRSAPublicKey(pubBytes))
  }

  // Create a non-exportable RSA keypair stored in the login keychain.
  let access = SecAccessControlCreateWithFlags(
    nil,
    kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    [],
    nil
  )

  let attrs: [String: Any] = [
    kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
    kSecAttrKeySizeInBits as String: 2048,
    kSecPrivateKeyAttrs as String: [
      kSecAttrIsPermanent as String: true,
      kSecAttrApplicationTag as String: keyTagData(tag),
      kSecAttrAccessControl as String: access as Any,
    ]
  ]

  var err: Unmanaged<CFError>?
  guard let priv = SecKeyCreateRandomKey(attrs as CFDictionary, &err) else {
    throw (err?.takeRetainedValue() as Error?) ?? Err(msg: "failed to create key")
  }
  guard let pub = SecKeyCopyPublicKey(priv) else { throw Err(msg: "failed to copy public key") }
  guard let pubBytes = SecKeyCopyExternalRepresentation(pub, &err) as Data? else {
    throw (err?.takeRetainedValue() as Error?) ?? Err(msg: "failed to export public key")
  }

  return (priv, pemRSAPublicKey(pubBytes))
}

func decryptOAEP_SHA256(tag: String, ciphertext: Data) throws -> Data {
  guard let priv = findPrivateKey(tag: tag) else { throw Err(msg: "private key not found") }
  let alg = SecKeyAlgorithm.rsaEncryptionOAEPSHA256
  guard SecKeyIsAlgorithmSupported(priv, .decrypt, alg) else { throw Err(msg: "algorithm not supported") }

  var err: Unmanaged<CFError>?
  guard let pt = SecKeyCreateDecryptedData(priv, alg, ciphertext as CFData, &err) as Data? else {
    throw (err?.takeRetainedValue() as Error?) ?? Err(msg: "decrypt failed")
  }
  return pt
}

// ---- CLI ----

let args = CommandLine.arguments
if args.count < 2 {
  die("usage: keywrap_keychain.swift ensure --tag <tag> | decrypt --tag <tag> --ciphertext-b64 <b64>")
}

let cmd = args[1]
func arg(_ name: String) -> String? {
  if let idx = args.firstIndex(of: name), idx + 1 < args.count { return args[idx + 1] }
  return nil
}

if cmd == "ensure" {
  guard let tag = arg("--tag") else { die("missing --tag") }
  do {
    let res = try ensureKeypair(tag: tag)
    let out: [String: Any] = ["publicKeyPem": res.publicKeyPem]
    let data = try JSONSerialization.data(withJSONObject: out, options: [])
    FileHandle.standardOutput.write(data)
  } catch {
    die("ensure error: \(error)")
  }
} else if cmd == "decrypt" {
  guard let tag = arg("--tag") else { die("missing --tag") }
  guard let ctB64 = arg("--ciphertext-b64") else { die("missing --ciphertext-b64") }
  do {
    let ct = try unb64(ctB64)
    let pt = try decryptOAEP_SHA256(tag: tag, ciphertext: ct)
    let out: [String: Any] = ["plaintextB64": b64(pt)]
    let data = try JSONSerialization.data(withJSONObject: out, options: [])
    FileHandle.standardOutput.write(data)
  } catch {
    die("decrypt error: \(error)")
  }
} else {
  die("unknown command: \(cmd)")
}
