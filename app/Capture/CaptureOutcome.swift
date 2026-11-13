import ApplicationServices
import Foundation

/// What happened when capture tried the app in front (SCR-79), as a code for the troubleshooting
/// report: read, no window, an empty accessibility tree, excluded, paused… Recorded with a line
/// count and the app's name, never the lines or the window's title (`capture_outcomes`, schema 28).
enum CaptureOutcome: Equatable {
    case ok(lines: Int)
    case ocrUsed(lines: Int)
    case noFocusedWindow
    /// The app answered the question for its window with an error (its AXError code).
    case axError(Int32)
    case axTreeEmpty
    /// An Electron app whose tree stayed empty after Didja asked it to switch accessibility on.
    case electronSwitchFailed
    /// Too little text through Accessibility, and the OCR fallback is on but has no Screen Recording.
    case ocrDenied
    case excluded
    case paused
    case notTrusted

    /// The code stored in `capture_outcomes.result` and read by `didja doctor`.
    var code: String {
        switch self {
        case .ok: return "ok"
        case .ocrUsed: return "ocr-used"
        case .noFocusedWindow: return "no-focused-window"
        case .axError(let error): return "ax-error \(error)"
        case .axTreeEmpty: return "ax-tree-empty"
        case .electronSwitchFailed: return "electron-switch-failed"
        case .ocrDenied: return "ocr-denied"
        case .excluded: return "excluded"
        case .paused: return "paused"
        case .notTrusted: return "not-trusted"
        }
    }

    var lines: Int {
        switch self {
        case .ok(let n), .ocrUsed(let n): return n
        default: return 0
        }
    }

    /// The outcome of a read, from counts only.
    static func afterRead(lines: Int, chars: Int, usedOCR: Bool, isElectron: Bool,
                          ocrEnabled: Bool, ocrPermitted: Bool) -> CaptureOutcome {
        if usedOCR { return .ocrUsed(lines: lines) }
        guard chars == 0 else { return .ok(lines: lines) }
        if isElectron { return .electronSwitchFailed }
        return ocrEnabled && !ocrPermitted ? .ocrDenied : .axTreeEmpty
    }

    /// Why an app gave no focused window: no window at all, or an error answering.
    static func noWindow(_ error: AXError) -> CaptureOutcome {
        switch error {
        case .success, .noValue, .attributeUnsupported: return .noFocusedWindow
        default: return .axError(error.rawValue)
        }
    }

    /// Whether the app at `url` is built on Electron (its tree is empty until it is asked to switch
    /// accessibility on).
    static func isElectron(_ url: URL?) -> Bool {
        guard let url else { return false }
        let framework = url.appendingPathComponent("Contents/Frameworks/Electron Framework.framework")
        return FileManager.default.fileExists(atPath: framework.path)
    }
}
