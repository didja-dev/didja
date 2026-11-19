import AppKit
import Carbon.HIToolbox
import SwiftUI

/// The two-sided switch under the menu bar icon: a reminder you can see at a glance and flip with
/// one click, like a dishwasher's Clean / Dirty magnet ("Sandbox / Prod"). Off until you turn it
/// on in Settings › General. It is only a reminder: it changes nothing on the Mac and nothing
/// about tasks; Didja remembers the two labels, the color and which side you left it on.
struct SideSwitchSettings: Equatable {
    enum Accent: String, CaseIterable, Identifiable {
        case highlighter, amber, green, ink
        var id: String { rawValue }
        var name: String {
            switch self {
            case .highlighter: return "Yellow"
            case .amber: return "Amber"
            case .green: return "Green"
            case .ink: return "Ink"
            }
        }
        var color: Color {
            switch self {
            case .highlighter: return Color(red: 1.000, green: 0.851, blue: 0.239) // #FFD93D
            case .amber: return Color(red: 0.604, green: 0.290, blue: 0.000) // #9A4A00
            case .green: return Color(red: 0.122, green: 0.478, blue: 0.302) // #1F7A4D
            case .ink: return Color(red: 0.078, green: 0.078, blue: 0.078) // #141414
            }
        }
        /// Text on the filled side: ink on yellow, paper on the darker ones.
        var lightText: Bool { self != .highlighter }
    }

    static let maxLength = 12
    static let defaultLeft = "Sandbox"
    static let defaultRight = "Prod"

    var on = false
    var left = SideSwitchSettings.defaultLeft
    var right = SideSwitchSettings.defaultRight
    var onRight = false
    var accent = Accent.highlighter

    /// The side you are on now.
    var current: String { onRight ? right : left }
    var other: String { onRight ? left : right }

    mutating func flip() { onRight.toggle() }

    /// A label as kept: one line, spaces collapsed, at most 12 characters; empty keeps the old one.
    static func clean(_ text: String, otherwise fallback: String) -> String {
        let words = text.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).joined(separator: " ")
        let label = String(words.prefix(maxLength)).trimmingCharacters(in: .whitespaces)
        return label.isEmpty ? fallback : label
    }

    private enum Key {
        static let on = "sideSwitch.on", left = "sideSwitch.left", right = "sideSwitch.right"
        static let onRight = "sideSwitch.onRight", accent = "sideSwitch.accent"
    }

    static func load(_ defaults: UserDefaults = .standard) -> SideSwitchSettings {
        var s = SideSwitchSettings()
        s.on = defaults.bool(forKey: Key.on)
        s.left = clean(defaults.string(forKey: Key.left) ?? "", otherwise: defaultLeft)
        s.right = clean(defaults.string(forKey: Key.right) ?? "", otherwise: defaultRight)
        s.onRight = defaults.bool(forKey: Key.onRight)
        s.accent = Accent(rawValue: defaults.string(forKey: Key.accent) ?? "") ?? .highlighter
        return s
    }

    func save(_ defaults: UserDefaults = .standard) {
        defaults.set(on, forKey: Key.on)
        defaults.set(left, forKey: Key.left)
        defaults.set(right, forKey: Key.right)
        defaults.set(onRight, forKey: Key.onRight)
        defaults.set(accent.rawValue, forKey: Key.accent)
    }

    /// Where the switch goes: centred under the icon, a few points below it, kept on that screen.
    /// Nil when there is no icon on a screen to hang it from (the menu bar is hidden, or crowded out).
    static func frame(size: NSSize, icon: NSRect?, screens: [NSRect]) -> NSRect? {
        guard let icon, icon.width > 0, let screen = screens.first(where: { $0.intersects(icon) }) else { return nil }
        var x = icon.midX - size.width / 2
        x = min(max(x, screen.minX + 4), screen.maxX - size.width - 4)
        let y = icon.minY - size.height - 2
        return NSRect(x: x.rounded(), y: y.rounded(), width: size.width, height: size.height)
    }
}

/// The switch as drawn: a pill with two sides; the side you are on is filled.
struct SideSwitchView: View {
    var settings: SideSwitchSettings
    /// A dark menu bar: the track turns light so it still stands out.
    var dark: Bool

    var body: some View {
        VStack(spacing: 0) {
            Triangle().fill(track).frame(width: 12, height: 6)
            HStack(spacing: 2) {
                side(settings.left, filled: !settings.onRight, isRight: false)
                side(settings.right, filled: settings.onRight, isRight: true)
            }
            .padding(3)
            .background(Capsule().fill(track))
        }
        .padding(.horizontal, 6)
        .padding(.bottom, 6)
        .fixedSize()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Switch: \(settings.current)")
        .accessibilityHint("Click to change to \(settings.other). Right-click to rename.")
        .accessibilityAddTraits(.isButton)
    }

    private var paper: Color { Color(red: 0.980, green: 0.980, blue: 0.969) }
    private var ink: Color { Color(red: 0.078, green: 0.078, blue: 0.078) }
    private var track: Color { dark ? paper : ink }

    private func side(_ label: String, filled: Bool, isRight: Bool) -> some View {
        let fill: Color
        let text: Color
        if !filled {
            fill = .clear
            text = dark ? Color(red: 0.357, green: 0.357, blue: 0.333) : Color(red: 0.659, green: 0.659, blue: 0.627)
        } else if isRight {
            // Ink on a light track would vanish against ink: use the paper side's look instead.
            let accent = dark && settings.accent == .ink ? ink : settings.accent.color
            fill = accent
            text = settings.accent.lightText ? paper : ink
        } else {
            fill = dark ? ink : paper
            text = dark ? paper : ink
        }
        return Text(label)
            .font(.system(size: 12, weight: .semibold))
            .lineLimit(1)
            .foregroundStyle(text)
            .padding(.horizontal, 12)
            .frame(minWidth: 64, minHeight: 24)
            .background(Capsule().fill(fill))
    }

    private struct Triangle: Shape {
        func path(in rect: CGRect) -> Path {
            var p = Path()
            p.move(to: CGPoint(x: rect.midX, y: rect.minY))
            p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
            p.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
            p.closeSubpath()
            return p
        }
    }
}

/// The rename popover (right-click) and the same fields in Settings.
struct SideSwitchEditor: View {
    @ObservedObject var controller: SideSwitchController
    var showsHide = true
    var done: () -> Void = {}
    @State private var left = ""
    @State private var right = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                field("Left side", $left) { controller.rename(left: left) }
                field("Right side", $right) { controller.rename(right: right) }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Color when on the right side").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                HStack(spacing: 10) {
                    ForEach(SideSwitchSettings.Accent.allCases) { accent in
                        Button { controller.update { $0.accent = accent } } label: {
                            Circle().fill(accent.color).frame(width: 22, height: 22)
                                .overlay(Circle().stroke(Color.primary, lineWidth: controller.settings.accent == accent ? 2 : 0).padding(-3))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(accent.name + (controller.settings.accent == accent ? ", chosen" : ""))
                    }
                }
            }
            if showsHide {
                Divider()
                HStack {
                    Button("Hide the Switch") { controller.update { $0.on = false }; done() }
                    Spacer()
                    Button("Done") { save(); done() }.keyboardShortcut(.defaultAction)
                }
            }
        }
        .padding(showsHide ? 16 : 0)
        .frame(width: showsHide ? 320 : nil)
        .onAppear { left = controller.settings.left; right = controller.settings.right }
        .onDisappear { save() }
    }

    private func save() { controller.rename(left: left, right: right) }

    private func field(_ title: String, _ text: Binding<String>, commit: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            TextField(title, text: text)
                .textFieldStyle(.roundedBorder)
                .labelsHidden()
                .onSubmit(commit)
                .onChange(of: text.wrappedValue) { _, value in
                    if value.count > SideSwitchSettings.maxLength { text.wrappedValue = String(value.prefix(SideSwitchSettings.maxLength)) }
                }
        }
    }
}

/// Shows the switch under the icon, flips it, and keeps it where the icon is.
final class SideSwitchController: ObservableObject {
    static let shared = SideSwitchController()
    /// In the icon's right-click menu and the View menu: shows or hides the switch.
    static let menuTitle = "Show the Switch Under the Icon"

    @Published private(set) var settings = SideSwitchSettings.load()
    /// ⌥-click hides it until you next open Didja.
    private var hiddenUntilOpen = false
    private var window: SwitchWindow?
    private var hosting: NSHostingView<SideSwitchView>?
    private var timer: Timer?
    private var hotKey: GlobalHotKey?
    private var popover: NSPopover?
    /// Where the menu bar icon is now, and whether the menu bar is dark.
    var icon: () -> (frame: NSRect?, dark: Bool) = { (nil, false) }

    func start() { apply() }

    func update(_ change: (inout SideSwitchSettings) -> Void) {
        var next = settings
        change(&next)
        guard next != settings else { return }
        settings = next
        settings.save()
        if !settings.on { hiddenUntilOpen = false }
        apply()
    }

    func rename(left: String? = nil, right: String? = nil) {
        update { s in
            if let left { s.left = SideSwitchSettings.clean(left, otherwise: s.left) }
            if let right { s.right = SideSwitchSettings.clean(right, otherwise: s.right) }
        }
    }

    func flip() { update { $0.flip() } }

    /// Didja was opened: a switch hidden with ⌥-click comes back.
    func didOpenDidja() {
        guard hiddenUntilOpen else { return }
        hiddenUntilOpen = false
        apply()
    }

    private func apply() {
        if settings.on, hotKey == nil {
            hotKey = GlobalHotKey(keyCode: kVK_ANSI_S, modifiers: controlKey | optionKey) { [weak self] in self?.flip() }
        } else if !settings.on {
            hotKey = nil
        }
        guard settings.on, !hiddenUntilOpen else {
            timer?.invalidate()
            timer = nil
            popover?.close()
            window?.orderOut(nil)
            return
        }
        let window = self.window ?? makeWindow()
        place(window)
        if timer == nil {
            // The icon moves when other menu bar items come and go, and the menu bar turns dark or light.
            timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
                guard let self, let window = self.window else { return }
                self.place(window)
            }
        }
    }

    private func place(_ window: SwitchWindow) {
        let (iconFrame, dark) = icon()
        let view = SideSwitchView(settings: settings, dark: dark)
        if hosting?.rootView.settings != settings || hosting?.rootView.dark != dark { hosting?.rootView = view }
        let size = hosting?.fittingSize ?? NSSize(width: 160, height: 40)
        guard let frame = SideSwitchSettings.frame(size: size, icon: iconFrame, screens: NSScreen.screens.map(\.frame)) else {
            window.orderOut(nil)
            return
        }
        if window.frame != frame { window.setFrame(frame, display: true) }
        if !window.isVisible { window.orderFrontRegardless() }
    }

    private func makeWindow() -> SwitchWindow {
        let hosting = NSHostingView(rootView: SideSwitchView(settings: settings, dark: icon().dark))
        let window = SwitchWindow(contentRect: NSRect(origin: .zero, size: hosting.fittingSize),
                                  styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = true
        window.level = .statusBar
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        window.hidesOnDeactivate = false
        window.isReleasedWhenClosed = false
        let container = SwitchClickView(frame: NSRect(origin: .zero, size: hosting.fittingSize))
        hosting.frame = container.bounds
        hosting.autoresizingMask = [.width, .height]
        container.addSubview(hosting)
        container.onClick = { [weak self] option in
            guard let self else { return }
            if option {
                self.hiddenUntilOpen = true
                self.apply()
            } else {
                self.flip()
            }
        }
        container.onRightClick = { [weak self] view in self?.rename(from: view) }
        window.contentView = container
        self.hosting = hosting
        self.window = window
        return window
    }

    private func rename(from view: NSView) {
        let popover = NSPopover()
        popover.behavior = .transient
        popover.contentViewController = NSHostingController(rootView: SideSwitchEditor(controller: self, done: { [weak popover] in popover?.performClose(nil) }))
        // The fields need the keyboard: bring Didja forward for as long as the popover is open.
        Front.activate()
        window?.makeKey()
        popover.show(relativeTo: view.bounds, of: view, preferredEdge: .minY)
        self.popover = popover
    }
}

/// A borderless panel that can take the keyboard only for the rename fields.
final class SwitchWindow: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

/// Takes every click on the switch: a click flips it, ⌥-click hides it, a right-click renames.
final class SwitchClickView: NSView {
    var onClick: (Bool) -> Void = { _ in }
    var onRightClick: (NSView) -> Void = { _ in }

    override func hitTest(_ point: NSPoint) -> NSView? { frame.contains(point) ? self : nil }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseUp(with event: NSEvent) {
        if event.modifierFlags.contains(.control) { return onRightClick(self) }
        onClick(event.modifierFlags.contains(.option))
    }
    override func rightMouseUp(with event: NSEvent) { onRightClick(self) }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .pointingHand) }
}
