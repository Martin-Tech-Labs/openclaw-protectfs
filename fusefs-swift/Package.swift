// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "ocprotectfs-fuse",
  platforms: [
    .macOS(.v13)
  ],
  products: [
    .library(name: "ocprotectfs-fuse-core", targets: ["OcProtectFsFuseCore"]),
    .executable(name: "ocprotectfs-fuse", targets: ["OcProtectFsFuse"])
  ],
  dependencies: [
    // Use Swift Testing instead of XCTest so CI/dev doesn't require a full Xcode install.
    .package(url: "https://github.com/apple/swift-testing.git", from: "0.12.0")
  ],
  targets: [
    .target(
      name: "OcProtectFsFuseCore",
      path: "Sources/OcProtectFsFuseCore"
    ),

    .testTarget(
      name: "OcProtectFsFuseCoreTests",
      dependencies: [
        "OcProtectFsFuseCore",
        .product(name: "Testing", package: "swift-testing")
      ],
      path: "Tests/OcProtectFsFuseCoreTests"
    ),

    // System libfuse (macFUSE) headers + linker shim.
    .systemLibrary(
      name: "CFuse",
      path: "Sources/CFuse"
    ),

    .executableTarget(
      name: "OcProtectFsFuse",
      dependencies: ["OcProtectFsFuseCore", "CFuse"],
      path: "Sources/OcProtectFsFuse"
    )
  ]
)
