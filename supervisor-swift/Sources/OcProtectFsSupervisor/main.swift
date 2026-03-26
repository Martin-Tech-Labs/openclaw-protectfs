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

  // Phase 1: parsing-only scaffold. Real lifecycle + Keychain work is tracked in follow-up issues.
  stderr("\(program): phase 1 scaffold (parsing only).")
  exit(0)
} catch let e as CLIError {
  stderr(e.description)
  stderr("")
  stderr(CLI.helpText(program: program))
  exit(2)
} catch {
  stderr("Unexpected error: \(error)")
  exit(1)
}
