import Carbon.HIToolbox
import Combine
import SwiftUI

/// The binary has two jobs: the menu bar app, and (when the engine runs it with
/// `--judge`) a one-shot question to the on-device model.
@main
enum Main {
    static func main() {
        // Renamed from ScrolledAway: bring its data and settings along, once.
        ObservationStore.moveFromOldName()
        ObservationStore.copyOldPreferences()
        if CommandLine.arguments.contains("--judge-server") {
            // The engine's model questions, one process for all of them (SCR-77).
            JudgeServer.serve()
        }
        if CommandLine.arguments.contains("--judge") {
            Judge.runFromCommandLine()
        }
        if CommandLine.arguments.contains("--needs-reply") {
            Judge.mailFromCommandLine()
        }
        if CommandLine.arguments.contains("--chat") {
            Judge.chatFromCommandLine()
        }
        if CommandLine.arguments.contains("--chat-reply") {
            Judge.chatReplyFromCommandLine()
        }
        if CommandLine.arguments.contains("--looks-done") {
            Judge.lookFromCommandLine()
        }
        if CommandLine.arguments.contains("--criteria") {
            Judge.criteriaFromCommandLine()
        }
        if let i = CommandLine.arguments.firstIndex(of: "--ax-outline"), i + 1 < CommandLine.arguments.count {
            // For building capture adapters: an app's window shape, masked (see AXOutline).
            let text = CommandLine.arguments.contains("--lines")
                ? AXOutline.lines(bundleID: CommandLine.arguments[i + 1])
                : AXOutline.outline(bundleID: CommandLine.arguments[i + 1])
            if i + 2 < CommandLine.arguments.count {
                try? text.write(toFile: CommandLine.arguments[i + 2], atomically: true, encoding: .utf8)
            } else { print(text, terminator: "") }
            exit(0)
        }
        if CommandLine.arguments.contains("--profile-test") {
            // Try an app profile against a fixture (see ProfileLab). Reads nothing on screen.
            ProfileLab.commandLine(CommandLine.arguments)
        }
        if let i = CommandLine.arguments.firstIndex(of: "--go-to-source"), i + 1 < CommandLine.arguments.count {
            // Diagnose "Go to Source" from a terminal: steps and sizes only, never screen text.
            SourceJumper.trace = { print($0) }
            let json = (try? String(contentsOfFile: CommandLine.arguments[i + 1], encoding: .utf8)) ?? ""
            guard let place = try? JSONDecoder().decode(TaskPlace.self, from: Data(json.utf8)) else { print("bad place"); exit(1) }
            let policy = try? PrivacyPolicy.load(userFile: FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Application Support/Didja/\(ExcludeList.fileName)"))
            if CommandLine.arguments.contains("--look-only") {
                // Read only: nothing is brought forward, pressed or scrolled.
                SourceJumper.describeSidebar(for: place)
            } else {
                print("outcome:", SourceJumper.go(to: place, policy: policy))
            }
            exit(0)
        }
        if CommandLine.arguments.contains("--title") {
            Judge.titleFromCommandLine()
        }
        DidjaApp.main()
    }
}

/// Didja is a menu bar app, in the Dock and ⌘Tab only while one of its windows is open (the Full
/// View, Didja Missed This, Report a Problem, Privacy, a canvas…), so you can switch back to it like
/// any app. The Quick View, under the icon or pinned, does not count.
enum DockPresence {
    static func start() {
        for name in [NSWindow.didBecomeKeyNotification, NSWindow.didBecomeMainNotification, NSWindow.didDeminiaturizeNotification] {
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { _ in update() }
        }
        for name in [NSWindow.willCloseNotification, NSWindow.didMiniaturizeNotification] {
            // The window is still on show while it closes: look once it has gone.
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { _ in DispatchQueue.main.async { update() } }
        }
    }

    /// Whether a window keeps Didja in the Dock: a titled window on show that is not the Quick View.
    static func counts(title: String, titled: Bool, visible: Bool, miniaturized: Bool) -> Bool {
        titled && visible && !miniaturized && !title.hasSuffix(ViewNames.quick) && !title.isEmpty
    }

    static func update(_ app: NSApplication = .shared) {
        let wanted: NSApplication.ActivationPolicy = app.windows.contains {
            counts(title: $0.title, titled: $0.styleMask.contains(.titled), visible: $0.isVisible, miniaturized: $0.isMiniaturized)
        } ? .regular : .accessory
        guard app.activationPolicy() != wanted else { return }
        app.setActivationPolicy(wanted)
        // Showing in the Dock reloads the icon from macOS's cache, which can hold an old one.
        AppIcon.apply(to: app)
    }
}

/// The app's icon in its own windows and alerts (SCR-47). macOS can show a stale icon for a menu bar
/// app that was rebuilt or renamed (an alert showed ScrolledAway's); setting it from the bundled
/// asset makes every alert and window show the current one.
enum AppIcon {
    static var image: NSImage? { NSImage(named: "AppIcon") }

    static func apply(to app: NSApplication = .shared) {
        if let image { app.applicationIconImage = image }
    }

    /// An alert that shows this icon, whatever macOS has cached for the app.
    static func alert() -> NSAlert {
        let alert = NSAlert()
        if let image { alert.icon = image }
        return alert
    }
}

struct DidjaApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        // The menu bar icon and its panel are set up by the app delegate (see MenuBarPanel).
        // A SwiftUI app still needs a scene; this one shows nothing.
        Settings { EmptyView() }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    let capture = CaptureCoordinator()
    private let engine = EngineRunner()
    private var tasksWindow: NSWindow?
    private var welcomeWindow: NSWindow?
    private var excludeWindow: NSWindow?
    private var privacyWindow: NSWindow?
    private var diagnosticsWindow: NSWindow?
    private var missedWindow: NSWindow?
    private var bugReportWindow: NSWindow?
    private var troubleshootingWindow: NSWindow?
    let canvasWindows = CanvasWindows()
    private var brainWindow: NSWindow?
    private var brainModel: BrainModel?
    private var namesWindow: NSWindow?
    private var connectionsWindow: NSWindow?
    private var connectionsModel: ConnectionsModel?
    private var namesModel: NamesModel?
    let popoverNavigator = TaskNavigator(scope: .popover)
    let windowNavigator = TaskNavigator(scope: .window)
    private let nudger = Nudger()
    private var pauseHotKey: GlobalHotKey?
    private var panel: MenuBarPanel?
    private var statusWatch: AnyCancellable?
    private var keyMonitor: Any?

    func applicationDidFinishLaunching(_ notification: Notification) {
        AppIcon.apply()
        CanvasDirectory.refresh()
        canvasWindows.actions = { [weak self] in self?.actions ?? TaskActions() }
        CommandHeld.shared.start()
        DockPresence.start()
        OwnClaude.addWhenDesktopQuitsIfAsked()
        // Unit tests are hosted in the app; they must not start capturing the screen.
        guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil else { return }
        AppearanceSetting.saved.apply()
        engine.start()
        capture.onObservation = { [engine] in engine.wake() }
        capture.start()
        let panel = makePanel()
        self.panel = panel
        // The mark is always the icon; a word beside it says when something needs you.
        statusWatch = capture.$status.receive(on: DispatchQueue.main).sink { status in
            switch status {
            case .capturing, .starting: panel.setMark("")
            case .paused: panel.setMark("paused")
            case .needsAccessibility, .failed: panel.setMark("needs you")
            }
        }
        if !UserDefaults.standard.bool(forKey: Self.welcomedKey) || !AXIsProcessTrusted() {
            showWelcome()
        }
        nudger.start { [weak self] in self?.panel?.show() }
        _ = Updates.shared // starts the daily update check (Release builds only, SCR-33)
        let registered = PanelHotKey.shared.start { [weak self] in self?.togglePopover() }
        // Pause and resume from anywhere, without opening the panel.
        pauseHotKey = GlobalHotKey(keyCode: kVK_ANSI_P) { [weak self] in self?.capture.isPaused.toggle() }
        if !registered { NSLog("Didja: could not register the \(GlobalHotKey.label) hot key") }
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            self?.handleKey(event) == true ? nil : event
        }
    }

    /// The global hot key: open the popover from anywhere, or close it if it is open.
    private func togglePopover() {
        guard let panel else { return }
        if panel.isShown {
            panel.close()
        } else if !panel.show() {
            showTasksWindow() // the icon is hidden (a crowded menu bar): fall back to the window
        }
    }

    func makePanel() -> MenuBarPanel {
        let content = NSHostingController(rootView: panelView(pinned: false))
        content.sizingOptions = [.preferredContentSize] // the panel follows the list's height
        // The same panel in its own window while pinned: the window's size is yours, not the list's.
        let pinnedContent = NSHostingController(rootView: panelView(pinned: true))
        pinnedContent.sizingOptions = []
        let panel = MenuBarPanel(content: content, pinnedContent: pinnedContent)
        // A search lasts as long as the panel is open: it always opens on the whole list.
        panel.onClose = { [weak self] in self?.popoverNavigator.endSearch() }
        return panel
    }

    private func panelView(pinned: Bool) -> PopoverView {
        PopoverView(
            capture: capture, actions: actions, navigator: popoverNavigator,
            openWindow: { [weak self] in
                self?.panel?.close()
                self?.showTasksWindow()
            },
            openSettings: { [weak self] in
                self?.panel?.close()
                self?.showTasksWindow(page: .general)
            },
            openWelcome: { [weak self] in
                self?.panel?.close()
                self?.showWelcome()
            },
            openExcludeList: { [weak self] in
                self?.panel?.close()
                self?.showExcludeList()
            },
            openPrivacy: { [weak self] in
                self?.panel?.close()
                self?.showPrivacy()
            },
            reportProblem: { [weak self] in
                self?.panel?.close()
                self?.showDiagnostics()
            },
            troubleshoot: { [weak self] in
                self?.panel?.close()
                self?.showTroubleshooting()
            },
            openCanvas: { [weak self] id in self?.openCanvas(id) },
            openMore: { [weak self] in self?.showMoreMenu() },
            freshStart: { [weak self] in
                self?.panel?.close()
                self?.confirmFreshStart()
            },
            undoFreshStart: { [weak self] in
                self?.panel?.close()
                self?.undoFreshStart()
            },
            forgetCapturedText: { [weak self] in
                self?.panel?.close()
                self?.confirmForget()
            },
            openBrain: { [weak self] in
                self?.panel?.close()
                self?.showBrain()
            },
            openNames: { [weak self] in
                self?.panel?.close()
                self?.showNames()
            },
            openConnections: { [weak self] in
                self?.panel?.close()
                self?.showConnections()
            },
            pinned: pinned,
            togglePin: { [weak self] in
                guard let panel = self?.panel else { return }
                if pinned { panel.unpin() } else { panel.pin() }
            })
    }

    /// Opens a canvas, or a new one for nil, and closes the Quick View.
    func openCanvas(_ id: Int?) {
        panel?.close()
        guard let id = id ?? CanvasModel.create("Untitled canvas") else { return }
        canvasWindows.show(id)
    }

    /// ⌘1–⌘9: the canvas with that number in the Quick View's strip.
    func openCanvas(number: Int) -> Bool {
        let list = CanvasDirectory.shared.numbered
        guard number >= 1, number <= list.count else { return false }
        openCanvas(list[number - 1].id)
        return true
    }

    /// The "…" menu, opened on demand as a native menu (M, ., or the button).
    func showMoreMenu() {
        MoreMenu.pop(moreMenuEntries(), in: panel?.window)
    }

    /// What the "…" menu holds: what you reach for most at the top, the rest grouped, each with its key.
    func moreMenuEntries() -> [MenuEntry] {
        let close: (@escaping () -> Void) -> () -> Void = { [weak self] run in { self?.panel?.close(); run() } }
        let canvases = CanvasDirectory.shared.numbered
        var canvasItems: [MenuEntry] = [.action("New Canvas", key: "n") { [weak self] in self?.openCanvas(nil) }]
        if !canvases.isEmpty { canvasItems.append(.separator) }
        for (index, canvas) in canvases.enumerated() {
            canvasItems.append(.action(canvas.open > 0 ? "\(canvas.title) (\(canvas.open) open)" : canvas.title,
                                       key: String(index + 1)) { [weak self] in self?.openCanvas(canvas.id) })
        }
        var top: [MenuEntry] = [
            .submenu("Canvases", canvasItems),
            .action("Fresh Start…", key: "\u{8}", modifiers: [.command, .shift], close { [weak self] in self?.confirmFreshStart() }),
        ]
        if FreshStart.canUndo() { top.append(.action("Undo Fresh Start", close { [weak self] in self?.undoFreshStart() })) }
        top.append(.action("Report a Problem with This Window…", key: "r", modifiers: [.command, .shift],
                           close { [weak self] in self?.showDiagnostics() }))
        let pinned = panel?.isPinned == true
        let view: [MenuEntry] = [
            .choice("Focus", [("All Apps", String?.none)] + capture.tasks.apps.map { ("Only \($0)", String?.some($0)) },
                    current: capture.focus) { [weak self] in self?.capture.focus = $0 },
            .choice("Sort", TaskBoard.Sort.allCases.map { ($0.label, $0) }, current: capture.sort) { [weak self] in self?.capture.sort = $0 },
            .choice("Appearance", AppearanceSetting.allCases.map { ($0.label, $0) }, current: AppearanceSetting.saved) { $0.apply() },
            .separator,
            .action(pinned ? ViewNames.unpinTitle : ViewNames.pinTitle) { [weak self] in
                guard let panel = self?.panel else { return }
                if pinned { panel.unpin() } else { panel.pin() }
            },
            .action(PanelStaysOpen.menuTitle, checked: PanelStaysOpen.isOn) { PanelStaysOpen.isOn.toggle() },
        ]
        let tasks: [MenuEntry] = [
            .choice("Looks Done", LooksDoneMode.allCases.map { ($0.label, $0) }, current: capture.looksDoneMode) { [weak self] in
                self?.capture.looksDoneMode = $0
            },
            .choice("Older Messages", [("Capture Tasks From Them", false), ("Ignore Them (New Messages Only)", true)],
                    current: capture.onlyNewMessages) { [weak self] in self?.capture.onlyNewMessages = $0 },
            .action("Remind Me About Unfinished Checklists", checked: Nudger.isEnabled) { Nudger.isEnabled.toggle() },
        ]
        var privacy: [MenuEntry] = [
            .action("Privacy…", close { [weak self] in self?.showPrivacy() }),
            .action("Exclude List…", close { [weak self] in self?.showExcludeList() }),
            .choice("Keep Captured Text For", Retention.allCases.map { ($0.label, $0) }, current: capture.retention) { [weak self] in
                self?.capture.retention = $0
            },
            .action("Forget Captured Text Now…", close { [weak self] in self?.confirmForget() }),
        ]
        if !OCRCapture.isPermitted {
            privacy += [.separator, .action("Enable OCR Fallback (Screen Recording)…") { OCRCapture.requestPermission() }]
        }
        let help: [MenuEntry] = [
            .action("How Didja Works…", close { [weak self] in self?.showWelcome() }),
            .action("How It Decides…", close { [weak self] in self?.showBrain() }),
            .separator,
            .action("Troubleshooting Report…", close { [weak self] in self?.showTroubleshooting() }),
            .action("Report a Bug…", close { [weak self] in self?.showBugReport() }),
            .action("Suggest a Feature…", close { [weak self] in self?.showBugReport(.feature) }),
            .action("Check for Updates…", enabled: Updates.shared.canCheck) { Updates.shared.checkNow() },
        ]
        return top + [
            .separator,
            .submenu("View", view), .submenu("Tasks", tasks), .submenu("Privacy", privacy), .submenu("Help", help),
            .separator,
            .action("Settings…", key: ",", close { [weak self] in self?.showTasksWindow(page: .general) }),
            .separator,
            .action("Quit Didja", key: "q") { NSApplication.shared.terminate(nil) },
            .separator,
            MenuEntry(title: AppVersion.current, kind: .label),
        ]
    }

    /// ⌘ shortcuts in the Quick View and the Full View, and M or . for the menu. True when used.
    func handleCommandKey(keyCode: UInt16, held: NSEvent.ModifierFlags, inPanel: Bool) -> Bool {
        let digits: [UInt16: Int] = [18: 1, 19: 2, 20: 3, 21: 4, 23: 5, 22: 6, 26: 7, 28: 8, 25: 9]
        if held == .command {
            if let n = digits[keyCode] { return openCanvas(number: n) }
            switch keyCode {
            case 45: openCanvas(nil); return true                                            // ⌘N
            case 43: panel?.close(); showTasksWindow(page: .general); return true              // ⌘,
            default: return false
            }
        }
        if held == [.command, .shift] {
            switch keyCode {
            case 51: panel?.close(); confirmFreshStart(); return true                          // ⌘⇧⌫
            case 15: panel?.close(); showDiagnostics(); return true                             // ⌘⇧R
            default: return false
            }
        }
        if held.isEmpty, inPanel, keyCode == 46 || keyCode == 47 { showMoreMenu(); return true } // M or .
        return false
    }

    /// Keys pressed in the popover or the task window. True when the key was used.
    private func handleKey(_ event: NSEvent) -> Bool {
        // While a task is being added or a row renamed, every key belongs to its text field. If the
        // field does not have the keyboard (it lost it to a menu), Esc still cancels, and a key you
        // type is put in the field, so the keyboard is never stuck.
        for navigator in [popoverNavigator, windowNavigator] where navigator.adding || navigator.editing != nil {
            if event.window?.firstResponder is NSText { return false }
            if event.keyCode == 53 {
                if navigator.adding { navigator.cancelAdd() } else { navigator.cancelRename() }
                return true
            }
            if navigator.adding, let window = event.window,
               event.modifierFlags.intersection([.command, .control, .option]).isEmpty {
                return AddTaskField.takeKey(event, in: window)
            }
            return false
        }
        // Settings open in the task window: keys belong to its fields and buttons, never the hidden list.
        if let window = event.window, window === tasksWindow, settings.page != nil { return false }
        let held = event.modifierFlags.intersection([.command, .control, .option, .shift])
        // While a search field has the keyboard, keys are typing. Only ↓, ↑ and Return leave it for the list.
        let searchingIn: TaskNavigator? = {
            if let window = event.window, window === tasksWindow { return windowNavigator }
            if let window = event.window, window === panel?.window { return popoverNavigator }
            return nil
        }()
        if let navigator = searchingIn, navigator.searching {
            if held.isEmpty && navigator.handleWhileSearching(keyCode: event.keyCode, board: capture.tasks, actions: actions) {
                return true
            }
            // A key meant for the search that would miss the field: it goes to the field (SCR-22 review).
            if held.intersection([.command, .control, .option]).isEmpty, let window = event.window {
                return SearchTextField.takeKey(event, in: window)
            }
            return false
        }
        guard !popoverNavigator.searching, !windowNavigator.searching else { return false }
        // Esc while the panel is open but the keyboard is not in it yet still closes it (SCR-30).
        if event.keyCode == 53, held.isEmpty, let panel, event.window !== panel.window,
           MenuBarPanel.escCloses(panelShown: panel.isShown, inPanel: false,
                                  inOtherOwnWindow: event.window.map { $0.isVisible && $0 !== panel.window } ?? false) {
            panel.close()
            return true
        }
        if let window = event.window, window === panel?.window || window === tasksWindow,
           handleCommandKey(keyCode: event.keyCode, held: held, inPanel: window === panel?.window) {
            return true
        }
        let commandModifiers = !held.intersection([.command, .control, .option]).isEmpty
        guard let window = event.window,
              let key = NavKey(keyCode: event.keyCode, hasCommandModifiers: commandModifiers,
                               isCommandOnly: held == .command, isShiftOnly: held == .shift,
                               isOptionOnly: held == .option) else { return false }
        // ⌘C belongs first to anything in focus that can copy for itself, such as selected "why" text.
        if key == .copy, let responder = window.firstResponder, responder !== window,
           responder.responds(to: #selector(NSText.copy(_:))) {
            return false
        }
        // Esc first lets go of rows chosen together, and only then closes.
        if key == .close {
            if window === tasksWindow, windowNavigator.clearMarks() { return true }
            if window === panel?.window, popoverNavigator.clearMarks() { return true }
        }
        if window === tasksWindow {
            if key == .close {
                window.performClose(nil)
                return true
            }
            if key == .openWindow { // O: in the panel it opens this window; here it goes back (SCR-36)
                backToPanel()
                return true
            }
            return windowNavigator.handle(key, board: capture.tasks, actions: actions)
        }
        guard let panel, window === panel.window else { return false }
        switch key {
        case .close:
            panel.close()
        case .openWindow:
            panel.close()
            showTasksWindow()
        case .pause:
            capture.isPaused.toggle()
        default:
            return popoverNavigator.handle(key, board: capture.tasks, actions: actions)
        }
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        engine.stop()
    }

    private static let engineChanges = DispatchQueue(label: "Didja.engine-changes", qos: .userInitiated)

    /// Changes go through the engine, which owns the rules (a parent ticking
    /// its steps, and so on). The list is re-read straight afterwards.
    var actions: TaskActions {
        let change: ([String]) -> Void = { [capture] arguments in
            // One after another, in the order asked: several rows changed at once
            // must not race each other into the database.
            Self.engineChanges.async {
                EngineRunner.run(arguments)
                capture.refreshSummary()
            }
        }
        return TaskActions(
            setDone: { item, done in change([done ? "done" : "reopen", String(item.id)]) },
            snooze: { item, duration in change(["snooze", String(item.id), duration]) },
            dismiss: { item in change(["dismiss", String(item.id)]) },
            reopen: { item in change(["reopen", String(item.id)]) },
            completeConversation: { item in change(["done-all", String(item.id)]) },
            why: { item in EngineRunner.output(["why", String(item.id)]) ?? "The engine did not answer." },
            rename: { item, name in change(["rename", String(item.id), name]) },
            notYet: { item in change(["notyet", String(item.id)]) },
            merge: { item in if let other = item.mergeWith { change(["merge", String(item.id), String(other)]) } },
            notSame: { item in if let other = item.mergeWith { change(["notsame", String(item.id), String(other)]) } },
            notAnAction: { item in change(["notanaction", String(item.id)]) },
            notDone: { item in change(["notdone", String(item.id)]) },
            setCollapsed: { item, collapsed in change([collapsed ? "collapse" : "expand", String(item.id)]) },
            setAllCollapsed: { collapsed in change([collapsed ? "collapse" : "expand", "all"]) },
            copy: { text in
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(text, forType: .string)
            },
            goToSource: { [capture] item in
                DispatchQueue.global(qos: .userInitiated).async {
                    guard let json = EngineRunner.output(["place", String(item.id)]),
                          let place = try? JSONDecoder().decode(TaskPlace.self, from: Data(json.utf8))
                    else { NSSound.beep(); return }
                    capture.goToSource(place) { outcome in if outcome == .notFound { NSSound.beep() } }
                }
            },
            add: { title in change(["add", title]) },
            context: { item in
                EngineRunner.output(["context", String(item.id)])
                    .flatMap { try? JSONDecoder().decode(TaskContext.self, from: Data($0.utf8)) }
            },
            canvases: { CanvasDirectory.shared.list },
            sendToCanvas: { [weak self] items, canvas in
                // A new canvas is named after what is sent: the checklist, or the one task.
                guard let id = canvas ?? CanvasModel.create(items.count == 1 ? items[0].title : "Canvas") else { return }
                _ = EngineRunner.output(["canvas", "send", String(id)] + items.map { String($0.id) })
                CanvasDirectory.refresh()
                self?.canvasWindows.show(id)
            },
            missed: { [weak self] item in self?.showMissed(item) },
            toggleRecentlyDone: { [capture] in capture.showsRecentlyDone.toggle() })
    }

    /// What Didja reads and needs. Shown by itself the first time, or
    /// whenever Accessibility access is missing at launch; always in the panel's menu.
    func showWelcome() {
        if welcomeWindow == nil {
            let window = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: WelcomeView.width, height: 640),
                styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            window.title = "Welcome to Didja"
            window.isReleasedWhenClosed = false
            // Fixed width, scrolling content: a window that sizes itself to SwiftUI content can
            // loop with AppKit and crash, as the Exclude List window did.
            let controller = NSHostingController(rootView: WelcomeWindowContent(content: WelcomeView(
                openAccessibilitySettings: { [capture] in capture.openAccessibilitySettings() },
                editExcludeList: { [weak self] in self?.showExcludeList() },
                openPrivacy: { [weak self] in self?.showPrivacy() },
                troubleshoot: { [weak self] in self?.showTroubleshooting() },
                firstRun: { [capture] in capture.firstRun },
                done: { [weak self] in self?.welcomeWindow?.close() })))
            window.contentViewController = controller
            window.setContentSize(NSSize(width: WelcomeView.width, height: 640))
            window.contentMinSize = NSSize(width: WelcomeView.width, height: 320)
            window.contentMaxSize = NSSize(width: WelcomeView.width, height: 2000)
            window.center()
            welcomeWindow = window
        }
        UserDefaults.standard.set(true, forKey: Self.welcomedKey)
        NSApplication.shared.activate(ignoringOtherApps: true)
        welcomeWindow?.makeKeyAndOrderFront(nil)
    }

    private static let welcomedKey = "welcomed"

    /// The model's instructions and what you have taught it. Read afresh each time it opens.
    func showBrain() {
        if let model = brainModel {
            model.reload()
        } else {
            let model = BrainModel()
            brainModel = model
            // Fixed width, scrolling content: a window that sizes itself to SwiftUI content can loop and crash.
            let window = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: BrainView.width, height: 680),
                styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            window.title = "How Didja Decides"
            window.isReleasedWhenClosed = false
            window.contentViewController = NSHostingController(rootView: BrainView(model: model))
            window.setContentSize(NSSize(width: BrainView.width, height: 680))
            window.contentMinSize = NSSize(width: BrainView.width, height: 360)
            window.contentMaxSize = NSSize(width: BrainView.width, height: 2400)
            window.center()
            brainWindow = window
        }
        NSApplication.shared.activate(ignoringOtherApps: true)
        brainWindow?.makeKeyAndOrderFront(nil)
    }

    /// Task tools connected over MCP (Linear): the only network use, and only to them.
    func showConnections() {
        if let model = connectionsModel {
            model.reload()
        } else {
            let model = ConnectionsModel()
            connectionsModel = model
            // Fixed width, scrolling content: a window that sizes itself to SwiftUI content can loop and crash.
            let window = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: ConnectionsView.width, height: 560),
                styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            window.title = "Connections"
            window.isReleasedWhenClosed = false
            window.contentViewController = NSHostingController(rootView: ConnectionsView(model: model))
            window.setContentSize(NSSize(width: ConnectionsView.width, height: 560))
            window.contentMinSize = NSSize(width: ConnectionsView.width, height: 300)
            window.contentMaxSize = NSSize(width: ConnectionsView.width, height: 2000)
            window.center()
            connectionsWindow = window
        }
        NSApplication.shared.activate(ignoringOtherApps: true)
        connectionsWindow?.makeKeyAndOrderFront(nil)
    }

    /// Your name and the names people call or tag you by, for chats.
    func showNames() {
        if let model = namesModel {
            model.reload()
        } else {
            let model = NamesModel()
            namesModel = model
            // Fixed width, scrolling content: a window that sizes itself to SwiftUI content can loop and crash.
            let window = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: NamesView.width, height: 560),
                styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            window.title = "Your Names"
            window.isReleasedWhenClosed = false
            window.contentViewController = NSHostingController(rootView: NamesView(model: model))
            window.setContentSize(NSSize(width: NamesView.width, height: 560))
            window.contentMinSize = NSSize(width: NamesView.width, height: 300)
            window.contentMaxSize = NSSize(width: NamesView.width, height: 2000)
            window.center()
            namesWindow = window
        }
        NSApplication.shared.activate(ignoringOtherApps: true)
        namesWindow?.makeKeyAndOrderFront(nil)
    }

    /// Ask before deleting all captured text; delete only on an explicit Delete.
    func confirmForget() {
        let alert = AppIcon.alert()
        alert.alertStyle = .warning
        alert.messageText = ForgetPrompt.title
        alert.informativeText = ForgetPrompt.message(observations: capture.observationCount)
        for title in ForgetPrompt.buttons { alert.addButton(withTitle: title) }
        // Return and Escape both cancel: the destructive button is never the default.
        alert.buttons[0].keyEquivalent = ""
        alert.buttons[1].keyEquivalent = "\r"
        alert.buttons[0].hasDestructiveAction = true
        NSApplication.shared.activate(ignoringOtherApps: true)
        if ForgetPrompt.deletes(alert.runModal()) { capture.forgetCapturedText() }
    }

    /// The facts the Privacy window states, read now.
    private func privacyFacts() -> PrivacyFacts {
        let folder = ObservationStore.defaultDirectory
        let list = (try? ExcludeList.load(from: folder.appendingPathComponent(ExcludeList.fileName))) ?? ExcludeList()
        return PrivacyFacts(
            retention: capture.retention, observationCount: capture.observationCount,
            taskCount: capture.tasks.tasks.count, excludedApps: list.bundleIds.count,
            excludedTitles: list.windowPatterns.count, excludedSites: list.urlPatterns.count,
            screenRecordingGranted: OCRCapture.isPermitted && OCRCapture.isEnabled, modelStatus: Judge.modelStatus,
            dataFolder: folder.appendingPathComponent("didja.db").path, isPaused: capture.isPaused,
            connections: Self.connectedTools(), profiles: AppProfiles.builtIn.map(\.summary), ownClaude: OwnClaude.status(),
            localModel: LocalModel.status().model, shellHook: ShellHook.status(), agentHooks: AgentHooks.status())
    }

    /// The names of the connected task tools, from the engine.
    private static func connectedTools() -> [String] {
        let output = EngineRunner.output(["connections", "--json"]) ?? "[]"
        let list = (try? JSONDecoder().decode([ConnectionsModel.Item].self, from: Data(output.utf8))) ?? []
        return list.map(\.name)
    }

    /// What is read, what is kept and where, and what the on-device model is shown.
    /// Its facts are read each time it is opened.
    func showPrivacy() {
        let view = PrivacyView(
            facts: privacyFacts(),
            openExcludeList: { [weak self] in self?.showExcludeList() },
            revealDataFolder: {
                let folder = ObservationStore.defaultDirectory
                try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                NSWorkspace.shared.activateFileViewerSelecting([folder.appendingPathComponent("didja.db")])
            })
        if let window = privacyWindow {
            (window.contentViewController as? NSHostingController<PrivacyView>)?.rootView = view
        } else {
            // Fixed width, scrolling content: a window that sizes itself to SwiftUI content can loop and crash.
            let window = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: PrivacyView.width, height: 640),
                styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            window.title = "Privacy"
            window.isReleasedWhenClosed = false
            window.contentViewController = NSHostingController(rootView: view)
            window.setContentSize(NSSize(width: PrivacyView.width, height: 640))
            window.contentMinSize = NSSize(width: PrivacyView.width, height: 320)
            window.contentMaxSize = NSSize(width: PrivacyView.width, height: 2000)
            window.center()
            privacyWindow = window
        }
        NSApplication.shared.activate(ignoringOtherApps: true)
        privacyWindow?.makeKeyAndOrderFront(nil)
    }

    /// Fresh Start (SCR-48): every open task marked done at once, after asking. Undone from the menu.
    func confirmFreshStart() {
        let alert = AppIcon.alert()
        alert.messageText = FreshStart.title
        alert.informativeText = FreshStart.message
        alert.addButton(withTitle: "Start Fresh")
        alert.addButton(withTitle: "Cancel")
        NSApplication.shared.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        if EngineRunner.run(["fresh-start"]) {
            FreshStart.didStart()
            capture.refreshSummary()
        }
    }

    func undoFreshStart() {
        if EngineRunner.run(["fresh-start", "--undo"]) {
            FreshStart.didUndo()
            capture.refreshSummary()
        }
    }

    /// Report a Problem with This Window… (SCR-42): how Didja sees the window you were last in,
    /// masked, in a preview of the exact file. Nothing is sent.
    func showDiagnostics() {
        capture.readForDiagnostics { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure(let refusal):
                let alert = AppIcon.alert()
                alert.messageText = "Nothing to report"
                alert.informativeText = refusal.message
                NSApplication.shared.activate(ignoringOtherApps: true)
                alert.runModal()
            case .success(let reading):
                self.presentDiagnostics(Self.report(from: reading, tasks: self.capture.tasks.tasks))
            }
        }
    }

    /// The report: the reading, and the tasks from that app with what the engine says about each.
    static func report(from r: CaptureCoordinator.WindowReading, tasks: [TaskItem]) -> DiagnosticsReport {
        let profile = r.profile.map { "\($0.id) (\(($0.status ?? .builtIn).rawValue))" } ?? "none: read as plain text"
        let os = ProcessInfo.processInfo.operatingSystemVersion
        let about: [(String, String)] = [
            (r.app, r.app),
            ("\(AppVersion.current) on macOS \(os.majorVersion).\(os.minorVersion)", "\(AppVersion.current) on macOS \(os.majorVersion).\(os.minorVersion)"),
            ("App: \(r.bundleID) \(r.appVersion ?? "")", "App: \(r.bundleID) \(r.appVersion ?? "")"),
            ("Profile: \(profile)", "Profile: \(profile)"),
            ("Window: \(r.windowTitle)", "Window: \(Redactor.text(r.windowTitle))"),
            ("Address: \(r.url ?? "none")", "Address: \(r.url.map(Redactor.url) ?? "none")"),
        ]
        let mine = tasks.filter { $0.source == r.app || $0.source.hasPrefix(r.app + " — ") }.prefix(20)
        let explained = mine.map { DiagnosticsReport.Task(title: "[\($0.status.rawValue)] \($0.title)", why: EngineRunner.output(["why", String($0.id)]) ?? "") }
        return DiagnosticsReport.build(about: about, outline: r.outline, captured: r.lines, kept: r.kept, tasks: Array(explained))
    }

    /// Help › Troubleshooting Report… (SCR-79): why Didja reads nothing or makes no tasks, from
    /// `didja doctor`, after the app has written what it knows. Didja sends nothing; you choose.
    func showTroubleshooting() {
        capture.writeAppFacts { [weak self] in
            DispatchQueue.global(qos: .userInitiated).async {
                let report = TroubleshootingReport.fromEngine()
                DispatchQueue.main.async { self?.presentTroubleshooting(report) }
            }
        }
    }

    private func presentTroubleshooting(_ report: TroubleshootingReport?) {
        guard let report else {
            let alert = AppIcon.alert()
            alert.messageText = "The report could not be made"
            alert.informativeText = "Didja's engine did not answer. Quit and reopen Didja, then try again."
            NSApplication.shared.activate(ignoringOtherApps: true)
            alert.runModal()
            return
        }
        let copy: (String) -> Void = { text in
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
        }
        let view = TroubleshootingView(
            report: report,
            copy: copy,
            save: { text in
                let panel = NSSavePanel()
                panel.nameFieldStringValue = report.fileName()
                panel.allowedContentTypes = [.plainText]
                if panel.runModal() == .OK, let url = panel.url { try? text.write(to: url, atomically: true, encoding: .utf8) }
            },
            email: {
                if let url = report.mailLink { NSWorkspace.shared.open(url) } else { NSSound.beep() }
            },
            openIssue: {
                guard let link = report.issueLink else { NSSound.beep(); return }
                if link.mustPaste { copy("```\n\(report.text)```\n") }
                NSWorkspace.shared.open(link.url)
            })
        troubleshootingWindow?.close()
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: TroubleshootingView.width, height: 620),
                              styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = "Troubleshooting Report"
        window.isReleasedWhenClosed = false
        window.contentViewController = NSHostingController(rootView: view)
        window.setContentSize(NSSize(width: TroubleshootingView.width, height: 620))
        window.contentMinSize = NSSize(width: TroubleshootingView.width, height: 420)
        window.contentMaxSize = NSSize(width: TroubleshootingView.width, height: 2000)
        window.center()
        troubleshootingWindow = window
        NSApplication.shared.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    /// Report a Bug… (SCR-51) and Suggest a Feature… (SCR-52): a form that opens a new GitHub
    /// issue in your browser, filled in. You submit it there; nothing is sent from here.
    func showBugReport(_ kind: BugReport.Kind = .bug) {
        let copy: (String) -> Void = { text in
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
        }
        let view = BugReportView(
            report: BugReport(kind),
            open: { [weak self] report in
                guard let link = report.issueLink() else { NSSound.beep(); return }
                if link.mustPaste { copy(report.body()) }
                NSWorkspace.shared.open(link.url)
                self?.bugReportWindow?.close()
            },
            copy: copy,
            reportWindow: { [weak self] in
                self?.bugReportWindow?.close()
                self?.showDiagnostics()
            })
        bugReportWindow?.close()
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: BugReportView.width, height: 560),
                              styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = kind.name
        window.isReleasedWhenClosed = false
        window.contentViewController = NSHostingController(rootView: view)
        window.center()
        bugReportWindow = window
        NSApplication.shared.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    /// Didja Missed This… on a task: pick where you did it and the screen that shows it done.
    func showMissed(_ item: TaskItem) {
        panel?.close()
        guard let json = EngineRunner.output(["missed", String(item.id)]),
              let missed = try? JSONDecoder().decode(DiagnosticsReport.Missed.self, from: Data(json.utf8)) else { NSSound.beep(); return }
        let model = MissedModel(missed)
        let copy: (String) -> Void = { text in
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
        }
        let view = MissedView(
            model: model,
            save: { text in
                let panel = NSSavePanel()
                panel.nameFieldStringValue = model.report.report.fileName()
                panel.allowedContentTypes = [.plainText]
                if panel.runModal() == .OK, let url = panel.url { try? text.write(to: url, atomically: true, encoding: .utf8) }
            },
            copy: copy,
            openIssue: { if let url = DiagnosticsReport.issueURL(title: model.report.report.issueTitle) { NSWorkspace.shared.open(url) } },
            giveToClaude: { text in
                _ = try? OwnClaude.share(text, name: model.report.report.fileName())
                copy(model.prompt)
                let alert = AppIcon.alert()
                alert.messageText = "Your Claude can read it now"
                alert.informativeText = "A prompt is on the clipboard: paste it into Claude Code or Claude Desktop."
                alert.runModal()
            },
            setUpClaude: { [weak self] in self?.setUpClaude(then: model) },
            addToDesktop: { [weak self] in self?.addDidjaToClaudeDesktop(then: model) },
            askClaude: { prompt in OwnClaude.ask(prompt) })
        missedWindow?.close()
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: MissedView.width, height: 720),
                              styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = "Didja Missed This"
        window.isReleasedWhenClosed = false
        window.contentViewController = NSHostingController(rootView: view)
        window.setContentSize(NSSize(width: MissedView.width, height: 720))
        window.contentMinSize = NSSize(width: MissedView.width, height: 420)
        window.contentMaxSize = NSSize(width: MissedView.width, height: 2000)
        window.center()
        missedWindow = window
        NSApplication.shared.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    /// Let My Own Claude Read Didja, from where you need it: says what it means, turns it on, and
    /// adds Didja to Claude Desktop or copies the Claude Code command.
    func setUpClaude(then model: MissedModel? = nil) {
        let alert = AppIcon.alert()
        alert.messageText = "Let your own Claude read Didja?"
        alert.informativeText = """
            Claude Desktop or Claude Code can then read, through didja mcp, the reports you give it and the text Didja kept, with every letter and digit masked. What it reads goes to your AI provider. You can turn it off in Settings › General.
            """
        alert.addButton(withTitle: "Add to Claude Desktop")
        alert.addButton(withTitle: "Copy for Claude Code")
        alert.addButton(withTitle: "Cancel")
        NSApplication.shared.activate(ignoringOtherApps: true)
        switch alert.runModal() {
        case .alertFirstButtonReturn:
            OwnClaude.set(true)
            addDidjaToClaudeDesktop(then: model, asked: true)
        case .alertSecondButtonReturn:
            OwnClaude.set(true)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(OwnClaude.command, forType: .string)
            model?.refreshClaude()
        default:
            break
        }
    }

    /// Adds Didja to Claude Desktop's settings. Claude Desktop rewrites that file while it runs (it
    /// dropped Didja's entry once, seen live), so while it is open Didja offers to add itself the moment
    /// you quit it; when it is closed, the entry is added now.
    func addDidjaToClaudeDesktop(then model: MissedModel? = nil, asked: Bool = false) {
        if OwnClaude.isDesktopRunning {
            let wait = AppIcon.alert()
            wait.messageText = "Add Didja when you quit Claude Desktop?"
            wait.informativeText = "Claude Desktop is open, and it rewrites its settings while it runs, so an entry added now would be lost. Didja can add one entry, \u{201C}didja\u{201D}, the moment you quit Claude (keeping a copy of the file as it was), and Claude reads it when you open it again. No need to quit it now."
            wait.addButton(withTitle: "Add When Claude Quits")
            wait.addButton(withTitle: "Cancel")
            NSApplication.shared.activate(ignoringOtherApps: true)
            guard wait.runModal() == .alertFirstButtonReturn else { return }
            OwnClaude.addWhenDesktopQuits { model?.refreshClaude() }
            model?.refreshClaude()
            return
        }
        if !asked {
            let confirm = AppIcon.alert()
            confirm.messageText = "Add Didja to Claude Desktop?"
            confirm.informativeText = "Didja adds one entry, \u{201C}didja\u{201D}, to Claude Desktop's settings (claude_desktop_config.json) and keeps a copy of the file as it was beside it. Nothing else in it changes."
            confirm.addButton(withTitle: "Add")
            confirm.addButton(withTitle: "Cancel")
            guard confirm.runModal() == .alertFirstButtonReturn else { return }
        }
        let done = AppIcon.alert()
        do {
            try OwnClaude.addToDesktop()
            done.messageText = "Didja is added to Claude Desktop"
            done.informativeText = "Open Claude Desktop: it reads the change when it starts. Then Ask Claude About This opens it with the question ready."
        } catch {
            done.messageText = "Didja could not be added"
            done.informativeText = error.localizedDescription
        }
        done.runModal()
        model?.refreshClaude()
    }

    private func presentDiagnostics(_ report: DiagnosticsReport) {
        let model = DiagnosticsModel(report)
        let view = DiagnosticsView(
            model: model,
            save: { text in
                let panel = NSSavePanel()
                panel.nameFieldStringValue = report.fileName()
                panel.allowedContentTypes = [.plainText]
                if panel.runModal() == .OK, let url = panel.url { try? text.write(to: url, atomically: true, encoding: .utf8) }
            },
            copy: { text in
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(text, forType: .string)
            },
            openIssue: {
                if let url = DiagnosticsReport.issueURL(title: report.issueTitle) { NSWorkspace.shared.open(url) }
            },
            shareWithClaude: OwnClaude.status().on ? { text in
                guard let url = try? OwnClaude.share(text, name: report.fileName()) else { return }
                let alert = AppIcon.alert()
                alert.messageText = "Your Claude can read it now"
                alert.informativeText = "Saved as \(url.lastPathComponent) where `didja mcp` reads reports. Ask your Claude to read it; it sees the file exactly as you left it."
                alert.runModal()
            } : nil)
        diagnosticsWindow?.close()
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: DiagnosticsView.width, height: 640),
            styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = "Report a Problem"
        window.isReleasedWhenClosed = false
        window.contentViewController = NSHostingController(rootView: view)
        window.setContentSize(NSSize(width: DiagnosticsView.width, height: 640))
        window.contentMinSize = NSSize(width: DiagnosticsView.width, height: 420)
        window.contentMaxSize = NSSize(width: DiagnosticsView.width, height: 2000)
        window.center()
        diagnosticsWindow = window
        NSApplication.shared.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    /// The apps, window titles and sites you have told Didja never to read.
    func showExcludeList() {
        if excludeWindow == nil {
            let window = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 480, height: 560),
                styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            window.title = "Exclude List"
            window.isReleasedWhenClosed = false
            let model = ExcludeListModel(
                file: ObservationStore.defaultDirectory.appendingPathComponent(ExcludeList.fileName),
                changed: { [capture] in capture.reloadPolicy() })
            // A window of fixed width whose content scrolls. It must not size itself to
            // its content: with text fields and a menu inside, the window and the view
            // kept resizing each other and AppKit ended the app ("more Update Constraints
            // in Window passes than there are views").
            window.contentViewController = NSHostingController(rootView: ExcludeListWindowContent(model: model))
            window.setContentSize(NSSize(width: ExcludeListWindowContent.width, height: 560))
            window.contentMinSize = NSSize(width: ExcludeListWindowContent.width, height: 320)
            window.contentMaxSize = NSSize(width: ExcludeListWindowContent.width, height: 2000)
            window.center()
            excludeWindow = window
        }
        NSApplication.shared.activate(ignoringOtherApps: true)
        excludeWindow?.makeKeyAndOrderFront(nil)
    }

    /// Settings, shown in the task window's main area.
    lazy var settings = SettingsHub(
        exclude: ExcludeListModel(
            file: ObservationStore.defaultDirectory.appendingPathComponent(ExcludeList.fileName),
            changed: { [capture] in capture.reloadPolicy() }),
        privacyFacts: { [unowned self] in self.privacyFacts() },
        forgetCapturedText: { [unowned self] in self.confirmForget() },
        openWelcome: { [unowned self] in self.showWelcome() },
        revealDataFolder: {
            let folder = ObservationStore.defaultDirectory
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            NSWorkspace.shared.activateFileViewerSelecting([folder.appendingPathComponent("didja.db")])
        })

    /// The full window: tasks, and Settings. While it is open Didja is a regular app, in the
    /// Dock and the app switcher; closed, it is the menu bar icon again.
    /// From the task window back to the panel under the icon (SCR-36).
    func backToPanel() {
        WindowExit.backToPanel(
            closeWindow: { tasksWindow?.performClose(nil) },
            showPanel: { panel?.show() ?? false },
            reopenWindow: { NSSound.beep(); showTasksWindow() })
    }

    func showTasksWindow(page: SettingsPage? = nil) {
        if tasksWindow == nil {
            let window = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 1100, height: 700),
                styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            window.title = "Didja — \(ViewNames.full)"
            window.isReleasedWhenClosed = false
            window.contentViewController = NSHostingController(
                rootView: TasksWindowView(capture: capture, actions: actions, navigator: windowNavigator, settings: settings,
                                          showPanel: { [weak self] in self?.backToPanel() },
                                          close: { [weak self] in self?.tasksWindow?.performClose(nil) }))
            window.setContentSize(NSSize(width: 1100, height: 700))
            window.center()
            tasksWindow = window
        }
        if let page { settings.open(page) } else { settings.page = nil }
        NSApplication.shared.activate(ignoringOtherApps: true)
        tasksWindow?.makeKeyAndOrderFront(nil)
        DockPresence.update()
    }
}
