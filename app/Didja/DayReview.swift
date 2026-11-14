import AppKit
import SwiftUI

/// Day Review (SCR-100), as the engine builds it (`didja review --json`): opt-in, short, and
/// changing nothing by itself. Evening: what Didja ticked for you today (each with Not Done), asks
/// that were answered, what is still open from today, what is due tomorrow. Morning: due today,
/// overdue, waiting on.
struct DayReview: Decodable, Equatable {
    struct Item: Decodable, Equatable, Identifiable {
        var id: Int
        var title: String
        var source: String
        var why: String?
        var due: String?
    }

    struct Section: Decodable, Equatable, Identifiable {
        var key: String
        var title: String
        var items: [Item]
        var id: String { key }
    }

    var kind: String
    var day: String
    var sections: [Section]

    var heading: String { kind == "morning" ? "Morning" : "Day Review" }

    static func decode(_ json: String?) -> DayReview? {
        json.flatMap { try? JSONDecoder().decode(DayReview.self, from: Data($0.utf8)) }
    }
}

/// The first tick Didja ever made for you, shown once with Undo (SCR-100).
struct FirstTickNote: Decodable, Equatable {
    var id: Int
    var title: String
    var why: String?

    static func decode(_ json: String?) -> FirstTickNote? {
        json.flatMap { try? JSONDecoder().decode(FirstTickNote.self, from: Data($0.utf8)) }
    }
}

/// Talks to the engine for the review. Each runs the bundled engine: call off the main thread.
enum DayReviewEngine {
    private struct Due: Decodable { var due: String? }
    struct Times: Decodable, Equatable {
        var evening: String?
        var morning: String?
    }

    static let eveningChoices = ["16:00", "17:00", "17:30", "18:00", "18:30", "19:00", "20:00", "21:00"]
    static let morningChoices = ["07:00", "07:30", "08:00", "08:30", "09:00", "09:30", "10:00"]

    /// The review due now ("evening", "morning"), once a day; `take` marks it shown.
    static func due(take: Bool) -> String? {
        guard let json = EngineRunner.output(["review", "due"] + (take ? ["--take"] : [])) else { return nil }
        return (try? JSONDecoder().decode(Due.self, from: Data(json.utf8)))?.due
    }

    static func load(_ kind: String) -> DayReview? { DayReview.decode(EngineRunner.output(["review", kind, "--json"])) }
    static func markdown(_ kind: String) -> String? { EngineRunner.output(["review", kind, "--markdown"]) }
    static func times() -> Times {
        EngineRunner.output(["review", "times"]).flatMap { try? JSONDecoder().decode(Times.self, from: Data($0.utf8)) } ?? Times()
    }
    static func setTime(_ kind: String, _ time: String?) { _ = EngineRunner.output(["review", "time", kind, time ?? "off"]) }
    static func undo(_ id: Int) { _ = EngineRunner.output(["review", "undo", String(id)]) }
    static func firstTick() -> FirstTickNote? { FirstTickNote.decode(EngineRunner.output(["review", "first-tick"])) }
    static func firstTickSeen() { _ = EngineRunner.output(["review", "first-tick", "seen"]) }
}

/// The review, at the top of the Quick View until you close it.
struct DayReviewSheet: View {
    let review: DayReview
    var notDone: (DayReview.Item) -> Void = { _ in }
    var copy: () -> Void = {}
    var close: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: review.kind == "morning" ? "sunrise" : "moon.stars").foregroundStyle(Palette.accent)
                Text(review.heading).font(.headline)
                Spacer()
                Button("Copy as Markdown", action: copy)
                    .buttonStyle(DidjaButtonStyle(kind: .secondary, size: .small))
                    .help("For a standup or your notes. Stays on this Mac: it only goes to the clipboard.")
                Button(action: close) { Image(systemName: "xmark") }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                    .help("Close the review")
                    .accessibilityLabel("Close the review")
            }
            if review.sections.isEmpty {
                Text(review.kind == "morning" ? "Nothing due and no one to wait on." : "Nothing to review today.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            ForEach(review.sections) { section in
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(section.title) · \(section.items.count)").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    ForEach(section.items) { item in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(item.title).font(.callout).lineLimit(2)
                                Text(item.why ?? item.due.map { "\(item.source) · due \($0)" } ?? item.source)
                                    .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            }
                            Spacer(minLength: 6)
                            if section.key == "ticked" {
                                Button("Not Done") { notDone(item) }
                                    .buttonStyle(DidjaButtonStyle(kind: .secondary, size: .small))
                                    .help("Didja got this wrong: reopen it. Didja learns from it.")
                            }
                        }
                    }
                }
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(Palette.chip.opacity(0.6)))
    }
}

/// The first time Didja ticks something for you: what, why, and Undo. Shown once.
struct FirstTickBanner: View {
    let note: FirstTickNote
    var undo: () -> Void = {}
    var dismiss: () -> Void = {}

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.done)
            VStack(alignment: .leading, spacing: 1) {
                Text("Didja ticked “\(note.title)” for you").font(.callout).lineLimit(2)
                Text(note.why ?? "It looked done.").font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer(minLength: 6)
            Button("Undo", action: undo)
                .buttonStyle(DidjaButtonStyle(kind: .secondary, size: .small))
                .help("Reopen it: it was not done")
            Button(action: dismiss) { Image(systemName: "xmark") }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("Got it")
                .accessibilityLabel("Dismiss")
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(Palette.chip.opacity(0.6)))
    }
}

extension CaptureCoordinator {
    /// When the Quick View opens: the review that is due now (once a day), and the first-tick note.
    func checkReview() {
        DispatchQueue.global(qos: .userInitiated).async {
            let review = DayReviewEngine.due(take: true).flatMap(DayReviewEngine.load)
            let note = DayReviewEngine.firstTick()
            DispatchQueue.main.async {
                if let review { self.dayReview = review }
                self.firstTick = note
            }
        }
    }

    /// Day Review or Morning from the menu, whenever you want it.
    func showReview(_ kind: String) {
        DispatchQueue.global(qos: .userInitiated).async {
            let review = DayReviewEngine.load(kind)
            DispatchQueue.main.async { self.dayReview = review }
        }
    }

    /// Not Done on a tick in the review, or Undo on the first-tick note: reopen it, then read again.
    func undoTick(_ id: Int) {
        DispatchQueue.global(qos: .userInitiated).async {
            DayReviewEngine.undo(id)
            let review = self.dayReview.flatMap { DayReviewEngine.load($0.kind) }
            DispatchQueue.main.async {
                if self.dayReview != nil { self.dayReview = review }
                if self.firstTick?.id == id { self.dismissFirstTick() }
                self.refreshSummary()
            }
        }
    }

    func dismissFirstTick() {
        firstTick = nil
        DispatchQueue.global(qos: .utility).async { DayReviewEngine.firstTickSeen() }
    }

    func copyReview() {
        guard let kind = dayReview?.kind else { return }
        DispatchQueue.global(qos: .userInitiated).async {
            guard let markdown = DayReviewEngine.markdown(kind) else { return }
            DispatchQueue.main.async {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(markdown, forType: .string)
            }
        }
    }
}
