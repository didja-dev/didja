import AppKit
import SwiftUI

/// Connections: task tools connected over their MCP servers (Linear first). The one place
/// Didja uses the network, and only to the tools you connect here (docs/DECISIONS.md).
/// Everything goes through the engine (`didja connections | connect | connection | disconnect | sync`).
final class ConnectionsModel: ObservableObject {
    struct Item: Decodable, Identifiable, Equatable {
        struct OnDone: Decodable, Equatable { var state: String?; var label: String? }
        /// Which of your items come in. Missing: due today or overdue, every team.
        struct Bring: Decodable, Equatable {
            var due = true, started = false, unstarted = false, backlog = false
            var teams: [String] = []
        }
        var id: String
        var kind: String
        var name: String
        var onDone: OnDone
        var whenSure: Bool
        var bring: Bring?
        var status: String?
        /// What the tool calls the groups items belong to ("Teams", "Projects", "Databases").
        var groups: String?
        /// Tried with a real account.
        var tried: Bool?
        var lastSync: String?
        var lastError: String?
    }

    struct Choices: Decodable, Equatable { var states: [String]; var labels: [String]; var teams: [String]? }

    /// The kinds of item a connection can bring in, as the engine names them.
    static let rules: [(key: String, label: String)] = [
        ("due", "Due today or earlier"), ("started", "In progress"), ("unstarted", "To do"), ("backlog", "Backlog"),
    ]

    /// Tools that can be connected, with what they are.
    static let available: [(kind: String, name: String, about: String, tried: Bool)] = [
        ("linear", "Linear", "Your issues come in (due today, in progress… as you choose); ticking one here moves it in Linear.", true),
        ("jira", "Jira", "Your Jira issues come in; ticking one here moves it through its workflow to the state you choose, or adds a label.", false),
        ("asana", "Asana", "Your Asana tasks come in; ticking one here completes it in Asana.", false),
        ("todoist", "Todoist", "Your Todoist tasks come in; ticking one here completes it in Todoist.", false),
        ("notion", "Notion", "Tasks from the Notion databases you choose come in; ticking one here sets its Status.", false),
    ]

    @Published private(set) var items: [Item] = []
    @Published private(set) var choices: [String: Choices] = [:]
    /// What is under way: "Waiting for you to sign in…", "Syncing…".
    @Published private(set) var working: String?
    @Published private(set) var message: String?

    private let run: ([String]) -> (ok: Bool, output: String)

    init(run: @escaping ([String]) -> (ok: Bool, output: String) = ConnectionsModel.engine) {
        self.run = run
        reload()
    }

    static func engine(_ arguments: [String]) -> (ok: Bool, output: String) {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = EngineRunner.bundledEngine
        process.arguments = arguments
        process.environment = EngineRunner.environment
        process.standardOutput = pipe
        process.standardError = pipe
        guard (try? process.run()) != nil else { return (false, "Didja's engine is missing from the app.") }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return (process.terminationStatus == 0, String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines))
    }

    func reload() {
        let result = run(["connections", "--json"])
        items = (try? JSONDecoder().decode([Item].self, from: Data(result.output.utf8))) ?? []
    }

    func isConnected(_ kind: String) -> Bool { items.contains { $0.kind == kind } }

    /// In the background: the engine opens your browser and waits for you to sign in.
    func connect(_ kind: String) {
        background("Opening your browser. Sign in there and approve Didja…", ["connect", kind]) { [weak self] ok, output in
            self?.message = ok ? output : "Not connected: \(output.split(separator: "\n").last.map(String.init) ?? output)"
            if ok { self?.loadChoices(kind) }
        }
    }

    func syncNow() {
        background("Syncing…", ["sync"]) { [weak self] ok, output in
            self?.message = ok ? "Synced: \(output)" : output
        }
    }

    func disconnect(_ id: String) {
        _ = run(["disconnect", id])
        choices[id] = nil
        reload()
    }

    func setState(_ id: String, _ state: String?) { change(["connection", id, "state"] + (state.map { [$0] } ?? [])) }
    func setLabel(_ id: String, _ label: String?) { change(["connection", id, "label"] + (label.map { [$0] } ?? [])) }
    func setWhenSure(_ id: String, _ on: Bool) { change(["connection", id, "whensure", on ? "on" : "off"]) }
    func setRule(_ id: String, _ rule: String, _ on: Bool) { change(["connection", id, "bring", rule, on ? "on" : "off"]) }
    func setTeam(_ id: String, _ team: String, _ on: Bool) { change(["connection", id, "team", team, on ? "on" : "off"]) }
    func allTeams(_ id: String) { change(["connection", id, "team", "all"]) }

    static func isOn(_ bring: Item.Bring, _ rule: String) -> Bool {
        switch rule {
        case "due": return bring.due
        case "started": return bring.started
        case "unstarted": return bring.unstarted
        default: return bring.backlog
        }
    }

    /// The tool's states and labels, for the pickers.
    func loadChoices(_ id: String) {
        guard choices[id] == nil else { return }
        let run = self.run
        DispatchQueue.global(qos: .userInitiated).async {
            let result = run(["connection", id, "choices"])
            let found = try? JSONDecoder().decode(Choices.self, from: Data(result.output.utf8))
            DispatchQueue.main.async { if let found { self.choices[id] = found } }
        }
    }

    private func change(_ arguments: [String]) {
        let result = run(arguments)
        if !result.ok { message = result.output }
        reload()
    }

    private func background(_ status: String, _ arguments: [String], done: @escaping (Bool, String) -> Void) {
        working = status
        message = nil
        let run = self.run
        DispatchQueue.global(qos: .userInitiated).async {
            let result = run(arguments)
            DispatchQueue.main.async {
                self.working = nil
                self.reload()
                done(result.ok, result.output)
            }
        }
    }
}

/// Fixed width, scrolling content (a window sized by SwiftUI content can loop and crash).
struct ConnectionsView: View {
    static let width: CGFloat = 560
    @ObservedObject var model: ConnectionsModel

    var body: some View {
        ScrollView { ConnectionsContent(model: model) }
            .frame(width: Self.width)
    }
}

struct ConnectionsContent: View {
    @ObservedObject var model: ConnectionsModel

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Image(systemName: "link").font(.system(size: 20)).foregroundStyle(Palette.accent)
                    Text("Connections").font(.title2.weight(.semibold))
                }
                Text("Bring in what is due in your task tools, and update them when Didja sees it done. Apart from the daily update check (it carries only the app's version), this is the only thing Didja sends over the network, and only to the tools you connect here: it reads your items there and sends the change you set up below. What it reads from your screen never leaves your Mac.")
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if let working = model.working {
                    HStack(spacing: 8) { ProgressView().controlSize(.small); Text(working) }.font(.callout)
                }
                if let message = model.message {
                    Text(message).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }

            ForEach(ConnectionsModel.available, id: \.kind) { tool in
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text(tool.name).font(.headline)
                        Spacer()
                        if !model.isConnected(tool.kind) {
                            Button("Connect…") { model.connect(tool.kind) }.disabled(model.working != nil)
                        }
                    }
                    if let item = model.items.first(where: { $0.kind == tool.kind }) {
                        connected(item)
                    } else {
                        Text(tool.about).font(.callout).foregroundStyle(.secondary)
                    }
                    if !tool.tried {
                        Text("Built from \(tool.name)'s published MCP tools and not yet tried with a real account. If something does not match, it says so here and changes nothing in \(tool.name).")
                            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))
            }
        }
        .padding(24)
        .frame(width: ConnectionsView.width, alignment: .leading)
    }

    @ViewBuilder
    private func connected(_ item: ConnectionsModel.Item) -> some View {
        let choices = model.choices[item.id]
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Circle().fill(item.status == "connected" ? Palette.done : Palette.attention).frame(width: 8, height: 8)
                Text(statusText(item)).font(.callout)
                Spacer()
                Button("Sync Now") { model.syncNow() }.disabled(model.working != nil)
                if item.status == "signed-out" {
                    Button("Sign In Again…") { model.connect(item.kind) }.disabled(model.working != nil)
                }
            }
            bringIn(item, teams: choices?.teams ?? [], groups: item.groups ?? "Teams")

            Text("When Didja ticks one").font(.subheadline.weight(.semibold))
            picker("Move it to", current: item.onDone.state, options: choices?.states ?? []) { model.setState(item.id, $0) }
            picker("Add the label", current: item.onDone.label, options: choices?.labels ?? []) { model.setLabel(item.id, $0) }
            Toggle("Also when Didja ticks it on its own and is very sure", isOn: Binding(
                get: { item.whenSure }, set: { model.setWhenSure(item.id, $0) }))
                .font(.callout)
            Text("Otherwise only when you tick it. Something done or cancelled in \(item.name) leaves your list here too.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                Spacer()
                Button("Disconnect", role: .destructive) { model.disconnect(item.id) }
            }
        }
        .onAppear { model.loadChoices(item.id) }
    }

    /// Which of your items come in, and from which teams.
    @ViewBuilder
    private func bringIn(_ item: ConnectionsModel.Item, teams: [String], groups: String) -> some View {
        let bring = item.bring ?? .init()
        VStack(alignment: .leading, spacing: 6) {
            Text("Bring in items assigned to you that are").font(.subheadline.weight(.semibold))
            HStack(spacing: 14) {
                ForEach(ConnectionsModel.rules, id: \.key) { rule in
                    Toggle(rule.label, isOn: Binding(
                        get: { ConnectionsModel.isOn(bring, rule.key) },
                        set: { model.setRule(item.id, rule.key, $0) }))
                }
            }
            .font(.callout)
            if !teams.isEmpty || !bring.teams.isEmpty {
                Text("From").font(.subheadline.weight(.semibold)).padding(.top, 4)
                Toggle("All \(groups.lowercased())", isOn: Binding(get: { bring.teams.isEmpty }, set: { if $0 { model.allTeams(item.id) } }))
                    .font(.callout)
                    .disabled(bring.teams.isEmpty)
                let shown = teams + bring.teams.filter { team in !teams.contains { $0.caseInsensitiveCompare(team) == .orderedSame } }
                ForEach(shown, id: \.self) { team in
                    Toggle(team, isOn: Binding(
                        get: { bring.teams.contains { $0.caseInsensitiveCompare(team) == .orderedSame } },
                        set: { model.setTeam(item.id, team, $0) }))
                        .font(.callout)
                        .padding(.leading, 18)
                }
            }
            Text(item.kind == "notion"
                 ? "Tick the databases your tasks are in; with none ticked, nothing comes in. Done items never come in."
                 : bring.teams.isEmpty
                 ? "From all \(groups.lowercased()). Tick some to bring in only theirs. Done and cancelled items never come in."
                 : "Only from the \(groups.lowercased()) ticked. Done and cancelled items never come in.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func statusText(_ item: ConnectionsModel.Item) -> String {
        switch item.status {
        case "connected": return "Connected" + (item.lastSync.map { " · synced \(Self.when($0))" } ?? "")
        case "signed-out": return "Signed out: sign in again"
        case "error": return "Could not reach it: \(item.lastError ?? "unknown error")"
        default: return "Not synced yet"
        }
    }

    private static func when(_ iso: String) -> String {
        guard let date = ISO8601DateFormatter.withFractions.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return iso }
        return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
    }

    /// A menu of the tool's own names, with "Nothing" to leave it be; the current one is kept even
    /// before the tool's list has loaded.
    private func picker(_ title: String, current: String?, options: [String], set: @escaping (String?) -> Void) -> some View {
        let all = current.map { options.contains($0) ? options : [$0] + options } ?? options
        return Picker(title, selection: Binding<String>(get: { current ?? "" }, set: { set($0.isEmpty ? nil : $0) })) {
            Text("Nothing").tag("")
            ForEach(all, id: \.self) { Text($0).tag($0) }
        }
        .frame(maxWidth: 360)
    }
}

private extension ISO8601DateFormatter {
    static let withFractions: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}
