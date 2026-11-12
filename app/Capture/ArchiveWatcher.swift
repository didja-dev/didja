import Foundation

/// Notices that the email you had open was archived.
///
/// A mail app says so itself: Outlook shows "Archived" for a few seconds, Gmail
/// "Conversation archived". That notice alone does not say which email, and an
/// email leaving the reading pane alone does not say it was archived (you may
/// have clicked another). Together they do. As recorded in Outlook, the email
/// leaves the pane first (the next one takes its place) and the notice shows up
/// to a second later. So: when the notice appears, the email that most recently
/// left the pane, if it left only a moment ago, is the one that was archived.
///
/// Archiving several in a row keeps the notice up, and then nothing is
/// reported for the later ones. That is the safe way to be wrong.
struct ArchiveWatcher {
    /// How long before the notice appears the email may have left.
    /// Captures are a second or more apart, so this has to cover two of them.
    static let window: TimeInterval = 4

    private struct State {
        var emails: Set<String>
        var notice: Bool
        /// The emails that most recently left the pane together, and when.
        var departed: (subjects: [String], at: Date)?
        var seen: Date
    }

    private var states: [String: State] = [:]
    /// True after a snapshot in which an email left with no notice yet: the
    /// notice may be about to appear, so the window is worth another look soon.
    private(set) var wantsAnotherLook = false
    /// When to look again, in seconds, after `wantsAnotherLook`.
    static let quickLooks: [TimeInterval] = [0.3, 0.6, 0.9, 1.2, 1.6, 2.2, 2.8]

    /// The notice a mail app shows after archiving, as a line of its own.
    static func isNotice(_ line: String) -> Bool {
        let text = line.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: ".")))
            .lowercased()
        return ["archived", "conversation archived", "message archived", "email archived",
                "conversation archived undo", "archived undo"].contains(text)
    }

    /// "⟦Email 2: Q3 numbers⟧" → "Q3 numbers". Nil for any other line.
    static func subject(ofSection line: String) -> String? {
        guard line.hasPrefix("⟦Email"), line.hasSuffix("⟧"), let colon = line.range(of: ": ") else { return nil }
        let subject = line[colon.upperBound...].dropLast().trimmingCharacters(in: .whitespaces)
        return subject.isEmpty ? nil : subject
    }

    /// The line written to the observation, for the engine to act on.
    static func line(forSubject subject: String) -> String { "⟦Archived email: \(subject)⟧" }

    /// Feed every snapshot of a window. Returns the subjects of emails just archived there.
    mutating func archived(windowKey: String, lines: [String], now: Date = Date()) -> [String] {
        let emails = Set(lines.compactMap(Self.subject(ofSection:)))
        let notice = lines.contains(where: Self.isNotice)
        let previous = states[windowKey]
        var departed = previous?.departed
        let gone = (previous?.emails ?? []).subtracting(emails)
        if !gone.isEmpty { departed = (gone.sorted(), now) }

        var archived: [String] = []
        // The notice has just appeared. One already up when the window is first seen says nothing.
        if notice, let previous, !previous.notice, let left = departed, now.timeIntervalSince(left.at) <= Self.window {
            archived = left.subjects
            departed = nil
        }
        // Look again after an email left with no notice yet, or when the notice just went away:
        // archiving again while the notice is up replaces it, with a short gap in between.
        wantsAnotherLook = (!gone.isEmpty && archived.isEmpty) || (previous?.notice == true && !notice)
        states[windowKey] = State(emails: emails, notice: notice, departed: departed, seen: now)
        if states.count > 40, let oldest = states.min(by: { $0.value.seen < $1.value.seen })?.key {
            states.removeValue(forKey: oldest)
        }
        return archived
    }
}
