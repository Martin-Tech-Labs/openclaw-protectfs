#ifndef OCPROTECTFS_C_FUSE_SHIM_H
#define OCPROTECTFS_C_FUSE_SHIM_H

// We intentionally depend on the system-provided libfuse headers (macFUSE / macFUSE via Homebrew).
// This is a phase-2 passthrough implementation; crypto/policy porting comes in phase 3.

#define _FILE_OFFSET_BITS 64
#define FUSE_USE_VERSION 26
#include <fuse/fuse.h>

#endif
