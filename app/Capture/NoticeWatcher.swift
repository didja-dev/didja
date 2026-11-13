import Foundation

/// Short notices an app announces and then takes away: "Message sent", "Saved", "Merged",
/// "Request approved" (SCR-68).
///
/// Apps post them as an accessibility announcement, or put them in a live region (web pages). They
/// can be gone before the next capture, so capture hears them as they come, keeps them in memory
/// for a few seconds, and writes each one into the window's next observation as
/// "⟦Notice: Message sent⟧", after the same exclude-list checks as any other text. Nothing else is
/// kept: no new kind of storage, and a notice is text like the rest.
struct NoticeWatcher {
    /// A notice is one short line: at most this many characters and words.
    static let maxChars = 80
    static let maxWords = 12
    /// The same notice in the same window within this many seconds is written once.
    static let repeatWindow: TimeInterval = 60
    /// A notice heard longer ago than this is dropped unread.
    static let maxAge: TimeInterval = 10

    /// The notice in an announcement's text or a live region's lines, cleaned; nil when it is not
    /// a short notice (a whole new chat message in a live region, say).
    static func notice(from lines: [String]) -> String? {
        let kept = lines.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        guard (1...2).contains(kept.count) else { return nil }
        let text = kept.joined(separator: " ").split(whereSeparator: \.isWhitespace).joined(separator: " ")
        guard text.count >= 3, text.count <= maxChars,
              text.split(separator: " ").count <= maxWords,
              text.contains(where: \.isLetter),
              !text.contains("⟦"), !text.contains("⟧")
        else { return nil }
        return text
    }

    static func notice(from text: String) -> String? {
        notice(from: text.split(whereSeparator: \.isNewline).map(String.init))
    }

    /// The line written to the observation.
    static func line(_ notice: String) -> String { "⟦Notice: \(notice)⟧" }

    private var seen: [String: [String: Date]] = [:]

    /// The notices worth writing for a window now: each once, not again within `repeatWindow`.
    mutating func fresh(windowKey: String, notices: [String], now: Date = Date()) -> [String] {
        var window = seen[windowKey, default: [:]].filter { now.timeIntervalSince($0.value) < Self.repeatWindow }
        var out: [String] = []
        for notice in notices where window[notice] == nil && !out.contains(notice) {
            window[notice] = now
            out.append(notice)
        }
        seen[windowKey] = window
        if seen.count > 40 {
            seen = seen.filter { !$0.value.isEmpty }
        }
        return out
    }
}
