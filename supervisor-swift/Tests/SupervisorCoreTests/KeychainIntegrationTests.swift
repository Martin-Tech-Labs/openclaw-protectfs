import Foundation
import Testing
@testable import SupervisorCore

#if canImport(Security) && os(macOS)
import Security

/// Best-effort “integration-ish” test for the real macOS Keychain backend.
///
/// Rationale:
/// - True `userPresence` prompts (TouchID/password) are not CI-friendly.
/// - But we still want at least one test that exercises the `SecItem*` path on macOS.
///
/// Opt-in with:
///   OCPROTECTFS_RUN_KEYCHAIN_TESTS=1
@Test func macosKeychain_roundTrip_genericPassword_bestEffort() throws {
  let env = ProcessInfo.processInfo.environment
  guard env["OCPROTECTFS_RUN_KEYCHAIN_TESTS"] == "1" else {
    return
  }

  let kc = MacOSGenericPasswordKeychain()

  let service = "ocprotectfs-test-\(UUID().uuidString)"
  let account = "kek"
  let secret = Data((0..<32).map { _ in UInt8.random(in: UInt8.min...UInt8.max) })

  // Write without access controls to avoid userPresence prompts.
  try kc.setGenericPassword(
    service: service,
    account: account,
    secret: secret,
    access: KeychainAccess(requireUserPresence: false, trustedApplicationPath: nil)
  )

  let got = try kc.getGenericPassword(service: service, account: account)
  #expect(got == secret)

  // Cleanup the test item.
  let delQ: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: account,
  ]
  _ = SecItemDelete(delQ as CFDictionary)
}
#endif
