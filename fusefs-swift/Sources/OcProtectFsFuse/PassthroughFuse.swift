import CFuse
import OcProtectFsFuseCore
import Foundation
import Darwin

// Phase 3 (Issue #109): Swift FUSE daemon implements crypto + policy/authz enforcement.

final class ProtectFsFuse {
  static let shared = ProtectFsFuse()

  private var backstoreRoot: String = "/"
  private var kek: Data? = nil
  private var env: [String: String] = ProcessInfo.processInfo.environment

  // FUSE handle table.
  private var nextHandle: UInt64 = 10
  private var handles: [UInt64: Handle] = [:]
  private let handlesLock = NSLock()

  enum Handle {
    case plaintext(fd: Int32, real: String, flags: Int32)
    case encrypted(real: String, dek: Data, buf: Data, flags: Int32, dirty: Bool)
  }

  func configure(backstoreRoot: String, kek: Data?, env: [String: String] = ProcessInfo.processInfo.environment) {
    self.backstoreRoot = backstoreRoot
    self.kek = kek
    self.env = env
  }

  // MARK: - Path handling

  func realPath(_ fusePath: String) throws -> String {
    if fusePath == "/" { return backstoreRoot }

    let rel = fusePath.hasPrefix("/") ? String(fusePath.dropFirst()) : fusePath

    // Ensure we never escape the backstore root.
    let candidate = URL(fileURLWithPath: backstoreRoot)
      .appendingPathComponent(rel, isDirectory: false)
      .standardizedFileURL
      .path

    if candidate != backstoreRoot && !candidate.hasPrefix(backstoreRoot + "/") {
      throw POSIXError(.EACCES)
    }

    return candidate
  }

  func relPath(_ fusePath: String) -> String {
    if fusePath == "/" { return "." }
    return fusePath.hasPrefix("/") ? String(fusePath.dropFirst()) : fusePath
  }

  // MARK: - Authz

  func authorize(op: Ops, fusePath: String) throws -> PathClassification {
    let rel = relPath(fusePath)
    let cls = try Policy.classifyPath(rel, env: env)

    let gatewayOK: Bool
    if cls.requiresGatewayAccessChecks {
      gatewayOK = Liveness.isGatewayAccessAllowed(env: env)
    } else {
      gatewayOK = true
    }

    let res = Core.authorizeOp(op: op, rel: rel, env: env, gatewayAccessAllowed: gatewayOK)
    if !res.ok {
      throw POSIXError(POSIXErrorCode(rawValue: res.code) ?? .EACCES)
    }

    return cls
  }

  // MARK: - Handles

  private func allocHandle(_ h: Handle) -> UInt64 {
    handlesLock.lock()
    defer { handlesLock.unlock() }

    let id = nextHandle
    nextHandle += 1
    handles[id] = h
    return id
  }

  func getHandle(_ id: UInt64) -> Handle? {
    handlesLock.lock()
    defer { handlesLock.unlock() }
    return handles[id]
  }

  func setHandle(_ id: UInt64, _ h: Handle) {
    handlesLock.lock()
    defer { handlesLock.unlock() }
    handles[id] = h
  }

  func removeHandle(_ id: UInt64) -> Handle? {
    handlesLock.lock()
    defer { handlesLock.unlock() }
    return handles.removeValue(forKey: id)
  }

  // MARK: - Encrypted handle helpers

  private func loadEncryptedHandle(real: String, flags: Int32, createIfMissing: Bool) throws -> Handle {
    guard let kek else {
      throw POSIXError(.EACCES)
    }

    let (dek, plaintext) = try EncryptedFile.readEncryptedFile(kek: kek, realPath: real, createIfMissing: createIfMissing)

    let truncated = (flags & O_TRUNC) != 0
    let buf = truncated ? Data() : plaintext

    return .encrypted(real: real, dek: dek, buf: buf, flags: flags, dirty: truncated)
  }

  private func flushEncryptedHandle(_ h: Handle) throws {
    guard case let .encrypted(real, dek, buf, _, dirty) = h else { return }
    if !dirty { return }
    try EncryptedFile.writeEncryptedFile(dek: dek, realPath: real, plaintext: buf)
  }

  // MARK: - Ops

  func getattr(fusePath: String) throws -> stat {
    let cls = try authorize(op: .read, fusePath: fusePath)
    let real = try realPath(fusePath)

    // Hide DEK sidecars.
    if real.hasSuffix(".ocpfs.dek") {
      throw POSIXError(.ENOENT)
    }

    // For encrypted files, we expose ciphertext's stat for now (same as Node).
    // Best-effort: sidecar stats are filtered/hidden.
    var st = stat()
    if lstat(real, &st) != 0 {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }

    // If classified encrypted but file is missing, still return ENOENT.
    _ = cls
    return st
  }

  func readdir(fusePath: String, filler: fuse_fill_dir_t?, buf: UnsafeMutableRawPointer?) throws {
    _ = try authorize(op: .read, fusePath: fusePath)
    guard let filler else { throw POSIXError(.EINVAL) }

    let real = try realPath(fusePath)
    guard let dir = opendir(real) else {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
    defer { closedir(dir) }

    _ = filler(buf, ".", nil, 0)
    _ = filler(buf, "..", nil, 0)

    while let ent = Darwin.readdir(dir) {
      let name = withUnsafePointer(to: ent.pointee.d_name) {
        $0.withMemoryRebound(to: CChar.self, capacity: MemoryLayout.size(ofValue: ent.pointee.d_name)) {
          String(cString: $0)
        }
      }
      if name == "." || name == ".." { continue }
      if name.hasSuffix(".ocpfs.dek") { continue }
      _ = filler(buf, name, nil, 0)
    }
  }

  func open(fusePath: String, flags: Int32) throws -> UInt64 {
    let needsWrite = ((flags & O_ACCMODE) == O_WRONLY) || ((flags & O_ACCMODE) == O_RDWR)
    let cls = try authorize(op: needsWrite ? .write : .read, fusePath: fusePath)

    let real = try realPath(fusePath)

    if cls.storage == "plaintext" {
      let fd = Darwin.open(real, flags)
      if fd < 0 {
        throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
      }
      return allocHandle(.plaintext(fd: fd, real: real, flags: flags))
    }

    let h = try loadEncryptedHandle(real: real, flags: flags, createIfMissing: false)
    return allocHandle(h)
  }

  func create(fusePath: String, mode: mode_t, flags: Int32) throws -> UInt64 {
    let cls = try authorize(op: .create, fusePath: fusePath)
    let real = try realPath(fusePath)

    let useFlags: Int32 = flags | O_CREAT | O_TRUNC

    if cls.storage == "plaintext" {
      let fd = Darwin.open(real, useFlags, mode)
      if fd < 0 {
        throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
      }
      return allocHandle(.plaintext(fd: fd, real: real, flags: useFlags))
    }

    var h = try loadEncryptedHandle(real: real, flags: useFlags, createIfMissing: true)
    if case let .encrypted(r, dek, buf, f, _) = h {
      h = .encrypted(real: r, dek: dek, buf: buf, flags: f, dirty: true)
    }
    return allocHandle(h)
  }

  func release(handleId: UInt64) throws {
    guard let h = removeHandle(handleId) else { return }

    switch h {
      case let .plaintext(fd, _, _):
        _ = close(fd)

      case .encrypted:
        try flushEncryptedHandle(h)
    }
  }

  func read(handleId: UInt64, out: UnsafeMutablePointer<CChar>?, size: size_t, offset: off_t) throws -> Int {
    guard let out else { throw POSIXError(.EINVAL) }
    guard let h = getHandle(handleId) else { throw POSIXError(.EBADF) }

    switch h {
      case let .plaintext(fd, _, _):
        let n = pread(fd, out, size, offset)
        if n < 0 { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
        return n

      case let .encrypted(_, _, buf, _, _):
        let pos = Int(max(0, offset))
        if pos >= buf.count { return 0 }
        let end = min(buf.count, pos + Int(size))
        let slice = buf.subdata(in: pos..<end)
        slice.copyBytes(to: UnsafeMutableRawBufferPointer(start: out, count: slice.count))
        return slice.count
    }
  }

  func write(handleId: UInt64, data: UnsafePointer<CChar>?, size: size_t, offset: off_t) throws -> Int {
    guard let data else { throw POSIXError(.EINVAL) }
    guard let h = getHandle(handleId) else { throw POSIXError(.EBADF) }

    switch h {
      case let .plaintext(fd, _, _):
        let n = pwrite(fd, data, size, offset)
        if n < 0 { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
        return n

      case let .encrypted(real, dek, buf, flags, _):
        let pos = Int(max(0, offset))
        let len = Int(size)
        let needed = pos + len

        var next = buf
        if needed > next.count {
          next.append(contentsOf: [UInt8](repeating: 0, count: needed - next.count))
        }

        let src = Data(bytes: data, count: len)
        next.replaceSubrange(pos..<pos + len, with: src)

        setHandle(handleId, .encrypted(real: real, dek: dek, buf: next, flags: flags, dirty: true))
        return len
    }
  }

  func flush(handleId: UInt64) throws {
    guard let h = getHandle(handleId) else { return }
    switch h {
      case let .plaintext(fd, _, _):
        if fsync(fd) != 0 {
          throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }

      case .encrypted:
        try flushEncryptedHandle(h)
    }
  }

  func unlink(fusePath: String) throws {
    let cls = try authorize(op: .unlink, fusePath: fusePath)
    let real = try realPath(fusePath)

    if cls.storage == "plaintext" {
      if Darwin.unlink(real) != 0 {
        throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
      }
      return
    }

    if Darwin.unlink(real) != 0 {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
    _ = Darwin.unlink(EncryptedFile.sidecarDekPath(real))
  }

  func rename(from: String, to: String) throws {
    let srcCls = try authorize(op: .rename, fusePath: from)
    let dstCls = try authorize(op: .rename, fusePath: to)

    if srcCls.storage != dstCls.storage {
      throw POSIXError(.EACCES)
    }

    let srcReal = try realPath(from)
    let dstReal = try realPath(to)

    if Darwin.rename(srcReal, dstReal) != 0 {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }

    if srcCls.storage == "encrypted" {
      _ = Darwin.rename(EncryptedFile.sidecarDekPath(srcReal), EncryptedFile.sidecarDekPath(dstReal))
    }
  }

  func mkdir(fusePath: String, mode: mode_t) throws {
    _ = try authorize(op: .mkdir, fusePath: fusePath)
    let real = try realPath(fusePath)
    if Darwin.mkdir(real, mode) != 0 {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
  }

  func rmdir(fusePath: String) throws {
    _ = try authorize(op: .rmdir, fusePath: fusePath)
    let real = try realPath(fusePath)
    if Darwin.rmdir(real) != 0 {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
  }

  func truncate(fusePath: String, size: off_t) throws {
    let cls = try authorize(op: .write, fusePath: fusePath)
    let real = try realPath(fusePath)

    if cls.storage == "plaintext" {
      if Darwin.truncate(real, size) != 0 {
        throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
      }
      return
    }

    var h = try loadEncryptedHandle(real: real, flags: O_RDWR, createIfMissing: false)
    if case let .encrypted(r, dek, buf, flags, _) = h {
      let target = Int(max(0, size))
      var next = Data(count: target)
      next.withUnsafeMutableBytes { dst in
        buf.prefix(target).withUnsafeBytes { src in
          _ = memcpy(dst.baseAddress, src.baseAddress, min(dst.count, src.count))
        }
      }
      h = .encrypted(real: r, dek: dek, buf: next, flags: flags, dirty: true)
    }
    try flushEncryptedHandle(h)
  }

  func chmod(fusePath: String, mode: mode_t) throws {
    let cls = try authorize(op: .chmod, fusePath: fusePath)
    let real = try realPath(fusePath)

    if Darwin.chmod(real, mode) != 0 {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }

    if cls.storage == "encrypted" {
      _ = Darwin.chmod(EncryptedFile.sidecarDekPath(real), mode)
    }
  }

  func chown(fusePath: String, uid: uid_t, gid: gid_t) throws {
    _ = try authorize(op: .chown, fusePath: fusePath)
    let real = try realPath(fusePath)
    if Darwin.lchown(real, uid, gid) != 0 {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
  }

  func utimens(fusePath: String, tv: UnsafePointer<timespec>?) throws {
    let cls = try authorize(op: .utimens, fusePath: fusePath)
    let real = try realPath(fusePath)

    var times: [timespec] = [timespec(), timespec()]
    if let tv {
      times[0] = tv.pointee
      times[1] = tv.advanced(by: 1).pointee
    } else {
      times[0].tv_nsec = Int(UTIME_NOW)
      times[1].tv_nsec = Int(UTIME_NOW)
    }

    if utimensat(AT_FDCWD, real, &times, AT_SYMLINK_NOFOLLOW) != 0 {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }

    if cls.storage == "encrypted" {
      _ = utimensat(AT_FDCWD, EncryptedFile.sidecarDekPath(real), &times, AT_SYMLINK_NOFOLLOW)
    }
  }

  func statfs(fusePath: String) throws -> statvfs {
    _ = try authorize(op: .statfs, fusePath: fusePath)
    let real = try realPath(fusePath)

    var st = statvfs()
    if statvfs(real, &st) != 0 {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
    return st
  }
}

// MARK: - C helpers

@inline(__always)
private func withErrno<T>(_ body: () throws -> T, _ map: (T) -> Int32) -> Int32 {
  do {
    let v = try body()
    return map(v)
  } catch let e as POSIXError {
    return -Int32(e.errorCode)
  } catch let e as EncryptedFile.EncryptedFileError {
    return -e.code
  } catch {
    return -Int32(EIO)
  }
}

@inline(__always)
private func cString(_ p: UnsafePointer<CChar>?) -> String {
  guard let p else { return "" }
  return String(cString: p)
}

// MARK: - FUSE callbacks

@_cdecl("ocpfs_getattr")
func ocpfs_getattr(_ path: UnsafePointer<CChar>?, _ stbuf: UnsafeMutablePointer<stat>?) -> Int32 {
  withErrno({
    let st = try ProtectFsFuse.shared.getattr(fusePath: cString(path))
    stbuf?.pointee = st
    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_access")
func ocpfs_access(_ path: UnsafePointer<CChar>?, _ mask: Int32) -> Int32 {
  // access is treated as READ authz.
  withErrno({
    _ = try ProtectFsFuse.shared.authorize(op: .read, fusePath: cString(path))
    let real = try ProtectFsFuse.shared.realPath(cString(path))
    if Darwin.access(real, mask) != 0 {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_readdir")
func ocpfs_readdir(
  _ path: UnsafePointer<CChar>?,
  _ buf: UnsafeMutableRawPointer?,
  _ filler: fuse_fill_dir_t?,
  _ offset: off_t,
  _ fi: UnsafeMutablePointer<fuse_file_info>?
) -> Int32 {
  _ = offset
  _ = fi
  return withErrno({
    try ProtectFsFuse.shared.readdir(fusePath: cString(path), filler: filler, buf: buf)
    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_open")
func ocpfs_open(_ path: UnsafePointer<CChar>?, _ fi: UnsafeMutablePointer<fuse_file_info>?) -> Int32 {
  withErrno({
    guard let fi else { throw POSIXError(.EINVAL) }
    let flags = Int32(fi.pointee.flags)
    let h = try ProtectFsFuse.shared.open(fusePath: cString(path), flags: flags)
    fi.pointee.fh = h
    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_create")
func ocpfs_create(_ path: UnsafePointer<CChar>?, _ mode: mode_t, _ fi: UnsafeMutablePointer<fuse_file_info>?) -> Int32 {
  withErrno({
    guard let fi else { throw POSIXError(.EINVAL) }
    let flags = Int32(fi.pointee.flags)
    let h = try ProtectFsFuse.shared.create(fusePath: cString(path), mode: mode, flags: flags)
    fi.pointee.fh = h
    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_release")
func ocpfs_release(_ path: UnsafePointer<CChar>?, _ fi: UnsafeMutablePointer<fuse_file_info>?) -> Int32 {
  _ = path
  return withErrno({
    guard let fi else { return () }
    let h = fi.pointee.fh
    if h != 0 {
      try ProtectFsFuse.shared.release(handleId: h)
      fi.pointee.fh = 0
    }
    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_read")
func ocpfs_read(
  _ path: UnsafePointer<CChar>?,
  _ buf: UnsafeMutablePointer<CChar>?,
  _ size: size_t,
  _ offset: off_t,
  _ fi: UnsafeMutablePointer<fuse_file_info>?
) -> Int32 {
  _ = path
  return withErrno({
    guard let fi else { throw POSIXError(.EINVAL) }
    return try ProtectFsFuse.shared.read(handleId: fi.pointee.fh, out: buf, size: size, offset: offset)
  }, { n in Int32(n) })
}

@_cdecl("ocpfs_write")
func ocpfs_write(
  _ path: UnsafePointer<CChar>?,
  _ buf: UnsafePointer<CChar>?,
  _ size: size_t,
  _ offset: off_t,
  _ fi: UnsafeMutablePointer<fuse_file_info>?
) -> Int32 {
  _ = path
  return withErrno({
    guard let fi else { throw POSIXError(.EINVAL) }
    return try ProtectFsFuse.shared.write(handleId: fi.pointee.fh, data: buf, size: size, offset: offset)
  }, { n in Int32(n) })
}

@_cdecl("ocpfs_flush")
func ocpfs_flush(_ path: UnsafePointer<CChar>?, _ fi: UnsafeMutablePointer<fuse_file_info>?) -> Int32 {
  _ = path
  return withErrno({
    guard let fi else { return () }
    let h = fi.pointee.fh
    if h != 0 {
      try ProtectFsFuse.shared.flush(handleId: h)
    }
    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_fsync")
func ocpfs_fsync(_ path: UnsafePointer<CChar>?, _ isdatasync: Int32, _ fi: UnsafeMutablePointer<fuse_file_info>?) -> Int32 {
  _ = isdatasync
  return ocpfs_flush(path, fi)
}

@_cdecl("ocpfs_unlink")
func ocpfs_unlink(_ path: UnsafePointer<CChar>?) -> Int32 {
  withErrno({
    try ProtectFsFuse.shared.unlink(fusePath: cString(path))
    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_rename")
func ocpfs_rename(_ from: UnsafePointer<CChar>?, _ to: UnsafePointer<CChar>?) -> Int32 {
  withErrno({
    try ProtectFsFuse.shared.rename(from: cString(from), to: cString(to))
    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_mkdir")
func ocpfs_mkdir(_ path: UnsafePointer<CChar>?, _ mode: mode_t) -> Int32 {
  withErrno({
    try ProtectFsFuse.shared.mkdir(fusePath: cString(path), mode: mode)
    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_rmdir")
func ocpfs_rmdir(_ path: UnsafePointer<CChar>?) -> Int32 {
  withErrno({
    try ProtectFsFuse.shared.rmdir(fusePath: cString(path))
    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_truncate")
func ocpfs_truncate(_ path: UnsafePointer<CChar>?, _ size: off_t) -> Int32 {
  withErrno({
    try ProtectFsFuse.shared.truncate(fusePath: cString(path), size: size)
    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_chmod")
func ocpfs_chmod(_ path: UnsafePointer<CChar>?, _ mode: mode_t) -> Int32 {
  withErrno({
    try ProtectFsFuse.shared.chmod(fusePath: cString(path), mode: mode)
    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_chown")
func ocpfs_chown(_ path: UnsafePointer<CChar>?, _ uid: uid_t, _ gid: gid_t) -> Int32 {
  withErrno({
    try ProtectFsFuse.shared.chown(fusePath: cString(path), uid: uid, gid: gid)
    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_utimens")
func ocpfs_utimens(_ path: UnsafePointer<CChar>?, _ tv: UnsafePointer<timespec>?) -> Int32 {
  withErrno({
    try ProtectFsFuse.shared.utimens(fusePath: cString(path), tv: tv)
    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_statfs")
func ocpfs_statfs(_ path: UnsafePointer<CChar>?, _ stbuf: UnsafeMutablePointer<statvfs>?) -> Int32 {
  withErrno({
    let st = try ProtectFsFuse.shared.statfs(fusePath: cString(path))
    stbuf?.pointee = st
    return ()
  }, { _ in 0 })
}

func makeOperations() -> fuse_operations {
  var ops = fuse_operations()
  ops.getattr = ocpfs_getattr
  ops.access = ocpfs_access
  ops.readdir = ocpfs_readdir
  ops.open = ocpfs_open
  ops.create = ocpfs_create
  ops.release = ocpfs_release
  ops.read = ocpfs_read
  ops.write = ocpfs_write
  ops.flush = ocpfs_flush
  ops.fsync = ocpfs_fsync
  ops.unlink = ocpfs_unlink
  ops.rename = ocpfs_rename
  ops.mkdir = ocpfs_mkdir
  ops.rmdir = ocpfs_rmdir
  ops.truncate = ocpfs_truncate
  ops.chmod = ocpfs_chmod
  ops.chown = ocpfs_chown
  ops.utimens = ocpfs_utimens
  ops.statfs = ocpfs_statfs
  return ops
}
