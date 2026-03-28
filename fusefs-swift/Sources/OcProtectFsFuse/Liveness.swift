import Foundation
import Darwin

// Phase 3 (Issue #109): wrapper liveness socket check.
// Contract (wrapper/src/run.js): a unix domain socket at $OCPROTECTFS_LIVENESS_SOCK
// accepts connections and replies "OK\n".

enum Liveness {
  static func isGatewayAccessAllowed(env: [String: String] = ProcessInfo.processInfo.environment) -> Bool {
    guard let sock = env["OCPROTECTFS_LIVENESS_SOCK"], !sock.isEmpty else { return false }

    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    if fd < 0 { return false }
    defer { _ = close(fd) }

    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)

    // sun_path is a fixed-size tuple; copy bytes with NUL terminator.
    let bytes = Array(sock.utf8) + [0]
    if bytes.count > MemoryLayout.size(ofValue: addr.sun_path) { return false }

    withUnsafeMutableBytes(of: &addr.sun_path) { raw in
      // Zero-fill then copy bytes (including NUL terminator).
      if let base = raw.baseAddress {
        memset(base, 0, raw.count)
        raw.copyBytes(from: bytes)
      }
    }

    let len = socklen_t(MemoryLayout.size(ofValue: addr.sun_family) + bytes.count)

    let res = withUnsafePointer(to: &addr) { p -> Int32 in
      p.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
        Darwin.connect(fd, sa, len)
      }
    }
    if res != 0 { return false }

    // Read a short response.
    var buf = [UInt8](repeating: 0, count: 32)
    let n = read(fd, &buf, buf.count)
    if n <= 0 { return false }

    let s = String(bytes: buf.prefix(Int(n)), encoding: .utf8) ?? ""
    return s.hasPrefix("OK")
  }
}
