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

const { makeFuseOps } = require('./lib/fuse-ops-v1');

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
  return Buffer.from(String(v), 'base64');
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

  const { ops } = makeFuseOps({
    backstore,
    Fuse,
    gatewayAccessAllowed,
    kek,
  });

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
