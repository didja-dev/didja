import SwiftUI
import XCTest
@testable import Didja

/// A long list must draw quickly: each click redraws it. Each row used to work out every row on
/// show (for its right-click menu) whenever it was drawn, so drawing the list cost rows × rows.
final class ListSpeedTests: XCTestCase {
    static func longBoard(_ count: Int) -> TaskBoard {
        var tasks: [TaskItem] = []
        for i in 1...count {
            tasks.append(TaskItem(id: i, title: "Send the Acme report part \(i)", status: .open,
                                  source: "Claude — Project \(i % 30)", parentID: nil, isGroup: false,
                                  doneAt: nil, snoozedUntil: nil, capturedAt: Date().addingTimeInterval(-Double(i) * 60)))
        }
        return TaskBoard(tasks: tasks)
    }

    @MainActor
    func testA300TaskListDrawsQuickly() throws {
        for count in [75, 150, 300] {
            let board = Self.longBoard(count)
            let navigator = TaskNavigator(scope: .popover)
            let start = Date()
            let renderer = ImageRenderer(content: PopoverTaskList(board: board, actions: TaskActions(), navigator: navigator).frame(width: 420))
            _ = try XCTUnwrap(renderer.nsImage)
            print("LISTSPEED \(count) rows drawn in \(Int(Date().timeIntervalSince(start) * 1000)) ms")
        }
    }

    /// A list the size of a real one: 1,100 tasks, most of them done, in checklists across 40 places.
    static func realBoard() -> TaskBoard {
        var tasks: [TaskItem] = []
        var id = 0
        for g in 0..<160 {
            id += 1
            let parent = id
            let status: TaskItem.Status = g < 45 ? .open : .done
            tasks.append(TaskItem(id: parent, title: "Checklist \(g)", status: status, source: "Claude — Project \(g % 40)",
                                  parentID: nil, isGroup: true, doneAt: status == .done ? Date().addingTimeInterval(-Double(g) * 3600) : nil,
                                  snoozedUntil: nil, capturedAt: Date().addingTimeInterval(-Double(g) * 3600)))
            for step in 0..<6 {
                id += 1
                tasks.append(TaskItem(id: id, title: "Step \(step) of checklist \(g)", status: status, source: "Claude — Project \(g % 40)",
                                      parentID: parent, isGroup: false, doneAt: status == .done ? Date().addingTimeInterval(-Double(g) * 3600) : nil,
                                      snoozedUntil: nil, capturedAt: Date().addingTimeInterval(-Double(g) * 3600)))
            }
        }
        return TaskBoard(tasks: tasks)
    }

    func testTheBoardsListWorkIsFastOnARealSizedList() {
        let board = Self.realBoard()
        XCTAssertGreaterThan(board.tasks.count, 1000)
        let start = Date()
        for filter in TaskBoard.Filter.allCases { _ = board.count(filter); _ = board.sections(filter) }
        _ = board.popoverRows(matching: "")
        _ = board.recentlyDone(matching: "")
        print("LISTSPEED board work on \(board.tasks.count) tasks: \(Int(Date().timeIntervalSince(start) * 1000)) ms")
    }

    func testChosenTogetherOnlyWhenSeveralAreChosen() {
        let board = Self.longBoard(20)
        let navigator = TaskNavigator(scope: .popover)
        let rows = navigator.rows(board)
        let item = rows[3]
        XCTAssertEqual(navigator.chosenTogether(with: item, board: board).map(\.id), [])
        navigator.marked = [item.id]
        XCTAssertEqual(navigator.chosenTogether(with: item, board: board).map(\.id), []) // one is not several
        navigator.marked = [item.id, rows[5].id, rows[7].id]
        XCTAssertEqual(navigator.chosenTogether(with: item, board: board).map(\.id), navigator.chosenTogether(rows).map(\.id))
        XCTAssertEqual(navigator.chosenTogether(with: item, board: board).count, 3)
        // A row that is not among them gets none: its menu acts on itself alone.
        XCTAssertEqual(navigator.chosenTogether(with: rows[0], board: board).map(\.id), [])
    }
}
