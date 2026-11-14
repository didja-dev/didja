import XCTest
@testable import Didja

/// A doc in the Claude app's side pane is an editable text area (ProseMirror) whose value is plain
/// text with every box gone. When it holds checkboxes, capture reads its structure instead, so the
/// boxes are kept as "[ ]" and "[x]", each item written once.
final class DocChecklistTests: XCTestCase {
    /// One item as the doc shows it: the box, whose title is the item's words, then the words again.
    private func item(_ parts: [String], ticked: Bool = false) -> AXNode {
        let words = parts.joined()
        return AXNode(role: "AXGroup", children: [
            AXNode(role: "AXGroup", children: [AXNode(role: "AXCheckBox", text: words, state: ticked ? "[x]" : "[ ]")]),
            AXNode(role: "AXGroup", children: parts.enumerated().map { i, part in
                i == 1 ? AXNode(role: "AXGroup", subrole: "AXCodeStyleGroup", children: [AXNode(role: "AXStaticText", text: part)])
                       : AXNode(role: "AXStaticText", text: part)
            }),
        ])
    }

    private func doc(_ items: [AXNode], value: String = "Launch notes\nYour action items\nPaste the plan into Copilot.") -> AXNode {
        AXNode(role: "AXGroup", subrole: "AXDocumentArticle", children: [
            AXNode(role: "AXTextArea", text: value, children: [
                AXNode(role: "AXHeading", text: "Your action items", children: [AXNode(role: "AXStaticText", text: "Your action items")]),
                AXNode(role: "AXList", subrole: "AXContentList", children: items),
            ]),
        ])
    }

    func testADocsBoxesAreKeptOnceEach() {
        let lines = AXCapture.lines(from: doc([
            item(["Paste ", "docs/plan.md", " into Copilot to create the 9 lists."]),
            item(["Ask Sam for the sign-off."], ticked: true),
            item(["Add the 16 columns to the 6 existing tables."]),
        ]))
        XCTAssertEqual(lines, [
            "⟦section⟧",
            "Your action items",
            "[ ] Paste `docs/plan.md` into Copilot to create the 9 lists.",
            "[x] Ask Sam for the sign-off.",
            "[ ] Add the 16 columns to the 6 existing tables.",
        ])
    }

    func testAnItemLongerThanALabelStillGetsItsBox() {
        let long = String(repeating: "Check the setup list in the sandbox first. ", count: 6)
        let lines = AXCapture.lines(from: doc([item([long])]))
        XCTAssertEqual(lines.filter { $0.hasPrefix("[ ] ") }.count, 1)
        XCTAssertFalse(lines.contains(long.trimmingCharacters(in: .whitespaces)))
    }

    func testATextAreaWithNoBoxesIsStillReadAsItsText() {
        let plain = AXNode(role: "AXTextArea", text: "First line\nSecond line", children: [AXNode(role: "AXStaticText", text: "ignored")])
        XCTAssertEqual(AXCapture.lines(from: plain), ["First line", "Second line"])
        // A toolbar toggle inside does not count as a box.
        let toolbar = AXNode(role: "AXTextArea", text: "Draft", children: [AXNode(role: "AXCheckBox", subrole: "AXToggleButton", text: "Bold", state: "[ ]")])
        XCTAssertEqual(AXCapture.lines(from: toolbar), ["Draft"])
    }

    func testWordsRepeatedLaterAreKeptWhenTheyAreNotTheNextLine() {
        let tree = AXNode(role: "AXGroup", children: [
            AXNode(role: "AXCheckBox", text: "Ship it", state: "[ ]"),
            AXNode(role: "AXStaticText", text: "Notes"),
            AXNode(role: "AXStaticText", text: "Ship it"),
        ])
        XCTAssertEqual(AXCapture.lines(from: tree), ["[ ] Ship it", "Notes", "Ship it"])
    }
}
