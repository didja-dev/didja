import SwiftUI
import XCTest
@testable import Didja

/// SCR-116: the week, as the engine gives it, drawn in the Full View. Made-up data only.
final class WeekTests: XCTestCase {
    /// The shape `didja week --json` prints (engine/src/week.ts).
    static let json = """
    {"from":"2026-11-07","to":"2026-11-13","totals":{"byYou":2,"ticked":1,"answered":1,"dismissed":1},
     "days":[
      {"day":"2026-11-13","items":[
        {"id":4,"kind":"byYou","title":"Send Noa the Acme deck","source":"Added by you","at":"2026-11-13T08:00:00.000Z"},
        {"id":1,"kind":"answered","title":"Waiting on Sam: the floor plan","source":"WhatsApp — Sam Carter","at":"2026-11-13T10:00:00.000Z"}]},
      {"day":"2026-11-12","items":[
        {"id":2,"kind":"ticked","title":"Run the prod migration","source":"Claude Code — api-server","at":"2026-11-12T09:00:00.000Z"},
        {"id":5,"kind":"byYou","title":"Reply to Dana about Tuesday","source":"Slack — #launch","at":"2026-11-12T12:00:00.000Z"}]},
      {"day":"2026-11-11","items":[
        {"id":3,"kind":"dismissed","title":"Not a real to-do","source":"Gmail — Acme","at":"2026-11-11T08:00:00.000Z"}]}]}
    """

    func testTheEnginesWeekIsRead() throws {
        let week = try XCTUnwrap(WeekSummary.decode(Self.json))
        XCTAssertEqual(week.days.map(\.day), ["2026-11-13", "2026-11-12", "2026-11-11"])
        XCTAssertEqual(week.totalsLine, "2 done by you · 1 ticked by Didja · 1 answered · 1 dismissed")
        XCTAssertEqual(week.days[0].items[1].words, "answered")
        // A task and a Waiting On row with the same number are still two rows.
        XCTAssertNotEqual(week.days[0].items[1].key, WeekSummary.Item(id: 1, kind: "byYou", title: "", source: "", at: "").key)
        XCTAssertNil(WeekSummary.decode("not json"))
        XCTAssertNil(week.countedNote)
        var counted = week
        var parts = DateComponents()
        parts.year = 2026; parts.month = 11; parts.day = 12; parts.hour = 12
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        counted.countedSince = iso.string(from: Calendar.current.date(from: parts)!)
        XCTAssertEqual(counted.countedNote, "Counted since 12 Nov at 12:00: how tasks ended was not recorded before then.")
    }

    func testDaysAndFileName() throws {
        XCTAssertEqual(WeekSummary.label("2026-11-13"), "Fri 13 Nov")
        let week = try XCTUnwrap(WeekSummary.decode(Self.json))
        XCTAssertEqual(WeekEngine.fileName(week), "Didja week 2026-11-13.md")
        XCTAssertTrue(WeekEngine.reminder.body.contains("This Week"))
    }

    /// Draws This Week's totals and days (the scrolling part) to $TMPDIR/didja-ui/week.png and week-dark.png.
    @MainActor
    func testRenderWeek() throws {
        let view = WeekContent(week: WeekSummary.decode(Self.json)).padding(.top, 12).frame(width: 620)
        let renderer = ImageRenderer(content: view.background(Palette.surface))
        renderer.scale = 2
        let png = renderer.nsImage?.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?.representation(using: .png, properties: [:])
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try XCTUnwrap(png).write(to: dir.appendingPathComponent("week.png"))
        try TaskBoardTests.renderDark(view, to: "week-dark.png")
    }
}
