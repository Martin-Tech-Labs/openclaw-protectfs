const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function assertNoSymlinkParents(absPath) {
  if (!path.isAbsolute(absPath)) throw new Error(`path must be absolute: ${absPath}`);

  const root = path.parse(absPath).root;
  const rel = absPath.slice(root.length);
  const parts = rel.split(path.sep).filter(Boolean);

  let cur = root;
  for (const part of parts) {
    cur = path.join(cur, part);
    try {
      const st = fs.lstatSync(cur);
      if (st.isSymbolicLink()) {
        // macOS has historical symlinks like /var -> /private/var.
        if (cur === '/var' || cur === '/tmp') continue;
        throw new Error(`refusing symlink path component: ${cur}`);
      }
    } catch (e) {
      if (e && e.code === 'ENOENT') return;
      throw e;
    }
  }
}

function assertNotSymlink(p) {
  try {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) throw new Error(`refusing symlink path: ${p}`);
  } catch (e) {
    if (e && e.code === 'ENOENT') return;
    throw e;
  }
}

function safeAtomicWriteFile(filePath, data, { mode = 0o600 } = {}) {
  if (!path.isAbsolute(filePath)) throw new Error(`path must be absolute: ${filePath}`);
  const clean = path.resolve(filePath);

  // Refuse any symlink components in the directory chain.
  assertNoSymlinkParents(clean);

  // If a target already exists and is a symlink, refuse (defense-in-depth).
  assertNotSymlink(clean);

  const dir = path.dirname(clean);
  const base = path.basename(clean);

  const suffix = `${process.pid}.${Date.now()}.${crypto.randomBytes(8).toString('hex')}`;
  const tmp = path.join(dir, `.${base}.tmp.${suffix}`);

  let fd;
  try {
    // 'wx' prevents clobbering if an attacker pre-creates the tmp path.
    fd = fs.openSync(tmp, 'wx', mode);
    fs.writeFileSync(fd, data);
    try {
      fs.fsyncSync(fd);
    } catch (_) {
      // ignore (best-effort on some FS types)
    }
    fs.closeSync(fd);
    fd = null;

    fs.renameSync(tmp, clean);

    // Best-effort: fsync directory so the rename is durable.
    try {
      const dfd = fs.openSync(dir, 'r');
      try {
        fs.fsyncSync(dfd);
      } finally {
        fs.closeSync(dfd);
      }
    } catch (_) {
      // ignore
    }

    // Ensure final perms aren't widened by umask.
    try {
      fs.chmodSync(clean, mode);
    } catch (_) {
      // ignore
    }
  } catch (e) {
    try {
      if (fd !== null) fs.closeSync(fd);
    } catch (_) {
      // ignore
    }
    try {
      fs.unlinkSync(tmp);
    } catch (_) {
      // ignore
    }
    throw e;
  }
}

module.exports = {
  assertNoSymlinkParents,
  safeAtomicWriteFile,
};
