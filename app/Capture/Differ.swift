import Foundation

/// Remembers each window's recent lines and reports only the lines that are
/// new, so the same text is not stored over and over.
///
/// A line counts as seen while it is on screen and for `memory` after it left
/// (SCR-72): scrolling away and back, a terminal re-wrap or a list re-render
/// does not report it again. After that it is new again.
struct Differ {
    private struct Snapshot {
        var hash: Int
        var lines: Set<String>
        /// Lines no longer on screen, with when they left.
        var gone: [String: Date] = [:]
    }

    /// How long a line that left the screen is still remembered.
    static let memory: TimeInterval = 10 * 60
    /// At most this many departed lines are remembered per window; the oldest go first.
    static let maxGone = 4000

    private var snapshots: [String: Snapshot] = [:]
    /// Least recently used first.
    private var order: [String] = []
    private let capacity: Int

    init(capacity: Int = 64) {
        self.capacity = capacity
    }

    /// Lines of `lines` that were not in this window's recent snapshots, in
    /// order and without repeats. Updates the snapshot.
    ///
    /// A line is the same line only within its section and only as the same
    /// occurrence (SCR-63): the second "Done" in a window, or "Done" under a new
    /// chat message, is new even though "Done" is already on screen, and a
    /// command typed again after its output (a re-run) is new too.
    mutating func newLines(windowKey: String, lines: [String], now: Date = Date()) -> [String] {
        var hasher = Hasher()
        lines.forEach { hasher.combine($0) }
        let hash = hasher.finalize()

        touch(windowKey)
        let previous = snapshots[windowKey]
        if let previous, previous.hash == hash { return [] }
        let gone = previous.map { Self.departed(from: $0, now: now) } ?? [:]

        var keys = Set<String>()
        var counts: [String: Int] = [:]
        var reported = Set<String>()
        var fresh: [String] = []
        // A new line is reported together with the section line it sits under
        // (see AXCapture.sectionLine), even if that section was seen before, so
        // the reader always knows which message a line belongs to.
        var section: String?
        var sectionReported = false
        for line in lines {
            if line.first == AXCapture.sectionOpen {
                section = line
                sectionReported = false
                continue
            }
            let unit = Self.unit(section: section, line: line)
            let occurrence = (counts[unit] ?? 0) + 1
            counts[unit] = occurrence
            let key = "\(unit)\u{1F}\(occurrence)"
            keys.insert(key)
            // Already seen as this occurrence, or already reported in this batch: not news.
            guard previous?.lines.contains(key) != true, gone[key] == nil, reported.insert(unit).inserted else { continue }
            if let section, !sectionReported {
                fresh.append(section)
                sectionReported = true
            }
            fresh.append(line)
        }
        var remembered = gone
        for key in keys { remembered[key] = nil }
        snapshots[windowKey] = Snapshot(hash: hash, lines: keys, gone: remembered)
        return fresh
    }

    /// The lines remembered from before: those that left earlier and still count,
    /// and those on screen last time (leaving now).
    private static func departed(from snapshot: Snapshot, now: Date) -> [String: Date] {
        var gone = snapshot.gone.filter { now.timeIntervalSince($0.value) < memory }
        for key in snapshot.lines { gone[key] = now }
        if gone.count > maxGone {
            for (key, _) in gone.sorted(by: { $0.value < $1.value }).prefix(gone.count - maxGone) { gone[key] = nil }
        }
        return gone
    }

    /// What makes a line the same line: its text, under the section it sits in.
    private static func unit(section: String?, line: String) -> String {
        "\(section ?? "")\u{1F}\(line)"
    }

    private mutating func touch(_ key: String) {
        order.removeAll { $0 == key }
        order.append(key)
        while order.count > capacity {
            snapshots[order.removeFirst()] = nil
        }
    }

    /// Identifies a window across captures: the app plus its page (for web
    /// content, query and fragment dropped) or its title without the parts that
    /// change while it is the same window: a spinner or unread dot in front, an
    /// unread count, "— Edited" (SCR-72). Written on every observation as
    /// `window_key`; the engine's `windowKeyFor` is the same rule, tested on the
    /// same cases.
    static func windowKey(bundleID: String, title: String, url: String?) -> String {
        if let url, let page = url.split(whereSeparator: { $0 == "?" || $0 == "#" }).first, !url.hasPrefix("?"), !url.hasPrefix("#") {
            return "\(bundleID)|\(page)"
        }
        return "\(bundleID)|\(stableTitle(title))"
    }

    private static let leading = try! NSRegularExpression(pattern: #"^(?:\s|\([0-9]+\)|[^\p{L}\p{N}])+"#)
    private static let trailing = try! NSRegularExpression(pattern: #"(?:\s*[—–-]\s*edited|\s*\([0-9]+\)|\s)+$"#,
                                                           options: .caseInsensitive)

    /// A window title without decorations that come and go: see `windowKey`.
    static func stableTitle(_ title: String) -> String {
        var text = title
        for pattern in [leading, trailing] {
            let range = NSRange(text.startIndex..., in: text)
            text = pattern.stringByReplacingMatches(in: text, range: range, withTemplate: "")
        }
        return text
    }
}
