import AppKit
import Foundation

/// Let My Own Claude Read Didja (SCR-42): `didja mcp`, the engine's local MCP server for the
/// user's own Claude. Off until turned on here; the engine keeps the switch (`meta.mcp_enabled`)
/// and logs every call. Reports you give it go to one folder, and nowhere else.
enum OwnClaude {
    struct Status: Decodable, Equatable {
        var on: Bool
        var calls: Int
        var last: String?
    }

    static var sharedFolder: URL { ObservationStore.defaultDirectory.appendingPathComponent("Shared with Claude") }

    /// The command to add to Claude Code: the engine inside this copy of the app.
    static var command: String {
        let engine = Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/didja").path
        return "claude mcp add didja -- \"\(engine)\" mcp"
    }

    static func status() -> Status {
        let output = EngineRunner.output(["mcp", "status", "--json"]) ?? ""
        return (try? JSONDecoder().decode(Status.self, from: Data(output.utf8))) ?? Status(on: false, calls: 0, last: nil)
    }

    @discardableResult
    static func set(_ on: Bool) -> Bool { EngineRunner.run(["mcp", on ? "on" : "off"]) }

    /// A diagnostics file, as you left it, where `didja mcp` can read it.
    static func share(_ text: String, name: String, in folder: URL = sharedFolder) throws -> URL {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent((name as NSString).lastPathComponent)
        try text.write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    // MARK: Claude Desktop

    static var desktopConfig: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Claude/claude_desktop_config.json")
    }

    static var enginePath: String { Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/didja").path }

    /// Claude Desktop knows about Didja: its settings name the server.
    static func inDesktopConfig(at url: URL = desktopConfig) -> Bool {
        guard let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let servers = json["mcpServers"] as? [String: Any] else { return false }
        return servers["didja"] != nil
    }

    /// Claude Code's settings (`~/.claude.json`): Didja added for all projects, or for any one project.
    static var codeConfig: URL { FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude.json") }

    static func inCodeConfig(at url: URL = codeConfig) -> Bool {
        guard let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        if (json["mcpServers"] as? [String: Any])?["didja"] != nil { return true }
        let projects = json["projects"] as? [String: [String: Any]] ?? [:]
        return projects.values.contains { ($0["mcpServers"] as? [String: Any])?["didja"] != nil }
    }

    /// Some Claude knows about Didja: Claude Desktop's settings or Claude Code's name it.
    static func added() -> Bool { inDesktopConfig() || inCodeConfig() }

    /// Add Didja to Claude Desktop's settings: one entry under `mcpServers`, everything else left
    /// as it was, the old file kept beside it. Claude Desktop reads it when it starts.
    static func addToDesktop(at url: URL = desktopConfig, engine: String = enginePath) throws {
        var json: [String: Any] = [:]
        if let data = try? Data(contentsOf: url) {
            guard let existing = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw NSError(domain: "Didja", code: 1, userInfo: [NSLocalizedDescriptionKey: "Claude Desktop's settings file could not be read, so it was left alone."])
            }
            json = existing
            try? FileManager.default.removeItem(at: url.appendingPathExtension("didja-backup"))
            try FileManager.default.copyItem(at: url, to: url.appendingPathExtension("didja-backup"))
        } else {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        }
        var servers = json["mcpServers"] as? [String: Any] ?? [:]
        servers["didja"] = ["command": engine, "args": ["mcp"]]
        json["mcpServers"] = servers
        let data = try JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
        try data.write(to: url, options: .atomic)
    }

    static let desktopBundleID = "com.anthropic.claudefordesktop"
    static var isDesktopRunning: Bool { !NSRunningApplication.runningApplications(withBundleIdentifier: desktopBundleID).isEmpty }

    /// You asked Didja to add itself once Claude Desktop quits (kept across restarts of Didja).
    static let pendingKey = "addToClaudeDesktopWhenItQuits"
    static var isPending: Bool { UserDefaults.standard.bool(forKey: pendingKey) }
    private static var quitWatch: Any?

    /// Add Didja's entry the moment Claude Desktop quits (it rewrites its settings while it runs).
    static func addWhenDesktopQuits(_ done: @escaping () -> Void = {}) {
        UserDefaults.standard.set(true, forKey: pendingKey)
        guard quitWatch == nil else { return }
        quitWatch = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didTerminateApplicationNotification, object: nil, queue: .main) { note in
            let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            guard app?.bundleIdentifier == desktopBundleID else { return }
            addPendingNow()
            done()
        }
    }

    /// At launch: add now if asked and Claude Desktop is closed, else keep waiting for it to quit.
    static func addWhenDesktopQuitsIfAsked() {
        guard isPending else { return }
        if isDesktopRunning { addWhenDesktopQuits() } else { addPendingNow() }
    }

    private static func addPendingNow() {
        guard isPending else { return }
        if (try? addToDesktop()) != nil || inDesktopConfig() {
            UserDefaults.standard.removeObject(forKey: pendingKey)
            if let quitWatch { NSWorkspace.shared.notificationCenter.removeObserver(quitWatch) }
            quitWatch = nil
        }
    }

    /// Where your Claude stands: off, allowed but not added, waiting for Claude Desktop to quit, or connected.
    enum Stage: Equatable { case off, notAdded, waitingForQuit, connected }

    static func stage(_ s: Status, inDesktop: Bool, pending: Bool = false) -> Stage {
        guard s.on else { return .off }
        if inDesktop || s.calls > 0 { return .connected }
        return pending ? .waitingForQuit : .notAdded
    }

    /// Open Claude Desktop on a new chat with this prompt in it, and put it on the clipboard too
    /// (in case the link opens Claude without filling it in).
    static func ask(_ prompt: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(prompt, forType: .string)
        var c = URLComponents(string: "claude://claude.ai/new")
        c?.queryItems = [URLQueryItem(name: "q", value: prompt)]
        if let url = c?.url { NSWorkspace.shared.open(url) }
    }

    /// "On: 12 calls, the last at 10:40." or "Off."
    static func words(_ s: Status) -> String {
        guard s.on else { return "Off." }
        guard s.calls > 0 else { return "On: no calls yet." }
        let last = s.last.flatMap { ISO8601DateFormatter().date(from: $0) }
            .map { DateFormatter.localizedString(from: $0, dateStyle: .short, timeStyle: .short) }
        return "On: \(s.calls) \(s.calls == 1 ? "call" : "calls")\(last.map { ", the last on \($0)" } ?? "")."
    }
}
