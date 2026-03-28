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
  targets: [
    .target(
      name: "OcProtectFsFuseCore",
      path: "Sources/OcProtectFsFuseCore"
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
