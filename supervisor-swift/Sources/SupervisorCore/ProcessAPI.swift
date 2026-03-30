import Foundation
import Darwin

public struct SpawnConfig: Equatable {
  public var executable: String
  public var arguments: [String]
  public var environment: [String: String]

  public init(executable: String, arguments: [String], environment: [String: String]) {
    self.executable = executable
    self.arguments = arguments
    self.environment = environment
  }
}

public final class SpawnedProcess {
  public let pid: Int32
  public let stdout: FileHandle?
  public let stderr: FileHandle?

  private let _terminateGroup: (Int32) -> Void
  private let _isAlive: () -> Bool
  private let _onExit: (@escaping (Int32) -> Void) -> Void

  public init(
    pid: Int32,
    stdout: FileHandle?,
    stderr: FileHandle?,
    terminateGroup: @escaping (Int32) -> Void,
    isAlive: @escaping () -> Bool,
    onExit: @escaping (@escaping (Int32) -> Void) -> Void
  ) {
    self.pid = pid
    self.stdout = stdout
    self.stderr = stderr
    self._terminateGroup = terminateGroup
    self._isAlive = isAlive
    self._onExit = onExit
  }

  public func onExit(_ handler: @escaping (Int32) -> Void) {
    _onExit(handler)
  }

  public func terminateGroup(sig: Int32) {
    _terminateGroup(sig)
  }

  public func isAlive() -> Bool {
    _isAlive()
  }
}

public protocol ProcessSpawner {
  func spawn(_ cfg: SpawnConfig) throws -> SpawnedProcess
}

public enum ProcUtils {
  public static func terminateProcessGroup(pid: Int32, sig: Int32) {
    // Best-effort: process group first (negative pid), then direct pid.
    if pid <= 0 { return }

    if kill(-pid, sig) == 0 { return }
    _ = kill(pid, sig)
  }

  public static func isAlive(pid: Int32) -> Bool {
    if pid <= 0 { return false }
    return kill(pid, 0) == 0
  }
}

public final class FoundationProcessSpawner: ProcessSpawner {
  public init() {}

  public func spawn(_ cfg: SpawnConfig) throws -> SpawnedProcess {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: cfg.executable)
    p.arguments = cfg.arguments
    p.environment = cfg.environment

    let outPipe = Pipe()
    let errPipe = Pipe()
    p.standardOutput = outPipe
    p.standardError = errPipe

    try p.run()
    let pid = p.processIdentifier

    return SpawnedProcess(
      pid: pid,
      stdout: outPipe.fileHandleForReading,
      stderr: errPipe.fileHandleForReading,
      terminateGroup: { sig in ProcUtils.terminateProcessGroup(pid: pid, sig: sig) },
      isAlive: { ProcUtils.isAlive(pid: pid) },
      onExit: { handler in
        p.terminationHandler = { proc in
          // If terminated by signal, Foundation does not expose the signal here in a stable way.
          // Approximate: return 128 when terminationReason is .uncaughtSignal.
          if proc.terminationReason == .uncaughtSignal {
            handler(128)
          } else {
            handler(Int32(proc.terminationStatus))
          }
        }
      }
    )
  }
}
