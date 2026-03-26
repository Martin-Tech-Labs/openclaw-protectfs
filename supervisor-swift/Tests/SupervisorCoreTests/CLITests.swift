import Testing
@testable import SupervisorCore

@Test func helpTextContainsKnownFlags() {
  let t = CLI.helpText(program: "ocprotectfs-supervisor")
  #expect(t.contains("--backstore"))
  #expect(t.contains("--mountpoint"))
  #expect(t.contains("--fuse-bin"))
  #expect(t.contains("--gateway-bin"))
  #expect(t.contains("--require-fuse-ready"))
}

@Test func parseDefaults() throws {
  let res = try CLI.parse([])
  #expect(res.showHelp == false)
  #expect(res.options.backstore == "~/.openclaw.real")
  #expect(res.options.mountpoint == "~/.openclaw")
  #expect(res.options.fuseReadyTimeoutMs == 2000)
  #expect(res.options.shutdownTimeoutMs == 5000)
}

@Test func parseRepeatableArgs() throws {
  let res = try CLI.parse([
    "--fuse-arg", "-o", "--fuse-arg", "debug",
    "--gateway-arg", "--log-level=debug",
    "--plaintext-prefix", "/Users/me/Downloads"
  ])
  #expect(res.options.fuseArgs == ["-o", "debug"])
  #expect(res.options.gatewayArgs == ["--log-level=debug"])
  #expect(res.options.plaintextPrefixes == ["/Users/me/Downloads"])
}

@Test func unknownFlagErrors() {
  #expect(throws: CLIError.unknownFlag("--nope")) {
    _ = try CLI.parse(["--nope"])
  }
}
