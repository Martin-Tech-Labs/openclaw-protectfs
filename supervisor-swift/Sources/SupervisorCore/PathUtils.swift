import Foundation

public enum PathUtils {
  public static func expandTilde(_ s: String) -> String {
    if s.hasPrefix("~") {
      return (s as NSString).expandingTildeInPath
    }
    return s
  }

  public static func resolveAbsolute(_ s: String) -> String {
    let expanded = expandTilde(s)
    return URL(fileURLWithPath: expanded).standardizedFileURL.path
  }
}
