import AppKit
import SwiftUI

/// The on-device model's jobs that can be taught, with their built-in instructions.
enum ModelJob: String, CaseIterable, Identifiable, Codable {
    case lists, titles, emails, chats
    case looksDone = "looks-done"

    var id: String { rawValue }

    var name: String {
        switch self {
        case .lists: return "Who a list is for"
        case .titles: return "Checklist titles"
        case .emails: return "Emails"
        case .chats: return "Chats"
        case .looksDone: return "Looks done"
        }
    }

    var purpose: String {
        switch self {
        case .lists: return "Reads a numbered list from Claude and decides whether it is for you to do, or Claude's own plan or report."
        case .titles: return "Writes a short heading for a checklist whose opening line is too long."
        case .emails: return "Reads the start of an email and says what, if anything, you are asked to do, and who is asking."
        case .chats: return "Reads a chat message and says whether it asks something of you, and what."
        case .looksDone: return "Looks at a later screen that mentions a task and says whether it shows the task done."
        }
    }

    /// What "Not an Action" or "Not Done" teaches this job, for the window's text.
    var taughtBy: String {
        switch self {
        case .lists: return "Taught by \u{201C}Not an Action\u{201D} on a step from Claude."
        case .titles: return "Taught by renaming a checklist."
        case .emails: return "Taught by \u{201C}Not an Action\u{201D} on a task from an email."
        case .chats: return "Taught by \u{201C}Not an Action\u{201D} on a task from a chat."
        case .looksDone: return "Taught by \u{201C}Not Done\u{201D} on a task Didja ticked for you because it looked done."
        }
    }

    var builtIn: String {
        switch self {
        case .lists: return Judge.instructions
        case .titles: return Judge.titleInstructions
        case .emails: return Judge.mailInstructions
        case .chats: return Judge.chatInstructions
        case .looksDone: return Judge.lookInstructions
        }
    }
}

/// A place you showed Didja a step was done (Didja Missed This…): screens there are also shown to
/// the model for that conversation's steps and steps naming the same app.
struct TaughtPlace: Codable, Identifiable, Equatable {
    var id: Int
    var site: String
    var word: String?
    var conversation: String?

    var description: String {
        var reach: [String] = []
        if let conversation { reach.append("steps from \u{201C}\(conversation)\u{201D}") }
        if let word { reach.append("steps that mention \u{201C}\(word)\u{201D}") }
        return "Screens on \(site) are checked for \(reach.isEmpty ? "steps like the one you showed" : reach.joined(separator: " and "))."
    }
}

/// One correction you made, as the engine keeps it.
struct TaughtLesson: Codable, Identifiable, Equatable {
    var id: Int
    var job: ModelJob
    var kind: String
    var example: String
}

/// The teaching window's state: your instructions per job and your corrections.
/// Reads and writes through the engine, which owns them.
/// How eagerly asks become tasks (SCR-95). The engine owns the rule (`meta.capture_level`);
/// ticking is the same at every level.
enum CaptureLevel: String, CaseIterable, Identifiable {
    case strict, balanced, everything

    var id: String { rawValue }

    var label: String {
        switch self {
        case .strict: return "Strict"
        case .balanced: return "Balanced"
        case .everything: return "Everything"
        }
    }

    /// What the level does, and what it changes from Balanced.
    var explanation: String {
        switch self {
        case .strict:
            return "Only asks put to you: a one-to-one message, a group message that names or tags you, and steps an AI tool's own words hand to you. Changes from Balanced: no tasks from group messages asking every member, and no lists the model had to judge (greyed, or \"checking…\")."
        case .balanced:
            return "What Didja has always done: asks put to you, group messages asking every member, and lists the model judges to be yours. Nothing is suggested."
        case .everything:
            return "Balanced, plus a group message that names no one but reads as an ask goes to Suggested, folded under your list. A suggestion is never ticked, never counted and never nudges; Accept makes it a task, and it leaves by itself after 24 hours."
        }
    }
}

final class BrainModel: ObservableObject {
    /// Your saved instructions; a job missing here uses the built-in ones.
    @Published private(set) var saved: [ModelJob: String] = [:]
    /// What is in each text box, saved or not.
    @Published var drafts: [ModelJob: String] = [:]
    @Published private(set) var lessons: [TaughtLesson] = []
    @Published private(set) var places: [TaughtPlace] = []
    @Published private(set) var error: String?
    /// Capture (SCR-95), as the engine has it.
    @Published private(set) var captureLevel: CaptureLevel = .balanced

    private let fetch: () -> String?
    private let run: ([String], String?) -> Bool

    /// `fetch` returns `didja brain show`; `run` runs an engine command with optional input.
    init(fetch: @escaping () -> String? = { EngineRunner.output(["brain", "show"]) },
         run: @escaping ([String], String?) -> Bool = { EngineRunner.run($0, input: $1) }) {
        self.fetch = fetch
        self.run = run
        reload()
    }

    private struct Shown: Decodable {
        var jobs: [String: String?]
        var lessons: [TaughtLesson]
        var places: [TaughtPlace]?
        var captureLevel: String?
    }

    /// Capture: tells the engine, which keeps the choice, then reads it back.
    func setCaptureLevel(_ level: CaptureLevel) {
        guard level != captureLevel else { return }
        if run(["capture-level", level.rawValue], nil) {
            captureLevel = level
        } else {
            error = "Could not change Capture."
        }
    }

    func reload() {
        guard let text = fetch(), let shown = try? JSONDecoder().decode(Shown.self, from: Data(text.utf8)) else {
            error = "Could not read what Didja has been taught."
            return
        }
        var mine: [ModelJob: String] = [:]
        for (key, value) in shown.jobs {
            if let job = ModelJob(rawValue: key), let value { mine[job] = value }
        }
        saved = mine
        lessons = shown.lessons
        places = shown.places ?? []
        captureLevel = shown.captureLevel.flatMap(CaptureLevel.init(rawValue:)) ?? .balanced
        drafts = Dictionary(uniqueKeysWithValues: ModelJob.allCases.map { ($0, mine[$0] ?? $0.builtIn) })
        error = nil
    }

    func isCustom(_ job: ModelJob) -> Bool { saved[job] != nil }

    /// The text box differs from what is in use.
    func isEdited(_ job: ModelJob) -> Bool {
        (drafts[job] ?? "") != (saved[job] ?? job.builtIn)
    }

    func lessons(for job: ModelJob) -> [TaughtLesson] { lessons.filter { $0.job == job } }

    /// Propose Upstream…: your saved version against the built-in one.
    func proposal(for job: ModelJob) -> InstructionProposal {
        InstructionProposal(job: job, builtIn: job.builtIn, proposed: saved[job] ?? job.builtIn, lessons: lessons(for: job))
    }

    func save(_ job: ModelJob) {
        let text = drafts[job] ?? ""
        // Saving the built-in text unchanged is the same as using the built-in text.
        let ok = text.trimmingCharacters(in: .whitespacesAndNewlines) == job.builtIn
            ? run(["brain", "reset", job.rawValue], nil)
            : run(["brain", "set", job.rawValue], text)
        if !ok { error = "Could not save the instructions for \u{201C}\(job.name)\u{201D}." }
        reload()
    }

    func reset(_ job: ModelJob) {
        if !run(["brain", "reset", job.rawValue], nil) { error = "Could not reset \u{201C}\(job.name)\u{201D}." }
        reload()
    }

    func forget(_ place: TaughtPlace) {
        if !run(["missed", "forget", String(place.id)], nil) { error = "Could not forget that place." }
        reload()
    }

    func forget(_ lesson: TaughtLesson) {
        if !run(["brain", "forget", String(lesson.id)], nil) { error = "Could not forget that correction." }
        reload()
    }
}

/// "How Didja Decides": the model's instructions in plain text, yours to read,
/// copy, replace and reset, and the corrections you have taught it.
struct BrainView: View {
    static let width: CGFloat = 640
    @ObservedObject var model: BrainModel

    var body: some View {
        ScrollView { BrainContent(model: model) }
            .frame(width: Self.width)
            .frame(minHeight: 360, maxHeight: .infinity, alignment: .top)
            .background(Palette.surface)
    }
}

/// The window's content without its scrolling, so tests can draw it.
struct BrainContent: View {
    @ObservedObject var model: BrainModel
    @State private var explaining = false
    @State private var proposing: ModelJob?

    static let explainer = """
        What this is. Some decisions are made by Apple's on-device model. Before each question it reads a short set of instructions in plain English. Each block below is one job's instructions.

        Changing them. Edit the text and press Save, or copy it, ask any AI to improve it for your needs, and paste the result back with Paste & Replace. What you save replaces the built-in text for that job only. Reset brings the built-in text back. Keep it short (it is cut at 4,000 characters) and keep the answers it asks for the same: for example, for emails the model must still say reply, action or none.

        Corrections. When you use Not an Action or Not Done, the case is remembered and shown to the model with every later question, under your instructions. A step you marked Not an Action is also never captured again. Remove a correction with ×.

        Privacy. Copy puts only the instructions on the clipboard, never your corrections, which hold your tasks' wording. Pasting into another AI sends that text to it; that is your choice, and Didja itself still sends nothing anywhere.

        Propose upstream. When your version works better, Propose Upstream… makes a file for Didja's maintainers: the change against the built-in text, and only the corrections you tick. They try it on made-up examples and take it if it does better with no new wrong ticks.

        Places. When you show Didja where you did a step it missed (Didja Missed This…), it remembers the site: screens there are then also shown to the model for that conversation's steps and steps that name the same app. They are listed under Looks done; remove one with ×.

        Careful. Instructions that make "looks done" answer done more easily mean more suggestions, and more tasks ticked if you accept them automatically.
        """

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Image(systemName: "brain").font(.system(size: 20)).foregroundStyle(Palette.accent)
                    Text("How Didja Decides").font(.title2.weight(.semibold))
                    Button { explaining.toggle() } label: { Image(systemName: "questionmark.circle") }
                        .buttonStyle(.plain)
                        .foregroundStyle(.secondary)
                        .help("What this is and how to change it")
                        .popover(isPresented: $explaining, arrowEdge: .bottom) {
                            ScrollView {
                                Text(Self.explainer).font(.callout).padding(16).frame(width: 380, alignment: .leading)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .frame(height: 360)
                        }
                }
                Text("The instructions Apple's on-device model reads for each of its jobs, and what you have taught it. Read them, change them, or paste in a version another AI improved.")
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if let error = model.error {
                    Text(error).font(.callout).foregroundStyle(Palette.attention)
                }
            }
            captureSection
            ForEach(ModelJob.allCases) { job in
                jobSection(job)
            }
        }
        .padding(24)
        .frame(width: BrainView.width)
        .background(Palette.surface)
        .sheet(item: $proposing) { job in
            ProposalView(proposal: model.proposal(for: job), close: { proposing = nil })
        }
    }

    /// Capture (SCR-95): how eagerly asks become tasks, each level explained in place.
    private var captureSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("Capture").font(.headline)
                Spacer()
                Picker("", selection: Binding(get: { model.captureLevel }, set: { model.setCaptureLevel($0) })) {
                    ForEach(CaptureLevel.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .fixedSize()
            }
            Text("How eagerly asks become tasks. Ticking is the same at every level.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            ForEach(CaptureLevel.allCases) { level in
                (Text(level.label).fontWeight(level == model.captureLevel ? .semibold : .medium)
                    + Text(level == model.captureLevel ? " (on)" : "") + Text(" — ") + Text(level.explanation).foregroundColor(.secondary))
                    .font(.callout)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func jobSection(_ job: ModelJob) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(job.name).font(.headline)
                Text(model.isCustom(job) ? "your version" : "built in")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(model.isCustom(job) ? Palette.accentText : .secondary)
                    .padding(.horizontal, 6).padding(.vertical, 1)
                    .overlay(Capsule().stroke((model.isCustom(job) ? Palette.accent : Color.secondary).opacity(0.35), lineWidth: 1))
                Spacer()
            }
            Text(job.purpose).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            TextEditor(text: Binding(get: { model.drafts[job] ?? "" }, set: { model.drafts[job] = $0 }))
                .font(.callout)
                .frame(height: 130)
                .scrollContentBackground(.hidden)
                .padding(6)
                .background(RoundedRectangle(cornerRadius: 6).fill(Palette.chip))
            HStack(spacing: 8) {
                Button("Copy") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(model.drafts[job] ?? "", forType: .string)
                }
                Button("Paste & Replace") {
                    if let text = NSPasteboard.general.string(forType: .string) { model.drafts[job] = text }
                }
                Button("Save") { model.save(job) }
                    .disabled(!model.isEdited(job))
                Button("Reset to Built-in") { model.reset(job) }
                    .disabled(!model.isCustom(job) && !model.isEdited(job))
                if model.isCustom(job) {
                    Button("Propose Upstream…") { proposing = job }
                        .help("Make a file proposing your version to Didja's maintainers")
                }
            }
            .buttonStyle(DidjaButtonStyle.secondary)
            Text(job.taughtBy).font(.caption).foregroundStyle(.tertiary)
            if job == .looksDone {
                Text("Places you showed it (Didja Missed This…): screens there are also shown to the model for steps like the one you showed. It still has to see each step done there.")
                    .font(.caption).foregroundStyle(.tertiary).fixedSize(horizontal: false, vertical: true)
                ForEach(model.places) { place in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(place.description).font(.callout).fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 8)
                        Button { model.forget(place) } label: { Image(systemName: "xmark") }
                            .buttonStyle(.plain).foregroundStyle(.secondary)
                            .help("Forget this place: its screens are no longer checked for these steps")
                    }
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Palette.chip))
                }
            }
            ForEach(model.lessons(for: job)) { lesson in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(lesson.example).font(.callout).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 8)
                    Button { model.forget(lesson) } label: { Image(systemName: "xmark") }
                        .buttonStyle(.plain).foregroundStyle(.secondary)
                        .help("Forget this correction")
                }
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(RoundedRectangle(cornerRadius: 6).fill(Palette.chip))
            }
        }
    }
}
