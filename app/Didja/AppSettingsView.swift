import AppKit
import SwiftUI

/// The pages of Settings in the task window. Each one is the same view its own window shows.
enum SettingsPage: String, CaseIterable, Identifiable {
    case general, connections, names, brain, exclude, privacy

    var id: String { rawValue }

    var title: String {
        switch self {
        case .general: return "General"
        case .connections: return "Connections"
        case .names: return "Your Names"
        case .brain: return "How It Decides"
        case .exclude: return "Exclude List"
        case .privacy: return "Privacy"
        }
    }

    var symbol: String {
        switch self {
        case .general: return "gearshape"
        case .connections: return "link"
        case .names: return "person.text.rectangle"
        case .brain: return "brain"
        case .exclude: return "eye.slash"
        case .privacy: return "lock.shield"
        }
    }
}

/// What the task window needs to show Settings: which page is open, the pages' models (made when
/// first opened), and the few actions that live in the app delegate.
final class SettingsHub: ObservableObject {
    /// Nil while the window shows tasks.
    @Published var page: SettingsPage?

    lazy var names = NamesModel()
    lazy var connections = ConnectionsModel()
    lazy var brain = BrainModel()
    let exclude: ExcludeListModel
    var privacyFacts: () -> PrivacyFacts
    var forgetCapturedText: () -> Void
    /// Forget the last hour, or everything Didja learned (SCR-104): asks first.
    var forget: (ForgetPrompt.Level) -> Void
    var openWelcome: () -> Void
    var revealDataFolder: () -> Void

    init(exclude: ExcludeListModel, privacyFacts: @escaping () -> PrivacyFacts, forgetCapturedText: @escaping () -> Void,
         forget: @escaping (ForgetPrompt.Level) -> Void = { _ in },
         openWelcome: @escaping () -> Void, revealDataFolder: @escaping () -> Void) {
        self.exclude = exclude
        self.privacyFacts = privacyFacts
        self.forgetCapturedText = forgetCapturedText
        self.forget = forget
        self.openWelcome = openWelcome
        self.revealDataFolder = revealDataFolder
    }

    /// Open a page, reading its contents fresh.
    func open(_ page: SettingsPage) {
        switch page {
        case .names: names.reload()
        case .connections: connections.reload()
        case .brain: brain.reload()
        default: break
        }
        self.page = page
    }
}

/// One settings page, in the task window's main area.
struct SettingsPageView: View {
    let page: SettingsPage
    @ObservedObject var hub: SettingsHub
    @ObservedObject var capture: CaptureCoordinator

    var body: some View {
        ScrollView {
            Group {
                switch page {
                case .general: GeneralSettingsView(capture: capture, hub: hub)
                case .connections: ConnectionsContent(model: hub.connections)
                case .names: NamesContent(model: hub.names)
                case .brain: BrainContent(model: hub.brain)
                case .exclude: ExcludeListView(model: hub.exclude).padding(24)
                case .privacy: PrivacyContent(facts: hub.privacyFacts(), openExcludeList: { hub.open(.exclude) },
                                              revealDataFolder: hub.revealDataFolder)
                }
            }
            .frame(maxWidth: 680, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// Everything the panel's "…" menu sets, on one page, with a word on what each does.
struct GeneralSettingsView: View {
    @ObservedObject var capture: CaptureCoordinator
    @ObservedObject var hub: SettingsHub
    @State private var launchAtLogin = LoginItem.isEnabled
    @State private var appearance = AppearanceSetting.saved
    @State private var nudges = Nudger.isEnabled
    @State private var waitingQuiet = WaitingQuiet.Status(chatHours: 24, emailDays: 2)
    @State private var reviewTimes = DayReviewEngine.Times()
    @ObservedObject private var updates = Updates.shared
    @StateObject private var hotKey = HotKeyRecording()
    @State private var ocrOn = OCRCapture.isEnabled
    @State private var ownClaude = OwnClaude.Status(on: false, calls: 0, last: nil)
    @State private var shellHook = ShellHook.Status(on: false, installed: false, runs: 0)
    @State private var agentHooks: [AgentHooks.Tool] = []
    @State private var local = LocalModel.Status(on: false, model: nil)
    /// The models Ollama has, or nil when it is not running.
    @State private var ollamaModels: [String]?
    /// "How Didja is doing" (SCR-73), read when the page opens.
    @State private var quality: QualityReport?
    /// Export All Tasks (SCR-114): add the lines kept with open tasks. Off each time the page opens.
    @State private var exportWithContext = false
    /// The Friday reminder of the week (SCR-116), read when the page opens; off by default.
    @State private var weekNudge = false

    /// What the local model does, and how it stands on this Mac.
    private var localWords: String {
        let what = "Emails, chat messages, \"looks done?\" and whose a list is are asked of a model in Ollama, which runs on this Mac (127.0.0.1), before Apple's on-device model. Slower, and it needs memory while it runs. Other decisions stay with Apple's model."
        switch (ollamaModels, local.on) {
        case (nil, true): return "\(what) Ollama isn't running, so Apple's model answers for now."
        case (nil, false): return "\(what) Ollama isn't running on this Mac; install it from ollama.com and pull a model to turn this on."
        case (let models?, _) where models.isEmpty: return "\(what) Ollama has no models yet; pull one first (ollama pull …)."
        case (_, true): return "\(what) In use: \(local.model ?? "none")."
        default: return what
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(spacing: 8) {
                Image(systemName: "gearshape").font(.system(size: 20)).foregroundStyle(Palette.accent)
                Text("General").font(.title2.weight(.semibold))
            }

            section("Capture") {
                row("Reading the screen", "Turn off to pause: nothing is read until you turn it back on. \(GlobalHotKey.pauseLabel) does it from anywhere.") {
                    Text(capture.isPaused ? "Paused" : "On").font(.callout).foregroundStyle(.secondary)
                    Toggle("Reading", isOn: Binding(get: { !capture.isPaused }, set: { capture.isPaused = !$0 }))
                        .toggleStyle(.switch).labelsHidden()
                }
                row("Keep captured text for", "Text read from the screen is deleted after this. Tasks stay.") {
                    Picker("", selection: $capture.retention) {
                        ForEach(Retention.allCases) { Text($0.label).tag($0) }
                    }.labelsHidden().fixedSize()
                }
                row("Forget captured text now", "Deletes every reading kept so far. Tasks stay.") {
                    Button("Forget Now…", action: hub.forgetCapturedText)
                }
                row("Forget the last hour", "Text, kept lines and log lines from the last 60 minutes. Nothing older.") {
                    Button("Forget Last Hour…") { hub.forget(.hour) }
                }
                row("Forget everything Didja learned", "Text, and everything learned from it. Privacy lists what was cleared.") {
                    Button("Forget Everything…") { hub.forget(.everything) }
                }
                row("Read windows without accessibility text", OCRCapture.isPermitted
                    ? (ocrOn ? "On: windows that offer no text are read from their pixels, in memory only, never stored. macOS asks you to confirm this now and then."
                             : "Off: no window is read from its pixels, and macOS won't ask about screen access for Didja.")
                    : "Needs Screen Recording permission. Pixels are read in memory only, never stored.") {
                    if OCRCapture.isPermitted {
                        Toggle("", isOn: Binding(get: { ocrOn }, set: { ocrOn = $0; OCRCapture.isEnabled = $0 }))
                            .toggleStyle(.switch).labelsHidden()
                    } else {
                        Button("Allow…") { OCRCapture.requestPermission() }
                    }
                }
                row("Start at login", "Open Didja when you log in.") {
                    Toggle("", isOn: Binding(get: { launchAtLogin }, set: { launchAtLogin = LoginItem.setEnabled($0) }))
                        .toggleStyle(.switch).labelsHidden()
                }
                row("Check for updates", "Once a day, Didja asks didja.dev whether there is a new version. Nothing else is sent.") {
                    HStack(spacing: 10) {
                        Button("Check Now") { updates.checkNow() }
                            .buttonStyle(DidjaButtonStyle.secondary)
                            .disabled(!updates.canCheck)
                        Toggle("", isOn: Binding(get: { updates.checksAutomatically }, set: { updates.checksAutomatically = $0 }))
                            .toggleStyle(.switch).labelsHidden()
                    }
                }
            }

            section("Tasks") {
                row("Focus", "Show one app's tasks only, in the \(ViewNames.quick) and here.") {
                    Picker("", selection: $capture.focus) {
                        Text("All Apps").tag(String?.none)
                        ForEach(capture.tasks.apps, id: \.self) { Text("Only \($0)").tag(String?.some($0)) }
                    }.labelsHidden().fixedSize()
                }
                row("Sort", "Group by where tasks came from, put the latest activity first, or put the soonest due first (a due date is read from an ask that says \"by Thursday\", \"tomorrow\" and the like).") {
                    Picker("", selection: $capture.sort) {
                        ForEach(TaskBoard.Sort.allCases) { Text($0.label).tag($0) }
                    }.labelsHidden().fixedSize()
                }
                row("When a task looks done", "Ask you; tick it when Didja is sure (two signs on the same screen agree, or you said yes there five times with no \"not yet\" since); or tick every one. A tick is labelled \"ticked for you\": reopen it if it was not done, and Didja asks there again.") {
                    Picker("", selection: $capture.looksDoneMode) {
                        ForEach(LooksDoneMode.allCases) { Text($0.label).tag($0) }
                    }.labelsHidden().fixedSize()
                }
                row("Older messages", "Take tasks from all messages, or only from ones sent since capture started (at launch, or when you last pressed Resume). Mail and chat messages show when they were sent; a Claude reply does not, so it is always read, even when you scroll back to it.") {
                    Picker("", selection: $capture.onlyNewMessages) {
                        Text("From All Messages").tag(false)
                        Text("New Messages Only").tag(true)
                    }.labelsHidden().fixedSize()
                }
                row("Remind me about unfinished checklists", "A notification when a checklist has sat untouched for hours, and once on the day a task falls due.") {
                    Toggle("", isOn: Binding(get: { nudges }, set: { nudges = $0; Nudger.isEnabled = $0 }))
                        .toggleStyle(.switch).labelsHidden()
                }
                row("Waiting On: remind me when there is no reply", "An ask you sent (\"Can you send me…?\") waits for that person's answer under Waiting On, quietly, then reminds you once if they have not answered in that chat or email conversation. Their reply closes it; nothing is ticked.") {
                    Picker("Chat", selection: Binding(get: { waitingQuiet.chatHours }, set: { hours in
                        waitingQuiet.chatHours = hours
                        DispatchQueue.global(qos: .userInitiated).async { WaitingQuiet.set(chatHours: hours) }
                    })) {
                        ForEach(Array(Set(WaitingQuiet.chatChoices + [waitingQuiet.chatHours])).sorted(), id: \.self) { Text("Chats: \(WaitingQuiet.chatLabel($0))").tag($0) }
                    }.labelsHidden().fixedSize()
                    Picker("Email", selection: Binding(get: { waitingQuiet.emailDays }, set: { days in
                        waitingQuiet.emailDays = days
                        DispatchQueue.global(qos: .userInitiated).async { WaitingQuiet.set(emailDays: days) }
                    })) {
                        ForEach(Array(Set(WaitingQuiet.emailChoices + [waitingQuiet.emailDays])).sorted(), id: \.self) { Text("Email: \(WaitingQuiet.emailLabel($0))").tag($0) }
                    }.labelsHidden().fixedSize()
                }
                .onAppear {
                    DispatchQueue.global(qos: .userInitiated).async {
                        let status = WaitingQuiet.status()
                        let times = DayReviewEngine.times()
                        DispatchQueue.main.async { waitingQuiet = status; reviewTimes = times }
                    }
                }
                row("Day Review", "Off unless you choose a time. In the evening: what Didja ticked for you today (each with Not Done), asks that were answered, what is still open from today, and what is due tomorrow. In the morning: what is due today, what is overdue, and who you are waiting on. Shown in the \(ViewNames.quick) once a day, with one notification; Copy as Markdown puts it on the clipboard.") {
                    reviewPicker("Evening", choices: DayReviewEngine.eveningChoices, current: reviewTimes.evening) { time in
                        reviewTimes.evening = time
                        DispatchQueue.global(qos: .userInitiated).async { DayReviewEngine.setTime("evening", time) }
                    }
                    reviewPicker("Morning", choices: DayReviewEngine.morningChoices, current: reviewTimes.morning) { time in
                        reviewTimes.morning = time
                        DispatchQueue.global(qos: .userInitiated).async { DayReviewEngine.setTime("morning", time) }
                    }
                }
                row("Remind me of my week on Fridays", "One notification on Friday from 16:00: what you finished this week, in the Full View under This Week. Off by default.") {
                    Toggle("", isOn: Binding(get: { weekNudge }, set: { on in
                        weekNudge = on
                        DispatchQueue.global(qos: .userInitiated).async { WeekEngine.setNudge(on) }
                    }))
                    .toggleStyle(.switch).labelsHidden()
                    .onAppear {
                        DispatchQueue.global(qos: .userInitiated).async {
                            let on = WeekEngine.nudgeOn()
                            DispatchQueue.main.async { weekNudge = on }
                        }
                    }
                }
                row("Export all tasks", "Every task to a file you keep, in Markdown or JSON: its title, status, where it came from, dates and why. Tick the box to add the few lines kept with open tasks (screen text). Nothing is sent.") {
                    Toggle("With kept lines", isOn: $exportWithContext).toggleStyle(.checkbox)
                    Menu("Export…") {
                        ForEach(TaskExport.Format.allCases) { format in
                            Button(format.label) { TaskExport.save(format, withContext: exportWithContext) }
                        }
                    }
                    .fixedSize()
                }
            }

            section("Commands") {
                row("Read the exit code of commands you run", "\(ShellHook.explanation) \(ShellHook.words(shellHook))") {
                    Toggle("", isOn: Binding(get: { shellHook.on }, set: { on in
                        ShellHook.set(on)
                        shellHook = ShellHook.status()
                    }))
                    .toggleStyle(.switch).labelsHidden()
                }
            }
            .onAppear { shellHook = ShellHook.status() }

            section("Assistants") {
                ForEach(agentHooks) { tool in
                    row("Let \(tool.name) tell Didja what it ran", AgentHooks.explanation(tool)) {
                        Toggle("", isOn: Binding(get: { tool.on }, set: { on in
                            AgentHooks.set(tool.tool, on)
                            agentHooks = AgentHooks.status()
                        }))
                        .toggleStyle(.switch).labelsHidden()
                    }
                }
            }
            .onAppear { agentHooks = AgentHooks.status() }

            section("Your Own Claude") {
                row("Let my own Claude read Didja", "For fixing how Didja reads an app: Claude Code or Claude Desktop, set up with `\(OwnClaude.command)`, can read the reports you give it, the text Didja kept (masked), and draft an app profile with you. What it reads goes to your AI provider. \(OwnClaude.words(ownClaude))") {
                    Toggle("", isOn: Binding(get: { ownClaude.on }, set: { on in
                        OwnClaude.set(on)
                        ownClaude = OwnClaude.status()
                    }))
                    .toggleStyle(.switch).labelsHidden()
                }
            }
            .onAppear { ownClaude = OwnClaude.status() }

            section("Local Model") {
                row("Use a model in Ollama", localWords) {
                    HStack(spacing: 10) {
                        if local.on, let models = ollamaModels, !models.isEmpty {
                            Picker("", selection: Binding(get: { local.model ?? "" }, set: { name in
                                LocalModel.set(name)
                                local = LocalModel.status()
                            })) {
                                ForEach(models + (local.model.map { models.contains($0) ? [] : [$0] } ?? []), id: \.self) { Text($0).tag($0) }
                            }.labelsHidden().fixedSize()
                        }
                        Toggle("", isOn: Binding(get: { local.on }, set: { on in
                            LocalModel.set(on ? (local.model ?? ollamaModels?.first) : nil)
                            local = LocalModel.status()
                        }))
                        .toggleStyle(.switch).labelsHidden()
                        .disabled(!local.on && (ollamaModels ?? []).isEmpty)
                    }
                }
            }
            .task {
                local = LocalModel.status()
                ollamaModels = await LocalModel.installed()
            }

            section("Look") {
                row("Appearance", "Light, dark, or as the system is set.") {
                    Picker("", selection: $appearance) {
                        ForEach(AppearanceSetting.allCases) { Text($0.label).tag($0) }
                    }.labelsHidden().fixedSize()
                    .onChange(of: appearance) { _, setting in setting.apply() }
                }
            }

            section("Keys") {
                row("Open the \(ViewNames.quick) from anywhere", hotKey.message ?? HotKeyRecording.hint) {
                    KeyChip(text: hotKey.recording ? "Press keys…" : hotKey.shortcut.label)
                    Button(hotKey.recording ? "Cancel" : "Change…") {
                        if hotKey.recording { hotKey.cancel() } else { hotKey.start() }
                    }
                    .buttonStyle(DidjaButtonStyle.secondary)
                    if hotKey.shortcut != .standard && !hotKey.recording {
                        Button("Reset to \(HotKeyShortcut.standard.label)") { hotKey.reset() }
                            .buttonStyle(DidjaButtonStyle.secondary)
                    }
                }
            }
            .onDisappear { hotKey.cancel() }

            section("How Didja Is Doing") {
                VStack(alignment: .leading, spacing: 8) {
                    Text("The last \(QualityReport.days) days\(quality?.countedSince.map { ", \($0)" } ?? ""). These numbers are counted on this Mac and never leave it. `didja quality` prints them, with more detail.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    QualityTable(report: quality)
                }
                .padding(.vertical, 10)
            }
            .task { quality = await Task.detached { QualityReport.load() }.value }

            section("Help") {
                row("How Didja works", "What it reads, what becomes a task, and how tasks tick themselves.") {
                    Button("Open…", action: hub.openWelcome)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("Keys").font(.callout.weight(.medium))
                    Text("\(hotKey.shortcut.label) opens the \(ViewNames.quick) from anywhere. \(KeyboardHints.window)")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 6) {
                    Image("Mark").resizable().frame(width: 16, height: 16).accessibilityHidden(true)
                    Text(AppVersion.current)
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .padding(24)
    }

    /// One width for every menu, so they line up down the page.
    static let controlWidth: CGFloat = 210

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title.uppercased()).font(.caption.weight(.semibold)).foregroundStyle(.secondary).padding(.bottom, 6)
            VStack(alignment: .leading, spacing: 0) { content() }
                .padding(.horizontal, 14)
                .padding(.vertical, 4)
                .background(RoundedRectangle(cornerRadius: 10).fill(Color.primary.opacity(0.04)))
        }
    }

    /// Off, or one of the times (and the time already chosen, if it is not one of them).
    private func reviewPicker(_ label: String, choices: [String], current: String?, set: @escaping (String?) -> Void) -> some View {
        Picker(label, selection: Binding(get: { current ?? "off" }, set: { set($0 == "off" ? nil : $0) })) {
            Text("\(label): Off").tag("off")
            ForEach(Array(Set(choices + (current.map { [$0] } ?? []))).sorted(), id: \.self) { Text("\(label): \($0)").tag($0) }
        }
        .labelsHidden().fixedSize()
    }

    private func row<Control: View>(_ title: String, _ about: String, @ViewBuilder control: () -> Control) -> some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.callout.weight(.medium))
                Text(about).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 12)
            // Every control against the row's right edge, so they line up down the page.
            HStack(spacing: 8) { control() }.frame(minWidth: Self.controlWidth, alignment: .trailing)
        }
        .padding(.vertical, 9)
    }
}
