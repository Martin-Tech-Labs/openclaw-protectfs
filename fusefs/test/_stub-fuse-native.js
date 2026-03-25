// Preload stub for `fuse-native` so we can exercise the ocprotectfs-fuse CLI
// without requiring macFUSE or the optional native dependency.
//
// Usage:
//   node -r ./fusefs/test/_stub-fuse-native.js fusefs/ocprotectfs-fuse.js ...

const Module = require('node:module');

class FakeFuse {
  constructor(mountpoint, ops, opts) {
    this.mountpoint = mountpoint;
    this.ops = ops;
    this.opts = opts;
  }

  mount(cb) {
    // Simulate an immediate successful mount.
    process.nextTick(() => cb && cb(null));
  }

  unmount(cb) {
    process.nextTick(() => cb && cb(null));
  }
}

// Minimal errno constants used by fuse-ops-v1.
FakeFuse.EACCES = 13;
FakeFuse.ENOENT = 2;
FakeFuse.EPERM = 1;
FakeFuse.EINVAL = 22;

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'fuse-native') return FakeFuse;
  return originalLoad.apply(this, arguments);
};
