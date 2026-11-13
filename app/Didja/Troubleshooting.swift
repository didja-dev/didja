import AppKit
import ApplicationServices
import SwiftUI

/// Help › Troubleshooting Report… (SCR-79): why Didja reads nothing, or reads but makes no tasks,
/// in plain words first and then counts and codes (`didja doctor`). No screen text, window titles
/// or task words. Didja never sends it: you copy it, save it, open it as an email in your own mail
/// app, or open a GitHub issue filled in with it, and send it yourself.
struct TroubleshootingReport: Equatable {
    var findings: [String]
    /// The whole report, as `didja doctor` prints it.
    var text: String

    static let email = "hello@didja.dev"
    static let subject = "Didja troubleshooting report"
    static let issueTitle = "Troubleshooting: Didja reads nothing or makes no tasks"

    /// The report from the bundled engine, or nil if it could not be run.
    static func fromEngine() -> TroubleshootingReport? {
        guard let text = EngineRunner.output(["doctor"]) else { return nil }
        struct Findings: Decodable { var findings: [String] }
        let json = EngineRunner.output(["doctor", "--json"]).flatMap { try? JSONDecoder().decode(Findings.self, from: Data($0.utf8)) }
        return TroubleshootingReport(findings: json?.findings ?? [], text: text)
    }

    /// A new email to Didja in your mail app, with the report as its body. You send it.
    var mailLink: URL? {
        var c = URLComponents()
        c.scheme = "mailto"
        c.path = Self.email
        c.queryItems = [URLQueryItem(name: "subject", value: Self.subject), URLQueryItem(name: "body", value: text)]
        return c.url
    }

    /// A new GitHub issue filled in with the report, and whether it was too long for the link
    /// (then the report goes on the clipboard and the issue asks you to paste it).
    var issueLink: (url: URL, mustPaste: Bool)? {
        func link(_ body: String) -> URL? {
            var c = URLComponents(string: BugReport.newIssue)
            c?.queryItems = [
                URLQueryItem(name: "title", value: Self.issueTitle),
                URLQueryItem(name: "labels", value: "bug"),
                URLQueryItem(name: "body", value: body),
            ]
            return c?.url
        }
        let note = "_From Help › Troubleshooting Report… in Didja: counts and codes only. The repository is public._\n"
        if let full = link("```\n\(text)```\n\n" + note), full.absoluteString.count <= BugReport.maxLink { return (full, false) }
        return link("_The report was too long for a link: paste it here (it is on your clipboard)._\n\n" + note).map { ($0, true) }
    }

    /// "didja-troubleshooting-2026-11-13.txt".
    func fileName(now: Date = Date()) -> String {
        let day = ISO8601DateFormatter.string(from: now, timeZone: .current, formatOptions: [.withFullDate])
        return "didja-troubleshooting-\(day).txt"
    }

    /// Whether the Quick View should point to this report: capture can't read (Accessibility off, or
    /// it failed), or it has read nothing for two minutes since it started. Paused is your choice.
    static func shouldOffer(status: CaptureCoordinator.Status, observations: Int, capturingFor: TimeInterval) -> Bool {
        switch status {
        case .needsAccessibility, .failed: return true
        case .capturing: return observations == 0 && capturingFor >= 120
        case .paused, .starting: return false
        }
    }
    static let offerTitle = "Didja isn't reading anything yet: Troubleshoot…"
}

/// What the app knows that the engine can't (SCR-79), written to `meta.app_facts` for `didja doctor`.
struct AppFacts: Codable, Equatable {
    var version: String
    var macOS: String
    var chip: String
    var appPath: String
    var debug: Bool
    var accessibility: Bool
    var screenRecording: Bool
    var trustedPath: String?
    var modelAvailable: Bool
    var modelStatus: String
    var excluded: Excluded
    var at: String

    struct Excluded: Codable, Equatable { var apps: Int; var titles: Int; var sites: Int }

    /// Where the app was the last time Accessibility was seen allowed: if it moves, macOS stops
    /// trusting it, and the report says so.
    static let trustedPathKey = "accessibilityTrustedPath"

    static func current(excluded: Excluded, screenRecording: Bool, modelStatus: String, defaults: UserDefaults = .standard) -> AppFacts {
        let trusted = AXIsProcessTrusted()
        let path = Bundle.main.bundlePath
        if trusted { defaults.set(path, forKey: trustedPathKey) }
        let os = ProcessInfo.processInfo.operatingSystemVersion
        #if arch(arm64)
        let chip = "Apple silicon"
        #else
        let chip = "Intel"
        #endif
        #if DEBUG
        let debug = true
        #else
        let debug = false
        #endif
        return AppFacts(
            version: AppVersion.current, macOS: "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)", chip: chip,
            appPath: path, debug: debug, accessibility: trusted, screenRecording: screenRecording,
            trustedPath: defaults.string(forKey: trustedPathKey), modelAvailable: modelStatus == "Available",
            modelStatus: modelStatus, excluded: excluded,
            at: ISO8601DateFormatter().string(from: Date()))
    }

    var json: String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return (try? encoder.encode(self)).map { String(decoding: $0, as: UTF8.self) } ?? "{}"
    }
}

struct TroubleshootingView: View {
    static let width: CGFloat = 600
    var report: TroubleshootingReport
    var copy: (String) -> Void = { _ in }
    var save: (String) -> Void = { _ in }
    var email: () -> Void = {}
    var openIssue: () -> Void = {}
    /// False in the render test: ImageRenderer draws a scroll view's content blank.
    var scrolls = true

    private var reportText: some View {
        Text(report.text)
            .font(.system(size: 11, design: .monospaced))
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .padding(8)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "stethoscope").font(.system(size: 18)).foregroundStyle(Palette.accent)
                Text("Troubleshooting Report").font(.title3.weight(.semibold))
            }
            Text("Why Didja reads nothing, or reads but makes no tasks. Counts and codes only: no screen text, window titles or task words. Didja sends nothing; if you want help, send it yourself.")
                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 6) {
                Text("What Didja found").font(.callout.weight(.medium))
                if report.findings.isEmpty {
                    Label("Nothing looks wrong.", systemImage: "checkmark.circle").foregroundStyle(Palette.done)
                } else {
                    ForEach(Array(report.findings.enumerated()), id: \.offset) { _, finding in
                        Label { Text(finding).fixedSize(horizontal: false, vertical: true) } icon: {
                            Image(systemName: "exclamationmark.triangle").foregroundStyle(Palette.attention)
                        }
                    }
                }
            }
            Group {
                if scrolls { ScrollView { reportText } } else { reportText }
            }
            .frame(minHeight: 160, maxHeight: .infinity, alignment: .top)
            .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.04)))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.secondary.opacity(0.3)))
            HStack(spacing: 8) {
                Button("Copy") { copy(report.text) }.buttonStyle(DidjaButtonStyle.secondary)
                Button("Save…") { save(report.text) }.buttonStyle(DidjaButtonStyle.secondary)
                Spacer()
                Button("Email to Didja…", action: email).buttonStyle(DidjaButtonStyle.secondary)
                    .help("Opens a new email to \(TroubleshootingReport.email) in your mail app, with this report. You send it.")
                Button("Open a GitHub Issue…", action: openIssue).buttonStyle(DidjaButtonStyle.primary)
                    .help("Opens a new public issue in your browser, filled in with this report. You submit it.")
            }
        }
        .padding(20)
        .frame(width: Self.width, alignment: .topLeading)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Palette.surface)
    }
}
