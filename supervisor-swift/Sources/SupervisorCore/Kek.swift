import Foundation

#if canImport(Security)
import Security
#endif

public enum KekSource: String, Equatable {
  case ephemeral
  case keychain
}

public struct ResolvedKek: Equatable {
  public var kek: Data // 32 bytes
  public var source: KekSource

  public init(kek: Data, source: KekSource) {
    self.kek = kek
    self.source = source
  }
}

public enum KekError: Error, Equatable, CustomStringConvertible {
  case invalidKekLength(Int)
  case randomFailed(Int32)

  public var description: String {
    switch self {
    case .invalidKekLength(let n): return "KEK must be 32 bytes (got \(n))"
    case .randomFailed(let s): return "random failed: status=\(s)"
    }
  }
}

public enum KekResolver {
  public static func resolve(
    platform: String = "darwin",
    env: [String: String] = ProcessInfo.processInfo.environment,
    isInteractive: Bool,
    keychain: GenericPasswordKeychain?,
    service: String = "ocprotectfs",
    account: String = "kek",
    log: ((String) -> Void)? = nil
  ) throws -> ResolvedKek {
    let isCi: Bool = {
      guard let ci = env["CI"] else { return false }
      return ci != "0" && ci.lowercased() != "false"
    }()

    // Match Node wrapper defaults: non-interactive / CI / non-macOS => ephemeral.
    if platform != "darwin" || isCi || !isInteractive {
      let kek = try randomKey32()
      return ResolvedKek(kek: kek, source: .ephemeral)
    }

    let kc = keychain ?? MacOSGenericPasswordKeychain()

    if let existing = try kc.getGenericPassword(service: service, account: account) {
      if existing.count != 32 { throw KekError.invalidKekLength(existing.count) }
      return ResolvedKek(kek: existing, source: .keychain)
    }

    let created = try randomKey32()

    // Best-effort ACL pinning to the current executable, with user presence.
    // If it fails (legacy ACL incompatibilities), retry without pinning.
    let exe = ProcessInfo.processInfo.arguments.first
    do {
      try kc.setGenericPassword(
        service: service,
        account: account,
        secret: created,
        access: KeychainAccess(requireUserPresence: true, trustedApplicationPath: exe)
      )
    } catch {
      log?("kek: Keychain set failed with trusted app pinning; retrying without pinning: \(error)")
      try kc.setGenericPassword(
        service: service,
        account: account,
        secret: created,
        access: KeychainAccess(requireUserPresence: true, trustedApplicationPath: nil)
      )
    }

    return ResolvedKek(kek: created, source: .keychain)
  }

  public static func randomKey32() throws -> Data {
    var buf = [UInt8](repeating: 0, count: 32)

    #if canImport(Security)
    let st = SecRandomCopyBytes(kSecRandomDefault, buf.count, &buf)
    guard st == errSecSuccess else { throw KekError.randomFailed(Int32(st)) }
    return Data(buf)
    #else
    var rng = SystemRandomNumberGenerator()
    for i in 0..<buf.count {
      buf[i] = UInt8.random(in: UInt8.min...UInt8.max, using: &rng)
    }
    return Data(buf)
    #endif
  }
}
