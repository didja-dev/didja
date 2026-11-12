import Foundation

/// Chat apps: each message of the open conversation is labelled with its chat, whether the chat is
/// a group, who wrote it and when, so the engine can find what is asked of you:
///
///     ⟦Chat message: Dana Levi (direct) — from Dana Levi — 9 October at 12:34⟧
///     Can you send me the signed contract?
///     ⟦Chat message: Dana Levi (direct) — from me — 9 October at 12:40⟧
///     Sent, check your inbox
///
/// The chat goes in every message's section line: capture passes on only new lines, each with its
/// own section line, so a message must say on its own which chat it belongs to. Which elements of
/// an app are its messages is in the app's profile (`AppProfile`, `profiles/*.json`).
enum ChatAdapter {
    enum Kind: String { case direct, group, unknown }

    struct Message: Equatable {
        var chat: String
        var kind: Kind
        /// The sender's name as shown, or "me".
        var from: String
        var mentionsMe = false
        var time: String
        var text: String
    }

    /// The section line for a message, without the brackets.
    static func sectionName(_ m: Message) -> String {
        func clean(_ s: String) -> String {
            s.replacingOccurrences(of: "⟦", with: "").replacingOccurrences(of: "⟧", with: "")
                .replacingOccurrences(of: " — ", with: " - ")
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        let from = clean(m.from) + (m.mentionsMe ? ", mentions me" : "")
        return "Chat message: \(clean(m.chat)) (\(m.kind.rawValue)) — from \(from) — \(clean(m.time))"
    }

    /// Your emoji reaction to a message, as a short message from you placed right after it, so the
    /// engine weighs it like any reply. It quotes the start of the message, which keeps reactions to
    /// different messages apart.
    static func reaction(_ emoji: String, to message: Message) -> Message {
        let quote = message.text.split(separator: "\n").first.map { String($0.prefix(40)) } ?? ""
        return Message(chat: message.chat, kind: message.kind, from: "me", time: message.time,
                       text: "[reacted \(emoji) to “\(quote)”]")
    }

    /// Your reaction as a chat list shows it, as a message from you in that chat. It carries the
    /// reacted-to message's first line whole (bold marks removed), which is how the engine knows
    /// which message it answers; the row has no time, so its time reads "reaction".
    static func listReaction(emoji: String, quote: String, chat: String) -> Message {
        let first = quote.split(separator: "\n").first.map(String.init) ?? ""
        let plain = first.replacingOccurrences(of: "*", with: "").replacingOccurrences(of: "_", with: "")
            .replacingOccurrences(of: "~", with: "").trimmingCharacters(in: .whitespaces)
        return Message(chat: chat, kind: .unknown, from: "me", time: "reaction",
                       text: "[reacted \(emoji) to “\(String(plain.prefix(200)))”]")
    }

    /// Bidirectional marks some apps put around their labels.
    static func stripMarks(_ s: String) -> String {
        s.replacingOccurrences(of: "\u{200E}", with: "").replacingOccurrences(of: "\u{200F}", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// A chat is a group when the app says a message was received in it, or someone other than the
    /// chat's own name has written in it.
    static func kind(chat: String, senders: [String], anyInGroup: Bool = false) -> Kind {
        if anyInGroup { return .group }
        if senders.isEmpty { return .unknown }
        return senders.contains { $0.caseInsensitiveCompare(chat) != .orderedSame } ? .group : .direct
    }
}

/// One message read from a single label by a profile's parse steps (WhatsApp:
/// "message, Can you send it?, 9 October at 12:34, Received from Dana"). The steps fill fields:
/// `time` and `text`, `from`, `kind` (message, photo…), and `mine` / `group` when set at all.
struct ParsedMessage: Equatable {
    var mine: Bool
    var from: String?
    var time: String
    var text: String
    var inGroup: Bool

    static func parse(_ label: String, steps: [AppProfile.ParseStep], plainKinds: [String]?) -> ParsedMessage? {
        var fields = ["label": label]
        for step in steps {
            if let unless = step.unless, !(fields[unless] ?? "").isEmpty { continue }
            guard let value = fields[step.field], !value.isEmpty, let groups = step.pattern.match(value) else {
                if step.required == true { return nil }
                continue
            }
            for (name, found) in groups where name != "v" { fields[name] = found.trimmingCharacters(in: .whitespacesAndNewlines) }
            for (name, set) in step.set ?? [:] { fields[name] = set }
        }
        guard let time = fields["time"], !time.isEmpty else { return nil }
        var text = (fields["text"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let kind = fields["kind"] ?? ""
        if let plain = plainKinds, !kind.isEmpty, !plain.contains(where: { $0.caseInsensitiveCompare(kind) == .orderedSame }) {
            text = "[\(kind)]" + (text.isEmpty ? "" : " \(text)")
        }
        let from = fields["from"].flatMap { $0.isEmpty ? nil : $0 }
        return ParsedMessage(mine: !(fields["mine"] ?? "").isEmpty, from: from, time: time, text: text,
                             inGroup: !(fields["group"] ?? "").isEmpty)
    }
}

/// Emails are put under a section named after their subject: "Email: Q3 budget numbers", or
/// "Email 2: …" for the second message of a conversation. Carrying the subject keeps different
/// emails apart when their lines arrive in pieces.
enum MailSection {
    static func name(subject: String, index: Int? = nil) -> String {
        let clean = subject.replacingOccurrences(of: "⟦", with: "").replacingOccurrences(of: "⟧", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return "Email\(index.map { " \($0)" } ?? ""): \(clean)"
    }
}
