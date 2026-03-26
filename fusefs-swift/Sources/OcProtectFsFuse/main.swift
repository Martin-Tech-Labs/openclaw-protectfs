import Foundation

// Placeholder skeleton for Issue #87 / Phase 1 (Issue #107).
//
// Intentionally not wired into the supervisor yet.
// This exists so we can iterate in Swift without breaking the Node implementation.

private let toolName = "ocprotectfs-fuse"
private let skeletonVersion = "0.0.0-skeleton"

struct Args {
  let raw: [String]

  func has(_ flag: String) -> Bool { raw.contains(flag) }
}

func printHelp() {
  print(
    """
    \(toolName) (Swift skeleton)

    Usage:
      \(toolName) [--help|-h] [--version]

    Notes:
      - This is a non-functional placeholder to unblock Swift iteration.
      - Refs #107 (phase 1) / Refs #87 (parent).

    Exit codes:
      0  success (help/version)
      2  not implemented
    """
  )
}

let args = Args(raw: Array(CommandLine.arguments.dropFirst()))

if args.has("--help") || args.has("-h") {
  printHelp()
  exit(0)
}

if args.has("--version") {
  print("\(toolName) \(skeletonVersion)")
  exit(0)
}

printHelp()
fputs("\nERROR: \(toolName) Swift rewrite is not implemented yet (Refs #87).\n", stderr)
exit(2)
