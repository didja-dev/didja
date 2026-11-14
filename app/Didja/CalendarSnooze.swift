import AppKit
import EventKit
import Foundation

/// Calendar-aware snooze (SCR-117): "after this meeting", "after my next meeting", "before
/// tomorrow's first meeting", "before my next meeting with them". Off until you choose it in a
/// task's Snooze menu and macOS asks for Calendar access. Events are read here with EventKit, on
/// this Mac, and handed to the engine in memory: start, end, all-day, attendee names. Never an
/// event's title; nothing is stored or sent, and the calendar is never changed. The engine works
/// out the times (`didja calendar-snooze`); the time you pick is the task's snooze time.
final class CalendarSnooze: ObservableObject {
    static let shared = CalendarSnooze()

    struct Option: Decodable, Equatable {
        var kind: String
        var until: String
        var person: String?

        var date: Date? { CalendarSnooze.iso.date(from: until) ?? ISO8601DateFormatter().date(from: until) }
    }

    struct Plan: Decodable, Equatable {
        var shared: [Option]
        var withPerson: [String: Option]

        static let empty = Plan(shared: [], withPerson: [:])
    }

    /// One event as the engine gets it. No title, on purpose.
    struct Event: Encodable, Equatable {
        var start: String
        var end: String
        var allDay: Bool
        var attendees: [String]
    }

    /// Said before macOS asks, so it is clear what is read and what is not.
    static let explanation = "Didja reads when your meetings start and end and who is in them, on this Mac, to offer snooze times like \"after this meeting\" or \"before my next meeting with Sam\". It never reads event titles, never stores or sends anything from your calendar, and never changes it."

    @Published private(set) var plan = Plan.empty
    @Published private(set) var access = CalendarSnooze.currentAccess()

    enum Access { case unasked, granted, refused }

    private let store = EKEventStore()
    private var timer: Timer?
    fileprivate static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    static func currentAccess() -> Access {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .fullAccess: return .granted
        case .notDetermined: return .unasked
        default: return .refused
        }
    }

    /// Start keeping the options current, if access was granted before. Asks nothing.
    func start() {
        access = Self.currentAccess()
        guard access == .granted, timer == nil else { return }
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 120, repeats: true) { [weak self] _ in self?.refresh() }
    }

    /// From the Snooze menu: explain, then let macOS ask once.
    func askForAccess() {
        let alert = NSAlert()
        alert.messageText = "Snooze around your meetings?"
        alert.informativeText = Self.explanation
        alert.addButton(withTitle: "Continue")
        alert.addButton(withTitle: "Not Now")
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        store.requestFullAccessToEvents { [weak self] _, _ in
            DispatchQueue.main.async { self?.start() }
        }
    }

    /// Read the calendar and ask the engine which snooze times apply, off the main thread.
    func refresh(now: Date = Date()) {
        guard Self.currentAccess() == .granted else { return }
        let events = Self.events(from: store, around: now)
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let plan = Self.plan(for: events)
            DispatchQueue.main.async { self?.plan = plan }
        }
    }

    /// Events from twelve hours back to fifteen days ahead, as the engine reads them.
    static func events(from store: EKEventStore, around now: Date) -> [Event] {
        let predicate = store.predicateForEvents(withStart: now.addingTimeInterval(-12 * 3600), end: now.addingTimeInterval(15 * 86_400), calendars: nil)
        return store.events(matching: predicate)
            .filter { $0.status != .canceled }
            .map { e in
                event(start: e.startDate, end: e.endDate, allDay: e.isAllDay, attendees: (e.attendees ?? []).compactMap { $0.name })
            }
    }

    static func event(start: Date, end: Date, allDay: Bool, attendees: [String]) -> Event {
        Event(start: iso.string(from: start), end: iso.string(from: end), allDay: allDay, attendees: attendees)
    }

    static func plan(for events: [Event], run: (String) -> String? = { EngineRunner.output(["calendar-snooze"], input: $0) }) -> Plan {
        guard let json = try? JSONEncoder().encode(events), let text = String(data: json, encoding: .utf8),
              let out = run(text), let plan = try? JSONDecoder().decode(Plan.self, from: Data(out.utf8)) else { return .empty }
        return plan
    }

    /// The options for one task's Snooze menu: the shared ones, then "with them" if it has one.
    func options(for taskId: Int) -> [Option] {
        plan.shared + (plan.withPerson[String(taskId)].map { [$0] } ?? [])
    }

    /// "After This Meeting (10:45)", "Before My Next Meeting with Sam (Tue 9:15)".
    static func label(_ option: Option, now: Date = Date(), calendar: Calendar = .current) -> String? {
        guard let date = option.date else { return nil }
        let time = DateFormatter.localizedString(from: date, dateStyle: .none, timeStyle: .short)
        let when: String
        if calendar.isDate(date, inSameDayAs: now) {
            when = time
        } else {
            let day = DateFormatter()
            day.setLocalizedDateFormatFromTemplate("EEE")
            when = "\(day.string(from: date)) \(time)"
        }
        switch option.kind {
        case "after-this": return "After This Meeting (\(when))"
        case "after-next": return "After My Next Meeting (\(when))"
        case "before-first-tomorrow": return "Before Tomorrow's First Meeting (\(when))"
        case "before-next-with":
            guard let person = option.person else { return nil }
            return "Before My Next Meeting with \(person) (\(when))"
        default: return nil
        }
    }

    /// What the engine is asked to do when an option is picked.
    static func snoozeSpec(_ option: Option) -> String { "at:\(option.until)" }
}
