import AppKit
import SwiftUI

/// The first run (SCR-89): what the engine writes to `meta.first_run` for the Welcome screen's
/// "Try it" step and the Quick View's quiet nudge. App names, AI tool names and counts only.
struct FirstRunStatus: Decodable, Equatable {
    struct Read: Decodable, Equatable { var name: String; var reads: Int }
    struct FirstList: Decodable, Equatable { var count: Int; var from: String }

    /// Apps read in the last ten minutes.
    var watching: [String]
    var assistantsRead: [Read]
    /// The newest list from an AI tool.
    var firstList: FirstList?
    /// Set when AI tool windows were read for ten minutes and not one task came of them.
    var nudge: Read?

    static let key = "first_run"
    /// Written by the app when you close the nudge; the engine shows it no more.
    static let dismissedKey = "first_run_nudge_dismissed"
    /// What the Welcome screen suggests asking.
    static let prompt = "Give me a numbered checklist to deploy this to Vercel"

    static func decode(_ json: String?) -> FirstRunStatus? {
        guard let json else { return nil }
        return try? JSONDecoder().decode(FirstRunStatus.self, from: Data(json.utf8))
    }

    /// "Watching ChatGPT, Terminal…", or what to do when nothing is read yet.
    var watchingLine: String {
        watching.isEmpty ? "Waiting for a window to read: click into your AI tool." : "Watching \(Self.list(watching))…"
    }

    /// "Got it: 3 steps from Claude.", once a list has come from an AI tool.
    var gotIt: String? {
        guard let first = firstList else { return nil }
        return "Got it: \(first.count) \(first.count == 1 ? "step" : "steps") from \(first.from)."
    }

    static func nudgeText(_ n: Read) -> String {
        "Didja has read \(n.name) \(n.reads) \(n.reads == 1 ? "time" : "times") but found no steps for you yet."
    }

    static let tickHint = "Tick one now: click its circle in the \(ViewNames.quick) (\(GlobalHotKey.label)), or do the step and watch it tick itself."

    /// "ChatGPT", "ChatGPT and Terminal", "ChatGPT, Cursor and Terminal".
    static func list(_ names: [String]) -> String {
        guard names.count > 1 else { return names.first ?? "" }
        return names.dropLast().joined(separator: ", ") + " and " + names.last!
    }
}

/// The Welcome screen's "Try it" step (SCR-89): a prompt to copy, a live line of what Didja is
/// reading, and "Got it" when the first steps arrive.
struct TryItSection: View {
    var status: FirstRunStatus?
    var copy: (String) -> Void
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Ask your AI tool (ChatGPT, Claude, Cursor, or one in Terminal) for steps, for example:")
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                Text(FirstRunStatus.prompt)
                    .italic()
                    .padding(.horizontal, 8).padding(.vertical, 5)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.05)))
                    .fixedSize(horizontal: false, vertical: true)
                Button(copied ? "Copied" : "Copy") {
                    copy(FirstRunStatus.prompt)
                    copied = true
                }
                .buttonStyle(DidjaButtonStyle.secondary)
                .help("Copies the prompt, to paste into your AI tool")
            }
            if let got = status?.gotIt {
                Label(got, systemImage: "checkmark.circle.fill")
                    .foregroundStyle(Palette.done)
                    .fontWeight(.medium)
                Text(FirstRunStatus.tickHint).font(.callout).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Label((status ?? FirstRunStatus(watching: [], assistantsRead: [])).watchingLine, systemImage: "dot.radiowaves.left.and.right")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// The Quick View's quiet note when AI tool windows were read for ten minutes but no steps came of
/// them (SCR-89). Troubleshoot… opens the report; × closes it for good.
struct FirstRunNudge: View {
    var nudge: FirstRunStatus.Read
    var troubleshoot: () -> Void
    var dismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "questionmark.bubble").foregroundStyle(Palette.accent)
            VStack(alignment: .leading, spacing: 3) {
                Text(FirstRunStatus.nudgeText(nudge)).font(.callout).fixedSize(horizontal: false, vertical: true)
                Button("Troubleshoot…", action: troubleshoot).buttonStyle(DidjaLinkStyle()).font(.callout)
            }
            Spacer(minLength: 4)
            Button(action: dismiss) { Image(systemName: "xmark") }
                .buttonStyle(DidjaButtonStyle.icon)
                .help("Don't show this again")
                .accessibilityLabel("Close this note")
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))
    }
}
