import XCTest
@testable import Didja

/// SCR-114: Export All Tasks asks the engine for the file; screen text only when you tick the box.
final class TaskExportTests: XCTestCase {
    func testTheEngineWritesTheFileYouChose() {
        XCTAssertEqual(TaskExport.arguments(.markdown, withContext: false, to: "/tmp/a.md"), ["export", "md", "--out", "/tmp/a.md"])
        XCTAssertEqual(TaskExport.arguments(.json, withContext: false, to: "/tmp/a.json"), ["export", "json", "--out", "/tmp/a.json"])
    }

    func testKeptLinesOnlyWhenAskedFor() {
        XCTAssertFalse(TaskExport.arguments(.json, withContext: false, to: "/x").contains("--context"))
        XCTAssertEqual(TaskExport.arguments(.json, withContext: true, to: "/x"), ["export", "json", "--context", "--out", "/x"])
    }

    func testTheFileIsNamedForTheDay() {
        var parts = DateComponents()
        parts.year = 2026; parts.month = 11; parts.day = 14; parts.hour = 12
        let date = Calendar.current.date(from: parts)!
        XCTAssertEqual(TaskExport.fileName(.markdown, on: date), "Didja tasks 2026-11-14.md")
        XCTAssertEqual(TaskExport.fileName(.json, on: date), "Didja tasks 2026-11-14.json")
        XCTAssertEqual(TaskExport.Format.allCases.map(\.label), ["Markdown…", "JSON…"])
    }
}
