import AppKit
import XCTest
@testable import Didja

/// SCR-122: Undo and Redo of your own changes. The engine keeps the history (engine/test/undo.test.ts);
/// these check the menu titles, the keys and reading the engine's answers.
final class UndoHistoryTests: XCTestCase {
    func testTitlesSayWhatWouldBeUndone() {
        let state = UndoHistory.parse(#"{"undo":"Mark Done (3)","redo":null}"#)
        XCTAssertEqual(state.undoTitle, "Undo Mark Done (3)")
        XCTAssertEqual(state.redoTitle, "Redo")
        XCTAssertNil(state.redo)
        XCTAssertEqual(UndoHistory.parse(nil), .empty, "no answer from the engine: nothing to undo")
        XCTAssertEqual(UndoHistory.parse("not json"), .empty)
    }

    func testTheEnginesAnswerSaysWhetherAnythingChanged() {
        XCTAssertTrue(UndoHistory.didChange("Undid Mark Done: 1 changed"))
        XCTAssertFalse(UndoHistory.didChange("Nothing to undo"))
        XCTAssertFalse(UndoHistory.didChange(nil))
    }

    func testTheMenuOffersUndoAndRedoWithTheirKeys() throws {
        let entries = AppDelegate().moreMenuEntries(history: UndoHistory(undo: "Reopen", redo: nil))
        let undo = try XCTUnwrap(MenuEntry.find(["Undo Reopen"], in: entries))
        XCTAssertEqual(undo.key, "z")
        XCTAssertEqual(undo.modifiers, [.command])
        XCTAssertTrue(undo.enabled)
        let redo = try XCTUnwrap(MenuEntry.find(["Redo"], in: entries))
        XCTAssertEqual(redo.modifiers, [.command, .shift])
        XCTAssertFalse(redo.enabled, "nothing to redo")
    }
}
