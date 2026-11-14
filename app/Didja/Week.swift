import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// The week (SCR-116), as the engine builds it (`didja week --json`): what you finished in the last
/// seven days, by day, from task titles and outcomes Didja already keeps. Changes nothing.
struct WeekSummary: Decodable, Equatable {
    struct Item: Decodable, Equatable, Identifiable {
        var id: Int
        var kind: String
        var title: String
        var source: String
        var at: String

        /// A task and a Waiting On row can share a number.
        var key: String { "\(kind)-\(id)" }
        var words: String { WeekSummary.words[kind] ?? kind }
    }

    struct Day: Decodable, Equatable, Identifiable {
        var day: String
        var items: [Item]
        var id: String { day }
    }

    var from: String
    var to: String
    var totals: [String: Int]
    var days: [Day]

    static let kinds = ["byYou", "ticked", "answered", "dismissed"]
    static let words = ["byYou": "done by you", "ticked": "ticked by Didja", "answered": "answered", "dismissed": "dismissed"]

    /// "3 done by you · 2 ticked by Didja · 1 answered · 0 dismissed", as the engine's Markdown says it.
    var totalsLine: String {
        Self.kinds.map { "\(totals[$0] ?? 0) \(Self.words[$0] ?? $0)" }.joined(separator: " · ")
    }

    /// "Fri 13 Nov" for "2026-11-13".
    static func label(_ day: String) -> String {
        let parse = DateFormatter()
        parse.locale = Locale(identifier: "en_US_POSIX")
        parse.dateFormat = "yyyy-MM-dd"
        guard let date = parse.date(from: day) else { return day }
        let show = DateFormatter()
        show.locale = Locale(identifier: "en_GB")
        show.setLocalizedDateFormatFromTemplate("EEE d MMM")
        return show.string(from: date)
    }

    static func decode(_ json: String?) -> WeekSummary? {
        json.flatMap { try? JSONDecoder().decode(WeekSummary.self, from: Data($0.utf8)) }
    }
}

/// Talks to the engine for the week. Each runs the bundled engine: call off the main thread.
enum WeekEngine {
    private struct Due: Decodable { var due: Bool }
    private struct Nudge: Decodable { var on: Bool }

    static func load() -> WeekSummary? { WeekSummary.decode(EngineRunner.output(["week", "--json"])) }
    static func markdown() -> String? { EngineRunner.output(["week", "--markdown"]).map { $0 + "\n" } }
    /// Whether the Friday reminder is due now; `take` marks it given.
    static func due(take: Bool) -> Bool {
        EngineRunner.output(["week", "due"] + (take ? ["--take"] : []))
            .flatMap { try? JSONDecoder().decode(Due.self, from: Data($0.utf8)) }?.due ?? false
    }
    static func nudgeOn() -> Bool {
        EngineRunner.output(["week", "nudge"]).flatMap { try? JSONDecoder().decode(Nudge.self, from: Data($0.utf8)) }?.on ?? false
    }
    static func setNudge(_ on: Bool) { _ = EngineRunner.output(["week", "nudge", on ? "on" : "off"]) }

    static let reminder = (title: "Your week", body: "What you finished this week, by day. Open the Full View › This Week.")

    /// "Didja week 2026-11-13.md".
    static func fileName(_ week: WeekSummary) -> String { "Didja week \(week.to).md" }

    static func copy() {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let markdown = markdown() else { return }
            DispatchQueue.main.async {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(markdown, forType: .string)
            }
        }
    }

    static func save(_ week: WeekSummary) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = fileName(week)
        panel.allowedContentTypes = [UTType(filenameExtension: "md") ?? .plainText]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        DispatchQueue.global(qos: .userInitiated).async {
            guard let markdown = markdown() else { DispatchQueue.main.async { NSSound.beep() }; return }
            if (try? markdown.write(to: url, atomically: true, encoding: .utf8)) == nil { DispatchQueue.main.async { NSSound.beep() } }
        }
    }
}

/// This Week, in the Full View: the totals, then each day with what was finished there.
struct WeekView: View {
    let week: WeekSummary?
    var copy: () -> Void = {}
    var save: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("This Week").font(.title3.weight(.semibold))
                if let week {
                    Text("\(WeekSummary.label(week.from)) – \(WeekSummary.label(week.to))").font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Copy as Markdown", action: copy)
                    .buttonStyle(DidjaButtonStyle.secondary)
                    .help("For a weekly update or your notes. It only goes to the clipboard.")
                    .disabled(week == nil)
                Button("Save…", action: save)
                    .buttonStyle(DidjaButtonStyle.secondary)
                    .help("Save it as a Markdown file on this Mac.")
                    .disabled(week == nil)
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 8)
            ScrollView {
                WeekContent(week: week)
            }
        }
    }
}

/// The totals and the days, without the header (drawn on its own in tests: a scroll view renders empty there).
struct WeekContent: View {
    let week: WeekSummary?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let week {
                Text(week.totalsLine).font(.callout).foregroundStyle(.secondary)
                if week.days.isEmpty {
                    Text("Nothing finished in the last seven days yet.").foregroundStyle(.secondary)
                }
                ForEach(week.days) { day in
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(WeekSummary.label(day.day)) · \(day.items.count)")
                            .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        ForEach(day.items, id: \.key) { item in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Image(systemName: item.kind == "dismissed" ? "xmark.circle" : "checkmark.circle.fill")
                                    .foregroundStyle(item.kind == "dismissed" ? Color.secondary : Palette.done)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(item.title).lineLimit(2)
                                    Text("\(item.source) · \(item.words)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                        }
                    }
                }
                Text("From the titles and outcomes Didja keeps on this Mac. Nothing is sent.")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                ProgressView().controlSize(.small)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.bottom, 16)
    }
}
