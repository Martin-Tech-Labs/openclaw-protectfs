import Foundation

public struct Options: Equatable {
  public var backstore: String = "~/.openclaw.real"
  public var mountpoint: String = "~/.openclaw"

  public var fuseBin: String? = nil
  public var fuseArgs: [String] = []
  public var plaintextPrefixes: [String] = []

  public var gatewayBin: String? = nil
  public var gatewayArgs: [String] = []

  public var requireFuseReady: Bool = false
  public var fuseReadyTimeoutMs: Int = 2000

  public var shutdownTimeoutMs: Int = 5000

  public init() {}
}

public enum CLIError: Error, Equatable, CustomStringConvertible {
  case unknownFlag(String)
  case missingValue(String)
  case invalidInt(flag: String, value: String)

  public var description: String {
    switch self {
    case .unknownFlag(let f): return "Unknown flag: \(f)"
    case .missingValue(let f): return "Missing value for: \(f)"
    case .invalidInt(let flag, let value): return "Invalid int for \(flag): \(value)"
    }
  }
}

public struct ParseResult: Equatable {
  public var options: Options
  public var showHelp: Bool

  public init(options: Options, showHelp: Bool) {
    self.options = options
    self.showHelp = showHelp
  }
}

public enum CLI {
  public static func helpText(program: String = "ocprotectfs-supervisor") -> String {
    // Mirrors current Node wrapper flags (wrapper/ocprotectfs.js) so we can migrate safely.
    return """
\(program) (Swift supervisor - phase 1)

Usage:
  \(program) [flags]

Flags:
  --backstore <path>           Backstore directory (default ~/.openclaw.real)
  --mountpoint <path>          Mountpoint directory (default ~/.openclaw)

  --fuse-bin <path>            FUSE daemon binary (placeholder)
  --fuse-arg <arg>             FUSE arg (repeatable)
  --plaintext-prefix <p>       Convenience: add a FUSE passthrough prefix (repeatable)

  --gateway-bin <path>         Gateway binary (placeholder)
  --gateway-arg <arg>          Gateway arg (repeatable)

  --require-fuse-ready         Fail closed: require FUSE to report READY before starting gateway
  --fuse-ready-timeout-ms <ms> READY wait timeout (default 2000)

  --shutdown-timeout <ms>      Grace period for shutdown (default 5000)
  -h, --help                   Show help
"""
  }

  public static func parse(_ argv: [String]) throws -> ParseResult {
    var opts = Options()
    var i = 0
    var showHelp = false

    func requireValue(_ flag: String) throws -> String {
      guard i + 1 < argv.count else { throw CLIError.missingValue(flag) }
      i += 1
      return argv[i]
    }

    while i < argv.count {
      let a = argv[i]
      switch a {
      case "-h", "--help":
        showHelp = true

      case "--backstore":
        opts.backstore = try requireValue(a)

      case "--mountpoint":
        opts.mountpoint = try requireValue(a)

      case "--fuse-bin":
        opts.fuseBin = try requireValue(a)

      case "--fuse-arg":
        opts.fuseArgs.append(try requireValue(a))

      case "--plaintext-prefix":
        opts.plaintextPrefixes.append(try requireValue(a))

      case "--gateway-bin":
        opts.gatewayBin = try requireValue(a)

      case "--gateway-arg":
        opts.gatewayArgs.append(try requireValue(a))

      case "--require-fuse-ready":
        opts.requireFuseReady = true

      case "--fuse-ready-timeout-ms":
        let v = try requireValue(a)
        guard let n = Int(v) else { throw CLIError.invalidInt(flag: a, value: v) }
        opts.fuseReadyTimeoutMs = n

      case "--shutdown-timeout":
        let v = try requireValue(a)
        guard let n = Int(v) else { throw CLIError.invalidInt(flag: a, value: v) }
        opts.shutdownTimeoutMs = n

      default:
        if a.hasPrefix("-") {
          throw CLIError.unknownFlag(a)
        }
        // For phase 1, we do not accept positional arguments.
        throw CLIError.unknownFlag(a)
      }

      i += 1
    }

    return ParseResult(options: opts, showHelp: showHelp)
  }
}
