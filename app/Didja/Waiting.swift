import Foundation

/// An ask you sent someone, waiting for their answer (SCR-99), as the engine keeps it in `waiting`.
/// Not a task: never ticked, never counted. It closes when their reply is seen, or when you say
/// Got it or Stop waiting.
struct WaitingItem: Identifiable, Equatable {
    var id: Int
    /// The engine's title: "Waiting on Sam: the signed contract".
    var title: String
    /// Where it was asked: "WhatsApp — Sam Carter", "Microsoft Outlook — “Contract”".
    var source: String
    var askedAt: Date?
    /// Until then it is quiet; after, it says "no reply yet" and gives one reminder.
    var quietUntil: Date?
    /// That person wrote in another app about the same thing (SCR-109): "Dana wrote in Microsoft
    /// Outlook at 09:45 about INV-2041". It only asks; Got it closes it.
    var hint: String? = nil

    func overdue(now: Date = Date()) -> Bool { quietUntil.map { $0 <= now } ?? false }

    /// "asked 2 h ago", "asked 3 d ago", "asked just now".
    func asked(now: Date = Date()) -> String {
        guard let askedAt else { return "" }
        let minutes = max(0, Int(now.timeIntervalSince(askedAt) / 60))
        if minutes < 1 { return "asked just now" }
        if minutes < 60 { return "asked \(minutes) min ago" }
        if minutes < 48 * 60 { return "asked \(minutes / 60) h ago" }
        return "asked \(minutes / (24 * 60)) d ago"
    }

    static func date(_ iso: String?) -> Date? {
        guard let iso else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return withFraction.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    }
}

/// How long a waiting item stays quiet (SCR-99): set in the engine (`didja waiting quiet`).
enum WaitingQuiet {
    struct Status: Decodable, Equatable {
        var chatHours: Int
        var emailDays: Int
    }

    static let chatChoices = [4, 8, 24, 48, 72]
    static let emailChoices = [1, 2, 3, 5]

    static func decode(_ json: String?) -> Status {
        json.flatMap { try? JSONDecoder().decode(Status.self, from: Data($0.utf8)) } ?? Status(chatHours: 24, emailDays: 2)
    }

    static func status() -> Status { decode(EngineRunner.output(["waiting", "quiet", "--json"])) }

    static func set(chatHours: Int? = nil, emailDays: Int? = nil) {
        var args = ["waiting", "quiet"]
        if let chatHours { args += ["--chat", String(chatHours)] }
        if let emailDays { args += ["--email", String(emailDays)] }
        _ = EngineRunner.output(args)
    }

    static func chatLabel(_ hours: Int) -> String { hours % 24 == 0 ? (hours == 24 ? "1 day" : "\(hours / 24) days") : "\(hours) hours" }
    static func emailLabel(_ days: Int) -> String { days == 1 ? "1 working day" : "\(days) working days" }
}
