import SwiftUI
import XCTest
@testable import Didja

/// Propose Upstream… (SCR-42): the change, and only the corrections you tick.
final class ProposalTests: XCTestCase {
    private let lessons = [
        TaughtLesson(id: 1, job: .looksDone, kind: "not-done", example: "\u{201C}Send Sam the deck\u{201D} was not done when the draft was open"),
        TaughtLesson(id: 2, job: .looksDone, kind: "not-done", example: "\u{201C}Pay the invoice\u{201D} was not done on the payment form"),
    ]

    func testTheDiffShowsWhatYouChanged() {
        XCTAssertEqual(InstructionProposal.diff("a\nb\nc", "a\nB\nc\nd"), ["  a", "+ B", "- b", "  c", "+ d"])
        XCTAssertEqual(InstructionProposal.diff("same", "same"), ["  same"])
    }

    func testNoCorrectionGoesInUnlessYouTickIt() throws {
        var p = InstructionProposal(job: .looksDone, builtIn: "Answer done only when it is done.",
                                    proposed: "Answer done only when the screen says it is done.", lessons: lessons)
        var file = try JSONSerialization.jsonObject(with: Data(p.json().utf8)) as! [String: Any]
        XCTAssertEqual(file["kind"] as? String, "didja-instructions-proposal")
        XCTAssertEqual(file["job"] as? String, "looks-done")
        XCTAssertEqual((file["lessons"] as? [Any])?.count, 0)
        XCTAssertFalse(p.json().contains("invoice"))
        p.included = [2]
        p.note = "  It ticked tasks on draft screens.  "
        file = try JSONSerialization.jsonObject(with: Data(p.json().utf8)) as! [String: Any]
        XCTAssertEqual((file["lessons"] as? [[String: String]])?.map { $0["example"] }, [lessons[1].example])
        XCTAssertEqual(file["note"] as? String, "It ticked tasks on draft screens.")
        XCTAssertEqual(p.fileName, "didja-instructions-looks-done.json")
        XCTAssertNotNil(InstructionProposal.issueURL(job: .looksDone))
    }

    func testOnlyYourOwnVersionCanBeProposed() {
        let model = BrainModel(fetch: { #"{"jobs":{"looks-done":"Mine","emails":null},"lessons":[]}"# }, run: { _, _ in true })
        XCTAssertEqual(model.proposal(for: .looksDone).proposed, "Mine")
        XCTAssertTrue(model.isCustom(.looksDone))
        XCTAssertFalse(model.isCustom(.emails))
    }

    /// Draws the sheet to $TMPDIR/didja-ui/proposal.png.
    @MainActor
    func testRenderProposal() throws {
        var p = InstructionProposal(job: .looksDone, builtIn: "Answer done only when it is done.\nOtherwise unsure.",
                                    proposed: "Answer done only when the screen says it is done.\nOtherwise unsure.", lessons: lessons)
        p.included = [1]
        let renderer = ImageRenderer(content: ProposalView(proposal: p, scrolls: false))
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage)
        let png = try XCTUnwrap(image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?.representation(using: .png, properties: [:]))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try png.write(to: dir.appendingPathComponent("proposal.png"))
    }
}
