#!/usr/bin/env node

// Task 14: macFUSE mount wiring for policy-v1 + core-v1 authZ + crypto-v1 encrypted-at-rest.
//
// Contract with wrapper:
// - print a single line "READY" only after a successful mount
// - remain alive until terminated, and attempt a clean unmount on SIGINT/SIGTERM
//
// v1 policy summary:
// - workspace/** + workspace-joao/** => plaintext passthrough
// - everything else => encrypted-at-rest, and requires gateway access checks
//
// IMPORTANT SECURITY DEFAULTS:
// - fail closed: encrypted paths require OCPROTECTFS_GATEWAY_ACCESS_ALLOWED=1
// - encrypted paths also require a KEK via OCPROTECTFS_KEK_B64 (32-byte key, base64)

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { OPS, authorizeOp } = require('./lib/core-v1');
const { classifyPath } = require('./lib/policy-v1');
const { readEncryptedFile, writeEncryptedFile, sidecarDekPath } = require('./lib/encrypted-file-v1');

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
  console.log(`ocprotectfs-fuse (Task 14: policy/auth/crypto wiring)

Usage:
  ocprotectfs-fuse [flags]

Flags:
  --backstore <path>   Backstore directory (default ~/.openclaw.real)
  --mountpoint <path>  Mountpoint directory (default ~/.openclaw)
  -h, --help           Show help

Environment:
  OCPROTECTFS_GATEWAY_ACCESS_ALLOWED=1  Allow encrypted-path operations (fail-closed default deny)
  OCPROTECTFS_KEK_B64=<base64>          32-byte KEK, base64-encoded (required for encrypted paths)
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

function toRel(fusePath) {
  if (fusePath === '/') return '.';
  return fusePath.startsWith('/') ? fusePath.slice(1) : fusePath;
}


function errnoCode(err, Fuse) {
  if (!err) return 0;

  if (Fuse && err.code && typeof Fuse[err.code] === 'number') {
    return -Fuse[err.code];
  }

  if (typeof err.errno === 'number') return err.errno;

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

function parseKeyFromEnvB64(name) {
  const v = process.env[name];
  if (!v) return null;
  const buf = Buffer.from(String(v), 'base64');
  return buf;
}

function makeAuthz({ gatewayAccessAllowed }) {
  return ({ op, rel }) => {
    try {
      const res = authorizeOp({ op, rel, gatewayAccessAllowed });
      if (res.ok) return { ok: true };
      const err = new Error(res.reason);
      err.code = res.code;
      return { ok: false, err };
    } catch (e) {
      const err = new Error(e && e.message ? e.message : String(e));
      err.code = 'EACCES';
      return { ok: false, err };
    }
  };
}

function flagRequiresWrite(flags) {
  // Node's flags are numeric and align with libc O_*.
  // Any write-capable open should require WRITE auth.
  const { O_WRONLY, O_RDWR } = fs.constants;
  const accMode = flags & 3; // O_ACCMODE == 3
  return accMode === O_WRONLY || accMode === O_RDWR;
}

function main() {
  const cfg = parseArgs(process.argv);

  // Minimal safety checks: these should already be created/validated by wrapper,
  // but validate here as defense-in-depth.
  const backstore = validatePath(cfg.backstore);
  const mountpoint = validatePath(cfg.mountpoint);

  const Fuse = loadFuseNative();

  const gatewayAccessAllowed = process.env.OCPROTECTFS_GATEWAY_ACCESS_ALLOWED === '1';
  const kek = parseKeyFromEnvB64('OCPROTECTFS_KEK_B64');
  if (kek && kek.length !== 32) throw new Error('OCPROTECTFS_KEK_B64 must decode to 32 bytes');

  const authz = makeAuthz({ gatewayAccessAllowed });

  // FUSE handle table.
  let nextHandle = 10;
  const handles = new Map();

  const rp = (p, cb) => {
    try {
      return toRealPath(backstore, p);
    } catch (err) {
      cb(errnoCode(err, Fuse));
      return null;
    }
  };

  const authorizeFusePath = (op, fusePath, cb) => {
    const rel = toRel(fusePath);
    const res = authz({ op, rel });
    if (!res.ok) {
      cb(errnoCode(res.err, Fuse));
      return null;
    }
    return classifyPath(rel);
  };

  async function loadEncryptedHandle({ real, flags, createIfMissing }) {
    if (!kek) {
      const err = new Error('missing KEK for encrypted paths');
      err.code = 'EACCES';
      throw err;
    }

    const { dek, plaintext } = readEncryptedFile({ kek, realPath: real, createIfMissing });

    // O_TRUNC => truncate plaintext.
    const truncated = (flags & fs.constants.O_TRUNC) !== 0;

    return {
      kind: 'encrypted',
      real,
      dek,
      buf: truncated ? Buffer.alloc(0) : plaintext,
      flags,
      dirty: truncated,
    };
  }

  async function flushEncryptedHandle(h) {
    if (!h.dirty) return;
    writeEncryptedFile({ dek: h.dek, realPath: h.real, plaintext: h.buf });
    h.dirty = false;
  }

  const ops = {
    getattr: (p, cb) => {
      const cls = authorizeFusePath(OPS.READ, p, cb);
      if (!cls) return;

      const real = rp(p, cb);
      if (!real) return;

      // Hide DEK sidecars from the mounted FS.
      if (real.endsWith('.ocpfs.dek')) return cb(-Fuse.ENOENT);

      fs.lstat(real, (err, st) => {
        if (err) return cb(errnoCode(err, Fuse));
        return cb(0, st);
      });
    },

    readdir: (p, cb) => {
      const cls = authorizeFusePath(OPS.READ, p, cb);
      if (!cls) return;

      const real = rp(p, cb);
      if (!real) return;
      fs.readdir(real, (err, entries) => {
        if (err) return cb(errnoCode(err, Fuse));
        const filtered = entries.filter((e) => !String(e).endsWith('.ocpfs.dek'));
        return cb(0, filtered);
      });
    },

    open: (p, flags, cb) => {
      const op = flagRequiresWrite(flags) ? OPS.WRITE : OPS.READ;
      const cls = authorizeFusePath(op, p, cb);
      if (!cls) return;

      const real = rp(p, cb);
      if (!real) return;

      if (cls.storage === 'plaintext') {
        fs.open(real, flags, (err, fd) => {
          if (err) return cb(errnoCode(err, Fuse));
          const handle = nextHandle++;
          handles.set(handle, { kind: 'plaintext', fd, real, flags });
          return cb(0, handle);
        });
        return;
      }

      // encrypted
      try {
        const h = loadEncryptedHandle({ real, flags, createIfMissing: false });
        Promise.resolve(h)
          .then((eh) => {
            const handle = nextHandle++;
            handles.set(handle, eh);
            cb(0, handle);
          })
          .catch((e) => cb(errnoCode(e, Fuse)));
      } catch (e) {
        cb(errnoCode(e, Fuse));
      }
    },

    create: (p, mode, cb) => {
      const cls = authorizeFusePath(OPS.CREATE, p, cb);
      if (!cls) return;

      const real = rp(p, cb);
      if (!real) return;

      const flags = fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_RDWR;

      if (cls.storage === 'plaintext') {
        fs.open(real, flags, mode, (err, fd) => {
          if (err) return cb(errnoCode(err, Fuse));
          const handle = nextHandle++;
          handles.set(handle, { kind: 'plaintext', fd, real, flags });
          return cb(0, handle);
        });
        return;
      }

      // encrypted
      Promise.resolve(loadEncryptedHandle({ real, flags, createIfMissing: true }))
        .then((eh) => {
          eh.dirty = true; // new file => ensure it hits disk
          const handle = nextHandle++;
          handles.set(handle, eh);
          cb(0, handle);
        })
        .catch((e) => cb(errnoCode(e, Fuse)));
    },

    release: (p, handle, cb) => {
      const h = handles.get(handle);
      handles.delete(handle);
      if (!h) return cb(0);

      if (h.kind === 'plaintext') {
        fs.close(h.fd, (err) => {
          if (err) return cb(errnoCode(err, Fuse));
          return cb(0);
        });
        return;
      }

      Promise.resolve()
        .then(() => flushEncryptedHandle(h))
        .then(() => cb(0))
        .catch((e) => cb(errnoCode(e, Fuse)));
    },

    read: (p, handle, buf, len, pos, cb) => {
      const h = handles.get(handle);
      if (!h) return cb(-Fuse.EBADF);

      if (h.kind === 'plaintext') {
        fs.read(h.fd, buf, 0, len, pos, (err, bytesRead) => {
          if (err) return cb(errnoCode(err, Fuse));
          return cb(bytesRead);
        });
        return;
      }

      const end = Math.min(h.buf.length, pos + len);
      const slice = pos >= h.buf.length ? Buffer.alloc(0) : h.buf.subarray(pos, end);
      slice.copy(buf);
      return cb(slice.length);
    },

    write: (p, handle, buf, len, pos, cb) => {
      const h = handles.get(handle);
      if (!h) return cb(-Fuse.EBADF);

      if (h.kind === 'plaintext') {
        fs.write(h.fd, buf, 0, len, pos, (err, bytesWritten) => {
          if (err) return cb(errnoCode(err, Fuse));
          return cb(bytesWritten);
        });
        return;
      }

      const needed = pos + len;
      if (needed > h.buf.length) {
        const next = Buffer.alloc(needed);
        h.buf.copy(next, 0, 0, h.buf.length);
        h.buf = next;
      }
      buf.subarray(0, len).copy(h.buf, pos);
      h.dirty = true;
      return cb(len);
    },

    unlink: (p, cb) => {
      const cls = authorizeFusePath(OPS.UNLINK, p, cb);
      if (!cls) return;

      const real = rp(p, cb);
      if (!real) return;

      const finish = (err) => {
        if (err) return cb(errnoCode(err, Fuse));
        return cb(0);
      };

      if (cls.storage === 'plaintext') {
        fs.unlink(real, finish);
        return;
      }

      // encrypted: delete content and DEK sidecar
      fs.unlink(real, (err) => {
        if (err) return finish(err);
        fs.unlink(sidecarDekPath(real), (_) => finish(null));
      });
    },

    rename: (src, dest, cb) => {
      // enforce both paths
      const srcCls = authorizeFusePath(OPS.RENAME, src, cb);
      if (!srcCls) return;
      const destCls = authorizeFusePath(OPS.RENAME, dest, cb);
      if (!destCls) return;

      const realSrc = rp(src, cb);
      if (!realSrc) return;
      const realDest = rp(dest, cb);
      if (!realDest) return;

      fs.rename(realSrc, realDest, (err) => {
        if (err) return cb(errnoCode(err, Fuse));

        // If either side is encrypted, keep sidecars in sync.
        // - encrypted->encrypted: move sidecar
        // - encrypted->plaintext or plaintext->encrypted: deny (policy mismatch)
        if (srcCls.storage !== destCls.storage) {
          const e = new Error('cannot rename across plaintext/encrypted boundary');
          e.code = 'EACCES';
          return cb(errnoCode(e, Fuse));
        }

        if (srcCls.storage === 'encrypted') {
          fs.rename(sidecarDekPath(realSrc), sidecarDekPath(realDest), (e2) => {
            if (e2 && e2.code !== 'ENOENT') return cb(errnoCode(e2, Fuse));
            return cb(0);
          });
          return;
        }

        return cb(0);
      });
    },

    mkdir: (p, mode, cb) => {
      const cls = authorizeFusePath(OPS.MKDIR, p, cb);
      if (!cls) return;

      const real = rp(p, cb);
      if (!real) return;
      fs.mkdir(real, { mode }, (err) => {
        if (err) return cb(errnoCode(err, Fuse));
        return cb(0);
      });
    },

    rmdir: (p, cb) => {
      const cls = authorizeFusePath(OPS.RMDIR, p, cb);
      if (!cls) return;

      const real = rp(p, cb);
      if (!real) return;
      fs.rmdir(real, (err) => {
        if (err) return cb(errnoCode(err, Fuse));
        return cb(0);
      });
    },

    truncate: (p, size, cb) => {
      const cls = authorizeFusePath(OPS.WRITE, p, cb);
      if (!cls) return;

      const real = rp(p, cb);
      if (!real) return;

      if (cls.storage === 'plaintext') {
        fs.truncate(real, size, (err) => {
          if (err) return cb(errnoCode(err, Fuse));
          return cb(0);
        });
        return;
      }

      // encrypted: load, resize, flush
      Promise.resolve(loadEncryptedHandle({ real, flags: fs.constants.O_RDWR, createIfMissing: false }))
        .then((h) => {
          const next = Buffer.alloc(Number(size));
          h.buf.subarray(0, Math.min(h.buf.length, next.length)).copy(next);
          h.buf = next;
          h.dirty = true;
          return flushEncryptedHandle(h);
        })
        .then(() => cb(0))
        .catch((e) => cb(errnoCode(e, Fuse)));
    },

    // Called on mount.
    init: (cb) => cb(0),
  };

  const fuse = new Fuse(mountpoint, ops, {
    displayFolder: mountpoint,
    force: false,
  });

  let mounted = false;
  let shuttingDown = false;

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;

    if (!mounted) {
      process.exit(0);
      return;
    }

    try {
      fuse.unmount((err) => {
        if (err) {
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
