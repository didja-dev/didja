import AppKit
import SwiftUI

/// What the Privacy window states as fact about this Mac right now. Gathered
/// by the app and passed in, so the window can be drawn in tests.
struct PrivacyFacts: Equatable {
    var retention: Retention
    var observationCount: Int
    var taskCount: Int
    var excludedApps: Int
    var excludedTitles: Int
    var excludedSites: Int
    var screenRecordingGranted: Bool
    /// Whether Apple's on-device model can be used, in words.
    var modelStatus: String
    var dataFolder: String
    var isPaused: Bool
    /// The task tools you connected (Connections…): the only places anything is sent.
    var connections: [String] = []
    /// The app profiles in use (SCR-42): which apps are read message by message.
    var profiles: [AppProfile.Summary] = []
    /// Let My Own Claude Read Didja (`didja mcp`, SCR-42).
    var ownClaude = OwnClaude.Status(on: false, calls: 0, last: nil)
    /// The model in Ollama asked first for emails and "looks done?", when one is turned on.
    var localModel: String?
    /// The shell hook (SCR-87): your shell writing the commands you run to a log of Didja's.
    var shellHook = ShellHook.Status(on: false, installed: false, runs: 0)
    /// Agent hooks (SCR-88): your AI tools telling Didja what they ran and planned.
    var agentHooks: [AgentHooks.Tool] = []

    /// "WhatsApp, Teams (community, new) for chats; Gmail, Outlook for email".
    var profileSummary: String {
        func names(_ kind: AppProfile.Kind) -> String {
            profiles.filter { $0.kind == kind }.map { p in
                p.status == .communityNew ? "\(p.name) (community, new)" : p.status == .community ? "\(p.name) (community)" : p.name
            }.joined(separator: ", ")
        }
        let parts = [(names(.chat), "chats"), (names(.email), "email")].filter { !$0.0.isEmpty }.map { "\($0.0) for \($0.1)" }
        return parts.isEmpty ? "none" : parts.joined(separator: "; ")
    }

    /// "3 apps, 1 window title, 2 sites", or "nothing yet".
    var excludeSummary: String {
        func count(_ n: Int, _ one: String, _ many: String) -> String? { n == 0 ? nil : "\(n) \(n == 1 ? one : many)" }
        let parts = [count(excludedApps, "app", "apps"), count(excludedTitles, "window title", "window titles"),
                     count(excludedSites, "site", "sites")].compactMap { $0 }
        return parts.isEmpty ? "nothing added yet" : parts.joined(separator: ", ")
    }

    /// "1 hour", "6 hours", "24 hours".
    var retentionWords: String {
        retention == .hour ? "1 hour" : "\(retention.rawValue) hours"
    }
}

/// The Privacy window: what Didja looks at, what it keeps and where,
/// what the on-device model is shown, and what leaves the Mac (nothing).
struct PrivacyView: View {
    static let width: CGFloat = 560

    var facts: PrivacyFacts
    var openExcludeList: () -> Void = {}
    var revealDataFolder: () -> Void = {}

    var body: some View {
        ScrollView {
            PrivacyContent(facts: facts, openExcludeList: openExcludeList, revealDataFolder: revealDataFolder)
        }
        .frame(width: Self.width)
        .frame(minHeight: 320, maxHeight: .infinity, alignment: .top)
        .background(Palette.surface)
    }
}

/// The Privacy window's text, without its scrolling, so it can be drawn in tests.
struct PrivacyContent: View {
    var facts: PrivacyFacts
    var openExcludeList: () -> Void = {}
    var revealDataFolder: () -> Void = {}

    var body: some View {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Image(systemName: "lock.shield").font(.system(size: 20)).foregroundStyle(Palette.accent)
                        Text("Privacy").font(.title2.weight(.semibold))
                    }
                    Text("Everything Didja does happens on this Mac. It reads the text of the window you are working in, keeps it for at most \(facts.retentionWords), and nothing it reads or works out is sent anywhere.")
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                section("text.viewfinder", "What it looks at") {
                    line("The text of the window in front, read through macOS Accessibility, the same way a screen reader reads it. Not a picture of the screen.")
                    line("Only the focused window of the app you are using, when you switch to it or it changes, and every 5 seconds. Windows behind it, other apps and other screens are not read.")
                    line(facts.screenRecordingGranted
                         ? "Screen Recording is granted, so a window that exposes almost no text is read from one frame with Apple's text recognition. The frame stays in memory and is dropped at once; no image is ever saved."
                         : "No picture of the screen is ever taken: Screen Recording is not granted, or reading windows without accessibility text is off in Settings › General. (With both on, a window that exposes almost no text is read from one frame in memory, never saved.)")
                    line("In chat and email apps it follows that app's profile, which says which parts of the window are a message, its sender and its time: \(facts.profileSummary). A profile only labels the window already being read; it cannot reach another app, a password field or what you are typing. Profiles marked community were written by other people and reviewed before release; a new one is marked new for its first release.")
                    status(facts.isPaused ? "Paused: nothing is being read right now." : "Reading now. Pause from the \(ViewNames.quick), or with \(GlobalHotKey.pauseLabel) anywhere.",
                           good: facts.isPaused)
                }

                section("eye.slash", "What it never reads") {
                    line("Password managers and password prompts, and any password field in any app.")
                    line("Private and incognito browser windows.")
                    line("The text box you are typing in, except in a terminal.")
                    line("Didja's own windows.")
                    HStack(spacing: 8) {
                        line("Your exclude list: \(facts.excludeSummary).")
                        Button("Edit List…", action: openExcludeList).buttonStyle(DidjaButtonStyle.secondary)
                    }
                }

                section("internaldrive", "What it keeps, and where") {
                    line("One database file on this Mac:")
                    Text(facts.dataFolder)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                    bullet("Captured text", "Only lines that are new since the window was last read, as plain text. Deleted after \(facts.retentionWords). Now: \(facts.observationCount) pieces of text.")
                    bullet("Tasks", "Each task's wording, where it came from (the app and conversation, or the email's sender and subject), links from the email it came from, and short notes on why it was ticked. Kept after the captured text is gone, including done and dismissed tasks; there is no way to delete tasks yet. Now: \(facts.taskCount).")
                    bullet("How a task looked", "A few lines around each open task (at most seven, as text) from the window it was captured in, so you can see it as it was (V). Deleted when the task is done or dismissed, with Forget Captured Text Now, and when you exclude that window.")
                    bullet("Fingerprints", "So the model is not asked about the same email or screen twice, a one-way fingerprint of it is kept with the answer. The text itself is not, except a list waiting a few seconds to be judged.")
                    bullet("Your names", "Your Mac account's full name, or the name you set, and the names and nicknames you add in Your Names…, so your own chat messages, and messages that tag or name you, can be told from others'.")
                    bullet("Your mail account", "The address and name your own emails are sent as, read from Outlook's window title, so a message you sent never becomes a task. Nothing else from the window.")
                    bullet("Canvases", "Their titles, the headings and notes you write on them, and which tasks are on them. Kept until you delete them.")
                    bullet("What you taught it", "Corrections you made with Not an Action and Not Done (each holds the task's wording), and any instructions you wrote for the model. Kept until you remove them in How It Decides…")
                    bullet("What capture did, as counts", "For the Troubleshooting Report: each time capture tried the app in front, what happened (a code such as read, no window or no text), how many lines and the app's name; and why what was read made no task, counted per kind of source. No text and no window titles. Kept 24 hours.")
                    bullet("Settings", "Your choices (appearance, focus, sort, how long text is kept) in the app's macOS preferences, and the exclude list in exclude.json beside the database.")
                    HStack(spacing: 8) {
                        Button("Show in Finder", action: revealDataFolder).buttonStyle(DidjaButtonStyle.secondary)
                    }
                }

                section("cpu", "The on-device model") {
                    line("Some judgements are made by Apple's on-device language model (Apple Intelligence, Foundation Models framework). It runs on this Mac. The framework can also use Apple's Private Cloud Compute; Didja never uses it.")
                    status("On this Mac: \(facts.modelStatus)", good: facts.modelStatus.hasPrefix("Available"))
                    line("It is used for four things, and is shown only this:")
                    bullet("Who a list is for", "A list's opening line, its steps and the lines after it, when the wording does not say whether it is for you or Claude's own plan.")
                    bullet("Short titles", "A checklist's opening line and steps, when that line is too long to be its title.")
                    bullet("Emails", "The sender's name, the subject and the start of the message (up to 900 characters, 1,500 for a forward), to work out what you are asked to do and who is asking.")
                    bullet("Chats", "In WhatsApp, Teams or Slack: a message from someone else (up to 1,200 characters) and up to six messages before it, to work out whether it asks you to do something. In a group, only a message that names or @mentions you is shown to it. Your name is shown only for group chats.")
                    bullet("Your chat replies", "Your reply after such an ask (up to 600 characters) and the ask, to tell whether the reply settles it or puts it off.")
                    bullet("Looks done", "A task's wording and up to 900 characters of a later screen that mentions it, to suggest it may be done. It never ticks by this alone, except when you opened the email's own link and the page then shows it done.")
                    line("Without the model (older macOS, or Apple Intelligence off) these are skipped, and lists and emails are handled by fixed rules or not at all.")
                    if let model = facts.localModel {
                        status("Local model on: \(model) in Ollama is asked first about emails and \"looks done?\", and is shown the same text as above. Ollama runs on this Mac; Didja reaches it only at 127.0.0.1. Turn it off in Settings › General.", good: true)
                    } else {
                        line("A model in Ollama, on this Mac, can be asked first about emails and \"looks done?\" (Settings › General). It is off.")
                    }
                }

                section("network", "What leaves this Mac") {
                    if facts.connections.isEmpty {
                        line("Nothing from your screen. Didja makes one kind of request on its own: once a day it asks didja.dev whether there is a new version (you can turn that off in Settings › General); the request carries only the app's version, and an update is installed only if Apple's and Didja's signatures check out. No analytics, no crash reports, no account. The engine that turns text into tasks is a program inside the app, and it only reads and writes the database above. The one exception is a task tool you connect yourself in Connections…; none is connected.")
                    } else {
                        line("Only what you set up in Connections…, and only to these tools: \(facts.connections.joined(separator: ", ")). For each, Didja reads your items there (title, key, due date, state) and, when it ticks one, sends the state or label change you chose. Nothing it reads from your screen, no captured text, notes or other tasks, is ever sent. The sign-in keys are kept in your login keychain. Once a day Didja also asks didja.dev whether there is a new version (Settings › General turns it off). No analytics, no crash reports.")
                    }
                    if facts.ownClaude.on {
                        line("And what your own Claude reads through `didja mcp` (Your own Claude, below): it goes to your AI provider.")
                    }
                }

                section("terminal", "Commands you run") {
                    line(facts.shellHook.on
                         ? "Shell hook on (Settings › General › Commands): your shell writes each command you run, its exit code and a hash of its folder to shell.log in Didja's data folder, kept 24 hours; key-looking commands only as a hash. \(ShellHook.words(facts.shellHook)) Nothing of it leaves this Mac."
                         : "Shell hook off. Turned on in Settings › General › Commands, a few marked lines in ~/.zshrc and ~/.bashrc would write the commands you run, with their exit codes, to a log Didja reads, kept 24 hours.")
                }

                section("cpu", "What your AI tools tell Didja") {
                    let on = facts.agentHooks.filter(\.on)
                    line(on.isEmpty
                         ? "Nothing. Turned on per tool in Settings › General › Assistants, Claude Code, Cursor or Windsurf would tell Didja, through a hook in their own settings, the commands they ran and their plan's titles."
                         : "On for \(on.map(\.name).joined(separator: ", ")) (Settings › General › Assistants): a hook in their own settings tells Didja the commands they ran, with exit codes, and their plan's titles, kept 24 hours in agent-hooks.jsonl in Didja's data folder: \(on.map { "\($0.name) \($0.events)" }.joined(separator: ", ")) events. Never files, prompts, replies or output. Nothing of it leaves this Mac.")
                }

                section("person.badge.key", "Your own Claude") {
                    line(facts.ownClaude.on
                         ? "On (Settings › General): your own Claude app, if you set it up with `didja mcp`, can read the reports you give it from Report a Problem, the text Didja kept with every letter and digit masked, and the app profiles, draft a profile in its own folder, and draft a GitHub issue about a miss (masked) for you to post yourself. What it reads goes to your AI provider under your account. Every call is logged: \(OwnClaude.words(facts.ownClaude))"
                         : "Off. Turned on in Settings › General, your own Claude app (Claude Code, Claude Desktop) could help you fix how Didja reads an app, through `didja mcp`. It would see only masked text and the reports you give it.")
                }

                section("slider.horizontal.3", "Your controls") {
                    bullet("Pause", "In the \(ViewNames.quick), or \(GlobalHotKey.pauseLabel) from anywhere.")
                    bullet("Your Names…", "Your name and the names people call or tag you by, in any language.")
                    bullet("Connections…", "Connect a task tool such as Linear, or disconnect it, which also deletes its sign-in keys.")
                    bullet("Exclude List…", "Apps, window titles and sites never to read. Adding one also deletes what was already kept from it.")
                    bullet("Keep Captured Text For", "1, 6 or 24 hours.")
                    bullet("Forget Captured Text Now…", "Asks, then deletes all captured text at once. Tasks stay.")
                    bullet("Dismiss", "Takes a task off your lists. It is still kept, under Dismissed.")
                    bullet("Fresh Start…", "Marks every open task done for a clear list. Nothing is deleted; Undo Fresh Start brings them back for a day.")
                    bullet("Siri", "\u{201C}Add to Didja\u{201D} puts what you say on My List. Siri is Apple's; Didja receives only the words.")
                    bullet("Report a Problem with This Window…", "Shows how Didja sees the window you were last in, with every letter and digit masked unless you choose to show a line. You save or copy it; Didja sends nothing.")
                    bullet("Troubleshooting Report…", "Says why Didja reads nothing or makes no tasks, in counts and codes. You copy, save, email or post it yourself; Didja sends nothing.")
                }
            }
            .padding(24)
            .frame(width: PrivacyView.width)
            .background(Palette.surface)
    }

    private func section<Content: View>(_ symbol: String, _ title: String, @ViewBuilder content: () -> Content) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 15))
                .foregroundStyle(Palette.accent)
                .frame(width: 22, height: 20)
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.headline)
                content()
            }
            Spacer(minLength: 0)
        }
    }

    private func line(_ text: String) -> some View {
        Text(text).fixedSize(horizontal: false, vertical: true)
    }

    private func bullet(_ name: String, _ text: String) -> some View {
        (Text(name).fontWeight(.medium) + Text(" — ") + Text(text).foregroundColor(.secondary))
            .fixedSize(horizontal: false, vertical: true)
    }

    private func status(_ text: String, good: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Circle().fill(good ? Palette.done : Palette.source).frame(width: 7, height: 7)
            Text(text).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }
}
