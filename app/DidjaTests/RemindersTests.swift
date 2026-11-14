import SwiftUI
import XCTest
@testable import Didja

/// SCR-121 Apple Reminders: the app's side (the rules are tested in engine/test/reminders.test.ts).
final class RemindersTests: XCTestCase {
    /// A Reminders store in memory: one reminder you made yourself, and whatever Didja adds.
    final class FakeReminders: ReminderStore {
        struct Item: Equatable { var title: String; var url: URL?; var notes: String?; var list: String; var completed: Bool }
        var items: [String: Item] = ["yours": Item(title: "Buy milk", url: URL(string: "didja://task/1"), notes: nil, list: "Home", completed: false)]
        var lists = ["Home": "L-home"]
        var canWrite = true
        var next = 0

        func didjaReminders() -> [Reminders.Seen]? {
            items.compactMap { Reminders.taskId(of: $0.value.url) == nil ? nil : Reminders.Seen(id: $0.key, completed: $0.value.completed) }
        }

        func list(named name: String) -> String? {
            if let id = lists[name] { return id }
            lists[name] = "L-\(name)"
            return lists[name]
        }

        func add(title: String, url: URL, notes: String?, list: String) -> String? {
            next += 1
            items["R\(next)"] = Item(title: title, url: url, notes: notes, list: list, completed: false)
            return "R\(next)"
        }

        func setCompleted(_ id: String, _ completed: Bool) -> Bool {
            guard items[id] != nil else { return false }
            items[id]!.completed = completed
            return true
        }
    }

    private func plan(create: [Reminders.Create] = [], complete: [String] = [], reopen: [String] = []) -> Reminders.Plan {
        .init(list: "Didja", create: create, complete: complete, reopen: reopen, ticked: 0, dismissed: 0, held: false)
    }

    func testTheTaskIdIsReadOnlyFromADidjaTaskLink() {
        XCTAssertEqual(Reminders.taskId(of: URL(string: "didja://task/42")), 42)
        XCTAssertNil(Reminders.taskId(of: URL(string: "didja://task/")))
        XCTAssertNil(Reminders.taskId(of: URL(string: "didja://canvas/42")))
        XCTAssertNil(Reminders.taskId(of: URL(string: "https://example.com/task/42")))
        XCTAssertNil(Reminders.taskId(of: nil))
    }

    func testCreatesTheTitleAndLinkOnlyInTheNamedList() {
        let store = FakeReminders()
        let written = Reminders.apply(plan(create: [.init(taskId: 7, title: "Send Noa the March invoice", url: "didja://task/7", notes: nil)]), to: store)
        XCTAssertEqual(written.created, [.init(taskId: 7, reminderId: "R1")])
        XCTAssertEqual(store.items["R1"], .init(title: "Send Noa the March invoice", url: URL(string: "didja://task/7"), notes: nil, list: "L-Didja", completed: false))
    }

    func testALinkThatDoesNotMatchItsTaskIsNotWritten() {
        let store = FakeReminders()
        let written = Reminders.apply(plan(create: [.init(taskId: 7, title: "Book the venue", url: "didja://task/8", notes: nil)]), to: store)
        XCTAssertTrue(written.isEmpty)
        XCTAssertEqual(store.items.count, 1)
    }

    func testCompletesAndReopensOnlyWhatThePlanNames() {
        let store = FakeReminders()
        _ = Reminders.apply(plan(create: [.init(taskId: 7, title: "Book the venue", url: "didja://task/7", notes: nil),
                                          .init(taskId: 8, title: "Call the Acme office", url: "didja://task/8", notes: nil)]), to: store)
        store.items["R2"]!.completed = true
        let written = Reminders.apply(plan(complete: ["R1"], reopen: ["R2", "gone"]), to: store)
        XCTAssertEqual(written.completed, ["R1"])
        XCTAssertEqual(written.reopened, ["R2"], "a reminder that is not there is not reported as written")
        XCTAssertTrue(store.items["R1"]!.completed)
        XCTAssertFalse(store.items["R2"]!.completed)
        XCTAssertEqual(store.items["yours"], .init(title: "Buy milk", url: URL(string: "didja://task/1"), notes: nil, list: "Home", completed: false),
                       "a reminder you made is never touched")
    }

    /// Draws the Reminders section, on, to `$TMPDIR/didja-ui/reminders.png`.
    @MainActor
    func testRenderRemindersSection() throws {
        let model = RemindersModel(status: .init(on: true, list: "Didja", sources: ["chat", "email", "ai", "mylist"], who: false, written: 4))
        let renderer = ImageRenderer(content: RemindersSection(model: model).frame(width: 512).padding(24)
            .background(Color(nsColor: .windowBackgroundColor)))
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage)
        let png = try XCTUnwrap(image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?.representation(using: .png, properties: [:]))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try png.write(to: dir.appendingPathComponent("reminders.png"))
        XCTAssertGreaterThan(image.size.height, 150)
    }
}
