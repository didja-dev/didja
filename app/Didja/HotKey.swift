import AppKit
import Carbon.HIToolbox

/// A system-wide keyboard shortcut. Uses the Carbon hot key API, which needs no
/// permission and only reports these key combinations to the app.
final class GlobalHotKey {
    /// ⇧⌘J opens the panel unless you chose other keys (SCR-40); ⌃⌥P pauses and resumes capture.
    static var label: String { HotKeyShortcut.saved.label }
    static let pauseLabel = HotKeyShortcut.pause.label

    private static var actions: [UInt32: () -> Void] = [:]
    private static var handler: EventHandlerRef?
    private static var nextID: UInt32 = 1

    private var hotKey: EventHotKeyRef?
    private let id: UInt32

    convenience init?(_ shortcut: HotKeyShortcut, action: @escaping () -> Void) {
        self.init(keyCode: shortcut.keyCode, modifiers: shortcut.modifiers, action: action)
    }

    init?(keyCode: Int = kVK_ANSI_S, modifiers: Int = controlKey | optionKey, action: @escaping () -> Void) {
        guard Self.installHandler() else { return nil }
        id = Self.nextID
        Self.nextID += 1
        let hotKeyID = EventHotKeyID(signature: OSType(0x5343_5257), id: id) // "SCRW"
        let registered = RegisterEventHotKey(UInt32(keyCode), UInt32(modifiers), hotKeyID, GetApplicationEventTarget(), 0, &hotKey)
        // Fails when another app already owns the combination.
        guard registered == noErr else { return nil }
        Self.actions[id] = action
    }

    deinit {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        Self.actions[id] = nil
    }

    /// One handler for every hot key; the key's id says which was pressed.
    private static func installHandler() -> Bool {
        guard handler == nil else { return true }
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let status = InstallEventHandler(GetApplicationEventTarget(), { _, event, _ in
            var pressed = EventHotKeyID()
            let read = GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                                         nil, MemoryLayout<EventHotKeyID>.size, nil, &pressed)
            guard read == noErr else { return OSStatus(eventNotHandledErr) }
            let id = pressed.id
            DispatchQueue.main.async { GlobalHotKey.actions[id]?() }
            return noErr
        }, 1, &spec, nil, &handler)
        return status == noErr
    }
}

/// A key combination for a hot key: a virtual key code and Carbon modifier bits (SCR-40).
/// Kept apart from the registration so it can be tested.
struct HotKeyShortcut: Equatable {
    var keyCode: Int
    var modifiers: Int

    /// ⇧⌘J: one hand, and taken by no macOS shortcut or common app (⌃⌥S until 2026-11-12: its keys sit too close).
    static let standard = HotKeyShortcut(keyCode: kVK_ANSI_J, modifiers: cmdKey | shiftKey)
    static let pause = HotKeyShortcut(keyCode: kVK_ANSI_P, modifiers: controlKey | optionKey)

    static let codeKey = "panelHotKeyCode"
    static let modifiersKey = "panelHotKeyModifiers"
    static let didChange = Notification.Name("PanelHotKeyDidChange")

    /// The keys that open the panel: yours if you changed them, ⇧⌘J otherwise.
    static var saved: HotKeyShortcut {
        get {
            let defaults = UserDefaults.standard
            guard defaults.object(forKey: codeKey) != nil, defaults.object(forKey: modifiersKey) != nil else { return standard }
            let shortcut = HotKeyShortcut(keyCode: defaults.integer(forKey: codeKey), modifiers: defaults.integer(forKey: modifiersKey))
            return shortcut.problem == nil ? shortcut : standard
        }
        set {
            let defaults = UserDefaults.standard
            if newValue == standard {
                defaults.removeObject(forKey: codeKey)
                defaults.removeObject(forKey: modifiersKey)
            } else {
                defaults.set(newValue.keyCode, forKey: codeKey)
                defaults.set(newValue.modifiers, forKey: modifiersKey)
            }
            NotificationCenter.default.post(name: didChange, object: nil)
        }
    }

    /// The keys as pressed, from a key-down event: only ⌃ ⌥ ⇧ ⌘ count as modifiers.
    init(keyCode: Int, modifiers: Int) {
        self.keyCode = keyCode
        self.modifiers = modifiers & (controlKey | optionKey | shiftKey | cmdKey)
    }

    init(keyCode: Int, flags: NSEvent.ModifierFlags) {
        var bits = 0
        if flags.contains(.control) { bits |= controlKey }
        if flags.contains(.option) { bits |= optionKey }
        if flags.contains(.shift) { bits |= shiftKey }
        if flags.contains(.command) { bits |= cmdKey }
        self.init(keyCode: keyCode, modifiers: bits)
    }

    /// As macOS writes it: ⌃⌥⇧⌘ in that order, then the key.
    var label: String {
        var text = ""
        if modifiers & controlKey != 0 { text += "⌃" }
        if modifiers & optionKey != 0 { text += "⌥" }
        if modifiers & shiftKey != 0 { text += "⇧" }
        if modifiers & cmdKey != 0 { text += "⌘" }
        return text + (Self.keyName(keyCode) ?? "?")
    }

    /// Why these keys can't open the panel, or nil when they can.
    var problem: String? {
        guard Self.keyName(keyCode) != nil else { return "Choose a letter, number, F-key or Space." }
        let isFunctionKey = Self.functionKeys.keys.contains(keyCode)
        if !isFunctionKey && modifiers & (controlKey | optionKey | cmdKey) == 0 {
            return "Hold ⌃, ⌥ or ⌘ with the key, so it doesn't take over typing everywhere."
        }
        if self == Self.pause { return "\(label) already pauses and resumes capture." }
        if Self.systemTaken.contains(self) { return "\(label) is used by macOS." }
        return nil
    }

    /// Combinations macOS keeps for itself, which would never reach Didja or would break a habit.
    static let systemTaken: [HotKeyShortcut] = [
        HotKeyShortcut(keyCode: kVK_Space, modifiers: cmdKey),               // Spotlight
        HotKeyShortcut(keyCode: kVK_Space, modifiers: cmdKey | optionKey),   // Finder search
        HotKeyShortcut(keyCode: kVK_Space, modifiers: controlKey),           // input source
        HotKeyShortcut(keyCode: kVK_ANSI_Q, modifiers: cmdKey),              // Quit
        HotKeyShortcut(keyCode: kVK_ANSI_W, modifiers: cmdKey),              // Close
        HotKeyShortcut(keyCode: kVK_ANSI_H, modifiers: cmdKey),              // Hide
        HotKeyShortcut(keyCode: kVK_ANSI_M, modifiers: cmdKey),              // Minimise
        HotKeyShortcut(keyCode: kVK_Tab, modifiers: cmdKey),                 // App switcher
        HotKeyShortcut(keyCode: kVK_ANSI_Q, modifiers: cmdKey | controlKey), // Lock Screen
    ]

    static let functionKeys: [Int: String] = [
        kVK_F1: "F1", kVK_F2: "F2", kVK_F3: "F3", kVK_F4: "F4", kVK_F5: "F5", kVK_F6: "F6",
        kVK_F7: "F7", kVK_F8: "F8", kVK_F9: "F9", kVK_F10: "F10", kVK_F11: "F11", kVK_F12: "F12",
        kVK_F13: "F13", kVK_F14: "F14", kVK_F15: "F15", kVK_F16: "F16", kVK_F17: "F17", kVK_F18: "F18", kVK_F19: "F19",
    ]

    private static let named: [Int: String] = [
        kVK_ANSI_A: "A", kVK_ANSI_B: "B", kVK_ANSI_C: "C", kVK_ANSI_D: "D", kVK_ANSI_E: "E", kVK_ANSI_F: "F",
        kVK_ANSI_G: "G", kVK_ANSI_H: "H", kVK_ANSI_I: "I", kVK_ANSI_J: "J", kVK_ANSI_K: "K", kVK_ANSI_L: "L",
        kVK_ANSI_M: "M", kVK_ANSI_N: "N", kVK_ANSI_O: "O", kVK_ANSI_P: "P", kVK_ANSI_Q: "Q", kVK_ANSI_R: "R",
        kVK_ANSI_S: "S", kVK_ANSI_T: "T", kVK_ANSI_U: "U", kVK_ANSI_V: "V", kVK_ANSI_W: "W", kVK_ANSI_X: "X",
        kVK_ANSI_Y: "Y", kVK_ANSI_Z: "Z",
        kVK_ANSI_0: "0", kVK_ANSI_1: "1", kVK_ANSI_2: "2", kVK_ANSI_3: "3", kVK_ANSI_4: "4",
        kVK_ANSI_5: "5", kVK_ANSI_6: "6", kVK_ANSI_7: "7", kVK_ANSI_8: "8", kVK_ANSI_9: "9",
        kVK_Space: "Space", kVK_ANSI_Minus: "-", kVK_ANSI_Equal: "=", kVK_ANSI_LeftBracket: "[",
        kVK_ANSI_RightBracket: "]", kVK_ANSI_Semicolon: ";", kVK_ANSI_Quote: "'", kVK_ANSI_Comma: ",",
        kVK_ANSI_Period: ".", kVK_ANSI_Slash: "/", kVK_ANSI_Backslash: "\\", kVK_ANSI_Grave: "`",
        kVK_Tab: "Tab",
    ]

    /// The key's name on a US keyboard, or nil for keys that can't be used (Esc, Return, arrows, modifiers alone).
    static func keyName(_ keyCode: Int) -> String? { named[keyCode] ?? functionKeys[keyCode] }
}

/// The hot key that opens the panel, which you can change in Settings › General (SCR-40).
final class PanelHotKey {
    static let shared = PanelHotKey()
    private var hotKey: GlobalHotKey?
    private var action: (() -> Void)?

    /// Registers the saved keys. False when another app already owns them.
    @discardableResult
    func start(action: @escaping () -> Void) -> Bool {
        self.action = action
        hotKey = GlobalHotKey(HotKeyShortcut.saved, action: action)
        return hotKey != nil
    }

    /// While you are choosing new keys, the old ones must not open the panel.
    func suspend() { hotKey = nil }

    /// Back to the saved keys after choosing was cancelled.
    func resume() {
        guard hotKey == nil, let action else { return }
        hotKey = GlobalHotKey(HotKeyShortcut.saved, action: action)
    }

    /// Uses `shortcut` from now on, also after a restart. Returns why it can't, and then
    /// keeps the keys it had: these keys are not allowed, or another app already owns them.
    func change(to shortcut: HotKeyShortcut) -> String? {
        if let problem = shortcut.problem { return problem }
        hotKey = nil
        guard let action else {
            HotKeyShortcut.saved = shortcut // not started (tests): only remember the choice
            return nil
        }
        if let registered = GlobalHotKey(shortcut, action: action) {
            hotKey = registered
            HotKeyShortcut.saved = shortcut
            return nil
        }
        hotKey = GlobalHotKey(HotKeyShortcut.saved, action: action)
        return "\(shortcut.label) is already used by another app."
    }
}

/// Choosing new keys for the panel in Settings › General (SCR-40): press Change…, then the keys.
/// Esc cancels. Keys that can't be used are explained and you can try again.
final class HotKeyRecording: ObservableObject {
    @Published private(set) var shortcut = HotKeyShortcut.saved
    @Published private(set) var recording = false
    /// Why the last keys pressed were not taken, until you try again.
    @Published private(set) var message: String?
    private var monitor: Any?
    private let hotKey: PanelHotKey

    init(hotKey: PanelHotKey = .shared) { self.hotKey = hotKey }

    deinit { if let monitor { NSEvent.removeMonitor(monitor) } }

    static let hint = "Click Change, then press the new keys. Esc cancels."

    func start() {
        guard !recording else { return }
        recording = true
        message = nil
        hotKey.suspend()
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, self.recording else { return event }
            self.press(keyCode: Int(event.keyCode), flags: event.modifierFlags)
            return nil
        }
    }

    func cancel() {
        guard recording else { return }
        stop()
        hotKey.resume()
    }

    /// Back to ⇧⌘J.
    func reset() {
        if recording { cancel() }
        message = hotKey.change(to: .standard)
        shortcut = HotKeyShortcut.saved
    }

    /// A key pressed while choosing.
    func press(keyCode: Int, flags: NSEvent.ModifierFlags) {
        guard recording else { return }
        if keyCode == kVK_Escape && flags.intersection([.command, .control, .option, .shift]).isEmpty {
            cancel()
            return
        }
        let pressed = HotKeyShortcut(keyCode: keyCode, flags: flags)
        if let problem = hotKey.change(to: pressed) {
            message = problem
            hotKey.suspend() // still choosing
            return
        }
        message = nil
        stop()
        shortcut = HotKeyShortcut.saved
    }

    private func stop() {
        recording = false
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
    }
}

/// A view filled with the app's surface colour, which follows light and dark.
final class SurfaceBacking: NSView {
    override var wantsUpdateLayer: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
    }

    required init?(coder: NSCoder) {
        fatalError("not used")
    }

    override func updateLayer() {
        layer?.backgroundColor = Palette.surfaceNS.cgColor
    }
}

/// The menu bar icon and the panel that drops down from it.
///
/// The app owns both (an NSStatusItem and an NSPopover) instead of using
/// SwiftUI's MenuBarExtra, because that offers no way to open its panel from
/// code, which the hot key needs.
final class MenuBarPanel: NSObject, NSPopoverDelegate, NSWindowDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let popover = NSPopover()
    /// The app you were in when the panel opened, to hand the keyboard back to.
    private var previousApp: NSRunningApplication?
    /// Called each time the panel has closed.
    var onClose: (() -> Void)?
    /// Called each time the panel opens (SCR-100: the Day Review that is due, the first-tick note).
    var onShow: (() -> Void)?
    /// The same panel as a small window of its own, used while it is pinned (SCR-25).
    private let pinnedContent: NSViewController
    private var pinnedWindow: NSPanel?

    /// `pinnedContent` is the panel as shown in its own window while pinned. It must
    /// not size its window (for a hosting controller, `sizingOptions = []`): that
    /// window's height is the one you give it.
    init(content: NSViewController, pinnedContent: NSViewController) {
        self.pinnedContent = pinnedContent
        super.init()
        popover.contentViewController = content
        popover.behavior = PanelStaysOpen.popoverBehavior(PanelStaysOpen.isOn) // closes when you click elsewhere, unless you chose otherwise (SCR-39)
        popover.animates = false
        popover.delegate = self
        applyAppearance()
        NotificationCenter.default.addObserver(
            self, selector: #selector(applyAppearance), name: AppearanceSetting.didChange, object: nil)
        // Switching to another app (⌘Tab, a click in its window, the Dock) closes the panel (SCR-30).
        NotificationCenter.default.addObserver(
            self, selector: #selector(appResigned), name: NSApplication.didResignActiveNotification, object: nil)
        // Another app coming to the front closes it too, even when the panel never got to make
        // Didja the active app, so no "resigned" ever comes (SCR-39).
        NSWorkspace.shared.notificationCenter.addObserver(
            self, selector: #selector(otherAppActivated(_:)), name: NSWorkspace.didActivateApplicationNotification, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(staysOpenChanged), name: PanelStaysOpen.didChange, object: nil)
        if let button = statusItem.button {
            button.image = Self.menuBarImage()
            button.imagePosition = .imageLeading
            button.target = self
            button.action = #selector(clicked)
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
    }

    /// The Prompt done mark as a template image, so macOS tints it for light and dark menu bars (SCR-34).
    static func menuBarImage() -> NSImage? {
        guard let image = NSImage(named: "MenuBarIcon")?.copy() as? NSImage else {
            return NSImage(systemSymbolName: "checkmark.circle", accessibilityDescription: "Didja")
        }
        image.isTemplate = true
        image.size = NSSize(width: 18, height: 18)
        image.accessibilityDescription = "Didja"
        return image
    }

    var isShown: Bool { popover.isShown || pinnedWindow?.isVisible == true }

    /// True while the panel is pinned to a place of your choosing instead of hanging under the icon.
    var isPinned: Bool { PanelPlacement.saved != nil }

    /// The panel's window while it is open.
    var window: NSWindow? {
        if let pinnedWindow, pinnedWindow.isVisible { return pinnedWindow }
        return popover.contentViewController?.view.window
    }

    /// A short word beside the icon when something needs you ("needs you", "paused"), or none.
    func setMark(_ mark: String) {
        statusItem.button?.title = mark.isEmpty ? "" : " \(mark)"
    }

    /// A popover takes its look from the menu bar it hangs off, not from the app,
    /// so it has to be told. Also called when the setting changes while it is open.
    @objc func applyAppearance() {
        let look = AppearanceSetting.current
        popover.appearance = look
        popover.contentViewController?.view.appearance = look
        popover.contentViewController?.view.window?.appearance = look
        pinnedWindow?.appearance = look
        pinnedContent.view.appearance = look
    }

    /// When the panel last closed, however it closed.
    private var closedAt = Date.distantPast

    /// A click on the icon while the panel is open closes it. The panel closes
    /// itself the moment the mouse goes down outside it, the icon included, so by
    /// the time the click arrives here it is already shut: a click that follows a
    /// close this closely was that same click, and must not open it again.
    static func clickOpens(isShown: Bool, closedAt: Date, now: Date = Date()) -> Bool {
        !isShown && now.timeIntervalSince(closedAt) > 0.35
    }

    @objc private func clicked() {
        if NSApplication.shared.currentEvent?.type == .rightMouseUp {
            showIconMenu()
        } else if pinnedWindow?.isVisible == true {
            close()
        } else if popover.isShown {
            close()
        } else if Self.clickOpens(isShown: false, closedAt: closedAt) {
            show()
        }
    }

    func toggle() {
        if isShown { close() } else { show() }
    }

    /// Right-click on the icon: pin or unpin the panel without opening it first.
    private func showIconMenu() {
        let menu = NSMenu()
        let item = isPinned
            ? NSMenuItem(title: ViewNames.unpinTitle, action: #selector(unpinFromMenu), keyEquivalent: "")
            : NSMenuItem(title: ViewNames.pinTitle, action: #selector(pinFromMenu), keyEquivalent: "")
        item.target = self
        menu.addItem(item)
        let stays = NSMenuItem(title: PanelStaysOpen.menuTitle, action: #selector(toggleStaysOpen), keyEquivalent: "")
        stays.target = self
        stays.state = PanelStaysOpen.isOn ? .on : .off
        menu.addItem(stays)
        statusItem.menu = menu
        statusItem.button?.performClick(nil)
        statusItem.menu = nil
    }

    @objc private func pinFromMenu() { pin() }
    @objc private func unpinFromMenu() { unpin() }
    @objc private func toggleStaysOpen() { PanelStaysOpen.isOn.toggle() }

    /// Opens the panel and gives it the keyboard: where you pinned it, under the icon, or, while
    /// the icon cannot be seen (the menu bar hidden), as a floating window at the top of the screen.
    /// False if it could not be shown.
    @discardableResult
    func show() -> Bool {
        shownAt = Date()
        onShow?()
        let front = NSWorkspace.shared.frontmostApplication
        let previous = front?.processIdentifier == ProcessInfo.processInfo.processIdentifier ? nil : front
        if let saved = PanelPlacement.saved {
            previousApp = previous
            NSApplication.shared.activate(ignoringOtherApps: true)
            let window = makePinnedWindow()
            applyAppearance()
            window.setFrame(PanelPlacement.fitted(saved, screens: NSScreen.screens.map(\.visibleFrame)), display: true)
            window.makeKeyAndOrderFront(nil)
            watchOutsideClicks()
            return true
        }
        // With "Automatically hide and show the menu bar" on, the icon is off screen while the
        // menu bar is hidden: a popover hung off it closes at once. Open the panel as a floating
        // window at the top of the screen instead, under where the icon is (LOCAL-1).
        let iconFrame = statusItem.button?.window?.frame
        if PanelAnchor.decide(pinned: false, menuBarVisible: NSMenu.menuBarVisible(),
                              iconOnScreen: Self.onScreen(iconFrame, screens: NSScreen.screens.map(\.frame))) == .floating {
            previousApp = previous
            NSApplication.shared.activate(ignoringOtherApps: true)
            let window = makePinnedWindow()
            applyAppearance()
            let screen = NSScreen.main ?? NSScreen.screens.first
            window.setFrame(PanelPlacement.floating(iconMidX: iconFrame?.midX, screen: screen?.visibleFrame ?? .zero), display: true)
            window.makeKeyAndOrderFront(nil)
            watchOutsideClicks()
            return true
        }
        guard let button = statusItem.button, button.window != nil else { return false }
        previousApp = previous
        NSApplication.shared.activate(ignoringOtherApps: true)
        applyAppearance() // the system may have switched since last time
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        paintChrome()
        applyAppearance()
        window?.makeKey()
        // The popover's window is not always ready to take the keyboard at once; ask again
        // on the next turn so the first Esc reaches it (SCR-30).
        DispatchQueue.main.async { [weak self] in
            guard let self, self.popover.isShown, let window = self.window, !window.isKeyWindow else { return }
            window.makeKey()
        }
        watchOutsideClicks()
        return popover.isShown
    }

    /// A click in another app's window closes the panel. A transient popover usually sees
    /// these itself, but not when the keyboard had already gone elsewhere (SCR-30).
    private var outsideClicks: Any?

    private func watchOutsideClicks() {
        guard outsideClicks == nil else { return }
        outsideClicks = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            self?.closeForOutsideActivity()
        }
    }

    private func stopWatchingOutsideClicks() {
        if let outsideClicks { NSEvent.removeMonitor(outsideClicks) }
        outsideClicks = nil
    }

    @objc private func appResigned() { closeForOutsideActivity() }

    @objc private func otherAppActivated(_ note: Notification) {
        let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
        guard Self.isOtherApp(app?.processIdentifier) else { return }
        closeForOutsideActivity()
    }

    /// True for an app that is not Didja itself. Didja coming to the front (the panel opening)
    /// must never close the panel.
    static func isOtherApp(_ pid: pid_t?, own: pid_t = ProcessInfo.processInfo.processIdentifier) -> Bool {
        guard let pid else { return false }
        return pid != own
    }

    /// Whether the icon's window is on a screen at all: off screen while the menu bar is hidden.
    static func onScreen(_ frame: NSRect?, screens: [NSRect]) -> Bool {
        guard let frame, frame.width > 0, frame.height > 0 else { return false }
        return screens.contains { $0.intersects(frame) }
    }

    /// You clicked in another app, switched to one, or Didja stopped being the front app.
    private func closeForOutsideActivity() {
        guard Self.closesOnOutsideActivity(popoverShown: popover.isShown,
                                           pinnedShown: pinnedWindow?.isVisible == true,
                                           staysOpen: PanelStaysOpen.isOn,
                                           sinceShown: Date().timeIntervalSince(shownAt)) else { return }
        close()
    }

    /// When the panel last opened.
    private var shownAt = Date.distantPast

    /// Whether going to another app closes the panel (SCR-39): it does, under the icon and
    /// pinned alike, unless you chose "Keep Panel Open When You Click Elsewhere". Not in the
    /// moment it opens: pinning closes the panel under the icon and reopens it as a window,
    /// and the app you came from may come to the front in between, a little late; and with the
    /// menu bar hidden, its sliding away as the panel opens is not you going elsewhere (LOCAL-1).
    static func closesOnOutsideActivity(popoverShown: Bool, pinnedShown: Bool, staysOpen: Bool,
                                        sinceShown: TimeInterval = .infinity) -> Bool {
        !staysOpen && (popoverShown || pinnedShown) && sinceShown > outsideGrace
    }

    /// How long after opening outside activity is ignored.
    static let outsideGrace: TimeInterval = 0.5

    @objc private func staysOpenChanged() {
        popover.behavior = PanelStaysOpen.popoverBehavior(PanelStaysOpen.isOn)
    }

    /// Whether Esc closes the panel. Esc closes it from the panel's own window, and also when
    /// the key reached no window of ours (the panel open but the keyboard not yet in it); never
    /// from another of our windows, which handle Esc themselves (SCR-30).
    static func escCloses(panelShown: Bool, inPanel: Bool, inOtherOwnWindow: Bool) -> Bool {
        panelShown && (inPanel || !inOtherOwnWindow)
    }

    func close() {
        if let pinnedWindow, pinnedWindow.isVisible {
            pinnedWindow.orderOut(nil)
            didClose()
        } else {
            popover.performClose(nil)
        }
    }

    /// Pins the panel: it becomes a small window, where the panel is now (or under
    /// the icon), that you can drag anywhere and make taller or shorter. From then on
    /// the icon and the hot key show and hide it there, also after a restart.
    func pin() {
        let start = popover.isShown ? popover.contentViewController?.view.window?.frame : nil
        if popover.isShown { popover.performClose(nil) }
        let anchor = statusItem.button?.window?.frame
        PanelPlacement.saved = PanelPlacement.fitted(
            start ?? PanelPlacement.underIcon(anchor, screen: NSScreen.main?.visibleFrame ?? .zero),
            screens: NSScreen.screens.map(\.visibleFrame))
        // Show it straight away, where it was, so it can be moved.
        DispatchQueue.main.async { [weak self] in self?.show() }
    }

    /// Back to the panel that drops down from the icon. The place you pinned it is forgotten.
    func unpin() {
        let wasShown = isShown
        if let pinnedWindow, pinnedWindow.isVisible {
            pinnedWindow.orderOut(nil)
            didClose()
        }
        PanelPlacement.saved = nil
        if wasShown { DispatchQueue.main.async { [weak self] in self?.show() } }
    }

    private func makePinnedWindow() -> NSPanel {
        if let pinnedWindow { return pinnedWindow }
        let window = NSPanel(contentRect: NSRect(x: 0, y: 0, width: PanelPlacement.width, height: 500),
                             styleMask: [.titled, .closable, .resizable, .utilityWindow],
                             backing: .buffered, defer: false)
        window.title = "Didja — \(ViewNames.quick)"
        window.isReleasedWhenClosed = false
        window.hidesOnDeactivate = false
        window.becomesKeyOnlyIfNeeded = false
        window.level = .floating
        window.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
        window.contentViewController = pinnedContent
        window.contentMinSize = NSSize(width: PanelPlacement.width, height: PanelPlacement.minHeight)
        window.contentMaxSize = NSSize(width: PanelPlacement.width, height: 10_000)
        window.backgroundColor = Palette.surfaceNS
        window.delegate = self
        pinnedWindow = window
        return window
    }

    // MARK: The pinned window

    /// Its close button hides it, like the icon and the hot key do.
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        close()
        return false
    }

    func windowDidMove(_ notification: Notification) { remember() }
    func windowDidEndLiveResize(_ notification: Notification) { remember() }
    func windowDidResize(_ notification: Notification) {
        if pinnedWindow?.inLiveResize == false { remember() }
    }

    /// Wherever you leave it is where it opens next time.
    private func remember() {
        guard let pinnedWindow, pinnedWindow.isVisible, isPinned else { return }
        PanelPlacement.saved = pinnedWindow.frame
    }

    /// A popover's frame and arrow are drawn in the system's translucent grey.
    /// Lay our own surface colour behind the content so the whole panel, arrow
    /// included, is one flat colour.
    private func paintChrome() {
        guard let frame = window?.contentView?.superview,
              !frame.subviews.contains(where: { $0 is SurfaceBacking }) else { return }
        let backing = SurfaceBacking(frame: frame.bounds)
        backing.autoresizingMask = [.width, .height]
        frame.addSubview(backing, positioned: .below, relativeTo: frame.subviews.first)
    }

    /// When the panel closes, go back to the app you were working in, unless
    /// one of our own windows (the task window) has taken over.
    func popoverDidClose(_ notification: Notification) {
        didClose()
    }

    private func didClose() {
        stopWatchingOutsideClicks()
        closedAt = Date()
        onClose?()
        let ownWindowOpen = NSApplication.shared.windows.contains { $0.isVisible && $0.canBecomeMain }
        // Only while we still have the keyboard: a pinned panel can stay open while you work elsewhere.
        if !ownWindowOpen, NSApplication.shared.isActive { previousApp?.activate() }
        previousApp = nil
    }
}

/// Whether the panel stays open when you click in or switch to another app (SCR-39).
/// Off unless you turn it on: by default the panel closes, under the icon and pinned alike.
enum PanelStaysOpen {
    static let key = "panelStaysOpen"
    static let didChange = Notification.Name("PanelStaysOpenDidChange")
    static let menuTitle = "Keep \(ViewNames.quick) Open When You Click Elsewhere"

    static var isOn: Bool {
        get { UserDefaults.standard.bool(forKey: key) }
        set {
            UserDefaults.standard.set(newValue, forKey: key)
            NotificationCenter.default.post(name: didChange, object: nil)
        }
    }

    /// A transient popover closes itself on a click outside it; one that stays open must not.
    static func popoverBehavior(_ staysOpen: Bool) -> NSPopover.Behavior {
        staysOpen ? .applicationDefined : .transient
    }
}

/// How the panel opens (LOCAL-1): where you pinned it; under the icon; or, when the icon cannot be
/// seen because the menu bar is hidden ("Automatically hide and show the menu bar"), as a floating
/// window at the top of the screen. Kept apart from AppKit so it can be tested.
enum PanelAnchor: Equatable {
    case pinned, popover, floating

    static func decide(pinned: Bool, menuBarVisible: Bool, iconOnScreen: Bool) -> PanelAnchor {
        if pinned { return .pinned }
        return menuBarVisible && iconOnScreen ? .popover : .floating
    }
}

/// Where the pinned panel goes (SCR-25). Kept apart from AppKit so it can be tested.
enum PanelPlacement {
    /// The panel is always this wide; only its height can be changed.
    static let width: CGFloat = 440
    static let minHeight: CGFloat = 260
    static let key = "pinnedPanelFrame"

    /// The frame you left the pinned panel at, or nil when it is not pinned.
    static var saved: NSRect? {
        get { decode(UserDefaults.standard.string(forKey: key)) }
        set { UserDefaults.standard.set(newValue.map { NSStringFromRect($0) }, forKey: key) }
    }

    static func decode(_ string: String?) -> NSRect? {
        guard let string else { return nil }
        let rect = NSRectFromString(string)
        return rect.width > 0 && rect.height > 0 ? rect : nil
    }

    /// The saved frame made to fit the screens there are now: the panel's own width,
    /// a height between the minimum and the screen's, and wholly on the screen it
    /// overlaps most. If it overlaps none (that display is gone), it goes to the first
    /// screen's top right.
    static func fitted(_ frame: NSRect, screens: [NSRect]) -> NSRect {
        guard let first = screens.first else { return frame }
        let screen = screens.max { overlap(frame, $0) < overlap(frame, $1) }.flatMap { overlap(frame, $0) > 0 ? $0 : nil }
        var result = frame
        result.size.width = min(width, (screen ?? first).width)
        let home = screen ?? first
        result.size.height = min(max(frame.height, minHeight), home.height)
        if screen == nil {
            result.origin = NSPoint(x: home.maxX - result.width, y: home.maxY - result.height)
        }
        result.origin.x = min(max(result.origin.x, home.minX), home.maxX - result.width)
        result.origin.y = min(max(result.origin.y, home.minY), home.maxY - result.height)
        return result
    }

    /// Where the panel opens while the menu bar is hidden (LOCAL-1): at the top of the screen's
    /// visible frame (which then reaches the top edge), centred under the icon's x and kept on the
    /// screen; at the top right when the icon's place is unknown. Not remembered: it is not pinned.
    static func floating(iconMidX: CGFloat?, screen: NSRect) -> NSRect {
        let height = min(520, screen.height)
        let w = min(width, screen.width)
        let x = iconMidX.map { min(max($0 - w / 2, screen.minX), screen.maxX - w) } ?? (screen.maxX - w)
        return NSRect(x: x, y: screen.maxY - height, width: w, height: height)
    }

    /// Where the panel starts when pinned while closed: just under the menu bar icon.
    static func underIcon(_ icon: NSRect?, screen: NSRect) -> NSRect {
        let height: CGFloat = 520
        guard let icon else { return NSRect(x: screen.maxX - width, y: screen.maxY - height, width: width, height: height) }
        return NSRect(x: icon.midX - width / 2, y: icon.minY - height, width: width, height: height)
    }

    private static func overlap(_ a: NSRect, _ b: NSRect) -> CGFloat {
        let i = a.intersection(b)
        return i.isNull ? 0 : i.width * i.height
    }
}
