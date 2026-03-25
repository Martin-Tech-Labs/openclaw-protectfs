const fs = require('node:fs');
const path = require('node:path');

const { OPS, authorizeOp } = require('./core');
const { classifyPath } = require('./policy');
const { readEncryptedFile, writeEncryptedFile, sidecarDekPath } = require('./encrypted-file');

function toRealPath(backstoreRoot, fusePath) {
  if (fusePath === '/') return backstoreRoot;

  const rel = fusePath.startsWith('/') ? fusePath.slice(1) : fusePath;

  // Prevent path traversal / escaping the backstore.
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

function flagRequiresWrite(flags) {
  const { O_WRONLY, O_RDWR } = fs.constants;
  const accMode = flags & 3; // O_ACCMODE == 3
  return accMode === O_WRONLY || accMode === O_RDWR;
}

/**
 * Build the FUSE ops table for ProtectFS.
 *
 * This is split out from the CLI entrypoint so it can be unit-tested without a real macFUSE mount.
 *
 * @param {object} args
 * @param {string} args.backstore - absolute backstore root path
 * @param {object} args.Fuse - fuse-native module (only used for errno constants)
 * @param {boolean} args.gatewayAccessAllowed
 * @param {Buffer|null} args.kek - 32-byte KEK for encrypted paths
 * @param {string[]} [args.plaintextPrefixes] - configurable plaintext passthrough prefixes
 */
function makeFuseOps({ backstore, Fuse, gatewayAccessAllowed, kek, plaintextPrefixes }) {
  const authz = ({ op, rel }) => {
    try {
      const res = authorizeOp({ op, rel, gatewayAccessAllowed, plaintextPrefixes });
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
    return classifyPath(rel, { plaintextPrefixes });
  };

  async function loadEncryptedHandle({ real, flags, createIfMissing }) {
    if (!kek) {
      const err = new Error('missing KEK for encrypted paths');
      err.code = 'EACCES';
      throw err;
    }

    const { dek, plaintext } = readEncryptedFile({ kek, realPath: real, createIfMissing });

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

      Promise.resolve(loadEncryptedHandle({ real, flags, createIfMissing: false }))
        .then((eh) => {
          const handle = nextHandle++;
          handles.set(handle, eh);
          cb(0, handle);
        })
        .catch((e) => cb(errnoCode(e, Fuse)));
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

      Promise.resolve(loadEncryptedHandle({ real, flags, createIfMissing: true }))
        .then((eh) => {
          eh.dirty = true;
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

      fs.unlink(real, (err) => {
        if (err) return finish(err);
        fs.unlink(sidecarDekPath(real), (_) => finish(null));
      });
    },

    rename: (src, dest, cb) => {
      const srcCls = authorizeFusePath(OPS.RENAME, src, cb);
      if (!srcCls) return;
      const destCls = authorizeFusePath(OPS.RENAME, dest, cb);
      if (!destCls) return;

      const realSrc = rp(src, cb);
      if (!realSrc) return;
      const realDest = rp(dest, cb);
      if (!realDest) return;

      if (srcCls.storage !== destCls.storage) {
        const e = new Error('cannot rename across plaintext/encrypted boundary');
        e.code = 'EACCES';
        cb(errnoCode(e, Fuse));
        return;
      }

      fs.rename(realSrc, realDest, (err) => {
        if (err) return cb(errnoCode(err, Fuse));

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

    chmod: (p, mode, cb) => {
      const cls = authorizeFusePath(OPS.CHMOD, p, cb);
      if (!cls) return;

      const real = rp(p, cb);
      if (!real) return;

      const finish = (err) => {
        if (err) return cb(errnoCode(err, Fuse));
        return cb(0);
      };

      fs.chmod(real, mode, (err) => {
        if (err) return finish(err);
        if (cls.storage === 'encrypted') {
          // Best-effort: keep DEK sidecar permissions in sync if it exists.
          fs.chmod(sidecarDekPath(real), mode, (e2) => {
            if (e2 && e2.code !== 'ENOENT') return finish(e2);
            return finish(null);
          });
          return;
        }
        return finish(null);
      });
    },

    utimens: (p, atime, mtime, cb) => {
      const cls = authorizeFusePath(OPS.UTIMENS, p, cb);
      if (!cls) return;

      const real = rp(p, cb);
      if (!real) return;

      // fuse-native may pass Dates *or* timespec-like objects.
      // Node's fs.utimes accepts Date or number.
      const toUtime = (x) => {
        if (x == null) return new Date(0);
        if (x instanceof Date) return x;
        if (typeof x === 'number') return x;

        // timespec-like: { tv_sec, tv_nsec }
        if (typeof x === 'object') {
          const sec =
            typeof x.tv_sec === 'number'
              ? x.tv_sec
              : typeof x.sec === 'number'
                ? x.sec
                : typeof x.seconds === 'number'
                  ? x.seconds
                  : null;

          const nsec =
            typeof x.tv_nsec === 'number'
              ? x.tv_nsec
              : typeof x.nsec === 'number'
                ? x.nsec
                : typeof x.nanoseconds === 'number'
                  ? x.nanoseconds
                  : 0;

          if (typeof sec === 'number') {
            return new Date(sec * 1000 + nsec / 1e6);
          }
        }

        // last resort: let fs handle / throw
        return x;
      };

      const a = toUtime(atime);
      const m = toUtime(mtime);

      const finish = (err) => {
        if (err) return cb(errnoCode(err, Fuse));
        return cb(0);
      };

      fs.utimes(real, a, m, (err) => {
        if (err) return finish(err);
        if (cls.storage === 'encrypted') {
          fs.utimes(sidecarDekPath(real), a, m, (e2) => {
            if (e2 && e2.code !== 'ENOENT') return finish(e2);
            return finish(null);
          });
          return;
        }
        return finish(null);
      });
    },

    fsync: (p, handle, datasync, cb) => {
      const h = handles.get(handle);
      if (!h) return cb(-Fuse.EBADF);

      if (h.kind === 'plaintext') {
        fs.fsync(h.fd, (err) => {
          if (err) return cb(errnoCode(err, Fuse));
          return cb(0);
        });
        return;
      }

      Promise.resolve()
        .then(() => flushEncryptedHandle(h))
        .then(() => {
          // Best-effort: fsync ciphertext on disk as well.
          try {
            const fd = fs.openSync(h.real, 'r+');
            try {
              fs.fsyncSync(fd);
            } finally {
              fs.closeSync(fd);
            }
          } catch (_) {
            // ignore
          }
        })
        .then(() => cb(0))
        .catch((e) => cb(errnoCode(e, Fuse)));
    },

    statfs: (p, cb) => {
      const cls = authorizeFusePath(OPS.STATFS, p, cb);
      if (!cls) return;

      const real = rp(p, cb);
      if (!real) return;

      if (typeof fs.statfs !== 'function') {
        // Shouldn't happen on modern Node, but be defensive.
        return cb(-Fuse.EINVAL);
      }

      fs.statfs(real, (err, st) => {
        if (err) return cb(errnoCode(err, Fuse));
        return cb(0, st);
      });
    },

    init: (cb) => cb(0),
  };

  return { ops, handles, errnoCode };
}

module.exports = {
  makeFuseOps,
  errnoCode,
};
