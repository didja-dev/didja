import SwiftUI
import XCTest
@testable import Didja

/// SCR-51: Report a Bug… fills in a GitHub issue for you to submit; Didja sends nothing.
final class BugReportTests: XCTestCase {
    private var report: BugReport {
        var r = BugReport()
        r.title = "  The list stops updating after the Mac wakes "
        r.happened = "After sleep, new tasks from Acme Chat stop showing.\n"
        r.steps = "1. Close the lid\n2. Open it"
        return r
    }

    private func query(_ url: URL) -> [String: String] {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        return Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
    }

    func testItNeedsATitleAndWhatHappened() {
        XCTAssertFalse(BugReport().isReady)
        var r = BugReport()
        r.title = "Something"
        XCTAssertFalse(r.isReady)
        r.happened = "   \n"
        XCTAssertFalse(r.isReady)
        XCTAssertTrue(report.isReady)
    }

    func testTheBodyHoldsWhatYouWroteAndTheVersions() {
        let body = report.body(versions: "Didja 1.2 (3) on macOS 26.1")
        XCTAssertTrue(body.hasPrefix("**What happened**\nAfter sleep, new tasks from Acme Chat stop showing.\n\n"))
        XCTAssertTrue(body.contains("**Steps to make it happen**\n1. Close the lid\n2. Open it"))
        XCTAssertFalse(body.contains("What you expected"), "an empty section is left out")
        XCTAssertTrue(body.contains("**Version**\nDidja 1.2 (3) on macOS 26.1"))
        var without = report
        without.includeVersions = false
        XCTAssertFalse(without.body(versions: "Didja 1.2 (3) on macOS 26.1").contains("Didja 1.2"))
    }

    func testTheLinkOpensANewIssueFilledIn() throws {
        let link = try XCTUnwrap(report.issueLink(versions: "Didja 1.2 (3) on macOS 26.1"))
        XCTAssertFalse(link.mustPaste)
        XCTAssertTrue(link.url.absoluteString.hasPrefix("https://github.com/didja-dev/didja/issues/new?"))
        let q = query(link.url)
        XCTAssertEqual(q["title"], "The list stops updating after the Mac wakes")
        XCTAssertEqual(q["labels"], "bug")
        XCTAssertEqual(q["body"], report.body(versions: "Didja 1.2 (3) on macOS 26.1"))
    }

    func testALongDescriptionIsPastedNotCutOff() throws {
        var long = report
        long.happened = String(repeating: "The list stops. ", count: 600)
        let link = try XCTUnwrap(long.issueLink())
        XCTAssertTrue(link.mustPaste)
        XCTAssertLessThanOrEqual(link.url.absoluteString.count, BugReport.maxLink)
        XCTAssertEqual(query(link.url)["title"], "The list stops updating after the Mac wakes")
        XCTAssertTrue(query(link.url)["body"]?.contains("paste it here") == true)
    }

    func testItCautionsAboutWhatLooksPersonal() {
        XCTAssertEqual(report.cautions, [])
        var r = report
        r.happened = "Sam (sam@example.com) wrote from +1 000 000 0000, see https://example.com/inbox/42"
        XCTAssertEqual(r.cautions, ["an email address", "a phone number or a long number", "a link with a path"])
        r.happened = "Version 26.1, at 10:30, on example.com"
        XCTAssertEqual(r.cautions, [])
    }

    func testItIsInTheHelpMenu() {
        let titles = MenuEntry.titles(AppDelegate().moreMenuEntries())
        XCTAssertTrue(titles.contains("Help › Report a Bug…"))
        XCTAssertTrue(titles.contains("Help › Suggest a Feature…"))
    }

    // MARK: Suggest a Feature… (SCR-52)

    private var idea: BugReport {
        var r = BugReport(.feature)
        r.title = "Group tasks by project"
        r.happened = "Put tasks from the same project together in the Full View."
        r.steps = "On a busy day with tasks from three projects."
        r.expected = "left over from switching kinds"
        return r
    }

    func testAnIdeaHasItsOwnSectionsAndLabel() throws {
        XCTAssertTrue(idea.isReady)
        XCTAssertFalse(idea.includeVersions, "an idea leaves the versions out unless you add them")
        XCTAssertTrue(BugReport().includeVersions)
        let body = idea.body(versions: "Didja 1.2 (3) on macOS 26.1")
        XCTAssertTrue(body.hasPrefix("**What you would like Didja to do**\nPut tasks from the same project together in the Full View.\n\n"))
        XCTAssertTrue(body.contains("**What it would help with**\nOn a busy day"))
        XCTAssertFalse(body.contains("left over"), "an idea has no third field")
        XCTAssertFalse(body.contains("Version"))
        XCTAssertTrue(body.contains("Sent from Suggest a Feature… in Didja"))
        let link = try XCTUnwrap(idea.issueLink())
        let q = query(link.url)
        XCTAssertEqual(q["labels"], "enhancement")
        XCTAssertEqual(q["title"], "Group tasks by project")
        XCTAssertEqual(query(try XCTUnwrap(report.issueLink()).url)["labels"], "bug")
    }

    @MainActor func testRenderSuggestAFeature() throws {
        let renderer = ImageRenderer(content: BugReportView(report: idea).frame(width: BugReportView.width))
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage)
        let png = try XCTUnwrap(image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?.representation(using: .png, properties: [:]))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try png.write(to: dir.appendingPathComponent("feature.png"))
    }

    @MainActor func testRenderBugReport() throws {
        var filled = report
        filled.happened = "Sam (sam@example.com) said the list stops after sleep."
        let renderer = ImageRenderer(content: BugReportView(report: filled).frame(width: BugReportView.width))
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage)
        let png = try XCTUnwrap(image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?.representation(using: .png, properties: [:]))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try png.write(to: dir.appendingPathComponent("bug-report.png"))
    }
}
