import CoreGraphics
import ScreenCaptureKit
import Vision

/// Fallback capture source, for windows whose accessibility tree has little
/// or no text. Grabs one frame of the window, reads it with Vision, and lets
/// the image go: nothing is written to disk and nothing outlives this call.
enum OCRCapture {
    /// OCR needs Screen Recording permission. Without it the fallback is simply off.
    static var isPermitted: Bool { CGPreflightScreenCaptureAccess() }

    static let enabledKey = "ocrFallbackEnabled"

    /// Your switch for the fallback, in Settings › General (SCR-41). On unless you turn it off.
    /// Off, ScreenCaptureKit is never called, so macOS's "bypass the private window picker"
    /// reminder never comes up for Didja, even with Screen Recording granted.
    static var isEnabled: Bool {
        get { UserDefaults.standard.object(forKey: enabledKey) as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: enabledKey) }
    }

    /// Whether this capture reads the window from its pixels. Only a window whose Accessibility
    /// text is nearly empty, only with the permission and your switch on, and at most once per
    /// `minInterval`. Nothing else in Didja touches ScreenCaptureKit, at launch or otherwise.
    static func shouldRun(axChars: Int, permitted: Bool, enabled: Bool, sinceLast: TimeInterval,
                          minChars: Int = 40, minInterval: TimeInterval = 10) -> Bool {
        enabled && permitted && axChars < minChars && sinceLast >= minInterval
    }

    /// Shows the system prompt for Screen Recording (once), or does nothing if already decided.
    static func requestPermission() {
        CGRequestScreenCaptureAccess()
    }

    /// Which of an app's on-screen windows is the one you are in, given the
    /// focused window's title: the window with that title, or, only when the
    /// app shows a single window, that one. Never a guess between several:
    /// another window may be one the exclude list keeps out (a private
    /// browser window, say), and only the focused window's title was checked.
    /// The chosen window's own title must also pass `allows`.
    static func pick(titles: [String?], focusedTitle: String, allows: (String) -> Bool) -> Int? {
        let index: Int?
        if let match = titles.firstIndex(where: { $0 == focusedTitle }) {
            index = match
        } else if titles.count == 1 {
            index = 0
        } else {
            index = nil
        }
        guard let index, allows(titles[index] ?? "") else { return nil }
        return index
    }

    /// Text of the given app's window, top to bottom. Empty if it can't be read.
    /// `allows` is the exclude list's window check, applied to the window that would be read.
    static func recognizeText(pid: pid_t, windowTitle: String, allows: (String) -> Bool) async -> [String] {
        guard isEnabled, isPermitted,
              let content = try? await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        else { return [] }

        let windows = content.windows.filter {
            $0.owningApplication?.processID == pid && $0.windowLayer == 0
                && $0.frame.width > 100 && $0.frame.height > 100
        }
        guard let index = pick(titles: windows.map(\.title), focusedTitle: windowTitle, allows: allows)
        else { return [] }
        let window = windows[index]

        let filter = SCContentFilter(desktopIndependentWindow: window)
        let config = SCStreamConfiguration()
        let scale = CGFloat(filter.pointPixelScale)
        config.width = Int(window.frame.width * scale)
        config.height = Int(window.frame.height * scale)
        config.showsCursor = false

        guard let image = try? await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
        else { return [] }
        return recognizeLines(in: image)
        // `image` is released here. It was never written anywhere.
    }

    static func recognizeLines(in image: CGImage) -> [String] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        guard (try? VNImageRequestHandler(cgImage: image, options: [:]).perform([request])) != nil else { return [] }

        // Vision's origin is bottom-left: higher maxY is nearer the top.
        let rows = (request.results ?? []).sorted {
            if abs($0.boundingBox.midY - $1.boundingBox.midY) > 0.005 {
                return $0.boundingBox.midY > $1.boundingBox.midY
            }
            return $0.boundingBox.minX < $1.boundingBox.minX
        }
        return rows.compactMap { $0.topCandidates(1).first?.string }
    }
}
