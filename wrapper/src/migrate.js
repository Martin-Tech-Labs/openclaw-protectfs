const fs = require('node:fs');
const path = require('node:path');

const { safeAtomicWriteFile } = require('./safe-fs');

const MIGRATION = {
  markerName: '.ocpfs.migrated.json',
  inProgressName: '.ocpfs.migrating.json',
  legacyDirName: '.legacy-openclaw',
};

function isProbablyEmptyDir(dir, { allowNames = [] } = {}) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const filtered = entries
    .map((e) => e.name)
    .filter((n) => n !== '.' && n !== '..')
    .filter((n) => !allowNames.includes(n));
  return filtered.length === 0;
}

function atomicWriteFile(filePath, data) {
  safeAtomicWriteFile(filePath, data, { mode: 0o600 });
}

function readJsonIfExists(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
}

function migrateLegacyOpenclaw({ mountpoint, backstore, now = () => new Date() }) {
  if (!path.isAbsolute(mountpoint) || !path.isAbsolute(backstore)) {
    throw new Error('mountpoint/backstore must be absolute');
  }

  const markerPath = path.join(backstore, MIGRATION.markerName);
  const inProgressPath = path.join(backstore, MIGRATION.inProgressName);

  if (fs.existsSync(markerPath)) {
    return { ok: true, migrated: false, reason: 'marker-present', markerPath };
  }

  // If a previous migration was interrupted, fail closed. We do not try to
  // auto-resume in initial because we want deterministic, inspectable behavior.
  if (fs.existsSync(inProgressPath)) {
    const state = readJsonIfExists(inProgressPath);
    return {
      ok: false,
      code: 'IN_PROGRESS',
      message: `migration appears to be in progress (found ${inProgressPath}); manual inspection required`,
      state,
    };
  }

  // Allow list: we intentionally keep this tiny. Anything else means we might
  // hide legacy content under the mount.
  //
  // Note: `.ocpfs.sock` is created by the wrapper liveness contract. If a
  // previous run crashed, it can be left behind; treat it as safe noise.
  const allowNames = ['.DS_Store', '.ocpfs.sock'];
  if (isProbablyEmptyDir(mountpoint, { allowNames })) {
    return { ok: true, migrated: false, reason: 'mountpoint-empty' };
  }

  const ts = now().toISOString().replaceAll(':', '').replaceAll('.', '');
  const legacyRoot = path.join(backstore, MIGRATION.legacyDirName);
  const legacyDir = path.join(legacyRoot, ts);

  fs.mkdirSync(legacyDir, { recursive: true, mode: 0o700 });

  const plan = {
    version: 1,
    startedAt: now().toISOString(),
    mountpoint,
    backstore,
    legacyDir,
  };
  atomicWriteFile(inProgressPath, JSON.stringify(plan, null, 2) + '\n');

  try {
    const entries = fs.readdirSync(mountpoint, { withFileTypes: true })
      .map((e) => e.name)
      .filter((n) => n !== '.' && n !== '..')
      .filter((n) => !allowNames.includes(n));

    for (const name of entries) {
      const src = path.join(mountpoint, name);
      const dst = path.join(legacyDir, name);

      try {
        fs.renameSync(src, dst);
      } catch (e) {
        // Cross-device rename can fail with EXDEV; fall back to copy + remove.
        if (e && e.code === 'EXDEV') {
          fs.cpSync(src, dst, { recursive: true, dereference: false, errorOnExist: true, preserveTimestamps: true });
          fs.rmSync(src, { recursive: true, force: false });
        } else {
          throw e;
        }
      }
    }

    const marker = {
      version: 1,
      migratedAt: now().toISOString(),
      mountpoint,
      backstore,
      legacyDir,
      note: 'Legacy ~/.openclaw content moved to backstore to avoid being hidden by ProtectFS mount.',
    };

    atomicWriteFile(markerPath, JSON.stringify(marker, null, 2) + '\n');
    fs.unlinkSync(inProgressPath);

    return { ok: true, migrated: true, legacyDir, markerPath };
  } catch (e) {
    // Leave in-progress file behind for inspection.
    return { ok: false, code: 'FAILED', message: e.message || String(e), error: e };
  }
}

module.exports = { migrateLegacyOpenclaw, MIGRATION, isProbablyEmptyDir };
