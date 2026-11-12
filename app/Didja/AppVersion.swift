import Foundation

/// The app's version as people see it (SCR-44): "Didja 0.4.1 (5)", the marketing version and
/// the build. Shown at the bottom of the Quick View's "…" menu and in Settings › General.
enum AppVersion {
    static func label(_ info: [String: Any]?) -> String {
        let version = info?["CFBundleShortVersionString"] as? String ?? ""
        let build = info?["CFBundleVersion"] as? String ?? ""
        switch (version.isEmpty, build.isEmpty) {
        case (false, false): return "Didja \(version) (\(build))"
        case (false, true): return "Didja \(version)"
        case (true, false): return "Didja (\(build))"
        case (true, true): return "Didja"
        }
    }

    static var current: String { label(Bundle.main.infoDictionary) }
}
