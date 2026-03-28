import CFuse
import Foundation

private let toolName = "ocprotectfs-fuse"
private let version = "0.0.0-dev"

struct Args {
  var backstore: String?
  var mountpoint: String?
  var foreground: Bool = true

  var showHelp: Bool = false
  var showVersion: Bool = false

  init(raw: [String]) {
    var i = 0
    while i < raw.count {
      let a = raw[i]
      switch a {
      case "-h", "--help":
        showHelp = true

      case "--version":
        showVersion = true

      case "--backstore":
        i += 1
        if i < raw.count { backstore = raw[i] }

      case "--mountpoint":
        i += 1
        if i < raw.count { mountpoint = raw[i] }

      case "-f", "--foreground":
        foreground = true

      default:
        // Let libfuse parse/handle unknown flags (e.g., -o options) by passing through.
        break
      }
      i += 1
    }
  }
}

func printHelp() {
  print(
    """
    \(toolName) (Swift, phase 2 passthrough)

    Usage:
      \(toolName) --backstore <path> --mountpoint <path> [--foreground]

    Notes:
      - Phase 2 implements core FUSE ops and plaintext passthrough (Refs #108).
      - Phase 3 will port crypto/policy/authz enforcement (Refs #109).

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

guard let backstore = args.backstore, let mountpoint = args.mountpoint else {
  printHelp()
  fputs("\nERROR: --backstore and --mountpoint are required.\n", stderr)
  exit(2)
}

PassthroughFuse.shared.configure(
  backstoreRoot: (backstore as NSString).expandingTildeInPath
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
