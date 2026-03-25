import Foundation

// Placeholder skeleton for Issue #87.
//
// Intentionally not wired into the supervisor yet.
// This exists so we can iterate in Swift without breaking the Node implementation.

struct Args {
  let raw: [String]

  func has(_ flag: String) -> Bool { raw.contains(flag) }
}

let args = Args(raw: Array(CommandLine.arguments.dropFirst()))

if args.has("--version") {
  print("ocprotectfs-fuse (swift skeleton)")
  exit(0)
}

fputs("ERROR: ocprotectfs-fuse Swift rewrite is not implemented yet (Issue #87).\n", stderr)
exit(2)
