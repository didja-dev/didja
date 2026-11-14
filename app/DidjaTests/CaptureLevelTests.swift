import SQLite3
import SwiftUI
import XCTest
@testable import Didja

/// SCR-95: the Capture level and the Suggested tray, as the app shows them. Made-up content only.
final class CaptureLevelTests: XCTestCase {
    func testTheTrayIsReadFromTheEngineTable() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = try ObservationStore(directory: dir, migrations: ObservationStore.bundledMigrations())
        XCTAssertEqual(try store.suggestions(), [])
        var db: OpaquePointer?
        XCTAssertEqual(sqlite3_open(dir.appendingPathComponent("didja.db").path, &db), SQLITE_OK)
        defer { sqlite3_close(db) }
        XCTAssertEqual(sqlite3_exec(db, """
            INSERT INTO suggestions (key, kind, source_ref, title, ask, created_at) VALUES
              ('a', 'chat', 'WhatsApp — Ops', 'Restart the staging server', '{}', '2026-11-14T08:00:00.000Z'),
              ('b', 'chat', 'Teams — Launch', 'Send the deck to Noa', '{}', '2026-11-14T09:00:00.000Z')
            """, nil, nil, nil), SQLITE_OK)
        XCTAssertEqual(try store.suggestions(), [
            SuggestedAsk(id: 2, title: "Send the deck to Noa", source: "Teams — Launch"),
            SuggestedAsk(id: 1, title: "Restart the staging server", source: "WhatsApp — Ops"),
        ])
    }

    func testTheLevelComesFromTheEngineAndIsSetThroughIt() {
        var ran: [[String]] = []
        let model = BrainModel(fetch: { #"{"jobs":{},"lessons":[],"captureLevel":"strict"}"# }, run: { args, _ in ran.append(args); return true })
        XCTAssertEqual(model.captureLevel, .strict)
        model.setCaptureLevel(.everything)
        XCTAssertEqual(ran, [["capture-level", "everything"]])
        XCTAssertEqual(model.captureLevel, .everything)
        model.setCaptureLevel(.everything)
        XCTAssertEqual(ran.count, 1, "no change, nothing run")
        // An engine from before SCR-95 says nothing: Balanced, what it always did.
        XCTAssertEqual(BrainModel(fetch: { #"{"jobs":{},"lessons":[]}"# }, run: { _, _ in true }).captureLevel, .balanced)
        XCTAssertTrue(CaptureLevel.everything.explanation.contains("never ticked"))
        XCTAssertTrue(CaptureLevel.strict.explanation.contains("Changes from Balanced"))
    }

    func testTheModelIsToldAGroupAskNamesNoOne() throws {
        let json = #"{"app":"WhatsApp","chat":"Ops","group":true,"addressed":"group","me":["Mike Rosen"],"from":"Ron","message":"Can someone restart staging?","before":[]}"#
        let request = try JSONDecoder().decode(Judge.ChatRequest.self, from: Data(json.utf8))
        XCTAssertTrue(Judge.chatPrompt(for: request).contains("It names no one"))
        let named = try JSONDecoder().decode(Judge.ChatRequest.self, from: Data(json.replacingOccurrences(of: #""group","me""#, with: #""named","me""#).utf8))
        XCTAssertFalse(Judge.chatPrompt(for: named).contains("It names no one"), "Balanced asks are worded as before")
    }

    /// Draws the list with the tray open to $TMPDIR/didja-ui/suggested.png.
    @MainActor
    func testRenderTheTray() throws {
        let navigator = TaskNavigator(scope: .popover)
        let tray = SuggestedTray(suggestions: [SuggestedAsk(id: 1, title: "Restart the staging server", source: "WhatsApp — Ops"),
                                               SuggestedAsk(id: 2, title: "Send the deck to Noa", source: "Teams — Launch")],
                                 expanded: .constant(true), actions: TaskActions())
        let view = VStack(alignment: .leading, spacing: 12) {
            PopoverTaskList(board: TaskBoardTests.sample, actions: TaskActions(), navigator: navigator)
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
        let png = try XCTUnwrap(image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?
            .representation(using: .png, properties: [:]))
        try png.write(to: dir.appendingPathComponent("suggested.png"))
    }
}
