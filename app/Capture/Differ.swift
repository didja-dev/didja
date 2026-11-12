import Foundation

/// Remembers each window's last snapshot and reports only the lines that are
/// new since then, so the same text is not stored over and over.
struct Differ {
    private struct Snapshot {
        var hash: Int
        var lines: Set<String>
    }

    private var snapshots: [String: Snapshot] = [:]
    /// Least recently used first.
    private var order: [String] = []
    private let capacity: Int

    init(capacity: Int = 64) {
        self.capacity = capacity
    }

    /// Lines of `lines` that were not in this window's previous snapshot, in
    /// order and without repeats. Updates the snapshot.
    mutating func newLines(windowKey: String, lines: [String]) -> [String] {
        var hasher = Hasher()
        lines.forEach { hasher.combine($0) }
        let hash = hasher.finalize()

        touch(windowKey)
        let previous = snapshots[windowKey]
        if let previous, previous.hash == hash { return [] }

        var seen = Set<String>()
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
                seen.insert(line)
                continue
            }
            guard seen.insert(line).inserted, previous?.lines.contains(line) != true else { continue }
            if let section, !sectionReported {
                fresh.append(section)
                sectionReported = true
            }
            fresh.append(line)
        }
        snapshots[windowKey] = Snapshot(hash: hash, lines: seen)
        return fresh
    }

    private mutating func touch(_ key: String) {
        order.removeAll { $0 == key }
        order.append(key)
        while order.count > capacity {
            snapshots[order.removeFirst()] = nil
        }
    }

    /// Identifies a window across captures: the app plus its page (for web
    /// content) or its title. Query strings and decorative title prefixes
    /// (spinners, unread dots) are ignored so they don't look like new windows.
    static func windowKey(bundleID: String, title: String, url: String?) -> String {
        if let url, var parts = URLComponents(string: url) {
            parts.query = nil
            parts.fragment = nil
            if let page = parts.string, !page.isEmpty { return "\(bundleID)|\(page)" }
        }
        let stable = title.drop { !$0.isLetter && !$0.isNumber }
        return "\(bundleID)|\(stable)"
    }
}
