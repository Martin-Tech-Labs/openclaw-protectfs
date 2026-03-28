import Foundation

// Phase 3 (Issue #109): core authorizeOp parity with fusefs/src/core.js.

enum Ops: String {
  case read
  case write
  case create
  case mkdir
  case rmdir
  case rename
  case unlink
  case chmod
  case chown
  case utimens
  case fsync
  case statfs
}

struct AuthzResult {
  let ok: Bool
  let code: Int32 // POSIX errno when !ok
  let reason: String

  static func allow(_ reason: String) -> AuthzResult {
    AuthzResult(ok: true, code: 0, reason: reason)
  }

  static func deny(_ code: Int32, _ reason: String) -> AuthzResult {
    AuthzResult(ok: false, code: code, reason: reason)
  }
}

enum Core {
  static func authorizeOp(
    op: Ops,
    rel: String,
    plaintextPrefixes: [String]? = nil,
    env: [String: String] = ProcessInfo.processInfo.environment,
    gatewayAccessAllowed: Bool
  ) -> AuthzResult {
    do {
      let cls = try Policy.classifyPath(rel, plaintextPrefixes: plaintextPrefixes, env: env)

      if !cls.requiresGatewayAccessChecks {
        return .allow("policy: plaintext (\(cls.reason))")
      }

      if !gatewayAccessAllowed {
        // Fail closed.
        return .deny(EACCES, "gateway access checks required")
      }

      return .allow("policy: encrypted, gateway ok (\(cls.reason))")
    } catch {
      return .deny(EACCES, (error as? CustomStringConvertible)?.description ?? String(describing: error))
    }
  }
}
