import SwiftUI
import XCTest
@testable import Didja

/// Report a Problem with This Window… (SCR-42): masked by default, shown only line by line.
final class DiagnosticsTests: XCTestCase {
    func testTextIsMaskedButKeepsItsShapeAndTheAppsOwnLabelWords() {
        XCTAssertEqual(Redactor.text("Message from Dana Levi, Can you call 054?, 9 October at 12:34, Received in Family"),
                       "Message from Xxxx Xxxx, Xxx you xxxx 000?, 0 October at 00:00, Received in Xxxxxx")
        XCTAssertEqual(Redactor.text("שלום Dana 👍"), "xxxx Xxxx 👍")
        XCTAssertEqual(Redactor.identifier("message-body-1794226016279"), "message-body-0000000000000")
        XCTAssertEqual(Redactor.identifier("chat-header-19:8a7f6e5d4c3b2a1908f7e6d5@thread.v2"),
                       "chat-header-00:xxxxxxxxxxxxxxxxxxxxxxxx@thread.v0", "a long id is masked whole")
        XCTAssertEqual(Redactor.url("https://mail.google.com/mail/u/0/#inbox/FMfcgz"), "https://mail.google.com/xxxx/x/0/#xxxxx/XXxxxx")
    }

    private func outline() throws -> OutlineElement {
        try OutlineElement.parse("""
        AXWindow title="Dana Levi"
         AXTable id="ChatMessagesTableView" desc="Messages in chat with Dana Levi"
          AXCell id="WAMessageBubbleTableViewCell" class="bubble in" desc="message, Lunch at 1?, 10:54, Received from Dana Levi"
         AXTextField/AXSecureTextField
        """)
    }

    private func report() throws -> DiagnosticsReport {
        DiagnosticsReport.build(
            about: [("WhatsApp", "WhatsApp"), ("Window: Dana Levi", "Window: Xxxx Xxxx")],
            outline: try outline(),
            captured: ["⟦Chat message: Dana Levi (direct) — from Dana Levi — 10:54⟧", "Lunch at 1?"],
            kept: ["Lunch at 1?"],
            tasks: [.init(title: "[open] Answer Dana Levi", why: "From a chat: Dana Levi\nWaiting for your reply")])
    }

    func testTheFileIsMaskedUntilYouShowALine() throws {
        let model = DiagnosticsModel(try report())
        let file = model.report.text()
        for secret in ["Dana", "Levi", "Lunch"] { XCTAssertFalse(file.contains(secret), secret) }
        XCTAssertTrue(file.contains(#"id="ChatMessagesTableView""#), "ids stay, a profile matches on them")
        XCTAssertTrue(file.contains(#"class="bubble in""#))
        XCTAssertTrue(file.contains("AXTextField/AXSecureTextField"), "a secure field shows only that it is one")
        XCTAssertTrue(file.contains("== The window's outline =="))
        XCTAssertTrue(file.contains("Every letter is x and every digit 0"))

        let lunch = try XCTUnwrap(model.report.lines.first { $0.section == .lines && $0.raw == "Lunch at 1?" })
        model.toggle(lunch.id)
        XCTAssertEqual(model.report.shownCount, 1)
        let shown = model.report.text()
        XCTAssertTrue(shown.contains("\nLunch at 1?\n"), "the line you chose")
        XCTAssertFalse(shown.contains("Dana"), "and nothing else")
        model.maskAll()
        XCTAssertEqual(model.report.text(), file)
    }

    func testALineWithNothingToMaskCannotBeToggled() throws {
        let model = DiagnosticsModel(try report())
        let same = try XCTUnwrap(model.report.lines.first { !$0.differs })
        model.toggle(same.id)
        XCTAssertEqual(model.report.shownCount, 0)
    }

    func testTheIssueLinkCarriesNoWindowText() throws {
        let url = try XCTUnwrap(DiagnosticsReport.issueURL(app: "WhatsApp"))
        XCTAssertTrue(url.absoluteString.hasPrefix("https://github.com/didja-dev/didja/issues/new?"))
        XCTAssertTrue(url.absoluteString.contains("WhatsApp"))
        XCTAssertEqual(try report().fileName(on: Date(timeIntervalSince1970: 1_794_484_800)), "didja-diagnostics-whatsapp-2026-11-12.txt")
    }

    func testTheDraftBeingTypedIsNotCopied() throws {
        let live = try OutlineElement.parse("""
        AXWindow
         AXTextArea value="half a reply" focused
         AXTextArea value="an older note"
        """)
        let copy = try XCTUnwrap(OutlineElement.copy(live))
        XCTAssertNil(copy.children()[0].attributes["value"])
        XCTAssertEqual(copy.children()[1].attributes["value"], "an older note")
    }

    func testAReportGivenToYourClaudeGoesOnlyToItsFolder() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("didja-share-\(UUID().uuidString)")
        let url = try OwnClaude.share("masked", name: "../../escape.txt", in: folder)
        XCTAssertEqual(url.deletingLastPathComponent().standardizedFileURL, folder.standardizedFileURL)
        XCTAssertEqual(try String(contentsOf: url, encoding: .utf8), "masked")
        XCTAssertEqual(OwnClaude.words(.init(on: false, calls: 3, last: nil)), "Off.")
        XCTAssertEqual(OwnClaude.words(.init(on: true, calls: 0, last: nil)), "On: no calls yet.")
        XCTAssertTrue(OwnClaude.words(.init(on: true, calls: 2, last: "2026-11-12T10:40:00Z")).hasPrefix("On: 2 calls, the last on "))
        XCTAssertTrue(OwnClaude.command.hasSuffix("Contents/Helpers/didja\" mcp"))
    }

    /// Draws the preview to $TMPDIR/didja-ui/diagnostics.png.
    @MainActor
    func testRenderDiagnostics() throws {
        let model = DiagnosticsModel(try report())
        model.toggle(try XCTUnwrap(model.report.lines.first { $0.section == .lines && $0.raw == "Lunch at 1?" }).id)
        let renderer = ImageRenderer(content: DiagnosticsView(model: model, shareWithClaude: { _ in }, scrolls: false).frame(height: 560))
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage)
        let png = try XCTUnwrap(image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?
            .representation(using: .png, properties: [:]))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try png.write(to: dir.appendingPathComponent("diagnostics.png"))
        XCTAssertEqual(image.size.width, DiagnosticsView.width)
    }
}

/// Adding Didja to Claude Desktop: one entry, the rest untouched, a backup kept.
final class ClaudeDesktopTests: XCTestCase {
    func testDidjaIsAddedBesideWhatIsThere() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-claude-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("claude_desktop_config.json")
        try Data(#"{"preferences":{"theme":"dark"},"mcpServers":{"other":{"command":"x"}}}"#.utf8).write(to: file)
        XCTAssertFalse(OwnClaude.inDesktopConfig(at: file))
        try OwnClaude.addToDesktop(at: file, engine: "/Applications/Didja.app/Contents/Helpers/didja")
        XCTAssertTrue(OwnClaude.inDesktopConfig(at: file))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        XCTAssertEqual((json["preferences"] as? [String: String])?["theme"], "dark", "the rest is untouched")
        let servers = try XCTUnwrap(json["mcpServers"] as? [String: [String: Any]])
        XCTAssertNotNil(servers["other"])
        XCTAssertEqual(servers["didja"]?["args"] as? [String], ["mcp"])
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.appendingPathExtension("didja-backup").path))
        // A file that is not JSON is left alone.
        try Data("not json".utf8).write(to: file)
        XCTAssertThrowsError(try OwnClaude.addToDesktop(at: file))
        XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), "not json")
    }

    func testClaudeCodesSettingsCountForAllProjectsOrOne() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-code-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent(".claude.json")
        try Data(#"{"mcpServers":{"other":{}},"projects":{"/x":{"mcpServers":{}}}}"#.utf8).write(to: file)
        XCTAssertFalse(OwnClaude.inCodeConfig(at: file))
        try Data(#"{"mcpServers":{"didja":{"command":"/a/didja","args":["mcp"]}}}"#.utf8).write(to: file)
        XCTAssertTrue(OwnClaude.inCodeConfig(at: file), "all projects")
        try Data(#"{"projects":{"/x":{"mcpServers":{"didja":{}}}}}"#.utf8).write(to: file)
        XCTAssertTrue(OwnClaude.inCodeConfig(at: file), "one project")
    }

    func testTheStageSaysWhetherClaudeKnowsAboutDidja() {
        XCTAssertEqual(OwnClaude.stage(.init(on: false, calls: 9, last: nil), inDesktop: true), .off)
        XCTAssertEqual(OwnClaude.stage(.init(on: true, calls: 0, last: nil), inDesktop: false), .notAdded)
        XCTAssertEqual(OwnClaude.stage(.init(on: true, calls: 0, last: nil), inDesktop: true), .connected)
        XCTAssertEqual(OwnClaude.stage(.init(on: true, calls: 3, last: nil), inDesktop: false), .connected, "Claude Code called it")
    }
}

/// In the Dock and ⌘Tab while a window is open; Claude Desktop added once it quits.
final class DockAndClaudeQuitTests: XCTestCase {
    func testWhichWindowsKeepDidjaInTheDock() {
        XCTAssertTrue(DockPresence.counts(title: "Didja Missed This", titled: true, visible: true, miniaturized: false))
        XCTAssertTrue(DockPresence.counts(title: "Ship to production", titled: true, visible: true, miniaturized: false), "a canvas")
        XCTAssertFalse(DockPresence.counts(title: "Didja — Quick View", titled: true, visible: true, miniaturized: false), "the pinned Quick View")
        XCTAssertFalse(DockPresence.counts(title: "", titled: false, visible: true, miniaturized: false), "the Quick View under the icon")
        XCTAssertFalse(DockPresence.counts(title: "Privacy", titled: true, visible: false, miniaturized: false), "closed")
        XCTAssertFalse(DockPresence.counts(title: "Privacy", titled: true, visible: true, miniaturized: true), "in the Dock already, minimised")
    }

    func testWaitingForClaudeDesktopToQuitIsItsOwnStage() {
        XCTAssertEqual(OwnClaude.stage(.init(on: true, calls: 0, last: nil), inDesktop: false, pending: true), .waitingForQuit)
        XCTAssertEqual(OwnClaude.stage(.init(on: true, calls: 0, last: nil), inDesktop: true, pending: true), .connected)
    }
}
