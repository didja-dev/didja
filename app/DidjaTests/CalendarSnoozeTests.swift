import XCTest
@testable import Didja

/// Calendar-aware snooze (SCR-117): what the app hands the engine, and how the options read.
final class CalendarSnoozeTests: XCTestCase {
    private let now = DateComponents(calendar: .current, year: 2026, month: 11, day: 16, hour: 10, minute: 20).date!

    func testEventsGoToTheEngineWithoutTitles() throws {
        let event = CalendarSnooze.event(start: now, end: now.addingTimeInterval(1800), allDay: false, attendees: ["Sam Carter"])
        let json = String(data: try JSONEncoder().encode([event]), encoding: .utf8)!
        XCTAssertFalse(json.contains("title"))
        XCTAssertTrue(json.contains("Sam Carter"))
        var sent: String?
        let plan = CalendarSnooze.plan(for: [event]) { input in
            sent = input
            return #"{"shared":[{"kind":"after-this","until":"2026-11-16T10:50:00.000Z"}],"withPerson":{"7":{"kind":"before-next-with","until":"2026-11-17T08:45:00.000Z","person":"Sam Carter"}}}"#
        }
        let objects = try JSONSerialization.jsonObject(with: Data(sent!.utf8)) as! [[String: Any]]
        XCTAssertEqual(objects.count, 1)
        XCTAssertEqual(Set(objects[0].keys), ["start", "end", "allDay", "attendees"])
        XCTAssertEqual(objects[0]["attendees"] as? [String], ["Sam Carter"])
        XCTAssertEqual(plan.shared.map(\.kind), ["after-this"])
        XCTAssertEqual(plan.withPerson["7"]?.person, "Sam Carter")
    }

    func testNoEngineAnswerMeansNoOptions() {
        XCTAssertEqual(CalendarSnooze.plan(for: []) { _ in nil }, .empty)
        XCTAssertEqual(CalendarSnooze.plan(for: []) { _ in "not json" }, .empty)
    }

    func testLabelsAndTheSnoozeTheyAskFor() {
        let later = now.addingTimeInterval(25 * 60)
        let iso = ISO8601DateFormatter().string(from: later)
        let time = DateFormatter.localizedString(from: later, dateStyle: .none, timeStyle: .short)
        let option = CalendarSnooze.Option(kind: "after-this", until: iso, person: nil)
        XCTAssertEqual(CalendarSnooze.label(option, now: now), "After This Meeting (\(time))")
        XCTAssertEqual(CalendarSnooze.snoozeSpec(option), "at:\(iso)")
        let with = CalendarSnooze.Option(kind: "before-next-with", until: ISO8601DateFormatter().string(from: now.addingTimeInterval(86_400)), person: "Noa")
        XCTAssertTrue(CalendarSnooze.label(with, now: now)!.hasPrefix("Before My Next Meeting with Noa ("))
        XCTAssertNil(CalendarSnooze.label(CalendarSnooze.Option(kind: "before-next-with", until: iso, person: nil), now: now))
        XCTAssertNil(CalendarSnooze.label(CalendarSnooze.Option(kind: "something-else", until: iso, person: nil), now: now))
        XCTAssertNil(CalendarSnooze.label(CalendarSnooze.Option(kind: "after-this", until: "soon", person: nil), now: now))
    }
}
