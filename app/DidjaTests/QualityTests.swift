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
        return QualityReport(days: 7, since: "2026-11-03T10:00:00.000Z", overall: all, sources: [claude, code, email])
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
