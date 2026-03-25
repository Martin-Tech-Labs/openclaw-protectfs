const childProcess = require('node:child_process');
const path = require('node:path');

class MacOSKeychainRsaKeywrapAdapter {
  constructor(opts = {}) {
    this.swiftBin = opts.swiftBin || 'swift';
    this.scriptPath = opts.scriptPath || path.join(__dirname, '..', 'scripts', 'keywrap_keychain.swift');

    // DI for tests.
    this._execFileSync = opts.execFileSync || childProcess.execFileSync;
  }

  async ensureKeypair({ tag }) {
    if (!tag) throw new Error('tag required');

    const out = this._execFileSync(this.swiftBin, [this.scriptPath, 'ensure', '--tag', tag], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const parsed = JSON.parse(out.toString('utf8'));
    if (!parsed.publicKeyPem) throw new Error('ensureKeypair: missing publicKeyPem');
    return { publicKeyPem: parsed.publicKeyPem };
  }

  async decrypt({ tag, ciphertext }) {
    if (!tag) throw new Error('tag required');
    if (!Buffer.isBuffer(ciphertext)) throw new Error('ciphertext must be a Buffer');

    const out = this._execFileSync(
      this.swiftBin,
      [this.scriptPath, 'decrypt', '--tag', tag, '--ciphertext-b64', ciphertext.toString('base64')],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const parsed = JSON.parse(out.toString('utf8'));
    if (!parsed.plaintextB64) throw new Error('decrypt: missing plaintextB64');
    return Buffer.from(parsed.plaintextB64, 'base64');
  }
}

module.exports = {
  MacOSKeychainRsaKeywrapAdapter,
};
