import AppKit
import SwiftUI

/// Didja Missed This…: you did a task and Didja did not notice. Here you show it where: pick the
/// place, then the screen that shows it done. Those are your own screens, shown as they are; they
/// stay on this Mac. Optionally, let your own Claude help, or report it (masked).
final class MissedModel: ObservableObject {
    let missed: DiagnosticsReport.Missed
    let report: DiagnosticsModel
    @Published var site: String
    @Published private(set) var outcome: String?
    @Published private(set) var claude: OwnClaude.Status
    @Published private(set) var stage: OwnClaude.Stage
    private let run: ([String]) -> String?
    private let claudeStatus: () -> OwnClaude.Status
    private let inDesktop: () -> Bool

    init(_ missed: DiagnosticsReport.Missed, run: @escaping ([String]) -> String? = { EngineRunner.output($0) },
         claudeStatus: @escaping () -> OwnClaude.Status = { OwnClaude.status() },
         inDesktop: @escaping () -> Bool = { OwnClaude.added() }) {
        self.missed = missed
        self.report = DiagnosticsModel(DiagnosticsReport.missed(missed))
        self.site = missed.places.first?.site ?? ""
        self.run = run
        self.claudeStatus = claudeStatus
        self.inDesktop = inDesktop
        let status = claudeStatus()
        self.claude = status
        self.stage = OwnClaude.stage(status, inDesktop: inDesktop(), pending: OwnClaude.isPending)
    }

    var place: DiagnosticsReport.Missed.Place? { missed.places.first { $0.site == site } }
    var isDone: Bool { outcome != nil }

    private struct Answer: Decodable { var site: String?; var suggested: Int? }

    private func said(_ json: String?, ticked: Bool) {
        let answer = json.flatMap { try? JSONDecoder().decode(Answer.self, from: Data($0.utf8)) }
        let more = answer?.suggested ?? 0
        let also = more > 0 ? " \(more) more \(more == 1 ? "step looks" : "steps look") done there: check the list." : ""
        outcome = (ticked ? "Ticked. " : "") + "Didja will look on \(site) for steps like it from now on.\(also)"
    }

    /// This screen shows it done: tick it, with the screen as evidence, and remember the site.
    func doneAt(_ screen: DiagnosticsReport.Missed.Screen) {
        said(run(["missed", String(missed.id), "--done-at", String(screen.id)]), ticked: true)
    }

    /// Only remember the site, without ticking (when no screen shows it).
    func rememberSite() {
        said(run(["missed", String(missed.id), "--learn", site]), ticked: false)
    }

    /// What remembering the chosen place would change, in this task's own terms (shown before you
    /// choose, so you know what you are changing).
    struct Effect: Equatable {
        /// How Didja decides today, and why this place was not looked at.
        var today: String
        /// What remembering it changes.
        var after: String
        /// When it is a good idea, and when not.
        var advice: String
    }

    var effect: Effect {
        let words = (missed.keywords ?? []).prefix(6).joined(separator: ", ")
        let screens = place?.screens ?? 0
        let today = place?.watched == true
            ? "This step has nothing exact to look for, so Didja shows Apple's on-device model screens from places the step names. \(site) is already one of them: its screens are being checked."
            : "This step has nothing exact to look for (no command, address or file), so Didja shows Apple's on-device model only screens from apps and sites whose name contains one of its words (\(words.isEmpty ? "it has none" : words)). \(site) does not, so its \(screens) \(screens == 1 ? "screen was" : "screens were") never checked."
        let others = missed.openInConversation ?? 0
        var reach: [String] = []
        if others > 0 { reach.append("the \(others) other open \(others == 1 ? "step" : "steps") from \u{201C}\(missed.conversation ?? missed.source)\u{201D}") }
        else { reach.append("new steps from \u{201C}\(missed.conversation ?? missed.source)\u{201D}") }
        if let word = place?.word { reach.append("any step that mentions \u{201C}\(word)\u{201D} (from the site's addresses or the conversation's name)") }
        let outcome = missed.acceptsLooksDone == true
            ? "When the model sees one done there, it is ticked for you (Looks Done is set to Accept Automatically)."
            : "When the model sees one done there, you get \u{201C}looks done?\u{201D} to confirm; nothing is ticked without you."
        let after = "Remembering \(site): new screens there are also shown to the model for \(reach.joined(separator: " and ")). \(outcome) Nothing else changes, and you can forget it in How It Decides › Looks done."
        let advice = "Good if you do these steps on \(site). Not if it is unrelated (mail, chat): Didja would ask the model about these steps on every new screen there, which means more \u{201C}looks done?\u{201D} questions and more wrong ones."
        return Effect(today: today, after: after, advice: advice)
    }

    /// What to paste into your Claude.
    var prompt: String {
        "Didja (my to-do app) missed that I finished task #\(missed.id). Using the didja MCP tools, call missed_report for task \(missed.id) and help me work out why it was not noticed, and where I did it."
    }

    func refreshClaude() {
        claude = claudeStatus()
        stage = OwnClaude.stage(claude, inDesktop: inDesktop(), pending: OwnClaude.isPending)
    }
}

struct MissedView: View {
    static let width: CGFloat = 780
    @ObservedObject var model: MissedModel
    var save: (String) -> Void = { _ in }
    var copy: (String) -> Void = { _ in }
    var openIssue: () -> Void = {}
    var giveToClaude: (String) -> Void = { _ in }
    var setUpClaude: () -> Void = {}
    var addToDesktop: () -> Void = {}
    var askClaude: (String) -> Void = { _ in }
    /// Off in tests: an offscreen render does not draw a scroll view's content.
    var scrolls = true
    @State private var reporting = false

    private func when(_ iso: String) -> String {
        guard let date = ISO8601DateFormatter.withFraction.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return "" }
        return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
    }

    private func step(_ n: Int, _ title: String) -> some View {
        HStack(spacing: 8) {
            Text("\(n)").font(.caption.weight(.bold)).foregroundStyle(Palette.accentText)
                .frame(width: 18, height: 18).background(Circle().fill(Palette.selection))
            Text(title).font(.headline)
        }
    }

    private var screens: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let place = model.place, !place.screensKept.isEmpty {
                ForEach(place.screensKept) { screen in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("\(when(screen.ts)) · \(screen.window)").font(.caption.weight(.medium)).foregroundStyle(.secondary).lineLimit(1)
                            Spacer()
                            Button("This Shows It Done") { model.doneAt(screen) }
                                .buttonStyle(DidjaButtonStyle(kind: .secondary, size: .small))
                                .disabled(model.isDone)
                        }
                        Text(screen.lines.prefix(10).joined(separator: "\n") + (screen.lines.count > 10 ? "\n…" : ""))
                            .font(.system(size: 11, design: .monospaced))
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Palette.chip))
                }
            } else {
                Text("Didja kept nothing from there since you got this task.").foregroundStyle(.secondary)
            }
        }
    }

    var body: some View {
        // The whole window scrolls: what it says grows (after This Shows It Done, the report opened).
        Group {
            if scrolls { ScrollView { content } } else { content }
        }
        .frame(width: Self.width)
        .frame(minHeight: 420, maxHeight: .infinity, alignment: .top)
        .background(Palette.surface)
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Image(systemName: "ladybug").font(.system(size: 18)).foregroundStyle(Palette.accent)
                    Text("Didja Missed This").font(.title3.weight(.semibold))
                }
                Text(model.missed.title).fixedSize(horizontal: false, vertical: true)
                Text("Show Didja where you did it: pick the place, then the screen that shows it done (that ticks this step and remembers the place), or only remember the place. These are your own screens, as Didja kept them; they stay on this Mac.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }

            step(1, "Where did you do it?")
            HStack(spacing: 8) {
                Picker("", selection: $model.site) {
                    ForEach(model.missed.places, id: \.site) { place in
                        Text("\(place.app) — \(place.site) (\(place.screens))").tag(place.site)
                    }
                }
                .labelsHidden().fixedSize()
                Button("Remember This Place") { model.rememberSite() }
                    .buttonStyle(DidjaButtonStyle.secondary).disabled(model.isDone || model.site.isEmpty)
                    .help("Without ticking this step: look here for steps like it from now on (what that means is below)")
            }
            VStack(alignment: .leading, spacing: 4) {
                let effect = model.effect
                Text(effect.today)
                Text(effect.after)
                Text(effect.advice).foregroundStyle(.secondary)
            }
            .font(.callout)
            .fixedSize(horizontal: false, vertical: true)
            .padding(10)
            .background(RoundedRectangle(cornerRadius: 6).stroke(Palette.chip, lineWidth: 1))

            step(2, "Which screen shows it done?")
            if let outcome = model.outcome {
                Label(outcome, systemImage: "checkmark.circle.fill").foregroundStyle(Palette.done).fixedSize(horizontal: false, vertical: true)
            }
            screens

            step(3, "Let your Claude help (optional)")
            switch model.stage {
            case .connected:
                HStack(spacing: 8) {
                    Text("Claude Desktop opens on a new chat with the question filled in (in Claude Code, paste it: it is copied too), and reads this task masked through didja mcp.")
                        .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    Spacer()
                    Button("Give It the Report Too") { giveToClaude(model.report.report.text()) }.buttonStyle(DidjaButtonStyle.secondary)
                        .help("Also save the masked report where Claude can read it, with the lines you chose to show")
                    Button("Ask Claude About This") { askClaude(model.prompt) }.buttonStyle(DidjaButtonStyle.primary)
                }
            case .notAdded:
                HStack(spacing: 8) {
                    Text("Claude is allowed to read Didja, but does not know about it yet: add Didja to Claude Desktop (then restart Claude), or to Claude Code.")
                        .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    Spacer()
                    Button("Copy for Claude Code") { copy(OwnClaude.command) }.buttonStyle(DidjaButtonStyle.secondary)
                    Button("Add Didja to Claude Desktop…", action: addToDesktop).buttonStyle(DidjaButtonStyle.primary)
                }
            case .waitingForQuit:
                HStack(spacing: 8) {
                    Text("Didja will add itself to Claude Desktop the next time you quit it; Claude reads it when it opens again. Or use Claude Code now.")
                        .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    Spacer()
                    Button("Copy for Claude Code") { copy(OwnClaude.command) }.buttonStyle(DidjaButtonStyle.secondary)
                }
            case .off:
                HStack(spacing: 8) {
                    Text("Your own Claude (Claude Code or Claude Desktop) can look at this with you and work out why it was missed. It is not set up yet.")
                        .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    Spacer()
                    Button("Set Up Claude…", action: setUpClaude).buttonStyle(DidjaButtonStyle.secondary)
                }
            }

            DisclosureGroup(isExpanded: $reporting) {
                VStack(alignment: .leading, spacing: 8) {
                    MaskedLinesView(model: model.report, scrolls: scrolls).frame(height: scrolls ? 260 : nil)
                    ReportButtons(model: model.report, save: save, copy: copy, openIssue: openIssue)
                }
                .padding(.top, 6)
            } label: {
                Text("Report it to Didja's makers (optional)").font(.headline)
            }
        }
        .padding(20)
    }
}

extension ISO8601DateFormatter {
    static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}
