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
    var openWelcome: () -> Void
    var revealDataFolder: () -> Void

    init(exclude: ExcludeListModel, privacyFacts: @escaping () -> PrivacyFacts, forgetCapturedText: @escaping () -> Void,
         openWelcome: @escaping () -> Void, revealDataFolder: @escaping () -> Void) {
        self.exclude = exclude
        self.privacyFacts = privacyFacts
        self.forgetCapturedText = forgetCapturedText
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
    @ObservedObject private var updates = Updates.shared
    @StateObject private var hotKey = HotKeyRecording()
    @State private var ocrOn = OCRCapture.isEnabled
    @State private var ownClaude = OwnClaude.Status(on: false, calls: 0, last: nil)
    @State private var local = LocalModel.Status(on: false, model: nil)
    /// The models Ollama has, or nil when it is not running.
    @State private var ollamaModels: [String]?

    /// What the local model does, and how it stands on this Mac.
    private var localWords: String {
        let what = "Emails and \"looks done?\" are asked of a model in Ollama, which runs on this Mac (127.0.0.1), before Apple's on-device model. Slower, and it needs memory while it runs. Other decisions stay with Apple's model."
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
                row("Sort", "Group by where tasks came from, or put the latest activity first.") {
                    Picker("", selection: $capture.sort) {
                        ForEach(TaskBoard.Sort.allCases) { Text($0.label).tag($0) }
                    }.labelsHidden().fixedSize()
                }
                row("When a task looks done", "Ask you, or tick it for you (labelled \"auto-accepted\"; reopen it if it was not).") {
                    Picker("", selection: $capture.acceptsLooksDone) {
                        Text("Ask Me").tag(false)
                        Text("Accept Automatically").tag(true)
                    }.labelsHidden().fixedSize()
                }
                row("Older messages", "Take tasks from messages already there when you open a conversation, or only from new ones.") {
                    Picker("", selection: $capture.onlyNewMessages) {
                        Text("From All Messages").tag(false)
                        Text("New Messages Only").tag(true)
                    }.labelsHidden().fixedSize()
                }
                row("Remind me about unfinished checklists", "A notification when a checklist has sat untouched for hours.") {
                    Toggle("", isOn: Binding(get: { nudges }, set: { nudges = $0; Nudger.isEnabled = $0 }))
                        .toggleStyle(.switch).labelsHidden()
                }
            }

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
