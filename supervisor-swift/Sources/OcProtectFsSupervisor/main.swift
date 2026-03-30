import Foundation
import SupervisorCore

let argv = Array(CommandLine.arguments.dropFirst())

func stderr(_ s: String) {
  FileHandle.standardError.write((s + "\n").data(using: .utf8)!)
}

let program = (CommandLine.arguments.first as NSString?)?.lastPathComponent ?? "ocprotectfs-supervisor"

do {
  let res = try CLI.parse(argv)
  if res.showHelp {
    print(CLI.helpText(program: program))
    exit(0)
  }
  if res.showVersion {
    // Phase 1: no release versioning yet; keep this stable for scripts.
    print("\(program) phase-1")
    exit(0)
  }

  _ = res.configPath // reserved for follow-up issue: config file support.

  func log(_ msg: String) {
    let ts = ISO8601DateFormatter().string(from: Date())
    stderr("\(ts) \(msg)")
  }

  switch res.action {
  case .run:
    let sup = Supervisor(log: log)
    let cfg = SupervisorConfig(options: res.options)
    let code = sup.run(cfg)
    exit(code.rawValue)

  case .mount:
    stderr("\(program): mount action not implemented yet (phase 2 focuses on run lifecycle)")
    exit(ExitCode.config.rawValue)

  case .unmount:
    stderr("\(program): unmount action not implemented yet (phase 2 focuses on run lifecycle)")
    exit(ExitCode.config.rawValue)

  case .status:
    stderr("\(program): status action not implemented yet (phase 2 focuses on run lifecycle)")
    exit(ExitCode.config.rawValue)
  }
} catch let e as CLIError {
  stderr(e.description)
  stderr("")
  stderr(CLI.helpText(program: program))
  exit(ExitCode.config.rawValue)
} catch {
  stderr("Unexpected error: \(error)")
  exit(1)
}
