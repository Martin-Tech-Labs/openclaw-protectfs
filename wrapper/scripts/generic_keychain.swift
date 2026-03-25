#!/usr/bin/env swift
import Foundation
import Security

func die(_ msg: String) -> Never {
  fputs(msg + "\n", stderr)
  exit(1)
}

func jsonOut(_ obj: Any) {
  let data = try! JSONSerialization.data(withJSONObject: obj, options: [])
  FileHandle.standardOutput.write(data)
}

func nextArg(_ args: [String], _ i: inout Int) -> String {
  i += 1
  if i >= args.count { die("missing value for \(args[i-1])") }
  return args[i]
}

let args = CommandLine.arguments
if args.count < 2 {
  die("usage: generic_keychain.swift get --service <svc> --account <acc> | set --service <svc> --account <acc> --data-b64 <b64> [--require-user-presence 0|1]")
}

let cmd = args[1]
var service: String?
var account: String?
var dataB64: String?
var requireUserPresence: Bool = true

var i = 2
while i < args.count {
  let a = args[i]
  switch a {
  case "--service":
    service = nextArg(args, &i)
  case "--account":
    account = nextArg(args, &i)
  case "--data-b64":
    dataB64 = nextArg(args, &i)
  case "--require-user-presence":
    let v = nextArg(args, &i)
    requireUserPresence = (v == "1" || v.lowercased() == "true")
  default:
    die("unknown arg: \(a)")
  }
  i += 1
}

guard let svc = service, let acc = account else {
  die("--service and --account required")
}

func baseQuery() -> [String: Any] {
  return [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: svc,
    kSecAttrAccount as String: acc,
  ]
}

if cmd == "get" {
  var q = baseQuery()
  q[kSecReturnData as String] = true
  q[kSecMatchLimit as String] = kSecMatchLimitOne

  var item: CFTypeRef?
  let status = SecItemCopyMatching(q as CFDictionary, &item)
  if status == errSecItemNotFound {
    jsonOut(["dataB64": NSNull()])
    exit(0)
  }
  guard status == errSecSuccess else {
    die("SecItemCopyMatching failed: \(status)")
  }
  guard let data = item as? Data else {
    die("unexpected item type")
  }
  jsonOut(["dataB64": data.base64EncodedString()])
  exit(0)
}

if cmd == "set" {
  guard let b64 = dataB64, let data = Data(base64Encoded: b64) else {
    die("--data-b64 required (and must be base64)")
  }

  // Require user presence by default (Touch ID / password prompt).
  // Note: This does not fully pin access to a single binary identity; it ensures
  // interactive user authorization for reads/writes.
  var acFlags: SecAccessControlCreateFlags = []
  if requireUserPresence { acFlags.insert(.userPresence) }

  var err: Unmanaged<CFError>?
  guard let access = SecAccessControlCreateWithFlags(
    nil,
    kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    acFlags,
    &err
  ) else {
    die("SecAccessControlCreateWithFlags failed: \(String(describing: err?.takeRetainedValue()))")
  }

  // First try update.
  let query = baseQuery()
  let attrs: [String: Any] = [
    kSecValueData as String: data,
    kSecAttrAccessControl as String: access,
  ]

  let upStatus = SecItemUpdate(query as CFDictionary, attrs as CFDictionary)
  if upStatus == errSecSuccess {
    jsonOut(["ok": true, "updated": true])
    exit(0)
  }

  if upStatus != errSecItemNotFound {
    die("SecItemUpdate failed: \(upStatus)")
  }

  // Add.
  var add = baseQuery()
  add[kSecValueData as String] = data
  add[kSecAttrAccessControl as String] = access

  let addStatus = SecItemAdd(add as CFDictionary, nil)
  guard addStatus == errSecSuccess else {
    die("SecItemAdd failed: \(addStatus)")
  }

  jsonOut(["ok": true, "created": true])
  exit(0)
}

die("unknown command: \(cmd)")
