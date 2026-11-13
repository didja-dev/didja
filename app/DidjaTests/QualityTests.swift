import SwiftUI
import XCTest
@testable import Didja

/// SCR-73: "How Didja is doing" in Settings › General. Made-up numbers.
final class QualityTests: XCTestCase {
    /// The shape `didja quality --json` prints (copied from the engine on a made-up store).
    static let engineJSON = """
        {"days":7,"since":"2026-11-03T10:00:00.000Z","overall":{"made":1,"ticked":{"command":0,"link":0,"setting":0,"file":0,"screen":0,"reply":0,"tool":0,"accepted":0,"total":0},"asked":0,"yes":0,"notYet":0,"noAnswer":0,"byHand":1,"shownDone":0,"dismissed":0,"notAnAction":0,"freshStart":0,"reopenedAfterTick":0},"sources":[{"source":"Added by you","made":1,"ticked":{"command":0,"link":0,"setting":0,"file":0,"screen":0,"reply":0,"tool":0,"accepted":0,"total":0},"asked":0,"yes":0,"notYet":0,"noAnswer":0,"byHand":1,"shownDone":0,"dismissed":0,"notAnAction":0,"freshStart":0,"reopenedAfterTick":0}]}
        """

    static var sample: QualityReport {
        func counts(_ source: String?, made: Int, ticked: Int, asked: Int, yes: Int, notYet: Int, byHand: Int, dismissed: Int, wrong: Int) -> QualityReport.Counts {
            var c = QualityReport.Counts()
            c.source = source
            c.made = made
            c.ticked.command = ticked
            c.ticked.total = ticked
            c.asked = asked
            c.yes = yes
            c.notYet = notYet
            c.byHand = byHand
            c.dismissed = dismissed
            c.reopenedAfterTick = wrong
            return c
        }
        let claude = counts("Claude", made: 24, ticked: 9, asked: 5, yes: 3, notYet: 1, byHand: 6, dismissed: 4, wrong: 1)
        let code = counts("Claude Code", made: 11, ticked: 4, asked: 2, yes: 2, notYet: 0, byHand: 3, dismissed: 1, wrong: 0)
        let email = counts("Email", made: 7, ticked: 2, asked: 1, yes: 0, notYet: 1, byHand: 2, dismissed: 2, wrong: 0)
        let all = counts(nil, made: 42, ticked: 15, asked: 8, yes: 5, notYet: 2, byHand: 11, dismissed: 7, wrong: 1)
        func row(_ what: String, _ n: Int, _ p50: Double, _ p90: Double, _ target: Double?) -> QualityReport.SpeedRow {
            QualityReport.SpeedRow(what: what, source: "All sources", targetMs: target,
                                   total: .init(n: n, p50: p50, p90: p90), waiting: .init(n: n, p50: p50, p90: p90), working: .init(n: n, p50: 0, p90: 0))
        }
        let speed = QualityReport.Speed(since: "2026-11-03T10:00:00.000Z", rows: [
            row("new-task", 35, 2_100, 2_900, 3_000), row("sure-tick", 15, 2_400, 4_600, 3_000),
            row("model", 9, 6_200, 9_400, 10_000), row("chat-wait", 3, 600_000, 610_000, nil),
        ])
        return QualityReport(days: 7, since: "2026-11-03T10:00:00.000Z", overall: all, sources: [claude, code, email], speed: speed)
    }

    /// SCR-75: the speed section `didja quality --json` prints (shape copied from the engine, made-up numbers).
    func testTheEnginesSpeedsAreRead() throws {
        let json = Self.engineJSON.replacingOccurrences(of: "\"reopenedAfterTick\":0}]}", with: """
            "reopenedAfterTick":0}],"speed":{"since":"2026-11-03T10:00:00.000Z","rows":[{"what":"sure-tick","source":"All sources","targetMs":3000,"total":{"n":2,"p50":1000,"p90":4000},"waiting":{"n":2,"p50":1000,"p90":4000},"working":{"n":2,"p50":0,"p90":0}},{"what":"chat-wait","source":"All sources","targetMs":null,"total":{"n":1,"p50":600000,"p90":600000},"waiting":{"n":1,"p50":600000,"p90":600000},"working":{"n":1,"p50":0,"p90":0}},{"what":"sure-tick","source":"Claude","targetMs":3000,"total":{"n":2,"p50":1000,"p90":4000},"waiting":{"n":2,"p50":1000,"p90":4000},"working":{"n":2,"p50":0,"p90":0}}]}}
            """)
        let report = try XCTUnwrap(QualityReport.decode(json))
        let speed = try XCTUnwrap(report.speed)
        XCTAssertEqual(speed.overall.map(\.what), ["sure-tick", "chat-wait"])
        XCTAssertTrue(speed.overall[0].isSlow, "4 s at the 90th percentile is over the 3 s target")
        XCTAssertFalse(speed.overall[1].isSlow, "a chat ask's wait has no target")
        XCTAssertEqual(SpeedTable.values(speed.overall[0]), ["2", "1.0 s", "4.0 s", "≤ 3.0 s"])
        XCTAssertEqual(SpeedTable.values(speed.overall[1]), ["1", "10 min", "10 min", "—"])
        // An engine from before SCR-75 prints no speed section.
        XCTAssertNil(try XCTUnwrap(QualityReport.decode(Self.engineJSON)).speed)
    }

    func testTheEnginesReportIsRead() throws {
        let report = try XCTUnwrap(QualityReport.decode(Self.engineJSON))
        XCTAssertEqual(report.days, 7)
        XCTAssertEqual(report.sources.map(\.source), ["Added by you"])
        XCTAssertEqual(report.overall.byYou, 1)
        XCTAssertEqual(QualityTable.values(report.overall), [1, 0, 0, 0, 0, 1, 0, 0])
        XCTAssertNil(QualityReport.decode("not json"))
    }

    func testColumnsAddUpWhatTheyName() {
        var c = QualityReport.Counts()
        c.dismissed = 2; c.notAnAction = 1; c.freshStart = 4; c.byHand = 3; c.shownDone = 1
        XCTAssertEqual(c.cleared, 7)
        XCTAssertEqual(c.byYou, 4)
        XCTAssertEqual(QualityTable.columns.count, QualityTable.values(c).count)
    }

    /// Draws the table to $TMPDIR/didja-ui/quality.png and quality-dark.png.
    @MainActor
    func testRenderQualityTable() throws {
        let view = QualityTable(report: Self.sample).padding(16).frame(width: 640)
        let renderer = ImageRenderer(content: view.background(Color.white))
        renderer.scale = 2
        let png = renderer.nsImage?.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?.representation(using: .png, properties: [:])
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try XCTUnwrap(png).write(to: dir.appendingPathComponent("quality.png"))
        try TaskBoardTests.renderDark(view, to: "quality-dark.png")
    }
}
