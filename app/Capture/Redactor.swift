import Foundation

/// Masks text for the diagnostics file (SCR-42): every letter becomes x (X for a capital) and every
/// digit 0, so the shape stays (lengths, punctuation, spaces, emoji, "Xxxx: 00:00") but not the words.
/// Words apps use in their own labels ("message", "from", "Received", month names) are kept whole,
/// since they are what a profile is written against; they say nothing about you on their own.
enum Redactor {
    /// Didja's own words in what it writes ("⟦Chat message: … (direct) — from me⟧", "[open]").
    static let didjaWords: Set<String> = ["direct", "group", "unknown", "page", "email", "open", "done", "dismissed",
                                          "snoozed", "reacted", "waiting", "ticked", "looks", "me"]

    static func text(_ s: String) -> String {
        var out = ""
        var word = ""
        func flush() {
            let lower = word.lowercased()
            out += AXOutline.uiWords.contains(lower) || didjaWords.contains(lower) ? word : mask(word)
            word = ""
        }
        for ch in s {
            if ch.isLetter { word.append(ch) } else { flush(); out += mask(String(ch)) }
        }
        flush()
        return out
    }

    private static func mask(_ s: String) -> String {
        String(s.map { ch -> Character in
            if ch.isNumber { return "0" }
            if ch.isLetter { return ch.isUppercase ? "X" : "x" }
            return ch
        })
    }

    /// An element id or DOM id: kept, since profiles match on them, but with its digits as 0 and
    /// any long run of letters and digits (a user or thread id) masked.
    static func identifier(_ s: String) -> String {
        var out = ""
        var token = ""
        func flush() {
            if token.count >= 12, token.contains(where: \.isNumber), token.contains(where: \.isLetter) {
                out += String(repeating: "x", count: token.count)
            } else {
                out += String(token.map { $0.isNumber ? "0" : $0 })
            }
            token = ""
        }
        for ch in s {
            if ch.isLetter || ch.isNumber { token.append(ch) } else { flush(); out.append(ch) }
        }
        flush()
        return out
    }

    /// A web address: its scheme and site kept (a profile may match the site), the rest masked.
    static func url(_ s: String) -> String {
        guard let url = URL(string: s), let scheme = url.scheme, let host = url.host else { return text(s) }
        let start = "\(scheme)://\(host)"
        guard s.hasPrefix(start) else { return text(s) }
        return start + text(String(s.dropFirst(start.count)))
    }

    /// One outline line's values masked: text values by `text`, ids by `identifier`, the address
    /// by `url`. Role and class names stay.
    static func outline(_ element: OutlineElement, depth: Int = 0) -> String {
        element.outline(depth: depth, transform: { key, value in
            switch key {
            case "id", "dom": identifier(value)
            case "class": value
            case "url": url(value)
            default: text(value)
            }
        })
    }
}
