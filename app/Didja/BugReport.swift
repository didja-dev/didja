import AppKit
import SwiftUI

/// Report a Bug… (SCR-51): you describe what went wrong, and Didja opens a new issue on GitHub in
/// your browser, filled in with what you wrote and, if you leave it on, Didja's and macOS's
/// versions. You read it and submit it there; Didja sends nothing itself. For an app Didja misreads,
/// Report a Problem with This Window… adds a masked file of how it sees the window.
struct BugReport: Equatable {
    var title = ""
    var happened = ""
    var steps = ""
    var expected = ""
    var includeVersions = true

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

    /// Ready to open: it has a title and says what happened.
    var isReady: Bool { !Self.trimmed(title).isEmpty && !Self.trimmed(happened).isEmpty }

    /// The issue's text, in Markdown. Sections left empty are left out.
    func body(versions: String = BugReport.versions) -> String {
        var parts = ["**What happened**\n\(Self.trimmed(happened))"]
        if !Self.trimmed(steps).isEmpty { parts.append("**Steps to make it happen**\n\(Self.trimmed(steps))") }
        if !Self.trimmed(expected).isEmpty { parts.append("**What you expected**\n\(Self.trimmed(expected))") }
        if includeVersions { parts.append("**Version**\n\(versions)") }
        parts.append("_Sent from Report a Bug… in Didja. The repository is public._")
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
            URLQueryItem(name: "labels", value: "bug"),
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
    @State var report = BugReport()
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
                Image(systemName: "ladybug").font(.system(size: 18)).foregroundStyle(Palette.accent)
                Text("Report a Bug").font(.title3.weight(.semibold))
            }
            Text("Say what went wrong. Didja opens a new issue on GitHub in your browser, filled in with this; you read it and submit it there (you need a GitHub account). Didja sends nothing itself.")
                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 4) {
                Text("Title").font(.callout.weight(.medium))
                TextField("The list stops updating after the Mac wakes", text: $report.title).textFieldStyle(.roundedBorder)
            }
            field("What happened", "What you saw, and when.", $report.happened, height: 90)
            field("Steps to make it happen (optional)", "1. …", $report.steps, height: 64)
            field("What you expected (optional)", "", $report.expected, height: 44)
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
                Button("Didja Misreads an App?", action: reportWindow).buttonStyle(.link)
                    .help("Report a Problem with This Window… adds a masked file of how Didja sees that window")
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
