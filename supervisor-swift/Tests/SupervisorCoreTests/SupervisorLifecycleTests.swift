import Foundation
import Testing
import Darwin
@testable import SupervisorCore

final class FakeSpawner: ProcessSpawner {
  final class Fake {
    let pid: Int32
    let outPipe = Pipe()
    let errPipe = Pipe()
    var alive = true
    var termSignals: [Int32] = []
    var exitHandlers: [(Int32) -> Void] = []

    init(pid: Int32) { self.pid = pid }

    func onExit(_ h: @escaping (Int32) -> Void) { exitHandlers.append(h) }

    func sendStdout(_ s: String) {
      outPipe.fileHandleForWriting.write(Data(s.utf8))
    }

    func exit(_ code: Int32) {
      alive = false
      for h in exitHandlers { h(code) }
    }
  }

  private var nextPid: Int32 = 100
  var spawned: [SpawnConfig] = []
  var fakes: [Fake] = []

  func spawn(_ cfg: SpawnConfig) throws -> SpawnedProcess {
    spawned.append(cfg)
    let f = Fake(pid: nextPid)
    nextPid += 1
    fakes.append(f)

    return SpawnedProcess(
      pid: f.pid,
      stdout: f.outPipe.fileHandleForReading,
      stderr: f.errPipe.fileHandleForReading,
      terminateGroup: { sig in f.termSignals.append(sig); f.alive = false },
      isAlive: { f.alive },
      onExit: { h in f.onExit(h) }
    )
  }
}

func connectUnix(_ path: String) -> String {
  let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
  precondition(fd >= 0)
  defer { Darwin.close(fd) }

  var addr = sockaddr_un()
  addr.sun_family = sa_family_t(AF_UNIX)
  let bytes = Array(path.utf8CString)
  withUnsafeMutablePointer(to: &addr.sun_path) { sunPathPtr in
    let raw = UnsafeMutableRawPointer(sunPathPtr).assumingMemoryBound(to: CChar.self)
    for i in 0..<bytes.count { raw[i] = bytes[i] }
  }

  let len = socklen_t(MemoryLayout.size(ofValue: addr))
  let cres = withUnsafePointer(to: &addr) { ptr in
    ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
      Darwin.connect(fd, sa, len)
    }
  }
  precondition(cres == 0)

  // Avoid hanging indefinitely if something goes wrong.
  var tv = timeval(tv_sec: 1, tv_usec: 0)
  _ = withUnsafePointer(to: &tv) { ptr in
    Darwin.setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, ptr, socklen_t(MemoryLayout<timeval>.size))
  }

  var buf = [UInt8](repeating: 0, count: 32)
  let n = Darwin.read(fd, &buf, buf.count)
  precondition(n > 0)
  return String(decoding: buf[0..<n], as: UTF8.self)
}

@Test func livenessSocketAcceptsAndCleansUp() throws {
  let mp = "/tmp/ocpfs-liveness-\(UUID().uuidString)"
  try FileManager.default.createDirectory(atPath: mp, withIntermediateDirectories: true)

  let sock = try LivenessSocket(mountpoint: mp)
  #expect(FileManager.default.fileExists(atPath: sock.path))

  let res = connectUnix(sock.path)
  #expect(res.contains("OK"))

  try sock.close()
  #expect(!FileManager.default.fileExists(atPath: sock.path))

  try? FileManager.default.removeItem(atPath: mp)
}

@Test func livenessSocketRefusesToReplaceNonSocket() throws {
  let mp = "/tmp/ocpfs-liveness-\(UUID().uuidString)"
  try FileManager.default.createDirectory(atPath: mp, withIntermediateDirectories: true)
  let p = URL(fileURLWithPath: mp).appendingPathComponent(".ocpfs.sock").path
  try Data("nope".utf8).write(to: URL(fileURLWithPath: p))

  #expect(throws: LivenessError.refusingToReplaceNonSocket(p)) {
    _ = try LivenessSocket(mountpoint: mp)
  }

  try? FileManager.default.removeItem(atPath: mp)
}

@Test func requireFuseReadyWaitsForREADYThenStartsGateway() {
  let sp = FakeSpawner()
  var logs: [String] = []
  let sup = Supervisor(spawner: sp, fileManager: .default, log: { logs.append($0) })

  var opts = Options()
  opts.mountpoint = "/tmp/ocpfs-mp-\(UUID().uuidString)"
  opts.backstore = "/tmp/ocpfs-bs-\(UUID().uuidString)"
  opts.requireFuseReady = true
  opts.fuseReadyTimeoutMs = 200

  let cfg = SupervisorConfig(options: opts)

  DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(30)) {
    // First spawned process is fuse.
    sp.fakes.first?.sendStdout("READY\n")
  }
  DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(80)) {
    // Wait briefly for the gateway to be spawned, then exit it so supervise() can return.
    let deadline = Date().addingTimeInterval(0.5)
    while Date() < deadline {
      if sp.fakes.count > 1 {
        sp.fakes[1].exit(0)
        return
      }
      usleep(10_000)
    }
  }

  let code = sup.run(cfg)

  #expect(code == .gatewayDied)
  #expect(sp.spawned.count == 2)
  #expect(sp.spawned[0].executable == "/bin/sleep")
}

@Test func requireFuseReadyFailsClosedOnTimeout() {
  let sp = FakeSpawner()
  let sup = Supervisor(spawner: sp, fileManager: .default, log: { _ in })

  var opts = Options()
  opts.mountpoint = "/tmp/ocpfs-mp-\(UUID().uuidString)"
  opts.backstore = "/tmp/ocpfs-bs-\(UUID().uuidString)"
  opts.requireFuseReady = true
  opts.fuseReadyTimeoutMs = 50
  opts.shutdownTimeoutMs = 50

  let cfg = SupervisorConfig(options: opts)
  let code = sup.run(cfg)

  #expect(code == .fuseNotReady)
  #expect(sp.spawned.count == 1)
  #expect(sp.fakes.first?.termSignals.contains(SIGTERM) == true)
}
