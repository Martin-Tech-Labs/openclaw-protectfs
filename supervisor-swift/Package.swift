// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "ocprotectfs-supervisor",
  platforms: [
    .macOS(.v13)
  ],
  products: [
    .executable(name: "ocprotectfs-supervisor", targets: ["OcProtectFsSupervisor"])
  ],
  dependencies: [
    // Swift Testing works with just the Swift toolchain (no full Xcode required).
    .package(url: "https://github.com/apple/swift-testing.git", from: "0.12.0")
  ],
  targets: [
    .target(
      name: "SupervisorCore"
    ),
    .executableTarget(
      name: "OcProtectFsSupervisor",
      dependencies: ["SupervisorCore"]
    ),
    .testTarget(
      name: "SupervisorCoreTests",
      dependencies: [
        "SupervisorCore",
        .product(name: "Testing", package: "swift-testing")
      ]
    ),
    // XCTest-based harness (requested in #112).
    // On machines without XCTest available in the Swift toolchain, this target compiles to a no-op
    // via `#if canImport(XCTest)` guards, but CI macOS runners will execute it.
    .testTarget(
      name: "SupervisorCoreXCTestTests",
      dependencies: [
        "SupervisorCore"
      ]
    )
  ]
)
