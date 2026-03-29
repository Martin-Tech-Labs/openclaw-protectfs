import Testing
@testable import OcProtectFsFuseCore
import Darwin

@Test func authorizeOpAllowsPlaintextWithoutGateway() throws {
  let res = Core.authorizeOp(
    op: .read,
    rel: "workspace/notes.txt",
    env: [:],
    gatewayAccessAllowed: false
  )

  #expect(res.ok == true)
  #expect(res.code == 0)
}

@Test func authorizeOpDeniesEncryptedWhenGatewayNotAllowed() throws {
  let res = Core.authorizeOp(
    op: .read,
    rel: "secrets/notes.txt",
    env: [:],
    gatewayAccessAllowed: false
  )

  #expect(res.ok == false)
  #expect(res.code == EACCES)
}

@Test func authorizeOpAllowsEncryptedWhenGatewayAllowed() throws {
  let res = Core.authorizeOp(
    op: .read,
    rel: "secrets/notes.txt",
    env: [:],
    gatewayAccessAllowed: true
  )

  #expect(res.ok == true)
  #expect(res.code == 0)
}
