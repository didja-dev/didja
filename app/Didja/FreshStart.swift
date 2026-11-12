import Foundation

/// Fresh Start (SCR-48): a clean list in one step. The engine marks every open and snoozed task done
/// (`didja fresh-start`) and keeps what it did, so Undo Fresh Start puts back exactly those tasks.
/// My List (SCR-46) is left as it is. Undo is offered for a day.
enum FreshStart {
    static let title = "Start fresh?"
    static let message = """
        Every open task is marked done, so your list is clear and Didja starts again from what you do next. \
        Nothing is deleted: the tasks are under Done, and Undo Fresh Start in the … menu brings them back for a day. \
        My List stays as it is.
        """

    static let key = "freshStartAt"
    static let undoWindow: TimeInterval = 24 * 3600

    static func didStart(at date: Date = Date(), defaults: UserDefaults = .standard) { defaults.set(date, forKey: key) }
    static func didUndo(defaults: UserDefaults = .standard) { defaults.removeObject(forKey: key) }

    static func canUndo(now: Date = Date(), defaults: UserDefaults = .standard) -> Bool {
        guard let at = defaults.object(forKey: key) as? Date else { return false }
        return now.timeIntervalSince(at) < undoWindow
    }
}
