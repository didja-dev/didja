import SwiftUI
import XCTest
@testable import Didja

/// SCR-49: the canvas window reads and writes through the engine.
final class CanvasTests: XCTestCase {
    private let page = #"""
    {"id":3,"title":"Ship to production","updatedAt":"","open":1,"items":[
     {"id":1,"kind":"heading","text":"Before you ship"},
     {"id":2,"kind":"task","text":"Set STRIPE_KEY in Vercel","task":{"id":11,"status":"done","suggestion":null,"source":"Claude — Deploy"}},
     {"id":3,"kind":"task","text":"Run the migration","task":{"id":12,"status":"open","suggestion":"seen in Terminal","source":"Claude — Deploy"}},
     {"id":4,"kind":"note","text":"Ask Noa about the **downtime** window","level":0}]}
    """#

    private func model(_ ran: @escaping ([String]) -> Void = { _ in }) -> CanvasModel {
        CanvasModel(id: 3, run: { args in ran(args); return args.starts(with: ["canvas", "show"]) ? self.page : "{}" })
    }

    func testTheCanvasIsReadFromTheEngine() throws {
        let page = try XCTUnwrap(model().page)
        XCTAssertEqual(page.title, "Ship to production")
        XCTAssertEqual(page.items.map(\.kind), ["heading", "task", "task", "note"])
        XCTAssertEqual(page.items[2].task?.suggestion, "seen in Terminal")
    }

    func testChangesGoThroughTheEngine() throws {
        var ran: [[String]] = []
        let m = model { ran.append($0) }
        let items = try XCTUnwrap(m.page?.items)
        m.toggle(items[1])
        m.toggle(items[2])
        m.confirmDone(items[2])
        m.notYet(items[2])
        m.addLine("Tell the team", asNote: false, level: 0)
        m.addLine("  - Downtime 22:00", asNote: true, level: 1)
        m.addLine("   ", asNote: false, level: 0)
        m.addLine("# Later", asNote: false, level: 9)
        m.setLevel(items[3], 2)
        m.setLevel(items[3], 0) // already there
        m.move(items[3], before: items[0])
        m.remove(items[3])
        m.rename("Ship it")
        let changes = ran.filter { !$0.starts(with: ["canvas", "show"]) }
        XCTAssertEqual(changes, [
            ["reopen", "11"], ["done", "12"], ["done", "12"], ["notyet", "12"],
            ["canvas", "line", "3", "--level", "0", "Tell the team"],
            ["canvas", "line", "3", "--note", "--level", "1", "  - Downtime 22:00"],
            ["canvas", "line", "3", "--level", "4", "# Later"],
            ["canvas", "level", "4", "2"],
            ["canvas", "move", "4", "1"], ["canvas", "remove", "4"], ["canvas", "rename", "3", "Ship it"],
        ])
    }

    /// SCR-50: tasks dragged from the list land on the canvas through the engine's `canvas send`.
    func testDraggedTasksAreSentToTheCanvas() throws {
        XCTAssertEqual(TaskDrag.decode(TaskDrag.encode([12, 40, 7])), [12, 40, 7])
        // Anything that is not a list of task ids is not a drop.
        for junk in ["", "Run the migration", "12,abc", "12,,13", "-4", "0"] {
            XCTAssertEqual(TaskDrag.decode(Data(junk.utf8)), [], junk)
        }
        var ran: [[String]] = []
        let m = model { ran.append($0) }
        m.send([12, 40])
        m.send([])
        XCTAssertEqual(ran.filter { !$0.starts(with: ["canvas", "show"]) }, [["canvas", "send", "3", "12", "40"]])
    }

    func testADragCarriesTheIdsForDidjaAndTheTitlesForOtherApps() throws {
        let items = [TaskItem(id: 12, title: "Run the migration", status: .open, source: "s", isGroup: false), TaskItem(id: 40, title: "Tell Noa", status: .open, source: "s", isGroup: false)]
        let provider = TaskDrag.provider(items)
        XCTAssertTrue(provider.hasItemConformingToTypeIdentifier(TaskDrag.type.identifier))
        XCTAssertTrue(provider.canLoadObject(ofClass: NSString.self))
        let got = expectation(description: "ids")
        XCTAssertTrue(TaskDrag.receive([provider]) { ids in
            XCTAssertEqual(ids, [12, 40])
            got.fulfill()
        })
        wait(for: [got], timeout: 2)
        XCTAssertFalse(TaskDrag.receive([NSItemProvider(object: "12,40" as NSString)]) { _ in XCTFail("plain text is not a drop") })
    }

    func testNotesShowTheirMarkdown() {
        let shown = CanvasView.rendered("Ask **Noa** about `22:00`, see [the plan](https://example.com)")
        XCTAssertEqual(String(shown.characters), "Ask Noa about 22:00, see the plan")
        XCTAssertNotNil(shown.runs.first { $0.link != nil })
        XCTAssertEqual(String(CanvasView.rendered("plain * text").characters), "plain * text")
    }

    func testKeysMapAsInTheHint() {
        func key(_ code: UInt16, _ mods: NSEvent.ModifierFlags = [], list: Bool = true, empty: Bool = true) -> CanvasKey? {
            CanvasKey.action(keyCode: code, modifiers: mods, inList: list, lineEmpty: empty)
        }
        XCTAssertEqual(key(126, list: false), .enterList, "↑ from the empty line goes into the list")
        XCTAssertNil(key(126, list: false, empty: false), "but not while you are typing something")
        XCTAssertNil(key(49, list: false), "Space types a space")
        XCTAssertEqual(key(126), .up)
        XCTAssertEqual(key(125), .down)
        XCTAssertEqual(key(126, .option), .moveUp)
        XCTAssertEqual(key(125, .option), .moveDown)
        XCTAssertEqual(key(49), .toggle)
        XCTAssertEqual(key(48), .indent)
        XCTAssertEqual(key(48, .shift), .outdent)
        XCTAssertEqual(key(36), .edit)
        XCTAssertEqual(key(14), .edit)
        XCTAssertEqual(key(16), .yesDone)
        XCTAssertEqual(key(45), .notYet)
        XCTAssertEqual(key(51, .command), .remove)
        XCTAssertNil(key(51), "⌫ alone takes nothing off")
        XCTAssertEqual(key(53), .backToTyping)
    }

    func testTheKeysMoveTickIndentReorderEditAndRemove() throws {
        var ran: [[String]] = []
        let m = model { ran.append($0) }
        XCTAssertTrue(m.perform(.enterList))
        XCTAssertEqual(m.selected, 4, "the last item")
        m.perform(.up)
        m.perform(.up)
        XCTAssertEqual(m.selected, 2)
        m.perform(.toggle)                       // the task "Set STRIPE_KEY…" (done) reopens
        m.perform(.down)
        m.perform(.indent)                       // the task "Run the migration"
        m.perform(.yesDone)                      // it has a "looks done?"
        m.perform(.moveUp)
        m.perform(.edit)
        XCTAssertEqual(m.editing, 3)
        m.draft = "Run the database migration"
        m.commitEdit()                           // a task: renamed through the engine
        m.perform(.up)
        m.perform(.up)
        XCTAssertEqual(m.selected, 1)
        m.perform(.indent)                       // a heading: never indented
        m.perform(.up)                           // already at the top
        XCTAssertEqual(m.selected, 1)
        m.perform(.down)
        m.perform(.remove)
        XCTAssertEqual(m.selected, 3, "the next item is highlighted")
        let changes = ran.filter { !$0.starts(with: ["canvas", "show"]) }
        XCTAssertEqual(changes, [
            ["reopen", "11"], ["canvas", "level", "3", "1"], ["done", "12"], ["canvas", "move", "3", "2"],
            ["rename", "12", "Run the database migration"], ["canvas", "remove", "2"],
        ])
        m.perform(.down)
        m.perform(.down)                         // past the last: back to typing
        XCTAssertNil(m.selected)
    }

    /// Draws the window to $TMPDIR/didja-ui/canvas.png.
    @MainActor
    func testRenderCanvas() throws {
        let renderer = ImageRenderer(content: CanvasView(model: model(), scrolls: false).frame(width: CanvasView.width, height: 360))
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage)
        let png = try XCTUnwrap(image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?.representation(using: .png, properties: [:]))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try png.write(to: dir.appendingPathComponent("canvas.png"))
    }
}
