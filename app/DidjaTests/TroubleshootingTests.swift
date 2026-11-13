import ApplicationServices
import SwiftUI
import XCTest
@testable import Didja

/// SCR-79: the troubleshooting report. Capture's outcome log keeps codes and counts, never text;
/// the report is offered when Didja reads nothing; Didja sends nothing itself.
final class TroubleshootingTests: XCTestCase {
    private func store() throws -> (ObservationStore, URL) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        return (try ObservationStore(directory: dir, migrations: ObservationStore.bundledMigrations()), dir)
    }

    func testTheOutcomeLogNeverStoresText() throws {
        let (store, dir) = try store()
        defer { try? FileManager.default.removeItem(at: dir) }
        // A made-up window holding text, read the way capture reads one.
        let title = "Acme invoices — Sam"
        let lines = ["Noa: could you pay the Acme invoice by Friday?", "Sam: sure, sending 4200 today"]
        let outcome = CaptureOutcome.afterRead(lines: lines.count, chars: lines.reduce(0) { $0 + $1.count }, usedOCR: false,
                                               isElectron: false, ocrEnabled: true, ocrPermitted: false)
        XCTAssertEqual(outcome, .ok(lines: 2))
        try store.recordCaptureOutcome(bundleID: "com.example.chat", app: "Example Chat", result: outcome.code, lines: outcome.lines)
        let rows = try store.captureOutcomeRows()
        XCTAssertEqual(rows.count, 1)
        let stored = rows.flatMap { $0 }.joined(separator: " ")
        for word in (lines + [title]).joined(separator: " ").split(whereSeparator: { !$0.isLetter && !$0.isNumber }) where word.count > 2 {
            XCTAssertFalse(stored.contains(word), "\(word) must not be stored")
        }
        XCTAssertTrue(stored.contains("ok"))
        XCTAssertTrue(stored.contains("com.example.chat"))
    }

    func testARepeatMovesOneRowOn() throws {
        let (store, dir) = try store()
        defer { try? FileManager.default.removeItem(at: dir) }
        try store.recordCaptureOutcome(bundleID: "com.example.app", app: "App", result: "ax-tree-empty", lines: 0)
        try store.recordCaptureOutcome(bundleID: "com.example.app", app: "App", result: "ax-tree-empty", lines: 0)
        try store.recordCaptureOutcome(bundleID: "com.example.app", app: "App", result: "ok", lines: 5)
        let rows = try store.captureOutcomeRows()
        // id, ts, last_ts, bundle_id, app, result, lines, n
        XCTAssertEqual(rows.map { [$0[5], $0[6], $0[7]] }, [["ax-tree-empty", "0", "2"], ["ok", "5", "1"]])
    }

    func testOutcomeCodes() {
        func read(_ chars: Int, ocr: Bool = false, electron: Bool = false, enabled: Bool = true, permitted: Bool = true) -> String {
            CaptureOutcome.afterRead(lines: chars > 0 ? 3 : 0, chars: chars, usedOCR: ocr, isElectron: electron,
                                     ocrEnabled: enabled, ocrPermitted: permitted).code
        }
        XCTAssertEqual(read(120), "ok")
        XCTAssertEqual(read(0), "ax-tree-empty")
        XCTAssertEqual(read(0, electron: true), "electron-switch-failed")
        XCTAssertEqual(read(0, permitted: false), "ocr-denied")
        XCTAssertEqual(read(0, enabled: false, permitted: false), "ax-tree-empty")
        XCTAssertEqual(read(10, ocr: true), "ocr-used")
        XCTAssertEqual(CaptureOutcome.noWindow(.noValue).code, "no-focused-window")
        XCTAssertEqual(CaptureOutcome.noWindow(.cannotComplete).code, "ax-error -25204")
        XCTAssertEqual(CaptureOutcome.paused.code, "paused")
        XCTAssertEqual(CaptureOutcome.notTrusted.code, "not-trusted")
        XCTAssertEqual(CaptureOutcome.excluded.lines, 0)
    }

    func testTheQuickViewOffersItOnlyWhenDidjaReadsNothing() {
        XCTAssertTrue(TroubleshootingReport.shouldOffer(status: .needsAccessibility, observations: 40, capturingFor: 0))
        XCTAssertTrue(TroubleshootingReport.shouldOffer(status: .failed("Database error"), observations: 0, capturingFor: 0))
        XCTAssertTrue(TroubleshootingReport.shouldOffer(status: .capturing, observations: 0, capturingFor: 121))
        XCTAssertFalse(TroubleshootingReport.shouldOffer(status: .capturing, observations: 0, capturingFor: 60))
        XCTAssertFalse(TroubleshootingReport.shouldOffer(status: .capturing, observations: 3, capturingFor: 600))
        XCTAssertFalse(TroubleshootingReport.shouldOffer(status: .paused, observations: 0, capturingFor: 600))
    }

    private let report = TroubleshootingReport(
        findings: ["Claude has given no text in 40 tries: its accessibility tree is empty.",
                   "Apple Intelligence can't be used here (Not available: Apple Intelligence is turned off): emails and chat messages are not turned into tasks."],
        text: """
            Didja troubleshooting report, 2026-11-13T10:00:00.000Z
            Counts and codes only: no screen text, window titles or task words.

            Capture
              Capturing (since 2026-11-13T09:58:00Z, app at /Applications/Didja.app)
              Claude (com.anthropic.claudefordesktop): 0 readings in the last hour, 0 in 24 h
                ax-tree-empty ×40, last 3 s ago (gave no text)
              Terminal (com.apple.Terminal): 12 readings in the last hour, 95 in 24 h
                ok 24 lines ×95, last 10 s ago (read)

            """)

    func testEmailAndIssueAreOnlyLinksYouOpen() throws {
        let mail = try XCTUnwrap(report.mailLink)
        XCTAssertEqual(mail.scheme, "mailto")
        let items = URLComponents(url: mail, resolvingAgainstBaseURL: false)?.queryItems ?? []
        XCTAssertEqual(URLComponents(url: mail, resolvingAgainstBaseURL: false)?.path, "hello@didja.dev")
        XCTAssertEqual(items.first { $0.name == "body" }?.value, report.text)
        let issue = try XCTUnwrap(report.issueLink)
        XCTAssertFalse(issue.mustPaste)
        XCTAssertTrue(issue.url.absoluteString.hasPrefix(BugReport.newIssue))
        let long = TroubleshootingReport(findings: [], text: String(repeating: "ok 3 lines ×1, last 2 s ago\n", count: 600))
        XCTAssertTrue(try XCTUnwrap(long.issueLink).mustPaste)
        XCTAssertEqual(report.fileName(now: ISO8601DateFormatter().date(from: "2026-11-13T10:00:00Z")!).prefix(22), "didja-troubleshooting-")
    }

    func testAppFactsUseTheKeysTheEngineReads() throws {
        let facts = AppFacts.current(excluded: .init(apps: 1, titles: 0, sites: 2), screenRecording: false,
                                     modelStatus: "Not available on this Mac", defaults: UserDefaults(suiteName: UUID().uuidString)!)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(facts.json.utf8)) as? [String: Any])
        for key in ["version", "macOS", "chip", "appPath", "debug", "accessibility", "screenRecording", "modelAvailable", "modelStatus", "excluded", "at"] {
            XCTAssertNotNil(json[key], key)
        }
        XCTAssertEqual(json["modelAvailable"] as? Bool, false)
        XCTAssertEqual(json["excluded"] as? [String: Int], ["apps": 1, "titles": 0, "sites": 2])
    }

    @MainActor func testRenderTroubleshootingReport() throws {
        let renderer = ImageRenderer(content: TroubleshootingView(report: report).frame(width: TroubleshootingView.width, height: 560))
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage)
        let png = try XCTUnwrap(image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?.representation(using: .png, properties: [:]))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try png.write(to: dir.appendingPathComponent("troubleshooting.png"))
    }
}
