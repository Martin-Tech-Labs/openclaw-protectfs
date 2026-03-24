const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { migrateLegacyOpenclaw, MIGRATION } = require('../lib/migrate');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('migration: mountpoint empty -> no-op', () => {
  const base = tmpDir('ocpfs-mig-');
  const mountpoint = path.join(base, 'mp');
  const backstore = path.join(base, 'bs');
  fs.mkdirSync(mountpoint);
  fs.mkdirSync(backstore);

  const res = migrateLegacyOpenclaw({ mountpoint, backstore, now: () => new Date('2026-01-01T00:00:00Z') });
  assert.equal(res.ok, true);
  assert.equal(res.migrated, false);
  assert.equal(res.reason, 'mountpoint-empty');
});

test('migration: stale wrapper liveness socket only -> no-op', () => {
  const base = tmpDir('ocpfs-mig-');
  const mountpoint = path.join(base, 'mp');
  const backstore = path.join(base, 'bs');
  fs.mkdirSync(mountpoint);
  fs.mkdirSync(backstore);

  fs.writeFileSync(path.join(mountpoint, '.ocpfs.sock'), 'not-a-real-socket');

  const res = migrateLegacyOpenclaw({ mountpoint, backstore, now: () => new Date('2026-01-01T00:00:00Z') });
  assert.equal(res.ok, true);
  assert.equal(res.migrated, false);
  assert.equal(res.reason, 'mountpoint-empty');
});

test('migration: marker present -> idempotent no-op', () => {
  const base = tmpDir('ocpfs-mig-');
  const mountpoint = path.join(base, 'mp');
  const backstore = path.join(base, 'bs');
  fs.mkdirSync(mountpoint);
  fs.mkdirSync(backstore);

  fs.writeFileSync(path.join(backstore, MIGRATION.markerName), '{"version":1}\n');
  fs.writeFileSync(path.join(mountpoint, 'legacy.txt'), 'hello');

  const res = migrateLegacyOpenclaw({ mountpoint, backstore, now: () => new Date('2026-01-01T00:00:00Z') });
  assert.equal(res.ok, true);
  assert.equal(res.migrated, false);
  assert.equal(res.reason, 'marker-present');

  // Ensure we did not move anything.
  assert.equal(fs.existsSync(path.join(mountpoint, 'legacy.txt')), true);
});

test('migration: legacy content present -> moved into backstore and marker written', () => {
  const base = tmpDir('ocpfs-mig-');
  const mountpoint = path.join(base, 'mp');
  const backstore = path.join(base, 'bs');
  fs.mkdirSync(mountpoint);
  fs.mkdirSync(backstore);

  fs.mkdirSync(path.join(mountpoint, 'dir'));
  fs.writeFileSync(path.join(mountpoint, 'dir', 'a.txt'), 'A');
  fs.writeFileSync(path.join(mountpoint, 'root.txt'), 'R');
  fs.symlinkSync('root.txt', path.join(mountpoint, 'sym'));

  const res = migrateLegacyOpenclaw({ mountpoint, backstore, now: () => new Date('2026-01-01T00:00:00Z') });
  assert.equal(res.ok, true);
  assert.equal(res.migrated, true);

  assert.equal(fs.existsSync(path.join(mountpoint, 'dir')), false);
  assert.equal(fs.existsSync(path.join(mountpoint, 'root.txt')), false);
  assert.equal(fs.existsSync(path.join(mountpoint, 'sym')), false);

  const markerPath = path.join(backstore, MIGRATION.markerName);
  assert.equal(fs.existsSync(markerPath), true);

  assert.equal(fs.readFileSync(path.join(res.legacyDir, 'root.txt'), 'utf8'), 'R');
  assert.equal(fs.readFileSync(path.join(res.legacyDir, 'dir', 'a.txt'), 'utf8'), 'A');
  assert.equal(fs.lstatSync(path.join(res.legacyDir, 'sym')).isSymbolicLink(), true);
});

test('migration: in-progress marker present -> fail closed', () => {
  const base = tmpDir('ocpfs-mig-');
  const mountpoint = path.join(base, 'mp');
  const backstore = path.join(base, 'bs');
  fs.mkdirSync(mountpoint);
  fs.mkdirSync(backstore);

  fs.writeFileSync(path.join(mountpoint, 'legacy.txt'), 'hello');
  fs.writeFileSync(path.join(backstore, MIGRATION.inProgressName), '{"version":1}\n');

  const res = migrateLegacyOpenclaw({ mountpoint, backstore, now: () => new Date('2026-01-01T00:00:00Z') });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'IN_PROGRESS');
});
