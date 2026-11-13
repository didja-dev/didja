import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// Dragging tasks from the list onto a canvas (SCR-50). The drag carries the tasks' ids in a type
/// only Didja reads (`ownProcess`), plus their titles as plain text for any other app.
enum TaskDrag {
    static let type = UTType(exportedAs: "dev.didja.task-ids", conformingTo: .data)

    static func encode(_ ids: [Int]) -> Data { Data(ids.map(String.init).joined(separator: ",").utf8) }

    /// The ids in a drag; nothing for anything that is not a list of task ids.
    static func decode(_ data: Data) -> [Int] {
        guard let text = String(data: data, encoding: .utf8) else { return [] }
        let parts = text.split(separator: ",", omittingEmptySubsequences: false)
        let ids = parts.compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }.filter { $0 > 0 }
        return ids.count == parts.count ? ids : []
    }

    static func provider(_ items: [TaskItem]) -> NSItemProvider {
        let provider = NSItemProvider(object: items.map(\.title).joined(separator: "\n") as NSString)
        let data = encode(items.map(\.id))
        provider.registerDataRepresentation(forTypeIdentifier: type.identifier, visibility: .ownProcess) { done in
            done(data, nil)
            return nil
        }
        return provider
    }

    /// Reads the ids from what was dropped and hands them over on the main thread.
    static func receive(_ providers: [NSItemProvider], _ send: @escaping ([Int]) -> Void) -> Bool {
        let ours = providers.filter { $0.hasItemConformingToTypeIdentifier(type.identifier) }
        guard !ours.isEmpty else { return false }
        for provider in ours {
            _ = provider.loadDataRepresentation(forTypeIdentifier: type.identifier) { data, _ in
                let ids = data.map(decode) ?? []
                if !ids.isEmpty { DispatchQueue.main.async { send(ids) } }
            }
        }
        return true
    }
}

/// Canvases (SCR-49): floating pages you keep open while you work. Tasks sent from the list (a
/// checklist sends its steps under a heading), tasks you add there, headings and notes, in your
/// order. A task on a canvas is the task itself, so it ticks and shows "looks done?" as it would in
/// the list. The engine keeps canvases (`didja canvas …`, schema 019); this is the window.
struct CanvasSummary: Codable, Identifiable, Equatable {
    var id: Int
    var title: String
    var open: Int
}

struct CanvasPage: Codable, Equatable {
    struct Item: Codable, Identifiable, Equatable {
        struct Task: Codable, Equatable {
            var id: Int
            var status: String
            var suggestion: String?
            var source: String
        }
        var id: Int
        var kind: String
        var text: String
        /// How far it is indented, 0 to 4.
        var level: Int?
        var task: Task?
        var indent: Int { level ?? 0 }
    }
    var id: Int
    var title: String
    var open: Int
    var items: [Item]
}

/// The canvases there are, kept in memory for menus and the Quick View, which are drawn far more
/// often than canvases change: refreshed at launch and after every change to a canvas, never while
/// something draws.
final class CanvasDirectory: ObservableObject {
    static let shared = CanvasDirectory()
    @Published private(set) var list: [CanvasSummary] = []

    /// The first nine by when they were made, numbered for ⌘1–⌘9; the numbers do not move when one is edited.
    var numbered: [CanvasSummary] { Array(list.sorted { $0.id < $1.id }.prefix(9)) }

    func set(_ fresh: [CanvasSummary]) { if fresh != list { list = fresh } }

    static func refresh() {
        DispatchQueue.global(qos: .utility).async {
            let fresh = CanvasModel.list()
            DispatchQueue.main.async { shared.set(fresh) }
        }
    }
}

/// One canvas's state, read from and written through the engine.
final class CanvasModel: ObservableObject {
    let id: Int
    @Published private(set) var page: CanvasPage?
    /// The highlighted item, while the keyboard is in the list (nil: it is in the line you type into).
    @Published var selected: Int?
    /// The item being edited in place, and its text.
    @Published var editing: Int?
    @Published var draft = ""
    /// The line you type into; read by the keys (↑ leaves it only when it is empty).
    @Published var line = ""
    /// Bumped to put the keyboard back in the line you type into.
    @Published private(set) var focusComposer = 0
    private let run: ([String]) -> String?

    init(id: Int, run: @escaping ([String]) -> String? = { EngineRunner.output($0) }) {
        self.id = id
        self.run = run
        reload()
    }

    static func list(run: ([String]) -> String? = { EngineRunner.output($0) }) -> [CanvasSummary] {
        (run(["canvas", "list"]).flatMap { try? JSONDecoder().decode([CanvasSummary].self, from: Data($0.utf8)) }) ?? []
    }

    /// A new canvas; its id, or nil.
    static func create(_ title: String, run: ([String]) -> String? = { EngineRunner.output($0) }) -> Int? {
        struct Made: Decodable { var id: Int }
        let id = run(["canvas", "new", title]).flatMap { try? JSONDecoder().decode(Made.self, from: Data($0.utf8)).id }
        CanvasDirectory.refresh()
        return id
    }

    func reload() {
        let fresh = run(["canvas", "show", String(id)]).flatMap { try? JSONDecoder().decode(CanvasPage.self, from: Data($0.utf8)) }
        if fresh != page { page = fresh }
    }

    private func change(_ args: [String]) {
        _ = run(args)
        reload()
        CanvasDirectory.refresh()
    }

    func rename(_ title: String) { change(["canvas", "rename", String(id), title]) }
    /// Tasks dragged here from the list, as Send to Canvas does: at the end, a checklist with its steps.
    func send(_ taskIds: [Int]) {
        guard !taskIds.isEmpty else { return }
        change(["canvas", "send", String(id)] + taskIds.map(String.init))
    }
    func toggle(_ item: CanvasPage.Item) {
        guard let task = item.task else { return }
        change([task.status == "done" ? "reopen" : "done", String(task.id)])
    }
    func confirmDone(_ item: CanvasPage.Item) { if let t = item.task { change(["done", String(t.id)]) } }
    func notYet(_ item: CanvasPage.Item) { if let t = item.task { change(["notyet", String(t.id)]) } }
    func edit(_ item: CanvasPage.Item, _ text: String) { change(["canvas", "edit", String(item.id), text]) }
    func remove(_ item: CanvasPage.Item) { change(["canvas", "remove", String(item.id)]) }
    func move(_ item: CanvasPage.Item, before: CanvasPage.Item?) {
        change(["canvas", "move", String(item.id), before.map { String($0.id) } ?? "end"])
    }

    static let maxLevel = 4

    /// A typed line, read as Markdown by the engine (`# ` heading, `[] ` task, `- ` bullet, `> ` note;
    /// anything else a task, or a note when `asNote`). Leading spaces indent it past `level`.
    func addLine(_ text: String, asNote: Bool, level: Int) {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        change(["canvas", "line", String(id)] + (asNote ? ["--note"] : []) + ["--level", String(max(0, min(Self.maxLevel, level))), text])
    }

    func setLevel(_ item: CanvasPage.Item, _ level: Int) {
        let clamped = max(0, min(Self.maxLevel, level))
        guard clamped != item.indent else { return }
        change(["canvas", "level", String(item.id), String(clamped)])
    }

    func export(_ format: String) -> String { run(["canvas", "export", String(id), format]) ?? "" }

    // MARK: Keyboard

    private var items: [CanvasPage.Item] { page?.items ?? [] }
    var current: CanvasPage.Item? { items.first { $0.id == selected } }

    func startEditing(_ item: CanvasPage.Item) {
        selected = item.id
        draft = item.text
        editing = item.id
    }

    /// Save what was typed in place: a note's or heading's text, or a task's own name.
    func commitEdit() {
        guard let item = items.first(where: { $0.id == editing }) else { editing = nil; return }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        editing = nil
        guard !text.isEmpty, text != item.text else { return }
        if let task = item.task { change(["rename", String(task.id), text]) } else { edit(item, text) }
    }

    func cancelEdit() { editing = nil }

    func backToTyping() {
        selected = nil
        editing = nil
        focusComposer += 1
    }

    /// Do what a key asks. False when it is not one for the canvas.
    @discardableResult
    func perform(_ action: CanvasKey) -> Bool {
        let list = items
        let at = list.firstIndex { $0.id == selected }
        switch action {
        case .enterList:
            guard let last = list.last else { return false }
            selected = last.id
        case .up:
            guard let at else { return false }
            selected = list[max(at - 1, 0)].id
        case .down:
            guard let at else { return false }
            if at + 1 < list.count { selected = list[at + 1].id } else { backToTyping() }
        case .backToTyping:
            backToTyping()
        case .toggle:
            guard let item = current else { return false }
            if item.task != nil { toggle(item) }
        case .indent, .outdent:
            guard let item = current, item.kind != "heading" else { return current != nil }
            setLevel(item, item.indent + (action == .indent ? 1 : -1))
        case .moveUp:
            guard let at, at > 0 else { return at != nil }
            move(list[at], before: list[at - 1])
        case .moveDown:
            guard let at, at + 1 < list.count else { return at != nil }
            move(list[at], before: at + 2 < list.count ? list[at + 2] : nil)
        case .edit:
            guard let item = current else { return false }
            startEditing(item)
        case .yesDone:
            guard let item = current, item.task?.suggestion != nil else { return current != nil }
            confirmDone(item)
        case .notYet:
            guard let item = current, item.task?.suggestion != nil else { return current != nil }
            notYet(item)
        case .remove:
            guard let at else { return false }
            let next = at + 1 < list.count ? list[at + 1].id : (at > 0 ? list[at - 1].id : nil)
            remove(list[at])
            selected = next
            if next == nil { backToTyping() }
        }
        return true
    }
}

/// What a key does on a canvas. In the list: ↑↓ move, Space ticks, Tab and ⇧Tab indent and outdent,
/// ⌥↑ ⌥↓ move the item, Return or E edits it in place, Y and N answer "looks done?", ⌘⌫ takes it off
/// the canvas, Esc goes back to typing. From the line you type into, ↑ (when it is empty) goes into the list.
enum CanvasKey: Equatable {
    case enterList, up, down, backToTyping, toggle, indent, outdent, moveUp, moveDown, edit, yesDone, notYet, remove

    static let hint = "↑↓ move · Space tick · Tab / ⇧Tab indent · ⌥↑↓ reorder · Return edit · Y / N looks done · ⌘⌫ take off · Esc type"

    static func action(keyCode: UInt16, modifiers: NSEvent.ModifierFlags, inList: Bool, lineEmpty: Bool) -> CanvasKey? {
        let held = modifiers.intersection([.command, .control, .option, .shift])
        guard inList else {
            return keyCode == 126 && held.isEmpty && lineEmpty ? .enterList : nil
        }
        switch (keyCode, held) {
        case (126, []): return .up
        case (125, []): return .down
        case (126, [.option]): return .moveUp
        case (125, [.option]): return .moveDown
        case (53, []): return .backToTyping
        case (49, []): return .toggle
        case (48, []): return .indent
        case (48, [.shift]): return .outdent
        case (36, []), (76, []), (14, []): return .edit           // Return, Enter, E
        case (16, []): return .yesDone                            // Y
        case (45, []): return .notYet                             // N
        case (51, [.command]): return .remove                     // ⌘⌫
        default: return nil
        }
    }
}

struct CanvasView: View {
    static let width: CGFloat = 420
    @ObservedObject var model: CanvasModel
    @State private var title = ""
    /// The level and kind of what you are typing.
    @State private var level = 0
    @State private var asNote = false
    @FocusState private var typing: Bool
    /// Tasks are being dragged over the canvas.
    @State private var dropping = false

    static let hint = "Type a task, then Enter. # heading · - bullet · > note · Tab indents"
    var close: () -> Void = {}
    /// Off in tests: an offscreen render does not draw a scroll view's content.
    var scrolls = true

    private var items: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(model.page?.items ?? []) { item in row(item) }
            if (model.page?.items ?? []).isEmpty {
                Text("Click anywhere and type. Or drag tasks here from the list (or right-click › Send to Canvas).")
                    .font(.callout).foregroundStyle(.secondary).padding(.vertical, 8)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The one line you type into; Enter adds it and clears it.
    private var composer: some View {
        HStack(spacing: 6) {
            Image(systemName: asNote ? "note.text" : "circle").foregroundStyle(.secondary)
                .padding(.leading, CGFloat(level) * 18)
            TextField(Self.hint, text: $model.line)
                .textFieldStyle(.plain)
                .focused($typing)
                .onSubmit(submit)
                .onKeyPress(.tab, phases: .down) { press in
                    level = max(0, min(CanvasModel.maxLevel, level + (press.modifiers.contains(.shift) ? -1 : 1)))
                    return .handled
                }
            Picker("", selection: $asNote) {
                Text("Task").tag(false)
                Text("Note").tag(true)
            }
            .pickerStyle(.segmented).labelsHidden().fixedSize()
            .help("What a line without # - > or [] becomes")
        }
    }

    private func submit() {
        let typed = model.line
        // Cleared now and again once the field has finished its own Enter: a field being typed in
        // can keep its text when it is reset in the middle of handling the key.
        model.line = ""
        DispatchQueue.main.async { model.line = ""; typing = true }
        model.addLine(typed, asNote: asNote, level: level)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "rectangle.and.pencil.and.ellipsis").foregroundStyle(Palette.accent)
                TextField("Title", text: $title, onCommit: { model.rename(title) })
                    .textFieldStyle(.plain).font(.title3.weight(.semibold))
                Spacer()
                Text(model.page.map { $0.open == 0 ? "all done" : "\($0.open) open" } ?? "").font(.caption).foregroundStyle(.secondary)
                Menu {
                    Button("Copy as Markdown") { copy(model.export("md")) }
                    Button("Save as Markdown…") { save(model.export("md"), ext: "md") }
                    Button("Save as Text…") { save(model.export("txt"), ext: "txt") }
                } label: { Image(systemName: "square.and.arrow.up") }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                    .help("Export this canvas")
            }
            Group {
                if scrolls {
                    ScrollViewReader { proxy in
                        ScrollView { items }
                            .onChange(of: model.selected) { _, id in if let id { withAnimation { proxy.scrollTo(id) } } }
                    }
                } else { items.frame(maxHeight: .infinity, alignment: .top) }
            }
            // A click on the page, anywhere a row does not take it, starts typing.
            .contentShape(Rectangle())
            .onTapGesture { model.backToTyping() }
            Divider()
            composer
            Text(model.selected == nil ? "↑ to the list · Tab indents what you type" : CanvasKey.hint)
                .font(.caption2).foregroundStyle(.tertiary).fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(minWidth: Self.width, minHeight: 300, alignment: .top)
        .background(Palette.surface)
        .overlay {
            if dropping {
                RoundedRectangle(cornerRadius: 10).strokeBorder(Palette.accent, lineWidth: 2).padding(4)
                    .allowsHitTesting(false)
            }
        }
        .onDrop(of: [TaskDrag.type], isTargeted: $dropping) { providers in
            TaskDrag.receive(providers) { [model] ids in model.send(ids) }
        }
        .onAppear { title = model.page?.title ?? ""; typing = true }
        .onChange(of: model.focusComposer) { _, _ in typing = true }
        .onChange(of: model.selected) { _, id in if id != nil { typing = false } }
        .onChange(of: model.page?.title) { _, new in if let new { title = new } }
    }

    /// A note's text with its Markdown shown: **bold**, *italic*, `code`, links.
    static func rendered(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
    }

    @ViewBuilder private func row(_ item: CanvasPage.Item) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            switch item.kind {
            case "task":
                let done = item.task?.status == "done"
                Button { model.toggle(item) } label: {
                    Image(systemName: done ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(done ? Palette.done : .secondary)
                }.buttonStyle(.plain)
                VStack(alignment: .leading, spacing: 2) {
                    if model.editing == item.id {
                        editor
                    } else {
                        Text(item.text).strikethrough(done).foregroundStyle(done ? .secondary : .primary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let suggestion = item.task?.suggestion, !done {
                        HStack(spacing: 6) {
                            Text("Looks done? \(suggestion)").font(.caption).foregroundStyle(Palette.attention)
                            Button("Yes (Y)") { model.confirmDone(item) }.buttonStyle(.link).font(.caption)
                            Button("Not Yet (N)") { model.notYet(item) }.buttonStyle(.link).font(.caption)
                        }
                    }
                }
            default:
                if model.editing == item.id {
                    editor
                } else {
                    Text(Self.rendered(item.text))
                        .font(item.kind == "heading" ? .headline : .callout)
                        .foregroundStyle(item.kind == "heading" ? .primary : .secondary)
                        .padding(.top, item.kind == "heading" ? 6 : 0)
                        .fixedSize(horizontal: false, vertical: true)
                        .onTapGesture(count: 2) { model.startEditing(item) }
                }
            }
            Spacer(minLength: 4)
            Menu {
                if let items = model.page?.items, let at = items.firstIndex(of: item) {
                    if at > 0 { Button("Move Up") { model.move(item, before: items[at - 1]) } }
                    if at + 1 < items.count { Button("Move Down") { model.move(item, before: at + 2 < items.count ? items[at + 2] : nil) } }
                }
                if item.kind != "heading" {
                    if item.indent < CanvasModel.maxLevel { Button("Indent") { model.setLevel(item, item.indent + 1) } }
                    if item.indent > 0 { Button("Outdent") { model.setLevel(item, item.indent - 1) } }
                }
                Button(item.kind == "task" ? "Rename (Return)" : "Edit (Return)") { model.startEditing(item) }
                Button(item.kind == "task" ? "Take Off This Canvas" : "Delete") { model.remove(item) }
            } label: { Image(systemName: "ellipsis") }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
        .padding(.leading, CGFloat(item.indent) * 18)
        .padding(.horizontal, 4)
        .background(RoundedRectangle(cornerRadius: 5).fill(model.selected == item.id ? Palette.selection : Color.clear))
        .id(item.id)
    }

    /// Editing an item in place: Return saves, Esc leaves it as it was.
    @FocusState private var editorFocused: Bool
    private var editor: some View {
        TextField("", text: $model.draft, axis: .vertical)
            .textFieldStyle(.roundedBorder)
            .focused($editorFocused)
            .onSubmit { model.commitEdit() }
            .onExitCommand { model.cancelEdit() }
            .onAppear { editorFocused = true }
    }

    private func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    private func save(_ text: String, ext: String) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "\(model.page?.title ?? "Canvas").\(ext)"
        if panel.runModal() == .OK, let url = panel.url { try? text.write(to: url, atomically: true, encoding: .utf8) }
    }
}

/// The open canvas windows: floating panels that stay above other apps' windows and stay open
/// while you work elsewhere. Each reloads every few seconds, so a task ticked from what you do shows ticked.
final class CanvasWindows: NSObject, NSWindowDelegate {
    private var open: [Int: (panel: NSPanel, model: CanvasModel)] = [:]
    private var timer: Timer?
    private var keys: Any?

    /// Keys pressed in a canvas window (see CanvasKey). Typing in a field is left alone, except ↑ from
    /// the empty line, and ⌘W closes the window.
    private func watchKeys() {
        guard keys == nil else { return }
        keys = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, let window = event.window as? NSPanel,
                  let entry = self.open.values.first(where: { $0.panel === window }) else { return event }
            let model = entry.model
            if event.keyCode == 13, event.modifierFlags.intersection([.command, .control, .option, .shift]) == .command {
                window.performClose(nil)                                              // ⌘W
                return nil
            }
            if model.editing != nil { return event }                                   // typing in place
            let inList = model.selected != nil
            guard let key = CanvasKey.action(keyCode: event.keyCode, modifiers: event.modifierFlags,
                                             inList: inList, lineEmpty: model.line.isEmpty) else { return event }
            if key == .enterList { window.makeFirstResponder(nil) }
            return model.perform(key) ? nil : event
        }
    }

    func show(_ id: Int) {
        if let existing = open[id] {
            existing.model.reload()
            existing.panel.makeKeyAndOrderFront(nil)
            NSApplication.shared.activate(ignoringOtherApps: true)
            return
        }
        let model = CanvasModel(id: id)
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: CanvasView.width, height: 480),
                            styleMask: [.titled, .closable, .resizable, .utilityWindow], backing: .buffered, defer: false)
        panel.title = model.page?.title ?? "Canvas"
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.level = .floating
        panel.isReleasedWhenClosed = false
        panel.delegate = self
        panel.contentViewController = NSHostingController(rootView: CanvasView(model: model))
        panel.setContentSize(NSSize(width: CanvasView.width, height: 480))
        panel.center()
        panel.setFrameAutosaveName("canvas-\(id)")
        open[id] = (panel, model)
        watchKeys()
        panel.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
        startTimer()
    }

    private func startTimer() {
        guard timer == nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 4, repeats: true) { [weak self] _ in
            for (_, entry) in self?.open ?? [:] {
                entry.model.reload()
                entry.panel.title = entry.model.page?.title ?? "Canvas"
            }
        }
    }

    func windowWillClose(_ notification: Notification) {
        guard let panel = notification.object as? NSPanel, let id = open.first(where: { $0.value.panel === panel })?.key else { return }
        open[id] = nil
        if open.isEmpty { timer?.invalidate(); timer = nil }
    }
}
