import AppKit
import ApplicationServices

/// For building capture adapters: the shape of an app's front window, read only, with every letter
/// and digit masked so no content is shown. Roles, subroles, identifiers and web classes are kept.
/// `Didja --ax-outline <bundle id> [file]`. Nothing is brought forward, pressed or scrolled.
enum AXOutline {
    /// Letters become x (Hebrew h), digits 9; punctuation, spaces and emoji stay, so shapes such as
    /// "xxxx: xxx" or "99:99" show without the words.
    /// Words apps use in their own labels, shown unmasked so labels can be parsed. Never content alone.
    static let uiWords: Set<String> = [
        "message", "messages", "from", "your", "you", "sent", "received", "delivered", "read", "seen", "at", "in",
        "chat", "chats", "with", "today", "yesterday", "reply", "replied", "replies", "forwarded", "mentioned",
        "mention", "edited", "group", "to", "by", "and", "of", "on", "the", "a", "an", "thread", "unread",
        "pinned", "reaction", "reactions", "january", "february", "march", "april", "may", "june", "july",
        "august", "september", "october", "november", "december", "monday", "tuesday", "wednesday", "thursday",
        "friday", "saturday", "sunday", "am", "pm", "said", "says", "new", "more", "type", "send", "posted",
        "terminal", "chat", "copilot", "claude", "agent", "ask", "edit", "input", "question", "accept", "allow",
        "yes", "no", "continue", "cancel", "y", "n", "press", "enter", "panel", "editor", "explorer", "status",
        "react", "reacted", "like", "likes", "love", "heart", "celebrate", "laugh", "surprised", "sad", "thumbs", "up",
        "other", "others", "people", "person", "reactions", "you've", "liked", "haha", "wow", "only", "yours",
        "mine", "data", "one", "two", "selected", "button", "add", "remove", "show", "list", "see", "all", "who",
    ]

    static func mask(_ text: String) -> String {
        // Keep whole known UI words; mask every other word letter by letter.
        var out = ""
        var word = ""
        func flush() {
            if uiWords.contains(word.lowercased()) { out += word } else { out += maskLetters(word) }
            word = ""
        }
        for ch in text {
            if ch.isLetter { word.append(ch) } else { flush(); out += maskLetters(String(ch)) }
        }
        flush()
        return out
    }

    private static func maskLetters(_ text: String) -> String {
        String(text.unicodeScalars.map { scalar -> Character in
            if CharacterSet.decimalDigits.contains(scalar) { return "9" }
            if (0x0590...0x05FF).contains(scalar.value) { return "h" }
            if CharacterSet.letters.contains(scalar) { return "x" }
            return Character(scalar)
        })
    }

    /// The lines capture would keep from the app's front window, masked. Read only.
    static func lines(bundleID: String) -> String {
        guard let running = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first else {
            return "not running\n"
        }
        AXCapture.prepare(pid: running.processIdentifier, bundleID: bundleID)
        guard let (window, title) = AXCapture.focusedWindow(pid: running.processIdentifier) else { return "no window\n" }
        var limits = AXCapture.Limits()
        limits.skipFocusedInput = true
        limits.app = bundleID
        let text = AXCapture.read(window: window, title: title, appName: running.localizedName ?? "", limits: limits)
        return text.lines.map(mask).joined(separator: "\n") + "\n"
    }

    static func outline(bundleID: String, maxNodes: Int = 6_000) -> String {
        guard let running = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first else {
            return "not running\n"
        }
        AXCapture.prepare(pid: running.processIdentifier, bundleID: bundleID)
        guard let (window, _) = AXCapture.focusedWindow(pid: running.processIdentifier) else { return "no window\n" }
        return AXCapture.withLargeStack {
            var out = ""
            var budget = maxNodes
            func attr(_ e: AXUIElement, _ n: String) -> AnyObject? {
                var v: AnyObject?
                return AXUIElementCopyAttributeValue(e, n as CFString, &v) == .success ? v : nil
            }
            func walk(_ e: AXUIElement, _ depth: Int) {
                guard depth <= 80, budget > 0 else { return }
                budget -= 1
                let role = attr(e, "AXRole") as? String ?? "?"
                let sub = attr(e, "AXSubrole") as? String ?? ""
                if PrivacyPolicy.isSecureField(role: role, subrole: sub) { out += String(repeating: " ", count: depth) + "SECURE\n"; return }
                var parts = [role + (sub.isEmpty ? "" : "/\(sub)")]
                if let id = attr(e, "AXIdentifier") as? String, !id.isEmpty { parts.append("id=\(id.prefix(60))") }
                if let dom = attr(e, "AXDOMIdentifier") as? String, !dom.isEmpty { parts.append("dom=\(dom.prefix(60))") }
                if let classes = attr(e, "AXDOMClassList") as? [String], !classes.isEmpty {
                    parts.append("class=\(classes.prefix(4).joined(separator: ".").prefix(80))")
                }
                for name in ["AXTitle", "AXValue", "AXDescription", "AXHelp", "AXPlaceholderValue"] {
                    if let s = attr(e, name) as? String, !s.isEmpty {
                        parts.append("\(name.dropFirst(2).lowercased())=\"\(mask(String(s.prefix(90))))\"")
                    }
                }
                if let selected = attr(e, "AXSelected") as? Bool, selected { parts.append("selected") }
                out += String(repeating: " ", count: depth) + parts.joined(separator: " ") + "\n"
                for child in (attr(e, "AXChildren") as? [AXUIElement]) ?? [] { walk(child, depth + 1) }
            }
            walk(window, 0)
            return out
        }
    }
}
