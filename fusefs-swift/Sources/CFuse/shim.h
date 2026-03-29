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

  typedef int (*fuse_fill_dir_t)(void* buf, const char* name, const struct stat* st, off_t off);

  struct fuse_file_info {
    int flags;
    uint64_t fh;
  };

  struct fuse_operations {
    void* _opaque;
  };

  // Declaration only; linking is only required when building the executable.
  int fuse_main_real(int argc, char** argv, const struct fuse_operations* op, size_t op_size, void* user_data);
#endif

#endif
