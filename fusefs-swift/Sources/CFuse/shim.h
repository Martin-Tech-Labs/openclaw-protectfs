#ifndef OCPROTECTFS_C_FUSE_SHIM_H
#define OCPROTECTFS_C_FUSE_SHIM_H

// We intentionally depend on the system-provided libfuse headers (macFUSE / macFUSE via Homebrew).
// This is a phase-2 passthrough implementation; crypto/policy porting comes in phase 3.

#define _FILE_OFFSET_BITS 64
#define FUSE_USE_VERSION 26

// GitHub-hosted runners usually don't have macFUSE/libfuse headers installed.
// We still want SwiftPM to be able to *compile* the package so we can run
// core unit tests in CI. When headers are missing, provide minimal stubs so
// the Swift targets typecheck/compile.
#if __has_include(<fuse/fuse.h>)
  #include <fuse/fuse.h>
#else
  #include <stddef.h>
  #include <stdint.h>
  #include <sys/stat.h>
  #include <sys/types.h>
  #include <sys/statvfs.h>
  #include <time.h>

  // Minimal subset of libfuse ABI to let SwiftPM compile the package on CI machines
  // that lack macFUSE/libfuse headers. These stubs are only for typechecking;
  // linking/running the FUSE executable still requires real headers + libs.

  typedef int (*fuse_fill_dir_t)(void* buf, const char* name, const struct stat* st, off_t off);

  struct fuse_file_info {
    int flags;
    uint64_t fh;
  };

  typedef int (*fuse_getattr_t)(const char* path, struct stat* stbuf);
  typedef int (*fuse_access_t)(const char* path, int mask);
  typedef int (*fuse_readdir_t)(const char* path, void* buf, fuse_fill_dir_t filler, off_t off, struct fuse_file_info* fi);
  typedef int (*fuse_open_t)(const char* path, struct fuse_file_info* fi);
  typedef int (*fuse_create_t)(const char* path, mode_t mode, struct fuse_file_info* fi);
  typedef int (*fuse_release_t)(const char* path, struct fuse_file_info* fi);
  typedef int (*fuse_read_t)(const char* path, char* buf, size_t size, off_t off, struct fuse_file_info* fi);
  typedef int (*fuse_write_t)(const char* path, const char* buf, size_t size, off_t off, struct fuse_file_info* fi);
  typedef int (*fuse_flush_t)(const char* path, struct fuse_file_info* fi);
  typedef int (*fuse_fsync_t)(const char* path, int isdatasync, struct fuse_file_info* fi);
  typedef int (*fuse_unlink_t)(const char* path);
  typedef int (*fuse_rename_t)(const char* from, const char* to);
  typedef int (*fuse_mkdir_t)(const char* path, mode_t mode);
  typedef int (*fuse_rmdir_t)(const char* path);
  typedef int (*fuse_truncate_t)(const char* path, off_t size);
  typedef int (*fuse_chmod_t)(const char* path, mode_t mode);
  typedef int (*fuse_chown_t)(const char* path, uid_t uid, gid_t gid);
  typedef int (*fuse_utimens_t)(const char* path, const struct timespec tv[2]);
  typedef int (*fuse_statfs_t)(const char* path, struct statvfs* stbuf);

  struct fuse_operations {
    fuse_getattr_t getattr;
    fuse_access_t access;
    fuse_readdir_t readdir;
    fuse_open_t open;
    fuse_create_t create;
    fuse_release_t release;
    fuse_read_t read;
    fuse_write_t write;
    fuse_flush_t flush;
    fuse_fsync_t fsync;
    fuse_unlink_t unlink;
    fuse_rename_t rename;
    fuse_mkdir_t mkdir;
    fuse_rmdir_t rmdir;
    fuse_truncate_t truncate;
    fuse_chmod_t chmod;
    fuse_chown_t chown;
    fuse_utimens_t utimens;
    fuse_statfs_t statfs;
  };

  // Declaration only; linking is only required when building the executable.
  int fuse_main_real(int argc, char** argv, const struct fuse_operations* op, size_t op_size, void* user_data);
#endif

#endif
