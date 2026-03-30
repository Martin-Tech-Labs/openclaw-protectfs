import Foundation

#if canImport(Security)
import Security
#endif

#if canImport(Security)
public typealias OCOSStatus = OSStatus
#else
public typealias OCOSStatus = Int32
#endif

public enum KeychainError: Error, Equatable, CustomStringConvertible {
  case unsupportedPlatform
  case unexpectedStatus(OCOSStatus)
  case invalidData

  public var description: String {
    switch self {
    case .unsupportedPlatform:
      return "Keychain is only supported on macOS"
    case .unexpectedStatus(let s):
      return "Keychain error: status=\(s)"
    case .invalidData:
      return "Keychain returned invalid data"
    }
  }
}

public protocol GenericPasswordKeychain {
  func getGenericPassword(service: String, account: String) throws -> Data?
  func setGenericPassword(service: String, account: String, secret: Data, access: KeychainAccess?) throws
}

public struct KeychainAccess: Equatable {
  /// Require user presence (TouchID / password) when reading.
  public var requireUserPresence: Bool

  /// Best-effort: attempt to restrict access to a specific code-signed binary.
  ///
  /// This uses legacy macOS Keychain ACLs (SecTrustedApplication). It can fail
  /// depending on system policy, and is not available off macOS.
  public var trustedApplicationPath: String?

  public init(requireUserPresence: Bool = true, trustedApplicationPath: String? = nil) {
    self.requireUserPresence = requireUserPresence
    self.trustedApplicationPath = trustedApplicationPath
  }
}

#if canImport(Security) && os(macOS)
public final class MacOSGenericPasswordKeychain: GenericPasswordKeychain {
  public init() {}

  public func getGenericPassword(service: String, account: String) throws -> Data? {
    var result: CFTypeRef?
    let q: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]

    let st = SecItemCopyMatching(q as CFDictionary, &result)
    if st == errSecItemNotFound { return nil }
    guard st == errSecSuccess else { throw KeychainError.unexpectedStatus(st) }
    guard let data = result as? Data else { throw KeychainError.invalidData }
    return data
  }

  public func setGenericPassword(service: String, account: String, secret: Data, access: KeychainAccess?) throws {
    // Delete any existing item first to avoid SecItemUpdate complexity when the
    // access control mechanism changes.
    let delQ: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    _ = SecItemDelete(delQ as CFDictionary)

    var add: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecValueData as String: secret,
    ]

    if let access {
      if access.requireUserPresence {
        var err: Unmanaged<CFError>?
        if let ac = SecAccessControlCreateWithFlags(
          nil,
          kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
          SecAccessControlCreateFlags.userPresence,
          &err
        ) {
          add[kSecAttrAccessControl as String] = ac
        } else {
          let msg = (err?.takeRetainedValue() as Error?)
          throw msg ?? KeychainError.unexpectedStatus(errSecParam)
        }
      }

      // Best-effort legacy ACL pinning to a trusted application.
      if let p = access.trustedApplicationPath {
        var app: SecTrustedApplication?
        let st1 = SecTrustedApplicationCreateFromPath(p, &app)
        if st1 == errSecSuccess, let app {
          var accessRef: SecAccess?
          let label = "ocprotectfs (supervisor)" as CFString
          let apps = [app] as CFArray
          let st2 = SecAccessCreate(label, apps, &accessRef)
          if st2 == errSecSuccess, let accessRef {
            // NOTE: kSecAttrAccess is legacy and may not combine with
            // kSecAttrAccessControl on all macOS versions. If this causes
            // SecItemAdd to fail, callers should retry without pinning.
            add[kSecAttrAccess as String] = accessRef
          }
        }
      }
    }

    let st = SecItemAdd(add as CFDictionary, nil)
    guard st == errSecSuccess else { throw KeychainError.unexpectedStatus(st) }
  }
}
#else
public final class MacOSGenericPasswordKeychain: GenericPasswordKeychain {
  public init() {}

  public func getGenericPassword(service: String, account: String) throws -> Data? {
    throw KeychainError.unsupportedPlatform
  }

  public func setGenericPassword(service: String, account: String, secret: Data, access: KeychainAccess?) throws {
    throw KeychainError.unsupportedPlatform
  }
}
#endif

public final class InMemoryGenericPasswordKeychain: GenericPasswordKeychain {
  private var store: [String: Data] = [:]

  public init() {}

  private func key(_ service: String, _ account: String) -> String { "\(service):\(account)" }

  public func getGenericPassword(service: String, account: String) throws -> Data? {
    store[key(service, account)]
  }

  public func setGenericPassword(service: String, account: String, secret: Data, access: KeychainAccess?) throws {
    store[key(service, account)] = secret
  }
}
