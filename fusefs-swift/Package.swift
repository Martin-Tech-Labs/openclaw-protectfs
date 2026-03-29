// swift-tools-version: 5.9
import Foundation
import PackageDescription

// Keep CI able to run unit tests without macFUSE installed.
// SwiftPM's `swift test` on GitHub-hosted macOS runners may attempt to build
// *all* targets, including the FUSE daemon executable, which links against
// libfuse (macFUSE). Since runners don't ship with that library, we make the
// executable targets opt-in via env var.
//
// Set `OCPROTECTFS_CI_BUILD_FUSEFS_SWIFT=1` (or `OCPROTECTFS_BUILD_FUSEFS_SWIFT=1`)
// to include the full daemon targets/products in the package graph.
let buildFuseDaemon = {
  let env = ProcessInfo.processInfo.environment
  return env["OCPROTECTFS_BUILD_FUSEFS_SWIFT"] == "1" || env["OCPROTECTFS_CI_BUILD_FUSEFS_SWIFT"] == "1"
}()

var products: [Product] = [
  .library(name: "ocprotectfs-fuse-core", targets: ["OcProtectFsFuseCore"])
]

var targets: [Target] = [
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
  )
]

if buildFuseDaemon {
  products.append(.executable(name: "ocprotectfs-fuse", targets: ["OcProtectFsFuse"]))

  targets.append(contentsOf: [
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
  ])
}

let package = Package(
  name: "ocprotectfs-fuse",
  platforms: [
    .macOS(.v13)
  ],
  products: products,
  dependencies: [
    // Use Swift Testing instead of XCTest so CI/dev doesn't require a full Xcode install.
    .package(url: "https://github.com/apple/swift-testing.git", from: "0.12.0")
  ],
  targets: targets
)
