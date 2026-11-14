import XCTest
@testable import Didja

/// Each `profiles/fixtures/surfaces/*.json`: a place an AI tool shows steps (a reply, a doc pane, a
/// canvas), as an outline with made-up text, and the lines capture must keep from it. The engine's
/// tests (`engine/test/surfaces.test.ts`) check the tasks made from the same lines. docs/COVERAGE.md
/// lists every surface and its fixture.
final class SurfaceFixtureTests: XCTestCase {
    struct Fixture: Decodable {
        struct Window: Decodable { var app: String; var bundle: String; var title: String }
        var about: String
        var window: Window
        var outline: [String]
        var lines: [String]
    }

    func testEverySurfaceComesOutAsItSays() throws {
        let folder = Profiles.folder.appendingPathComponent("fixtures/surfaces")
        let files = try FileManager.default.contentsOfDirectory(atPath: folder.path).filter { $0.hasSuffix(".json") }.sorted()
        XCTAssertFalse(files.isEmpty)
        for file in files {
            let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: folder.appendingPathComponent(file)))
            let lines = try Profiles.lines(fixture.window.bundle, fixture.outline)
            if lines != fixture.lines { print("SURFACE \(file):", String(data: try JSONEncoder().encode(lines), encoding: .utf8)!) }
            XCTAssertEqual(lines, fixture.lines, file)
        }
    }
}
