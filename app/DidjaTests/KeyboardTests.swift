import SwiftUI
import XCTest
@testable import Didja

/// The "…" menu as a native menu that keys open, ⌘1–⌘9 for canvases, and the ⌘ hints.
final class KeyboardTests: XCTestCase {
    private let canvases = [CanvasSummary(id: 7, title: "Notes", open: 0), CanvasSummary(id: 3, title: "Ship to production", open: 2)]

    override func tearDown() { CanvasDirectory.shared.set([]) }

    func testTheMenuIsGroupedWithItsKeys() throws {
        CanvasDirectory.shared.set(canvases)
        let entries = AppDelegate().moreMenuEntries()
        let titles = MenuEntry.titles(entries)
        // (Undo Fresh Start shows only for a day after one, so it is left out here.)
        XCTAssertEqual(entries.filter { if case .separator = $0.kind { false } else { $0.title != "Undo Fresh Start" } }.prefix(3).map(\.title),
                       ["Canvases", "Fresh Start…", "Report a Problem with This Window…"], "what you reach for most, on top")
        for group in ["View", "Tasks", "Privacy", "Help", "Settings…", "Quit Didja"] { XCTAssertTrue(titles.contains(group), group) }
        XCTAssertTrue(titles.contains("View › Focus › All Apps"))
        XCTAssertTrue(titles.contains("Privacy › Forget Captured Text Now…"))
        XCTAssertTrue(titles.contains("Help › Check for Updates…"))
        // Canvases are numbered by when they were made, so ⌘1 stays the same canvas.
        XCTAssertEqual(MenuEntry.find(["Canvases", "Ship to production (2 open)"], in: entries)?.key, "1")
        XCTAssertEqual(MenuEntry.find(["Canvases", "Notes"], in: entries)?.key, "2")
        XCTAssertEqual(MenuEntry.find(["Canvases", "New Canvas"], in: entries)?.key, "n")
        XCTAssertEqual(MenuEntry.find(["Settings…"], in: entries)?.key, ",")
        // Settings holds these now.
        for gone in ["Launch at Login", "Connections…", "Your Names…"] { XCTAssertFalse(titles.contains(gone), gone) }
    }

    func testTheNativeMenuCarriesTicksKeysAndSubmenus() throws {
        var ran = ""
        let menu = MoreMenu.build([
            .action("Open", key: "1") { ran = "open" },
            .separator,
            .choice("Sort", [("By Source", 0), ("Latest", 1)], current: 1) { ran = "sort \($0)" },
            MenuEntry(title: "Didja 0.4.1 (5)", kind: .label),
        ])
        XCTAssertEqual(menu.items.map(\.title), ["Open", "", "Sort", "Didja 0.4.1 (5)"])
        XCTAssertEqual(menu.items[0].keyEquivalent, "1")
        XCTAssertEqual(menu.items[0].keyEquivalentModifierMask, .command)
        XCTAssertEqual(menu.items[2].submenu?.items.map(\.state), [.off, .on])
        XCTAssertFalse(menu.items[3].isEnabled, "the version is shown, not chosen")
        menu.performActionForItem(at: 0)
        XCTAssertEqual(ran, "open")
        menu.items[2].submenu?.performActionForItem(at: 0)
        XCTAssertEqual(ran, "sort 0")
    }

    func testCanvasNumbersAndKeys() {
        CanvasDirectory.shared.set(canvases)
        XCTAssertEqual(CanvasDirectory.shared.numbered.map(\.id), [3, 7])
        let app = AppDelegate()
        XCTAssertFalse(app.openCanvas(number: 3), "no third canvas")
        XCTAssertFalse(app.handleCommandKey(keyCode: 46, held: [], inPanel: false), "M is the menu only in the Quick View")
        XCTAssertFalse(app.handleCommandKey(keyCode: 0, held: .command, inPanel: true), "⌘A is the list's")
        XCTAssertFalse(app.handleCommandKey(keyCode: 20, held: .command, inPanel: true), "⌘3 with two canvases does nothing")
    }

    func testHoldingCommandLightsTheHintsButAShortcutDoesNot() throws {
        let held = CommandHeld()
        func flags(_ f: NSEvent.ModifierFlags) -> NSEvent {
            NSEvent.keyEvent(with: .flagsChanged, location: .zero, modifierFlags: f, timestamp: 0, windowNumber: 0,
                             context: nil, characters: "", charactersIgnoringModifiers: "", isARepeat: false, keyCode: 55)!
        }
        let key = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: .command, timestamp: 0, windowNumber: 0,
                                   context: nil, characters: "c", charactersIgnoringModifiers: "c", isARepeat: false, keyCode: 8)!
        held.update(flags(.command))
        held.update(key) // ⌘C: a shortcut, not a look
        RunLoop.main.run(until: Date().addingTimeInterval(0.45))
        XCTAssertFalse(held.isHeld)
        held.update(flags(.command))
        RunLoop.main.run(until: Date().addingTimeInterval(0.45))
        XCTAssertTrue(held.isHeld)
        held.update(flags([]))
        XCTAssertFalse(held.isHeld)
        XCTAssertTrue(KeyboardHints.command.contains("⌘1–9"))
        XCTAssertTrue(KeyboardHints.popover.contains("M menu"))
    }
}

/// The add field can always be reached and left from the keyboard (seen live: stuck after the menu).
final class AddFieldKeyTests: XCTestCase {
    @MainActor
    func testAKeyTypedWhileTheFieldLacksTheKeyboardLandsInIt() throws {
        let navigator = TaskNavigator(scope: .popover)
        navigator.startAdding()
        let host = NSHostingController(rootView: AddTaskField(navigator: navigator, actions: TaskActions()).frame(width: 300))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 300, height: 60), styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentViewController = host
        window.orderFront(nil)
        defer { window.close() }
        RunLoop.main.run(until: Date().addingTimeInterval(0.2))
        window.makeFirstResponder(nil) // the keyboard went elsewhere
        XCTAssertNotNil(AddTaskField.field(in: window), "the field is found by its placeholder")
        let key = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: 0, windowNumber: window.windowNumber,
                                   context: nil, characters: "x", charactersIgnoringModifiers: "x", isARepeat: false, keyCode: 7)!
        XCTAssertTrue(AddTaskField.takeKey(key, in: window))
        XCTAssertEqual(AddTaskField.field(in: window)?.currentEditor()?.string, "x")
    }
}

/// Folding by keyboard, as in any outline, and Didja Missed This….
final class OutlineAndMissedTests: XCTestCase {
    private func task(_ id: Int, parent: Int? = nil, group: Bool = false, collapsed: Bool = false) -> TaskItem {
        var t = TaskItem(id: id, title: "t\(id)", status: .open, source: "s", parentID: parent, isGroup: group)
        t.collapsed = collapsed
        return t
    }

    func testArrowsMoveAndFoldAsInAnOutline() {
        let parent = task(1, group: true)
        let step = task(2, parent: 1)
        let rows = [parent, step]
        XCTAssertEqual(TaskNavigator.outlineMove(.fold, item: step, rows: rows), .select(1), "← on a step goes to its parent")
        XCTAssertEqual(TaskNavigator.outlineMove(.fold, item: parent, rows: rows), .setCollapsed(true), "← on an open parent folds it")
        XCTAssertEqual(TaskNavigator.outlineMove(.fold, item: task(1, group: true, collapsed: true), rows: rows), .nothing)
        XCTAssertEqual(TaskNavigator.outlineMove(.unfold, item: task(1, group: true, collapsed: true), rows: rows), .setCollapsed(false))
        XCTAssertEqual(TaskNavigator.outlineMove(.unfold, item: parent, rows: rows), .select(2), "→ on an open parent goes to its first step")
        XCTAssertEqual(TaskNavigator.outlineMove(.unfold, item: step, rows: rows), .nothing)
    }

    func testTheNewKeys() {
        XCTAssertEqual(NavKey(keyCode: 123, hasCommandModifiers: true, isOptionOnly: true), .foldAll)
        XCTAssertEqual(NavKey(keyCode: 124, hasCommandModifiers: true, isOptionOnly: true), .unfoldAll)
        XCTAssertEqual(NavKey(keyCode: 4, hasCommandModifiers: false), .recentlyDone)
        XCTAssertTrue(KeyboardHints.popover.contains("H recently done"))
        XCTAssertTrue(KeyboardHints.rows.contains("←→ fold (⌥ all)"))
    }

    func testHAndOptionArrowsActThroughTheActions() {
        var log: [String] = []
        var actions = TaskActions()
        actions.toggleRecentlyDone = { log.append("recent") }
        actions.setAllCollapsed = { log.append($0 ? "fold all" : "unfold all") }
        let navigator = TaskNavigator(scope: .popover)
        let board = TaskBoard(tasks: [])
        _ = navigator.handle(.recentlyDone, board: board, actions: actions)
        _ = navigator.handle(.foldAll, board: board, actions: actions)
        _ = navigator.handle(.unfoldAll, board: board, actions: actions)
        XCTAssertEqual(log, ["recent", "fold all", "unfold all"])
    }

    private let json = #"""
    {"id":594,"title":"Set Schedule Mode to Fixed effort and select Save","source":"Claude Code — Planner setup","status":"done",
     "why":"#594 [x] Set Schedule Mode to Fixed effort and select Save\n  Not ticked automatically: nothing exact to look for",
     "context":{"app":"Claude","window":"Planner setup","lines":["Set Schedule Mode to Fixed effort and select Save"]},
     "watching":["Screens whose app or site names one of: schedule, mode, fixed, effort."],
     "places":[{"site":"acme.crm4.example.com","app":"Microsoft Edge","screens":12,"lines":["Project Parameters","Saved"],"watched":false,
       "last":"2026-11-12T09:58:00.000Z",
       "recent":[{"id":41,"ts":"2026-11-12T09:58:00.000Z","window":"Holidays","lines":["Import holidays","Imported 12 holidays","Saved"]},
                 {"id":40,"ts":"2026-11-12T09:50:00.000Z","window":"Project Parameters","lines":["Project Parameters","Schedule Mode: Fixed effort"]}]}],
     "word":"planner"}
    """#

    func testTheMissedReportIsMaskedAndHasItsOwnSections() throws {
        let missed = try JSONDecoder().decode(DiagnosticsReport.Missed.self, from: Data(json.utf8))
        let report = DiagnosticsReport.missed(missed)
        XCTAssertEqual(report.sections, DiagnosticsReport.Section.missed)
        let file = report.text()
        for secret in ["Schedule Mode", "Project Parameters"] { XCTAssertFalse(file.contains(secret), secret) }
        XCTAssertTrue(file.contains("acme.crm4.example.com"), "the site is kept, as in Report a Problem: it is what you teach")
        XCTAssertTrue(file.contains("== Where Didja looks for it done =="))
        XCTAssertTrue(file.contains("12 screens, not looked at"))
        XCTAssertTrue(file.contains("Status: done"))
        XCTAssertFalse(file.contains("== The window's outline =="), "only its own sections")
        // The task's words never go in a file name or a link.
        XCTAssertEqual(report.fileName(on: Date(timeIntervalSince1970: 1_794_484_800)), "didja-diagnostics-missed-task-2026-11-12.txt")
        XCTAssertEqual(report.issueTitle, "Didja missed a finished task")
        XCTAssertFalse(DiagnosticsReport.issueURL(title: report.issueTitle)!.absoluteString.contains("Schedule"))
    }

    func testShowingTheScreenTicksItAndSaysWhatHappens() throws {
        let missed = try JSONDecoder().decode(DiagnosticsReport.Missed.self, from: Data(json.utf8))
        var ran: [[String]] = []
        let model = MissedModel(missed, run: { args in ran.append(args); return #"{"site":"acme.crm4.example.com","suggested":2}"# },
                                claudeStatus: { .init(on: false, calls: 0, last: nil) })
        XCTAssertEqual(model.site, "acme.crm4.example.com")
        XCTAssertEqual(model.place?.screensKept.map(\.id), [41, 40], "newest first")
        model.doneAt(try XCTUnwrap(model.place?.screensKept.first))
        XCTAssertEqual(ran, [["missed", "594", "--done-at", "41"]])
        XCTAssertEqual(model.outcome, "Ticked. Didja will look on acme.crm4.example.com for steps like it from now on. 2 more steps look done there: check the list.")
        XCTAssertTrue(model.prompt.contains("missed_report for task 594"))
        XCTAssertFalse(model.claude.on)
    }

    /// Draws the window to $TMPDIR/didja-ui/missed.png.
    @MainActor
    func testRenderMissed() throws {
        let missed = try JSONDecoder().decode(DiagnosticsReport.Missed.self, from: Data(json.utf8))
        let model = MissedModel(missed, run: { _ in nil }, claudeStatus: { .init(on: false, calls: 0, last: nil) })
        let renderer = ImageRenderer(content: MissedView(model: model, scrolls: false).frame(height: 760))
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage)
        let png = try XCTUnwrap(image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?.representation(using: .png, properties: [:]))
        try png.write(to: FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui/missed.png"))
    }
}

/// What remembering a place means, said before you choose; X opens it; How It Decides lists places.
final class TeachingExplainedTests: XCTestCase {
    private func missed(watched: Bool = false, accepts: Bool = false, others: Int = 4) throws -> DiagnosticsReport.Missed {
        try JSONDecoder().decode(DiagnosticsReport.Missed.self, from: Data("""
        {"id":7,"title":"Select Import holidays in the dialog","source":"Claude Code — Planner","status":"open","why":"","context":null,
         "watching":[],"word":"planner","keywords":["select","import","holidays","dialog"],"conversation":"Claude Code — Planner",
         "openInConversation":\(others),"acceptsLooksDone":\(accepts),
         "places":[{"site":"nice-smoke.example.net","app":"Microsoft Edge","screens":49,"lines":[],"watched":\(watched),"word":"planner"}]}
        """.utf8))
    }

    func testTheWindowSaysWhatRememberingChangesInThisTasksTerms() throws {
        let effect = MissedModel(try missed(), run: { _ in nil }, claudeStatus: { .init(on: false, calls: 0, last: nil) }).effect
        XCTAssertTrue(effect.today.contains("select, import, holidays, dialog"))
        XCTAssertTrue(effect.today.contains("its 49 screens were never checked"))
        XCTAssertTrue(effect.after.contains("the 4 other open steps from “Claude Code — Planner”"))
        XCTAssertTrue(effect.after.contains("any step that mentions “planner” (from the site's addresses"))
        XCTAssertTrue(effect.after.contains("you get “looks done?” to confirm; nothing is ticked without you"))
        XCTAssertTrue(effect.after.contains("How It Decides › Looks done"))
        XCTAssertTrue(effect.advice.hasPrefix("Good if you do these steps on nice-smoke.example.net. Not if it is unrelated"))
        let auto = MissedModel(try missed(accepts: true), run: { _ in nil }, claudeStatus: { .init(on: false, calls: 0, last: nil) }).effect
        XCTAssertTrue(auto.after.contains("it is ticked for you (Looks Done is set to Accept Automatically)"), "says so when it ticks by itself")
        let watched = MissedModel(try missed(watched: true), run: { _ in nil }, claudeStatus: { .init(on: false, calls: 0, last: nil) }).effect
        XCTAssertTrue(watched.today.contains("is already one of them"))
    }

    func testXOpensItOnTheHighlightedRow() {
        XCTAssertEqual(NavKey(keyCode: 7, hasCommandModifiers: false), .missed)
        var opened: [Int] = []
        var actions = TaskActions()
        actions.missed = { opened.append($0.id) }
        let navigator = TaskNavigator(scope: .popover)
        let board = TaskBoard(tasks: [TaskItem(id: 5, title: "Select Import holidays", status: .done, source: "s", isGroup: false)])
        navigator.selected = 5
        XCTAssertTrue(navigator.handle(.missed, board: board, actions: actions))
        XCTAssertEqual(opened, [5], "done tasks too: that is when you notice it was missed")
        XCTAssertTrue(KeyboardHints.rows.contains("X Didja missed it"))
    }

    func testHowItDecidesListsAndForgetsThePlacesYouTaught() {
        var ran: [[String]] = []
        let model = BrainModel(fetch: { #"{"jobs":{},"lessons":[],"places":[{"id":3,"site":"nice-smoke.example.net","word":"planner","conversation":"Claude Code — Planner"}]}"# },
                               run: { args, _ in ran.append(args); return true })
        XCTAssertEqual(model.places.first?.description, "Screens on nice-smoke.example.net are checked for steps from “Claude Code — Planner” and steps that mention “planner”.")
        model.forget(model.places[0])
        XCTAssertEqual(ran, [["missed", "forget", "3"]])
    }
}
