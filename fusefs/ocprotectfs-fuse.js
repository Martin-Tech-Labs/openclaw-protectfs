#!/usr/bin/env node

// Task 13: minimal macFUSE passthrough mount using `fuse-native`.
//
// Contract with wrapper:
// - print a single line "READY" only after a successful mount
// - remain alive until terminated, and attempt a clean unmount on SIGINT/SIGTERM

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function defaultBackstore() {
  return path.join(os.homedir(), '.openclaw.real');
}

function defaultMountpoint() {
  return path.join(os.homedir(), '.openclaw');
}

function parseArgs(argv) {
  const cfg = {
    backstore: defaultBackstore(),
    mountpoint: defaultMountpoint(),
  };

  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => {
      if (i + 1 >= args.length) throw new Error(`missing value for ${a}`);
      i++;
      return args[i];
    };

    switch (a) {
      case '--backstore':
        cfg.backstore = next();
        break;
      case '--mountpoint':
        cfg.mountpoint = next();
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        throw new Error(`unknown arg: ${a}`);
    }
  }

  return cfg;
}

function printHelp() {
  console.log(`ocprotectfs-fuse (Task 13: fuse-native passthrough)

Usage:
  ocprotectfs-fuse [flags]

Flags:
  --backstore <path>   Backstore directory (default ~/.openclaw.real)
  --mountpoint <path>  Mountpoint directory (default ~/.openclaw)
  -h, --help           Show help
`);
}

function validatePath(p) {
  if (!path.isAbsolute(p)) throw new Error(`path must be absolute: ${p}`);
  const clean = path.resolve(p);

  const st = fs.lstatSync(clean);
  if (st.isSymbolicLink()) throw new Error(`refusing symlink path: ${clean}`);
  if (!st.isDirectory()) throw new Error(`path exists but is not a directory: ${clean}`);

  return clean;
}

function toRealPath(backstoreRoot, fusePath) {
  // `fusePath` is an absolute path within the mount, like `/` or `/foo/bar`.
  // Map to a path under `backstoreRoot`.
  if (fusePath === '/') return backstoreRoot;

  const rel = fusePath.startsWith('/') ? fusePath.slice(1) : fusePath;

  // Prevent path traversal / escaping the backstore.
  // Use an explicit `./` prefix so a rel path beginning with `..` is still treated as relative.
  const real = path.resolve(backstoreRoot, `.${path.sep}${rel}`);

  if (real !== backstoreRoot && !real.startsWith(backstoreRoot + path.sep)) {
    const err = new Error('path escapes backstore');
    err.code = 'EACCES';
    throw err;
  }

  return real;
}

function errnoCode(err, Fuse) {
  if (!err) return 0;

  // Prefer Fuse's explicit errno mapping when available.
  if (Fuse && err.code && typeof Fuse[err.code] === 'number') {
    return -Fuse[err.code];
  }

  // Node often provides a negative errno already.
  if (typeof err.errno === 'number') return err.errno;

  // Fallback: generic failure.
  return -1;
}

function loadFuseNative() {
  try {
    // eslint-disable-next-line global-require
    return require('fuse-native');
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    throw new Error(
      `fuse-native is required for real mounts but could not be loaded. ` +
        `Install macFUSE and ensure optional dependency installed. Details: ${msg}`
    );
  }
}

function main() {
  const cfg = parseArgs(process.argv);

  // Minimal safety checks: these should already be created/validated by wrapper,
  // but validate here as defense-in-depth.
  const backstore = validatePath(cfg.backstore);
  const mountpoint = validatePath(cfg.mountpoint);

  const Fuse = loadFuseNative();

  const rp = (p, cb) => {
    try {
      return toRealPath(backstore, p);
    } catch (err) {
      cb(errnoCode(err, Fuse));
      return null;
    }
  };

  const ops = {
    // getattr must support both files and dirs.
    getattr: (p, cb) => {
      const real = rp(p, cb);
      if (!real) return;
      fs.lstat(real, (err, st) => {
        if (err) return cb(errnoCode(err, Fuse));
        return cb(0, st);
      });
    },

    readdir: (p, cb) => {
      const real = rp(p, cb);
      if (!real) return;
      fs.readdir(real, (err, entries) => {
        if (err) return cb(errnoCode(err, Fuse));
        return cb(0, entries);
      });
    },

    open: (p, flags, cb) => {
      const real = rp(p, cb);
      if (!real) return;
      fs.open(real, flags, (err, fd) => {
        if (err) return cb(errnoCode(err, Fuse));
        return cb(0, fd);
      });
    },

    release: (p, fd, cb) => {
      fs.close(fd, (err) => {
        if (err) return cb(errnoCode(err, Fuse));
        return cb(0);
      });
    },

    read: (p, fd, buf, len, pos, cb) => {
      fs.read(fd, buf, 0, len, pos, (err, bytesRead) => {
        if (err) return cb(errnoCode(err, Fuse));
        return cb(bytesRead);
      });
    },

    write: (p, fd, buf, len, pos, cb) => {
      fs.write(fd, buf, 0, len, pos, (err, bytesWritten) => {
        if (err) return cb(errnoCode(err, Fuse));
        return cb(bytesWritten);
      });
    },

    create: (p, mode, cb) => {
      const real = rp(p, cb);
      if (!real) return;
      const flags = fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_RDWR;
      fs.open(real, flags, mode, (err, fd) => {
        if (err) return cb(errnoCode(err, Fuse));
        return cb(0, fd);
      });
    },

    unlink: (p, cb) => {
      const real = rp(p, cb);
      if (!real) return;
      fs.unlink(real, (err) => {
        if (err) return cb(errnoCode(err, Fuse));
        return cb(0);
      });
    },

    rename: (src, dest, cb) => {
      const realSrc = rp(src, cb);
      if (!realSrc) return;
      const realDest = rp(dest, cb);
      if (!realDest) return;
      fs.rename(realSrc, realDest, (err) => {
        if (err) return cb(errnoCode(err, Fuse));
        return cb(0);
      });
    },

    mkdir: (p, mode, cb) => {
      const real = rp(p, cb);
      if (!real) return;
      fs.mkdir(real, { mode }, (err) => {
        if (err) return cb(errnoCode(err, Fuse));
        return cb(0);
      });
    },

    rmdir: (p, cb) => {
      const real = rp(p, cb);
      if (!real) return;
      fs.rmdir(real, (err) => {
        if (err) return cb(errnoCode(err, Fuse));
        return cb(0);
      });
    },

    truncate: (p, size, cb) => {
      const real = rp(p, cb);
      if (!real) return;
      fs.truncate(real, size, (err) => {
        if (err) return cb(errnoCode(err, Fuse));
        return cb(0);
      });
    },

    // Called on mount.
    init: (cb) => cb(0),
  };

  const fuse = new Fuse(mountpoint, ops, {
    // Keep this minimal; wrapper owns UX.
    displayFolder: mountpoint,
    force: false,
  });

  let mounted = false;
  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    if (!mounted) {
      process.exit(0);
      return;
    }

    try {
      fuse.unmount((err) => {
        if (err) {
          // Best effort; don't hang.
          process.stderr.write(`error: unmount failed: ${err.message || String(err)}\n`);
        }
        process.exit(0);
      });
    } catch (err) {
      process.stderr.write(`error: unmount exception: ${err.message || String(err)}\n`);
      process.exit(0);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  fuse.mount((err) => {
    if (err) {
      throw err;
    }
    mounted = true;
    process.stdout.write('READY\n');
  });

  // Keep event loop alive even if fuse-native doesn't.
  setInterval(() => {}, 1000);
}

try {
  main();
} catch (err) {
  process.stderr.write(`error: ${err && err.message ? err.message : String(err)}\n`);
  process.exit(2);
}
