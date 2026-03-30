import Foundation
import Darwin

public enum LivenessError: Error, Equatable, CustomStringConvertible {
  case refusingToReplaceNonSocket(String)
  case socketCreateFailed(String)
  case bindFailed(String)
  case listenFailed(String)

  public var description: String {
    switch self {
    case .refusingToReplaceNonSocket(let p): return "refusing to replace non-socket path: \(p)"
    case .socketCreateFailed(let m): return "socket create failed: \(m)"
    case .bindFailed(let m): return "bind failed: \(m)"
    case .listenFailed(let m): return "listen failed: \(m)"
    }
  }
}

public final class LivenessSocket {
  public let path: String
  private var fd: Int32 = -1
  private let q = DispatchQueue(label: "ocp.liveness.accept")
  private var running = false

  public init(mountpoint: String) throws {
    self.path = URL(fileURLWithPath: mountpoint).appendingPathComponent(".ocpfs.sock").path
    try Self.preparePath(path)

    fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
    if fd < 0 {
      throw LivenessError.socketCreateFailed(String(cString: strerror(errno)))
    }

    // Bind
    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    // sun_path is a fixed-length tuple; copy bytes safely.
    let pathBytes = Array(self.path.utf8CString)
    guard pathBytes.count <= MemoryLayout.size(ofValue: addr.sun_path) else {
      Darwin.close(fd)
      fd = -1
      throw LivenessError.bindFailed("unix socket path too long")
    }
    withUnsafeMutablePointer(to: &addr.sun_path) { sunPathPtr in
      let raw = UnsafeMutableRawPointer(sunPathPtr).assumingMemoryBound(to: CChar.self)
      for i in 0..<pathBytes.count { raw[i] = pathBytes[i] }
    }

    // Use the exact sockaddr length (family + path bytes) to avoid EINVAL on some platforms.
    let baseLen = MemoryLayout.offset(of: \sockaddr_un.sun_path) ?? 0
    let len = socklen_t(baseLen + pathBytes.count)

    let bindRes = withUnsafePointer(to: &addr) { ptr in
      ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
        Darwin.bind(fd, sa, len)
      }
    }
    if bindRes != 0 {
      let msg = String(cString: strerror(errno))
      Darwin.close(fd)
      fd = -1
      throw LivenessError.bindFailed(msg)
    }

    if Darwin.listen(fd, 16) != 0 {
      let msg = String(cString: strerror(errno))
      Darwin.close(fd)
      fd = -1
      throw LivenessError.listenFailed(msg)
    }

    running = true
    startAcceptLoop()
  }

  deinit {
    try? close()
  }

  public func close() throws {
    if !running { return }
    running = false

    if fd >= 0 {
      Darwin.shutdown(fd, SHUT_RDWR)
      Darwin.close(fd)
      fd = -1
    }

    try? FileManager.default.removeItem(atPath: path)
  }

  private func startAcceptLoop() {
    q.async { [weak self] in
      guard let self else { return }
      while self.running {
        var addr = sockaddr()
        var len: socklen_t = socklen_t(MemoryLayout.size(ofValue: addr))
        let cfd = withUnsafeMutablePointer(to: &addr) { ptr in
          Darwin.accept(self.fd, ptr, &len)
        }
        if cfd < 0 {
          // When shutting down, accept will fail; just stop.
          if !self.running { break }
          continue
        }

        // Contract: accept connections and reply OK\n.
        let ok = Array("OK\n".utf8)
        _ = ok.withUnsafeBytes { buf in
          Darwin.write(cfd, buf.baseAddress, buf.count)
        }
        Darwin.close(cfd)
      }
    }
  }

  private static func preparePath(_ sockPath: String) throws {
    // If a stale socket exists, remove it. If a non-socket exists, refuse.
    do {
      let st = try FileManager.default.attributesOfItem(atPath: sockPath)
      if let type = st[.type] as? FileAttributeType, type == .typeSocket {
        try FileManager.default.removeItem(atPath: sockPath)
      } else {
        throw LivenessError.refusingToReplaceNonSocket(sockPath)
      }
    } catch {
      let ns = error as NSError
      if ns.domain == NSCocoaErrorDomain && (ns.code == NSFileNoSuchFileError || ns.code == 260) {
        return
      }
      if let e = error as? LivenessError { throw e }
      // If we failed stat for some other reason, bubble as refusing.
      throw error
    }
  }
}
