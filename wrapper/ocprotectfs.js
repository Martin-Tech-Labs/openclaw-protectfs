#!/usr/bin/env node

const path = require('node:path');
const os = require('node:os');
const { run } = require('./src/run');

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
    fuseBin: '/bin/sleep',
    fuseArgs: [],
    // Fail-closed enforcement is opt-in for now so Task 02 placeholder
    // workflows still work by default.
    requireFuseReady: false,
    fuseReadyTimeoutMs: 2000,

    gatewayBin: '/bin/sleep',
    gatewayArgs: [],
    shutdownTimeoutMs: 5000,
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
      case '--fuse-bin':
        cfg.fuseBin = next();
        break;
      case '--fuse-arg':
        cfg.fuseArgs.push(next());
        break;
      case '--gateway-bin':
        cfg.gatewayBin = next();
        break;
      case '--gateway-arg':
        cfg.gatewayArgs.push(next());
        break;

      case '--require-fuse-ready':
        cfg.requireFuseReady = true;
        break;
      case '--fuse-ready-timeout-ms':
        cfg.fuseReadyTimeoutMs = Number(next());
        break;

      case '--shutdown-timeout':
      case '--shutdown-timeout-ms':
        cfg.shutdownTimeoutMs = Number(next());
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        throw new Error(`unknown arg: ${a}`);
    }
  }

  if (cfg.fuseBin === '/bin/sleep' && cfg.fuseArgs.length === 0) cfg.fuseArgs = ['1000000'];
  if (cfg.gatewayBin === '/bin/sleep' && cfg.gatewayArgs.length === 0) cfg.gatewayArgs = ['1000000'];

  return cfg;
}

function printHelp() {
  console.log(`ocprotectfs (Task 02 skeleton)

Usage:
  ocprotectfs [flags]

Flags:
  --backstore <path>           Backstore directory (default ~/.openclaw.real)
  --mountpoint <path>          Mountpoint directory (default ~/.openclaw)

  --fuse-bin <path>            FUSE daemon binary (placeholder in Task 02)
  --fuse-arg <arg>             FUSE arg (repeatable)

  --gateway-bin <path>         Gateway binary (placeholder in Task 02)
  --gateway-arg <arg>          Gateway arg (repeatable)

  --require-fuse-ready          Fail closed: require FUSE to report READY before starting gateway
  --fuse-ready-timeout-ms <ms>  READY wait timeout (default 2000)

  --shutdown-timeout <ms>      Grace period for shutdown (default 5000)
  -h, --help                   Show help
`);
}

async function main() {
  try {
    const cfg = parseArgs(process.argv);
    const code = await run(cfg);
    process.exit(code);
  } catch (err) {
    console.error(`error: ${err && err.message ? err.message : String(err)}`);
    process.exit(2);
  }
}

main();
