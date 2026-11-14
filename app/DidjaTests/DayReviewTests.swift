import SwiftUI
import XCTest
@testable import Didja

/// SCR-100: Day Review and the first-tick note, as the app shows them. Made-up content only.
final class DayReviewTests: XCTestCase {
    static let json = #"""
    {"kind":"evening","day":"2026-11-11","sections":[
      {"key":"ticked","title":"Ticked for you today","items":[{"id":4,"title":"Run the migration","source":"Claude — Release","why":"Ran in Terminal and it succeeded"}]},
      {"key":"answered","title":"Answered","items":[{"id":2,"title":"Waiting on Sam: the floor plan","source":"WhatsApp — Sam Carter","why":"Sam replied in WhatsApp — Sam Carter at 14:10"}]},
      {"key":"tomorrow","title":"Due tomorrow","items":[{"id":7,"title":"Send Noa the slides","source":"WhatsApp — Noa Katz","due":"2026-11-12"}]}
    ]}
    """#

    func testTheReviewIsReadFromTheEngine() throws {
        let review = try XCTUnwrap(DayReview.decode(Self.json))
        XCTAssertEqual(review.heading, "Day Review")
        XCTAssertEqual(review.sections.map(\.key), ["ticked", "answered", "tomorrow"])
        XCTAssertEqual(review.sections[2].items[0].due, "2026-11-12")
        XCTAssertNil(DayReview.decode("not json"))
        XCTAssertEqual(DayReview.decode(#"{"kind":"morning","day":"2026-11-11","sections":[]}"#)?.heading, "Morning")
    }

    func testTheFirstTickNoteAndTheReminder() {
        XCTAssertEqual(FirstTickNote.decode(#"{"id":4,"title":"Run the migration","why":null}"#), FirstTickNote(id: 4, title: "Run the migration", why: nil))
        XCTAssertNil(FirstTickNote.decode("null"), "none, or already seen")
        XCTAssertEqual(Nudger.reviewReminder("evening").title, "Day Review")
        XCTAssertEqual(Nudger.reviewReminder("morning").title, "Morning list")
    }

    /// Draws the review and the first-tick note to $TMPDIR/didja-ui/review.png.
    @MainActor
    func testRenderTheReview() throws {
        let review = try XCTUnwrap(DayReview.decode(Self.json))
        let view = VStack(alignment: .leading, spacing: 10) {
            FirstTickBanner(note: FirstTickNote(id: 4, title: "Run the migration", why: "Ran in Terminal and it succeeded"))
            DayReviewSheet(review: review)
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
        try png.write(to: dir.appendingPathComponent("review.png"))
    }
}
