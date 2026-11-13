import Foundation

/// A task as the app shows it. Tasks are written by the engine; the app reads
/// them and asks the engine to change them.
struct TaskItem: Identifiable, Equatable {
    enum Status: String {
        case open, done, dismissed, snoozed
    }

    var id: Int
    var title: String
    var status: Status
    /// Where it came from, e.g. "Claude — Stripe webhooks".
    var source: String
    /// The checklist this step belongs to.
    var parentID: Int?
    /// True for a checklist (a parent task).
    var isGroup: Bool
    var doneAt: Date?
    var snoozedUntil: Date?
    /// When the engine first wrote it down.
    var capturedAt: Date?
    /// A parent whose children are folded away.
    var collapsed = false
    /// True when the engine can tick this by itself.
    var auto = false
    /// Set while the task looks done and waits for a yes or no: where that was seen.
    var suggestion: String?
    /// The latest thing the engine noted about it, e.g. "Ran `git status` in Ghostty".
    var note: String?
    /// When the engine last saw it asked for or changed it.
    var activeAt: Date?
    /// Set when it was ticked for you because it looked done: where it looked done.
    var acceptedFrom: String?
    /// For an item brought in from a connected tool (Linear): its key ("PMO-12") and address.
    var externalKey: String? = nil
    var externalURL: String? = nil
    /// Suggested as the same thing as another task seen elsewhere: that task's id, wording and place.
    var mergeWith: Int? = nil
    var mergeWithTitle: String? = nil
    var mergeWithSource: String? = nil
    /// Where the tasks merged into this one were seen ("Teams — Sam Carter").
    var alsoFrom: [String] = []
    /// Who asked, for a task from an email or a chat: "Jordan Lee via Docusign".
    var asker: String? = nil
    /// Kept while no model could say whether its list is yours or Claude's own plan (SCR-70).
    var maybe = false

    /// The confidence the engine writes on a "maybe" list (engine `MAYBE_CONFIDENCE`); every other
    /// list is stored above `maybeLimit`.
    static let maybeLimit = 0.25

    /// The asker from what the engine keeps: a chat's sender, or the name in an email's
    /// "From an email: <name> — “<subject>”" note. Nil for yourself and for anything else.
    static func asker(chatFrom: String?, origin: String?) -> String? {
        if let from = chatFrom?.trimmingCharacters(in: .whitespaces), !from.isEmpty {
            return from.lowercased() == "me" ? nil : from
        }
        guard let origin, origin.hasPrefix("From an email: ") else { return nil }
        let rest = origin.dropFirst("From an email: ".count)
        let name = rest.range(of: " — “").map { String(rest[..<$0.lowerBound]) } ?? String(rest)
        let clean = name.trimmingCharacters(in: .whitespaces)
        return clean.isEmpty ? nil : clean
    }
    /// How far in the row sits: 0 for a checklist or loose task, 1 for its steps, and so on.
    /// Set by `TaskBoard` when it lays rows out.
    var depth = 0
}

/// The small note of how long ago a row was captured: "5 min ago", "2h 15m ago",
/// and the date and time once it is more than a day old.
enum CapturedLabel {
    /// Nil for rows that carry no note: a step shares its checklist's, and a
    /// snoozed row shows when it wakes instead.
    static func text(for item: TaskItem, now: Date, calendar: Calendar = .current,
                     locale: Locale = .current) -> String? {
        guard item.parentID == nil, item.status != .snoozed, let captured = item.capturedAt else { return nil }
        return text(captured: captured, now: now, calendar: calendar, locale: locale)
    }

    static func text(captured: Date, now: Date, calendar: Calendar = .current,
                     locale: Locale = .current) -> String {
        // A clock that moved backwards must not produce "-3 min ago".
        let minutes = Int(max(0, now.timeIntervalSince(captured)) / 60)
        if minutes < 1 { return "just now" }
        if minutes < 60 { return "\(minutes) min ago" }
        if minutes < 24 * 60 {
            let rest = minutes % 60
            return rest == 0 ? "\(minutes / 60)h ago" : "\(minutes / 60)h \(rest)m ago"
        }
        var style = Date.FormatStyle(locale: locale, calendar: calendar, timeZone: calendar.timeZone)
            .day().month(.abbreviated).hour().minute()
        if !calendar.isDate(captured, equalTo: now, toGranularity: .year) { style = style.year() }
        return captured.formatted(style)
    }
}

/// All known tasks, arranged for display.
struct TaskBoard: Equatable {
    /// The views the task window offers.
    enum Filter: String, CaseIterable, Identifiable {
        case pending = "Pending"
        case snoozed = "Snoozed"
        case done = "Done"
        case dismissed = "Dismissed"

        var id: String { rawValue }
        var status: TaskItem.Status {
            switch self {
            case .pending: return .open
            case .snoozed: return .snoozed
            case .done: return .done
            case .dismissed: return .dismissed
            }
        }
    }

    /// A checklist with the rows shown under it, or a loose task with none.
    struct Entry: Identifiable, Equatable {
        var task: TaskItem
        /// Everything on show under the checklist, top to bottom, each row with its
        /// depth. Children of a collapsed parent are left out.
        var steps: [TaskItem]
        var id: Int { task.id }
        /// "1/3" for a checklist: steps done out of all its steps, at any depth.
        var progress: String?
    }

    struct Section: Identifiable, Equatable {
        var source: String
        var entries: [Entry]
        var id: String { source }
        /// Every row drawn under this heading.
        var rows: [TaskItem] { entries.flatMap { [$0.task] + $0.steps } }
        /// A task that names this conversation to the engine when all of it is
        /// ticked at once. Nil when nothing here is open, so there is nothing to tick.
        var tickAllHandle: TaskItem? { entries.first { $0.task.status == .open }?.task }
    }

    /// How the lists are ordered.
    enum Sort: String, CaseIterable, Identifiable {
        /// Grouped by where tasks came from, the newest conversation or mailbox first.
        case source
        /// Whatever was asked or seen most recently first, whichever app it came from.
        case latest

        var id: String { rawValue }
        var label: String { self == .source ? "By Source" : "Latest Activity First" }
    }

    /// In the order the store returns them: newest source first, steps after their parent.
    var tasks: [TaskItem] = [] {
        didSet { children = Self.childIndex(tasks) }
    }
    /// Each parent's direct children, in list order. Built once per list, so finding a
    /// row's steps never scans every task (SCR-32: thousands of tasks made each draw slow).
    private(set) var children: [Int: [TaskItem]] = [:]

    init(tasks: [TaskItem] = [], lingering: Set<Int> = [], showsRecentlyDone: Bool = true,
         sort: Sort = .source, focus: String? = nil) {
        self.tasks = tasks
        self.children = Self.childIndex(tasks)
        self.lingering = lingering
        self.showsRecentlyDone = showsRecentlyDone
        self.sort = sort
        self.focus = focus
    }

    static func childIndex(_ tasks: [TaskItem]) -> [Int: [TaskItem]] {
        var index: [Int: [TaskItem]] = [:]
        for task in tasks { if let parent = task.parentID { index[parent, default: []].append(task) } }
        return index
    }

    private func childrenOf(_ id: Int) -> [TaskItem] { children[id] ?? [] }
    /// Top-level items finished a moment ago. They stay where they were, ticked
    /// and with their steps on show, before moving to "Recently done", so you
    /// see the tick land instead of the row vanishing.
    var lingering: Set<Int> = []
    /// Whether the panel's "Recently done" list is unfolded.
    var showsRecentlyDone = true
    var sort = Sort.source
    /// Show only what came from this app ("Claude", "Gmail"). Nil shows everything.
    var focus: String?

    /// The app a task came from: its source up to the dash, so "Claude — Stripe
    /// webhooks" and "Claude — Billing" are both "Claude".
    static func app(of source: String) -> String {
        let app = source.components(separatedBy: " — ").first ?? source
        // "Claude Code (Ghostty)": a Claude Code session with no title names its terminal in brackets.
        if app.hasPrefix("Claude Code (") { return "Claude Code" }
        return app
    }

    /// The apps there is anything from, for choosing a focus. Includes the current
    /// focus even when nothing is left from it, so it can still be seen and cleared.
    var apps: [String] {
        var names = Set(tasks.filter { $0.parentID == nil }.map { Self.app(of: $0.source) })
        if let focus { names.insert(focus) }
        return names.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }

    private func inFocus(_ item: TaskItem) -> Bool {
        focus == nil || Self.app(of: item.source) == focus
    }

    /// When a task, or anything under it, was last asked for or seen.
    func activity(of item: TaskItem) -> Date {
        descendants(of: item).reduce(item.activeAt ?? item.capturedAt ?? .distantPast) { latest, child in
            max(latest, child.activeAt ?? child.capturedAt ?? .distantPast)
        }
    }

    /// How long a finished item stays in place.
    static let lingerSeconds: TimeInterval = 3

    /// The top-level items that were finished within the last few seconds.
    static func lingering(in tasks: [TaskItem], now: Date) -> Set<Int> {
        Set(tasks.filter { item in
            guard item.parentID == nil, item.status == .done, let done = item.doneAt else { return false }
            let age = now.timeIntervalSince(done)
            return age >= 0 && age < lingerSeconds
        }.map(\.id))
    }

    /// Checklists and loose tasks in the given state, grouped by where they came from.
    /// Steps are shown under their checklist whatever their own state, except
    /// dismissed ones, which only appear in the dismissed view.
    func sections(_ filter: Filter) -> [Section] {
        var sections: [Section] = []
        var at: [String: Int] = [:]
        for entry in entries(filter) {
            if let index = at[entry.task.source] {
                sections[index].entries.append(entry)
            } else {
                at[entry.task.source] = sections.count
                sections.append(Section(source: entry.task.source, entries: [entry]))
            }
        }
        return sections
    }

    func entries(_ filter: Filter) -> [Entry] {
        var entries = tasks
            .filter { item in
                guard item.parentID == nil, inFocus(item) else { return false }
                // Just finished: still listed as pending, not yet as done.
                if lingering.contains(item.id) { return filter == .pending }
                return item.status == filter.status
            }
            .map { item -> Entry in
                var top = item
                // While it lingers, a finished checklist shows its steps, ticked, even if it was folded.
                if lingering.contains(top.id) { top.collapsed = false }
                return Entry(task: top, steps: rows(under: top, depth: 1, showDismissed: filter == .dismissed),
                             progress: progress(of: top))
            }
        if filter == .done {
            entries.sort { ($0.task.doneAt ?? .distantPast) > ($1.task.doneAt ?? .distantPast) }
        } else if sort == .latest {
            // Sections follow from this: each appears where its most recent entry is.
            let stamped = entries.map { (entry: $0, at: activity(of: $0.task)) }
            entries = stamped.enumerated()
                .sorted { $0.element.at != $1.element.at ? $0.element.at > $1.element.at : $0.offset < $1.offset }
                .map(\.element.entry)
        }
        return entries
    }

    /// The rows shown under a parent, depth first. A collapsed parent shows none.
    private func rows(under parent: TaskItem, depth: Int, showDismissed: Bool) -> [TaskItem] {
        guard !parent.collapsed else { return [] }
        return childrenOf(parent.id)
            .filter { showDismissed || $0.status != .dismissed }
            .flatMap { child -> [TaskItem] in
                var row = child
                row.depth = depth
                return [row] + rows(under: child, depth: depth + 1, showDismissed: showDismissed)
            }
    }

    /// The steps (not parents) under a task at any depth, leaving out dismissed ones.
    func steps(under item: TaskItem) -> [TaskItem] {
        childrenOf(item.id).filter { $0.status != .dismissed }
            .flatMap { $0.isGroup ? steps(under: $0) : [$0] }
    }

    /// "1/3" for a parent, nil for a step.
    func progress(of item: TaskItem) -> String? {
        guard item.isGroup else { return nil }
        let all = steps(under: item)
        return "\(all.filter { $0.status == .done }.count)/\(all.count)"
    }

    /// True when some but not all of a parent's steps are done.
    func isPartlyDone(_ item: TaskItem) -> Bool {
        guard item.isGroup, item.status == .open else { return false }
        return steps(under: item).contains { $0.status == .done }
    }

    /// A row as plain text for the clipboard. A step or loose task is its title.
    /// A parent is its title followed by everything under it as an indented
    /// checklist, folded or not, with done steps ticked. Dismissed steps are left
    /// out unless the parent itself is dismissed. Titles only: no notes, no evidence.
    func copyText(for item: TaskItem) -> String {
        ([item.title] + copyLines(under: item, depth: 0, showDismissed: item.status == .dismissed))
            .joined(separator: "\n")
    }

    private func copyLines(under parent: TaskItem, depth: Int, showDismissed: Bool) -> [String] {
        childrenOf(parent.id).filter { showDismissed || $0.status != .dismissed }
            .flatMap { child -> [String] in
                let line = String(repeating: "  ", count: depth) + "- [\(child.status == .done ? "x" : " ")] " + child.title
                return [line] + copyLines(under: child, depth: depth + 1, showDismissed: showDismissed)
            }
    }

    /// The same, narrowed to checklists and tasks that mention `query` in their
    /// own title or in any step under them.
    func sections(_ filter: Filter, matching query: String, byDay: Bool = false, now: Date = Date(),
                  calendar: Calendar = .current) -> [Section] {
        let needle = Self.needle(query)
        let base = byDay ? sectionsByDay(filter, now: now, calendar: calendar) : sections(filter)
        guard !needle.isEmpty else { return base }
        return base.compactMap { section in
            let kept = section.entries.filter { mentions($0, needle) }
            return kept.isEmpty ? nil : Section(source: section.source, entries: kept)
        }
    }

    /// What a search looks for: the typed text without the spaces around it, in
    /// lower case. Empty means "not searching".
    static func needle(_ query: String) -> String {
        query.trimmingCharacters(in: .whitespaces).lowercased()
    }

    /// True when the entry's own title, or any step under it (folded away or not), holds the needle.
    /// Dismissed steps are not listed under an entry, so they do not count, except in the dismissed view.
    private func mentions(_ entry: Entry, _ needle: String) -> Bool {
        entry.task.title.lowercased().contains(needle)
            || listed(under: entry.task, showDismissed: entry.task.status == .dismissed)
                .contains { $0.title.lowercased().contains(needle) }
    }

    /// Everything that can be listed under a task, at any depth, whether or not it is folded away.
    private func listed(under item: TaskItem, showDismissed: Bool) -> [TaskItem] {
        childrenOf(item.id).filter { showDismissed || $0.status != .dismissed }
            .flatMap { [$0] + listed(under: $0, showDismissed: showDismissed) }
    }

    /// Everything under a task, at any depth.
    private func descendants(of item: TaskItem) -> [TaskItem] {
        childrenOf(item.id).flatMap { [$0] + descendants(of: $0) }
    }

    /// Finished work by the day it was finished: "Today", "Yesterday", then dates. Newest first.
    func sectionsByDay(_ filter: Filter, now: Date = Date(), calendar: Calendar = .current) -> [Section] {
        var sections: [Section] = []
        for entry in entries(filter) {
            let label = Self.dayLabel(entry.task.doneAt, now: now, calendar: calendar)
            if let index = sections.firstIndex(where: { $0.source == label }) {
                sections[index].entries.append(entry)
            } else {
                sections.append(Section(source: label, entries: [entry]))
            }
        }
        return sections
    }

    static func dayLabel(_ date: Date?, now: Date, calendar: Calendar) -> String {
        guard let date else { return "Earlier" }
        if calendar.isDate(date, inSameDayAs: now) { return "Today" }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(date, inSameDayAs: yesterday) {
            return "Yesterday"
        }
        var style = Date.FormatStyle(calendar: calendar, timeZone: calendar.timeZone).weekday(.wide).day().month(.wide)
        if !calendar.isDate(date, equalTo: now, toGranularity: .year) { style = style.year() }
        return date.formatted(style)
    }

    /// The pending conversation a row is listed under, if it is listed there.
    func pendingSection(containing item: TaskItem) -> Section? {
        sections(.pending).first { $0.rows.contains { $0.id == item.id } }
    }

    /// What the popover lists under "Recently done".
    var recentlyDone: [Entry] { recentlyDone(matching: "") }

    /// The same while searching: the five most recently finished that mention `query`.
    func recentlyDone(matching query: String) -> [Entry] {
        let needle = Self.needle(query)
        return Array(entries(.done).filter { needle.isEmpty || mentions($0, needle) }.prefix(5))
    }

    /// Every row a view shows, top to bottom: each checklist followed by its steps.
    func rows(_ filter: Filter) -> [TaskItem] {
        sections(filter).flatMap(\.rows)
    }

    /// Every row the popover shows: what is pending, then what was just finished.
    var popoverRows: [TaskItem] { popoverRows(matching: "") }

    /// The popover's rows while a search narrows it.
    func popoverRows(matching query: String) -> [TaskItem] {
        sections(.pending, matching: query).flatMap(\.rows)
            + (showsRecentlyDone ? recentlyDone(matching: query).map(\.task) : [])
    }

    func count(_ filter: Filter) -> Int {
        tasks.filter { $0.parentID == nil && $0.status == filter.status && inFocus($0) }.count
    }

    /// Things still to do: open steps and open loose tasks.
    var openStepCount: Int {
        let byID = Dictionary(tasks.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return tasks.filter { item in
            guard !item.isGroup, item.status == .open, inFocus(item) else { return false }
            // Every parent above it must be open too.
            var parent = item.parentID.flatMap { byID[$0] }
            while let current = parent {
                if current.status != .open { return false }
                parent = current.parentID.flatMap { byID[$0] }
            }
            return true
        }.count
    }
}
