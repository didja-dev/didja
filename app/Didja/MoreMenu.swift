import AppKit
import SwiftUI

/// The Quick View's "…" menu as data, built into a native menu each time it opens. A SwiftUI
/// menu inside the menu bar panel stopped opening after the panel had closed while it was open;
/// a native menu popped up on demand has no such state, and opens from the keyboard too (M or .):
/// arrows move, Return chooses, typing jumps to an item, and each item shows its shortcut.
struct MenuEntry {
    enum Kind {
        case action(() -> Void)
        case submenu([MenuEntry])
        case separator
        /// Shown, not chosen (the version).
        case label
    }

    var title: String
    var kind: Kind
    /// The key shown beside it and accepted while the menu is open: "1", "n", ",".
    var key = ""
    var modifiers: NSEvent.ModifierFlags = [.command]
    var checked = false
    var enabled = true

    static let separator = MenuEntry(title: "", kind: .separator)

    static func action(_ title: String, key: String = "", modifiers: NSEvent.ModifierFlags = [.command], checked: Bool = false,
                       enabled: Bool = true, _ run: @escaping () -> Void) -> MenuEntry {
        MenuEntry(title: title, kind: .action(run), key: key, modifiers: modifiers, checked: checked, enabled: enabled)
    }

    static func submenu(_ title: String, _ entries: [MenuEntry]) -> MenuEntry {
        MenuEntry(title: title, kind: .submenu(entries))
    }

    /// A choice of one, as a submenu with a tick beside the current value.
    static func choice<T: Equatable>(_ title: String, _ options: [(String, T)], current: T, set: @escaping (T) -> Void) -> MenuEntry {
        submenu(title, options.map { label, value in action(label, checked: value == current) { set(value) } })
    }

    /// Every title, with submenus as "Parent › Child", for tests.
    static func titles(_ entries: [MenuEntry], prefix: String = "") -> [String] {
        entries.flatMap { entry -> [String] in
            switch entry.kind {
            case .separator: return []
            case .label, .action: return [prefix + entry.title]
            case .submenu(let children): return [prefix + entry.title] + titles(children, prefix: prefix + entry.title + " › ")
            }
        }
    }

    /// The entry at a path of titles, for tests.
    static func find(_ path: [String], in entries: [MenuEntry]) -> MenuEntry? {
        guard let first = path.first, let entry = entries.first(where: { $0.title == first }) else { return nil }
        if path.count == 1 { return entry }
        if case .submenu(let children) = entry.kind { return find(Array(path.dropFirst()), in: children) }
        return nil
    }
}

enum MoreMenu {
    private final class Item: NSMenuItem {
        var run: (() -> Void)?
        @objc func fire() { run?() }
    }

    static func build(_ entries: [MenuEntry]) -> NSMenu {
        let menu = NSMenu()
        menu.autoenablesItems = false
        for entry in entries {
            switch entry.kind {
            case .separator:
                menu.addItem(.separator())
            case .label:
                let item = NSMenuItem(title: entry.title, action: nil, keyEquivalent: "")
                item.isEnabled = false
                menu.addItem(item)
            case .action(let run):
                let item = Item(title: entry.title, action: #selector(Item.fire), keyEquivalent: entry.key)
                item.target = item
                item.run = run
                item.keyEquivalentModifierMask = entry.modifiers
                item.state = entry.checked ? .on : .off
                item.isEnabled = entry.enabled
                menu.addItem(item)
            case .submenu(let children):
                let item = NSMenuItem(title: entry.title, action: nil, keyEquivalent: "")
                item.submenu = build(children)
                menu.addItem(item)
            }
        }
        return menu
    }

    /// Open the menu: under the mouse when a click opened it, else at the window's top right.
    static func pop(_ entries: [MenuEntry], in window: NSWindow?) {
        guard let view = window?.contentView else { return }
        let menu = build(entries)
        let event = NSApplication.shared.currentEvent
        let point: NSPoint
        if let event, event.window === window, event.type == .leftMouseDown || event.type == .leftMouseUp {
            point = view.convert(event.locationInWindow, from: nil)
        } else {
            point = NSPoint(x: view.bounds.maxX - 40, y: view.isFlipped ? 40 : view.bounds.maxY - 40)
        }
        menu.popUp(positioning: nil, at: point, in: view)
        // Give the keyboard back to the window the menu came from, unless what was chosen closed it:
        // a native menu leaves no window key, and the Quick View's keys would stop (seen live).
        if let window, window.isVisible {
            NSApplication.shared.activate(ignoringOtherApps: true)
            window.makeKey()
        }
    }
}

/// Whether ⌘ is being held, after a moment, so the numbers and ⌘ shortcuts can light up (as in
/// Claude). A quick ⌘C does not flash them.
final class CommandHeld: ObservableObject {
    static let shared = CommandHeld()
    @Published private(set) var isHeld = false
    private var pending: DispatchWorkItem?
    private var monitor: Any?

    func start() {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.flagsChanged, .keyDown]) { [weak self] event in
            self?.update(event)
            return event
        }
    }

    func update(_ event: NSEvent) {
        let commandOnly = event.modifierFlags.intersection([.command, .control, .option, .shift]) == .command
        if event.type == .keyDown || !commandOnly {
            // A key pressed with ⌘ is a shortcut, not a look at the shortcuts.
            pending?.cancel()
            pending = nil
            if isHeld, event.type != .keyDown || !commandOnly { isHeld = false }
            return
        }
        guard pending == nil, !isHeld else { return }
        let work = DispatchWorkItem { [weak self] in self?.isHeld = true; self?.pending = nil }
        pending = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: work)
    }
}

/// The canvases at the top of the Quick View, numbered for ⌘1–⌘9. The numbers light up while ⌘
/// is held.
struct CanvasStrip: View {
    @ObservedObject var directory = CanvasDirectory.shared
    @ObservedObject var command = CommandHeld.shared
    var open: (Int?) -> Void

    var body: some View {
        if !directory.list.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(Array(directory.numbered.enumerated()), id: \.element.id) { index, canvas in
                        Button { open(canvas.id) } label: {
                            HStack(spacing: 5) {
                                Text("⌘\(index + 1)")
                                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                                    .foregroundStyle(command.isHeld ? Palette.accentText : .secondary)
                                    .padding(.horizontal, 4).padding(.vertical, 1)
                                    .background(RoundedRectangle(cornerRadius: 4).fill(command.isHeld ? Palette.selection : Color.clear))
                                Text(canvas.title).lineLimit(1)
                                if canvas.open > 0 { Text("\(canvas.open)").foregroundStyle(.secondary) }
                            }
                            .font(.caption)
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(Capsule().fill(Palette.chip))
                        }
                        .buttonStyle(.plain)
                        .help("Open this canvas (⌘\(index + 1))")
                    }
                    Button { open(nil) } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "plus")
                            Text("Canvas")
                            if command.isHeld { Text("⌘N").foregroundStyle(.secondary) }
                        }
                        .font(.caption).padding(.horizontal, 8).padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                    .help("New canvas (⌘N)")
                }
            }
        }
    }
}
