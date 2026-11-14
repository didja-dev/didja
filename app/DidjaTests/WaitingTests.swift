import SQLite3
import SwiftUI
import XCTest
@testable import Didja

/// SCR-99: Waiting On, as the app shows it. Made-up content only.
final class WaitingTests: XCTestCase {
    func testTheTrayIsReadFromTheEngineTable() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = try ObservationStore(directory: dir, migrations: ObservationStore.bundledMigrations())
        XCTAssertEqual(try store.waiting(), [])
        var db: OpaquePointer?
        XCTAssertEqual(sqlite3_open(dir.appendingPathComponent("didja.db").path, &db), SQLITE_OK)
        defer { sqlite3_close(db) }
        XCTAssertEqual(sqlite3_exec(db, """
            INSERT INTO waiting (key, via, app, place, who, direct, title, asked_at, quiet_until, status, created_at) VALUES
              ('a', 'chat', 'WhatsApp', 'Dana Levi', 'Dana Levi', 1, 'Waiting on Dana: the signed contract', '2026-11-14T08:00:00.000Z', '2026-11-15T08:00:00.000Z', 'waiting', '2026-11-14T08:00:00.000Z'),
              ('b', 'email', 'Microsoft Outlook', 'contract', 'Sam Carter', 0, 'Waiting on Sam: review the PR', '2026-11-14T09:00:00.000Z', '2026-11-17T09:00:00.000Z', 'waiting', '2026-11-14T09:00:00.000Z'),
              ('c', 'chat', 'WhatsApp', 'Noa Katz', 'Noa Katz', 1, 'Waiting on Noa: the floor plan', '2026-11-14T07:00:00.000Z', '2026-11-15T07:00:00.000Z', 'answered', '2026-11-14T07:00:00.000Z')
            """, nil, nil, nil), SQLITE_OK)
        let items = try store.waiting()
        XCTAssertEqual(items.map(\.title), ["Waiting on Dana: the signed contract", "Waiting on Sam: review the PR"], "answered ones are gone")
        XCTAssertEqual(items.map(\.source), ["WhatsApp — Dana Levi", "Microsoft Outlook — “contract”"])
        XCTAssertEqual(items[0].askedAt, WaitingItem.date("2026-11-14T08:00:00.000Z"))
    }

    func testNoReplyYetOnlyAfterTheQuietTime() {
        let asked = WaitingItem.date("2026-11-14T08:00:00.000Z")!
        let item = WaitingItem(id: 1, title: "Waiting on Dana: the signed contract", source: "WhatsApp — Dana Levi",
                               askedAt: asked, quietUntil: asked.addingTimeInterval(24 * 3600))
        XCTAssertFalse(item.overdue(now: asked.addingTimeInterval(3 * 3600)))
        XCTAssertTrue(item.overdue(now: asked.addingTimeInterval(25 * 3600)))
        XCTAssertEqual(item.asked(now: asked.addingTimeInterval(3 * 3600)), "asked 3 h ago")
        XCTAssertEqual(item.asked(now: asked.addingTimeInterval(72 * 3600)), "asked 3 d ago")
    }

    func testAWaitingReminderSaysNoReplyYet() throws {
        let nudges = try Nudger.decode(#"[{"id":3,"title":"Waiting on Dana: the signed contract","source":"WhatsApp — Dana Levi","left":1,"total":1,"waiting":"2026-11-14T08:00:00.000Z"},{"id":3,"title":"Send the deck","source":"Claude","left":1,"total":1}]"#)
        XCTAssertEqual(nudges[0].heading, "No reply yet · Waiting on Dana: the signed contract")
        XCTAssertEqual(nudges[0].detail, "You asked in WhatsApp — Dana Levi")
        XCTAssertEqual(nudges[0].identifier, "waiting-3")
        XCTAssertEqual(nudges[1].identifier, "nudge-3", "a task with the same id is a different reminder")
    }

    func testQuietTimesFromTheEngine() {
        XCTAssertEqual(WaitingQuiet.decode(#"{"chatHours":8,"emailDays":3}"#), WaitingQuiet.Status(chatHours: 8, emailDays: 3))
        XCTAssertEqual(WaitingQuiet.decode(nil), WaitingQuiet.Status(chatHours: 24, emailDays: 2))
        XCTAssertEqual(WaitingQuiet.chatLabel(24), "1 day")
        XCTAssertEqual(WaitingQuiet.chatLabel(8), "8 hours")
        XCTAssertEqual(WaitingQuiet.emailLabel(2), "2 working days")
    }

    /// Draws the list with Waiting On open to $TMPDIR/didja-ui/waiting.png.
    @MainActor
    func testRenderTheTray() throws {
        let now = WaitingItem.date("2026-11-15T12:00:00.000Z")!
        let tray = WaitingTray(items: [
            WaitingItem(id: 1, title: "Waiting on Dana: the signed contract", source: "WhatsApp — Dana Levi",
                        askedAt: now.addingTimeInterval(-28 * 3600), quietUntil: now.addingTimeInterval(-4 * 3600)),
            WaitingItem(id: 2, title: "Waiting on Sam: review the PR", source: "Microsoft Outlook — “Contract”",
                        askedAt: now.addingTimeInterval(-2 * 3600), quietUntil: now.addingTimeInterval(46 * 3600)),
        ], expanded: .constant(true), actions: TaskActions(), now: now)
        let view = VStack(alignment: .leading, spacing: 12) {
            PopoverTaskList(board: TaskBoardTests.sample, actions: TaskActions(), navigator: TaskNavigator(scope: .popover))
            tray
        }
        .padding(12)
        .frame(width: 420)
        .background(Palette.surface)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage)
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let png = try XCTUnwrap(NSBitmapImageRep(data: try XCTUnwrap(image.tiffRepresentation))?.representation(using: .png, properties: [:]))
        try png.write(to: dir.appendingPathComponent("waiting.png"))
    }
}
