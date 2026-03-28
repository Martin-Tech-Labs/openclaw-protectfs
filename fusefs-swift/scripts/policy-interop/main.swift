import Foundation

// Tiny helper compiled by JS tests to exercise Policy.swift without XCTest.

func die(_ msg: String) -> Never {
  FileHandle.standardError.write(Data((msg + "\n").utf8))
  exit(2)
}

enum Cmd: String {
  case normalize
  case classify
}

guard CommandLine.arguments.count >= 3 else {
  die("usage: policy-interop <normalize|classify> <rel>")
}

guard let cmd = Cmd(rawValue: CommandLine.arguments[1]) else {
  die("unknown command")
}

let rel = CommandLine.arguments[2]

do {
  switch cmd {
    case .normalize:
      let out = try Policy.assertSafeRelative(rel)
      print(out)

    case .classify:
      let c = try Policy.classifyPath(rel)
      let enc = JSONEncoder()
      enc.outputFormatting = [.sortedKeys]
      let data = try enc.encode(c)
      print(String(decoding: data, as: UTF8.self))
  }
} catch let e as PolicyError {
  die(e.description)
} catch {
  die(String(describing: error))
}
