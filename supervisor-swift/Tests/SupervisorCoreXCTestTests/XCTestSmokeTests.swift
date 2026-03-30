#if canImport(XCTest)
import XCTest
@testable import SupervisorCore

final class XCTestSmokeTests: XCTestCase {
  func testHelpTextMentionsPrimaryFlags() {
    let t = CLI.helpText(program: "ocprotectfs-supervisor")
    XCTAssertTrue(t.contains("--help"))
    XCTAssertTrue(t.contains("--version"))
    XCTAssertTrue(t.contains("--config"))
    XCTAssertTrue(t.contains("--mount"))
    XCTAssertTrue(t.contains("--unmount"))
    XCTAssertTrue(t.contains("--status"))
  }
}
#endif
