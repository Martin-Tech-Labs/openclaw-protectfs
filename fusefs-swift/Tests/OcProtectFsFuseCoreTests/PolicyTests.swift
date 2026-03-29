import Testing
@testable import OcProtectFsFuseCore

@Test func assertSafeRelativeRejectsAbsolutePath() {
  #expect(throws: PolicyError.absolutePathNotAllowed) {
    _ = try Policy.assertSafeRelative("/etc/passwd")
  }
}

@Test func assertSafeRelativeRejectsBackslash() {
  #expect(throws: PolicyError.backslashNotAllowed) {
    _ = try Policy.assertSafeRelative("a\\b")
  }
}

@Test func assertSafeRelativeRejectsTraversalAfterNormalization() {
  #expect(throws: PolicyError.traversalNotAllowed) {
    _ = try Policy.assertSafeRelative("../a")
  }

  #expect(throws: PolicyError.traversalNotAllowed) {
    _ = try Policy.assertSafeRelative("a/../../b")
  }
}

@Test func assertSafeRelativeNormalizesDotAndSlashes() throws {
  #expect(try Policy.assertSafeRelative("") == ".")
  #expect(try Policy.assertSafeRelative(".") == ".")
  #expect(try Policy.assertSafeRelative("a//b/./c") == "a/b/c")
  #expect(try Policy.assertSafeRelative("a/..") == ".")
}

@Test func isPlaintextPathUsesFirstSegment() throws {
  #expect(try Policy.isPlaintextPath("workspace/file.txt") == true)
  #expect(try Policy.isPlaintextPath("workspaces/file.txt") == false)
}

@Test func normalizePlaintextPrefixesDedupesAndRejectsInvalid() throws {
  let prefixes = try Policy.normalizePlaintextPrefixes([" workspace ", "workspace", "tmp"])!
  #expect(prefixes == ["workspace", "tmp"])

  #expect(throws: PolicyError.plaintextPrefixMustBeSingleSegment) {
    _ = try Policy.normalizePlaintextPrefixes(["a/b"])
  }
}
