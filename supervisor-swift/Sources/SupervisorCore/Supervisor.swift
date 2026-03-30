import Foundation
import Darwin

public struct SupervisorConfig: Equatable {
  public var backstore: String
  public var mountpoint: String

  public var fuseBin: String
  public var fuseArgs: [String]
  public var plaintextPrefixes: [String]

  public var gatewayBin: String
  public var gatewayArgs: [String]

  public var requireFuseReady: Bool
  public var fuseReadyTimeoutMs: Int

  public var shutdownTimeoutMs: Int

  public init(options: Options) {
    self.backstore = PathUtils.resolveAbsolute(options.backstore)
    self.mountpoint = PathUtils.resolveAbsolute(options.mountpoint)

    self.fuseBin = options.fuseBin ?? "/bin/sleep"
    self.fuseArgs = options.fuseArgs
    self.plaintextPrefixes = options.plaintextPrefixes

    self.gatewayBin = options.gatewayBin ?? "/bin/sleep"
    self.gatewayArgs = options.gatewayArgs

    self.requireFuseReady = options.requireFuseReady
    self.fuseReadyTimeoutMs = options.fuseReadyTimeoutMs

    self.shutdownTimeoutMs = options.shutdownTimeoutMs
  }
}

public enum SupervisorError: Error, Equatable, CustomStringConvertible {
  case invalidConfig(String)

  public var description: String {
    switch self {
    case .invalidConfig(let m): return m
    }
  }
}

public final class Supervisor {
  private let spawner: ProcessSpawner
  private let fm: FileManager
  private let log: (String) -> Void

  public init(spawner: ProcessSpawner = FoundationProcessSpawner(), fileManager: FileManager = .default, log: @escaping (String) -> Void) {
    self.spawner = spawner
    self.fm = fileManager
    self.log = log
  }

  public func run(_ cfg: SupervisorConfig) -> ExitCode {
    do {
      try validate(cfg)
    } catch {
      log("config error: \(error)")
      return .config
    }

    do {
      try prepareDir(cfg.backstore)
      try prepareDir(cfg.mountpoint)
    } catch {
      log("prepare dirs failed: \(error)")
      return .prepareFs
    }

    let liveness: LivenessSocket
    do {
      liveness = try LivenessSocket(mountpoint: cfg.mountpoint)
      log("liveness socket: \(liveness.path)")
    } catch {
      log("liveness socket failed: \(error)")
      return .liveness
    }

    let childEnv = buildChildEnv(extra: [
      "OCPROTECTFS_LIVENESS_SOCK": liveness.path
    ])

    let fuseArgs = normalizedFuseArgs(cfg)
    log("starting fuse: \(cfg.fuseBin) \(fuseArgs.joined(separator: " "))")

    let fuse: SpawnedProcess
    do {
      fuse = try spawner.spawn(SpawnConfig(executable: cfg.fuseBin, arguments: fuseArgs, environment: childEnv))
    } catch {
      log("fuse spawn failed: \(error)")
      try? liveness.close()
      return .fuseStart
    }

    // Optional readiness gate.
    if cfg.requireFuseReady {
      let ready = waitForReady(fuse: fuse, timeoutMs: cfg.fuseReadyTimeoutMs)
      if !ready.ok {
        log("fuse readiness not detected (\(ready.reason)); failing closed")
        _ = shutdownBoth(fuse: fuse, gateway: nil, timeoutMs: cfg.shutdownTimeoutMs, mountpoint: cfg.mountpoint)
        try? liveness.close()
        return .fuseNotReady
      }
      log("fuse reported ready after \(ready.ms)ms")
    }

    let gateway: SpawnedProcess
    do {
      log("starting gateway: \(cfg.gatewayBin) \(cfg.gatewayArgs.joined(separator: " "))")
      gateway = try spawner.spawn(SpawnConfig(executable: cfg.gatewayBin, arguments: cfg.gatewayArgs, environment: childEnv))
    } catch {
      log("gateway spawn failed: \(error)")
      _ = shutdownBoth(fuse: fuse, gateway: nil, timeoutMs: cfg.shutdownTimeoutMs, mountpoint: cfg.mountpoint)
      try? liveness.close()
      return .gatewayStart
    }

    let code = supervise(fuse: fuse, gateway: gateway, timeoutMs: cfg.shutdownTimeoutMs, mountpoint: cfg.mountpoint)
    try? liveness.close()
    return code
  }

  private func validate(_ cfg: SupervisorConfig) throws {
    if cfg.backstore.isEmpty || cfg.mountpoint.isEmpty { throw SupervisorError.invalidConfig("backstore and mountpoint must be set") }
    if cfg.shutdownTimeoutMs <= 0 { throw SupervisorError.invalidConfig("shutdown-timeout-ms must be > 0") }
    if cfg.fuseReadyTimeoutMs <= 0 { throw SupervisorError.invalidConfig("fuse-ready-timeout-ms must be > 0") }
  }

  private func prepareDir(_ p: String) throws {
    var isDir: ObjCBool = false
    if fm.fileExists(atPath: p, isDirectory: &isDir) {
      if !isDir.boolValue { throw SupervisorError.invalidConfig("path exists but is not a directory: \(p)") }
      return
    }
    try fm.createDirectory(atPath: p, withIntermediateDirectories: true, attributes: [
      .posixPermissions: 0o700
    ])
  }

  private func normalizedFuseArgs(_ cfg: SupervisorConfig) -> [String] {
    var args = cfg.fuseArgs
    for p in cfg.plaintextPrefixes {
      args.append(contentsOf: ["--plaintext-prefix", p])
    }

    // Parity with Node wrapper: provide a harmless placeholder if no args were set.
    if cfg.fuseBin == "/bin/sleep" && args.isEmpty { args = ["1000000"] }
    return args
  }

  private func buildChildEnv(extra: [String: String]) -> [String: String] {
    // Keep a pragmatic allow-list similar to wrapper/src/run.js.
    let allow = [
      "PATH",
      "HOME",
      "TMPDIR",
      "LANG",
      "LC_ALL",
      "LC_CTYPE",
      "TERM",
      "SHELL",
      "USER",
      "LOGNAME",
    ]

    var env: [String: String] = [:]
    for k in allow {
      if let v = ProcessInfo.processInfo.environment[k] { env[k] = v }
    }

    for (k, v) in extra { env[k] = v }
    return env
  }

  private struct ReadyResult: Equatable {
    var ok: Bool
    var reason: String
    var ms: Int
  }

  private func waitForReady(fuse: SpawnedProcess, timeoutMs: Int) -> ReadyResult {
    let start = Date()
    let needle = "READY"

    let sem = DispatchSemaphore(value: 0)
    var done = false

    // Mutable result holder for closures below.
    var _res = ReadyResult(ok: false, reason: "timeout", ms: timeoutMs)

    func finish(ok: Bool, reason: String) {
      if done { return }
      done = true
      _res = ReadyResult(ok: ok, reason: reason, ms: Int(Date().timeIntervalSince(start) * 1000))
      sem.signal()
    }

    let timer = DispatchSource.makeTimerSource()
    timer.schedule(deadline: .now() + .milliseconds(timeoutMs))
    timer.setEventHandler {
      finish(ok: false, reason: "timeout")
    }
    timer.resume()

    var buf = ""
    func consume(_ d: Data) {
      guard let s = String(data: d, encoding: .utf8) else { return }
      buf += s
      if buf.contains(needle) {
        finish(ok: true, reason: "ready")
      }
    }

    let out = fuse.stdout
    let err = fuse.stderr

    // Use DispatchSourceRead instead of FileHandle.readabilityHandler so this works
    // reliably in unit tests (no runloop dependency).
    var sources: [DispatchSourceRead] = []

    func attach(_ h: FileHandle?) {
      guard let h else { return }
      let src = DispatchSource.makeReadSource(fileDescriptor: h.fileDescriptor, queue: DispatchQueue.global())
      src.setEventHandler {
        var tmp = [UInt8](repeating: 0, count: 4096)
        let n = Darwin.read(h.fileDescriptor, &tmp, tmp.count)
        if n > 0 {
          consume(Data(tmp[0..<n]))
        }
      }
      src.resume()
      sources.append(src)
    }

    attach(out)
    attach(err)

    fuse.onExit { _ in
      finish(ok: false, reason: "exited")
    }

    _ = sem.wait(timeout: .now() + .milliseconds(timeoutMs + 50))

    timer.cancel()
    for s in sources { s.cancel() }

    return _res
  }

  private func supervise(fuse: SpawnedProcess, gateway: SpawnedProcess, timeoutMs: Int, mountpoint: String) -> ExitCode {
    let sem = DispatchSemaphore(value: 0)
    var winner: String? = nil

    fuse.onExit { _ in
      if winner == nil { winner = "fuse"; sem.signal() }
    }
    gateway.onExit { _ in
      if winner == nil { winner = "gateway"; sem.signal() }
    }

    // Block until one exits.
    sem.wait()

    let name = winner ?? "unknown"
    log("\(name) exited; shutting down")

    _ = shutdownBoth(fuse: fuse, gateway: gateway, timeoutMs: timeoutMs, mountpoint: mountpoint)
    return name == "fuse" ? .fuseDied : .gatewayDied
  }

  @discardableResult
  private func shutdownBoth(fuse: SpawnedProcess, gateway: SpawnedProcess?, timeoutMs: Int, mountpoint: String) -> Bool {
    gateway?.terminateGroup(sig: SIGTERM)
    fuse.terminateGroup(sig: SIGTERM)

    let effectiveTimeoutMs = max(timeoutMs, 50)
    let deadline = Date().addingTimeInterval(Double(effectiveTimeoutMs) / 1000.0)

    while Date() < deadline {
      let gwAlive = gateway?.isAlive() ?? false
      let fuseAlive = fuse.isAlive()
      if !gwAlive && !fuseAlive {
        return true
      }
      usleep(50_000)
    }

    gateway?.terminateGroup(sig: SIGKILL)
    fuse.terminateGroup(sig: SIGKILL)
    return false
  }
}
