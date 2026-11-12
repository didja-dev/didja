import Combine
import Foundation

/// A key the task lists understand. Keys are recognised by their position on
/// the keyboard (key code), so they work whatever input language is active.
enum NavKey: Equatable {
    case up, down
    /// ⇧↑ and ⇧↓: move the highlight and choose every row it passes, as in any list.
    case extendUp, extendDown
    /// ⌘A: choose every row on show.
    case selectAll
    case toggle, snooze, dismiss, why
    /// Give the highlighted row a new name.
    case rename
    /// A row marked "looks done?" is not done.
    case notYet
    /// Tick everything open in the highlighted row's conversation.
    case tickConversation
    /// Put the highlighted row on the clipboard as text, a parent together with its steps.
    case copy
    /// Put the keyboard in the search field.
    case search
    /// Go back to the window the highlighted row was captured in.
    case goToSource
    case close, openWindow, pause
    /// Add a task of your own (A or +, SCR-29).
    case add
    /// Show how the highlighted task looked where it was captured (V, SCR-31).
    case preview
    /// A view of the task window, counted from 0.
    case view(Int)
    case previousView, nextView
    /// ⌥← and ⌥→: fold every parent away, or show them all.
    case foldAll, unfoldAll
    /// H: show or hide "Recently done" in the Quick View.
    case recentlyDone
    /// X: Didja Missed This… on the highlighted row.
    case missed

    /// Nil for keys the lists do not use, and for anything held with ⌘, ⌃ or ⌥
    /// so that shortcuts such as ⌘W and ⌘Q keep working. The one exception is
    /// ⌘C (⌘ alone), which copies the highlighted row, ⌘F, which searches, and ⌘A,
    /// which chooses every row. ⇧↑ and ⇧↓ (⇧ alone) choose rows as they go.
    init?(keyCode: UInt16, hasCommandModifiers: Bool, isCommandOnly: Bool = false, isShiftOnly: Bool = false, isOptionOnly: Bool = false) {
        if isOptionOnly, keyCode == 123 || keyCode == 124 {
            self = keyCode == 123 ? .foldAll : .unfoldAll
            return
        }
        if isShiftOnly, keyCode == 126 || keyCode == 125 {
            self = keyCode == 126 ? .extendUp : .extendDown
            return
        }
        if isCommandOnly, keyCode == 0 {
            self = .selectAll
            return
        }
        if isCommandOnly, keyCode == 8 {
            self = .copy
            return
        }
        if isCommandOnly, keyCode == 3 {
            self = .search
            return
        }
        guard !hasCommandModifiers else { return nil }
        switch keyCode {
        case 126, 40: self = .up            // ↑, K
        case 125, 38: self = .down          // ↓, J
        case 49, 36, 76: self = .toggle     // Space, Return, Enter
        case 1: self = .snooze              // S
        case 2, 51: self = .dismiss         // D, Delete
        case 13: self = .why                // W
        case 15: self = .rename             // R
        case 45: self = .notYet             // N
        case 8: self = .tickConversation    // C
        case 3, 44: self = .search          // F, /
        case 5: self = .goToSource          // G
        case 53: self = .close              // Esc
        case 31: self = .openWindow         // O
        case 35: self = .pause              // P
        case 0, 24: self = .add             // A, + (the = key, with or without ⇧)
        case 9: self = .preview             // V
        case 4: self = .recentlyDone        // H
        case 7: self = .missed              // X
        case 18: self = .view(0)            // 1
        case 19: self = .view(1)            // 2
        case 20: self = .view(2)            // 3
        case 21: self = .view(3)            // 4
        case 123: self = .previousView      // ←
        case 124: self = .nextView          // →
        default: return nil
        }
    }
}

extension TaskItem {
    /// Whether a key does anything to this task. Mirrors the buttons a row shows.
    func allows(_ key: NavKey) -> Bool {
        switch key {
        case .toggle: return true
        case .snooze, .dismiss: return status == .open
        case .why: return !isGroup
        case .preview: return true
        case .missed: return true
        case .rename: return true
        case .notYet: return suggestion != nil
        case .goToSource: return true
        default: return false
        }
    }
}

/// What ← or → does to the highlighted row of an outline.
enum OutlineMove: Equatable {
    case setCollapsed(Bool)
    case select(Int)
    case nothing
}

/// Which row is highlighted in a task list, and what the keyboard does to it.
/// One for the popover, one for the task window.
final class TaskNavigator: ObservableObject {
    enum Scope {
        case popover, window
    }

    let scope: Scope
    /// The highlighted task. Keys only ever act on this one.
    @Published var selected: Int?
    /// The engine's "why" text for the rows that have it open.
    @Published var explanations: [Int: String] = [:]
    /// The view the task window shows.
    @Published var filter = TaskBoard.Filter.pending {
        didSet { if filter != oldValue { selected = nil; sourceFilter = nil; clearMarks() } }
    }
    /// Rows chosen together (⌘A, ⇧↑↓, ⌘-click, ⇧-click). Empty when only the
    /// highlighted row is chosen. Space, D and S act on all of them at once.
    @Published var marked: Set<Int> = []
    /// Where a ⇧ range starts.
    private var anchor: Int?
    /// The row being renamed, and what has been typed so far. While set, keys go to the text field.
    @Published var editing: Int?
    @Published var draft = ""
    /// True while the "add a task" field is open (SCR-29). While set, keys go to that field.
    @Published var adding = false
    @Published var addDraft = ""
    /// Where the highlight last was, for when its task leaves the list.
    private var lastIndex = 0
    /// The row that was just copied, so it can say so for a moment.
    @Published var copied: Int?

    init(scope: Scope) {
        self.scope = scope
    }

    /// In the task window: show only this conversation's items.
    @Published var sourceFilter: String? {
        didSet { if sourceFilter != oldValue { selected = nil; clearMarks() } }
    }

    /// Show only what mentions this. Typed in the search field of the panel or the task window.
    @Published var query = "" {
        didSet { if query != oldValue { selected = nil; clearMarks() } }
    }
    /// True while the search field has the keyboard, so typing is not taken for shortcuts.
    @Published var searching = false

    /// Finished work is listed by day; everything else by conversation.
    var groupsByDay: Bool { filter == .done && sourceFilter == nil }

    /// The task window's sections: the chosen view, narrowed to the chosen source and search.
    func sections(_ board: TaskBoard) -> [TaskBoard.Section] {
        if groupsByDay { return board.sections(filter, matching: query, byDay: true) }
        return board.sections(filter, matching: query).filter { sourceFilter == nil || $0.source == sourceFilter }
    }

    /// The rows on show, top to bottom.
    func rows(_ board: TaskBoard) -> [TaskItem] {
        scope == .popover ? board.popoverRows(matching: query) : sections(board).flatMap(\.rows)
    }

    /// True while a search hides part of the list.
    var isNarrowed: Bool { !TaskBoard.needle(query).isEmpty }

    /// Whether a row is drawn as chosen: the highlighted one, or one of several chosen together.
    func isChosen(_ id: Int) -> Bool {
        selected == id || marked.contains(id)
    }

    /// Stop choosing several rows. False when there was nothing to stop.
    @discardableResult
    func clearMarks() -> Bool {
        anchor = nil
        guard !marked.isEmpty else { return false }
        marked = []
        return true
    }

    /// A click on a row's title. ⌘ adds it to the rows chosen, or takes it out;
    /// ⇧ chooses every row from the last one clicked to this one; a plain click
    /// highlights just this row.
    func click(_ item: TaskItem, board: TaskBoard, command: Bool = false, shift: Bool = false) {
        let rows = rows(board)
        if shift, let start = anchor ?? selected,
           let from = rows.firstIndex(where: { $0.id == start }),
           let to = rows.firstIndex(where: { $0.id == item.id }) {
            marked = Set(rows[min(from, to)...max(from, to)].map(\.id))
            anchor = start
            selected = item.id
            return
        }
        if command {
            if marked.isEmpty, let selected, selected != item.id { marked = [selected] }
            if marked.contains(item.id) {
                marked.remove(item.id)
            } else {
                marked.insert(item.id)
                selected = item.id
            }
            anchor = item.id
            return
        }
        clearMarks()
        selected = item.id
        anchor = item.id
    }

    /// Forget the search: everything is listed again and keys go to the list.
    func endSearch() {
        query = ""
        searching = false
    }

    /// A key pressed while the search field has the keyboard, by key code. ↓ and ↑
    /// hand the keyboard to the list and move the highlight; Return hands it over
    /// with the first row highlighted. Anything else is typing and is left to the
    /// field, so no letter typed into a search can tick, snooze or dismiss a task.
    func handleWhileSearching(keyCode: UInt16, board: TaskBoard, actions: TaskActions) -> Bool {
        switch keyCode {
        case 125, 126:
            searching = false
            return handle(keyCode == 125 ? .down : .up, board: board, actions: actions)
        case 36, 76:
            searching = false
            if selected == nil { handle(.down, board: board, actions: actions) }
            return true
        default:
            return false
        }
    }

    func startRenaming(_ item: TaskItem) {
        selected = item.id
        draft = item.title
        editing = item.id
    }

    /// Save the new name (an empty one goes back to the captured title) and stop editing.
    func commitRename(_ item: TaskItem, actions: TaskActions) {
        guard editing == item.id else { return }
        let name = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        if name != item.title { actions.rename(item, name) }
        editing = nil
    }

    func cancelRename() {
        editing = nil
    }

    /// Open the field for a task of your own.
    func startAdding() {
        editing = nil
        searching = false
        addDraft = ""
        adding = true
    }

    /// Add what was typed as a task (nothing, if it is empty) and close the field.
    func commitAdd(actions: TaskActions) {
        guard adding else { return }
        let title = addDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        if !title.isEmpty { actions.add(title) }
        addDraft = ""
        adding = false
    }

    func cancelAdd() {
        addDraft = ""
        adding = false
    }

    /// How rows looked where they were captured, for the rows that have it open (SCR-31).
    /// A row whose lines were not kept shows that instead.
    @Published var previews: [Int: TaskContext] = [:]
    @Published var noPreview: Set<Int> = []

    func togglePreview(_ item: TaskItem, actions: TaskActions) {
        if previews[item.id] != nil || noPreview.contains(item.id) {
            previews[item.id] = nil
            noPreview.remove(item.id)
        } else if let context = actions.context(item) {
            previews[item.id] = context
        } else {
            noPreview.insert(item.id)
        }
    }

    func toggleWhy(_ item: TaskItem, actions: TaskActions) {
        if explanations[item.id] == nil {
            explanations[item.id] = actions.why(item)
        } else {
            explanations[item.id] = nil
        }
    }

    /// Put a row on the clipboard as text: a parent with everything under it, or
    /// just its title when `withSteps` is false. Changes nothing about the task.
    func copy(_ item: TaskItem, board: TaskBoard, actions: TaskActions, withSteps: Bool = true) {
        actions.copy(withSteps ? board.copyText(for: item) : item.title)
        copied = item.id
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            if self?.copied == item.id { self?.copied = nil }
        }
    }

    /// Returns false for keys this list has no use for.
    @discardableResult
    func handle(_ key: NavKey, board: TaskBoard, actions: TaskActions) -> Bool {
        let rows = rows(board)
        let index = selected.flatMap { id in rows.firstIndex { $0.id == id } }
        // The highlighted task has left the list (ticked by the engine, say).
        let lost = selected != nil && index == nil

        switch key {
        case .down:
            clearMarks()
            select(lost ? lastIndex : index.map { $0 + 1 } ?? 0, in: rows)
        case .up:
            clearMarks()
            select(lost ? lastIndex : index.map { $0 - 1 } ?? rows.count - 1, in: rows)
        case .extendUp, .extendDown:
            guard !rows.isEmpty else { return true }
            let down = key == .extendDown
            guard let index else {
                // Nothing highlighted yet: start at the end the arrow points from.
                clearMarks()
                select(lost ? lastIndex : (down ? 0 : rows.count - 1), in: rows)
                anchor = selected
                return true
            }
            let start = anchor.flatMap { id in rows.firstIndex { $0.id == id } } ?? index
            select(index + (down ? 1 : -1), in: rows)
            anchor = rows[start].id
            marked = Set(rows[min(start, lastIndex)...max(start, lastIndex)].map(\.id))
        case .selectAll:
            // Only what is on show: under a search, only the rows it found.
            guard !rows.isEmpty else { return true }
            marked = Set(rows.map(\.id))
            if index == nil { select(0, in: rows) }
            anchor = selected
        case .view(let number):
            guard scope == .window, TaskBoard.Filter.allCases.indices.contains(number) else { return false }
            filter = TaskBoard.Filter.allCases[number]
        case .foldAll, .unfoldAll:
            actions.setAllCollapsed(key == .foldAll)
        case .recentlyDone:
            guard scope == .popover else { return false }
            actions.toggleRecentlyDone()
        case .previousView, .nextView:
            // As in any outline: ← folds a parent, or on a step goes to its parent; → shows a
            // folded parent's steps, or on an open parent goes to its first step.
            if let index {
                let item = rows[index]
                switch Self.outlineMove(key == .previousView ? .fold : .unfold, item: item, rows: rows) {
                case .setCollapsed(let collapsed): actions.setCollapsed(item, collapsed); return true
                case .select(let id): if let at = rows.firstIndex(where: { $0.id == id }) { select(at, in: rows) }; return true
                case .nothing: if item.isGroup || item.parentID != nil { return true }
                }
            }
            guard scope == .window else { return false }
            let all = TaskBoard.Filter.allCases
            let current = all.firstIndex(of: filter) ?? 0
            filter = all[min(max(current + (key == .nextView ? 1 : -1), 0), all.count - 1)]
        case .toggle, .snooze, .dismiss, .why, .preview, .rename, .notYet, .goToSource, .missed:
            if key == .toggle || key == .snooze || key == .dismiss, !chosenTogether(rows).isEmpty {
                actOnChosen(key, rows: rows, board: board, actions: actions)
                return true
            }
            // Nothing highlighted, nothing done: a key never acts on a row the user cannot see marked.
            guard let index, rows[index].allows(key) else { return true }
            let item = rows[index]
            if key == .rename {
                startRenaming(item)
                return true
            }
            if key == .notYet {
                actions.notYet(item)
                return true
            }
            if key == .goToSource {
                actions.goToSource(item)
                return true
            }
            if key == .preview {
                togglePreview(item, actions: actions)
                return true
            }
            if Self.leavesItsPlace(item, after: key) {
                moveOff(index, in: rows)
            }
            switch key {
            case .toggle:
                if item.status == .open { actions.setDone(item, true) } else { actions.reopen(item) }
            case .snooze: actions.snooze(item, "1h")
            case .dismiss: actions.dismiss(item)
            case .missed: actions.missed(item)
            default: toggleWhy(item, actions: actions)
            }
        case .tickConversation:
            // Only from a highlighted row that is listed as pending, and only that row's conversation.
            // Never while a search hides rows: it would tick tasks that are not on show.
            guard !isNarrowed else { return true }
            guard let index, scope == .popover || filter == .pending,
                  let section = board.pendingSection(containing: rows[index]),
                  let handle = section.tickAllHandle else { return true }
            let leaving = Set(section.rows.map(\.id))
            let first = rows.firstIndex { leaving.contains($0.id) } ?? index
            if let next = rows[index...].first(where: { !leaving.contains($0.id) }) {
                selected = next.id
                lastIndex = first
            } else if let previous = rows[..<first].last {
                selected = previous.id
                lastIndex = first - 1
            } else {
                selected = nil
            }
            actions.completeConversation(handle)
        case .copy:
            let together = Self.outermost(chosenTogether(rows), board: board)
            if !together.isEmpty {
                actions.copy(together.map { board.copyText(for: $0) }.joined(separator: "\n"))
                return true
            }
            // With no row highlighted ⌘C is not ours: let it reach whatever else can copy.
            guard let index else { return false }
            copy(rows[index], board: board, actions: actions)
        case .search:
            searching = true
        case .add:
            startAdding()
        case .close, .openWindow, .pause:
            return false
        }
        return true
    }

    /// The rows chosen together that are still on show, top to bottom. Empty
    /// unless more than one row is chosen, so one row works exactly as before.
    enum Direction { case fold, unfold }

    /// ← on an open parent folds it; on a step (or a folded parent) goes to its parent.
    /// → on a folded parent shows its steps; on an open one goes to its first step.
    static func outlineMove(_ direction: Direction, item: TaskItem, rows: [TaskItem]) -> OutlineMove {
        switch direction {
        case .fold:
            if item.isGroup, !item.collapsed { return .setCollapsed(true) }
            if let parent = item.parentID, rows.contains(where: { $0.id == parent }) { return .select(parent) }
            return .nothing
        case .unfold:
            guard item.isGroup else { return .nothing }
            if item.collapsed { return .setCollapsed(false) }
            if let child = rows.first(where: { $0.parentID == item.id }) { return .select(child.id) }
            return .nothing
        }
    }

    func chosenTogether(_ rows: [TaskItem]) -> [TaskItem] {
        let chosen = rows.filter { marked.contains($0.id) }
        return chosen.count > 1 ? chosen : []
    }

    /// Leaves out a step whose checklist (or any parent above it) is chosen too:
    /// what is done to the parent the engine does to its steps.
    static func outermost(_ chosen: [TaskItem], board: TaskBoard) -> [TaskItem] {
        let ids = Set(chosen.map(\.id))
        let parents = Dictionary(board.tasks.map { ($0.id, $0.parentID) }, uniquingKeysWith: { first, _ in first })
        return chosen.filter { item in
            var parent = item.parentID
            var seen = Set<Int>()
            while let id = parent, seen.insert(id).inserted {
                if ids.contains(id) { return false }
                parent = parents[id] ?? nil
            }
            return true
        }
    }

    /// Space, S or D with several rows chosen. Space ticks every open one, and
    /// reopens only when none of them is open, so a mixed choice never undoes
    /// finished work. S and D act on the open ones only, as on a single row.
    private func actOnChosen(_ key: NavKey, rows: [TaskItem], board: TaskBoard, actions: TaskActions) {
        let chosen = chosenTogether(rows)
        let targets = Self.outermost(chosen, board: board)
        let open = targets.filter { $0.status == .open }
        switch key {
        case .toggle:
            if open.isEmpty { targets.forEach { actions.reopen($0) } } else { open.forEach { actions.setDone($0, true) } }
        case .snooze: open.forEach { actions.snooze($0, "1h") }
        case .dismiss: open.forEach { actions.dismiss($0) }
        default: return
        }
        // Highlight the first row after the chosen ones, or failing that the one before them.
        let ids = Set(chosen.map(\.id))
        let first = rows.firstIndex { ids.contains($0.id) } ?? 0
        let last = rows.lastIndex { ids.contains($0.id) } ?? 0
        clearMarks()
        if let next = rows[(last + 1)...].first(where: { !ids.contains($0.id) }) {
            selected = next.id
            lastIndex = first
        } else if let previous = rows[..<first].last {
            selected = previous.id
            lastIndex = first - 1
        } else {
            selected = nil
        }
    }

    /// A step stays under its checklist when ticked or snoozed; everything else moves to another view.
    private static func leavesItsPlace(_ item: TaskItem, after key: NavKey) -> Bool {
        switch key {
        case .dismiss: return true
        case .toggle, .snooze: return item.parentID == nil
        default: return false
        }
    }

    private func select(_ index: Int, in rows: [TaskItem]) {
        guard !rows.isEmpty else {
            selected = nil
            return
        }
        lastIndex = min(max(index, 0), rows.count - 1)
        selected = rows[lastIndex].id
    }

    /// Highlight the row that will take this one's place: the next one that is
    /// not one of its own steps, or failing that the one before.
    private func moveOff(_ index: Int, in rows: [TaskItem]) {
        let item = rows[index]
        // Everything deeper than this row, straight after it, is its own and goes with it.
        if let next = rows[(index + 1)...].first(where: { $0.depth <= item.depth }) {
            selected = next.id
            lastIndex = index
        } else if index > 0 {
            selected = rows[index - 1].id
            lastIndex = index - 1
        } else {
            selected = nil
        }
    }
}
