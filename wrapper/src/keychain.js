const childProcess = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

// Minimal Keychain abstraction for initial.
//
// In production on macOS, this can use the `security` CLI to read/write a
// generic password item. In tests, use the InMemoryKeychain.
//
// NOTE: Task 04 focuses on crypto scheme + formats; wrapper integration (user
// presence prompts, ACL pinning, socket handoff to FUSE) can be implemented in
// later tasks. This module exists so the project has a clear API surface.

/**
 * @typedef {Object} IKeychain
 * @property {(args: {service: string, account: string}) => Promise<Buffer|null>} getGenericPassword
 * @property {(args: {service: string, account: string, secret: Buffer}) => Promise<void>} setGenericPassword
 */

class InMemoryKeychain {
  constructor() {
    this._items = new Map();
  }

  _k({ service, account }) {
    return `${service}::${account}`;
  }

  async getGenericPassword({ service, account }) {
    const k = this._k({ service, account });
    const v = this._items.get(k);
    return v ? Buffer.from(v) : null;
  }

  async setGenericPassword({ service, account, secret }) {
    if (!Buffer.isBuffer(secret)) throw new Error('secret must be a Buffer');
    const k = this._k({ service, account });
    this._items.set(k, Buffer.from(secret));
  }
}

class MacOSSecurityCliKeychain {
  constructor(opts = {}) {
    this.securityBin = opts.securityBin || '/usr/bin/security';

    // Dependency injection for tests.
    this._execFileSync = opts.execFileSync || childProcess.execFileSync;
    this._platform = opts.platform || os.platform;
  }

  _ensureDarwin() {
    const p = typeof this._platform === 'function' ? this._platform() : this._platform;
    if (p !== 'darwin') {
      throw new Error(`macOS Keychain backend requires macOS (process.platform=${p})`);
    }
  }

  async getGenericPassword({ service, account }) {
    this._ensureDarwin();

    try {
      // -w prints password only.
      const out = this._execFileSync(
        this.securityBin,
        ['find-generic-password', '-s', service, '-a', account, '-w'],
        {
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      );

      // Store arbitrary bytes as base64 text in Keychain.
      const s = out.toString('utf8').trim();
      const buf = Buffer.from(s, 'base64');
      if (buf.length === 0 && s.length !== 0) throw new Error('keychain item is not valid base64');
      return buf;
    } catch (e) {
      // If not found, security exits non-zero.
      return null;
    }
  }

  async setGenericPassword({ service, account, secret }) {
    this._ensureDarwin();
    if (!Buffer.isBuffer(secret)) throw new Error('secret must be a Buffer');

    // -U updates if exists.
    // Write as base64 text so we can round-trip arbitrary bytes.
    const encoded = secret.toString('base64');
    this._execFileSync(
      this.securityBin,
      ['add-generic-password', '-U', '-s', service, '-a', account, '-w', encoded],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    );
  }
}

class MacOSSwiftKeychain {
  constructor(opts = {}) {
    this.swiftBin = opts.swiftBin || 'swift';
    this.scriptPath =
      opts.scriptPath || path.join(__dirname, '..', 'scripts', 'generic_keychain.swift');

    // Dependency injection for tests.
    this._execFileSync = opts.execFileSync || childProcess.execFileSync;
    this._platform = opts.platform || os.platform;

    // Default: require interactive user presence for reads/writes.
    this.requireUserPresence = opts.requireUserPresence !== undefined ? opts.requireUserPresence : true;
  }

  _ensureDarwin() {
    const p = typeof this._platform === 'function' ? this._platform() : this._platform;
    if (p !== 'darwin') {
      throw new Error(`macOS Keychain backend requires macOS (process.platform=${p})`);
    }
  }

  async getGenericPassword({ service, account }) {
    this._ensureDarwin();

    const out = this._execFileSync(this.swiftBin, [this.scriptPath, 'get', '--service', service, '--account', account], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const parsed = JSON.parse(out.toString('utf8'));
    if (parsed.dataB64 === null) return null;
    if (!parsed.dataB64) throw new Error('generic_keychain.swift get: missing dataB64');
    return Buffer.from(parsed.dataB64, 'base64');
  }

  async setGenericPassword({ service, account, secret }) {
    this._ensureDarwin();
    if (!Buffer.isBuffer(secret)) throw new Error('secret must be a Buffer');

    this._execFileSync(
      this.swiftBin,
      [
        this.scriptPath,
        'set',
        '--service',
        service,
        '--account',
        account,
        '--data-b64',
        secret.toString('base64'),
        '--require-user-presence',
        this.requireUserPresence ? '1' : '0',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
  }
}

async function getOrCreateKey32({ keychain, service, account, createRandomKey32 }) {
  if (!keychain) throw new Error('keychain required');
  if (!service || !account) throw new Error('service and account required');
  if (typeof createRandomKey32 !== 'function') throw new Error('createRandomKey32 function required');

  const existing = await keychain.getGenericPassword({ service, account });
  if (existing) {
    if (existing.length !== 32) throw new Error('keychain item has wrong length (expected 32 bytes)');
    return existing;
  }

  const k = createRandomKey32();
  if (!Buffer.isBuffer(k) || k.length !== 32) throw new Error('createRandomKey32 must return 32-byte Buffer');
  await keychain.setGenericPassword({ service, account, secret: k });
  return k;
}

module.exports = {
  InMemoryKeychain,
  MacOSSecurityCliKeychain,
  MacOSSwiftKeychain,
  getOrCreateKey32,
};
