import Foundation

// Phase 3 (Issue #109): policy/path classification port.
// Follow-up (Issue #119): Swift policy classifier parity with fusefs/src/policy.js.

enum PolicyError: Error, CustomStringConvertible {
  case relMustBeString // placeholder for parity; only used by interop harness
  case backslashNotAllowed
  case nulNotAllowed
  case absolutePathNotAllowed
  case traversalNotAllowed
  case plaintextPrefixesMustBeArray // placeholder for parity; only used by interop harness
  case plaintextPrefixMustBeSingleSegment
  case invalidPlaintextPrefix

  var description: String {
    switch self {
      case .relMustBeString: return "rel must be a string"
      case .backslashNotAllowed: return "backslash not allowed in relative paths"
      case .nulNotAllowed: return "NUL not allowed in paths"
      case .absolutePathNotAllowed: return "absolute paths not allowed"
      case .traversalNotAllowed: return "path traversal not allowed"
      case .plaintextPrefixesMustBeArray: return "plaintextPrefixes must be an array"
      case .plaintextPrefixMustBeSingleSegment: return "plaintext prefix must be a single path segment"
      case .invalidPlaintextPrefix: return "invalid plaintext prefix"
    }
  }
}

struct PathClassification: Codable, Equatable {
  let rel: String
  let storage: String // "plaintext" | "encrypted"
  let requiresGatewayAccessChecks: Bool
  let reason: String
}

enum Policy {
  static let defaultPlaintextPrefixes: [String] = ["workspace"]

  /// Mirrors `path.posix.normalize` behavior used in JS, with traversal detection.
  /// - Returns: a normalized POSIX-like relative path ("." allowed).
  static func assertSafeRelative(_ rel: String) throws -> String {
    if rel.isEmpty { return "." }
    if rel.contains("\\") { throw PolicyError.backslashNotAllowed }
    if rel.utf8.contains(0) { throw PolicyError.nulNotAllowed }
    if rel.hasPrefix("/") { throw PolicyError.absolutePathNotAllowed }

    let norm = normalizePosixRelative(rel)

    // JS checks for any ".." path component in the normalized output.
    // This rejects "../a" and similar, but allows "a/.." (normalizes to ".").
    let parts = norm.split(separator: "/", omittingEmptySubsequences: false)
    if parts.contains("..") { throw PolicyError.traversalNotAllowed }

    return norm
  }

  /// Normalize a relative path using POSIX rules:
  /// - Collapse multiple slashes
  /// - Remove "." segments
  /// - Resolve ".." segments (without going above root; those will remain as ".." segments and be rejected by caller)
  private static func normalizePosixRelative(_ rel: String) -> String {
    // Fast-path common simple case.
    if !rel.contains("/") {
      return rel == "." ? "." : rel
    }

    var stack: [Substring] = []

    // Leading "//" is not special here; we treat as relative and collapse.
    let segments = rel.split(separator: "/", omittingEmptySubsequences: false)
    for seg in segments {
      if seg.isEmpty {
        // skip empty segments from repeated slashes
        continue
      }
      if seg == "." {
        continue
      }
      if seg == ".." {
        if !stack.isEmpty {
          _ = stack.popLast()
        } else {
          // preserve traversal; caller will reject by checking normalized components
          stack.append(seg)
        }
        continue
      }
      stack.append(seg)
    }

    if stack.isEmpty { return "." }
    return stack.joined(separator: "/")
  }

  static func normalizePlaintextPrefixes(_ prefixes: [String]?) throws -> [String]? {
    guard let prefixes else { return nil }

    var out: [String] = []
    out.reserveCapacity(prefixes.count)

    for raw in prefixes {
      let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
      if s.isEmpty { continue }
      if s.contains("/") { throw PolicyError.plaintextPrefixMustBeSingleSegment }
      if s == "." || s == ".." { throw PolicyError.invalidPlaintextPrefix }
      out.append(s)
    }

    // De-dupe while preserving order.
    var seen = Set<String>()
    var deduped: [String] = []
    deduped.reserveCapacity(out.count)
    for p in out {
      if seen.contains(p) { continue }
      seen.insert(p)
      deduped.append(p)
    }

    return deduped
  }

  static func parseEnvPlaintextPrefixes(env: [String: String] = ProcessInfo.processInfo.environment) throws -> [String]? {
    guard let v = env["OCPROTECTFS_PLAINTEXT_PREFIXES"] else { return nil }

    let s = v.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.isEmpty { return [] }

    let parts = s.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
    return try normalizePlaintextPrefixes(parts) ?? []
  }

  static func getPlaintextPrefixes(plaintextPrefixes: [String]?, env: [String: String] = ProcessInfo.processInfo.environment) throws -> [String] {
    if let fromOpts = try normalizePlaintextPrefixes(plaintextPrefixes) {
      return fromOpts
    }
    if let fromEnv = try parseEnvPlaintextPrefixes(env: env) {
      return fromEnv
    }
    return defaultPlaintextPrefixes
  }

  static func isPlaintextPath(_ rel: String, plaintextPrefixes: [String]? = nil, env: [String: String] = ProcessInfo.processInfo.environment) throws -> Bool {
    let clean = try assertSafeRelative(rel)
    if clean == "." { return false }
    let first = clean.split(separator: "/", maxSplits: 1, omittingEmptySubsequences: true).first.map(String.init) ?? ""
    let prefixes = try getPlaintextPrefixes(plaintextPrefixes: plaintextPrefixes, env: env)
    return prefixes.contains(first)
  }

  static func classifyPath(_ rel: String, plaintextPrefixes: [String]? = nil, env: [String: String] = ProcessInfo.processInfo.environment) throws -> PathClassification {
    let clean = try assertSafeRelative(rel)

    if try isPlaintextPath(clean, plaintextPrefixes: plaintextPrefixes, env: env) {
      return PathClassification(
        rel: clean,
        storage: "plaintext",
        requiresGatewayAccessChecks: false,
        reason: "passthrough prefix"
      )
    }

    return PathClassification(
      rel: clean,
      storage: "encrypted",
      requiresGatewayAccessChecks: true,
      reason: "default encrypted"
    )
  }
}
