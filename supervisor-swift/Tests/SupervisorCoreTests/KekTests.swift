import Testing
@testable import SupervisorCore

@Test func resolveKek_usesEphemeralWhenNonInteractive() throws {
  let out = try KekResolver.resolve(
    platform: "darwin",
    env: ["CI": "0"],
    isInteractive: false,
    keychain: InMemoryGenericPasswordKeychain()
  )
  #expect(out.source == .ephemeral)
  #expect(out.kek.count == 32)
}

@Test func resolveKek_usesEphemeralInCI() throws {
  let out = try KekResolver.resolve(
    platform: "darwin",
    env: ["CI": "true"],
    isInteractive: true,
    keychain: InMemoryGenericPasswordKeychain()
  )
  #expect(out.source == .ephemeral)
  #expect(out.kek.count == 32)
}

@Test func resolveKek_usesKeychainWhenInteractiveDarwin() throws {
  let kc = InMemoryGenericPasswordKeychain()

  let out1 = try KekResolver.resolve(
    platform: "darwin",
    env: ["CI": "0"],
    isInteractive: true,
    keychain: kc
  )
  #expect(out1.source == .keychain)
  #expect(out1.kek.count == 32)

  let out2 = try KekResolver.resolve(
    platform: "darwin",
    env: ["CI": "0"],
    isInteractive: true,
    keychain: kc
  )
  #expect(out2.source == .keychain)
  #expect(out2.kek == out1.kek)
}
