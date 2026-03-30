import Foundation

public enum ExitCode: Int32 {
  case ok = 0
  case config = 2
  case prepareFs = 3
  case liveness = 4
  case migration = 5

  case fuseStart = 10
  case gatewayStart = 11
  case fuseNotReady = 12

  case fuseDied = 20
  case gatewayDied = 21

  case shutdown = 30
}
