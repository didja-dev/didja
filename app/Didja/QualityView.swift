import SwiftUI

/// "How Didja is doing" (SCR-73): the engine's `didja quality --json` for the last 7 days, shown
/// in Settings › General. Counts only; read on this Mac and never sent anywhere.
struct QualityReport: Decodable, Equatable {
    struct Ticked: Decodable, Equatable {
        var command = 0, link = 0, setting = 0, file = 0, screen = 0, reply = 0, tool = 0, accepted = 0, total = 0
    }

    /// One row: a kind of source, or every source together.
    struct Counts: Decodable, Equatable {
        var source: String?
        var made = 0
        var ticked = Ticked()
        var asked = 0, yes = 0, notYet = 0, noAnswer = 0
        var byHand = 0, shownDone = 0
        var dismissed = 0, notAnAction = 0, freshStart = 0
        var reopenedAfterTick = 0

        /// Taken off the list without being done: dismissed, Not an Action, Fresh Start.
        var cleared: Int { dismissed + notAnAction + freshStart }
        /// Ticked by you: in the list, or from Didja Missed This.
        var byYou: Int { byHand + shownDone }
    }

    var days: Int
    var since: String
    var overall: Counts
    var sources: [Counts]

    static let days = 7

    /// The report from the bundled engine, or nil if it could not be read.
    static func load(days: Int = days) -> QualityReport? {
        guard let text = EngineRunner.output(["quality", "--days", String(days), "--json"]) else { return nil }
        return decode(text)
    }

    static func decode(_ text: String) -> QualityReport? {
        try? JSONDecoder().decode(QualityReport.self, from: Data(text.utf8))
    }

    /// "Counted since 10 Nov" when recording began within the period, else nil.
    var countedSince: String? {
        let parse = ISO8601DateFormatter()
        parse.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let start = parse.date(from: since) else { return nil }
        let period = Date().addingTimeInterval(-Double(days) * 86_400)
        guard start.timeIntervalSince(period) > 3_600 else { return nil }
        return "counted since \(start.formatted(.dateTime.day().month(.abbreviated)))"
    }
}

/// The numbers as a small table: one row per kind of source, then all of them.
struct QualityTable: View {
    let report: QualityReport?

    static let columns: [(String, String)] = [
        ("Made", "Tasks captured or added"),
        ("Ticked for you", "Ticked by Didja when it saw them done"),
        ("Asked", "\"Looks done?\" asked"),
        ("Yes", "You said yes to \"looks done?\""),
        ("Not yet", "You said not yet"),
        ("By you", "Ticked by you, or shown done in Didja Missed This"),
        ("Cleared", "Dismissed, Not an Action, or Fresh Start"),
        ("Wrong ticks", "Reopened by you after Didja ticked it"),
    ]

    static func values(_ c: QualityReport.Counts) -> [Int] {
        [c.made, c.ticked.total, c.asked, c.yes, c.notYet, c.byYou, c.cleared, c.reopenedAfterTick]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let report {
                Grid(alignment: .trailing, horizontalSpacing: 12, verticalSpacing: 6) {
                    GridRow {
                        Text("").gridColumnAlignment(.leading)
                        ForEach(Self.columns, id: \.0) { column in
                            Text(column.0).font(.caption.weight(.medium)).foregroundStyle(.secondary).help(column.1)
                        }
                    }
                    Divider().gridCellUnsizedAxes(.horizontal)
                    ForEach(report.sources, id: \.source) { row($0.source ?? "", $0, bold: false) }
                    if report.sources.count != 1 {
                        Divider().gridCellUnsizedAxes(.horizontal)
                        row("All", report.overall, bold: true)
                    }
                }
                .font(.callout.monospacedDigit())
                if report.overall.reopenedAfterTick > 0 {
                    Text("Wrong ticks are tasks Didja ticked that you reopened. Each one is a bug worth reporting.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            } else {
                Text("No numbers yet.").font(.callout).foregroundStyle(.secondary)
            }
        }
    }

    private func row(_ name: String, _ counts: QualityReport.Counts, bold: Bool) -> some View {
        GridRow {
            Text(name).fontWeight(bold ? .semibold : .regular).gridColumnAlignment(.leading)
            ForEach(Array(Self.values(counts).enumerated()), id: \.offset) { index, value in
                Text("\(value)")
                    .fontWeight(bold ? .semibold : .regular)
                    .foregroundStyle(index == 7 && value > 0 ? Color.red : (value == 0 ? .secondary : .primary))
            }
        }
    }
}
