import SwiftUI

/// What the views can ask for. The app wires these to the engine; previews and
/// tests can leave them empty.
struct TaskActions {
    var setDone: (TaskItem, Bool) -> Void = { _, _ in }
    /// "1h", "3h" or "tomorrow".
    var snooze: (TaskItem, String) -> Void = { _, _ in }
    var dismiss: (TaskItem) -> Void = { _ in }
    var reopen: (TaskItem) -> Void = { _ in }
    /// Tick everything still open from the conversation this task came from.
    var completeConversation: (TaskItem) -> Void = { _ in }
    /// The engine's explanation of what would tick a task and what it has seen.
    var why: (TaskItem) -> String = { _ in "" }
    /// Give an item your own name. An empty name goes back to the captured one.
    var rename: (TaskItem, String) -> Void = { _, _ in }
    /// A task marked "looks done?" is not done: keep it open and stop asking from that place.
    var notYet: (TaskItem) -> Void = { _ in }
    /// The same thing seen in two places: merge this task with the one suggested, or say they differ.
    var merge: (TaskItem) -> Void = { _ in }
    var notSame: (TaskItem) -> Void = { _ in }
    /// This was never something for you to do: dismiss it and teach the model so.
    var notAnAction: (TaskItem) -> Void = { _ in }
    /// A task ticked for you because it looked done was not done: reopen it and teach the model so.
    var notDone: (TaskItem) -> Void = { _ in }
    /// Fold a parent's steps away, or show them again.
    var setCollapsed: (TaskItem, Bool) -> Void = { _, _ in }
    /// Fold every parent, or unfold them all.
    var setAllCollapsed: (Bool) -> Void = { _ in }
    /// Put this text on the clipboard.
    var copy: (String) -> Void = { _ in }
    /// Go back to the window it was captured in, scrolled to where it was.
    var goToSource: (TaskItem) -> Void = { _ in }
    /// Add a task of your own, with this title (SCR-29).
    var add: (String) -> Void = { _ in }
    /// The Suggested tray (SCR-95): make a suggestion a task, or teach that it was not an action.
    var acceptSuggestion: (SuggestedAsk) -> Void = { _ in }
    var dismissSuggestion: (SuggestedAsk) -> Void = { _ in }
    /// How it looked where it was captured, while it is open (SCR-31). Nil when not kept.
    var context: (TaskItem) -> TaskContext? = { _ in nil }
    /// The canvases there are, and sending tasks to one (nil: a new one) (SCR-49).
    var canvases: () -> [CanvasSummary] = { [] }
    var sendToCanvas: ([TaskItem], Int?) -> Void = { _, _ in }
    /// Didja Missed This…: you did it and Didja did not notice. A report, and where you did it.
    var missed: (TaskItem) -> Void = { _ in }
    /// Show or hide "Recently done" in the Quick View (H).
    var toggleRecentlyDone: () -> Void = {}
}

/// The app's few colours, each with a light and a dark value: the Didja brand (SCR-34,
/// brand/README.md). Ink and highlighter yellow; green only for done; amber, never red,
/// for what needs you.
enum Palette {
    /// Marks (a page's symbol, "looks done"): ink in light mode, highlighter in dark.
    /// Never a button fill: buttons use `Palette.ink` (DidjaStyle.swift, SCR-43).
    static let accent = dynamic(light: 0x141414, dark: 0xFFD93D)
    static let accentText = dynamic(light: 0x141414, dark: 0xFFD93D)
    static let done = dynamic(light: 0x1F7A4D, dark: 0x3FB877)
    static let selection = dynamic(light: 0xFFF6CC, dark: 0x3A3216)
    static let chip = dynamic(light: 0xF1F0EA, dark: 0x2A2A27)
    static let source = dynamic(light: 0x5B5B55, dark: 0xA8A8A0)
    static let attention = dynamic(light: 0x9A4A00, dark: 0xF0A35C)
    /// The panel's and window's own background: flat, not the system's translucent material.
    static let surface = Color(nsColor: surfaceNS)
    /// Paper in light mode, near-black in dark.
    static let surfaceNS = nsDynamic(light: 0xFAFAF7, dark: 0x161615)

    static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(nsColor: nsDynamic(light: light, dark: dark))
    }

    static func nsDynamic(light: UInt32, dark: UInt32) -> NSColor {
        NSColor(name: nil) { appearance in
            let hex = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
            return NSColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                           blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
        }
    }
}

/// Light, dark, or whatever the Mac is set to.
enum AppearanceSetting: String, CaseIterable, Identifiable {
    case system, light, dark

    static let defaultsKey = "appearance"

    var id: String { rawValue }
    var label: String {
        switch self {
        case .system: return "Follow System"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }

    /// Nil means "follow the system".
    var appearance: NSAppearance? {
        switch self {
        case .system: return nil
        case .light: return NSAppearance(named: .aqua)
        case .dark: return NSAppearance(named: .darkAqua)
        }
    }

    static var saved: AppearanceSetting {
        AppearanceSetting(rawValue: UserDefaults.standard.string(forKey: defaultsKey) ?? "") ?? .system
    }

    /// Use this look for the panel and the task window, now and at the next launch.
    func apply() {
        UserDefaults.standard.set(rawValue, forKey: Self.defaultsKey)
        NSApplication.shared.appearance = appearance
        NotificationCenter.default.post(name: Self.didChange, object: nil)
    }

    static let didChange = Notification.Name("DidjaAppearanceDidChange")

    /// The look to draw with right now: the chosen one, or the system's.
    static var current: NSAppearance {
        if let chosen = saved.appearance { return chosen }
        let dark = UserDefaults.standard.string(forKey: "AppleInterfaceStyle") == "Dark"
        return NSAppearance(named: dark ? .darkAqua : .aqua) ?? NSApplication.shared.effectiveAppearance
    }
}

/// The mark at the start of a row: open, partly done, done, snoozed or dismissed.
struct StatusMark: View {
    let status: TaskItem.Status
    var partlyDone = false
    /// Looks done, waiting for a yes or no.
    var suggested = false

    var body: some View {
        Group {
            switch status {
            case .done:
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.done)
            case .snoozed:
                Image(systemName: "moon").foregroundStyle(.secondary)
            case .dismissed:
                Image(systemName: "xmark.circle").foregroundStyle(.secondary)
            case .open:
                if suggested {
                    // Looks done, not confirmed: a dotted circle with a tick in it.
                    Image(systemName: "checkmark.circle.badge.questionmark").foregroundStyle(Palette.accent)
                } else if partlyDone {
                    // A quarter-filled circle: some of it is done.
                    ZStack {
                        Circle().stroke(Palette.accent, lineWidth: 1.4)
                        Circle().trim(from: 0, to: 0.25).rotation(.degrees(-90))
                            .stroke(Palette.accent, lineWidth: 6.5).padding(3.25)
                    }
                    .frame(width: 13.5, height: 13.5)
                } else {
                    Image(systemName: "circle").foregroundStyle(.secondary)
                }
            }
        }
        .font(.system(size: 15))
        .frame(width: 18, height: 18)
    }
}

/// One checklist, step or loose task.
struct TaskRow: View {
    let item: TaskItem
    var progress: String?
    /// Kept for callers that lay rows out themselves; rows built by `TaskBoard` carry their depth.
    var isStep = false
    var partlyDone = false
    /// False where a parent's steps are not listed, so there is nothing to fold.
    var showsDisclosure = true
    /// Where the row's steps are looked up when it is copied. Without one, a row copies as its title.
    var board = TaskBoard()
    let actions: TaskActions
    @ObservedObject var navigator: TaskNavigator

    @State private var hovering = false
    @FocusState private var nameFocused: Bool

    /// Drawn as chosen: the highlighted row, or one of several chosen together.
    private var isSelected: Bool { navigator.isChosen(item.id) }
    /// The one row keys like R, W and G act on. Only it shows its buttons and note.
    private var isHighlighted: Bool { navigator.selected == item.id }
    private var isEditing: Bool { navigator.editing == item.id }
    private var showsButtons: Bool { (hovering || isHighlighted) && !isEditing }
    private var depth: Int { max(item.depth, isStep ? 1 : 0) }

    var body: some View {
        HStack(alignment: .top, spacing: 4) {
            Button { actions.setCollapsed(item, !item.collapsed) } label: {
                Image(systemName: "chevron.right")
                    .font(.system(size: 9, weight: .bold))
                    .rotationEffect(.degrees(item.collapsed ? 0 : 90))
                    .frame(width: 14, height: 18)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .opacity(item.isGroup && showsDisclosure ? 1 : 0)
            .allowsHitTesting(item.isGroup && showsDisclosure)
            .accessibilityHidden(!(item.isGroup && showsDisclosure))
            .help(item.collapsed ? "Show its steps" : "Fold its steps away")

            Button(action: toggle) {
                StatusMark(status: item.status, partlyDone: partlyDone, suggested: item.suggestion != nil)
            }
            .buttonStyle(.plain)
            .help(item.status == .open ? "Mark done" : "Reopen")

            VStack(alignment: .leading, spacing: 2) {
                if isEditing {
                    TextField("Name", text: $navigator.draft)
                        .textFieldStyle(.plain)
                        .fontWeight(weight)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(RoundedRectangle(cornerRadius: 5).fill(Color(nsColor: .textBackgroundColor)))
                        .overlay(RoundedRectangle(cornerRadius: 5).stroke(Palette.accent, lineWidth: 1.5))
                        .focused($nameFocused)
                        .onAppear { nameFocused = true }
                        .onSubmit { navigator.commitRename(item, actions: actions) }
                        .onExitCommand { navigator.cancelRename() }
                        .onChange(of: nameFocused) { _, focused in
                            if !focused { navigator.commitRename(item, actions: actions) }
                        }
                } else {
                    Text(Self.styled(item.title))
                        .fontWeight(weight)
                        .strikethrough(item.status == .done)
                        .foregroundStyle(item.status == .open && !item.maybe && !item.checking ? Color.primary : Color.secondary)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 1)
                        .help(item.madeHelp ?? "")
                        .onTapGesture(count: 2) { navigator.startRenaming(item) }
                        .onTapGesture {
                            let held = NSEvent.modifierFlags
                            navigator.click(item, board: board, command: held.contains(.command), shift: held.contains(.shift))
                        }
                }
                if let asker = item.asker, !isEditing {
                    Text("from \(asker)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if let place = item.suggestion, item.status == .open, !isEditing {
                    // Never ticked for you: the app only asks.
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Looks done · seen in \(place)")
                            .font(.caption)
                            .foregroundStyle(Palette.accentText)
                            .fixedSize(horizontal: false, vertical: true)
                        HStack(spacing: 6) {
                            Button("Yes, done") { actions.setDone(item, true) }.buttonStyle(DidjaButtonStyle(kind: .primary, size: .small))
                            Button("Not yet") { actions.notYet(item) }.buttonStyle(DidjaButtonStyle(kind: .secondary, size: .small))
                        }
                    }
                    .padding(.vertical, 2)
                } else if let other = item.mergeWithTitle, item.status == .open, !isEditing {
                    // The same thing seen in two places? Shown to you; merged only on your word.
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Same as “\(other)”\(item.mergeWithSource.map { " in \($0)" } ?? "")?")
                            .font(.caption)
                            .foregroundStyle(Palette.accentText)
                            .fixedSize(horizontal: false, vertical: true)
                        HStack(spacing: 6) {
                            Button("Merge") { actions.merge(item) }.buttonStyle(DidjaButtonStyle(kind: .primary, size: .small))
                            Button("Not the same") { actions.notSame(item) }.buttonStyle(DidjaButtonStyle(kind: .secondary, size: .small))
                        }
                    }
                    .padding(.vertical, 2)
                } else if isHighlighted, !isEditing, let note = item.note {
                    Text(Self.styled(note)).font(.caption).foregroundStyle(.secondary)
                }
                if let context = navigator.previews[item.id] {
                    SourcePreview(context: context).padding(.vertical, 3)
                } else if navigator.noPreview.contains(item.id) {
                    Text(item.status == .open || item.status == .snoozed
                         ? "Not kept for this one: its lines were not found where it was captured."
                         : "Not kept: the lines go when a task is finished.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if let explanation = navigator.explanations[item.id] {
                    Text(explanation)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            }

            if let progress {
                Text(progress).font(.caption).monospacedDigit().foregroundStyle(.secondary).padding(.top, 2)
            }
            // Only this small note holds space at the end of the row, so titles get the width.
            // The buttons float over the row's end when it is hovered or highlighted: the
            // title wraps the same way either way and never shifts under the eye.
            Group {
                HStack(spacing: 6) {
                    if !item.alsoFrom.isEmpty {
                        Text("+\(item.alsoFrom.count)")
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .overlay(Capsule().stroke(Color.secondary.opacity(0.4), lineWidth: 1))
                            .help("Also seen in \(item.alsoFrom.joined(separator: ", ")), merged: they finish together.")
                    }
                    if let key = item.externalKey {
                        Button {
                            if let link = item.externalURL.flatMap(URL.init(string:)) { NSWorkspace.shared.open(link) }
                        } label: {
                            Text(key)
                                .font(.caption2.weight(.medium))
                                .foregroundStyle(Palette.accentText)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 1)
                                .overlay(Capsule().stroke(Palette.accentText.opacity(0.4), lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .help("From \(item.source): \(key). Click to open it there. Ticking it here updates it there, as set in Connections.")
                    }
                    if item.acceptedFrom != nil, item.status == .done {
                        Text("ticked for you")
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(Palette.done)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .overlay(Capsule().stroke(Palette.done.opacity(0.4), lineWidth: 1))
                            .help("Ticked for you because it looked done in \(item.acceptedFrom ?? ""). Reopen it if it is not done.")
                    }
                    if let due = item.dueTag() {
                        // When the ask said it was due (SCR-97): orders the list and reminds you once; never ticks.
                        Text(due.text)
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(due.overdue ? Palette.attention : .secondary)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .overlay(Capsule().stroke((due.overdue ? Palette.attention : Color.secondary).opacity(0.4), lineWidth: 1))
                            .help("Due \(item.dueAt ?? ""), as the ask said. Didja reminds you once that day.")
                    }
                    if item.checking, item.status == .open, item.parentID == nil {
                        // The on-device model is deciding whether this list is yours (SCR-78).
                        Text("checking…")
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .overlay(Capsule().stroke(Color.secondary.opacity(0.35), lineWidth: 1))
                            .help("Didja is checking whether this list is for you or Claude's own plan. It goes if it is Claude's. Tick a step to say it is yours.")
                    }
                    if item.maybe, item.status == .open, item.parentID == nil {
                        // A quiet tag: no model could say whether this list is yours (SCR-70).
                        Text("maybe")
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .overlay(Capsule().stroke(Color.secondary.opacity(0.35), lineWidth: 1))
                            .help("No on-device model could say whether this list is for you or Claude's own plan. Dismiss it with Not an Action if it is not yours.")
                    }
                    if item.auto, item.status == .open {
                        Text("auto")
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(Palette.accentText)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .overlay(Capsule().stroke(Palette.accent.opacity(0.35), lineWidth: 1))
                            .help("Ticks itself when Didja sees this done")
                    }
                    if item.status == .snoozed, let until = item.snoozedUntil {
                        Text(until, style: .time).font(.caption).foregroundStyle(.secondary)
                    } else if item.capturedAt != nil {
                        // How long ago it was captured, redrawn each minute so it stays true.
                        TimelineView(.everyMinute) { timeline in
                            // The timeline's own date is the start of the minute, which would
                            // make the first drawing up to a minute short.
                            if let age = CapturedLabel.text(for: item, now: max(timeline.date, Date())) {
                                Text(age).font(.caption2).monospacedDigit().foregroundStyle(.tertiary)
                                    .lineLimit(1).fixedSize()
                                    .accessibilityLabel("Captured \(age)")
                            }
                        }
                    }
                }
                .opacity(showsButtons ? 0 : 1)
            }
            .padding(.top, 1)
        }
        .padding(.leading, CGFloat(depth) * 20)
        .padding(.vertical, 3)
        .padding(.horizontal, 6)
        .background(RoundedRectangle(cornerRadius: 7).fill(isSelected || isEditing ? Palette.selection : Color.clear))
        .overlay(alignment: .topTrailing) {
            HStack(spacing: 4) {
                iconButton(navigator.copied == item.id ? "checkmark" : "doc.on.doc",
                           item.isGroup ? "Copy with its steps (⌘C)" : "Copy (⌘C)") { copy() }
                iconButton("pencil", "Rename (R)") { navigator.startRenaming(item) }
                iconButton("text.viewfinder", "How it looked where it was captured (V)") { navigator.togglePreview(item, actions: actions) }
                if !item.isGroup { iconButton("questionmark.circle", "Why is this open or done? (W)") { toggleWhy() } }
                if item.status == .open {
                    iconButton("moon", "Snooze for an hour (S)") { actions.snooze(item, "1h") }
                    iconButton("xmark", "Dismiss: not a real to-do (D)") { actions.dismiss(item) }
                }
            }
            .padding(.leading, 10)
            .padding(.trailing, 6)
            .padding(.vertical, 3)
            // Covers the end of the title beneath it, fading in from the left.
            .background(
                LinearGradient(stops: [.init(color: rowBackground.opacity(0), location: 0),
                                       .init(color: rowBackground, location: 0.18)],
                               startPoint: .leading, endPoint: .trailing)
                    .clipShape(RoundedRectangle(cornerRadius: 7)))
            .opacity(showsButtons ? 1 : 0)
            .allowsHitTesting(showsButtons)
            .accessibilityHidden(!showsButtons)
            .animation(.easeOut(duration: 0.12), value: showsButtons)
        }
        .padding(.horizontal, -6)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .id(item.id)
        // Drag onto a canvas (SCR-50): the row, or all the rows chosen with it.
        .onDrag {
            let together = navigator.chosenTogether(navigator.rows(board))
            return TaskDrag.provider(together.contains(where: { $0.id == item.id }) ? together : [item])
        }
        .contextMenu {
            let together = navigator.chosenTogether(navigator.rows(board))
            if together.contains(where: { $0.id == item.id }) {
                // Several rows chosen: the same as Space, D and S on all of them.
                if together.contains(where: { $0.status == .open }) {
                    Button("Mark \(together.count) Chosen Done") { navigator.handle(.toggle, board: board, actions: actions) }
                    Button("Snooze \(together.count) Chosen for 1 Hour") { navigator.handle(.snooze, board: board, actions: actions) }
                    Button("Dismiss \(together.count) Chosen") { navigator.handle(.dismiss, board: board, actions: actions) }
                } else {
                    Button("Reopen \(together.count) Chosen") { navigator.handle(.toggle, board: board, actions: actions) }
                }
                Divider()
            }
            Button("Go to Source") { actions.goToSource(item) }
            let targets = together.contains(where: { $0.id == item.id }) ? together : [item]
            Menu(targets.count > 1 ? "Send \(targets.count) Chosen to Canvas" : "Send to Canvas") {
                Button("New Canvas") { actions.sendToCanvas(targets, nil) }
                let canvases = actions.canvases()
                if !canvases.isEmpty { Divider() }
                ForEach(canvases) { canvas in
                    Button(canvas.title) { actions.sendToCanvas(targets, canvas.id) }
                }
            }
            Button("Didja Missed This… (X)") { actions.missed(item) }
                .help("You did it and Didja did not notice: see why, report it, and say where you did it")
            Divider()
            if item.status == .open {
                Button("Mark Done") { actions.setDone(item, true) }
                Menu("Snooze") {
                    Button("For 1 Hour") { actions.snooze(item, "1h") }
                    Button("For 3 Hours") { actions.snooze(item, "3h") }
                    Button("Until Tomorrow") { actions.snooze(item, "tomorrow") }
                }
                Button("Dismiss") { actions.dismiss(item) }
            } else {
                Button("Reopen") { actions.reopen(item) }
            }
            if item.suggestion != nil {
                Button("Not Done Yet") { actions.notYet(item) }
            }
            if item.acceptedFrom != nil, item.status == .done {
                Button("Not Done (Teach It)") { actions.notDone(item) }
            }
            if item.status != .dismissed {
                Button("Not an Action (Teach It)") { actions.notAnAction(item) }
            }
            Button("Rename") { navigator.startRenaming(item) }
            if item.isGroup {
                Button("Copy with Steps") { copy() }
                Button("Copy Title") { navigator.copy(item, board: board, actions: actions, withSteps: false) }
            } else {
                Button("Copy") { copy() }
            }
            if item.isGroup {
                Button(item.collapsed ? "Expand" : "Collapse") { actions.setCollapsed(item, !item.collapsed) }
            } else {
                Button("Why?") { toggleWhy() }
            }
        }
    }

    private var rowBackground: Color { isSelected ? Palette.selection : Palette.surface }

    /// Checklists stand out, parents inside them a little, steps not at all.
    private var weight: Font.Weight {
        if depth == 0 { return .semibold }
        return item.isGroup ? .medium : .regular
    }

    /// Shows `code` spans as small monospaced chips instead of with literal backticks.
    static func styled(_ title: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        guard var text = try? AttributedString(markdown: title, options: options) else { return AttributedString(title) }
        for run in text.runs where run.inlinePresentationIntent?.contains(.code) == true {
            text[run.range].backgroundColor = Palette.chip
            text[run.range].font = .system(size: 11.5, design: .monospaced)
        }
        return text
    }

    private func toggle() {
        if item.status == .open { actions.setDone(item, true) } else { actions.reopen(item) }
    }

    private func toggleWhy() {
        navigator.toggleWhy(item, actions: actions)
    }

    private func copy() {
        navigator.copy(item, board: board, actions: actions)
    }

    private func iconButton(_ symbol: String, _ help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 12)).foregroundStyle(.secondary)
                .frame(width: 18, height: 18).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(help)
    }
}

/// The line naming a conversation. While something under it is open it carries
/// a small circle that ticks all of it at once.
struct SourceHeader: View {
    let section: TaskBoard.Section
    let actions: TaskActions
    /// False while a search hides rows: ticking the conversation would tick tasks that are not on show.
    var allowsTickAll = true

    static let tickHelp = "Mark everything from this conversation done"

    var body: some View {
        HStack(alignment: .center, spacing: 6) {
            Circle().fill(Palette.source).frame(width: 6, height: 6)
            Text(section.source)
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            if allowsTickAll, let handle = section.tickAllHandle {
                Button { actions.completeConversation(handle) } label: {
                    Image(systemName: "checkmark.circle").font(.caption).foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
                .help(Self.tickHelp)
                .accessibilityLabel(Self.tickHelp)
            }
        }
        .padding(.top, 4)
        .contextMenu {
            if allowsTickAll, let handle = section.tickAllHandle {
                Button("Mark All Done") { actions.completeConversation(handle) }
            }
        }
    }
}

/// Checklists with their steps, nested, grouped by where they came from.
struct TaskListView: View {
    let board: TaskBoard
    let sections: [TaskBoard.Section]
    let actions: TaskActions
    let navigator: TaskNavigator
    var emptyText = "Nothing here."
    /// False while a search narrows the list.
    var allowsTickAll = true

    var body: some View {
        // Lazy: the window's Done view can hold hundreds of rows; only those on screen are built (SCR-32).
        LazyVStack(alignment: .leading, spacing: 10) {
            if sections.isEmpty {
                Text(emptyText).foregroundStyle(.secondary)
            }
            ForEach(sections) { section in
                VStack(alignment: .leading, spacing: 1) {
                    SourceHeader(section: section, actions: actions, allowsTickAll: allowsTickAll)
                    ForEach(section.entries) { entry in
                        TaskRow(item: entry.task, progress: entry.progress, partlyDone: board.isPartlyDone(entry.task),
                                board: board, actions: actions, navigator: navigator)
                        ForEach(entry.steps) { step in
                            TaskRow(item: step, progress: board.progress(of: step), partlyDone: board.isPartlyDone(step),
                                    board: board, actions: actions, navigator: navigator)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The list the menu bar popover shows: what is pending, then, folded away
/// unless you open it, what was recently finished.
struct PopoverTaskList: View {
    let board: TaskBoard
    let actions: TaskActions
    let navigator: TaskNavigator
    /// Folds or unfolds "Recently done". Nil where the list is only drawn.
    var toggleRecentlyDone: (() -> Void)?
    /// What the search field holds: only what mentions it is listed.
    var query = ""
    /// The Suggested tray (SCR-95), folded under the list. Empty unless Capture is Everything.
    var suggestions: [SuggestedAsk] = []
    @State private var showsSuggestions = false

    var body: some View {
        let narrowed = !TaskBoard.needle(query).isEmpty
        VStack(alignment: .leading, spacing: 12) {
            TaskListView(board: board, sections: board.sections(.pending, matching: query), actions: actions,
                         navigator: navigator,
                         emptyText: narrowed ? "Nothing waiting for you mentions that." : "Nothing hanging. Nice.",
                         allowsTickAll: !narrowed)
            if !suggestions.isEmpty && !narrowed {
                SuggestedTray(suggestions: suggestions, expanded: $showsSuggestions, actions: actions)
            }
            let done = board.recentlyDone(matching: query)
            if !done.isEmpty {
                VStack(alignment: .leading, spacing: 1) {
                    Button { toggleRecentlyDone?() } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "chevron.right")
                                .font(.system(size: 8, weight: .bold))
                                .rotationEffect(.degrees(board.showsRecentlyDone ? 90 : 0))
                            Text("Recently done").font(.caption.weight(.medium))
                            Text("\(done.count)").font(.caption).monospacedDigit()
                        }
                        .foregroundStyle(.secondary)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help(board.showsRecentlyDone ? "Fold away" : "Show what was recently finished")
                    if board.showsRecentlyDone {
                        ForEach(done) { entry in
                            TaskRow(item: entry.task, progress: entry.progress, showsDisclosure: false, board: board,
                                    actions: actions, navigator: navigator)
                        }
                    }
                }
            }
        }
        // Ticks land, rows fold and leave: let the list move instead of jumping.
        .animation(.easeInOut(duration: 0.25), value: board)
    }
}

/// One borderline ask in the Suggested tray (SCR-95), as the engine wrote it.
struct SuggestedAsk: Identifiable, Equatable {
    var id: Int
    var title: String
    var source: String
}

/// The Suggested tray (SCR-95): folded, with a count. Never nudges, never counted as open, never
/// ticked. Accept makes a suggestion a task; Not an Action takes it away and teaches the model.
struct SuggestedTray: View {
    let suggestions: [SuggestedAsk]
    @Binding var expanded: Bool
    let actions: TaskActions

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button { expanded.toggle() } label: {
                HStack(spacing: 5) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 8, weight: .bold))
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                    Text("Suggested").font(.caption.weight(.medium))
                    Text("\(suggestions.count)").font(.caption).monospacedDigit()
                }
                .foregroundStyle(.secondary)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(expanded ? "Fold away" : "Asks Didja was not sure were for you (Capture: Everything). Accept one to make it a task.")
            if expanded {
                ForEach(suggestions) { s in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(s.title).font(.callout).lineLimit(2)
                            Text(s.source).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                        }
                        Spacer(minLength: 6)
                        Button("Accept") { actions.acceptSuggestion(s) }
                            .buttonStyle(DidjaButtonStyle(kind: .secondary, size: .small))
                            .help("Make it a task")
                        Button { actions.dismissSuggestion(s) } label: { Image(systemName: "xmark") }
                            .buttonStyle(.plain)
                            .foregroundStyle(.secondary)
                            .help("Not an Action: take it away, and never suggest it again")
                            .accessibilityLabel("Not an Action")
                    }
                    .padding(.leading, 13)
                }
            }
        }
    }
}

/// A short label in a rounded chip, for key names.
struct KeyChip: View {
    let text: String

    var body: some View {
        // A key, not a button (SCR-43): a 1 pt border, heavier at the bottom, and mono text.
        Text(text)
            .font(.system(size: 11, design: .monospaced))
            .padding(.horizontal, 6)
            .padding(.vertical, 1)
            .background(RoundedRectangle(cornerRadius: 5).fill(Palette.chip))
            .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(Palette.buttonBorder.opacity(0.6), lineWidth: 1))
            .background(RoundedRectangle(cornerRadius: 5).fill(Palette.buttonBorder.opacity(0.6)).offset(y: 1))
    }
}

/// The dot and words that say whether capture is running.
struct CaptureStatusLine: View {
    @ObservedObject var capture: CaptureCoordinator
    var showsCount = true

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(showsCount ? "\(capture.status.label) · \(capture.observationCount) observations in \(capture.retention.short)" : capture.status.label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }

    private var color: Color {
        switch capture.status {
        case .capturing: return Palette.done
        case .paused, .starting: return Palette.source
        case .needsAccessibility, .failed: return Palette.attention
        }
    }
}

/// The menu bar popover.
struct PopoverView: View {
    @ObservedObject var capture: CaptureCoordinator
    let actions: TaskActions
    @ObservedObject var navigator: TaskNavigator
    var openWindow: () -> Void
    var openSettings: () -> Void = {}
    var openWelcome: () -> Void = {}
    var openExcludeList: () -> Void = {}
    var openPrivacy: () -> Void = {}
    var reportProblem: () -> Void = {}
    /// Help › Troubleshooting Report… (SCR-79), offered here when Didja reads nothing.
    var troubleshoot: () -> Void = {}
    var openCanvas: (Int?) -> Void = { _ in }
    /// Opens the "…" menu (a native menu, see MoreMenu).
    var openMore: () -> Void = {}
    @ObservedObject private var command = CommandHeld.shared
    var freshStart: () -> Void = {}
    var undoFreshStart: () -> Void = {}
    var forgetCapturedText: () -> Void = {}
    var openBrain: () -> Void = {}
    var openNames: () -> Void = {}
    var openConnections: () -> Void = {}
    /// True for the copy of the panel shown in its own window while pinned (SCR-25):
    /// the list fills whatever height you give the window.
    var pinned = false
    /// Pins the panel, or unpins it when `pinned`.
    var togglePin: () -> Void = {}
    @State private var appearance = AppearanceSetting.saved
    @State private var nudges = Nudger.isEnabled
    @State private var staysOpen = PanelStaysOpen.isOn
    @State private var listHeight: CGFloat = 0

    static let maxListHeight: CGFloat = 520

    /// The button that opens the Full View (SCR-38): labelled, with "expand" arrows, not a
    /// bare grey window outline that read as a folder. Outlined, never yellow (SCR-43).
    /// Named after the view it opens (SCR-37).
    static let expandTitle = ViewNames.full
    static let expandSymbol = "arrow.up.left.and.arrow.down.right"
    static let expandStyle = DidjaButtonStyle.secondary
    /// Pause/Resume in the footer: a small outlined button, not a blue link (SCR-43).
    static let pauseStyle = DidjaButtonStyle(kind: .secondary, size: .small)

    /// As tall as the list, within reason: never collapsed, never taller than the screen can take.
    static func panelHeight(forList height: CGFloat) -> CGFloat {
        min(max(height, 44), maxListHeight)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image("Mark").resizable().frame(width: 18, height: 18).accessibilityHidden(true)
                Text("Didja").font(.headline)
                // A count, not a button: a tag (SCR-43).
                TagView(text: capture.focus.map { "\(capture.tasks.openStepCount) open · \($0)" } ?? "\(capture.tasks.openStepCount) open")
                Spacer()
                Button { navigator.startAdding() } label: { Image(systemName: "plus") }
                    .buttonStyle(DidjaButtonStyle.icon)
                    .help(AddTaskField.help)
                    .accessibilityLabel("Add a task")
                Button(action: openWindow) { Label(Self.expandTitle, systemImage: Self.expandSymbol) }
                    .buttonStyle(Self.expandStyle)
                    .help("Open the \(ViewNames.full): everything by view and source, with Settings (O)")
                    .accessibilityLabel("Open the \(ViewNames.full)")
                // A native menu, opened on demand (MoreMenu): also with M or . from the keyboard.
                Button(action: openMore) { Image(systemName: "ellipsis.circle") }
                    .buttonStyle(DidjaButtonStyle.icon)
                    .help("More (M)")
                    .accessibilityLabel("More")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            Divider()
            CanvasStrip(open: openCanvas)
                .padding(.horizontal, 14)
                .padding(.top, 8)
            if navigator.adding {
                AddTaskField(navigator: navigator, actions: actions)
                    .padding(.horizontal, 14)
                    .padding(.top, 8)
            }
            PopoverSearchBar(navigator: navigator)
                .padding(.horizontal, 14)
                .padding(.top, 8)
            // The menu bar panel sizes itself to its content, and a scroll view on its
            // own asks for no height at all there. So measure the list and say how tall to be.
            KeyboardScrollView(navigator: navigator) {
                PopoverTaskList(board: capture.tasks, actions: actions, navigator: navigator,
                                toggleRecentlyDone: { capture.showsRecentlyDone.toggle() }, query: navigator.query,
                                suggestions: capture.suggestions)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(GeometryReader { proxy in
                        Color.clear.preference(key: ListHeightKey.self, value: proxy.size.height)
                    })
            }
            .onPreferenceChange(ListHeightKey.self) { listHeight = $0 }
            .frame(height: pinned ? nil : Self.panelHeight(forList: listHeight))
            .frame(maxHeight: pinned ? .infinity : nil)
            Divider()
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 8) {
                    CaptureStatusLine(capture: capture)
                    Spacer()
                    KeyChip(text: GlobalHotKey.label).help("Opens the \(ViewNames.quick) from anywhere. \(GlobalHotKey.pauseLabel) pauses and resumes capture.")
                    Button(capture.isPaused ? "Resume" : "Pause") { capture.isPaused.toggle() }
                        .buttonStyle(Self.pauseStyle)
                }
                if capture.status == .needsAccessibility {
                    Button("Grant Accessibility Access…") { capture.openAccessibilitySettings() }
                        .buttonStyle(DidjaLinkStyle())
                        .font(.callout)
                }
                // Reading nothing (SCR-79): looked at again every 30 seconds, so the two minutes pass.
                TimelineView(.periodic(from: .now, by: 30)) { context in
                    if TroubleshootingReport.shouldOffer(status: capture.status, observations: capture.observationCount,
                                                         capturingFor: capture.capturingSince.map { context.date.timeIntervalSince($0) } ?? 0) {
                        Button(TroubleshootingReport.offerTitle, action: troubleshoot)
                            .buttonStyle(DidjaLinkStyle())
                            .font(.callout)
                    }
                }
                // AI tool windows read for ten minutes and no steps came of them (SCR-89).
                if let nudge = capture.firstRun?.nudge {
                    FirstRunNudge(nudge: nudge, troubleshoot: troubleshoot, dismiss: { capture.dismissFirstRunNudge() })
                }
                Text(command.isHeld ? KeyboardHints.command : KeyboardHints.popover)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
        }
        .frame(width: PanelPlacement.width)
        .frame(maxHeight: pinned ? .infinity : nil, alignment: .top)
        .background(Palette.surface)
    }
}

/// The task window's way out (SCR-36): back to the panel under the menu bar icon, or just close.
struct WindowExitButtons: View {
    var showPanel: () -> Void
    var close: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            Button(action: showPanel) { Label(ViewNames.quick, systemImage: "menubar.arrow.up.rectangle") }
                .buttonStyle(DidjaButtonStyle.secondary)
                .help("Close the \(ViewNames.full) and open the \(ViewNames.quick) under the menu bar icon (O)")
                .accessibilityLabel("Back to the \(ViewNames.quick)")
            Button(action: close) { Label("Close", systemImage: "xmark").labelStyle(.iconOnly) }
                .buttonStyle(DidjaButtonStyle.icon)
                .help("Close this window (Esc)")
                .accessibilityLabel("Close the \(ViewNames.full)")
        }
    }
}

/// Leaving the task window for the panel (SCR-36). The window closes first, so the panel is
/// what has the keyboard; if the panel cannot be shown (its icon is hidden in a crowded menu
/// bar and it is not pinned), the window comes straight back, so you are never left with neither.
enum WindowExit {
    static func backToPanel(closeWindow: () -> Void, showPanel: () -> Bool, reopenWindow: () -> Void) {
        closeWindow()
        if !showPanel() { reopenWindow() }
    }
}

private struct ListHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

/// The task window: views down the side, the tree in the middle, and what is
/// known about the highlighted item on the right.
struct TasksWindowView: View {
    @ObservedObject var capture: CaptureCoordinator
    let actions: TaskActions
    @ObservedObject var navigator: TaskNavigator
    @ObservedObject var settings: SettingsHub
    /// Close this window and open the panel under the menu bar icon (SCR-36).
    var showPanel: () -> Void = {}
    /// Close this window (SCR-36).
    var close: () -> Void = {}

    var body: some View {
        let board = capture.tasks
        HStack(spacing: 0) {
            sidebar(board)
            Divider()
            if let page = settings.page {
                SettingsPageView(page: page, hub: settings, capture: capture)
                    .frame(minWidth: 380, maxWidth: .infinity, maxHeight: .infinity)
            } else {
                tasks(board)
            }
        }
        .frame(minWidth: 860, minHeight: 440)
        .background(Palette.surface)
        .background(Button("") { settings.open(.general) }.keyboardShortcut(",", modifiers: .command).opacity(0))
    }

    @ViewBuilder
    private func tasks(_ board: TaskBoard) -> some View {
        let filter = navigator.filter
        let sections = navigator.sections(board)
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(filter.rawValue).font(.title3.weight(.semibold))
                    Text(navigator.sourceFilter ?? (navigator.groupsByDay ? "By day" : "Everything"))
                        .font(.callout).foregroundStyle(.secondary).lineLimit(1)
                    Spacer()
                    let anyOpen = board.tasks.contains { $0.isGroup && !$0.collapsed }
                    Button(anyOpen ? "Collapse All" : "Expand All") { actions.setAllCollapsed(anyOpen) }
                        .buttonStyle(DidjaButtonStyle.secondary)
                    Button { navigator.startAdding() } label: { Label("Add", systemImage: "plus") }
                        .buttonStyle(DidjaButtonStyle.secondary)
                        .help(AddTaskField.help)
                    SearchField(text: $navigator.query, focused: $navigator.searching)
                    WindowExitButtons(showPanel: showPanel, close: close)
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 8)
                if navigator.adding {
                    AddTaskField(navigator: navigator, actions: actions)
                        .padding(.horizontal, 20)
                        .padding(.bottom, 8)
                }
                KeyboardScrollView(navigator: navigator) {
                    TaskListView(board: board, sections: sections, actions: actions, navigator: navigator,
                                 emptyText: "Nothing \(filter.rawValue.lowercased()).",
                                 allowsTickAll: !navigator.isNarrowed)
                        .padding(.horizontal, 20)
                        .padding(.bottom, 16)
                }
                Divider()
                Text(KeyboardHints.window)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 8)
            }
            .frame(minWidth: 380, maxWidth: .infinity)
            if let item = navigator.selected.flatMap({ id in board.tasks.first { $0.id == id } }) {
                Divider()
                TaskDetail(item: item, board: board, actions: actions, navigator: navigator)
                    .frame(width: 290)
            }
    }

    private func sidebar(_ board: TaskBoard) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Image("Lockup").resizable().scaledToFit().frame(height: 22)
                .padding(.horizontal, 8).padding(.bottom, 12)
                .accessibilityLabel("Didja")
            heading("Tasks", top: 0)
            ForEach(TaskBoard.Filter.allCases) { filter in
                sidebarRow(filter.rawValue, count: board.count(filter), selected: settings.page == nil && navigator.filter == filter) {
                    settings.page = nil
                    navigator.filter = filter
                }
            }
            Text("Sources")
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 8)
                .padding(.top, 16)
                .padding(.bottom, 2)
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    sidebarRow("Everything", count: nil, selected: settings.page == nil && navigator.sourceFilter == nil) {
                        settings.page = nil
                        navigator.sourceFilter = nil
                    }
                    ForEach(board.sections(navigator.filter)) { section in
                        sidebarRow(section.source, count: section.entries.count,
                                   selected: settings.page == nil && navigator.sourceFilter == section.source) {
                            settings.page = nil
                            navigator.sourceFilter = section.source
                        }
                    }
                }
            }
            heading("Settings", top: 14)
            ForEach(SettingsPage.allCases) { page in
                sidebarRow(page.title, symbol: page.symbol, count: nil, selected: settings.page == page) { settings.open(page) }
            }
            Spacer(minLength: 10)
            CaptureStatusLine(capture: capture, showsCount: false).padding(.horizontal, 8)
        }
        .padding(10)
        .frame(width: 210)
        .background(Palette.chip.opacity(0.6))
    }

    private func heading(_ title: String, top: CGFloat) -> some View {
        Text(title)
            .font(.caption.weight(.medium))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 8)
            .padding(.top, top)
            .padding(.bottom, 2)
    }

    private func sidebarRow(_ title: String, symbol: String? = nil, count: Int?, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let symbol {
                    Image(systemName: symbol).frame(width: 16).foregroundStyle(selected ? Palette.accentText : Color.secondary)
                }
                Text(title).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 4)
                if let count { Text("\(count)").font(.caption).monospacedDigit().foregroundStyle(.secondary) }
            }
            .fontWeight(selected ? .medium : .regular)
            .foregroundStyle(selected ? Palette.accentText : Color.primary)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(RoundedRectangle(cornerRadius: 7).fill(selected ? Palette.selection : Color.clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// A small search box. While it has the keyboard, the list's single-key shortcuts are off.
struct SearchField: View {
    @Binding var text: String
    /// Whether the field has the keyboard. Set it to true to put the keyboard there.
    @Binding var focused: Bool
    /// Nil fills the width on offer.
    var width: CGFloat? = 180

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "magnifyingglass").font(.caption).foregroundStyle(.secondary)
            SearchTextField(text: $text, focused: $focused)
                .frame(maxWidth: .infinity)
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary) }
                    .buttonStyle(.plain)
                    .help("Clear")
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .frame(width: width)
        .frame(maxWidth: width == nil ? .infinity : nil)
        .background(RoundedRectangle(cornerRadius: 7).fill(Palette.chip))
    }
}

/// The text box inside `SearchField`, in AppKit. SwiftUI's own focus request did
/// not reliably reach the menu bar panel (SCR-22 review: after F, letters were not
/// typed into the search), so the keyboard is put in the field directly: when the
/// search starts, when the field arrives in its window, and whenever that window
/// becomes key again while the search still wants it.
struct SearchTextField: NSViewRepresentable {
    @Binding var text: String
    @Binding var focused: Bool

    final class Field: NSTextField {
        /// True while the search wants the keyboard here.
        var wantsKeyboard = false
        private var keyObserver: NSObjectProtocol?

        var hasKeyboard: Bool { currentEditor() != nil && window?.firstResponder === currentEditor() }

        /// Puts the keyboard in the field if the search wants it and it is not there yet.
        func takeKeyboardIfWanted() {
            guard wantsKeyboard, !hasKeyboard, let window else { return }
            window.makeFirstResponder(self)
        }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            if let keyObserver { NotificationCenter.default.removeObserver(keyObserver) }
            keyObserver = nil
            guard let window else { return }
            keyObserver = NotificationCenter.default.addObserver(
                forName: NSWindow.didBecomeKeyNotification, object: window, queue: .main) { [weak self] _ in
                self?.takeKeyboardIfWanted()
            }
            DispatchQueue.main.async { [weak self] in self?.takeKeyboardIfWanted() }
        }

        deinit {
            if let keyObserver { NotificationCenter.default.removeObserver(keyObserver) }
        }
    }

    final class Coordinator: NSObject, NSTextFieldDelegate {
        var parent: SearchTextField
        init(_ parent: SearchTextField) { self.parent = parent }

        func controlTextDidChange(_ note: Notification) {
            guard let field = note.object as? NSTextField else { return }
            if parent.text != field.stringValue { parent.text = field.stringValue }
        }

        func controlTextDidBeginEditing(_ note: Notification) {
            if !parent.focused { parent.focused = true }
        }

        func controlTextDidEndEditing(_ note: Notification) {
            guard let field = note.object as? Field else { return }
            field.wantsKeyboard = false
            if parent.focused { parent.focused = false }
        }

        /// Esc clears the search and gives the keyboard back to the list.
        func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
            guard selector == #selector(NSResponder.cancelOperation(_:)) else { return false }
            parent.text = ""
            parent.focused = false
            control.window?.makeFirstResponder(nil)
            return true
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> Field {
        let field = Field()
        field.placeholderString = "Search"
        field.isBordered = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.font = .systemFont(ofSize: NSFont.systemFontSize)
        field.usesSingleLineMode = true
        field.cell?.isScrollable = true
        field.cell?.wraps = false
        field.lineBreakMode = .byClipping
        field.setContentHuggingPriority(.defaultLow, for: .horizontal)
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        field.delegate = context.coordinator
        field.setAccessibilityLabel("Search")
        return field
    }

    func updateNSView(_ field: Field, context: Context) {
        context.coordinator.parent = self
        if field.stringValue != text { field.stringValue = text }
        field.wantsKeyboard = focused
        if focused {
            DispatchQueue.main.async { field.takeKeyboardIfWanted() }
        } else if field.hasKeyboard {
            DispatchQueue.main.async {
                if !field.wantsKeyboard, field.hasKeyboard { field.window?.makeFirstResponder(nil) }
            }
        }
    }

    /// The search field in a window, if one is on show.
    static func field(in window: NSWindow) -> Field? {
        func find(_ view: NSView) -> Field? {
            if let field = view as? Field { return field }
            for subview in view.subviews { if let found = find(subview) { return found } }
            return nil
        }
        return window.contentView.flatMap(find)
    }

    /// A key pressed while a search is on but the field does not have the keyboard:
    /// put the keyboard in the field and give it this key, so what you type always
    /// lands in the search. False when there is no field to give it to.
    static func takeKey(_ event: NSEvent, in window: NSWindow) -> Bool {
        guard let field = field(in: window), !field.hasKeyboard else { return false }
        field.wantsKeyboard = true
        guard window.makeFirstResponder(field), let editor = field.currentEditor() else { return false }
        editor.keyDown(with: event)
        return true
    }
}

/// The panel's search. It is a plain bar until it is clicked or F is pressed, so
/// the panel never opens with the keyboard in a text field and its single-key
/// shortcuts off. Typing narrows the list as you go.
struct PopoverSearchBar: View {
    @ObservedObject var navigator: TaskNavigator

    static let help = "Show only what mentions a word (F)"

    var body: some View {
        if navigator.searching || !navigator.query.isEmpty {
            SearchField(text: $navigator.query, focused: $navigator.searching, width: nil)
        } else {
            Button { navigator.searching = true } label: {
                HStack(spacing: 5) {
                    Image(systemName: "magnifyingglass").font(.caption)
                    Text("Search")
                    Spacer()
                    KeyChip(text: "F")
                }
                .foregroundStyle(.secondary)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(RoundedRectangle(cornerRadius: 7).fill(Palette.chip))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(Self.help)
            .accessibilityLabel("Search")
        }
    }
}

/// The field for a task of your own (SCR-29). Return adds it, Esc closes the field.
struct AddTaskField: View {
    @ObservedObject var navigator: TaskNavigator
    let actions: TaskActions
    @FocusState private var focused: Bool

    static let help = "Add a task of your own (A). It is ticked like any other when Didja sees it done."
    static let placeholder = "Add a task, then Return"

    /// The add field in a window, if one is on show.
    static func field(in window: NSWindow) -> NSTextField? {
        func find(_ view: NSView) -> NSTextField? {
            if let field = view as? NSTextField, field.isEditable, field.placeholderString == placeholder { return field }
            for subview in view.subviews { if let found = find(subview) { return found } }
            return nil
        }
        return window.contentView.flatMap(find)
    }

    /// A key pressed while the add field is open but does not have the keyboard: put the keyboard
    /// in the field and give it this key, so nothing is stuck. False when there is no field.
    static func takeKey(_ event: NSEvent, in window: NSWindow) -> Bool {
        guard let field = field(in: window) else { return false }
        if !window.isKeyWindow { window.makeKey() }
        if field.currentEditor() == nil { guard window.makeFirstResponder(field) else { return false } }
        guard let editor = field.currentEditor() else { return false }
        editor.keyDown(with: event)
        return true
    }

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "plus.circle").foregroundStyle(.secondary)
            TextField(Self.placeholder, text: $navigator.addDraft)
                .textFieldStyle(.plain)
                .focused($focused)
                .onSubmit { navigator.commitAdd(actions: actions) }
                .onExitCommand { navigator.cancelAdd() }
            KeyChip(text: "Esc")
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(RoundedRectangle(cornerRadius: 7).fill(Palette.chip))
        .onAppear {
            // The window may not have the keyboard yet (after a menu): ask for it, then the field.
            if NSApplication.shared.keyWindow == nil {
                NSApplication.shared.windows.first { $0.isVisible && $0.canBecomeKey && $0.level != .normal }?.makeKey()
            }
            focused = true
            DispatchQueue.main.async { focused = true }
        }
    }
}

/// What is known about one item: where it sits, what would tick it, and its history.
struct TaskDetail: View {
    let item: TaskItem
    let board: TaskBoard
    let actions: TaskActions
    @ObservedObject var navigator: TaskNavigator
    @State private var explanation = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                if let parent = item.parentID.flatMap({ id in board.tasks.first { $0.id == id } }) {
                    Text(parent.title).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
                Text(TaskRow.styled(item.title))
                    .font(.title3.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                Text(item.source).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            HStack(spacing: 8) {
                if item.status == .open {
                    Button("Mark Done") { actions.setDone(item, true) }.buttonStyle(DidjaButtonStyle.primary)
                    Button("Snooze") { actions.snooze(item, "1h") }
                } else {
                    Button("Reopen") { actions.reopen(item) }.buttonStyle(DidjaButtonStyle.primary)
                }
                Button("Rename") { navigator.startRenaming(item) }
                Button(navigator.copied == item.id ? "Copied" : "Copy") {
                    navigator.copy(item, board: board, actions: actions)
                }
                .help(item.isGroup ? "Copy with its steps (⌘C)" : "Copy (⌘C)")
            }
            if let progress = board.progress(of: item) {
                Text("\(progress) steps done").font(.callout).foregroundStyle(.secondary)
            }
            if !explanation.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text(item.isGroup ? "About this checklist" : "Why it is \(item.status.rawValue)").font(.callout.weight(.semibold))
                    Text(explanation)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Button("Go to Source") { actions.goToSource(item) }
                .help("Brings back the window it was captured in, scrolled to where it was")
            Spacer()
            if item.acceptedFrom != nil, item.status == .done {
                Button("Not done: it was ticked for me by mistake") { actions.notDone(item) }
                    .buttonStyle(.plain)
                    .foregroundStyle(Palette.attention)
                    .help("Reopens it, and the model is shown this case from now on")
            }
            if item.status != .dismissed {
                Button("Not an action: never was for me to do") { actions.notAnAction(item) }
                    .buttonStyle(.plain)
                    .foregroundStyle(Palette.attention)
                    .help("Dismisses it, never captures the same wording again, and the model is shown this case from now on")
            }
        }
        .padding(18)
        .frame(maxHeight: .infinity, alignment: .top)
        .task(id: "\(item.id)-\(item.status.rawValue)") {
            // Asking the engine takes a moment; keep it off the main thread.
            let item = item, why = actions.why
            explanation = await withCheckedContinuation { continuation in
                DispatchQueue.global(qos: .userInitiated).async { continuation.resume(returning: why(item)) }
            }
        }
    }
}

/// A scroll view that keeps the highlighted row in sight as the keyboard moves it.
struct KeyboardScrollView<Content: View>: View {
    @ObservedObject var navigator: TaskNavigator
    @ViewBuilder var content: Content

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView { content }
                .onChange(of: navigator.selected) { _, selected in
                    if let selected { proxy.scrollTo(selected) }
                }
        }
    }
}

/// The keys, spelled out where they are used.
enum KeyboardHints {
    static let rows = "↑↓ move · ⇧↑↓ or ⌘A choose several · ←→ fold (⌥ all) · Space tick · R rename · ⌘C copy · C tick conversation · A add · S snooze · D dismiss · W why · V how it looked · X Didja missed it · F search"
    static let popover = "\(rows) · H recently done · N not yet · M menu · ⌘1–9 canvases (hold ⌘ to see) · O \(ViewNames.full) · P pause (\(GlobalHotKey.pauseLabel) anywhere) · Esc close"
    static let window = "\(rows) · 1–4 switch view · ⌘1–9 open a canvas · O \(ViewNames.quick) · Esc close"
    /// Shown instead while ⌘ is held: the ⌘ shortcuts (as Claude shows them).
    static let command = "⌘1–9 open that canvas · ⌘N new canvas · ⌘F search · ⌘A choose all · ⌘C copy · ⌘, Settings · ⌘Q quit"
}
