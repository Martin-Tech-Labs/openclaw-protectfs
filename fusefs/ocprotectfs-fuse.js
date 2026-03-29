#!/usr/bin/env node

// Task 14: macFUSE mount wiring for policy + core authZ + crypto encrypted-at-rest.
//
// Contract with wrapper:
// - print a single line "READY" only after a successful mount
// - remain alive until terminated, and attempt a clean unmount on SIGINT/SIGTERM
//
// initial policy summary:
// - workspace/** => plaintext passthrough (additional prefixes can be configured)
// - everything else => encrypted-at-rest, and requires gateway access checks
//
// IMPORTANT SECURITY DEFAULTS:
// - fail closed: encrypted paths require wrapper liveness socket (OCPROTECTFS_LIVENESS_SOCK)
// - encrypted paths also require a KEK (32 bytes)
//   - recommended: wrapper passes KEK via --kek-fd <n>
//   - legacy/testing: OCPROTECTFS_KEK_B64

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const { makeFuseOps } = require('./src/fuse-ops');

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
    kekFd: null,
    plaintextPrefixes: null,
    // Deprecation: on macOS, prefer the Swift daemon by default.
    // Node.js fuse-native path remains available via explicit selection.
    impl: process.env.OCPROTECTFS_FUSE_IMPL || (process.platform === 'darwin' ? 'swift' : 'node'),
    swiftBin: process.env.OCPROTECTFS_FUSE_SWIFT_BIN || null,
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
      case '--kek-fd':
        cfg.kekFd = Number(next());
        if (!Number.isFinite(cfg.kekFd) || cfg.kekFd < 0) throw new Error('--kek-fd must be a non-negative integer');
        break;
      case '--plaintext-prefix': {
        const p = next();
        if (cfg.plaintextPrefixes === null) cfg.plaintextPrefixes = [];
        cfg.plaintextPrefixes.push(p);
        break;
      }
      case '--impl':
        cfg.impl = next();
        break;
      case '--swift-bin':
        cfg.swiftBin = next();
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
  --kek-fd <n>            Read 32-byte KEK from the given file descriptor (recommended)
  --plaintext-prefix <p>   Top-level plaintext passthrough prefix (repeatable)
  --impl <swift|node>      Select implementation (default: env OCPROTECTFS_FUSE_IMPL or: macOS=swift, other=node)
  --swift-bin <path>       Path to Swift daemon executable (default: env OCPROTECTFS_FUSE_SWIFT_BIN)
  -h, --help              Show help

Environment:
  OCPROTECTFS_FUSE_IMPL=swift|node         Select implementation (default: macOS=swift, other=node)
  OCPROTECTFS_FUSE_SWIFT_BIN=<path>        Path to Swift daemon executable
  OCPROTECTFS_LIVENESS_SOCK=<path>         Wrapper liveness unix socket (required for encrypted-path ops)
  OCPROTECTFS_PLAINTEXT_PREFIXES=a,b,c     Comma-separated passthrough prefixes (used if no flags provided)
  OCPROTECTFS_KEK_B64=<base64>             (legacy) 32-byte KEK, base64-encoded
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

function resolveSwiftFuseBin(cfg) {
  if (cfg.swiftBin) return cfg.swiftBin;

  // Prefer a local SwiftPM build output in this repo.
  const base = path.join(__dirname, '..', 'fusefs-swift', '.build');
  const release = path.join(base, 'release', 'ocprotectfs-fuse');
  const debug = path.join(base, 'debug', 'ocprotectfs-fuse');

  if (fs.existsSync(release)) return release;
  if (fs.existsSync(debug)) return debug;
  return null;
}

function withoutImplArgs(argv) {
  const cleaned = [];
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--impl' || a === '--swift-bin') {
      i++; // skip value
      continue;
    }
    cleaned.push(a);
  }
  return cleaned;
}

function maybeExecSwift(cfg, argv) {
  if (String(cfg.impl).toLowerCase() !== 'swift') return false;

  if (process.platform !== 'darwin') {
    throw new Error('Swift FUSE implementation requires macOS');
  }

  const bin = resolveSwiftFuseBin(cfg);
  if (!bin) {
    throw new Error(
      'Swift FUSE daemon not found. Build it first (from fusefs-swift): ' +
        'OCPROTECTFS_BUILD_FUSEFS_SWIFT=1 swift build -c release. ' +
        'Then re-run with --impl swift (default on macOS) or set OCPROTECTFS_FUSE_SWIFT_BIN. ' +
        'To use the legacy Node implementation explicitly, pass --impl node.'
    );
  }

  const res = spawnSync(bin, withoutImplArgs(argv), {
    stdio: 'inherit',
    env: process.env,
  });
  process.exit(res.status === null ? 1 : res.status);
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

function readExactly(fd, n) {
  // Best-effort: read full contents from fd (pipe) then validate length.
  // For our contract, wrapper writes exactly 32 bytes and closes.
  const buf = fs.readFileSync(fd);
  if (!Buffer.isBuffer(buf)) throw new Error('failed to read KEK from fd');
  if (buf.length !== n) throw new Error(`KEK read from fd has wrong length (expected ${n} bytes, got ${buf.length})`);
  return buf;
}

function loadKek(cfg) {
  if (Number.isFinite(cfg.kekFd) && cfg.kekFd !== null) {
    return readExactly(cfg.kekFd, 32);
  }

  const kek = parseKeyFromEnvB64('OCPROTECTFS_KEK_B64');
  if (kek && kek.length !== 32) throw new Error('OCPROTECTFS_KEK_B64 must decode to 32 bytes');
  return kek;
}

function main() {
  const cfg = parseArgs(process.argv);
  maybeExecSwift(cfg, process.argv);

  if (process.platform === 'darwin' && String(cfg.impl).toLowerCase() === 'node') {
    process.stderr.write(
      'warning: --impl node is deprecated on macOS. Prefer the Swift daemon (default) and pass --impl swift.\n'
    );
  }

  // Minimal safety checks: these should already be created/validated by wrapper,
  // but validate here as defense-in-depth.
  const backstore = validatePath(cfg.backstore);
  const mountpoint = validatePath(cfg.mountpoint);

  const Fuse = loadFuseNative();

  // Encrypted-path ops fail closed unless the wrapper liveness socket is present.
  // This removes the bring-up env gate and makes the wrapper the required launch boundary.
  const livenessSock = process.env.OCPROTECTFS_LIVENESS_SOCK;
  let gatewayAccessAllowed = false;
  if (livenessSock) {
    try {
      const st = fs.lstatSync(livenessSock);
      gatewayAccessAllowed = st.isSocket();
    } catch (_) {
      gatewayAccessAllowed = false;
    }
  }

  const kek = loadKek(cfg);

  const { ops } = makeFuseOps({
    backstore,
    Fuse,
    gatewayAccessAllowed,
    kek,
    plaintextPrefixes: cfg.plaintextPrefixes,
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
