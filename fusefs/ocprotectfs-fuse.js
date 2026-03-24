#!/usr/bin/env node

// Task 03 skeleton: placeholder FUSE process with readiness signaling.
//
// This is NOT a real macFUSE filesystem yet. It exists so the wrapper can launch
// a concrete "fuse" process, validate basic paths, and wait for a readiness
// signal.

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
  console.log(`ocprotectfs-fuse (Task 03 skeleton)

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

function main() {
  const cfg = parseArgs(process.argv);

  // Minimal safety checks: these should already be created/validated by wrapper,
  // but validate here as defense-in-depth.
  validatePath(cfg.backstore);
  validatePath(cfg.mountpoint);

  // Readiness signal (wrapper listens for this line).
  process.stdout.write('READY\n');

  // Placeholder: keep process alive until signal.
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
  setInterval(() => {}, 1000);
}

try {
  main();
} catch (err) {
  console.error(`error: ${err && err.message ? err.message : String(err)}`);
  process.exit(2);
}
