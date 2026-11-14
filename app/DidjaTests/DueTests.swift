import SwiftUI
import XCTest
@testable import Didja

/// SCR-97: a due date read from the ask, shown as a small tag and as an order; reminders once. Made-up content only.
final class DueTests: XCTestCase {
    private let calendar = Calendar(identifier: .gregorian)
    /// Wednesday 11 November 2026, noon.
    private var wednesday: Date { calendar.date(from: DateComponents(year: 2026, month: 11, day: 11, hour: 12))! }

    private func item(_ id: Int, due: String?, status: TaskItem.Status = .open, parent: Int? = nil, group: Bool = false,
                      source: String = "Microsoft Outlook") -> TaskItem {
        var t = TaskBoardTests.item(id, "Task \(id)", status, parent: parent, group: group, source: source)
        t.dueAt = due
        return t
    }

    func testTheTagSaysOverdueTodayOrSoon() {
        XCTAssertNil(item(1, due: nil).dueTag(today: wednesday, calendar: calendar))
        XCTAssertEqual(item(1, due: "2026-11-10").dueTag(today: wednesday, calendar: calendar)?.text, "overdue")
        XCTAssertEqual(item(1, due: "2026-11-10").dueTag(today: wednesday, calendar: calendar)?.overdue, true)
        XCTAssertEqual(item(1, due: "2026-11-11").dueTag(today: wednesday, calendar: calendar)?.text, "due today")
        XCTAssertEqual(item(1, due: "2026-11-12").dueTag(today: wednesday, calendar: calendar)?.text, "due tomorrow")
        XCTAssertEqual(item(1, due: "2026-11-13").dueTag(today: wednesday, calendar: calendar)?.text, "due Fri")
        XCTAssertNil(item(1, due: "2026-11-20").dueTag(today: wednesday, calendar: calendar), "further off: no tag")
        XCTAssertNil(item(1, due: "2026-11-10", status: .done).dueTag(today: wednesday, calendar: calendar), "finished: no tag")
        XCTAssertEqual(item(1, due: "2026-11-11", status: .snoozed).dueTag(today: wednesday, calendar: calendar)?.text, "due today")
        XCTAssertNil(item(1, due: "Thursday").dueTag(today: wednesday, calendar: calendar))
    }

    func testSoonestDueFirstThenTheRestInTheirOrder() {
        let tasks = [
            item(1, due: nil, source: "A"),
            item(2, due: "2026-11-20", source: "B"),
            item(3, due: nil, group: true, source: "C"),
            item(4, due: "2026-11-12", parent: 3, source: "C"),
            item(5, due: "2026-11-13", source: "D"),
        ]
        let board = TaskBoard(tasks: tasks, sort: .due)
        XCTAssertEqual(board.entries(.pending).map(\.task.id), [3, 5, 2, 1])
        XCTAssertEqual(TaskBoard(tasks: tasks, sort: .source).entries(.pending).map(\.task.id), [1, 2, 3, 5])
        XCTAssertEqual(TaskBoard.Sort.due.label, "Due Soonest First")
    }

    func testTheDueDayReminderSaysSo() throws {
        let json = #"[{"id":7,"title":"Send Dana the numbers","source":"Microsoft Outlook","left":1,"total":1,"due":"2026-11-12"},{"id":8,"title":"Launch","source":"Claude","left":2,"total":3}]"#
        let nudges = try Nudger.decode(json)
        XCTAssertEqual(nudges[0].detail, "Due today · Microsoft Outlook")
        XCTAssertEqual(nudges[1].detail, "2 of 3 steps left · Claude")
    }
}
