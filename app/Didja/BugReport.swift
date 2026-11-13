import AppKit
import SwiftUI

/// Report a Bug… (SCR-51): you describe what went wrong, and Didja opens a new issue on GitHub in
/// your browser, filled in with what you wrote and, if you leave it on, Didja's and macOS's
/// versions. You read it and submit it there; Didja sends nothing itself. For an app Didja misreads,
/// Report a Problem with This Window… adds a masked file of how it sees the window.
/// Suggest a Feature… (SCR-52) is the same form for an idea: what you would like, and why.
struct BugReport: Equatable {
    enum Kind: Equatable {
        case bug, feature

        var name: String { self == .bug ? "Report a Bug" : "Suggest a Feature" }
        var symbol: String { self == .bug ? "ladybug" : "lightbulb" }
        var label: String { self == .bug ? "bug" : "enhancement" }
        /// The three fields' names in the form and in the issue; the third is not asked for an idea.
        var sections: (first: String, second: String, third: String?) {
            self == .bug ? ("What happened", "Steps to make it happen", "What you expected")
                         : ("What you would like Didja to do", "What it would help with", nil)
        }
        var titleHint: String { self == .bug ? "The list stops updating after the Mac wakes" : "Group tasks by project" }
        var firstHint: String { self == .bug ? "What you saw, and when." : "What it would do, as you picture it." }
        var secondHint: String { self == .bug ? "1. …" : "When you would use it." }
        var intro: String {
            self == .bug
                ? "Say what went wrong. Didja opens a new issue on GitHub in your browser, filled in with this; you read it and submit it there (you need a GitHub account). Didja sends nothing itself."
                : "Say what you would like Didja to do. Didja opens a new issue on GitHub in your browser, filled in with this; you read it and submit it there (you need a GitHub account). Didja sends nothing itself."
        }
    }

    var kind = Kind.bug
    var title = ""
    var happened = ""
    var steps = ""
    var expected = ""
    var includeVersions = true

    init(_ kind: Kind = .bug) {
        self.kind = kind
        // The versions help with a bug; an idea does not need them unless you add them.
        includeVersions = kind == .bug
    }

    static let newIssue = "https://github.com/didja-dev/didja/issues/new"
    /// Longer links are cut off by browsers or refused by GitHub; past this the body goes on the
    /// clipboard and the link carries a line asking you to paste it.
    static let maxLink = 7000

    /// "Didja 0.4.1 (5) on macOS 26.1".
    static var versions: String {
        let os = ProcessInfo.processInfo.operatingSystemVersion
        return "\(AppVersion.current) on macOS \(os.majorVersion).\(os.minorVersion)"
    }

    private static func trimmed(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// Ready to open: it has a title and its first field (what happened, or what you would like).
    var isReady: Bool { !Self.trimmed(title).isEmpty && !Self.trimmed(happened).isEmpty }

    /// The issue's text, in Markdown. Sections left empty are left out.
    func body(versions: String = BugReport.versions) -> String {
        let names = kind.sections
        var parts = ["**\(names.first)**\n\(Self.trimmed(happened))"]
        if !Self.trimmed(steps).isEmpty { parts.append("**\(names.second)**\n\(Self.trimmed(steps))") }
        if let third = names.third, !Self.trimmed(expected).isEmpty { parts.append("**\(third)**\n\(Self.trimmed(expected))") }
        if includeVersions { parts.append("**Version**\n\(versions)") }
        parts.append("_Sent from \(kind.name)… in Didja. The repository is public._")
        return parts.joined(separator: "\n\n") + "\n"
    }

    /// The link that opens the issue filled in, and whether the body did not fit in it
    /// (then it must be pasted from the clipboard).
    func issueLink(versions: String = BugReport.versions) -> (url: URL, mustPaste: Bool)? {
        let full = link(body(versions: versions))
        if let full, full.absoluteString.count <= Self.maxLink { return (full, false) }
        let short = link("_The description was too long for a link: paste it here (it is on your clipboard)._\n")
        return short.map { ($0, true) }
    }

    private func link(_ body: String) -> URL? {
        var c = URLComponents(string: Self.newIssue)
        c?.queryItems = [
            URLQueryItem(name: "title", value: Self.trimmed(title)),
            URLQueryItem(name: "labels", value: kind.label),
            URLQueryItem(name: "body", value: body),
        ]
        return c?.url
    }

    /// What in the text looks personal, said as a caution: the issue is public.
    var cautions: [String] {
        let text = [title, happened, steps, expected].joined(separator: "\n")
        var found: [String] = []
        if text.range(of: #"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"#, options: .regularExpression) != nil {
            found.append("an email address")
        }
        if text.range(of: #"\+?\d[\d \-()]{7,}\d"#, options: .regularExpression) != nil {
            found.append("a phone number or a long number")
        }
        if text.range(of: #"https?://[^\s/]+/\S+"#, options: .regularExpression) != nil {
            found.append("a link with a path")
        }
        return found
    }
}

struct BugReportView: View {
    static let width: CGFloat = 560
    @State var report: BugReport
    var open: (BugReport) -> Void = { _ in }
    var copy: (String) -> Void = { _ in }
    var reportWindow: () -> Void = {}

    private func field(_ label: String, _ hint: String, _ text: Binding<String>, height: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.callout.weight(.medium))
            TextEditor(text: text)
                .font(.body)
                .scrollContentBackground(.hidden)
                .padding(6)
                .frame(height: height)
                .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.04)))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.secondary.opacity(0.3)))
                .overlay(alignment: .topLeading) {
                    if text.wrappedValue.isEmpty {
                        Text(hint).foregroundStyle(.tertiary).padding(.horizontal, 11).padding(.vertical, 6).allowsHitTesting(false)
                    }
                }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: report.kind.symbol).font(.system(size: 18)).foregroundStyle(Palette.accent)
                Text(report.kind.name).font(.title3.weight(.semibold))
            }
            Text(report.kind.intro)
                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 4) {
                Text("Title").font(.callout.weight(.medium))
                TextField(report.kind.titleHint, text: $report.title).textFieldStyle(.roundedBorder)
            }
            field(report.kind.sections.first, report.kind.firstHint, $report.happened, height: 90)
            field("\(report.kind.sections.second) (optional)", report.kind.secondHint, $report.steps, height: 64)
            if let third = report.kind.sections.third {
                field("\(third) (optional)", "", $report.expected, height: 44)
            }
            Toggle("Include Didja's and macOS's versions (\(BugReport.versions))", isOn: $report.includeVersions)
            Label("The issue is public. Use made-up examples: no real names, messages, email subjects or addresses.",
                  systemImage: "eye")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if !report.cautions.isEmpty {
                Label("It looks like there is \(report.cautions.joined(separator: ", ")) in what you wrote. Take it out unless you mean it to be public.",
                      systemImage: "exclamationmark.triangle")
                    .font(.callout).foregroundStyle(Palette.attention).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 8) {
                if report.kind == .bug {
                    Button("Didja Misreads an App?", action: reportWindow).buttonStyle(.link)
                        .help("Report a Problem with This Window… adds a masked file of how Didja sees that window")
                }
                Spacer()
                Button("Copy") { copy("# \(report.title)\n\n" + report.body()) }.buttonStyle(DidjaButtonStyle.secondary)
                    .disabled(!report.isReady)
                Button("Open on GitHub…") { open(report) }.buttonStyle(DidjaButtonStyle.primary)
                    .disabled(!report.isReady)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: Self.width, alignment: .topLeading)
        .background(Palette.surface)
    }
}
