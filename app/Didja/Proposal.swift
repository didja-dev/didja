import AppKit
import SwiftUI

/// Propose Upstream… (SCR-42): your version of a job's instructions, as a file for the maintainers,
/// with the corrections you choose to include (none by default: they hold your tasks' wording).
/// It is accepted only if it does better on the eval set with no new wrong ticks
/// (`engine/eval/compare.ts`). Didja sends nothing: you save or copy it.
struct InstructionProposal: Equatable {
    var job: ModelJob
    var builtIn: String
    var proposed: String
    var lessons: [TaughtLesson]
    /// The ids of the corrections you chose to include.
    var included: Set<Int> = []
    var note = ""

    /// A line diff of the built-in instructions against yours: "  same", "- removed", "+ added".
    static func diff(_ old: String, _ new: String) -> [String] {
        let a = old.components(separatedBy: "\n"), b = new.components(separatedBy: "\n")
        var lcs = Array(repeating: Array(repeating: 0, count: b.count + 1), count: a.count + 1)
        for i in stride(from: a.count - 1, through: 0, by: -1) {
            for j in stride(from: b.count - 1, through: 0, by: -1) {
                lcs[i][j] = a[i] == b[j] ? lcs[i + 1][j + 1] + 1 : max(lcs[i + 1][j], lcs[i][j + 1])
            }
        }
        var out: [String] = []
        var i = 0, j = 0
        while i < a.count || j < b.count {
            if i < a.count, j < b.count, a[i] == b[j] { out.append("  " + a[i]); i += 1; j += 1 }
            else if j < b.count, i == a.count || lcs[i][j + 1] >= lcs[i + 1][j] { out.append("+ " + b[j]); j += 1 }
            else { out.append("- " + a[i]); i += 1 }
        }
        return out
    }

    var diffLines: [String] { Self.diff(builtIn, proposed) }

    private struct File: Encodable {
        var kind = "didja-instructions-proposal"
        var job: String
        var note: String
        var builtIn: String
        var proposed: String
        var diff: [String]
        var lessons: [Lesson]
        struct Lesson: Encodable { var kind: String; var example: String }
    }

    /// The file, as it would be shared.
    func json() -> String {
        let file = File(job: job.rawValue, note: note.trimmingCharacters(in: .whitespacesAndNewlines), builtIn: builtIn, proposed: proposed,
                        diff: diffLines, lessons: lessons.filter { included.contains($0.id) }.map { .init(kind: $0.kind, example: $0.example) })
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return String(decoding: (try? encoder.encode(file)) ?? Data(), as: UTF8.self) + "\n"
    }

    var fileName: String { "didja-instructions-\(job.rawValue).json" }

    static func issueURL(job: ModelJob) -> URL? {
        var c = URLComponents(string: "https://github.com/didja-dev/didja/issues/new")
        c?.queryItems = [
            URLQueryItem(name: "title", value: "Instructions: \(job.name)"),
            URLQueryItem(name: "labels", value: "instructions"),
            URLQueryItem(name: "body", value: """
                **What goes wrong with the built-in instructions** (made-up example, please)


                **The proposal:** drag the file you saved here. It is checked against the eval set (engine/eval/compare.ts) and accepted only if it does better with no new wrong ticks.
                """),
        ]
        return c?.url
    }
}

struct ProposalView: View {
    @State var proposal: InstructionProposal
    var close: () -> Void = {}
    /// Off in tests: an offscreen render does not draw a scroll view's content.
    var scrolls = true

    private var diffList: some View {
        VStack(alignment: .leading, spacing: 1) {
            ForEach(Array(proposal.diffLines.enumerated()), id: \.offset) { _, line in
                Text(line).font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(line.hasPrefix("+") ? Palette.done : line.hasPrefix("-") ? Palette.attention : .secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(8)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Propose Upstream: \(proposal.job.name)").font(.title3.weight(.semibold))
            Text("Your version of these instructions, as a file for Didja's maintainers. They try it on made-up examples and take it only if it does better with no new wrong ticks. Your corrections hold your tasks' wording, so none is included unless you tick it. Didja sends nothing: you save the file and attach it to an issue.")
                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Group {
                if scrolls { ScrollView { diffList } } else { diffList.frame(maxHeight: .infinity, alignment: .top) }
            }
            .frame(height: 220)
            .background(RoundedRectangle(cornerRadius: 6).fill(Palette.chip))
            if !proposal.lessons.isEmpty {
                Text("Include corrections (each one's wording goes in the file)").font(.headline)
                ForEach(proposal.lessons) { lesson in
                    Toggle(isOn: Binding(get: { proposal.included.contains(lesson.id) }, set: { on in
                        if on { proposal.included.insert(lesson.id) } else { proposal.included.remove(lesson.id) }
                    })) { Text(lesson.example).font(.callout).fixedSize(horizontal: false, vertical: true) }
                }
            }
            TextField("Why (optional): what goes wrong with the built-in instructions", text: $proposal.note)
            HStack(spacing: 8) {
                Button("Cancel", action: close).buttonStyle(DidjaButtonStyle.secondary)
                Spacer()
                Button("Copy") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(proposal.json(), forType: .string)
                }.buttonStyle(DidjaButtonStyle.secondary)
                Button("Open a GitHub Issue…") {
                    if let url = InstructionProposal.issueURL(job: proposal.job) { NSWorkspace.shared.open(url) }
                }.buttonStyle(DidjaButtonStyle.secondary)
                Button("Save…") {
                    let panel = NSSavePanel()
                    panel.nameFieldStringValue = proposal.fileName
                    panel.allowedContentTypes = [.json]
                    if panel.runModal() == .OK, let url = panel.url { try? proposal.json().write(to: url, atomically: true, encoding: .utf8) }
                }.buttonStyle(DidjaButtonStyle.primary)
            }
        }
        .padding(20)
        .frame(width: 600)
        .background(Palette.surface)
    }
}
