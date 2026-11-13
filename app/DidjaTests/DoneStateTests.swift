import SQLite3
import XCTest
@testable import Didja

/// SCR-68: the states that say "done" — checkboxes, switches, radio buttons, notices, and where a
/// link in a page's main content points. Every outline here is made up.
final class DoneStateTests: XCTestCase {
    private func lines(_ outline: String, app: String = "com.google.Chrome") throws -> [String] {
        var limits = AXCapture.Limits()
        limits.app = app
        limits.profiles = Profiles.all
        limits.skipFocusedInput = true
        return AXCapture.read(root: try OutlineElement.parse(outline), title: "", appName: "", limits: limits).lines
    }

    func testCheckedAndUncheckedBoxesAreWrittenBeforeTheirLabels() throws {
        let out = try lines("""
        AXWindow title="Settings"
         AXCheckBox title="Send a copy to Noa" value="1"
         AXCheckBox title="Mark as urgent" value="0"
         AXCheckBox desc="Include attachments" value="2"
         AXRadioButton title="Weekly" value="1"
         AXRadioButton title="Monthly" value="0"
        """)
        XCTAssertEqual(out, ["[x] Send a copy to Noa", "[ ] Mark as urgent", "[-] Include attachments", "[x] Weekly", "[ ] Monthly"])
    }

    func testASwitchIsOnOrOff() throws {
        let out = try lines("""
        AXWindow title="Repository settings"
         AXCheckBox/AXSwitch title="Public" value="1"
         AXCheckBox/AXSwitch title="Discussions" value="0"
        """)
        XCTAssertEqual(out, ["[on] Public", "[off] Discussions"])
    }

    func testATaskListBoxWithNoLabelGoesBeforeTheTextAfterIt() throws {
        let out = try lines("""
        AXWindow title="Weekly checklist"
         AXWebArea url="https://notes.example.net/p/weekly" title="Weekly checklist"
          AXList
           AXGroup
            AXCheckBox value="1"
            AXStaticText value="Approve 4410"
           AXGroup
            AXCheckBox value="0"
            AXStaticText value="Book the venue"
          AXGroup
           AXStaticText value="Remember the form"
           AXCheckBox value="1"
        """)
        XCTAssertEqual(out, ["[x] Approve 4410", "[ ] Book the venue", "Remember the form [x]"])
    }

    func testACheckboxWithNoStateIsReadAsBefore() throws {
        let out = try lines("""
        AXWindow title="Form"
         AXCheckBox title="Agree"
         AXStaticText value="Next"
        """)
        XCTAssertEqual(out, ["Next"], "no value: nothing is made up")
        XCTAssertEqual(AXCapture.stateMark(role: "AXCheckBox", subrole: "", value: nil), nil)
        XCTAssertEqual(AXCapture.stateMark(role: "AXSwitch", subrole: "", value: 1), "[on]")
    }

    func testNothingIsReadFromASecureFieldNextToABox() throws {
        let out = try lines("""
        AXWindow title="Sign in"
         AXTextField/AXSecureTextField value="hunter2"
         AXCheckBox title="Remember me" value="1"
        """)
        XCTAssertEqual(out, ["[x] Remember me"])
        XCTAssertFalse(out.joined().contains("hunter2"))
    }

    func testLinksInAPagesMainContentKeepWhereTheyPointWithoutTheQuery() throws {
        var outline = """
        AXWindow title="Deploys"
         AXWebArea url="https://ci.example.com/acme/shop/deploys" title="Deploys"
          AXGroup/AXLandmarkNavigation
           AXLink url="https://ci.example.com/acme/shop/settings"
            AXStaticText value="Settings"
          AXGroup/AXLandmarkMain
           AXGroup
            AXStaticText value="Deploy "
            AXLink url="https://ci.example.com/acme/shop/deploys/981?token=secret#logs"
             AXStaticText value="981"
            AXStaticText value=" is live"
           AXLink url="https://ci.example.com/acme/shop/deploys#top"
            AXStaticText value="Back to top"
           AXLink url="mailto:sam@example.com"
            AXStaticText value="Email Sam"
        """
        var out = try lines(outline)
        XCTAssertEqual(out, ["Settings", "Deploy 981 ⟨https://ci.example.com/acme/shop/deploys/981⟩ is live", "Back to top", "Email Sam"],
                       "main content only, no query or fragment, not a link within the page, web addresses only")
        XCTAssertFalse(out.joined().contains("secret"))

        // At most `maxPageLinkTargets` from one page.
        outline = "AXWindow title=\"List\"\n AXWebArea url=\"https://ci.example.com/list\"\n  AXGroup/AXLandmarkMain\n"
            + (1...30).map { "   AXGroup\n    AXLink url=\"https://ci.example.com/item/\($0)\"\n     AXStaticText value=\"Item \($0)\"" }.joined(separator: "\n")
        out = try lines(outline)
        XCTAssertEqual(out.filter { $0.contains("⟨") }.count, AXCapture.maxPageLinkTargets)
    }

    func testAChatOrEmailSiteKeepsItsOwnRulesForLinks() throws {
        // Gmail has its own profile: its links are kept only in an email's body, as before.
        let out = try lines("""
        AXWindow title="Inbox"
         AXWebArea url="https://mail.google.com/mail/u/0/#inbox" title="Inbox"
          AXGroup/AXLandmarkMain
           AXLink url="https://mail.google.com/mail/u/0/#settings"
            AXStaticText value="Settings"
        """)
        XCTAssertFalse(out.joined().contains("⟨"))
    }

    func testNoticesAreShortLinesWrittenOncePerWindow() {
        XCTAssertEqual(NoticeWatcher.notice(from: "  Message   sent "), "Message sent")
        XCTAssertEqual(NoticeWatcher.notice(from: ["Pull request #42", "merged"]), "Pull request #42 merged")
        XCTAssertNil(NoticeWatcher.notice(from: ["a", "b", "c"]), "a whole block is not a notice")
        XCTAssertNil(NoticeWatcher.notice(from: String(repeating: "word ", count: 20)), "too long")
        XCTAssertNil(NoticeWatcher.notice(from: "42"), "no words")
        XCTAssertNil(NoticeWatcher.notice(from: "⟦Message 3⟧"), "never a section line")
        XCTAssertEqual(NoticeWatcher.line("Saved"), "⟦Notice: Saved⟧")

        var watcher = NoticeWatcher()
        let t0 = Date(timeIntervalSince1970: 1_000_000)
        XCTAssertEqual(watcher.fresh(windowKey: "w", notices: ["Saved", "Saved"], now: t0), ["Saved"])
        XCTAssertEqual(watcher.fresh(windowKey: "w", notices: ["Saved"], now: t0.addingTimeInterval(5)), [])
        XCTAssertEqual(watcher.fresh(windowKey: "other", notices: ["Saved"], now: t0.addingTimeInterval(5)), ["Saved"])
        XCTAssertEqual(watcher.fresh(windowKey: "w", notices: ["Saved"], now: t0.addingTimeInterval(61)), ["Saved"])
    }

    func testDiagnosticsWriteABoxStateDown() throws {
        let root = try OutlineElement.parse("AXWindow\n AXCheckBox title=\"Public\" value=\"1\"")
        let copy = try XCTUnwrap(OutlineElement.copy(root))
        XCTAssertEqual(copy.children()[0].number("AXValue"), 1)
    }
}

/// SCR-69: an editor's built-in terminal, while it has focus, is written under "⟦Terminal⟧".
final class EditorTerminalTests: XCTestCase {
    private func lines(_ outline: String, app: String) throws -> [String] {
        var limits = AXCapture.Limits()
        limits.app = app
        limits.profiles = Profiles.all
        limits.skipFocusedInput = true
        return AXCapture.read(root: try OutlineElement.parse(outline), title: "", appName: "", limits: limits).lines
    }

    private func editor(focused: Bool) -> String {
        """
        AXWindow title="release.ts — acme-web"
         AXWebArea
          AXGroup
           AXStaticText value="export const version = 2"
          AXGroup class="terminal xterm"
           AXGroup class="xterm-accessibility-tree"
            AXGroup
             AXStaticText value="sam@mac acme-web % git push origin main"
            AXGroup
             AXStaticText value="Everything up-to-date"
           AXGroup class="xterm-helper"
            AXTextArea class="xterm-helper-textarea" value=""\(focused ? " focused" : "")
          AXGroup
           AXStaticText value="Ln 4, Col 12"
        """
    }

    func testAFocusedTerminalInVSCodeIsItsOwnSection() throws {
        let out = try lines(editor(focused: true), app: "com.microsoft.VSCode")
        XCTAssertEqual(out, ["export const version = 2", "⟦Terminal⟧", "sam@mac acme-web % git push origin main",
                             "Everything up-to-date", "⟦Page⟧", "Ln 4, Col 12"])
    }

    func testATerminalWithoutFocusOrInAnotherAppIsNotMarked() throws {
        XCTAssertFalse(try lines(editor(focused: false), app: "com.microsoft.VSCode").contains("⟦Terminal⟧"))
        XCTAssertFalse(try lines(editor(focused: true), app: "com.google.Chrome").contains("⟦Terminal⟧"))
    }
}

/// SCR-70: a list kept while no model could judge it is read as "maybe".
final class MaybeTaskTests: XCTestCase {
    func testALowConfidenceTaskIsMaybeAndOthersAreNot() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = try ObservationStore(directory: dir, migrations: ObservationStore.bundledMigrations())
        var db: OpaquePointer?
        XCTAssertEqual(sqlite3_open(dir.appendingPathComponent("didja.db").path, &db), SQLITE_OK)
        XCTAssertEqual(sqlite3_exec(db, """
            INSERT INTO sources (id, kind, ref) VALUES (1, 'claude', 'Claude — Demo');
            INSERT INTO tasks (id, title, source, confidence, dedupe_key, created_at, last_seen_at)
            VALUES (1, 'Maybe one', 1, 0.2, 'one', '2026-11-10T12:00:00.000Z', '2026-11-10T12:00:00.000Z'),
                   (2, 'Sure one', 1, 0.3, 'two', '2026-11-10T12:00:00.000Z', '2026-11-10T12:00:00.000Z'),
                   (3, 'Checking one', 1, 0.1, 'three', '2026-11-10T12:00:00.000Z', '2026-11-10T12:00:00.000Z');
            """, nil, nil, nil), SQLITE_OK)
        sqlite3_close(db)
        let tasks = try store.tasks()
        XCTAssertEqual(tasks.first { $0.id == 1 }?.maybe, true)
        XCTAssertEqual(tasks.first { $0.id == 2 }?.maybe, false)
        // SCR-78: below "maybe" is a list the model is still checking.
        XCTAssertEqual(tasks.first { $0.id == 3 }?.checking, true)
        XCTAssertEqual(tasks.first { $0.id == 3 }?.maybe, false)
        XCTAssertEqual(tasks.first { $0.id == 1 }?.checking, false)
        XCTAssertEqual(tasks.first { $0.id == 2 }?.checking, false)
    }
}
