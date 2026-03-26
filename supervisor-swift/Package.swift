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
    // Use Swift Testing instead of XCTest so CI/dev doesn't require a full Xcode install.
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
    )
  ]
)
