import CFuse
import Foundation
import Darwin

// Phase 2 (Issue #108): core FUSE ops + plaintext passthrough.
// Phase 3 (Issue #109) will port crypto/policy/authz.

final class PassthroughFuse {
  static let shared = PassthroughFuse()

  private var backstoreRoot: String = "/"

  func configure(backstoreRoot: String) {
    self.backstoreRoot = backstoreRoot
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
}

// MARK: - C helpers

@inline(__always)
private func withErrno<T>(_ body: () throws -> T, _ map: (T) -> Int32) -> Int32 {
  do {
    let v = try body()
    return map(v)
  } catch let e as POSIXError {
    return -Int32(e.errorCode)
  } catch {
    return -Int32(EIO)
  }
}

@inline(__always)
private func cString(_ p: UnsafePointer<CChar>?) -> String {
  guard let p else { return "" }
  return String(cString: p)
}

// FUSE file handles use 0 as “unset”. A real fd can be 0, so we store fd+1.
@inline(__always)
private func storeFd(_ fd: Int32) -> UInt64 {
  UInt64(UInt32(bitPattern: fd)) + 1
}

@inline(__always)
private func loadFd(_ fh: UInt64) throws -> Int32 {
  if fh == 0 { throw POSIXError(.EBADF) }
  let v = fh - 1
  return Int32(bitPattern: UInt32(v))
}

// MARK: - FUSE callbacks

@_cdecl("ocpfs_getattr")
func ocpfs_getattr(_ path: UnsafePointer<CChar>?, _ stbuf: UnsafeMutablePointer<stat>?) -> Int32 {
  withErrno({
    let fusePath = cString(path)
    let real = try PassthroughFuse.shared.realPath(fusePath)

    var st = stat()
    if lstat(real, &st) != 0 {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
    stbuf?.pointee = st
    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_access")
func ocpfs_access(_ path: UnsafePointer<CChar>?, _ mask: Int32) -> Int32 {
  withErrno({
    let real = try PassthroughFuse.shared.realPath(cString(path))
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
  withErrno({
    guard let filler else { throw POSIXError(.EINVAL) }

    let fusePath = cString(path)
    let real = try PassthroughFuse.shared.realPath(fusePath)

    guard let dir = opendir(real) else {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
    defer { closedir(dir) }

    // Standard entries.
    _ = filler(buf, ".", nil, 0)
    _ = filler(buf, "..", nil, 0)

    while let ent = readdir(dir) {
      let name = withUnsafePointer(to: ent.pointee.d_name) {
        $0.withMemoryRebound(to: CChar.self, capacity: MemoryLayout.size(ofValue: ent.pointee.d_name)) {
          String(cString: $0)
        }
      }
      if name == "." || name == ".." { continue }
      _ = filler(buf, name, nil, 0)
    }

    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_open")
func ocpfs_open(_ path: UnsafePointer<CChar>?, _ fi: UnsafeMutablePointer<fuse_file_info>?) -> Int32 {
  withErrno({
    guard let fi else { throw POSIXError(.EINVAL) }

    let fusePath = cString(path)
    let real = try PassthroughFuse.shared.realPath(fusePath)

    let flags = Int32(fi.pointee.flags)
    let fd = Darwin.open(real, flags)
    if fd < 0 {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }

    fi.pointee.fh = storeFd(fd)
    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_create")
func ocpfs_create(_ path: UnsafePointer<CChar>?, _ mode: mode_t, _ fi: UnsafeMutablePointer<fuse_file_info>?) -> Int32 {
  withErrno({
    guard let fi else { throw POSIXError(.EINVAL) }

    let fusePath = cString(path)
    let real = try PassthroughFuse.shared.realPath(fusePath)

    let baseFlags = Int32(fi.pointee.flags)
    let flags = baseFlags | O_CREAT

    let fd = Darwin.open(real, flags, mode)
    if fd < 0 {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }

    fi.pointee.fh = storeFd(fd)
    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_release")
func ocpfs_release(_ path: UnsafePointer<CChar>?, _ fi: UnsafeMutablePointer<fuse_file_info>?) -> Int32 {
  withErrno({
    guard let fi else { return () }
    let fh = fi.pointee.fh
    if fh != 0 {
      let fd = try loadFd(fh)
      _ = close(fd)
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
  withErrno({
    guard let fi else { throw POSIXError(.EINVAL) }
    guard let buf else { throw POSIXError(.EINVAL) }

    let fd = try loadFd(fi.pointee.fh)
    let n = pread(fd, buf, size, offset)
    if n < 0 {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
    return n
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
  withErrno({
    guard let fi else { throw POSIXError(.EINVAL) }
    guard let buf else { throw POSIXError(.EINVAL) }

    let fd = try loadFd(fi.pointee.fh)
    let n = pwrite(fd, buf, size, offset)
    if n < 0 {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
    return n
  }, { n in Int32(n) })
}

@_cdecl("ocpfs_flush")
func ocpfs_flush(_ path: UnsafePointer<CChar>?, _ fi: UnsafeMutablePointer<fuse_file_info>?) -> Int32 {
  withErrno({
    guard let fi else { return () }
    let fh = fi.pointee.fh
    if fh != 0 {
      let fd = try loadFd(fh)
      if fsync(fd) != 0 {
        throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
      }
    }
    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_fsync")
func ocpfs_fsync(_ path: UnsafePointer<CChar>?, _ isdatasync: Int32, _ fi: UnsafeMutablePointer<fuse_file_info>?) -> Int32 {
  ocpfs_flush(path, fi)
}

@_cdecl("ocpfs_unlink")
func ocpfs_unlink(_ path: UnsafePointer<CChar>?) -> Int32 {
  withErrno({
    let fusePath = cString(path)
    let real = try PassthroughFuse.shared.realPath(fusePath)
    if Darwin.unlink(real) != 0 {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_rename")
func ocpfs_rename(_ from: UnsafePointer<CChar>?, _ to: UnsafePointer<CChar>?) -> Int32 {
  withErrno({
    let src = try PassthroughFuse.shared.realPath(cString(from))
    let dst = try PassthroughFuse.shared.realPath(cString(to))
    if Darwin.rename(src, dst) != 0 {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_mkdir")
func ocpfs_mkdir(_ path: UnsafePointer<CChar>?, _ mode: mode_t) -> Int32 {
  withErrno({
    let real = try PassthroughFuse.shared.realPath(cString(path))
    if Darwin.mkdir(real, mode) != 0 {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_rmdir")
func ocpfs_rmdir(_ path: UnsafePointer<CChar>?) -> Int32 {
  withErrno({
    let real = try PassthroughFuse.shared.realPath(cString(path))
    if Darwin.rmdir(real) != 0 {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_truncate")
func ocpfs_truncate(_ path: UnsafePointer<CChar>?, _ size: off_t) -> Int32 {
  withErrno({
    let real = try PassthroughFuse.shared.realPath(cString(path))
    if Darwin.truncate(real, size) != 0 {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_chmod")
func ocpfs_chmod(_ path: UnsafePointer<CChar>?, _ mode: mode_t) -> Int32 {
  withErrno({
    let real = try PassthroughFuse.shared.realPath(cString(path))
    if Darwin.chmod(real, mode) != 0 {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_chown")
func ocpfs_chown(_ path: UnsafePointer<CChar>?, _ uid: uid_t, _ gid: gid_t) -> Int32 {
  withErrno({
    let real = try PassthroughFuse.shared.realPath(cString(path))
    if Darwin.lchown(real, uid, gid) != 0 {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
    return ()
  }, { _ in 0 })
}

@_cdecl("ocpfs_utimens")
func ocpfs_utimens(_ path: UnsafePointer<CChar>?, _ tv: UnsafePointer<timespec>?) -> Int32 {
  withErrno({
    let real = try PassthroughFuse.shared.realPath(cString(path))

    var times: [timespec] = [timespec(), timespec()]
    if let tv {
      // fuse passes two timespec structs.
      times[0] = tv.pointee
      times[1] = tv.advanced(by: 1).pointee
    } else {
      // nullptr means “set to now”.
      times[0].tv_nsec = Int(UTIME_NOW)
      times[1].tv_nsec = Int(UTIME_NOW)
    }

    // macOS: use utimensat; AT_SYMLINK_NOFOLLOW matches typical FUSE semantics.
    if utimensat(AT_FDCWD, real, &times, AT_SYMLINK_NOFOLLOW) != 0 {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }

    return ()
  }, { (_: Void) in 0 })
}

@_cdecl("ocpfs_statfs")
func ocpfs_statfs(_ path: UnsafePointer<CChar>?, _ stbuf: UnsafeMutablePointer<statvfs>?) -> Int32 {
  withErrno({
    let real = try PassthroughFuse.shared.realPath(cString(path))
    var st = statvfs()
    if statvfs(real, &st) != 0 {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
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
