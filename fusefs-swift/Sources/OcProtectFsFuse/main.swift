import CFuse
import Foundation
import Darwin

private let toolName = "ocprotectfs-fuse"
private let version = "0.0.0-dev"

struct Args {
  var backstore: String?
  var mountpoint: String?
  var foreground: Bool = true

  // Phase 3: KEK is provided via an inherited anonymous pipe FD.
  var kekFd: Int32? = nil

  // Keep CLI parity with the Node launcher: allow repeated plaintext prefixes.
  // (These are applied by setting OCPROTECTFS_PLAINTEXT_PREFIXES for policy.)
  var plaintextPrefixes: [String] = []

  var showHelp: Bool = false
  var showVersion: Bool = false
  var parseError: String? = nil

  init(raw: [String]) {
    var i = 0
    while i < raw.count {
      let a = raw[i]

      switch a {
      case "-h", "--help":
        showHelp = true
        i += 1

      case "--version":
        showVersion = true
        i += 1

      case "--backstore":
        guard i + 1 < raw.count else { parseError = "missing value for --backstore"; return }
        backstore = raw[i + 1]
        i += 2

      case "--mountpoint":
        guard i + 1 < raw.count else { parseError = "missing value for --mountpoint"; return }
        mountpoint = raw[i + 1]
        i += 2

      case "--kek-fd":
        guard i + 1 < raw.count else { parseError = "missing value for --kek-fd"; return }
        let v = raw[i + 1]
        guard let n = Int32(v), n >= 0 else { parseError = "--kek-fd must be a non-negative integer"; return }
        kekFd = n
        i += 2

      case "--plaintext-prefix":
        guard i + 1 < raw.count else { parseError = "missing value for --plaintext-prefix"; return }
        plaintextPrefixes.append(raw[i + 1])
        i += 2

      case "-f", "--foreground":
        foreground = true
        i += 1

      default:
        // Let libfuse parse/handle unknown flags (e.g., -o options) by passing through.
        i += 1
      }
    }
  }
}

func printHelp() {
  print(
    """
    \(toolName) (Swift)

    Usage:
      \(toolName) --backstore <path> --mountpoint <path> [--kek-fd <n>] [--plaintext-prefix <p>]... [--foreground]

    Notes:
      - Phase 2 implements core FUSE ops and plaintext passthrough (Refs #108).
      - Phase 3 implements crypto + policy/authz enforcement (Refs #109).
      - On successful mount, prints a single line: "READY" (used by wrapper for fail-closed bring-up).

    Common macFUSE/libfuse flags:
      -f              Run in foreground
      -o <opts>       Mount options (passed through to libfuse)

    """
  )
}

let argv = Array(CommandLine.arguments)
let args = Args(raw: Array(argv.dropFirst()))

if args.showHelp {
  printHelp()
  exit(0)
}

if args.showVersion {
  print("\(toolName) \(version)")
  exit(0)
}

if let err = args.parseError {
  printHelp()
  fputs("\nERROR: \(err)\n", stderr)
  exit(2)
}

guard let backstore = args.backstore, let mountpoint = args.mountpoint else {
  printHelp()
  fputs("\nERROR: --backstore and --mountpoint are required.\n", stderr)
  exit(2)
}

func readKey32FromFd(_ fd: Int32) throws -> Data {
  var buf = [UInt8](repeating: 0, count: 32)
  var readTotal = 0

  let total = buf.count
  while readTotal < total {
    let remaining = total - readTotal
    let n: Int = buf.withUnsafeMutableBytes { raw in
      let base = raw.baseAddress!.advanced(by: readTotal)
      return Darwin.read(fd, base, remaining)
    }

    if n < 0 { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
    if n == 0 { break }
    readTotal += n
  }

  if readTotal != 32 {
    throw POSIXError(.EACCES)
  }

  return Data(buf)
}

let kek: Data?
if let fd = args.kekFd {
  // Wrapper passes KEK on fd 3 (see wrapper/src/run.js).
  kek = try? readKey32FromFd(fd)
} else {
  kek = nil
}

var env = ProcessInfo.processInfo.environment
if !args.plaintextPrefixes.isEmpty {
  env["OCPROTECTFS_PLAINTEXT_PREFIXES"] = args.plaintextPrefixes.joined(separator: ",")
}

ProtectFsFuse.shared.configure(
  backstoreRoot: (backstore as NSString).expandingTildeInPath,
  kek: kek,
  env: env
)

var ops = makeOperations()

// Build argv for fuse_main_real. We pass through user-provided args and
// *also* ensure the mountpoint is present.
//
// libfuse expects:
//   argv[0] program
//   argv[1...] flags, mountpoint, -o opts, etc.
var fuseArgv: [String] = [argv.first ?? toolName]

// Preserve original args, but ensure mountpoint is included.
var hasMountpoint = false
for a in argv.dropFirst() {
  if a == mountpoint { hasMountpoint = true }
  fuseArgv.append(a)
}
if !hasMountpoint {
  fuseArgv.append(mountpoint)
}

let cArgs: [UnsafeMutablePointer<CChar>?] = fuseArgv.map { strdup($0) }

defer {
  for p in cArgs { free(p) }
}

let argc = Int32(cArgs.count)
var argvC = cArgs

let res = fuse_main_real(argc, &argvC, &ops, MemoryLayout<fuse_operations>.size, nil)
exit(res)
