import Foundation

/// Undo and redo of your own changes in the list (SCR-122). The engine keeps the history and puts
/// tasks back as they were (`didja undo`, `didja redo`); this reads what each would do, for the
/// menu titles, and runs them.
struct UndoHistory: Decodable, Equatable {
    /// What Undo and Redo would do now, in a few words ("Mark Done", "Reopen (3)"); nil when nothing.
    var undo: String?
    var redo: String?

    static let empty = UndoHistory(undo: nil, redo: nil)

    /// Read from `didja undo --status`; nothing to undo when the engine did not answer.
    static func parse(_ json: String?) -> UndoHistory {
        guard let json, let state = try? JSONDecoder().decode(UndoHistory.self, from: Data(json.utf8)) else { return .empty }
        return state
    }

    var undoTitle: String { undo.map { "Undo \($0)" } ?? "Undo" }
    var redoTitle: String { redo.map { "Redo \($0)" } ?? "Redo" }

    /// Whether the engine's answer to `didja undo` or `didja redo` says something changed.
    static func didChange(_ output: String?) -> Bool {
        guard let output, !output.isEmpty else { return false }
        return !output.hasPrefix("Nothing to")
    }

    static func current() -> UndoHistory { parse(EngineRunner.output(["undo", "--status"])) }
}
