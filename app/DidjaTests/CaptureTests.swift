import Carbon.HIToolbox
import SQLite3
import SwiftUI
import XCTest
@testable import Didja

final class LineBuilderTests: XCTestCase {
    private func text(_ s: String) -> AXNode { AXNode(role: "AXStaticText", text: s) }
    private func group(_ children: AXNode..., subrole: String = "") -> AXNode {
        AXNode(role: "AXGroup", subrole: subrole, children: children)
    }
    private func marker(_ s: String) -> AXNode { AXNode(role: "AXListMarker", text: s) }
    private func list(_ items: AXNode...) -> AXNode { AXNode(role: "AXList", subrole: "AXContentList", children: items) }

    func testInlineCodeBoldAndLinksStayOnOneLine() {
        let paragraph = group(
            text("Create a private repo with "),
            group(text("gh repo create didja --private"), subrole: "AXCodeStyleGroup"),
            text(", then see "),
            AXNode(role: "AXLink", children: [text("the docs")]),
            text("."))
        XCTAssertEqual(AXCapture.lines(from: paragraph),
                       ["Create a private repo with `gh repo create didja --private`, then see the docs."])
    }

    func testNumberedListKeepsMarkersAndIndentsNestedLists() {
        // Mirrors what Claude desktop exposes for a rendered list.
        let tree = group(
            AXNode(role: "AXHeading", children: [text("Claude responded: Two options")]),
            group(text("Two options:")),
            list(
                group(
                    marker("1. "),
                    group(text("Fix the capture flaws"), subrole: "AXStrongStyleGroup"),
                    text(" (small):"),
                    list(
                        group(marker("• "), text("Inline code is cut from titles")),
                        group(marker("• "), text("Steps 4–6 were missed"))),
                    group(text("Milestone 2 depends on this."))),
                group(marker("2. "), text("Start Milestone 2"))),
            group(text("Say which.")))
        XCTAssertEqual(AXCapture.lines(from: tree), [
            "Claude responded: Two options",
            "Two options:",
            "1. Fix the capture flaws (small):",
            "  • Inline code is cut from titles",
            "  • Steps 4–6 were missed",
            "  Milestone 2 depends on this.",
            "2. Start Milestone 2",
            "Say which.",
        ])
    }

    func testListItemTextInsideAParagraphJoinsItsMarker() {
        let tree = list(
            group(marker("1. "), group(text("Set "), group(text("API_KEY"), subrole: "AXCodeStyleGroup"), text(" in Vercel"))),
            group(marker("2. "), group(text("Redeploy"))))
        XCTAssertEqual(AXCapture.lines(from: tree), ["1. Set `API_KEY` in Vercel", "2. Redeploy"])
    }

    func testBoldLeadInFollowedBySoftBreakStartsANewLine() {
        let item = list(group(marker("1. "), group(text("Check the app values"), subrole: "AXStrongStyleGroup"), text("Scroll down in the panel.")))
        XCTAssertEqual(AXCapture.lines(from: item), ["1. Check the app values", "  Scroll down in the panel."])
        // Not a soft break: text that simply continues after inline code.
        let code = group(text("Set "), group(text("API_KEY"), subrole: "AXCodeStyleGroup"), text(" and Restart"))
        XCTAssertEqual(AXCapture.lines(from: code), ["Set `API_KEY` and Restart"])
    }

    func testFileLinkButtonInsideASentenceIsKept() {
        let item = group(text("Remove the key from "), AXNode(role: "AXButton", text: ".env"), text("."))
        XCTAssertEqual(AXCapture.lines(from: item), ["Remove the key from .env."])
        // Buttons that are not part of a sentence stay out.
        let toolbar = group(AXNode(role: "AXButton", text: "Copy"), group(text("Hello")), AXNode(role: "AXButton", text: "Retry"))
        XCTAssertEqual(AXCapture.lines(from: toolbar), ["Hello"])
    }

    func testCodeBlocksBecomeIndentedLinesUnderTheirItem() {
        let block = group(text("supabase db push\nvercel deploy --prod"), subrole: "AXCodeStyleGroup")
        let tree = list(group(marker("1. "), text("Run the migration:"), group(block)))
        XCTAssertEqual(AXCapture.lines(from: tree), ["1. Run the migration:", "  supabase db push", "  vercel deploy --prod"])
    }

    func testEachChatMessageStartsWithASectionLine() {
        let article = { (name: String, children: [AXNode]) in
            AXNode(role: "AXGroup", subrole: "AXDocumentArticle", text: name, children: children)
        }
        let tree = group(
            article("Message 4", [group(text("give me a checklist")), AXNode(role: "AXHeading", children: [text("You said: give me a checklist")])]),
            article("Message 5", [list(group(marker("1. "), text("Run the tests")))]))
        XCTAssertEqual(AXCapture.lines(from: tree), [
            "⟦Message 4⟧", "give me a checklist", "You said: give me a checklist",
            "⟦Message 5⟧", "1. Run the tests",
        ])
    }

    func testTextAreaKeepsLinesAndIndentation() {
        let terminal = AXNode(role: "AXTextArea", text: "⏺ Next steps:\n  1. Set the env var\n     in Vercel\n\n  2. Redeploy   \n")
        XCTAssertEqual(AXCapture.lines(from: group(terminal)),
                       ["⏺ Next steps:", "  1. Set the env var", "     in Vercel", "  2. Redeploy"])
    }

    func testButtonsAndEmptyNodesProduceNoLines() {
        let tree = group(AXNode(role: "AXButton"), group(), text("   "), group(text("Hello")))
        XCTAssertEqual(AXCapture.lines(from: tree), ["Hello"])
    }
}

final class DifferTests: XCTestCase {
    func testOnlyNewLinesAreReported() {
        var differ = Differ()
        XCTAssertEqual(differ.newLines(windowKey: "w", lines: ["a", "b"]), ["a", "b"])
        XCTAssertEqual(differ.newLines(windowKey: "w", lines: ["a", "b"]), [])
        XCTAssertEqual(differ.newLines(windowKey: "w", lines: ["a", "b", "c", "c"]), ["c"])
        // "a" scrolled away and came back: it was not in the last snapshot, so it is new again.
        XCTAssertEqual(differ.newLines(windowKey: "w", lines: ["c", "d"]), ["d"])
        XCTAssertEqual(differ.newLines(windowKey: "w", lines: ["a", "d"]), ["a"])
    }

    func testANewLineComesWithItsSectionLineEvenIfThatSectionIsOld() {
        var differ = Differ()
        XCTAssertEqual(differ.newLines(windowKey: "w", lines: ["⟦Message 1⟧", "hello", "⟦Message 2⟧", "1. Run it"]),
                       ["⟦Message 1⟧", "hello", "⟦Message 2⟧", "1. Run it"])
        // Message 2 grows; message 1 is unchanged and stays out.
        XCTAssertEqual(differ.newLines(windowKey: "w", lines: ["⟦Message 1⟧", "hello", "⟦Message 2⟧", "1. Run it", "2. Check it"]),
                       ["⟦Message 2⟧", "2. Check it"])
        // A new empty section on its own is not news.
        XCTAssertEqual(differ.newLines(windowKey: "w", lines: ["⟦Message 1⟧", "hello", "⟦Message 2⟧", "1. Run it", "2. Check it", "⟦Message 3⟧"]), [])
    }

    /// SCR-63: "Done" under a new message is new, though an older message says "Done" too.
    func testANewDoneUnderANewSectionIsReportedWhenAnOlderMessageSaysDone() {
        var differ = Differ()
        let before = ["⟦Chat message: Sam (direct) — from me — 9:55⟧", "Done",
                      "⟦Chat message: Sam (direct) — from Sam — 10:05⟧", "Can you send the deck?"]
        XCTAssertEqual(differ.newLines(windowKey: "w", lines: before), before)
        // The same snapshot twice: nothing.
        XCTAssertEqual(differ.newLines(windowKey: "w", lines: before), [])
        let after = before + ["⟦Chat message: Sam (direct) — from me — 10:20⟧", "Done"]
        XCTAssertEqual(differ.newLines(windowKey: "w", lines: after),
                       ["⟦Chat message: Sam (direct) — from me — 10:20⟧", "Done"])
        XCTAssertEqual(differ.newLines(windowKey: "w", lines: after), [])
        // The older message scrolls away: nothing new.
        XCTAssertEqual(differ.newLines(windowKey: "w", lines: Array(after.dropFirst(2))), [])
    }

    /// SCR-63: two messages in the same minute under the same section name: the second "Sent" is new.
    func testASecondIdenticalLineInTheSameSectionIsNew() {
        var differ = Differ()
        let one = ["⟦Chat message: Sam (direct) — from me — 10:20⟧", "Sent"]
        XCTAssertEqual(differ.newLines(windowKey: "w", lines: one), one)
        XCTAssertEqual(differ.newLines(windowKey: "w", lines: one + one), one)
        XCTAssertEqual(differ.newLines(windowKey: "w", lines: one + one), [])
    }

    /// SCR-63: a command run again after its output is a new line, and so is its new output.
    func testATerminalReRunIsReported() {
        var differ = Differ()
        let first = ["~/acme % bun test", " 12 pass", " 0 fail", "~/acme % "]
        XCTAssertEqual(differ.newLines(windowKey: "t", lines: first), first)
        let rerun = ["~/acme % bun test", " 12 pass", " 0 fail", "~/acme % bun test", " 12 pass", " 0 fail", "~/acme % "]
        XCTAssertEqual(differ.newLines(windowKey: "t", lines: rerun), ["~/acme % bun test", " 12 pass", " 0 fail"])
        XCTAssertEqual(differ.newLines(windowKey: "t", lines: rerun), [])
    }

    func testWindowsAreTrackedSeparatelyAndOldOnesForgotten() {
        var differ = Differ(capacity: 2)
        XCTAssertEqual(differ.newLines(windowKey: "one", lines: ["x"]), ["x"])
        XCTAssertEqual(differ.newLines(windowKey: "two", lines: ["x"]), ["x"])
        XCTAssertEqual(differ.newLines(windowKey: "one", lines: ["x"]), [])
        XCTAssertEqual(differ.newLines(windowKey: "three", lines: ["x"]), ["x"]) // evicts "two"
        XCTAssertEqual(differ.newLines(windowKey: "two", lines: ["x"]), ["x"])
    }

    func testWindowKeyIgnoresQueryStringsAndTitleDecorations() {
        XCTAssertEqual(Differ.windowKey(bundleID: "b", title: "t", url: "https://vercel.com/a/env?tab=1#x"),
                       "b|https://vercel.com/a/env")
        XCTAssertEqual(Differ.windowKey(bundleID: "b", title: "✳ Fix auth", url: nil),
                       Differ.windowKey(bundleID: "b", title: "⠂ Fix auth", url: nil))
    }
}

final class PrivacyTests: XCTestCase {
    func testPasswordManagersAndSystemPromptsAreDeniedByDefault() throws {
        let policy = try PrivacyPolicy()
        for id in ["com.1password.1password", "com.agilebits.onepassword7", "com.bitwarden.desktop",
                   "com.apple.keychainaccess", "com.apple.Passwords", "com.apple.SecurityAgent"] {
            XCTAssertFalse(policy.allowsApp(bundleID: id), id)
        }
        XCTAssertTrue(policy.allowsApp(bundleID: "com.anthropic.claudefordesktop"))
        XCTAssertTrue(policy.allowsApp(bundleID: "com.apple.Notes"))
    }

    func testPrivateWindowsAreDenied() throws {
        let policy = try PrivacyPolicy()
        XCTAssertFalse(policy.allowsWindow(title: "New Tab - Google Chrome (Incognito)"))
        XCTAssertFalse(policy.allowsWindow(title: "Example — Private Browsing"))
        XCTAssertFalse(policy.allowsWindow(title: "[InPrivate] Bing - Microsoft Edge"))
        XCTAssertTrue(policy.allowsWindow(title: "Deploy checklist"))
    }

    /// OCR reads the window you are in, never another of the app's windows (SCR-18).
    /// It used to fall back to the app's largest window when the title did not
    /// match, and that window's title was never checked against the exclude list.
    func testOCRReadsOnlyTheFocusedWindowAndChecksItsTitle() throws {
        let policy = try PrivacyPolicy()
        let allows = policy.allowsWindow(title:)
        // The window with the focused title, wherever it is in the list.
        XCTAssertEqual(OCRCapture.pick(titles: ["Notes", "Deploy checklist"], focusedTitle: "Deploy checklist", allows: allows), 1)
        // No match among several: nothing is read, not the biggest one.
        XCTAssertNil(OCRCapture.pick(titles: ["New Tab - Google Chrome (Incognito)", "Docs"], focusedTitle: "Untitled", allows: allows))
        XCTAssertNil(OCRCapture.pick(titles: [nil, "Docs"], focusedTitle: "", allows: allows))
        // A single window is the one you are in, if its own title passes.
        XCTAssertEqual(OCRCapture.pick(titles: ["Canvas"], focusedTitle: "", allows: allows), 0)
        XCTAssertEqual(OCRCapture.pick(titles: [nil], focusedTitle: "", allows: allows), 0)
        XCTAssertNil(OCRCapture.pick(titles: ["Example — Private Browsing"], focusedTitle: "", allows: allows))
        // No windows: nothing.
        XCTAssertNil(OCRCapture.pick(titles: [], focusedTitle: "Docs", allows: allows))
    }

    func testUserAdditions() throws {
        let policy = try PrivacyPolicy(bundleIds: ["com.MyBank.app"], windowPatterns: ["payroll"], urlPatterns: ["mybank\\.com"])
        XCTAssertFalse(policy.allowsApp(bundleID: "com.mybank.app"))
        XCTAssertFalse(policy.allowsWindow(title: "Payroll — March"))
        XCTAssertFalse(policy.allowsURL("https://www.mybank.com/accounts"))
        XCTAssertTrue(policy.allowsURL("https://vercel.com"))
        XCTAssertTrue(policy.allowsURL(nil))
        XCTAssertFalse(policy.allowsApp(bundleID: "com.1password.1password"), "defaults still apply")
    }

    func testMalformedUserFileIsRejected() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let file = dir.appendingPathComponent("exclude.json")

        XCTAssertNoThrow(try PrivacyPolicy.load(userFile: file), "a missing file means defaults only")
        try "{ not json".write(to: file, atomically: true, encoding: .utf8)
        XCTAssertThrowsError(try PrivacyPolicy.load(userFile: file))
        try #"{"windowPatterns": ["("]}"#.write(to: file, atomically: true, encoding: .utf8)
        XCTAssertThrowsError(try PrivacyPolicy.load(userFile: file))
        try #"{"bundleIds": ["com.mybank.app"]}"#.write(to: file, atomically: true, encoding: .utf8)
        XCTAssertFalse(try PrivacyPolicy.load(userFile: file).allowsApp(bundleID: "com.mybank.app"))
    }

    func testSecureFieldsAreRecognised() {
        XCTAssertTrue(PrivacyPolicy.isSecureField(role: "AXTextField", subrole: "AXSecureTextField"))
        XCTAssertFalse(PrivacyPolicy.isSecureField(role: "AXTextField", subrole: ""))
    }
}

final class ObservationStoreTests: XCTestCase {
    func testInsertCountAndExpiry() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let migrations = ObservationStore.bundledMigrations()
        XCTAssertEqual(migrations.map(\.version).sorted(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21], "every schema step must be bundled with the app")
        let store = try ObservationStore(directory: dir, migrations: migrations)

        let now = Date()
        try store.insert(bundleID: "a", app: "A", windowTitle: "w", url: nil, source: .ax, text: "old",
                         at: now.addingTimeInterval(-25 * 3600))
        try store.insert(bundleID: "a", app: "A", windowTitle: "w", url: "https://x.test", source: .ocr, text: "new", at: now)
        XCTAssertEqual(try store.observationCount(), 2)
        XCTAssertEqual(try store.deleteObservations(olderThan: now.addingTimeInterval(-24 * 3600)), 1)
        XCTAssertEqual(try store.observationCount(), 1)

        XCTAssertEqual(try store.tasks(), [], "no tasks until the engine writes some")

        // A task as the engine writes it comes back with the time it was captured.
        var db: OpaquePointer?
        XCTAssertEqual(sqlite3_open(dir.appendingPathComponent("didja.db").path, &db), SQLITE_OK)
        XCTAssertEqual(sqlite3_exec(db, """
            INSERT INTO sources (id, kind, ref) VALUES (1, 'window', 'Claude — Demo');
            INSERT INTO tasks (title, source, dedupe_key, created_at, last_seen_at)
            VALUES ('Rotate the key', 1, 'k', '2026-11-10T12:00:00.000Z', '2026-11-10T12:05:00.000Z');
            """, nil, nil, nil), SQLITE_OK)
        sqlite3_close(db)
        XCTAssertEqual(try store.tasks().map(\.capturedAt), [Date(timeIntervalSince1970: 1_794_312_000)])

        // Reopening an existing database must not re-apply or break the schema.
        XCTAssertEqual(try ObservationStore(directory: dir, migrations: migrations).observationCount(), 1)
    }
}

final class PrivacyTests2: XCTestCase {
    private func facts(_ change: (inout PrivacyFacts) -> Void = { _ in }) -> PrivacyFacts {
        var facts = PrivacyFacts(retention: .day, observationCount: 1234, taskCount: 87, excludedApps: 2, excludedTitles: 1,
                                 excludedSites: 0, screenRecordingGranted: false, modelStatus: "Available",
                                 dataFolder: "~/Library/Application Support/Didja/didja.db", isPaused: false)
        change(&facts)
        return facts
    }

    func testTheWordsFollowTheFacts() {
        XCTAssertEqual(facts().excludeSummary, "2 apps, 1 window title")
        XCTAssertEqual(facts { $0.excludedApps = 0; $0.excludedTitles = 0 }.excludeSummary, "nothing added yet")
        XCTAssertEqual(facts { $0.excludedSites = 1; $0.excludedApps = 1 }.excludeSummary, "1 app, 1 window title, 1 site")
        XCTAssertEqual(facts().retentionWords, "24 hours")
        XCTAssertEqual(facts { $0.retention = .hour }.retentionWords, "1 hour")
        XCTAssertEqual(facts { $0.retention = .sixHours }.retentionWords, "6 hours")
        XCTAssertEqual(facts().profileSummary, "none")
        let profiles: [AppProfile.Summary] = [.init(name: "WhatsApp", kind: .chat, status: .builtIn),
                                              .init(name: "Acme Chat", kind: .chat, status: .communityNew),
                                              .init(name: "Gmail", kind: .email, status: .builtIn),
                                              .init(name: "Mailbox", kind: .email, status: .community)]
        XCTAssertEqual(facts { $0.profiles = profiles }.profileSummary,
                       "WhatsApp, Acme Chat (community, new) for chats; Gmail, Mailbox (community) for email")
    }

    func testTheModelStatusIsWordedForPeople() {
        XCTAssertFalse(Judge.modelStatus.isEmpty)
        XCTAssertFalse(Judge.modelStatus.contains("unavailable("), "never a raw enum description")
    }

    /// Draws the window to $TMPDIR/didja-ui/privacy.png and privacy-dark.png, and
    /// puts it in a real window to check it lays out without resizing its window.
    @MainActor
    func testRenderPrivacy() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        for (name, scheme) in [("privacy", ColorScheme.light), ("privacy-dark", ColorScheme.dark)] {
            let view = PrivacyContent(facts: facts { $0.profiles = AppProfiles.builtIn.map(\.summary) })
                .environment(\.colorScheme, scheme)
            let renderer = ImageRenderer(content: view)
            renderer.scale = 2
            let image = try XCTUnwrap(renderer.nsImage)
            XCTAssertEqual(image.size.width, PrivacyView.width)
            let png = try XCTUnwrap(image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?
                .representation(using: .png, properties: [:]))
            try png.write(to: dir.appendingPathComponent("\(name).png"))
        }
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: PrivacyView.width, height: 640),
                              styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentViewController = NSHostingController(rootView: PrivacyView(facts: facts()))
        window.setContentSize(NSSize(width: PrivacyView.width, height: 640))
        window.orderFront(nil)
        window.layoutIfNeeded()
        window.displayIfNeeded()
        (window.contentViewController as? NSHostingController<PrivacyView>)?.rootView = PrivacyView(facts: facts { $0.isPaused = true })
        window.layoutIfNeeded()
        XCTAssertEqual(window.contentLayoutRect.width, PrivacyView.width)
        window.close()
    }
}

final class MenuBarClickTests: XCTestCase {
    func testAClickOnTheIconClosesAnOpenPanelInsteadOfReopeningIt() {
        let now = Date()
        // The panel shut itself on mouse-down a moment ago: this is the same click.
        XCTAssertFalse(MenuBarPanel.clickOpens(isShown: false, closedAt: now.addingTimeInterval(-0.1), now: now))
        // Closed a while ago: a click opens it.
        XCTAssertTrue(MenuBarPanel.clickOpens(isShown: false, closedAt: now.addingTimeInterval(-2), now: now))
        XCTAssertTrue(MenuBarPanel.clickOpens(isShown: false, closedAt: .distantPast, now: now))
        XCTAssertFalse(MenuBarPanel.clickOpens(isShown: true, closedAt: .distantPast, now: now))
    }
}

final class ArchiveWatcherTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)
    private func pane(_ subject: String?, notice: Bool = false) -> [String] {
        ["Inbox", "Archive"] + (subject.map { ["⟦Email: \($0)⟧", "From: Dana Levi", "Hello"] } ?? []) + (notice ? ["Archived"] : [])
    }

    /// SCR-30: the panel closes on the first Esc and when you go to another app.
    func testPanelClosesOnEscAndAppSwitch() {
        XCTAssertTrue(MenuBarPanel.escCloses(panelShown: true, inPanel: true, inOtherOwnWindow: false))
        // The keyboard had not reached the panel yet: Esc still closes it.
        XCTAssertTrue(MenuBarPanel.escCloses(panelShown: true, inPanel: false, inOtherOwnWindow: false))
        // Esc in the task window or Settings is theirs, not the panel's.
        XCTAssertFalse(MenuBarPanel.escCloses(panelShown: true, inPanel: false, inOtherOwnWindow: true))
        XCTAssertFalse(MenuBarPanel.escCloses(panelShown: false, inPanel: false, inOtherOwnWindow: false))
        XCTAssertTrue(MenuBarPanel.closesOnOutsideActivity(popoverShown: true, pinnedShown: false, staysOpen: false))
        XCTAssertFalse(MenuBarPanel.closesOnOutsideActivity(popoverShown: false, pinnedShown: false, staysOpen: false))
    }

    /// SCR-39: clicking in or switching to another app closes the panel, under the icon and
    /// pinned alike, unless you chose to keep it open.
    func testPanelClosesWhenYouGoElsewhereUnlessYouKeepItOpen() {
        XCTAssertTrue(MenuBarPanel.closesOnOutsideActivity(popoverShown: false, pinnedShown: true, staysOpen: false),
                      "the pinned panel closes too")
        XCTAssertFalse(MenuBarPanel.closesOnOutsideActivity(popoverShown: true, pinnedShown: false, staysOpen: true))
        XCTAssertFalse(MenuBarPanel.closesOnOutsideActivity(popoverShown: false, pinnedShown: true, staysOpen: true))
        // Not in the moment it opens (pinning reopens it while the app you came from comes back).
        XCTAssertFalse(MenuBarPanel.closesOnOutsideActivity(popoverShown: true, pinnedShown: false, staysOpen: false, sinceShown: 0.1))
        XCTAssertTrue(MenuBarPanel.closesOnOutsideActivity(popoverShown: true, pinnedShown: false, staysOpen: false, sinceShown: 1))
        // Didja itself coming to the front is not "elsewhere".
        XCTAssertFalse(MenuBarPanel.isOtherApp(42, own: 42))
        XCTAssertTrue(MenuBarPanel.isOtherApp(43, own: 42))
        XCTAssertFalse(MenuBarPanel.isOtherApp(nil, own: 42))
        XCTAssertEqual(PanelStaysOpen.popoverBehavior(false), .transient)
        XCTAssertEqual(PanelStaysOpen.popoverBehavior(true), .applicationDefined)
    }

    /// SCR-39: the setting is off unless you turn it on, and is kept.
    func testKeepPanelOpenIsOffByDefaultAndKept() {
        let defaults = UserDefaults.standard
        let before = defaults.object(forKey: PanelStaysOpen.key)
        defer { defaults.set(before, forKey: PanelStaysOpen.key) }
        defaults.removeObject(forKey: PanelStaysOpen.key)
        XCTAssertFalse(PanelStaysOpen.isOn, "by default the panel closes")
        let changed = expectation(forNotification: PanelStaysOpen.didChange, object: nil)
        PanelStaysOpen.isOn = true
        wait(for: [changed], timeout: 1)
        XCTAssertTrue(defaults.bool(forKey: PanelStaysOpen.key))
        PanelStaysOpen.isOn = false
        XCTAssertFalse(PanelStaysOpen.isOn)
    }

    func testTheEmailThatLeftJustBeforeTheNoticeWasArchived() {
        var watcher = ArchiveWatcher()
        XCTAssertEqual(watcher.archived(windowKey: "w", lines: pane("Q3 numbers"), now: t0), [])
        // As recorded in Outlook: the next email takes its place, the notice shows 0.8s later.
        XCTAssertEqual(watcher.archived(windowKey: "w", lines: pane("Lunch?"), now: t0 + 1), [])
        XCTAssertTrue(watcher.wantsAnotherLook, "an email left: look again soon for the notice")
        XCTAssertEqual(watcher.archived(windowKey: "w", lines: pane("Lunch?", notice: true), now: t0 + 1.8), ["Q3 numbers"])
        XCTAssertFalse(watcher.wantsAnotherLook)
        // Reported once; the email now open is untouched when the notice goes away or you read on.
        XCTAssertEqual(watcher.archived(windowKey: "w", lines: pane("Lunch?", notice: true), now: t0 + 2.5), [])
        XCTAssertEqual(watcher.archived(windowKey: "w", lines: pane("Offsite", notice: true), now: t0 + 3), [])
        XCTAssertEqual(watcher.archived(windowKey: "w", lines: pane("Offsite"), now: t0 + 7), [])
    }

    func testNoticeAndDepartureInOneStepCountToo() {
        var watcher = ArchiveWatcher()
        _ = watcher.archived(windowKey: "w", lines: pane("Q3 numbers"), now: t0)
        XCTAssertEqual(watcher.archived(windowKey: "w", lines: pane(nil, notice: true), now: t0 + 4), ["Q3 numbers"])
    }

    func testOnlyTheLastEmailToLeaveIsTheOneArchived() {
        // Click from one email to another, then archive that one straight away.
        var watcher = ArchiveWatcher()
        _ = watcher.archived(windowKey: "w", lines: pane("Q3 numbers"), now: t0)
        _ = watcher.archived(windowKey: "w", lines: pane("Lunch?"), now: t0 + 0.5)
        _ = watcher.archived(windowKey: "w", lines: pane("Offsite"), now: t0 + 1.2)
        XCTAssertEqual(watcher.archived(windowKey: "w", lines: pane("Offsite", notice: true), now: t0 + 2), ["Lunch?"])
    }

    /// The sequence recorded in Outlook for Mac on 10 Nov 2026 (subjects replaced by letters).
    /// Two emails were archived, A and D. B and E left the pane while the notice was up and were
    /// not archived: E came back five seconds later. Only A and D may be reported.
    func testTheRecordedOutlookSessionReportsOnlyWhatWasArchived() {
        var watcher = ArchiveWatcher()
        var reported: [String] = []
        func at(_ seconds: TimeInterval, _ subject: String?, notice: Bool) {
            reported += watcher.archived(windowKey: "w", lines: pane(subject, notice: notice), now: t0 + seconds)
        }
        at(160.0, "A", notice: false)
        at(163.1, nil, notice: true)       // A leaves and the notice appears together
        at(164.9, "B", notice: true)
        at(167.3, "C", notice: true)       // B leaves while the notice is up: not an archive
        XCTAssertTrue(watcher.wantsAnotherLook)
        at(168.2, nil, notice: false)      // C leaves, the notice goes away…
        XCTAssertTrue(watcher.wantsAnotherLook, "the notice may be about to come back")
        at(169.0, nil, notice: true)       // …and comes back: C was archived
        at(169.8, "E", notice: true)
        at(171.4, nil, notice: true)       // E leaves while the notice is up…
        at(173.8, nil, notice: false)
        at(176.9, "E", notice: false)      // …and comes back: it was never archived
        XCTAssertEqual(reported, ["A", "C"])
    }

    func testArchivingAgainWhileTheNoticeIsUpIsCaughtWhenTheNoticeIsReplaced() {
        var watcher = ArchiveWatcher()
        _ = watcher.archived(windowKey: "w", lines: pane("Q3"), now: t0)
        XCTAssertEqual(watcher.archived(windowKey: "w", lines: pane("Lunch?", notice: true), now: t0 + 1), ["Q3"])
        // Archive "Lunch?" too, two seconds later: the notice is replaced, with a short gap.
        XCTAssertEqual(watcher.archived(windowKey: "w", lines: pane("Offsite", notice: true), now: t0 + 3), [])
        XCTAssertEqual(watcher.archived(windowKey: "w", lines: pane("Offsite"), now: t0 + 3.3), [])
        XCTAssertEqual(watcher.archived(windowKey: "w", lines: pane("Offsite", notice: true), now: t0 + 3.6), ["Lunch?"])
        // If no capture lands in the gap, nothing is reported: a miss, never a wrong dismissal.
        var missed = ArchiveWatcher()
        _ = missed.archived(windowKey: "w", lines: pane("Q3"), now: t0)
        _ = missed.archived(windowKey: "w", lines: pane("Lunch?", notice: true), now: t0 + 1)
        XCTAssertEqual(missed.archived(windowKey: "w", lines: pane("Offsite", notice: true), now: t0 + 3), [])
        XCTAssertEqual(missed.archived(windowKey: "w", lines: pane("Offsite", notice: true), now: t0 + 4), [])
    }

    func testWhatMustNotCountAsArchiving() {
        // Clicking another email: it leaves, with no notice.
        var watcher = ArchiveWatcher()
        _ = watcher.archived(windowKey: "w", lines: pane("Q3 numbers"), now: t0)
        XCTAssertEqual(watcher.archived(windowKey: "w", lines: pane("Lunch?"), now: t0 + 1), [])
        // A notice long after that is about something else.
        XCTAssertEqual(watcher.archived(windowKey: "w", lines: pane("Lunch?", notice: true), now: t0 + 9), [])

        // Something else was archived (from the list): the notice shows, nothing left the pane.
        watcher = ArchiveWatcher()
        _ = watcher.archived(windowKey: "w", lines: pane("Q3 numbers"), now: t0)
        XCTAssertEqual(watcher.archived(windowKey: "w", lines: pane("Q3 numbers", notice: true), now: t0 + 1), [])
        // …and clicking on to another email while the notice is still up is not archiving.
        XCTAssertEqual(watcher.archived(windowKey: "w", lines: pane("Lunch?", notice: true), now: t0 + 2), [])
        XCTAssertEqual(watcher.archived(windowKey: "w", lines: pane("Lunch?"), now: t0 + 6), [])

        // A notice already up when the window is first seen says nothing about what was open.
        watcher = ArchiveWatcher()
        XCTAssertEqual(watcher.archived(windowKey: "w", lines: pane(nil, notice: true), now: t0), [])
        XCTAssertEqual(watcher.archived(windowKey: "w", lines: pane("Lunch?", notice: true), now: t0 + 1), [])

        // Another window's notice.
        watcher = ArchiveWatcher()
        _ = watcher.archived(windowKey: "a", lines: pane("Q3 numbers"), now: t0)
        _ = watcher.archived(windowKey: "b", lines: pane(nil), now: t0)
        _ = watcher.archived(windowKey: "a", lines: pane(nil), now: t0 + 0.5)
        XCTAssertEqual(watcher.archived(windowKey: "b", lines: pane(nil, notice: true), now: t0 + 1), [])
    }

    func testOnlyTheNoticeItselfIsANotice() {
        XCTAssertTrue(ArchiveWatcher.isNotice("Archived"))
        XCTAssertTrue(ArchiveWatcher.isNotice("Conversation archived."))
        XCTAssertFalse(ArchiveWatcher.isNotice("Archive"), "the folder and the button")
        XCTAssertFalse(ArchiveWatcher.isNotice("Online Archive"))
        XCTAssertFalse(ArchiveWatcher.isNotice("I archived the old contracts yesterday"))
        XCTAssertEqual(ArchiveWatcher.subject(ofSection: "⟦Email 2: Re: Q3: numbers⟧"), "Re: Q3: numbers")
        XCTAssertNil(ArchiveWatcher.subject(ofSection: "⟦Page⟧"))
        XCTAssertEqual(ArchiveWatcher.line(forSubject: "Q3 numbers"), "⟦Archived email: Q3 numbers⟧")
    }
}

final class FocusAndSortTests: XCTestCase {
    private func item(_ id: Int, _ source: String, _ status: TaskItem.Status = .open, parent: Int? = nil, group: Bool = false,
                      active: Double) -> TaskItem {
        TaskItem(id: id, title: "t\(id)", status: status, source: source, parentID: parent, isGroup: group,
                 doneAt: nil, snoozedUntil: nil, capturedAt: Date(timeIntervalSince1970: 0),
                 activeAt: Date(timeIntervalSince1970: active))
    }

    private var tasks: [TaskItem] {
        [item(5, "Outlook on the web", active: 10),
         item(4, "Gmail", active: 50),
         item(3, "Claude — Billing", group: true, active: 5), item(31, "Claude — Billing", parent: 3, active: 90),
         item(2, "Claude — Stripe webhooks", active: 20),
         item(1, "Gmail", .done, active: 99)]
    }

    func testLatestFirstOrdersByMostRecentActivityIncludingSteps() {
        var board = TaskBoard(tasks: tasks)
        XCTAssertEqual(board.entries(.pending).map(\.id), [5, 4, 3, 2], "by source: as the store returns them")
        board.sort = .latest
        XCTAssertEqual(board.entries(.pending).map(\.id), [3, 4, 2, 5], "a checklist is as recent as its newest step")
        XCTAssertEqual(board.sections(.pending).map(\.source), ["Claude — Billing", "Gmail", "Claude — Stripe webhooks", "Outlook on the web"])
    }

    func testClaudeCodeIsItsOwnAppInFocus() {
        var board = TaskBoard(tasks: [item(1, "Claude Code — Fix auth (Ghostty)", active: 1), item(2, "Claude — Billing", active: 2),
                                      item(3, "Claude Code (iTerm2)", active: 3)])
        XCTAssertEqual(board.apps, ["Claude", "Claude Code"])
        board.focus = "Claude Code"
        XCTAssertEqual(board.entries(.pending).map(\.id), [1, 3])
        XCTAssertEqual(TaskBoard.app(of: "Claude Code (iTerm2)"), "Claude Code", "the terminal is not part of the app's name")
    }

    func testFocusShowsOneAppAndCountsOnlyIt() {
        var board = TaskBoard(tasks: tasks)
        XCTAssertEqual(board.apps, ["Claude", "Gmail", "Outlook on the web"])
        XCTAssertEqual(board.openStepCount, 4)
        board.focus = "Claude"
        XCTAssertEqual(board.entries(.pending).map(\.id), [3, 2])
        XCTAssertEqual(board.openStepCount, 2)
        XCTAssertEqual(board.count(.pending), 2)
        XCTAssertEqual(board.recentlyDone.map(\.id), [], "finished work from other apps is out of focus too")
        board.focus = "Gmail"
        XCTAssertEqual(board.entries(.pending).map(\.id), [4])
        XCTAssertEqual(board.count(.done), 1)
        // A focus with nothing left is still listed, so it can be seen and cleared.
        board.focus = "Linear"
        XCTAssertEqual(board.entries(.pending).map(\.id), [])
        XCTAssertTrue(board.apps.contains("Linear"))
    }
}

final class RetentionTests: XCTestCase {
    func testTheChoiceIsRememberedAndNeverMoreThanADay() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: UUID().uuidString))
        XCTAssertEqual(Retention.saved(in: defaults), .day, "24 hours unless you choose less")
        defaults.set(6, forKey: Retention.defaultsKey)
        XCTAssertEqual(Retention.saved(in: defaults), .sixHours)
        defaults.set(72, forKey: Retention.defaultsKey)
        XCTAssertEqual(Retention.saved(in: defaults), .day)
        XCTAssertEqual(Retention.allCases.map(\.seconds).max(), 24 * 3600)
        XCTAssertEqual(Retention.hour.short, "1h")
    }

    func testForgettingRemovesEveryObservationAndNoTask() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = try ObservationStore(directory: dir, migrations: ObservationStore.bundledMigrations())
        try store.insert(bundleID: "a", app: "A", windowTitle: "w", url: nil, source: .ax, text: "one")
        try store.insert(bundleID: "a", app: "A", windowTitle: "w", url: nil, source: .ax, text: "two",
                         at: Date().addingTimeInterval(-2 * 3600))
        XCTAssertEqual(try store.deleteObservations(olderThan: Date().addingTimeInterval(-Retention.hour.seconds)), 1)
        XCTAssertEqual(try store.deleteObservations(olderThan: .distantFuture), 1)
        XCTAssertEqual(try store.observationCount(), 0)
    }
}

/// SCR-31: the lines kept with open tasks are screen text, so they go with "Forget Captured
/// Text Now" and when their window joins the exclude list.
final class TaskContextStoreTests: XCTestCase {
    private func storeWithContexts() throws -> (ObservationStore, URL) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = try ObservationStore(directory: dir, migrations: ObservationStore.bundledMigrations())
        var db: OpaquePointer?
        XCTAssertEqual(sqlite3_open(dir.appendingPathComponent("didja.db").path, &db), SQLITE_OK)
        XCTAssertEqual(sqlite3_exec(db, """
            INSERT INTO sources (id, kind, ref) VALUES (1, 'window', 'Claude — Demo');
            INSERT INTO tasks (id, title, source, dedupe_key, created_at, last_seen_at)
            VALUES (1, 'One', 1, 'one', '2026-11-10T12:00:00.000Z', '2026-11-10T12:00:00.000Z'),
                   (2, 'Two', 1, 'two', '2026-11-10T12:00:00.000Z', '2026-11-10T12:00:00.000Z');
            INSERT INTO task_context (task_id, bundle_id, app, window_title, url, lines, captured_at)
            VALUES (1, 'com.mybank.app', 'My Bank', 'Payments', NULL, '[]', '2026-11-10T12:00:00.000Z'),
                   (2, 'com.anthropic.claudefordesktop', 'Claude', 'Demo', NULL, '[]', '2026-11-10T12:00:00.000Z');
            """, nil, nil, nil), SQLITE_OK)
        sqlite3_close(db)
        return (store, dir)
    }

    private func contextCount(_ dir: URL) -> Int {
        var db: OpaquePointer?
        var statement: OpaquePointer?
        sqlite3_open(dir.appendingPathComponent("didja.db").path, &db)
        defer { sqlite3_finalize(statement); sqlite3_close(db) }
        sqlite3_prepare_v2(db, "SELECT COUNT(*) FROM task_context", -1, &statement, nil)
        sqlite3_step(statement)
        return Int(sqlite3_column_int(statement, 0))
    }

    func testExcludingAWindowForgetsItsKeptLines() throws {
        let (store, dir) = try storeWithContexts()
        defer { try? FileManager.default.removeItem(at: dir) }
        _ = try store.deleteObservations { bundleID, _, _ in bundleID == "com.mybank.app" }
        XCTAssertEqual(contextCount(dir), 1, "only the excluded window's lines go")
    }

    func testForgettingCapturedTextForgetsKeptLines() throws {
        let (store, dir) = try storeWithContexts()
        defer { try? FileManager.default.removeItem(at: dir) }
        try store.deleteTaskContext()
        XCTAssertEqual(contextCount(dir), 0)
        XCTAssertEqual(try store.tasks().count, 2, "the tasks stay")
    }
}

/// SCR-33: updates come from didja.dev's appcast, once a day, and never from a test or Debug build.
final class UpdatesTests: XCTestCase {
    func testTheFeedAndScheduleAreInTheAppsInfo() {
        let info = Bundle.main.infoDictionary ?? [:]
        XCTAssertEqual(info["SUFeedURL"] as? String, "https://didja.dev/appcast.xml")
        XCTAssertEqual(info["SUScheduledCheckInterval"] as? Int, 86400)
        XCTAssertEqual(info["SUEnableAutomaticChecks"] as? Bool, true)
        XCTAssertNotNil(info["SUPublicEDKey"] as? String, "the key that checks each update's signature")
        XCTAssertEqual(info["CFBundleDisplayName"] as? String, "Didja", "the generated keys are still there")
    }

    func testNoUpdateCheckFromTestsOrDebugBuilds() {
        XCTAssertFalse(Updates.isActive)
        XCTAssertFalse(Updates.shared.canCheck)
    }
}

final class ExcludeListTests: XCTestCase {
    private func tempFile() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent(ExcludeList.fileName)
    }

    func testWhatYouAddIsWhatCaptureRefuses() throws {
        var list = ExcludeList()
        XCTAssertTrue(list.addApp(bundleID: "com.mybank.app"))
        XCTAssertFalse(list.addApp(bundleID: "com.MyBank.app"), "already there")
        XCTAssertTrue(list.addWindowText("Payroll (2026)"))
        XCTAssertFalse(list.addWindowText("   "))
        XCTAssertTrue(list.addSite("https://www.MyBank.com/login?next=1"))
        XCTAssertFalse(list.addSite("mybank.com"), "the same site again")
        XCTAssertFalse(list.addSite("not a site"))

        let file = tempFile()
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        try list.save(to: file)
        XCTAssertEqual(try ExcludeList.load(from: file), list)
        let policy = try PrivacyPolicy.load(userFile: file)
        XCTAssertFalse(policy.allowsApp(bundleID: "com.mybank.app"))
        XCTAssertFalse(policy.allowsWindow(title: "payroll (2026) — Numbers"), "any letter case")
        XCTAssertTrue(policy.allowsWindow(title: "Payroll 2026"), "the words as typed, brackets and all, not a pattern")
        XCTAssertFalse(policy.allowsURL("https://mybank.com"))
        XCTAssertFalse(policy.allowsURL("https://online.mybank.com/accounts"))
        XCTAssertFalse(policy.allowsURL("http://mybank.com:8443/x"))
        // Only the site itself: not a look-alike, and not a page that mentions it.
        XCTAssertTrue(policy.allowsURL("https://notmybank.com/"))
        XCTAssertTrue(policy.allowsURL("https://mybank.com.evil.test/"))
        XCTAssertTrue(policy.allowsURL("https://example.com/?next=https://mybank.com/"))
        // The built-in rules are still there.
        XCTAssertFalse(policy.allowsApp(bundleID: "com.1password.1password"))
    }

    func testPatternsAreShownAsTheWordsThatWereTyped() {
        var list = ExcludeList()
        list.addWindowText("Payroll (2026)")
        list.addSite("online.mybank.com")
        XCTAssertEqual(ExcludeList.label(forPattern: list.windowPatterns[0]), "Payroll (2026)")
        XCTAssertEqual(ExcludeList.label(forURLPattern: list.urlPatterns[0]), "online.mybank.com")
        // A pattern written by hand in the file is shown as it is.
        XCTAssertEqual(ExcludeList.label(forPattern: "pay(roll|slip)"), "pay(roll|slip)")
        XCTAssertEqual(ExcludeList.label(forURLPattern: "mybank\\.com"), "mybank.com")
    }

    func testAFileWithMissingKeysLoadsAndABrokenOneIsNotOverwritten() throws {
        let file = tempFile()
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(#"{"bundleIds": ["com.mybank.app"]}"#.utf8).write(to: file)
        XCTAssertEqual(try ExcludeList.load(from: file), ExcludeList(bundleIds: ["com.mybank.app"]))

        try Data("{ not json".utf8).write(to: file)
        var reloads = 0
        let model = ExcludeListModel(file: file, changed: { reloads += 1 }, running: { [] }, nameOf: { _ in nil })
        XCTAssertFalse(model.editable)
        XCTAssertNotNil(model.error)
        model.addApp("com.other.app")
        XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), "{ not json")
        XCTAssertEqual(reloads, 0)
    }

    func testEveryChangeIsSavedAndReported() throws {
        let file = tempFile()
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        var reloads = 0
        let open = [ExcludeListModel.App(name: "Zed", bundleID: "dev.zed.Zed"), .init(name: "My Bank", bundleID: "com.mybank.app")]
        let model = ExcludeListModel(file: file, changed: { reloads += 1 }, running: { open },
                                     nameOf: { $0 == "com.mybank.app" ? "My Bank" : nil })
        XCTAssertEqual(model.candidates.map(\.name), ["My Bank", "Zed"])
        model.addApp("com.mybank.app")
        XCTAssertEqual(model.candidates.map(\.name), ["Zed"], "an excluded app is not offered again")
        XCTAssertEqual(model.apps, [.init(name: "My Bank", bundleID: "com.mybank.app")])
        XCTAssertFalse(model.addSite("nonsense"))
        XCTAssertNotNil(model.error)
        XCTAssertTrue(model.addSite("mybank.com"))
        XCTAssertNil(model.error)
        XCTAssertEqual(reloads, 2)
        XCTAssertEqual(try ExcludeList.load(from: file), model.list)
        model.removeApp("com.mybank.app")
        XCTAssertEqual(try ExcludeList.load(from: file).bundleIds, [])
        XCTAssertEqual(reloads, 3)
    }

    func testAddingToTheListForgetsWhatWasKeptFromThere() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = try ObservationStore(directory: dir, migrations: ObservationStore.bundledMigrations())
        try store.insert(bundleID: "com.mybank.app", app: "My Bank", windowTitle: "Accounts", url: nil, source: .ax, text: "a")
        try store.insert(bundleID: "com.microsoft.edgemac", app: "Edge", windowTitle: "Bank", url: "https://online.mybank.com/x", source: .ax, text: "b")
        try store.insert(bundleID: "com.apple.Numbers", app: "Numbers", windowTitle: "Payroll 2026", url: nil, source: .ax, text: "c")
        try store.insert(bundleID: "com.microsoft.edgemac", app: "Edge", windowTitle: "News", url: "https://example.com/", source: .ax, text: "d")
        var list = ExcludeList()
        list.addApp(bundleID: "com.mybank.app")
        list.addSite("mybank.com")
        list.addWindowText("payroll")
        let policy = try PrivacyPolicy(bundleIds: list.bundleIds, windowPatterns: list.windowPatterns, urlPatterns: list.urlPatterns)
        let removed = try store.deleteObservations { id, title, url in
            !(policy.allowsApp(bundleID: id) && policy.allowsWindow(title: title) && policy.allowsURL(url))
        }
        XCTAssertEqual(removed, 3)
        XCTAssertEqual(try store.observationCount(), 1)
    }

    /// The window that crashed the app: put the real content in a real window, lay it
    /// out, change the list (which grows the content) and lay it out again.
    @MainActor
    func testTheWindowLaysOutAndSurvivesTheListChanging() throws {
        let file = tempFile()
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let open = [ExcludeListModel.App(name: "Zed", bundleID: "dev.zed.Zed")]
        let model = ExcludeListModel(file: file, running: { open }, nameOf: { _ in nil })
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 560),
                              styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentViewController = NSHostingController(rootView: ExcludeListWindowContent(model: model))
        window.setContentSize(NSSize(width: 480, height: 560))
        window.orderFront(nil) // on screen, as when it crashed
        window.layoutIfNeeded()
        window.displayIfNeeded()
        for index in 0..<12 {
            model.addApp("com.example.app\(index)")
            XCTAssertTrue(model.addWindowText("Title \(index)"))
            window.layoutIfNeeded()
            window.displayIfNeeded()
            RunLoop.main.run(until: Date().addingTimeInterval(0.02))
        }
        XCTAssertEqual(window.contentLayoutRect.width, 480, "the content never resizes the window")
        XCTAssertEqual(model.list.bundleIds.count, 12)
        window.close()
    }

    /// Draws the exclude list window to $TMPDIR/didja-ui/exclude.png.
    @MainActor
    func testRenderExcludeList() throws {
        let file = tempFile()
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        var list = ExcludeList(bundleIds: ["com.mybank.app", "com.example.unknown"])
        list.addWindowText("Payroll")
        list.addSite("mybank.com")
        try list.save(to: file)
        let model = ExcludeListModel(file: file, running: { [] }, nameOf: { $0 == "com.mybank.app" ? "My Bank" : nil })
        let renderer = ImageRenderer(content: ExcludeListView(model: model))
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage)
        XCTAssertEqual(image.size.width, 480)
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let png = try XCTUnwrap(image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?
            .representation(using: .png, properties: [:]))
        try png.write(to: dir.appendingPathComponent("exclude.png"))
    }
}

final class TaskBoardTests: XCTestCase {
    static func item(_ id: Int, _ title: String, _ status: TaskItem.Status = .open, parent: Int? = nil,
                     group: Bool = false, source: String = "Claude — Stripe webhooks",
                     captured: Date? = nil) -> TaskItem {
        TaskItem(id: id, title: title, status: status, source: source, parentID: parent, isGroup: group,
                 doneAt: status == .done ? Date(timeIntervalSince1970: Double(id)) : nil,
                 snoozedUntil: status == .snoozed ? Date(timeIntervalSince1970: 1_800_000_000) : nil,
                 capturedAt: captured)
    }

    static let sample = TaskBoard(tasks: [
        item(4, "Before this works in prod", group: true),
        item(1, "Set `STRIPE_WEBHOOK_SECRET` in Vercel prod", .done, parent: 4),
        item(2, "Run the migration: `supabase db push`", parent: 4),
        item(3, "Add the redirect URL in Supabase auth settings", .snoozed, parent: 4),
        item(9, "Old idea", .dismissed, parent: 4),
        item(5, "Rotate the old API key", source: "Ghostty — Fix auth redirect"),
        item(8, "Staging setup", .done, group: true, source: "Ghostty — Fix auth redirect"),
        item(6, "Create the staging project", .done, parent: 8, source: "Ghostty — Fix auth redirect"),
        item(7, "Update the README", .dismissed, source: "Ghostty — Fix auth redirect"),
    ])

    func testPendingShowsOpenChecklistsWithTheirStepsExceptDismissedOnes() {
        let sections = Self.sample.sections(.pending)
        XCTAssertEqual(sections.map(\.source), ["Claude — Stripe webhooks", "Ghostty — Fix auth redirect"])
        XCTAssertEqual(sections[0].entries[0].steps.map(\.id), [1, 2, 3])
        XCTAssertEqual(sections[0].entries[0].progress, "1/3")
        XCTAssertEqual(sections[1].entries.map(\.task.id), [5])
        XCTAssertNil(sections[1].entries[0].progress)
        XCTAssertEqual(Self.sample.openStepCount, 2)
    }

    func testAConversationCanBeTickedOnlyWhileSomethingInItIsOpen() {
        let pending = Self.sample.sections(.pending)
        XCTAssertEqual(pending.map { $0.tickAllHandle?.id }, [4, 5])
        XCTAssertEqual(pending[0].rows.map(\.id), [4, 1, 2, 3])
        for filter in [TaskBoard.Filter.done, .dismissed, .snoozed] {
            XCTAssertEqual(Self.sample.sections(filter).compactMap(\.tickAllHandle), [], "\(filter)")
        }
        XCTAssertEqual(Self.sample.pendingSection(containing: Self.sample.tasks[2])?.source, "Claude — Stripe webhooks")
        XCTAssertNil(Self.sample.pendingSection(containing: Self.sample.tasks[7]), "a done step of a done checklist")
    }

    func testOtherViews() {
        XCTAssertEqual(Self.sample.entries(.done).map(\.task.id), [8])
        XCTAssertEqual(Self.sample.entries(.dismissed).map(\.task.id), [7])
        XCTAssertEqual(Self.sample.count(.snoozed), 0, "a snoozed step stays under its open checklist")
    }

    func testPopoverListAreaNeverCollapsesAndIsCapped() {
        XCTAssertEqual(PopoverView.panelHeight(forList: 0), 44)
        XCTAssertEqual(PopoverView.panelHeight(forList: 230), 230)
        XCTAssertEqual(PopoverView.panelHeight(forList: 5_000), PopoverView.maxListHeight)
    }

    /// The size a row takes in the popover, highlighted or not.
    @MainActor
    private func rowSize(_ item: TaskItem, isStep: Bool, highlighted: Bool) throws -> CGSize {
        let navigator = TaskNavigator(scope: .popover)
        navigator.selected = highlighted ? item.id : nil
        let row = TaskRow(item: item, progress: item.isGroup ? "0/5" : nil, isStep: isStep,
                          actions: TaskActions(), navigator: navigator)
            .frame(width: 396)
        return try XCTUnwrap(ImageRenderer(content: row).nsImage).size
    }

    /// Highlighting a row shows its buttons. That must not change how its title wraps,
    /// or the text jumps as the highlight moves up and down the list.
    @MainActor
    func testHighlightingARowDoesNotRewrapItsTitle() throws {
        let words = "Open System Settings then Privacy and Security then Accessibility and select the app in the list"
            .split(separator: " ")
        // Titles of every length from one word up, so some end right where the buttons appear.
        for count in 1...words.count {
            let title = words.prefix(count).joined(separator: " ")
            for (status, group, isStep) in [(TaskItem.Status.open, false, true), (.open, false, false),
                                            (.open, true, false), (.done, false, true), (.snoozed, false, true)] {
                // With no capture time, and with ones that give the shortest and longest notes.
                for age in [nil, 30.0, 135 * 60, 400 * 24 * 3600] as [TimeInterval?] {
                    let item = Self.item(1, title, status, parent: isStep ? 4 : nil, group: group,
                                         captured: age.map { Date().addingTimeInterval(-$0) })
                    XCTAssertEqual(try rowSize(item, isStep: isStep, highlighted: true),
                                   try rowSize(item, isStep: isStep, highlighted: false),
                                   "\(status) \(group ? "checklist" : "task"), captured \(age ?? -1)s ago: \(title)")
                }
            }
        }
    }

    private static let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    private func age(_ seconds: TimeInterval, now: Date = Date(timeIntervalSince1970: 1_794_312_000)) -> String {
        CapturedLabel.text(captured: now.addingTimeInterval(-seconds), now: now, calendar: Self.utc,
                           locale: Locale(identifier: "en_GB"))
    }

    func testCapturedNoteCountsMinutesThenHoursThenGivesTheDate() {
        XCTAssertEqual(age(0), "just now")
        XCTAssertEqual(age(59), "just now")
        XCTAssertEqual(age(-300), "just now", "a capture time ahead of the clock is not a negative age")
        XCTAssertEqual(age(60), "1 min ago")
        XCTAssertEqual(age(5 * 60 + 40), "5 min ago", "whole minutes, rounded down")
        XCTAssertEqual(age(59 * 60 + 59), "59 min ago")
        XCTAssertEqual(age(3600), "1h ago")
        XCTAssertEqual(age(2 * 3600 + 15 * 60), "2h 15m ago")
        XCTAssertEqual(age(24 * 3600 - 1), "23h 59m ago")

        // 1_794_312_000 is 10 Nov 2026, 12:00 UTC.
        let yesterday = age(24 * 3600 + 5 * 60)
        for part in ["9", "Nov", "11:55"] { XCTAssertTrue(yesterday.contains(part), yesterday) }
        XCTAssertFalse(yesterday.contains("2026"), "the year is left out while it is this year: \(yesterday)")
        let lastYear = age(400 * 24 * 3600)
        for part in ["Oct", "2025", "12:00"] { XCTAssertTrue(lastYear.contains(part), lastYear) }
    }

    func testCapturedNoteIsOnChecklistsAndLooseTasksOnly() {
        let now = Date(timeIntervalSince1970: 1_794_312_000)
        let captured = now.addingTimeInterval(-300)
        func note(_ item: TaskItem) -> String? {
            CapturedLabel.text(for: item, now: now, calendar: Self.utc, locale: Locale(identifier: "en_GB"))
        }
        XCTAssertEqual(note(Self.item(1, "Loose", captured: captured)), "5 min ago")
        XCTAssertEqual(note(Self.item(1, "Checklist", group: true, captured: captured)), "5 min ago")
        XCTAssertEqual(note(Self.item(1, "Done", .done, captured: captured)), "5 min ago")
        XCTAssertNil(note(Self.item(1, "Step", parent: 4, captured: captured)), "a step shares its checklist's note")
        XCTAssertNil(note(Self.item(1, "Snoozed", .snoozed, captured: captured)), "a snoozed row shows when it wakes")
        XCTAssertNil(note(Self.item(1, "Unknown")), "no capture time, no note")
    }

    /// Draws the popover's list to a PNG so its layout can be looked at.
    @MainActor
    func testRenderPopoverList() throws {
        // Row 2 is highlighted, as it is when reached with the arrow keys.
        let navigator = TaskNavigator(scope: .popover)
        navigator.selected = 2
        // Captured at different times, so every form of the note is drawn.
        var board = Self.sample
        let ages: [Int: TimeInterval] = [4: 5 * 60, 5: 2 * 3600 + 15 * 60, 8: 3 * 24 * 3600]
        for index in board.tasks.indices {
            board.tasks[index].capturedAt = ages[board.tasks[index].id].map { Date().addingTimeInterval(-$0) }
            // Ticked for you because it looked done: drawn with its label.
            if board.tasks[index].id == 1 { board.tasks[index].acceptedFrom = "Google Chrome — vercel.com/acme/settings" }
            // The same thing seen in two places: drawn with its question.
            if board.tasks[index].id == 3 { board.tasks[index].asker = "Jordan Lee via Docusign" }
            if board.tasks[index].id == 2 {
                board.tasks[index].mergeWith = 99
                board.tasks[index].mergeWithTitle = "Sign the loan agreement Sam is sending"
                board.tasks[index].mergeWithSource = "Teams — Sam Carter"
            }
        }
        let view = PopoverTaskList(board: board, actions: TaskActions(), navigator: navigator)
            .padding(12)
            .frame(width: 420)
            .background(Palette.surface)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage)
        let png = try XCTUnwrap(image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?
            .representation(using: .png, properties: [:]))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try png.write(to: dir.appendingPathComponent("popover.png"))
        XCTAssertGreaterThan(image.size.height, 100)
        // The same list in dark mode (SCR-34).
        try Self.renderDark(PopoverTaskList(board: board, actions: TaskActions(), navigator: navigator)
            .padding(12).frame(width: 420), to: "popover-dark.png")
    }

    /// Draws a view in dark mode, on the panel's surface, to `didja-ui/<name>`.
    @MainActor
    static func renderDark(_ content: some View, to name: String) throws {
        let view = content.background(Palette.surface).environment(\.colorScheme, .dark)
        var png: Data?
        try XCTUnwrap(NSAppearance(named: .darkAqua)).performAsCurrentDrawingAppearance {
            let renderer = ImageRenderer(content: view)
            renderer.scale = 2
            png = renderer.nsImage?.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?
                .representation(using: .png, properties: [:])
        }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try XCTUnwrap(png).write(to: dir.appendingPathComponent(name))
    }

    /// The panel's way into the task window is a labelled chip with a real symbol (SCR-38).
    func testExpandButtonIsLabelledWithARealSymbol() {
        XCTAssertEqual(PopoverView.expandTitle, "Full View", "named after the view it opens (SCR-37)")
        XCTAssertNotEqual(PopoverView.expandSymbol, "macwindow", "the old icon read as a folder")
        XCTAssertNotNil(NSImage(systemSymbolName: PopoverView.expandSymbol, accessibilityDescription: nil))
    }

    /// The whole panel, header and footer included, empty, in light and dark (SCR-34).
    @MainActor
    func testRenderWholePanel() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-panel-\(UUID().uuidString)")
        let capture = CaptureCoordinator(supportDirectory: dir)
        let navigator = TaskNavigator(scope: .popover)
        navigator.startAdding()
        let panel = PopoverView(capture: capture, actions: TaskActions(), navigator: navigator, openWindow: {})
        let renderer = ImageRenderer(content: panel)
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage)
        let png = try XCTUnwrap(image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?
            .representation(using: .png, properties: [:]))
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        try png.write(to: out.appendingPathComponent("panel.png"))
        try Self.renderDark(PopoverView(capture: capture, actions: TaskActions(), navigator: TaskNavigator(scope: .popover), openWindow: {}),
                            to: "panel-dark.png")
    }

    /// Draws the panel's search bar over a list narrowed by a search, to `popover-search.png`.
    @MainActor
    func testRenderPopoverSearch() throws {
        let navigator = TaskNavigator(scope: .popover)
        let view = VStack(alignment: .leading, spacing: 8) {
            PopoverSearchBar(navigator: navigator)
            PopoverTaskList(board: Self.sample, actions: TaskActions(), navigator: navigator, query: "migration")
        }
        .padding(12)
        .frame(width: 420)
        .background(Color(nsColor: .windowBackgroundColor))
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage)
        let png = try XCTUnwrap(image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?
            .representation(using: .png, properties: [:]))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try png.write(to: dir.appendingPathComponent("popover-search.png"))
        XCTAssertGreaterThan(image.size.height, 60)
    }
}

final class TaskNavigatorTests: XCTestCase {
    /// Records what the keyboard asked the engine to do.
    final class Log {
        var calls: [String] = []
        var actions: TaskActions {
            TaskActions(
                setDone: { item, done in self.calls.append("\(done ? "done" : "undone") \(item.id)") },
                snooze: { item, duration in self.calls.append("snooze \(item.id) \(duration)") },
                dismiss: { item in self.calls.append("dismiss \(item.id)") },
                reopen: { item in self.calls.append("reopen \(item.id)") },
                completeConversation: { item in self.calls.append("done-all \(item.id)") },
                why: { item in "why \(item.id)" },
                add: { title in self.calls.append("add \(title)") })
        }
    }

    let board = TaskBoardTests.sample

    func testRowsAreInTheOrderTheyAreDrawn() {
        XCTAssertEqual(board.popoverRows.map(\.id), [4, 1, 2, 3, 5, 8], "pending rows, then recently done")
        XCTAssertEqual(board.rows(.done).map(\.id), [8, 6])
        XCTAssertEqual(board.rows(.dismissed).map(\.id), [7])
    }

    func testSearchNarrowsThePanelAsYouType() {
        XCTAssertEqual(board.popoverRows(matching: "st").map(\.id), [4, 1, 2, 3, 8], "a checklist is kept whole, with its steps")
        XCTAssertEqual(board.popoverRows(matching: "migr").map(\.id), [4, 1, 2, 3], "found in a step")
        XCTAssertEqual(board.popoverRows(matching: " ROTATE ").map(\.id), [5], "any case, spaces around it ignored")
        XCTAssertEqual(board.popoverRows(matching: "staging").map(\.id), [8], "recently done is searched too")
        XCTAssertEqual(board.popoverRows(matching: "old idea").map(\.id), [], "a dismissed step is not on show, so not found")
        XCTAssertEqual(board.popoverRows(matching: "no such thing").map(\.id), [])
        XCTAssertEqual(board.popoverRows(matching: "").map(\.id), board.popoverRows.map(\.id), "no search, everything")
        var folded = board
        folded.showsRecentlyDone = false
        XCTAssertEqual(folded.popoverRows(matching: "staging").map(\.id), [], "a folded Recently done stays folded")
    }

    func testTheKeyboardWalksOnlyTheRowsASearchLeaves() {
        let log = Log()
        let popover = TaskNavigator(scope: .popover)
        popover.selected = 4
        popover.query = "rotate"
        XCTAssertNil(popover.selected, "a new search drops the highlight, so no key acts on a row that may be gone")
        XCTAssertEqual(popover.rows(board).map(\.id), [5])
        popover.handle(.toggle, board: board, actions: log.actions)
        XCTAssertEqual(log.calls, [], "nothing highlighted, nothing ticked")
        popover.handle(.down, board: board, actions: log.actions)
        XCTAssertEqual(popover.selected, 5)
        popover.handle(.down, board: board, actions: log.actions)
        XCTAssertEqual(popover.selected, 5, "there is no row past the last match")
        popover.endSearch()
        XCTAssertEqual(popover.rows(board).map(\.id), [4, 1, 2, 3, 5, 8])
        XCTAssertFalse(popover.isNarrowed)
    }

    func testTypingInTheSearchFieldNeverActsOnATask() {
        let log = Log()
        let popover = TaskNavigator(scope: .popover)
        XCTAssertEqual(NavKey(keyCode: 3, hasCommandModifiers: false), .search)
        XCTAssertEqual(NavKey(keyCode: 44, hasCommandModifiers: false), .search)
        XCTAssertEqual(NavKey(keyCode: 3, hasCommandModifiers: true, isCommandOnly: true), .search, "⌘F")
        XCTAssertNil(NavKey(keyCode: 3, hasCommandModifiers: true), "⌥F and the like pass through")
        popover.selected = 2
        XCTAssertTrue(popover.handle(.search, board: board, actions: log.actions))
        XCTAssertTrue(popover.searching)
        // Space, S, D, C, N, R, W and Delete are letters of a search, not shortcuts.
        for code: UInt16 in [49, 1, 2, 8, 45, 15, 13, 51, 53] {
            XCTAssertFalse(popover.handleWhileSearching(keyCode: code, board: board, actions: log.actions))
        }
        XCTAssertEqual(log.calls, [])
        XCTAssertTrue(popover.searching)
        XCTAssertEqual(popover.selected, 2)

        // Return hands the keyboard to the list with the first match highlighted. It ticks nothing.
        popover.query = "migration"
        XCTAssertTrue(popover.handleWhileSearching(keyCode: 36, board: board, actions: log.actions))
        XCTAssertFalse(popover.searching)
        XCTAssertEqual(popover.selected, 4)
        XCTAssertEqual(log.calls, [])

        // ↓ does the same and moves on from there.
        popover.searching = true
        XCTAssertTrue(popover.handleWhileSearching(keyCode: 125, board: board, actions: log.actions))
        XCTAssertFalse(popover.searching)
        XCTAssertEqual(popover.selected, 1)
        XCTAssertEqual(log.calls, [])
    }

    func testAConversationIsNotTickedWhileASearchHidesPartOfIt() {
        let log = Log()
        // The conversation holds task 5 and, were it open, more: a search for one must not tick the rest.
        var tasks = board.tasks
        tasks.append(TaskBoardTests.item(30, "Email the invoice", source: "Ghostty — Fix auth redirect"))
        let wider = TaskBoard(tasks: tasks)
        for scope in [TaskNavigator.Scope.popover, .window] {
            log.calls = []
            let navigator = TaskNavigator(scope: scope)
            navigator.query = "rotate"
            navigator.selected = 5
            XCTAssertEqual(navigator.rows(wider).map(\.id), [5])
            XCTAssertTrue(navigator.handle(.tickConversation, board: wider, actions: log.actions))
            XCTAssertEqual(log.calls, [], "task 30 is hidden by the search; C must not tick it")
            navigator.endSearch()
            navigator.selected = 5
            navigator.handle(.tickConversation, board: wider, actions: log.actions)
            XCTAssertEqual(log.calls, ["done-all 5"], "with the whole list back, C works as before")
        }
    }

    // MARK: A task of your own (SCR-29)

    func testAddKeyOpensTheFieldAndReturnAddsTheTask() {
        XCTAssertEqual(NavKey(keyCode: 24, hasCommandModifiers: false, isShiftOnly: true), .add, "+")
        XCTAssertNil(NavKey(keyCode: 24, hasCommandModifiers: true), "⌘= and the like pass through")
        let log = Log()
        let navigator = TaskNavigator(scope: .popover)
        XCTAssertTrue(navigator.handle(.add, board: board, actions: log.actions))
        XCTAssertTrue(navigator.adding)
        navigator.addDraft = "  Email Mike the contract  "
        navigator.commitAdd(actions: log.actions)
        XCTAssertEqual(log.calls, ["add Email Mike the contract"])
        XCTAssertFalse(navigator.adding)
    }

    func testAnEmptyOrCancelledAddAddsNothing() {
        let log = Log()
        let navigator = TaskNavigator(scope: .popover)
        navigator.startAdding()
        navigator.addDraft = "   "
        navigator.commitAdd(actions: log.actions)
        navigator.startAdding()
        navigator.addDraft = "Call the plumber"
        navigator.cancelAdd()
        navigator.commitAdd(actions: log.actions)
        XCTAssertEqual(log.calls, [])
    }

    // MARK: Thousands of tasks (SCR-32)

    /// 1,000 checklists of two steps and 1,000 loose tasks, most of them done: drawing the lists
    /// must stay quick. Before SCR-32 every row scanned every task for its steps.
    func testThousandsOfTasksStayQuick() {
        var tasks: [TaskItem] = []
        var id = 0
        for n in 0..<1000 {
            id += 1
            let parent = id
            tasks.append(TaskBoardTests.item(parent, "List \(n)", n % 10 == 0 ? .open : .done, group: true))
            for s in 0..<2 {
                id += 1
                tasks.append(TaskBoardTests.item(id, "Step \(s) of \(n)", n % 10 == 0 ? .open : .done, parent: parent))
            }
        }
        for n in 0..<1000 {
            id += 1
            tasks.append(TaskBoardTests.item(id, "Loose \(n)", n % 10 == 0 ? .open : .done))
        }
        let board = TaskBoard(tasks: tasks)
        let start = Date()
        let pending = board.sections(.pending)
        let done = board.sections(.done)
        let rows = board.popoverRows
        let found = board.sections(.done, matching: "step 1")
        let elapsed = Date().timeIntervalSince(start)
        XCTAssertEqual(pending.flatMap(\.entries).count, 200)
        XCTAssertEqual(done.flatMap(\.entries).count, 1800)
        XCTAssertFalse(rows.isEmpty)
        XCTAssertEqual(found.flatMap(\.entries).count, 900)
        XCTAssertLessThan(elapsed, 1.0, "drawing 3,000 tasks took \(elapsed)s")
    }

    func testTheChildIndexFollowsChangesToTheList() {
        var board = TaskBoard(tasks: [TaskBoardTests.item(1, "List", group: true), TaskBoardTests.item(2, "Step", parent: 1)])
        XCTAssertEqual(board.steps(under: board.tasks[0]).map(\.id), [2])
        board.tasks.append(TaskBoardTests.item(3, "Another step", parent: 1))
        XCTAssertEqual(board.steps(under: board.tasks[0]).map(\.id), [2, 3])
    }

    // MARK: How it looked (SCR-31)

    static let sampleContext = TaskContext(
        app: "Gmail", window: "Inbox", url: nil,
        lines: [.init(text: "Hi, quick one before the weekend.", task: false),
                .init(text: "Don't forget to email Mike the contract", task: true),
                .init(text: "He needs it before Monday's call.", task: false)],
        capturedAt: "2026-11-10T10:00:00.000Z")

    func testVShowsAndHidesHowItLooked() {
        XCTAssertEqual(NavKey(keyCode: 9, hasCommandModifiers: false), .preview)
        var asked = 0
        var actions = TaskActions()
        actions.context = { _ in asked += 1; return Self.sampleContext }
        let navigator = TaskNavigator(scope: .popover)
        XCTAssertTrue(navigator.handle(.preview, board: board, actions: actions), "nothing highlighted: nothing shown")
        XCTAssertTrue(navigator.previews.isEmpty)
        navigator.handle(.down, board: board, actions: actions)
        let id = try! XCTUnwrap(navigator.selected)
        navigator.handle(.preview, board: board, actions: actions)
        XCTAssertEqual(navigator.previews[id], Self.sampleContext)
        navigator.handle(.preview, board: board, actions: actions)
        XCTAssertNil(navigator.previews[id])
        XCTAssertEqual(asked, 1)
    }

    func testATaskWithoutKeptLinesSaysSo() {
        let navigator = TaskNavigator(scope: .popover)
        let item = board.popoverRows[0]
        navigator.togglePreview(item, actions: TaskActions())
        XCTAssertTrue(navigator.noPreview.contains(item.id))
        navigator.togglePreview(item, actions: TaskActions())
        XCTAssertFalse(navigator.noPreview.contains(item.id))
    }

    @MainActor
    func testRenderSourcePreview() throws {
        let navigator = TaskNavigator(scope: .popover)
        var actions = TaskActions()
        actions.context = { _ in Self.sampleContext }
        let item = board.popoverRows[1]
        navigator.selected = item.id
        navigator.togglePreview(item, actions: actions)
        let view = PopoverTaskList(board: board, actions: actions, navigator: navigator)
            .padding(12).frame(width: 420).background(Palette.surface)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage)
        let png = try XCTUnwrap(image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?.representation(using: .png, properties: [:]))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try png.write(to: dir.appendingPathComponent("preview.png"))
    }

    // MARK: Several rows at once (SCR-26)

    func testSelectAllAndShiftArrowsAreRead() {
        XCTAssertEqual(NavKey(keyCode: 0, hasCommandModifiers: true, isCommandOnly: true), .selectAll, "⌘A")
        XCTAssertNil(NavKey(keyCode: 0, hasCommandModifiers: true), "⌥A and ⌃A pass through")
        XCTAssertEqual(NavKey(keyCode: 0, hasCommandModifiers: false), .add, "A alone adds a task (SCR-29)")
        XCTAssertEqual(NavKey(keyCode: 125, hasCommandModifiers: false, isShiftOnly: true), .extendDown)
        XCTAssertEqual(NavKey(keyCode: 126, hasCommandModifiers: false, isShiftOnly: true), .extendUp)
        XCTAssertEqual(NavKey(keyCode: 2, hasCommandModifiers: false, isShiftOnly: true), .dismiss, "⇧ on other keys changes nothing")
    }

    func testSelectAllThenSpaceTicksEveryOpenRowOnceAndReopensNothing() {
        let log = Log()
        let navigator = TaskNavigator(scope: .popover)
        XCTAssertTrue(navigator.handle(.selectAll, board: board, actions: log.actions))
        XCTAssertEqual(navigator.marked, [4, 1, 2, 3, 5, 8])
        XCTAssertEqual(navigator.selected, 4, "the first row is highlighted when nothing was")
        XCTAssertEqual(log.calls, [], "choosing changes nothing")
        navigator.handle(.toggle, board: board, actions: log.actions)
        // 4's steps go with it; the done step 1 and the done checklist 8 are not reopened.
        XCTAssertEqual(log.calls, ["done 4", "done 5"])
        XCTAssertEqual(navigator.marked, [], "after acting, back to one row")
        XCTAssertNil(navigator.selected, "every row was chosen, so none is left to highlight")
    }

    func testSelectAllThenDismissOrSnoozeActsOnOpenRowsOnly() {
        for (key, expected) in [(NavKey.dismiss, ["dismiss 4", "dismiss 5"]), (.snooze, ["snooze 4 1h", "snooze 5 1h"])] {
            let log = Log()
            let navigator = TaskNavigator(scope: .popover)
            navigator.handle(.selectAll, board: board, actions: log.actions)
            navigator.handle(key, board: board, actions: log.actions)
            XCTAssertEqual(log.calls, expected, "\(key)")
        }
    }

    func testSelectAllChoosesOnlyWhatASearchLeaves() {
        let log = Log()
        let navigator = TaskNavigator(scope: .popover)
        navigator.query = "st"
        XCTAssertEqual(navigator.rows(board).map(\.id), [4, 1, 2, 3, 8])
        navigator.handle(.selectAll, board: board, actions: log.actions)
        XCTAssertFalse(navigator.marked.contains(5), "5 is hidden by the search")
        navigator.handle(.toggle, board: board, actions: log.actions)
        XCTAssertEqual(log.calls, ["done 4"], "the hidden task 5 is never ticked")
    }

    func testChoiceIsDroppedWhenTheListChanges() {
        let log = Log()
        let window = TaskNavigator(scope: .window)
        window.handle(.selectAll, board: board, actions: log.actions)
        XCTAssertFalse(window.marked.isEmpty)
        window.filter = .done
        XCTAssertEqual(window.marked, [], "another view, nothing chosen")
        window.handle(.selectAll, board: board, actions: log.actions)
        window.query = "staging"
        XCTAssertEqual(window.marked, [], "a new search, nothing chosen")
        window.handle(.selectAll, board: board, actions: log.actions)
        window.sourceFilter = "Ghostty — Fix auth redirect"
        XCTAssertEqual(window.marked, [])

        let popover = TaskNavigator(scope: .popover)
        popover.handle(.selectAll, board: board, actions: log.actions)
        XCTAssertTrue(popover.clearMarks(), "Esc lets go of the choice first")
        XCTAssertFalse(popover.clearMarks(), "and then has nothing to let go of, so it closes")
        popover.handle(.selectAll, board: board, actions: log.actions)
        popover.handle(.down, board: board, actions: log.actions)
        XCTAssertEqual(popover.marked, [], "a plain arrow goes back to one row")
        XCTAssertEqual(log.calls, [])
    }

    func testRowsChosenTogetherThatLeftTheListAreNotActedOn() {
        let log = Log()
        let navigator = TaskNavigator(scope: .popover)
        navigator.handle(.selectAll, board: board, actions: log.actions)
        // The engine ticked 4 (and its steps) meanwhile: only what is still listed is acted on.
        let without = TaskBoard(tasks: board.tasks.filter { ![4, 1, 2, 3, 9].contains($0.id) })
        navigator.handle(.dismiss, board: without, actions: log.actions)
        XCTAssertEqual(log.calls, ["dismiss 5"])
    }

    func testShiftArrowsChooseARangeAndSpaceTicksItsOpenRows() {
        let log = Log()
        let navigator = TaskNavigator(scope: .popover)
        navigator.selected = 2
        navigator.handle(.extendDown, board: board, actions: log.actions)
        navigator.handle(.extendDown, board: board, actions: log.actions)
        XCTAssertEqual(navigator.marked, [2, 3, 5])
        XCTAssertEqual(navigator.selected, 5)
        navigator.handle(.extendUp, board: board, actions: log.actions)
        XCTAssertEqual(navigator.marked, [2, 3], "back up shrinks the range towards where it started")
        navigator.handle(.extendUp, board: board, actions: log.actions)
        navigator.handle(.extendUp, board: board, actions: log.actions)
        XCTAssertEqual(navigator.marked, [1, 2], "and past the start it grows the other way")
        navigator.handle(.extendDown, board: board, actions: log.actions)
        navigator.handle(.extendDown, board: board, actions: log.actions)
        navigator.handle(.extendDown, board: board, actions: log.actions)
        XCTAssertEqual(navigator.marked, [2, 3, 5])
        navigator.handle(.toggle, board: board, actions: log.actions)
        XCTAssertEqual(log.calls, ["done 2", "done 5"], "the snoozed step is left as it is")
        XCTAssertEqual(navigator.selected, 8, "the highlight moves past what was chosen")
    }

    func testOnlyFinishedRowsChosenAreReopenedAndAStepGoesWithItsChecklist() {
        let log = Log()
        let window = TaskNavigator(scope: .window)
        window.filter = .done
        XCTAssertEqual(window.rows(board).map(\.id), [8, 6])
        window.handle(.selectAll, board: board, actions: log.actions)
        window.handle(.toggle, board: board, actions: log.actions)
        XCTAssertEqual(log.calls, ["reopen 8"], "6 is a step of 8 and is reopened with it")
    }

    func testClicksWithCommandAndShift() {
        let navigator = TaskNavigator(scope: .popover)
        let item = { (id: Int) in self.board.tasks.first { $0.id == id }! }
        navigator.click(item(2), board: board)
        XCTAssertEqual(navigator.selected, 2)
        XCTAssertEqual(navigator.marked, [])
        navigator.click(item(5), board: board, command: true)
        XCTAssertEqual(navigator.marked, [2, 5], "⌘-click adds to the highlighted row")
        navigator.click(item(2), board: board, command: true)
        XCTAssertEqual(navigator.marked, [5], "⌘-click again takes it out")
        navigator.click(item(4), board: board)
        XCTAssertEqual(navigator.marked, [], "a plain click is one row again")
        navigator.click(item(3), board: board, shift: true)
        XCTAssertEqual(navigator.marked, [4, 1, 2, 3], "⇧-click chooses from the last click to this one")
        XCTAssertEqual(navigator.selected, 3)
        XCTAssertTrue(navigator.isChosen(1))
        XCTAssertFalse(navigator.isChosen(5))
    }

    func testCopyWithSeveralChosenCopiesEachOnce() {
        var copied: [String] = []
        let actions = TaskActions(copy: { copied.append($0) })
        let navigator = TaskNavigator(scope: .popover)
        navigator.handle(.selectAll, board: board, actions: actions)
        XCTAssertTrue(navigator.handle(.copy, board: board, actions: actions))
        XCTAssertEqual(copied.count, 1)
        let expected = [4, 5, 8].map { id in board.copyText(for: board.tasks.first { $0.id == id }!) }.joined(separator: "\n")
        XCTAssertEqual(copied.first, expected, "steps come with their checklist, not twice")
    }

    func testKeysAreReadByPositionAndShortcutsPassThrough() {
        XCTAssertEqual(NavKey(keyCode: 125, hasCommandModifiers: false), .down)
        XCTAssertEqual(NavKey(keyCode: 38, hasCommandModifiers: false), .down)
        XCTAssertEqual(NavKey(keyCode: 49, hasCommandModifiers: false), .toggle)
        XCTAssertEqual(NavKey(keyCode: 53, hasCommandModifiers: false), .close)
        XCTAssertEqual(NavKey(keyCode: 19, hasCommandModifiers: false), .view(1))
        XCTAssertNil(NavKey(keyCode: 13, hasCommandModifiers: true), "⌘W must still close the window")
        XCTAssertNil(NavKey(keyCode: 6, hasCommandModifiers: false), "Z does nothing")
    }

    func testArrowsMoveTheHighlightAndStopAtTheEnds() {
        let navigator = TaskNavigator(scope: .popover)
        let log = Log()
        navigator.handle(.down, board: board, actions: log.actions)
        XCTAssertEqual(navigator.selected, 4, "the first press highlights the first row")
        navigator.handle(.down, board: board, actions: log.actions)
        XCTAssertEqual(navigator.selected, 1)
        navigator.handle(.up, board: board, actions: log.actions)
        navigator.handle(.up, board: board, actions: log.actions)
        XCTAssertEqual(navigator.selected, 4)
        for _ in 0..<10 { navigator.handle(.down, board: board, actions: log.actions) }
        XCTAssertEqual(navigator.selected, 8)
        XCTAssertEqual(log.calls, [], "moving changes nothing")

        let fromBottom = TaskNavigator(scope: .popover)
        fromBottom.handle(.up, board: board, actions: log.actions)
        XCTAssertEqual(fromBottom.selected, 8)
    }

    func testNothingIsTickedWithoutAHighlightedRow() {
        let navigator = TaskNavigator(scope: .popover)
        let log = Log()
        for key in [NavKey.toggle, .snooze, .dismiss, .why] {
            XCTAssertTrue(navigator.handle(key, board: board, actions: log.actions))
        }
        XCTAssertEqual(log.calls, [])

        // The highlighted task was ticked by the engine and left the list: keys must not fall on a neighbour.
        navigator.selected = 5
        let without = TaskBoard(tasks: board.tasks.filter { $0.id != 5 && $0.id != 8 && $0.id != 6 })
        navigator.handle(.toggle, board: without, actions: log.actions)
        navigator.handle(.dismiss, board: without, actions: log.actions)
        XCTAssertEqual(log.calls, [])
    }

    func testKeysActOnTheHighlightedRowOnly() {
        let navigator = TaskNavigator(scope: .popover)
        let log = Log()
        navigator.selected = 2
        navigator.handle(.toggle, board: board, actions: log.actions)
        XCTAssertEqual(log.calls, ["done 2"])
        XCTAssertEqual(navigator.selected, 2, "a ticked step stays under its checklist")

        navigator.selected = 1
        navigator.handle(.toggle, board: board, actions: log.actions)
        navigator.handle(.snooze, board: board, actions: log.actions)
        navigator.handle(.dismiss, board: board, actions: log.actions)
        XCTAssertEqual(log.calls, ["done 2", "reopen 1"], "a done step can be reopened, not snoozed or dismissed")

        navigator.selected = 4
        navigator.handle(.why, board: board, actions: log.actions)
        XCTAssertEqual(navigator.explanations, [:], "a checklist has no why")
        navigator.selected = 2
        navigator.handle(.why, board: board, actions: log.actions)
        XCTAssertEqual(navigator.explanations, [2: "why 2"])
        navigator.handle(.why, board: board, actions: log.actions)
        XCTAssertEqual(navigator.explanations, [:])
    }

    func testTheHighlightMovesOnWhenItsRowLeaves() {
        let navigator = TaskNavigator(scope: .popover)
        let log = Log()
        navigator.selected = 2
        navigator.handle(.dismiss, board: board, actions: log.actions)
        XCTAssertEqual(navigator.selected, 3)

        navigator.selected = 4
        navigator.handle(.snooze, board: board, actions: log.actions)
        XCTAssertEqual(navigator.selected, 5, "past the snoozed checklist's own steps")
        XCTAssertEqual(log.calls, ["dismiss 2", "snooze 4 1h"])

        navigator.selected = 8
        navigator.handle(.toggle, board: board, actions: log.actions)
        XCTAssertEqual(navigator.selected, 5, "the last row hands over to the one before")

        // After the row has gone, the next arrow press lands where it was.
        navigator.selected = 2
        navigator.handle(.down, board: board, actions: log.actions)
        navigator.handle(.up, board: board, actions: log.actions)
        let without = TaskBoard(tasks: board.tasks.filter { $0.id != 2 })
        navigator.handle(.down, board: without, actions: log.actions)
        XCTAssertEqual(navigator.selected, 3)
    }

    func testTickingAConversationNeedsAHighlightedPendingRowAndNamesOnlyItsConversation() {
        XCTAssertEqual(NavKey(keyCode: 8, hasCommandModifiers: false), .tickConversation)
        XCTAssertNil(NavKey(keyCode: 8, hasCommandModifiers: true), "⌘C must still copy")
        let log = Log()

        // Nothing highlighted: nothing happens.
        let popover = TaskNavigator(scope: .popover)
        XCTAssertTrue(popover.handle(.tickConversation, board: board, actions: log.actions))
        XCTAssertEqual(log.calls, [])

        // A recently done row is not a pending conversation.
        popover.selected = 8
        popover.handle(.tickConversation, board: board, actions: log.actions)
        XCTAssertEqual(log.calls, [])
        XCTAssertEqual(popover.selected, 8)

        // The highlighted row has left the list: the key must not fall on a neighbour's conversation.
        popover.selected = 2
        let without = TaskBoard(tasks: board.tasks.filter { ![4, 1, 2, 3, 9].contains($0.id) })
        popover.handle(.tickConversation, board: without, actions: log.actions)
        XCTAssertEqual(log.calls, [])

        // From any row of a conversation, done steps included: that conversation, and the highlight moves past it.
        popover.selected = 1
        popover.handle(.tickConversation, board: board, actions: log.actions)
        XCTAssertEqual(log.calls, ["done-all 4"])
        XCTAssertEqual(popover.selected, 5)

        // The last pending conversation hands the highlight to what is left.
        popover.selected = 5
        popover.handle(.tickConversation, board: board, actions: log.actions)
        XCTAssertEqual(log.calls, ["done-all 4", "done-all 5"])
        XCTAssertEqual(popover.selected, 8)

        // In the task window it works in the pending view only.
        let window = TaskNavigator(scope: .window)
        window.filter = .done
        window.selected = 6
        window.handle(.tickConversation, board: board, actions: log.actions)
        window.filter = .dismissed
        window.selected = 7
        window.handle(.tickConversation, board: board, actions: log.actions)
        XCTAssertEqual(log.calls, ["done-all 4", "done-all 5"])
        window.filter = .pending
        window.selected = 5
        window.handle(.tickConversation, board: board, actions: log.actions)
        XCTAssertEqual(log.calls, ["done-all 4", "done-all 5", "done-all 5"])
        XCTAssertEqual(window.selected, 3, "nothing after it, so the row before")
    }

    func testViewKeysBelongToTheTaskWindow() {
        let log = Log()
        let popover = TaskNavigator(scope: .popover)
        XCTAssertFalse(popover.handle(.view(2), board: board, actions: log.actions))
        XCTAssertFalse(popover.handle(.nextView, board: board, actions: log.actions))
        XCTAssertFalse(popover.handle(.close, board: board, actions: log.actions), "closing is the app's job")

        let window = TaskNavigator(scope: .window)
        window.handle(.down, board: board, actions: log.actions)
        XCTAssertEqual(window.selected, 4)
        window.handle(.view(2), board: board, actions: log.actions)
        XCTAssertEqual(window.filter, .done)
        XCTAssertNil(window.selected, "a new view starts with nothing highlighted")
        window.handle(.down, board: board, actions: log.actions)
        XCTAssertEqual(window.selected, 8)
        // Row 8 is a checklist: on a parent the arrows fold and unfold, they do not change view.
        XCTAssertTrue(window.handle(.nextView, board: board, actions: log.actions))
        XCTAssertEqual(window.filter, .done)
        window.selected = nil
        window.handle(.nextView, board: board, actions: log.actions)
        XCTAssertEqual(window.filter, .dismissed)
        window.handle(.previousView, board: board, actions: log.actions)
        XCTAssertEqual(window.filter, .done)
        XCTAssertEqual(log.calls, [])
    }
}

final class MenuBarPanelTests: XCTestCase {
    /// The hot key opens the panel from code, so that has to really work: a
    /// real status item, a real panel, shown and closed.
    @MainActor
    func testThePanelOpensAndClosesFromCode() throws {
        let panel = MenuBarPanel(content: NSHostingController(rootView: Text("Hello").frame(width: 200, height: 80)),
                                 pinnedContent: NSHostingController(rootView: Text("Pinned")))
        // Give the menu bar a moment to place the new icon.
        RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        XCTAssertFalse(panel.isShown)
        try XCTSkipUnless(panel.show(), "the menu bar icon is not on screen in this session")
        XCTAssertTrue(panel.isShown)
        XCTAssertNotNil(panel.window)
        // The panel must take the chosen look, not the menu bar's.
        let before = AppearanceSetting.saved
        defer { before.apply() }
        AppearanceSetting.dark.apply()
        XCTAssertEqual(panel.window?.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]), .darkAqua)
        AppearanceSetting.light.apply()
        XCTAssertEqual(panel.window?.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]), .aqua)

        panel.toggle()
        RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        XCTAssertFalse(panel.isShown)
    }

    /// SCR-25: pin the real panel, move it, hide and show it, unpin it.
    /// The tests share the app's settings, so whatever was saved is put back.
    @MainActor
    func testPinnedPanelOpensWhereYouLeftItAndUnpinsBackUnderTheIcon() throws {
        let defaults = UserDefaults.standard
        let before = defaults.string(forKey: PanelPlacement.key)
        let staysBefore = defaults.object(forKey: PanelStaysOpen.key)
        defer {
            defaults.set(before, forKey: PanelPlacement.key)
            defaults.set(staysBefore, forKey: PanelStaysOpen.key)
        }
        PanelPlacement.saved = nil
        // This test is about where the pinned panel goes. The test host is not always the front
        // app, so with the default (close when you go elsewhere, SCR-39) the panel could close
        // under it; that is tested on its own in testPinnedPanelClosesWhenYouGoElsewhereUnlessKeptOpen.
        PanelStaysOpen.isOn = true
        func wait(_ seconds: TimeInterval = 0.3) { RunLoop.current.run(until: Date().addingTimeInterval(seconds)) }

        let pinnedContent = NSHostingController(rootView: Text("Pinned").frame(maxWidth: .infinity, maxHeight: .infinity))
        pinnedContent.sizingOptions = [] // as the app does: the window's size is yours, not the content's
        let panel = MenuBarPanel(content: NSHostingController(rootView: Text("Hello").frame(width: 200, height: 80)),
                                 pinnedContent: pinnedContent)
        wait(0.5)
        XCTAssertFalse(panel.isPinned)
        panel.pin()
        wait()
        XCTAssertTrue(panel.isPinned)
        XCTAssertTrue(panel.isShown, "pinning shows the panel where it is, ready to be moved")
        let window = try XCTUnwrap(panel.window)
        XCTAssertTrue(window is NSPanel, "pinned, it is a window of its own")
        XCTAssertTrue(window.styleMask.contains(.resizable))

        // Move it and make it taller: that is where it opens from now on.
        let screen = try XCTUnwrap(window.screen?.visibleFrame ?? NSScreen.main?.visibleFrame)
        let moved = NSRect(x: screen.maxX - PanelPlacement.width, y: screen.minY, width: PanelPlacement.width, height: (screen.height * 0.8).rounded()) // windows snap to whole points
        window.setFrame(moved, display: true)
        wait()
        XCTAssertEqual(PanelPlacement.saved, moved)

        panel.toggle()
        wait()
        XCTAssertFalse(panel.isShown, "the hot key and the icon hide it")
        XCTAssertTrue(panel.isPinned, "and it stays pinned")
        panel.toggle()
        wait()
        XCTAssertTrue(panel.isShown)
        XCTAssertEqual(panel.window?.frame, moved, "it comes back where you left it")

        // Its close button hides it; it does not unpin it.
        XCTAssertFalse(panel.windowShouldClose(window))
        XCTAssertFalse(panel.isShown)
        XCTAssertTrue(panel.isPinned)

        panel.unpin()
        wait()
        XCTAssertFalse(panel.isPinned)
        XCTAssertNil(PanelPlacement.saved, "the pinned place is forgotten")
        XCTAssertFalse(window.isVisible)
    }

    /// SCR-39: the real pinned panel closes when Didja stops being the front app, and stays
    /// when you chose to keep it open.
    @MainActor
    func testPinnedPanelClosesWhenYouGoElsewhereUnlessKeptOpen() throws {
        let defaults = UserDefaults.standard
        let placeBefore = defaults.string(forKey: PanelPlacement.key)
        let staysBefore = defaults.object(forKey: PanelStaysOpen.key)
        defer {
            defaults.set(placeBefore, forKey: PanelPlacement.key)
            defaults.set(staysBefore, forKey: PanelStaysOpen.key)
        }
        PanelPlacement.saved = nil
        PanelStaysOpen.isOn = false
        func wait(_ seconds: TimeInterval = 0.6) { RunLoop.current.run(until: Date().addingTimeInterval(seconds)) }
        let pinnedContent = NSHostingController(rootView: Text("Pinned").frame(maxWidth: .infinity, maxHeight: .infinity))
        pinnedContent.sizingOptions = []
        let panel = MenuBarPanel(content: NSHostingController(rootView: Text("Hello").frame(width: 200, height: 80)),
                                 pinnedContent: pinnedContent)
        wait(0.5)
        panel.pin()
        wait()
        XCTAssertTrue(panel.isShown)
        defer { panel.unpin() }

        NotificationCenter.default.post(name: NSApplication.didResignActiveNotification, object: NSApplication.shared)
        wait(0.1)
        XCTAssertFalse(panel.isShown, "going to another app closes the pinned panel")
        XCTAssertTrue(panel.isPinned, "and it stays pinned")

        PanelStaysOpen.isOn = true
        XCTAssertTrue(panel.show())
        wait()
        NotificationCenter.default.post(name: NSApplication.didResignActiveNotification, object: NSApplication.shared)
        wait(0.1)
        XCTAssertTrue(panel.isShown, "kept open when you chose that")
        panel.close()
    }
}

final class JudgeTests: XCTestCase {
    /// SCR-45: statements are not asks, questions are worded "Answer <name>: …", never vaguely; Hebrew gets Hebrew examples.
    func testChatInstructionsTellStatementsFromAsksAndWordQuestions() {
        XCTAssertTrue(Judge.chatInstructions.contains("statements about the sender"))
        XCTAssertTrue(Judge.chatInstructions.contains("already answered it in the earlier messages"))
        XCTAssertTrue(Judge.chatInstructions.contains("Answer Ron: does Tuesday work"))
        XCTAssertTrue(Judge.chatInstructions.contains("Never write a vague task"))
        XCTAssertTrue(Judge.hebrewChatInstructions.contains("ענה לרון: האם יום שלישי מתאים"))
        XCTAssertFalse(Judge.hebrewChatInstructions.contains("תגיד לרון"), "the old vague Hebrew example is gone")
    }

    func testThePromptCarriesTheLeadInAndNumberedStepsAndIsBounded() {
        let request = Judge.Request(leadIn: "Order of work", steps: ["Add the schema", "Run the tests"] + Array(repeating: "x", count: 30))
        let prompt = Judge.prompt(for: request)
        XCTAssertTrue(prompt.hasPrefix("Introduced by: \"Order of work\"\n1. Add the schema\n2. Run the tests\n"))
        XCTAssertTrue(prompt.contains("\n12. x\n"))
        XCTAssertFalse(prompt.contains("\n13. "), "long lists are cut off")
        XCTAssertTrue(prompt.hasSuffix("Who is this list for, taken as a whole?"))
    }

    /// "How do I tag a release?" answered with steps: the model is told what you asked (it once took such steps for Claude's plan).
    func testThePromptSaysWhatThePersonAskedWhenItIsKnown() {
        var request = Judge.Request(leadIn: "", steps: ["Tag the commit", "Push the tag"])
        XCTAssertFalse(Judge.prompt(for: request).contains("The person asked"))
        request.asked = "How do I tag v0.2.0 and push it?"
        XCTAssertTrue(Judge.prompt(for: request).hasPrefix("The person asked: \"How do I tag v0.2.0 and push it?\"\nIntroduced by: \"\"\n1. Tag the commit"))
        XCTAssertTrue(Judge.instructions.contains("If they asked how to do something"))
    }

    /// English mail keeps the instructions it always had: Hebrew examples in them leak into English tasks.
    func testOnlyAHebrewEmailGetsTheHebrewInstructions() {
        let english = Judge.MailRequest(from: "Dana Levi", subject: "Q3 numbers", body: "Could you send me the Q3 numbers?\nThanks,\nDana")
        XCTAssertEqual(Judge.mailInstructions(for: english), Judge.mailInstructions)

        let hebrew = Judge.MailRequest(from: "Noa Katz", subject: "טופס 101", body: "נא למלא ולחתום על טופס 101.\nתודה,\nנועה - מש\"א")
        XCTAssertTrue(Judge.mailInstructions(for: hebrew).hasPrefix(Judge.mailInstructions))
        XCTAssertTrue(Judge.mailInstructions(for: hebrew).hasSuffix(Judge.hebrewMailInstructions))

        XCTAssertFalse(Judge.isHebrew("Meeting with יוסי on Monday about the Q3 report"), "a Hebrew name in English mail")
        XCTAssertTrue(Judge.isHebrew("פגישה עם Dana ביום שני בשעה 10"), "an English name in Hebrew mail")
        XCTAssertFalse(Judge.isHebrew("2027 — 101"))
    }
}

final class NestedBoardTests: XCTestCase {
    private static func item(_ id: Int, _ title: String, _ status: TaskItem.Status = .open, parent: Int? = nil,
                             group: Bool = false, collapsed: Bool = false, auto: Bool = false, note: String? = nil,
                             suggestion: String? = nil) -> TaskItem {
        TaskItem(id: id, title: title, status: status, source: "Claude — Stripe webhooks", parentID: parent,
                 isGroup: group, capturedAt: parent == nil ? Date().addingTimeInterval(-300) : nil,
                 collapsed: collapsed, auto: auto, suggestion: suggestion, note: note)
    }

    /// Three levels: a checklist, a parent step inside it, and that step's own steps.
    static let board = TaskBoard(tasks: [
        item(10, "Before this works in prod", group: true),
        item(11, "Set the env vars in Vercel", parent: 10, group: true),
        item(14, "Run the migration: `supabase db push`", parent: 10, auto: true),
        item(15, "Add the redirect URL in Supabase auth settings", .snoozed, parent: 10),
        item(12, "Add `STRIPE_WEBHOOK_SECRET`", .done, parent: 11, auto: true, note: "Saw STRIPE_WEBHOOK_SECRET on vercel.com/acme/shop/settings"),
        item(13, "Add `NEXT_PUBLIC_SITE_URL`", parent: 11, auto: true),
        item(20, "Check the on-device model", group: true, collapsed: true),
        item(21, "Wait about 20 seconds, then open the panel", .done, parent: 20),
        item(22, "Look for “Order of work”", parent: 20),
    ])

    /// The same, with one step that looks done and is waiting for a yes or no.
    static let boardWithSuggestion = TaskBoard(tasks: board.tasks + [
        item(16, "Check the login flow works", parent: 10, suggestion: "Google Chrome — app.example.com/dashboard"),
    ])

    func testAJustFinishedChecklistStaysInPlaceWithItsStepsThenMovesToDone() throws {
        var tasks = Self.board.tasks
        let now = Date()
        // Checklist 20 (folded) was ticked a second ago, and its steps with it.
        for index in tasks.indices where [20, 21, 22].contains(tasks[index].id) {
            tasks[index].status = .done
            tasks[index].doneAt = now.addingTimeInterval(-1)
        }
        XCTAssertEqual(TaskBoard.lingering(in: tasks, now: now), [20], "steps are not listed on their own")

        let fresh = TaskBoard(tasks: tasks, lingering: TaskBoard.lingering(in: tasks, now: now))
        let entry = try XCTUnwrap(fresh.entries(.pending).first { $0.task.id == 20 })
        XCTAssertEqual(entry.steps.map(\.id), [21, 22], "its steps are shown, ticked, though it was folded")
        XCTAssertEqual(entry.steps.map(\.status), [.done, .done])
        XCTAssertEqual(fresh.entries(.done).map(\.task.id), [], "not in Recently done yet")

        let later = now.addingTimeInterval(TaskBoard.lingerSeconds + 0.1)
        let settled = TaskBoard(tasks: tasks, lingering: TaskBoard.lingering(in: tasks, now: later))
        XCTAssertEqual(settled.lingering, [])
        XCTAssertEqual(settled.entries(.pending).map(\.task.id), [10])
        XCTAssertEqual(settled.entries(.done).map(\.task.id), [20])
    }

    func testAFoldedRecentlyDoneListIsNotWalkedByTheKeyboard() {
        var tasks = Self.board.tasks
        for index in tasks.indices where [20, 21, 22].contains(tasks[index].id) {
            tasks[index].status = .done
            tasks[index].doneAt = Date(timeIntervalSince1970: 1)
        }
        let open = TaskBoard(tasks: tasks)
        XCTAssertEqual(open.popoverRows.last?.id, 20)
        let folded = TaskBoard(tasks: tasks, showsRecentlyDone: false)
        XCTAssertEqual(folded.popoverRows.map(\.id), [10, 11, 12, 13, 14, 15])
        XCTAssertEqual(folded.recentlyDone.map(\.task.id), [20], "still counted in its heading")
    }

    func testNSaysNotYetOnlyOnARowThatLooksDone() {
        var said: [Int] = []
        let actions = TaskActions(notYet: { said.append($0.id) })
        let navigator = TaskNavigator(scope: .popover)
        XCTAssertEqual(NavKey(keyCode: 45, hasCommandModifiers: false), .notYet)
        navigator.selected = 16
        navigator.handle(.notYet, board: Self.boardWithSuggestion, actions: actions)
        navigator.selected = 14 // an ordinary open step
        navigator.handle(.notYet, board: Self.boardWithSuggestion, actions: actions)
        XCTAssertEqual(said, [16])
    }

    func testSearchKeepsChecklistsThatMentionTheWordAnywhereUnderThem() {
        XCTAssertEqual(Self.board.sections(.pending, matching: "next_public").flatMap(\.entries).map(\.task.id), [10],
                       "found in a step two levels down")
        XCTAssertEqual(Self.board.sections(.pending, matching: "ON-DEVICE").flatMap(\.entries).map(\.task.id), [20])
        XCTAssertEqual(Self.board.sections(.pending, matching: "nothing like this"), [])
        XCTAssertEqual(Self.board.sections(.pending, matching: "  ").flatMap(\.entries).count, 2, "no search, everything")
    }

    func testFinishedWorkIsListedByDay() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let now = Date(timeIntervalSince1970: 1_794_312_000) // 10 Nov 2026, 12:00 UTC
        var tasks = Self.board.tasks.filter { $0.parentID == nil }
        tasks[0].status = .done
        tasks[0].doneAt = now.addingTimeInterval(-3600)
        tasks[1].status = .done
        tasks[1].doneAt = now.addingTimeInterval(-26 * 3600)
        tasks.append(Self.item(30, "Old one", .done))
        tasks[2].doneAt = now.addingTimeInterval(-9 * 24 * 3600)
        let sections = TaskBoard(tasks: tasks).sectionsByDay(.done, now: now, calendar: calendar)
        XCTAssertEqual(sections.map(\.source), ["Today", "Yesterday", "Sunday, 1 November"].map { $0 }.prefix(2) + [sections.last!.source])
        XCTAssertEqual(sections.map { $0.entries.map(\.task.id) }, [[10], [20], [30]])
        XCTAssertTrue(sections[2].source.contains("November"), sections[2].source)
        XCTAssertEqual(TaskBoard.dayLabel(nil, now: now, calendar: calendar), "Earlier")
    }

    func testASuggestedStepIsStillOpen() {
        let step = Self.boardWithSuggestion.tasks.last!
        XCTAssertEqual(step.status, .open)
        XCTAssertEqual(Self.boardWithSuggestion.openStepCount, 4, "looking done is not done")
    }

    func testRowsComeOutDepthFirstWithTheirDepth() {
        let entry = Self.board.sections(.pending)[0].entries[0]
        XCTAssertEqual(entry.steps.map(\.id), [11, 12, 13, 14, 15])
        XCTAssertEqual(entry.steps.map(\.depth), [1, 2, 2, 1, 1])
        XCTAssertEqual(entry.progress, "1/4", "steps at every depth count; parents do not")
        XCTAssertEqual(Self.board.progress(of: entry.steps[0]), "1/2")
        XCTAssertNil(Self.board.progress(of: entry.steps[1]))
        XCTAssertTrue(Self.board.isPartlyDone(entry.task))
        XCTAssertEqual(Self.board.openStepCount, 3)
    }

    func testACollapsedParentHidesItsRowsButKeepsItsCount() {
        let entry = Self.board.sections(.pending)[0].entries[1]
        XCTAssertEqual(entry.task.id, 20)
        XCTAssertEqual(entry.steps, [])
        XCTAssertEqual(entry.progress, "1/2")

        var board = Self.board
        board.tasks[1].collapsed = true // the inner parent
        XCTAssertEqual(board.sections(.pending)[0].entries[0].steps.map(\.id), [11, 14, 15])
    }

    func testArrowKeysFoldAndUnfoldAParent() {
        var folded: [String] = []
        let actions = TaskActions(setCollapsed: { item, collapsed in folded.append("\(item.id) \(collapsed)") })
        let navigator = TaskNavigator(scope: .popover)
        navigator.selected = 11
        XCTAssertTrue(navigator.handle(.previousView, board: Self.board, actions: actions))
        XCTAssertTrue(navigator.handle(.previousView, board: Self.board, actions: actions), "still handled")
        navigator.selected = 20
        navigator.handle(.nextView, board: Self.board, actions: actions)
        XCTAssertEqual(folded, ["11 true", "11 true", "20 false"])
        // On a step, ← goes to its parent, as in any outline (folding nothing).
        navigator.selected = 14
        let parent = Self.board.tasks.first { $0.id == 14 }?.parentID
        XCTAssertTrue(navigator.handle(.previousView, board: Self.board, actions: actions))
        XCTAssertEqual(navigator.selected, parent)
        XCTAssertEqual(folded.count, 3)
    }

    func testRenamingFromTheKeyboard() {
        var renamed: [String] = []
        let actions = TaskActions(rename: { item, name in renamed.append("\(item.id) \(name)") })
        let navigator = TaskNavigator(scope: .popover)
        XCTAssertEqual(NavKey(keyCode: 15, hasCommandModifiers: false), .rename)
        navigator.selected = 10
        navigator.handle(.rename, board: Self.board, actions: actions)
        XCTAssertEqual(navigator.editing, 10)
        XCTAssertEqual(navigator.draft, "Before this works in prod")

        navigator.draft = "  Stripe go-live "
        navigator.commitRename(Self.board.tasks[0], actions: actions)
        XCTAssertNil(navigator.editing)
        XCTAssertEqual(renamed, ["10 Stripe go-live"])

        // Unchanged, or cancelled: nothing is sent.
        navigator.startRenaming(Self.board.tasks[0])
        navigator.commitRename(Self.board.tasks[0], actions: actions)
        navigator.startRenaming(Self.board.tasks[0])
        navigator.draft = "Something else"
        navigator.cancelRename()
        XCTAssertEqual(renamed.count, 1)
    }

    func testCopyingAStepGivesItsTitleAndAParentGivesItsWholeTree() {
        let byID = Dictionary(uniqueKeysWithValues: Self.board.tasks.map { ($0.id, $0) })
        XCTAssertEqual(Self.board.copyText(for: byID[14]!), "Run the migration: `supabase db push`")
        XCTAssertEqual(Self.board.copyText(for: byID[10]!), """
            Before this works in prod
            - [ ] Set the env vars in Vercel
              - [x] Add `STRIPE_WEBHOOK_SECRET`
              - [ ] Add `NEXT_PUBLIC_SITE_URL`
            - [ ] Run the migration: `supabase db push`
            - [ ] Add the redirect URL in Supabase auth settings
            """, "nested steps are indented, done ones ticked, notes left out")
        XCTAssertEqual(Self.board.copyText(for: byID[11]!), """
            Set the env vars in Vercel
            - [x] Add `STRIPE_WEBHOOK_SECRET`
            - [ ] Add `NEXT_PUBLIC_SITE_URL`
            """, "a parent inside a checklist copies only what is under it")
        XCTAssertEqual(Self.board.copyText(for: byID[20]!), """
            Check the on-device model
            - [x] Wait about 20 seconds, then open the panel
            - [ ] Look for “Order of work”
            """, "a folded parent still copies its steps")

        let sample = TaskBoardTests.sample
        XCTAssertFalse(sample.copyText(for: sample.tasks[0]).contains("Old idea"), "dismissed steps are left out")
        XCTAssertEqual(sample.copyText(for: sample.tasks[5]), "Rotate the old API key")
    }

    func testCommandCCopiesTheHighlightedRowAndChangesNothing() {
        var copied: [String] = []
        let log = TaskNavigatorTests.Log()
        var actions = log.actions
        actions.copy = { copied.append($0) }
        let navigator = TaskNavigator(scope: .popover)

        XCTAssertEqual(NavKey(keyCode: 8, hasCommandModifiers: true, isCommandOnly: true), .copy)
        XCTAssertNil(NavKey(keyCode: 8, hasCommandModifiers: true, isCommandOnly: false), "⌃C, ⌥⌘C and the like are not ours")
        XCTAssertNil(NavKey(keyCode: 13, hasCommandModifiers: true, isCommandOnly: true), "⌘W must still close the window")
        XCTAssertEqual(NavKey(keyCode: 8, hasCommandModifiers: false), .tickConversation, "plain C keeps its meaning")

        // Nothing highlighted: the key is passed on and nothing is copied.
        XCTAssertFalse(navigator.handle(.copy, board: Self.board, actions: actions))
        // The highlighted row is no longer in the list: the same.
        navigator.selected = 999
        XCTAssertFalse(navigator.handle(.copy, board: Self.board, actions: actions))
        XCTAssertEqual(copied, [])
        XCTAssertNil(navigator.copied)

        navigator.selected = 13
        XCTAssertTrue(navigator.handle(.copy, board: Self.board, actions: actions))
        navigator.selected = 11
        XCTAssertTrue(navigator.handle(.copy, board: Self.board, actions: actions))
        XCTAssertEqual(copied, ["Add `NEXT_PUBLIC_SITE_URL`", Self.board.copyText(for: Self.board.tasks[1])])
        XCTAssertEqual(navigator.copied, 11, "the row says it was copied")
        XCTAssertEqual(navigator.selected, 11, "the highlight stays put")
        XCTAssertEqual(log.calls, [], "copying never ticks, snoozes or dismisses anything")

        // From the menu, a parent can also be copied as its title alone.
        navigator.copy(Self.board.tasks[0], board: Self.board, actions: actions, withSteps: false)
        XCTAssertEqual(copied.last, "Before this works in prod")
    }

    func testDismissingAParentMovesTheHighlightPastEverythingUnderIt() {
        let navigator = TaskNavigator(scope: .popover)
        navigator.selected = 11
        navigator.handle(.dismiss, board: Self.board, actions: TaskActions())
        XCTAssertEqual(navigator.selected, 14, "not 12 or 13, which go with their parent")
    }

    /// Draws the nested list to a PNG so the new look can be checked.
    @MainActor
    func testRenderNestedList() throws {
        let navigator = TaskNavigator(scope: .popover)
        navigator.selected = 12
        let view = PopoverTaskList(board: Self.boardWithSuggestion, actions: TaskActions(), navigator: navigator)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .frame(width: 440)
            .background(Palette.surface)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage)
        let png = try XCTUnwrap(image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?
            .representation(using: .png, properties: [:]))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try png.write(to: dir.appendingPathComponent("nested.png"))
        XCTAssertGreaterThan(image.size.height, 100)
    }
}

final class AppearanceTests: XCTestCase {
    func testThreeChoicesMapToTheRightLook() {
        XCTAssertEqual(AppearanceSetting.allCases.map(\.label), ["Follow System", "Light", "Dark"])
        XCTAssertNil(AppearanceSetting.system.appearance, "nil lets macOS decide")
        XCTAssertEqual(AppearanceSetting.light.appearance?.name, .aqua)
        XCTAssertEqual(AppearanceSetting.dark.appearance?.name, .darkAqua)
    }

    func testTheSurfaceIsPaperInLightAndNearBlackInDark() throws {
        func rgb(_ name: NSAppearance.Name) throws -> [Int] {
            var out: [Int] = []
            try XCTUnwrap(NSAppearance(named: name)).performAsCurrentDrawingAppearance {
                let c = Palette.surfaceNS.usingColorSpace(.sRGB)!
                out = [c.redComponent, c.greenComponent, c.blueComponent].map { Int(($0 * 255).rounded()) }
            }
            return out
        }
        XCTAssertEqual(try rgb(.aqua), [250, 250, 247], "Paper #FAFAF7 (SCR-34)")
        XCTAssertEqual(try rgb(.darkAqua), [22, 22, 21], "#161615 (SCR-34)")
    }

    /// Draws the list in dark mode so that look can be checked too.
    @MainActor
    func testRenderNestedListDark() throws {
        let navigator = TaskNavigator(scope: .popover)
        navigator.selected = 12
        let view = PopoverTaskList(board: NestedBoardTests.boardWithSuggestion, actions: TaskActions(), navigator: navigator)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .frame(width: 440)
            .background(Palette.surface)
            .environment(\.colorScheme, .dark)
        var png: Data?
        try XCTUnwrap(NSAppearance(named: .darkAqua)).performAsCurrentDrawingAppearance {
            let renderer = ImageRenderer(content: view)
            renderer.scale = 2
            png = renderer.nsImage?.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?
                .representation(using: .png, properties: [:])
        }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try XCTUnwrap(png).write(to: dir.appendingPathComponent("nested-dark.png"))
    }
}

final class WelcomeTests: XCTestCase {
    /// Draws the first-run screen, once with nothing granted and once with everything.
    @MainActor
    func testRenderWelcome() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        for (name, granted) in [("welcome", false), ("welcome-granted", true)] {
            let view = WelcomeView(accessibilityGranted: { granted }, screenRecordingGranted: { granted })
            let renderer = ImageRenderer(content: view)
            renderer.scale = 2
            let image = try XCTUnwrap(renderer.nsImage)
            XCTAssertEqual(image.size.width, 520)
            let png = try XCTUnwrap(image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?
                .representation(using: .png, properties: [:]))
            try png.write(to: dir.appendingPathComponent("\(name).png"))
        }
    }
}

final class TeachingTests: XCTestCase {
    func testInstructionsAreYoursOrBuiltInThenYourCorrections() {
        XCTAssertEqual(Judge.compose("Built in.", nil), "Built in.")
        XCTAssertEqual(Judge.compose("Built in.", Judge.Teach(instructions: "  ", examples: [])), "Built in.")
        XCTAssertEqual(Judge.compose("Built in.", Judge.Teach(instructions: "Mine.", examples: nil)), "Mine.")
        let both = Judge.compose("Built in.", Judge.Teach(instructions: nil, examples: ["\"Review the PR\" was not something for me to do."]))
        XCTAssertTrue(both.hasPrefix("Built in.\n\nThe person using this app corrected earlier answers."))
        XCTAssertTrue(both.hasSuffix("- \"Review the PR\" was not something for me to do."))
        XCTAssertEqual(Judge.compose("x", Judge.Teach(instructions: String(repeating: "a", count: 5000), examples: nil)).count, 4000)
        let many = Judge.compose("x", Judge.Teach(instructions: nil, examples: (1...20).map { "case \($0)" }))
        XCTAssertFalse(many.contains("case 8\n"), "only the last twelve")
        XCTAssertTrue(many.hasSuffix("- case 20"))
    }

    func testEmailInstructionsKeepTheHebrewGuidanceUnderYourOwn() throws {
        let decoded = try JSONDecoder().decode(Judge.MailRequest.self, from: Data(#"{"from":"x","subject":"שלום","body":"אבקש לשלוח חוזה","teach":{"instructions":"Mine.","examples":["one"]}}"#.utf8))
        let text = Judge.mailInstructions(for: decoded)
        XCTAssertTrue(text.hasPrefix("Mine. "))
        XCTAssertTrue(text.contains(Judge.hebrewMailInstructions))
        XCTAssertTrue(text.hasSuffix("- one"))
    }

    private let shown = #"{"jobs":{"lists":null,"titles":null,"emails":"Treat my bank's mail as tasks.","looks-done":null},"lessons":[{"id":3,"job":"lists","kind":"not-an-action","key":"k","example":"\"Review the PR\" was not something for me to do.","createdAt":"2026-11-10T10:00:00.000Z"}]}"#

    func testTheWindowReadsAndWritesThroughTheEngine() {
        var ran: [([String], String?)] = []
        let model = BrainModel(fetch: { self.shown }, run: { ran.append(($0, $1)); return true })
        XCTAssertTrue(model.isCustom(.emails))
        XCTAssertFalse(model.isCustom(.lists))
        XCTAssertEqual(model.drafts[.lists], Judge.instructions, "the built-in text is shown to read")
        XCTAssertEqual(model.lessons(for: .lists).map(\.id), [3])
        XCTAssertFalse(model.isEdited(.lists))
        model.drafts[.lists] = "My own rules."
        XCTAssertTrue(model.isEdited(.lists))
        model.save(.lists)
        model.drafts[.titles] = Judge.titleInstructions + "\n"
        model.save(.titles)
        model.reset(.emails)
        model.forget(model.lessons[0])
        XCTAssertEqual(ran.map(\.0), [["brain", "set", "lists"], ["brain", "reset", "titles"], ["brain", "reset", "emails"], ["brain", "forget", "3"]])
        XCTAssertEqual(ran[0].1, "My own rules.")
    }

    func testAnUnreadableAnswerSaysSo() {
        let model = BrainModel(fetch: { nil }, run: { _, _ in true })
        XCTAssertNotNil(model.error)
    }

    /// Draws the window to $TMPDIR/didja-ui/brain.png.
    @MainActor
    func testRenderBrain() throws {
        let model = BrainModel(fetch: { self.shown }, run: { _, _ in true })
        let renderer = ImageRenderer(content: BrainContent(model: model))
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage)
        XCTAssertEqual(image.size.width, BrainView.width)
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let png = try XCTUnwrap(image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?
            .representation(using: .png, properties: [:]))
        try png.write(to: dir.appendingPathComponent("brain.png"))
        // In a real window it lays out at its fixed width, also after the content changes.
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: BrainView.width, height: 680),
                              styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentViewController = NSHostingController(rootView: BrainView(model: model))
        window.setContentSize(NSSize(width: BrainView.width, height: 680))
        window.orderFront(nil)
        window.layoutIfNeeded()
        model.drafts[.lists] = String(repeating: "A much longer set of instructions. ", count: 60)
        window.layoutIfNeeded()
        window.displayIfNeeded()
        XCTAssertEqual(window.contentLayoutRect.width, BrainView.width)
        window.close()
    }
}

final class ForgetPromptTests: XCTestCase {
    func testOnlyAnExplicitDeleteDeletes() {
        XCTAssertEqual(ForgetPrompt.buttons, ["Delete", "Cancel"])
        XCTAssertTrue(ForgetPrompt.deletes(.alertFirstButtonReturn))
        XCTAssertFalse(ForgetPrompt.deletes(.alertSecondButtonReturn), "Cancel")
        XCTAssertFalse(ForgetPrompt.deletes(.cancel), "the alert closed some other way")
        XCTAssertFalse(ForgetPrompt.deletes(.abort))
        XCTAssertFalse(ForgetPrompt.deletes(.stop))
    }

    func testTheMessageSaysHowMuchAndThatTasksStay() {
        XCTAssertTrue(ForgetPrompt.message(observations: 1234).hasPrefix("1234 pieces of text"))
        XCTAssertTrue(ForgetPrompt.message(observations: 1).hasPrefix("1 piece of text"))
        XCTAssertTrue(ForgetPrompt.message(observations: 5).contains("Tasks already found stay"))
    }
}

final class WelcomeWindowTests: XCTestCase {
    /// The window re-checks the permissions every second, so its content changes while it is
    /// on screen. Flip them several times and check the content never resizes the window.
    @MainActor
    func testTheWindowSurvivesPermissionsChangingWhileOpen() throws {
        var granted = false
        func content() -> WelcomeWindowContent {
            WelcomeWindowContent(content: WelcomeView(accessibilityGranted: { granted }, screenRecordingGranted: { granted }))
        }
        let controller = NSHostingController(rootView: content())
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: WelcomeView.width, height: 640),
                              styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentViewController = controller
        window.setContentSize(NSSize(width: WelcomeView.width, height: 640))
        window.orderFront(nil)
        for _ in 0..<8 {
            granted.toggle()
            controller.rootView = content()
            window.layoutIfNeeded()
            window.displayIfNeeded()
            RunLoop.main.run(until: Date().addingTimeInterval(0.02))
        }
        XCTAssertEqual(window.contentLayoutRect.width, WelcomeView.width, "the content never resizes the window")
        XCTAssertEqual(window.contentLayoutRect.height, 640, "nor its height")
        window.close()
    }
}

/// SCR-22 review: pressing F (or clicking the search bar) must put the keyboard in the
/// search field at once, so the next letters are typed into it.
final class SearchFocusTests: XCTestCase {
    @MainActor
    func testStartingASearchPutsTheKeyboardInTheField() throws {
        let navigator = TaskNavigator(scope: .popover)
        let controller = NSHostingController(rootView: PopoverSearchBar(navigator: navigator).frame(width: 300).padding(8))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 320, height: 60),
                              styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentViewController = controller
        window.makeKeyAndOrderFront(nil)
        defer { window.close() }
        func settle() {
            for _ in 0..<10 {
                window.layoutIfNeeded()
                RunLoop.main.run(until: Date().addingTimeInterval(0.02))
            }
        }
        func fieldHasKeyboard() -> Bool {
            guard let editor = window.firstResponder as? NSTextView, editor.isFieldEditor else { return false }
            return editor.delegate is NSTextField
        }
        settle()
        XCTAssertFalse(fieldHasKeyboard(), "the panel opens with the keyboard on the list, not in a field")

        // F: the same thing the key handler does.
        XCTAssertTrue(navigator.handle(.search, board: TaskBoard(tasks: []), actions: TaskActions()))
        settle()
        XCTAssertTrue(fieldHasKeyboard(), "after F the search field has the keyboard")

        // Typing goes into the field and narrows the list.
        (window.firstResponder as? NSTextView)?.insertText("plan", replacementRange: NSRange(location: NSNotFound, length: 0))
        settle()
        XCTAssertEqual(navigator.query, "plan")

        // ↓ hands the keyboard back to the list; the search stays.
        XCTAssertTrue(navigator.handleWhileSearching(keyCode: 125, board: TaskBoard(tasks: []), actions: TaskActions()))
        settle()
        XCTAssertFalse(navigator.searching)
        XCTAssertFalse(fieldHasKeyboard(), "the list has the keyboard again, so letters are shortcuts")
        XCTAssertEqual(navigator.query, "plan")

        // F again goes back into the field that is already on show.
        XCTAssertTrue(navigator.handle(.search, board: TaskBoard(tasks: []), actions: TaskActions()))
        settle()
        XCTAssertTrue(fieldHasKeyboard(), "F returns to a search already on show")
    }

    /// The same in the real panel: the whole panel view, in a popover, as the menu bar shows it.
    @MainActor
    func testFInThePanelPutsTheKeyboardInTheSearchField() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-focus-\(UUID().uuidString)")
        let navigator = TaskNavigator(scope: .popover)
        let content = NSHostingController(rootView: PopoverView(
            capture: CaptureCoordinator(supportDirectory: dir), actions: TaskActions(), navigator: navigator, openWindow: {}))
        content.sizingOptions = [.preferredContentSize]
        let anchor = NSWindow(contentRect: NSRect(x: 200, y: 600, width: 60, height: 30),
                              styleMask: [.borderless], backing: .buffered, defer: false)
        anchor.isReleasedWhenClosed = false
        anchor.orderFront(nil)
        let popover = NSPopover()
        popover.contentViewController = content
        popover.animates = false
        popover.behavior = .applicationDefined
        popover.show(relativeTo: anchor.contentView!.bounds, of: anchor.contentView!, preferredEdge: .minY)
        defer { popover.close(); anchor.close() }
        let window = try XCTUnwrap(content.view.window)
        window.makeKey()
        func settle() {
            for _ in 0..<15 {
                window.layoutIfNeeded()
                RunLoop.main.run(until: Date().addingTimeInterval(0.02))
            }
        }
        func fieldHasKeyboard() -> Bool {
            guard let editor = window.firstResponder as? NSTextView, editor.isFieldEditor else { return false }
            return editor.delegate is NSTextField
        }
        settle()
        XCTAssertFalse(fieldHasKeyboard())
        XCTAssertTrue(navigator.handle(.search, board: TaskBoard(tasks: []), actions: TaskActions()))
        settle()
        XCTAssertTrue(fieldHasKeyboard(), "after F in the panel the search field has the keyboard")
    }

    /// If the keyboard is not in the field while a search is on, a typed key is
    /// still not lost: the field takes the keyboard and the key.
    @MainActor
    func testAKeyThatWouldMissTheFieldGoesToIt() throws {
        let navigator = TaskNavigator(scope: .popover)
        let controller = NSHostingController(rootView: PopoverSearchBar(navigator: navigator).frame(width: 300).padding(8))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 320, height: 60),
                              styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentViewController = controller
        window.makeKeyAndOrderFront(nil)
        defer { window.close() }
        func settle() {
            for _ in 0..<10 {
                window.layoutIfNeeded()
                RunLoop.main.run(until: Date().addingTimeInterval(0.02))
            }
        }
        XCTAssertFalse(SearchTextField.takeKey(try Self.key("x", in: window), in: window), "no search on show, nothing to give it to")
        navigator.searching = true
        settle()
        // Knock the keyboard out of the field behind the search's back.
        window.makeFirstResponder(nil)
        XCTAssertNotNil(SearchTextField.field(in: window))
        XCTAssertTrue(SearchTextField.takeKey(try Self.key("d", in: window), in: window))
        settle()
        XCTAssertEqual(navigator.query, "d", "D is typed into the search, never taken as Dismiss")
        XCTAssertTrue(navigator.searching)
        XCTAssertFalse(SearchTextField.takeKey(try Self.key("x", in: window), in: window), "the field has the keyboard: the key goes to it the normal way")
    }

    static func key(_ characters: String, in window: NSWindow) throws -> NSEvent {
        try XCTUnwrap(NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [],
                                       timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                                       context: nil, characters: characters, charactersIgnoringModifiers: characters,
                                       isARepeat: false, keyCode: 2))
    }
}

/// SCR-25: the panel pinned to a place of your choosing.
final class PinnedPanelTests: XCTestCase {
    let main = NSRect(x: 0, y: 0, width: 1512, height: 944)
    let right = NSRect(x: 1512, y: 0, width: 1920, height: 1055)

    func testAFrameOnScreenIsKeptWhereYouLeftIt() {
        let frame = NSRect(x: 1000, y: 100, width: 440, height: 700)
        XCTAssertEqual(PanelPlacement.fitted(frame, screens: [main, right]), frame)
    }

    func testOnlyTheHeightIsYours() {
        let wide = PanelPlacement.fitted(NSRect(x: 100, y: 100, width: 900, height: 500), screens: [main])
        XCTAssertEqual(wide.width, PanelPlacement.width)
        let short = PanelPlacement.fitted(NSRect(x: 100, y: 100, width: 440, height: 40), screens: [main])
        XCTAssertEqual(short.height, PanelPlacement.minHeight, "never too short to use")
        let tall = PanelPlacement.fitted(NSRect(x: 100, y: 0, width: 440, height: 5000), screens: [main])
        XCTAssertEqual(tall.height, main.height, "never taller than the screen")
        XCTAssertEqual(tall.minY, main.minY)
    }

    func testAPanelHalfOffTheEdgeIsPulledBackOn() {
        let frame = PanelPlacement.fitted(NSRect(x: 1300, y: 600, width: 440, height: 500), screens: [main])
        XCTAssertEqual(frame.maxX, main.maxX)
        XCTAssertEqual(frame.maxY, main.maxY)
        XCTAssertTrue(main.contains(frame))
    }

    func testItStaysOnTheDisplayItOverlapsMost() {
        // Mostly on the right display: it goes wholly onto that one, not back to the main one.
        let frame = PanelPlacement.fitted(NSRect(x: 1400, y: 200, width: 440, height: 600), screens: [main, right])
        XCTAssertTrue(right.contains(frame))
        XCTAssertEqual(frame.minX, right.minX)
    }

    func testAPanelOnADisplayThatIsGoneComesToTheFirstScreensTopRight() {
        let frame = PanelPlacement.fitted(NSRect(x: 4000, y: 200, width: 440, height: 600), screens: [main])
        XCTAssertEqual(frame.size, NSSize(width: 440, height: 600))
        XCTAssertEqual(frame.maxX, main.maxX)
        XCTAssertEqual(frame.maxY, main.maxY)
    }

    func testPinningWhileClosedStartsUnderTheIcon() {
        let frame = PanelPlacement.underIcon(NSRect(x: 1200, y: 920, width: 30, height: 24), screen: main)
        XCTAssertEqual(frame.midX, 1215)
        XCTAssertEqual(frame.maxY, 920)
        XCTAssertEqual(frame.width, PanelPlacement.width)
    }

    func testTheSavedPlaceSurvivesARestart() {
        let defaults = UserDefaults.standard
        let before = defaults.string(forKey: PanelPlacement.key)
        defer { defaults.set(before, forKey: PanelPlacement.key) }
        let frame = NSRect(x: 1070, y: 60, width: 440, height: 820)
        PanelPlacement.saved = frame
        XCTAssertEqual(defaults.string(forKey: PanelPlacement.key), NSStringFromRect(frame), "kept in the app's settings")
        XCTAssertEqual(PanelPlacement.decode(defaults.string(forKey: PanelPlacement.key)), frame)
        PanelPlacement.saved = nil
        XCTAssertNil(PanelPlacement.saved, "unpinned: nothing is kept")
        XCTAssertNil(PanelPlacement.decode("junk"))
    }

    /// The pinned panel in a real window: the window's height is yours (the content never
    /// resizes it) and the list fills it. Drawn to `panel-pinned.png`.
    @MainActor
    func testThePinnedPanelFillsTheHeightYouGiveIt() throws {
        // macOS shrinks a window taller than the screen (CI runners have small screens).
        try XCTSkipIf((NSScreen.main?.visibleFrame.height ?? 0) < 760, "the screen is too short for a 700-point window")
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-pin-\(UUID().uuidString)")
        let content = NSHostingController(rootView: PopoverView(
            capture: CaptureCoordinator(supportDirectory: dir), actions: TaskActions(),
            navigator: TaskNavigator(scope: .popover), openWindow: {}, pinned: true))
        content.sizingOptions = []
        let window = NSPanel(contentRect: NSRect(x: 0, y: 0, width: PanelPlacement.width, height: 700),
                             styleMask: [.titled, .closable, .resizable, .utilityWindow], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentViewController = content
        defer { window.close() }
        for height: CGFloat in [700, 380] {
            window.setContentSize(NSSize(width: PanelPlacement.width, height: height))
            window.orderFront(nil)
            for _ in 0..<10 {
                window.layoutIfNeeded()
                RunLoop.main.run(until: Date().addingTimeInterval(0.02))
            }
            XCTAssertEqual(window.contentLayoutRect.height, height, "the panel's content never resizes the pinned window")
            XCTAssertEqual(content.view.frame.height, height, "the panel fills the window")
        }
        let view = content.view
        let rep = try XCTUnwrap(view.bitmapImageRepForCachingDisplay(in: view.bounds))
        view.cacheDisplay(in: view.bounds, to: rep)
        let png = try XCTUnwrap(rep.representation(using: .png, properties: [:]))
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        try png.write(to: out.appendingPathComponent("panel-pinned.png"))
    }
}

final class OutlookMailTests: XCTestCase {
    func testAnOpenEmailComesOutAsItsOwnSection() {
        func text(_ s: String) -> AXNode { AXNode(role: "AXStaticText", text: s) }
        func line(_ s: String) -> AXNode { AXNode(role: "AXGroup", children: [text(s)]) }
        // What the walk builds for Outlook's reading pane.
        let window = AXNode(role: "AXWindow", children: [
            AXNode(role: "AXGroup", children: [text("Inbox"), text("Sent Items")]),
            AXNode(role: "AXGroup", subrole: "AXDocumentArticle", text: MailSection.name(subject: " Q3 budget numbers "), children: [
                AXNode(role: "AXButton", text: "Reply"),
                line("From: Dana Levi, dana@example.com"),
                line("Date: Today at 15:05"),
                line("To: me@example.com"),
            ]),
            AXNode(role: "AXWebArea", children: [
                AXNode(role: "AXGroup", children: [text("Hi, can you send me the updated numbers by Thursday?")]),
                AXNode(role: "AXGroup", children: [text("Thanks, Dana")]),
            ]),
        ])
        XCTAssertEqual(AXCapture.lines(from: window), [
            "Inbox", "Sent Items",
            "⟦Email: Q3 budget numbers⟧", "From: Dana Levi, dana@example.com", "Date: Today at 15:05", "To: me@example.com",
            "Hi, can you send me the updated numbers by Thursday?", "Thanks, Dana",
        ])
    }

    func testALinkInAnEmailKeepsWhereItPoints() {
        func text(_ s: String) -> AXNode { AXNode(role: "AXStaticText", text: s) }
        let approve = AXNode(role: "AXLink", children: [text("Approve")], url: "https://pmo.example.com/main.aspx?id=7e11c297")
        let shown = AXNode(role: "AXLink", children: [text("https://acme.com/orders/17")], url: "https://acme.com/orders/17")
        let button = AXNode(role: "AXLink", text: "Open the form", url: "https://forms.example.com/f/9")
        let body = AXNode(role: "AXGroup", children: [
            AXNode(role: "AXGroup", children: [text("Please "), approve, text(" by Friday.")]),
            AXNode(role: "AXGroup", children: [text("Order: "), shown]),
            button,
        ])
        XCTAssertEqual(AXCapture.lines(from: body), [
            "Please Approve ⟨https://pmo.example.com/main.aspx?id=7e11c297⟩ by Friday.",
            "Order: https://acme.com/orders/17",
            // A link on its own with only a title is not read as words (as with buttons); its target still is.
            "⟨https://forms.example.com/f/9⟩",
        ])
        // Links with no target kept (anywhere but an email's body) read as before.
        let plain = AXNode(role: "AXGroup", children: [text("Please "), AXNode(role: "AXLink", children: [text("Approve")]), text(" now.")])
        XCTAssertEqual(AXCapture.lines(from: plain), ["Please Approve now."])
    }

    func testOnlyWebAddressesAreKeptAsLinkTargets() {
        XCTAssertEqual(AXCapture.mailLinkTarget(URL(string: "https://acme.com/x")), "https://acme.com/x")
        XCTAssertNil(AXCapture.mailLinkTarget(URL(string: "mailto:dana@acme.com")))
        XCTAssertNil(AXCapture.mailLinkTarget(URL(string: "tel:+972500000000")))
        XCTAssertNil(AXCapture.mailLinkTarget(URL(string: "https://acme.com/" + String(repeating: "a", count: 600))))
        XCTAssertNil(AXCapture.mailLinkTarget(nil))
    }

    func testEachMessageOfAGmailThreadIsItsOwnSection() {
        func text(_ s: String) -> AXNode { AXNode(role: "AXStaticText", text: s) }
        func line(_ s: String) -> AXNode { AXNode(role: "AXGroup", children: [text(s)]) }
        func message(_ index: Int, _ lines: [String]) -> AXNode {
            AXNode(role: "AXGroup", children: [
                AXNode(role: "AXGroup", subrole: "AXDocumentArticle", text: MailSection.name(subject: "Q3 numbers", index: index),
                       children: lines.map(line)),
                AXNode(role: "AXGroup", subrole: "AXDocumentArticle", text: "Page"),
            ])
        }
        let page = AXNode(role: "AXWebArea", children: [
            message(1, ["From: Dana Levi", "Date: Mon 9 Nov, 15:05", "To: me", "Can you send the numbers?"]),
            message(2, ["From: Mike", "Date: Mon 9 Nov, 16:20", "To: Dana", "Attached."]),
            line("Reply"),
        ])
        XCTAssertEqual(AXCapture.lines(from: page), [
            "⟦Email 1: Q3 numbers⟧", "From: Dana Levi", "Date: Mon 9 Nov, 15:05", "To: me", "Can you send the numbers?", "⟦Page⟧",
            "⟦Email 2: Q3 numbers⟧", "From: Mike", "Date: Mon 9 Nov, 16:20", "To: Dana", "Attached.", "⟦Page⟧",
            "Reply",
        ])
    }
}

final class WalkStackTests: XCTestCase {
    /// A deep web page overflowed the capture queue's 512 KB stack (crash 2026-11-10 23:58).
    func testTheWalkRunsOnALargeStackEvenFromTheCaptureQueue() {
        let queue = DispatchQueue(label: "test.capture", qos: .utility)
        var size = 0
        var value = 0
        queue.sync {
            (size, value) = AXCapture.withLargeStack { (Thread.current.stackSize, 42) }
        }
        XCTAssertGreaterThanOrEqual(size, 16 << 20)
        XCTAssertEqual(value, 42)
    }
}

final class SourceJumperTests: XCTestCase {
    func testTheLineIsFoundByItsWordsAndTheShortestTextWins() {
        let texts = [
            "Once the deploy finishes: 1. Check the login flow works 2. Add the redirect URL in Supabase auth settings",
            "Add the redirect URL in Supabase auth settings",
            "Check the login flow works",
        ]
        XCTAssertEqual(SourceJumper.bestMatch(look: ["Add the redirect URL in Supabase auth settings"], in: texts), 1)
        // A line split by a link still matches the paragraph that joins it.
        XCTAssertEqual(SourceJumper.bestMatch(look: ["Check the login flow works"], in: ["Check the", "login flow", "Check the login flow works"]), 2)
    }

    func testANearMissIsNotTakenForTheLine() {
        XCTAssertNil(SourceJumper.bestMatch(look: ["Rotate the old Stripe key"], in: ["Stripe dashboard", "Old keys"]))
        XCTAssertNil(SourceJumper.bestMatch(look: ["Do it."], in: ["Do it now"])) // no telling words
    }

    func testAnEmailIsLookedForByItsSubjectFirst() {
        let texts = ["Dana Levi Q3 budget numbers 10:41", "Send the Q3 budget numbers to Dana"]
        XCTAssertEqual(SourceJumper.bestMatch(look: ["Q3 budget numbers", "Send the numbers"], in: texts), 0)
    }

    func testTheWindowIsKnownDespiteAChangedUnreadCount() {
        let titles = ["Inbox (4) - me@example.com - Gmail", "Stripe webhooks"]
        XCTAssertEqual(SourceJumper.windowIndex(title: "Stripe webhooks", among: titles), 1)
        XCTAssertEqual(SourceJumper.windowIndex(title: "Inbox (12) - me@example.com - Gmail", among: titles), 0)
        XCTAssertNil(SourceJumper.windowIndex(title: "Notes", among: titles))
        XCTAssertNil(SourceJumper.windowIndex(title: "", among: ["", "x"]))
    }

    func testAConversationIsNamedFromItsWindowTitle() {
        func place(_ window: String, _ app: String) -> TaskPlace {
            TaskPlace(bundleId: "x", app: app, window: window, url: nil, look: [])
        }
        XCTAssertEqual(SourceJumper.conversationName(place("Didja project bootstrap - Claude Code", "Claude")), "Didja project bootstrap")
        XCTAssertEqual(SourceJumper.conversationName(place("Stripe webhooks", "Claude")), "Stripe webhooks")
        XCTAssertNil(SourceJumper.conversationName(place("Claude", "Claude")))
    }

    func testTheEnginesPlaceDecodes() throws {
        let json = #"{"bundleId":"com.google.Chrome","app":"Google Chrome","window":"Inbox","url":"https://mail.google.com/mail/u/0/#inbox/abc","look":["Q3 budget"]}"#
        let place = try JSONDecoder().decode(TaskPlace.self, from: Data(json.utf8))
        XCTAssertEqual(place.url, "https://mail.google.com/mail/u/0/#inbox/abc")
        XCTAssertEqual(NavKey(keyCode: 5, hasCommandModifiers: false), .goToSource)
    }
}

/// Go to Source scrolls someone's screen: it must stop the moment they do anything, and never press a button.
final class GoToSourceHandsOffTests: XCTestCase {
    private func reason(scrolling: TimeInterval = 1, running: TimeInterval = 2, moved: CGFloat = 0,
                        front: Bool = true, input: TimeInterval = 60, scroll: TimeInterval = 60) -> String? {
        SourceJumper.stopReason(scrolling: scrolling, running: running, pointerMoved: moved, frontIsOurs: front,
                                secondsSinceInput: input, secondsSinceScroll: scroll)
    }

    func testCarriesOnWhileYouLeaveItAlone() {
        XCTAssertNil(reason())
    }

    func testStopsWhenYouPressAKeyClickOrScroll() {
        XCTAssertNotNil(reason(running: 2, input: 0.5))   // a key (Esc) or a click after it started
        XCTAssertNotNil(reason(running: 2, scroll: 0.2))  // a scroll of yours
        XCTAssertNil(reason(running: 2, input: 30))       // typing from before it started does not count
    }

    func testStopsWhenYouMoveThePointerOrSwitchApps() {
        XCTAssertNotNil(reason(moved: 10))
        XCTAssertNil(reason(moved: 1))
        XCTAssertNotNil(reason(front: false))
    }

    func testStopsAfterFiveSecondsOfScrollingOrTenInAll() {
        XCTAssertNotNil(reason(scrolling: 5.1, running: 6))
        XCTAssertNotNil(reason(scrolling: 0, running: 10.1))
        XCTAssertNil(reason(scrolling: 4.9, running: 9.9))
    }

    func testButtonsAreNeverPressedOnlyLinksFollowedAndRowsSelected() {
        XCTAssertEqual(SourceJumper.sidebarStep(role: "AXLink"), .follow)
        XCTAssertEqual(SourceJumper.sidebarStep(role: "AXRow"), .select)
        XCTAssertEqual(SourceJumper.sidebarStep(role: "AXCell"), .select)
        for role in ["AXButton", "AXMenuButton", "AXPopUpButton", "AXCheckBox", "AXRadioButton", "AXMenuItem"] {
            XCTAssertEqual(SourceJumper.sidebarStep(role: role), .never, role)
        }
        XCTAssertEqual(SourceJumper.sidebarStep(role: "AXStaticText"), .climb)
    }

    func testTheWheelTurnsInTheMessagesColumnHalfwayDownTheWindowEvenWhenTheMessageIsOffScreen() {
        let window = CGRect(x: 218, y: 100, width: 1344, height: 928)
        let message = CGRect(x: 600, y: -3000, width: 700, height: 40)
        XCTAssertEqual(SourceJumper.wheelPoint(message: message, window: window), CGPoint(x: 950, y: 564))
    }

    func testTheSidebarsColumnIsNotTheConversation() {
        let sidebar = CGRect(x: 226, y: 300, width: 268, height: 30)
        XCTAssertTrue(SourceJumper.inColumn(CGRect(x: 230, y: 900, width: 250, height: 20), of: sidebar))
        XCTAssertFalse(SourceJumper.inColumn(CGRect(x: 600, y: 900, width: 700, height: 20), of: sidebar))
        XCTAssertTrue(SourceJumper.isMessage("Quit the development copy from its menu bar icon before you start"))
        XCTAssertFalse(SourceJumper.isMessage("Acme_Dashboard repo Linear connection"))
    }
}

final class ConversationButtonTests: XCTestCase {
    let window = CGRect(x: 218, y: 100, width: 1344, height: 928)
    let sidebar = CGRect(x: 226, y: 300, width: 268, height: 30)

    func testOnlyASidebarButtonThatIsExactlyTheConversationsNameMayBePressed() {
        let name = "Acme_Dashboard repo Linear connection"
        XCTAssertTrue(SourceJumper.mayPressConversationButton(role: "AXButton", text: name, name: name, button: sidebar, window: window))
        // Anything more than the name, another kind of control, or outside the sidebar: never.
        XCTAssertFalse(SourceJumper.mayPressConversationButton(role: "AXButton", text: "Delete \(name)", name: name, button: sidebar, window: window))
        XCTAssertFalse(SourceJumper.mayPressConversationButton(role: "AXButton", text: "Delete", name: name, button: sidebar, window: window))
        XCTAssertFalse(SourceJumper.mayPressConversationButton(role: "AXMenuButton", text: name, name: name, button: sidebar, window: window))
        XCTAssertFalse(SourceJumper.mayPressConversationButton(role: "AXButton", text: name, name: name,
                                                               button: CGRect(x: 900, y: 300, width: 200, height: 30), window: window))
        XCTAssertFalse(SourceJumper.mayPressConversationButton(role: "AXButton", text: "", name: "", button: sidebar, window: window))
        XCTAssertFalse(SourceJumper.mayPressConversationButton(role: "AXButton", text: name, name: name, button: nil, window: window))
    }

    func testTheNameMayBeFollowedOnlyByAFewStatusWords() {
        let name = "Acme_Dashboard repo Linear connection"
        for ok in ["\(name) Running", "\(name) 2m", "\(name) · 5h ago", "\(name) Unread"] {
            XCTAssertTrue(SourceJumper.isNameWithStatus(ok, name: name), ok)
            XCTAssertTrue(SourceJumper.mayPressConversationButton(role: "AXButton", text: ok, name: name, button: sidebar, window: window), ok)
        }
        for no in ["\(name) Delete", "\(name) Archive", "\(name) Rename", "\(name)s", "Delete \(name)",
                   "\(name) running now just 2m ago"] {
            XCTAssertFalse(SourceJumper.isNameWithStatus(no, name: name), no)
        }
    }
}

/// Chat apps: each message labelled with its chat, kind, sender and time (ChatAdapter).
final class ChatAdapterTests: XCTestCase {
    func testTheSectionLineCarriesTheChatSoEachMessageStandsOnItsOwn() {
        let m = ChatAdapter.Message(chat: "Team ⟦x⟧ — chat", kind: .group, from: "Ron", mentionsMe: true, time: "Today at 9:05", text: "")
        XCTAssertEqual(ChatAdapter.sectionName(m), "Chat message: Team x - chat (group) — from Ron, mentions me — Today at 9:05")
    }

    func testTheOutlineToolMasksEverythingButUIWords() {
        XCTAssertEqual(AXOutline.mask("Message from Dana, 9 October at 12:34"), "Message from xxxx, 9 October at 99:99")
        XCTAssertEqual(AXOutline.mask("שלום Dana"), "hhhh xxxx")
    }
}


/// The Your Names window: names shown, edited through the engine's `names` command.
final class NamesTests: XCTestCase {
    private func model(_ json: String, calls: @escaping ([String]) -> Void = { _ in }) -> NamesModel {
        var current = json
        return NamesModel(fetch: { current }, run: { args in
            calls(args)
            if args == ["names", "add", "Rosie"] { current = #"{"mac":"Mike Rosen","name":null,"mail":[],"others":["מייק","Rosie"]}"# }
            return true
        })
    }

    func testAddingRemovingAndSettingYourNameRunTheEngine() {
        var ran: [[String]] = []
        let m = model(#"{"mac":"Mike Rosen","name":null,"mail":["Mike Rosen"],"others":["מייק"]}"#) { ran.append($0) }
        XCTAssertEqual(m.nameInUse, "Mike Rosen")
        XCTAssertFalse(m.nameEdited)
        m.newName = "  Rosie  "
        m.add()
        XCTAssertEqual(ran.last, ["names", "add", "Rosie"])
        XCTAssertEqual(m.newName, "")
        XCTAssertEqual(m.names.others, ["מייק", "Rosie"])
        m.remove("מייק")
        XCTAssertEqual(ran.last, ["names", "remove", "מייק"])
        m.nameDraft = "Mike S."
        XCTAssertTrue(m.nameEdited)
        m.saveName()
        XCTAssertEqual(ran.last, ["names", "set", "Mike S."])
        // Empty, or the Mac's own name: back to following the Mac.
        m.nameDraft = ""
        m.saveName()
        XCTAssertEqual(ran.last, ["names", "set"])
    }

    /// Draws the window's content to `$TMPDIR/didja-ui/names.png`.
    @MainActor
    func testRenderNames() throws {
        let m = model(#"{"mac":"Mike Rosen","name":null,"mail":["Mike Rosen"],"others":["מייק","Rosie"]}"#)
        let renderer = ImageRenderer(content: NamesContent(model: m).background(Color(nsColor: .windowBackgroundColor)))
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage)
        let png = try XCTUnwrap(image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?
            .representation(using: .png, properties: [:]))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try png.write(to: dir.appendingPathComponent("names.png"))
        XCTAssertGreaterThan(image.size.height, 200)
    }
}



/// The Connections window: everything goes through the engine.
final class ConnectionsTests: XCTestCase {
    private func model(calls: @escaping ([String]) -> Void = { _ in }) -> ConnectionsModel {
        ConnectionsModel(run: { args in
            calls(args)
            if args == ["connections", "--json"] {
                return (true, #"[{"id":"linear","kind":"linear","name":"Linear","onDone":{"state":"Done"},"whenSure":true,"bring":{"due":true,"started":true,"unstarted":false,"backlog":false,"teams":["PMO"]},"status":"connected","lastSync":"2026-11-11T09:50:00.000Z"}]"#)
            }
            return (true, "")
        })
    }

    func testChoicesRunTheEngine() {
        var ran: [[String]] = []
        let m = model { ran.append($0) }
        XCTAssertTrue(m.isConnected("linear"))
        XCTAssertEqual(m.items.first?.onDone.state, "Done")
        m.setState("linear", "In Review")
        XCTAssertTrue(ran.contains(["connection", "linear", "state", "In Review"]))
        m.setLabel("linear", nil)
        XCTAssertTrue(ran.contains(["connection", "linear", "label"]))
        m.setWhenSure("linear", false)
        XCTAssertTrue(ran.contains(["connection", "linear", "whensure", "off"]))
        m.setRule("linear", "started", true)
        XCTAssertTrue(ran.contains(["connection", "linear", "bring", "started", "on"]))
        m.setTeam("linear", "Acme Dashboard", true)
        XCTAssertTrue(ran.contains(["connection", "linear", "team", "Acme Dashboard", "on"]))
        m.allTeams("linear")
        XCTAssertTrue(ran.contains(["connection", "linear", "team", "all"]))
        m.disconnect("linear")
        XCTAssertTrue(ran.contains(["disconnect", "linear"]))
    }

    /// Draws the window's content to `$TMPDIR/didja-ui/connections.png`.
    @MainActor
    func testRenderConnections() throws {
        let renderer = ImageRenderer(content: ConnectionsContent(model: model()).background(Color(nsColor: .windowBackgroundColor)))
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage)
        let png = try XCTUnwrap(image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?
            .representation(using: .png, properties: [:]))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try png.write(to: dir.appendingPathComponent("connections.png"))
        XCTAssertGreaterThan(image.size.height, 200)
    }
}


final class AskerTests: XCTestCase {
    func testWhoAskedIsReadFromTheChatOrTheEmailNote() {
        XCTAssertEqual(TaskItem.asker(chatFrom: "Sam Carter", origin: nil), "Sam Carter")
        XCTAssertNil(TaskItem.asker(chatFrom: "me", origin: nil))
        XCTAssertEqual(TaskItem.asker(chatFrom: nil, origin: "From an email: Jordan Lee via Docusign — “Complete with Docusign: NDA”"), "Jordan Lee via Docusign")
        XCTAssertNil(TaskItem.asker(chatFrom: nil, origin: "Claude — Stripe webhooks"))
        XCTAssertNil(TaskItem.asker(chatFrom: nil, origin: nil))
    }
}

/// The task window's Settings: every setting on one General page, the other pages reused.
final class SettingsWindowTests: XCTestCase {
    /// Draws General to `$TMPDIR/didja-ui/settings.png`.
    @MainActor
    func testRenderGeneralSettings() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("sa-settings-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let hub = SettingsHub(exclude: ExcludeListModel(file: dir.appendingPathComponent("exclude.json"), changed: {}),
                              privacyFacts: { PrivacyFacts(retention: .day, observationCount: 0, taskCount: 0, excludedApps: 0, excludedTitles: 0,
                                                           excludedSites: 0, screenRecordingGranted: false, modelStatus: "Available",
                                                           dataFolder: dir.path, isPaused: false) },
                              forgetCapturedText: {}, openWelcome: {}, revealDataFolder: {})
        let view = GeneralSettingsView(capture: CaptureCoordinator(supportDirectory: dir), hub: hub)
            .frame(width: 680)
            .background(Palette.surface)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage)
        let png = try XCTUnwrap(image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?.representation(using: .png, properties: [:]))
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        try png.write(to: out.appendingPathComponent("settings.png"))
        XCTAssertGreaterThan(image.size.height, 400)
    }

    /// The task window's way back to the panel (SCR-36): the window closes, then the panel opens;
    /// if the panel cannot be shown, the window comes back so you are never left with neither.
    func testBackToPanelClosesTheWindowAndFallsBackWhenThePanelCannotShow() {
        var calls: [String] = []
        WindowExit.backToPanel(closeWindow: { calls.append("close") },
                               showPanel: { calls.append("panel"); return true },
                               reopenWindow: { calls.append("reopen") })
        XCTAssertEqual(calls, ["close", "panel"])
        calls = []
        WindowExit.backToPanel(closeWindow: { calls.append("close") },
                               showPanel: { calls.append("panel"); return false },
                               reopenWindow: { calls.append("reopen") })
        XCTAssertEqual(calls, ["close", "panel", "reopen"])
        XCTAssertTrue(KeyboardHints.window.contains("O Quick View"), "the window's key line names the way back")
        XCTAssertNotNil(NSImage(systemSymbolName: "menubar.arrow.up.rectangle", accessibilityDescription: nil))
    }

    /// Draws the task window with its Panel and Close buttons to `$TMPDIR/didja-ui/task-window.png` (SCR-36).
    @MainActor
    func testRenderTaskWindow() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("sa-window-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let hub = SettingsHub(exclude: ExcludeListModel(file: dir.appendingPathComponent("exclude.json"), changed: {}),
                              privacyFacts: { PrivacyFacts(retention: .day, observationCount: 0, taskCount: 0, excludedApps: 0, excludedTitles: 0,
                                                           excludedSites: 0, screenRecordingGranted: false, modelStatus: "Available",
                                                           dataFolder: dir.path, isPaused: false) },
                              forgetCapturedText: {}, openWelcome: {}, revealDataFolder: {})
        let view = TasksWindowView(capture: CaptureCoordinator(supportDirectory: dir), actions: TaskActions(),
                                   navigator: TaskNavigator(scope: .window), settings: hub)
            .frame(width: 1100, height: 500)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage)
        let png = try XCTUnwrap(image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?.representation(using: .png, properties: [:]))
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        try png.write(to: out.appendingPathComponent("task-window.png"))
        XCTAssertGreaterThan(image.size.width, 1000)
    }

    func testEveryPageHasATitleAndSymbol() {
        XCTAssertEqual(SettingsPage.allCases.map(\.title), ["General", "Connections", "Your Names", "How It Decides", "Exclude List", "Privacy"])
        XCTAssertTrue(SettingsPage.allCases.allSatisfy { NSImage(systemSymbolName: $0.symbol, accessibilityDescription: nil) != nil })
    }
}

final class RenameTests: XCTestCase {
    func testTheOldDataFolderAndDatabaseMoveOnceAndNothingIsOverwritten() throws {
        let fm = FileManager.default
        let support = fm.temporaryDirectory.appendingPathComponent("didja-support-\(UUID().uuidString)")
        let old = support.appendingPathComponent("ScrolledAway")
        try fm.createDirectory(at: old, withIntermediateDirectories: true)
        try Data("tasks".utf8).write(to: old.appendingPathComponent("scrolledaway.db"))
        ObservationStore.moveFromOldName(fileManager: fm, support: support)
        let new = support.appendingPathComponent("Didja")
        XCTAssertEqual(try String(contentsOf: new.appendingPathComponent("didja.db"), encoding: .utf8), "tasks")
        XCTAssertFalse(fm.fileExists(atPath: old.path))
        try fm.createDirectory(at: old, withIntermediateDirectories: true)
        try Data("older".utf8).write(to: old.appendingPathComponent("scrolledaway.db"))
        ObservationStore.moveFromOldName(fileManager: fm, support: support)
        XCTAssertEqual(try String(contentsOf: new.appendingPathComponent("didja.db"), encoding: .utf8), "tasks")
    }
}

/// SCR-40: the keys that open the panel can be changed in Settings › General.
final class HotKeyShortcutTests: XCTestCase {
    private let defaults = UserDefaults.standard
    private var savedCode: Any?
    private var savedModifiers: Any?

    override func setUp() {
        savedCode = defaults.object(forKey: HotKeyShortcut.codeKey)
        savedModifiers = defaults.object(forKey: HotKeyShortcut.modifiersKey)
        defaults.removeObject(forKey: HotKeyShortcut.codeKey)
        defaults.removeObject(forKey: HotKeyShortcut.modifiersKey)
    }

    override func tearDown() {
        defaults.set(savedCode, forKey: HotKeyShortcut.codeKey)
        defaults.set(savedModifiers, forKey: HotKeyShortcut.modifiersKey)
    }

    func testLabelsAreWrittenAsMacOSWritesThem() {
        XCTAssertEqual(HotKeyShortcut.standard.label, "⇧⌘J")
        XCTAssertEqual(HotKeyShortcut.pause.label, "⌃⌥P")
        XCTAssertEqual(HotKeyShortcut(keyCode: kVK_ANSI_K, flags: [.command, .shift]).label, "⇧⌘K")
        XCTAssertEqual(HotKeyShortcut(keyCode: kVK_Space, flags: [.control, .option, .shift, .command]).label, "⌃⌥⇧⌘Space")
        XCTAssertEqual(HotKeyShortcut(keyCode: kVK_F5, flags: []).label, "F5")
        // Caps Lock and the like are not part of the keys.
        XCTAssertEqual(HotKeyShortcut(keyCode: kVK_ANSI_D, flags: [.control, .option, .capsLock]), HotKeyShortcut(keyCode: kVK_ANSI_D, modifiers: controlKey | optionKey))
    }

    func testOnlyKeysThatCanOpenThePanelAreTaken() {
        XCTAssertNil(HotKeyShortcut.standard.problem)
        XCTAssertNil(HotKeyShortcut(keyCode: kVK_ANSI_D, flags: [.control, .option]).problem)
        XCTAssertNil(HotKeyShortcut(keyCode: kVK_ANSI_K, flags: [.command, .shift]).problem)
        XCTAssertNil(HotKeyShortcut(keyCode: kVK_F5, flags: []).problem, "an F-key on its own is fine")
        XCTAssertNotNil(HotKeyShortcut(keyCode: kVK_ANSI_A, flags: []).problem, "a plain letter would take over typing")
        XCTAssertNotNil(HotKeyShortcut(keyCode: kVK_ANSI_A, flags: [.shift]).problem, "so would ⇧ and a letter")
        XCTAssertNotNil(HotKeyShortcut(keyCode: kVK_Return, flags: [.control]).problem)
        XCTAssertNotNil(HotKeyShortcut(keyCode: kVK_Escape, flags: [.command]).problem)
        XCTAssertNotNil(HotKeyShortcut.pause.problem, "⌃⌥P already pauses")
        XCTAssertNotNil(HotKeyShortcut(keyCode: kVK_Space, flags: [.command]).problem, "Spotlight")
        XCTAssertNotNil(HotKeyShortcut(keyCode: kVK_ANSI_Q, flags: [.command]).problem, "Quit")
    }

    func testTheChoiceIsKeptAndResetForgetsIt() {
        XCTAssertEqual(HotKeyShortcut.saved, .standard, "⇧⌘J unless you chose otherwise")
        let mine = HotKeyShortcut(keyCode: kVK_ANSI_D, flags: [.control, .option])
        HotKeyShortcut.saved = mine
        XCTAssertEqual(HotKeyShortcut.saved, mine)
        XCTAssertEqual(GlobalHotKey.label, "⌃⌥D", "every place that names the key shows yours")
        HotKeyShortcut.saved = .standard
        XCTAssertNil(defaults.object(forKey: HotKeyShortcut.codeKey), "back to the standard keys: nothing kept")
        // Something unusable in the settings (edited by hand) falls back to ⇧⌘J.
        defaults.set(kVK_ANSI_A, forKey: HotKeyShortcut.codeKey)
        defaults.set(0, forKey: HotKeyShortcut.modifiersKey)
        XCTAssertEqual(HotKeyShortcut.saved, .standard)
    }

    /// A real hot key is registered with the new keys; unusable keys leave the old ones in place.
    func testChangingRegistersTheNewKeys() {
        let hotKey = PanelHotKey()
        _ = hotKey.start {} // ⇧⌘J may be held by the running app; only the change is checked
        let unusual = HotKeyShortcut(keyCode: kVK_F19, flags: [.control, .option, .shift, .command])
        XCTAssertNil(hotKey.change(to: unusual))
        XCTAssertEqual(HotKeyShortcut.saved, unusual)
        XCTAssertNotNil(hotKey.change(to: HotKeyShortcut(keyCode: kVK_ANSI_A, flags: [])))
        XCTAssertEqual(HotKeyShortcut.saved, unusual, "a refused choice keeps the keys you had")
        // Registered twice is refused, as when another app owns the keys.
        let other = GlobalHotKey(keyCode: kVK_F18, modifiers: controlKey | optionKey | shiftKey | cmdKey) {}
        XCTAssertNotNil(other)
        let taken = HotKeyShortcut(keyCode: kVK_F18, flags: [.control, .option, .shift, .command])
        XCTAssertEqual(hotKey.change(to: taken), "⌃⌥⇧⌘F18 is already used by another app.")
        XCTAssertEqual(HotKeyShortcut.saved, unusual)
        _ = other
    }

    func testChoosingNewKeys() {
        let recording = HotKeyRecording(hotKey: PanelHotKey())
        recording.start()
        XCTAssertTrue(recording.recording)
        recording.press(keyCode: kVK_Escape, flags: [])
        XCTAssertFalse(recording.recording, "Esc cancels")
        XCTAssertEqual(HotKeyShortcut.saved, .standard)

        recording.start()
        recording.press(keyCode: kVK_ANSI_A, flags: [])
        XCTAssertTrue(recording.recording, "keys that can't be used: try again")
        XCTAssertNotNil(recording.message)
        XCTAssertEqual(HotKeyShortcut.saved, .standard)
        recording.press(keyCode: kVK_ANSI_K, flags: [.command, .shift])
        XCTAssertFalse(recording.recording)
        XCTAssertNil(recording.message)
        XCTAssertEqual(recording.shortcut.label, "⇧⌘K")
        XCTAssertEqual(HotKeyShortcut.saved.label, "⇧⌘K")

        recording.reset()
        XCTAssertEqual(recording.shortcut, .standard)
        XCTAssertEqual(HotKeyShortcut.saved, .standard)
        recording.cancel() // not choosing: nothing happens
        XCTAssertFalse(recording.recording)
    }
}

/// SCR-41: macOS's "bypass the private window picker" alert comes from ScreenCaptureKit, which
/// Didja calls only for the OCR fallback. It runs only when needed, and you can turn it off.
final class OCRSwitchTests: XCTestCase {
    func testOCRRunsOnlyForANearlyEmptyWindowWithPermissionAndTheSwitchOn() {
        XCTAssertTrue(OCRCapture.shouldRun(axChars: 5, permitted: true, enabled: true, sinceLast: 60))
        XCTAssertFalse(OCRCapture.shouldRun(axChars: 5, permitted: true, enabled: false, sinceLast: 60), "switched off")
        XCTAssertFalse(OCRCapture.shouldRun(axChars: 5, permitted: false, enabled: true, sinceLast: 60), "no permission")
        XCTAssertFalse(OCRCapture.shouldRun(axChars: 400, permitted: true, enabled: true, sinceLast: 60), "the window has text")
        XCTAssertFalse(OCRCapture.shouldRun(axChars: 5, permitted: true, enabled: true, sinceLast: 3), "at most every 10 s")
        // Launch: nothing has been read yet, and a window with text never needs a frame.
        XCTAssertFalse(OCRCapture.shouldRun(axChars: 1200, permitted: true, enabled: true, sinceLast: .infinity))
    }

    func testTheSwitchIsOnUnlessTurnedOffAndIsKept() {
        let defaults = UserDefaults.standard
        let before = defaults.object(forKey: OCRCapture.enabledKey)
        defer { defaults.set(before, forKey: OCRCapture.enabledKey) }
        defaults.removeObject(forKey: OCRCapture.enabledKey)
        XCTAssertTrue(OCRCapture.isEnabled)
        OCRCapture.isEnabled = false
        XCTAssertFalse(OCRCapture.isEnabled)
        XCTAssertEqual(defaults.object(forKey: OCRCapture.enabledKey) as? Bool, false)
        OCRCapture.isEnabled = true
        XCTAssertTrue(OCRCapture.isEnabled)
    }

    /// Switched off, the fallback returns nothing without asking ScreenCaptureKit for anything.
    func testSwitchedOffNothingIsRead() async {
        let defaults = UserDefaults.standard
        let before = defaults.object(forKey: OCRCapture.enabledKey)
        defer { defaults.set(before, forKey: OCRCapture.enabledKey) }
        OCRCapture.isEnabled = false
        let lines = await OCRCapture.recognizeText(pid: ProcessInfo.processInfo.processIdentifier, windowTitle: "x") { _ in true }
        XCTAssertEqual(lines, [])
    }
}

/// Buttons look like buttons and tags like tags (SCR-43): yellow marks things, never "click me".
final class ButtonStyleTests: XCTestCase {
    /// A colour as 0–255 sRGB in light or dark mode.
    private func rgb(_ color: Color, _ name: NSAppearance.Name) throws -> [Double] {
        var out: [Double] = []
        try XCTUnwrap(NSAppearance(named: name)).performAsCurrentDrawingAppearance {
            let c = NSColor(color).usingColorSpace(.sRGB)!
            out = [c.redComponent, c.greenComponent, c.blueComponent].map { ($0 * 255).rounded() }
        }
        return out
    }

    /// WCAG contrast ratio of two sRGB colours.
    private func contrast(_ a: [Double], _ b: [Double]) -> Double {
        func luminance(_ c: [Double]) -> Double {
            let l = c.map { v -> Double in
                let s = v / 255
                return s <= 0.03928 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4)
            }
            return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]
        }
        let (x, y) = (luminance(a), luminance(b))
        return (max(x, y) + 0.05) / (min(x, y) + 0.05)
    }

    func testTheHeaderAndFooterUseButtonsNotTags() {
        XCTAssertEqual(PopoverView.expandStyle.kind, .secondary, "Expand is an outlined button, not a yellow pill")
        XCTAssertEqual(PopoverView.pauseStyle.kind, .secondary, "Pause is a button, not a blue link")
        XCTAssertEqual(PopoverView.pauseStyle.size, .small)
        XCTAssertEqual(DidjaButtonStyle.height(.regular), 28, "at least 28 pt tall in the panel")
        XCTAssertEqual(DidjaButtonStyle.height(.small), 22)
        XCTAssertEqual(TagView.fontSize, 12)
    }

    func testNoButtonIsYellow() throws {
        for look in [NSAppearance.Name.aqua, .darkAqua] {
            let fill = try rgb(Palette.ink, look)
            XCTAssertNotEqual(fill, [255, 217, 61], "the primary fill is never highlighter yellow")
            XCTAssertNotEqual(fill, try rgb(Palette.selection, look), "a button never looks like a tag")
        }
        XCTAssertEqual(try rgb(Palette.ink, .aqua), [20, 20, 20], "ink in light mode")
        XCTAssertEqual(try rgb(Palette.ink, .darkAqua), [250, 250, 247], "paper in dark mode, not yellow")
    }

    func testButtonTextAndBordersAreReadableInBothModes() throws {
        for look in [NSAppearance.Name.aqua, .darkAqua] {
            let surface = try rgb(Palette.surface, look), hover = try rgb(Palette.chip, look)
            let ink = try rgb(Palette.ink, look), border = try rgb(Palette.buttonBorder, look)
            XCTAssertGreaterThanOrEqual(contrast(ink, surface), 4.5, "secondary text, \(look.rawValue)")
            XCTAssertGreaterThanOrEqual(contrast(ink, hover), 4.5, "secondary text on hover, \(look.rawValue)")
            XCTAssertGreaterThanOrEqual(contrast(try rgb(Palette.onInk, look), ink), 4.5, "primary text, \(look.rawValue)")
            XCTAssertGreaterThanOrEqual(contrast(border, surface), 3, "secondary border, \(look.rawValue)")
            XCTAssertGreaterThanOrEqual(contrast(border, hover), 3, "secondary border on hover, \(look.rawValue)")
            XCTAssertGreaterThanOrEqual(contrast(try rgb(Palette.accentText, look), try rgb(Palette.selection, look)), 4.5,
                                        "tag text, \(look.rawValue)")
        }
    }

    /// System controls (toggles, default buttons, focus rings) take ink or paper, never blue.
    func testTheAccentColourIsInkOrPaper() throws {
        let accent = try XCTUnwrap(NSColor(named: "AccentColor", bundle: Bundle(for: CaptureCoordinator.self)))
        XCTAssertEqual(try rgb(Color(nsColor: accent), .aqua), [20, 20, 20])
        XCTAssertEqual(try rgb(Color(nsColor: accent), .darkAqua), [250, 250, 247])
    }

    /// Every kind side by side, light and dark, to `$TMPDIR/didja-ui/buttons.png` and `buttons-dark.png`;
    /// also Welcome and Settings › General in dark mode.
    @MainActor
    func testRenderButtonsWelcomeAndSettingsDark() throws {
        let sampler = VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text("Didja").font(.headline)
                TagView(text: "81 open")
                Spacer()
                Button {} label: { Image(systemName: "plus") }.buttonStyle(DidjaButtonStyle.icon)
                Button {} label: { Label(PopoverView.expandTitle, systemImage: PopoverView.expandSymbol) }
                    .buttonStyle(PopoverView.expandStyle)
            }
            HStack(spacing: 8) {
                Button("Save") {}.buttonStyle(DidjaButtonStyle.primary)
                Button("Cancel") {}.buttonStyle(DidjaButtonStyle.secondary)
                Button("Disabled") {}.buttonStyle(DidjaButtonStyle.secondary).disabled(true)
                Button("How it works") {}.buttonStyle(DidjaLinkStyle())
            }
            HStack(spacing: 8) {
                KeyChip(text: "⇧⌘J")
                Button("Pause") {}.buttonStyle(PopoverView.pauseStyle)
            }
        }
        .padding(14)
        .frame(width: 420)
        let renderer = ImageRenderer(content: sampler.background(Palette.surface))
        renderer.scale = 2
        let png = try XCTUnwrap(renderer.nsImage?.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?
            .representation(using: .png, properties: [:]))
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        try png.write(to: out.appendingPathComponent("buttons.png"))
        try TaskBoardTests.renderDark(sampler, to: "buttons-dark.png")
        try TaskBoardTests.renderDark(WelcomeView(accessibilityGranted: { false }, screenRecordingGranted: { false }),
                                      to: "welcome-dark.png")

        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("sa-settings-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let hub = SettingsHub(exclude: ExcludeListModel(file: dir.appendingPathComponent("exclude.json"), changed: {}),
                              privacyFacts: { PrivacyFacts(retention: .day, observationCount: 0, taskCount: 0, excludedApps: 0, excludedTitles: 0,
                                                           excludedSites: 0, screenRecordingGranted: false, modelStatus: "Available",
                                                           dataFolder: dir.path, isPaused: false) },
                              forgetCapturedText: {}, openWelcome: {}, revealDataFolder: {})
        try TaskBoardTests.renderDark(GeneralSettingsView(capture: CaptureCoordinator(supportDirectory: dir), hub: hub).frame(width: 680),
                                      to: "settings-dark.png")
    }
}

/// One name for each view, used everywhere the app talks about them (SCR-37).
final class ViewNamesTests: XCTestCase {
    func testTheTwoViewsHaveOneNameEach() {
        XCTAssertEqual(ViewNames.quick, "Quick View")
        XCTAssertEqual(ViewNames.full, "Full View")
        let shown = [PopoverView.expandTitle, ViewNames.pinTitle, ViewNames.unpinTitle, PanelStaysOpen.menuTitle,
                     KeyboardHints.popover, KeyboardHints.window]
        for text in shown {
            XCTAssertFalse(text.localizedCaseInsensitiveContains("panel"), "old name in: \(text)")
            XCTAssertFalse(text.localizedCaseInsensitiveContains("task window"), "old name in: \(text)")
        }
        XCTAssertTrue(KeyboardHints.popover.contains("O Full View"), "the Quick View's key line names the Full View")
        XCTAssertTrue(KeyboardHints.window.contains("O Quick View"), "the Full View's key line names the Quick View")
        XCTAssertEqual(ViewNames.pinTitle, "Pin Quick View (Move and Resize It)")
        XCTAssertEqual(PanelStaysOpen.menuTitle, "Keep Quick View Open When You Click Elsewhere")
    }
}

/// The version at the bottom of the "…" menu and in Settings (SCR-44).
final class AppVersionTests: XCTestCase {
    func testTheLabelShowsVersionAndBuild() {
        XCTAssertEqual(AppVersion.label(["CFBundleShortVersionString": "0.4.1", "CFBundleVersion": "5"]), "Didja 0.4.1 (5)")
        XCTAssertEqual(AppVersion.label(["CFBundleShortVersionString": "0.4.1"]), "Didja 0.4.1", "no empty brackets")
        XCTAssertEqual(AppVersion.label(["CFBundleVersion": "5"]), "Didja (5)")
        XCTAssertEqual(AppVersion.label(nil), "Didja")
    }

    func testTheRunningAppHasAVersion() {
        // The test host is the app, so its own Info.plist is read.
        XCTAssertTrue(AppVersion.current.hasPrefix("Didja "), AppVersion.current)
        XCTAssertNotEqual(AppVersion.current, "Didja")
    }
}
