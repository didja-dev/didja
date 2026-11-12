import Foundation

/// Trying a profile against a fixture: an app's window as an outline with made-up text, and the
/// lines capture should keep from it. `Didja --profile-test <fixture.json> [--profiles <folder>]`
/// prints what capture keeps and whether it is what the fixture says. Pure: nothing on screen is read.
enum ProfileLab {
    struct Fixture: Codable {
        var about: String
        var profile: String
        /// The app the window belongs to; a browser for a site's profile.
        var app: String
        var url: String?
        var window: String?
        var outline: [String]
        var lines: [String]?
    }

    struct Result: Codable, Equatable {
        var profile: String?
        var lines: [String]
        /// Nil when the fixture does not say which lines to expect yet.
        var matches: Bool?
        var problem: String?
    }

    static func run(_ fixture: Fixture, profiles: [AppProfile]) -> Result {
        let root: OutlineElement
        do { root = try OutlineElement.parse(fixture.outline.joined(separator: "\n")) } catch {
            return Result(profile: nil, lines: [], matches: false, problem: "the outline does not read: \(error)")
        }
        var limits = AXCapture.Limits()
        limits.app = fixture.app
        limits.profiles = profiles
        limits.skipFocusedInput = true
        let lines = AXCapture.read(root: root, title: fixture.window ?? "", appName: "", limits: limits).lines
        let used = profiles.first { $0.match.matches(bundleID: fixture.app) || $0.match.matches(url: fixture.url) }
        var problem: String?
        if used?.id != fixture.profile { problem = "the window is read with \(used?.id ?? "no profile"), not \(fixture.profile)" }
        return Result(profile: used?.id, lines: lines, matches: fixture.lines.map { $0 == lines && problem == nil }, problem: problem)
    }

    /// Profiles from a folder, each checked; the bundled ones when no folder is given. A profile in
    /// the folder replaces a bundled one with the same id.
    static func profiles(folder: String?) throws -> [AppProfile] {
        guard let folder else { return AppProfiles.builtIn }
        let url = URL(fileURLWithPath: folder)
        var drafts: [AppProfile] = []
        for name in try FileManager.default.contentsOfDirectory(atPath: folder).filter({ $0.hasSuffix(".json") }).sorted() {
            do { drafts.append(try AppProfile.load(Data(contentsOf: url.appendingPathComponent(name)))) } catch {
                throw NSError(domain: "Didja", code: 1, userInfo: [NSLocalizedDescriptionKey: "\(name): \(error)"])
            }
        }
        let ids = Set(drafts.map(\.id))
        return drafts + AppProfiles.builtIn.filter { !ids.contains($0.id) }
    }

    static func commandLine(_ args: [String]) -> Never {
        func value(after flag: String) -> String? {
            args.firstIndex(of: flag).flatMap { $0 + 1 < args.count ? args[$0 + 1] : nil }
        }
        func fail(_ why: String) -> Never {
            FileHandle.standardError.write(Data((why + "\n").utf8))
            exit(2)
        }
        guard let path = value(after: "--profile-test") else { fail("usage: Didja --profile-test <fixture.json> [--profiles <folder>]") }
        let fixture: Fixture
        do { fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: URL(fileURLWithPath: path))) } catch {
            fail("the fixture does not read: \(error)")
        }
        let list: [AppProfile]
        do { list = try profiles(folder: value(after: "--profiles")) } catch { fail("\(error.localizedDescription)") }
        let result = run(fixture, profiles: list)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes, .sortedKeys]
        print(String(decoding: (try? encoder.encode(result)) ?? Data(), as: UTF8.self))
        exit(result.matches == false ? 1 : 0)
    }
}
