// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "ocprotectfs-fuse",
  platforms: [
    .macOS(.v13)
  ],
  products: [
    .executable(name: "ocprotectfs-fuse", targets: ["OcProtectFsFuse"])
  ],
  targets: [
    .executableTarget(
      name: "OcProtectFsFuse",
      path: "Sources/OcProtectFsFuse"
    )
  ]
)
