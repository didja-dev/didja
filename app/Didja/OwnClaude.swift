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

/// The shell hook (SCR-87): off until turned on in Settings › General › Commands. The engine adds a
/// few marked lines to ~/.zshrc and ~/.bashrc (and a fish function) that write each command you run,
/// with its exit code, to shell.log beside Didja's database, 24 hours; turning it off removes them
/// and the log. A command step then ticks only on an exact run that ended with exit 0.
enum ShellHook {
    struct Status: Decodable, Equatable {
        var on: Bool
        var installed: Bool
        var runs: Int
    }

    static func status() -> Status {
        let output = EngineRunner.output(["shell-hook", "status", "--json"]) ?? ""
        return (try? JSONDecoder().decode(Status.self, from: Data(output.utf8))) ?? Status(on: false, installed: false, runs: 0)
    }

    @discardableResult
    static func set(_ on: Bool) -> Bool { EngineRunner.run(["shell-hook", on ? "on" : "off"]) }

    /// What the switch does, in Settings and in Privacy.
    static let explanation = "Adds a few lines (between marked comments) to ~/.zshrc and ~/.bashrc, and a fish function if you use fish, so each command you run is written with its exit code to shell.log beside Didja's data, kept 24 hours. A step to run a command then ticks only on that exact command ending well, never on a failure. Commands that look like they hold a key or a token are kept only as a hash. Turning it off removes the lines and the log. Open a new terminal window after turning it on."

    static func words(_ s: Status) -> String {
        s.on ? "On: \(s.runs) \(s.runs == 1 ? "command" : "commands") in the last 24 hours." : "Off."
    }
}

/// Agent hooks (SCR-88): one switch per tool, off by default. On adds an entry to that tool's
/// user-level hooks file (a copy of it as it was is kept beside it) that runs this app's engine as
/// `didja hook <tool> <event>`; the engine keeps only the tool, the event, the time, a command line
/// and its exit code, and the agent's plan titles, 24 hours. Steps from that tool that it ran itself,
/// or that are its own plan items, leave your list; nothing from a hook ever ticks a task.
enum AgentHooks {
    struct Tool: Decodable, Equatable, Identifiable {
        var tool: String
        var name: String
        var file: String
        var on: Bool
        var installed: Bool
        var events: Int
        var id: String { tool }
    }

    /// The tools, as the engine knows them; the three it supports when it cannot be asked.
    static func status() -> [Tool] {
        let output = EngineRunner.output(["agent-hooks", "status", "--json"]) ?? ""
        return (try? JSONDecoder().decode([Tool].self, from: Data(output.utf8))) ?? [
            Tool(tool: "claude-code", name: "Claude Code", file: "~/.claude/settings.json", on: false, installed: false, events: 0),
            Tool(tool: "cursor", name: "Cursor", file: "~/.cursor/hooks.json", on: false, installed: false, events: 0),
            Tool(tool: "windsurf", name: "Windsurf", file: "~/.codeium/windsurf/hooks.json", on: false, installed: false, events: 0),
        ]
    }

    @discardableResult
    static func set(_ tool: String, _ on: Bool) -> Bool { EngineRunner.run(["agent-hooks", on ? "on" : "off", tool]) }

    /// Exactly what turning it on writes, for the switch.
    static func explanation(_ t: Tool) -> String {
        let engine = Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/didja").path
        let event: String
        switch t.tool {
        case "claude-code": event = "a PostToolUse hook for Bash and TodoWrite"
        case "cursor": event = "an afterShellExecution hook"
        default: event = "a post_run_command hook"
        }
        let state = t.on ? "On: \(t.events) \(t.events == 1 ? "event" : "events") in the last 24 hours." : "Off."
        return "Adds \(event) to \(t.file) (a copy of it as it was is kept beside it) that runs \"\(engine)\" hook \(t.tool). Didja keeps only the tool, the time, a command it ran and its exit code, and its plan's titles, for 24 hours: never files, prompts, replies or output. A step from \(t.name) that it then runs itself, or that is its own plan item, leaves your list. \(state)"
    }
}
