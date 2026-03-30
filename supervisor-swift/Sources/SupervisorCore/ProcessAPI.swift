import Foundation
import Darwin

public struct SpawnConfig: Equatable {
  public var executable: String
  public var arguments: [String]
  public var environment: [String: String]

  /// Map child FD -> parent FD. These are dup2'ed into the child before exec.
  public var extraFileDescriptors: [Int32: Int32]

  public init(executable: String, arguments: [String], environment: [String: String], extraFileDescriptors: [Int32: Int32] = [:]) {
    self.executable = executable
    self.arguments = arguments
    self.environment = environment
    self.extraFileDescriptors = extraFileDescriptors
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

  public static func setCloExec(_ fd: Int32) {
    let flags = fcntl(fd, F_GETFD)
    if flags >= 0 {
      _ = fcntl(fd, F_SETFD, flags | FD_CLOEXEC)
    }
  }

  public static func waitStatusIsSignaled(_ status: Int32) -> Bool {
    // POSIX wait status: low 7 bits are signal number; 0 means exited.
    let sig = status & 0x7f
    return sig != 0
  }

  public static func waitStatusExitCode(_ status: Int32) -> Int32 {
    // POSIX: exit status in high byte.
    return (status >> 8) & 0xff
  }
}

public enum SpawnError: Error, Equatable, CustomStringConvertible {
  case posixSpawn(Int32)

  public var description: String {
    switch self {
    case .posixSpawn(let s):
      return "posix_spawn failed: \(s)"
    }
  }
}

/// Default spawner: uses posix_spawn so we can pass additional FDs (e.g. KEK pipe).
public final class PosixProcessSpawner: ProcessSpawner {
  public init() {}

  public func spawn(_ cfg: SpawnConfig) throws -> SpawnedProcess {
    // stdout/stderr pipes
    var outPipe: [Int32] = [0, 0]
    var errPipe: [Int32] = [0, 0]
    guard pipe(&outPipe) == 0 else { throw SpawnError.posixSpawn(Int32(errno)) }
    guard pipe(&errPipe) == 0 else { throw SpawnError.posixSpawn(Int32(errno)) }

    // Parent reads from read ends; child writes to write ends.
    let outRead = outPipe[0]
    let outWrite = outPipe[1]
    let errRead = errPipe[0]
    let errWrite = errPipe[1]

    ProcUtils.setCloExec(outRead)
    ProcUtils.setCloExec(errRead)

    var fa: posix_spawn_file_actions_t? = nil
    posix_spawn_file_actions_init(&fa)
    defer {
      posix_spawn_file_actions_destroy(&fa)
    }

    // Child: connect stdout/stderr.
    posix_spawn_file_actions_adddup2(&fa, outWrite, STDOUT_FILENO)
    posix_spawn_file_actions_adddup2(&fa, errWrite, STDERR_FILENO)

    // Close the ends we don't want in the child.
    posix_spawn_file_actions_addclose(&fa, outRead)
    posix_spawn_file_actions_addclose(&fa, errRead)

    // Extra file descriptors.
    for (childFd, parentFd) in cfg.extraFileDescriptors {
      posix_spawn_file_actions_adddup2(&fa, parentFd, childFd)
    }

    // New process group so we can fail-closed with kill(-pid, ...).
    var attr: posix_spawnattr_t? = nil
    posix_spawnattr_init(&attr)
    defer {
      posix_spawnattr_destroy(&attr)
    }

    var flags: Int16 = 0
    flags |= Int16(POSIX_SPAWN_SETPGROUP)
    posix_spawnattr_setflags(&attr, flags)
    posix_spawnattr_setpgroup(&attr, 0)

    // argv
    var argv: [UnsafeMutablePointer<CChar>?] = []
    argv.append(strdup(cfg.executable))
    for a in cfg.arguments { argv.append(strdup(a)) }
    argv.append(nil)
    defer {
      for p in argv where p != nil { free(p) }
    }

    // envp
    var envp: [UnsafeMutablePointer<CChar>?] = []
    for (k, v) in cfg.environment {
      envp.append(strdup("\(k)=\(v)"))
    }
    envp.append(nil)
    defer {
      for p in envp where p != nil { free(p) }
    }

    var pid: pid_t = 0
    let st = posix_spawn(&pid, cfg.executable, &fa, &attr, argv, envp)

    // Parent: close write ends after spawn regardless of result.
    close(outWrite)
    close(errWrite)

    guard st == 0 else {
      close(outRead)
      close(errRead)
      throw SpawnError.posixSpawn(st)
    }

    let procPid = Int32(pid)

    return SpawnedProcess(
      pid: procPid,
      stdout: FileHandle(fileDescriptor: outRead, closeOnDealloc: true),
      stderr: FileHandle(fileDescriptor: errRead, closeOnDealloc: true),
      terminateGroup: { sig in ProcUtils.terminateProcessGroup(pid: procPid, sig: sig) },
      isAlive: { ProcUtils.isAlive(pid: procPid) },
      onExit: { handler in
        DispatchQueue.global().async {
          var status: Int32 = 0
          _ = waitpid(procPid, &status, 0)
          if ProcUtils.waitStatusIsSignaled(status) {
            handler(128)
          } else {
            handler(ProcUtils.waitStatusExitCode(status))
          }
        }
      }
    )
  }
}

/// Compatibility spawner (no extra FDs), useful for some unit tests.
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
