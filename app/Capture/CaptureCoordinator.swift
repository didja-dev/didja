import AppKit
import ApplicationServices
import Combine

/// How long captured text is kept. 24 hours is the most; you can choose less.
enum Retention: Int, CaseIterable, Identifiable {
    case hour = 1, sixHours = 6, day = 24

    var id: Int { rawValue }
    var seconds: TimeInterval { TimeInterval(rawValue) * 3600 }
    var label: String {
        switch self {
        case .hour: return "1 Hour"
        case .sixHours: return "6 Hours"
        case .day: return "24 Hours"
        }
    }
    /// As in "212 observations in 6h".
    var short: String { "\(rawValue)h" }

    /// The engine reads this from the database's meta table and expires by it too.
    static let metaKey = "retention_hours"
    static let defaultsKey = "retentionHours"
    /// What was chosen; 24 hours if nothing, or nothing valid, was.
    static func saved(in defaults: UserDefaults = .standard) -> Retention {
        Retention(rawValue: defaults.integer(forKey: defaultsKey)) ?? .day
    }
}

/// The question asked before all captured text is deleted, and how its answer is read.
enum ForgetPrompt {
    static let title = "Delete all captured text?"
    static func message(observations: Int) -> String {
        let what = observations == 1 ? "1 piece of text" : "\(observations) pieces of text"
        return "\(what) captured in the last day will be deleted. Tasks already found stay. Ticking that depends on recent text, such as \u{201C}looks done\u{201D}, starts again from what you see next."
    }
    /// The first button deletes; it is not the default, so Return cancels.
    static let buttons = ["Delete", "Cancel"]

    /// True only for the Delete button. Anything else, closing the alert included, keeps the text.
    static func deletes(_ response: NSApplication.ModalResponse) -> Bool {
        response == .alertFirstButtonReturn
    }
}

/// Decides when to capture, runs the capture, and writes observations.
///
/// Triggers: the frontmost app changing, accessibility notifications from the
/// focused app (focus, title, value changed), and a 5s poll. Triggers are
/// coalesced so capture runs at most once a second. Only the focused window of
/// the frontmost app is ever read.
/// What Didja does when a task looks done (SCR-74).
enum LooksDoneMode: String, CaseIterable, Identifiable {
    case ask, sure, accept

    var id: String { rawValue }
    static let key = "looksDoneMode"

    var label: String {
        switch self {
        case .ask: return "Ask Me"
        case .sure: return "Tick When Didja Is Sure"
        case .accept: return "Accept Automatically"
        }
    }

    /// The saved choice. Before SCR-74 there were two, as a switch: an install on Accept
    /// Automatically keeps it, every other moves to Tick When Didja Is Sure, once.
    static func saved(_ defaults: UserDefaults = .standard) -> LooksDoneMode {
        if let raw = defaults.string(forKey: key), let mode = LooksDoneMode(rawValue: raw) { return mode }
        let mode: LooksDoneMode = defaults.bool(forKey: "acceptsLooksDone") ? .accept : .sure
        defaults.set(mode.rawValue, forKey: key)
        return mode
    }
}

final class CaptureCoordinator: ObservableObject {
    enum Status: Equatable {
        case starting
        case needsAccessibility
        case capturing
        case paused
        case failed(String)

        var label: String {
            switch self {
            case .starting: return "Starting…"
            case .needsAccessibility: return "Needs Accessibility access"
            case .capturing: return "Capturing"
            case .paused: return "Paused"
            case .failed(let why): return why
            }
        }
    }

    /// Called after each observation is written (on the capture queue): the app wakes the engine (SCR-76).
    var onObservation: (() -> Void)?
    @Published private(set) var status: Status = .starting
    @Published private(set) var observationCount = 0
    /// What the engine says about the first run (SCR-89): apps being read, the first list, the nudge.
    @Published private(set) var firstRun: FirstRunStatus?
    /// Tasks the engine has found, for the menu. Read-only here.
    @Published private(set) var tasks = TaskBoard(
        showsRecentlyDone: UserDefaults.standard.bool(forKey: "showsRecentlyDone"),
        sort: TaskBoard.Sort(rawValue: UserDefaults.standard.string(forKey: "taskSort") ?? "") ?? .source,
        focus: UserDefaults.standard.string(forKey: "taskFocus"))
    /// Whether the panel's "Recently done" list is unfolded. Folded unless you open it.
    @Published var showsRecentlyDone = UserDefaults.standard.bool(forKey: "showsRecentlyDone") {
        didSet {
            UserDefaults.standard.set(showsRecentlyDone, forKey: "showsRecentlyDone")
            tasks.showsRecentlyDone = showsRecentlyDone
        }
    }
    /// How the list is ordered, and which app's tasks it is narrowed to, if any.
    @Published var sort = TaskBoard.Sort(rawValue: UserDefaults.standard.string(forKey: "taskSort") ?? "") ?? .source {
        didSet {
            UserDefaults.standard.set(sort.rawValue, forKey: "taskSort")
            tasks.sort = sort
        }
    }
    @Published var focus: String? = UserDefaults.standard.string(forKey: "taskFocus") {
        didSet {
            UserDefaults.standard.set(focus, forKey: "taskFocus")
            tasks.focus = focus
        }
    }
    /// When a task looks done (SCR-74): ask you, tick it when Didja is sure (the default), or accept
    /// every "looks done". The engine reads the choice from the database, where the rules about
    /// ticking live.
    @Published var looksDoneMode = LooksDoneMode.saved() {
        didSet {
            UserDefaults.standard.set(looksDoneMode.rawValue, forKey: LooksDoneMode.key)
            applyLooksDoneMode()
        }
    }

    private func applyLooksDoneMode() {
        let mode = looksDoneMode.rawValue
        queue.async { try? self.store?.setMeta("looks_done", mode) }
    }

    /// Make tasks only from messages that arrive after you first looked at a conversation,
    /// not from older ones you scroll back to (SCR-27). Off unless you turn it on. The engine
    /// reads the choice from the database, where the rules about tasks live.
    @Published var onlyNewMessages = UserDefaults.standard.bool(forKey: "onlyNewMessages") {
        didSet {
            UserDefaults.standard.set(onlyNewMessages, forKey: "onlyNewMessages")
            applyOnlyNewMessages()
        }
    }

    private func applyOnlyNewMessages() {
        let value = onlyNewMessages ? "on" : "off"
        queue.async { try? self.store?.setMeta("only_new", value) }
    }

    @Published var isPaused: Bool {
        didSet {
            UserDefaults.standard.set(isPaused, forKey: Self.pausedKey)
            if !isPaused { requestCapture() }
            refreshStatus()
        }
    }

    /// How long captured text is kept. Choosing less deletes what is older at once.
    @Published var retention = Retention.saved() {
        didSet {
            UserDefaults.standard.set(retention.rawValue, forKey: Retention.defaultsKey)
            applyRetention()
        }
    }

    private static let pausedKey = "capturePaused"
    private static let pollInterval: TimeInterval = 5
    private static let debounce: TimeInterval = 1
    /// Below this much accessibility text, try OCR instead.
    private static let minAXChars = 40
    private static let minOCRInterval: TimeInterval = 10
    private static let maxObservationChars = 20_000

    private let queue = DispatchQueue(label: "dev.didja.capture", qos: .utility)
    private let supportDirectory: URL

    // Touched only on the main thread.
    private var pollTimer: Timer?
    private var summaryTimer: Timer?
    private var capturePending = false
    private var observer: AXObserver?
    private var observedPID: pid_t = 0
    private var failure: String?

    // Touched only on `queue`.
    private var store: ObservationStore?
    private var policy: PrivacyPolicy?
    private var differ = Differ()
    private var archives = ArchiveWatcher()
    private var notices = NoticeWatcher()
    /// Notices heard from the app in front and not yet written (SCR-68): in memory, a few seconds at most.
    private var heardNotices: [HeardNotice] = []
    private var preparedPIDs = Set<pid_t>()
    /// Which running apps are built on Electron, looked up once each (SCR-79).
    private var electronApps: [pid_t: Bool] = [:]
    private var lastOCR = Date.distantPast
    /// The last app other than Didja that was in front: what Report a Problem describes.
    private(set) var lastApp: NSRunningApplication?
    private var lastPrune = Date.distantPast
    private var ttl = Retention.saved().seconds

    init(supportDirectory: URL = ObservationStore.defaultDirectory) {
        self.supportDirectory = supportDirectory
        isPaused = UserDefaults.standard.bool(forKey: Self.pausedKey)
    }

    // MARK: Lifecycle (main thread)

    func start() {
        do {
            // Banks, payments and patient portals are on the list from the start (SCR-94), once.
            ExcludeList.addDefaultsOnce(to: supportDirectory.appendingPathComponent(ExcludeList.fileName))
            // No valid privacy policy, no capture.
            let policy = try PrivacyPolicy.load(userFile: supportDirectory.appendingPathComponent(ExcludeList.fileName))
            let store = try ObservationStore(directory: supportDirectory)
            queue.sync {
                self.policy = policy
                self.store = store
                // Your name, so the engine can tell your chat messages, and messages naming you, from others'.
                let name = NSFullUserName().trimmingCharacters(in: .whitespacesAndNewlines)
                if !name.isEmpty { try? store.setMeta("my_name", name) }
            }
        } catch {
            failure = error.localizedDescription
            refreshStatus()
            return
        }

        if !AXIsProcessTrusted() {
            // Shows the system dialog pointing at Privacy & Security → Accessibility.
            AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
        }

        NSWorkspace.shared.notificationCenter.addObserver(
            self, selector: #selector(frontmostAppChanged),
            name: NSWorkspace.didActivateApplicationNotification, object: nil)
        pollTimer = Timer.scheduledTimer(withTimeInterval: Self.pollInterval, repeats: true) { [weak self] _ in
            self?.requestCapture()
        }
        // Every second, so a finished item leaves its place on time.
        summaryTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            self?.refreshSummary()
        }
        applyRetention()
        applyLooksDoneMode()
        applyOnlyNewMessages()
        refreshStatus()
        requestCapture()
    }

    /// The exclude list changed: read it again, and forget what was already kept
    /// from anything it now covers. A list that cannot be read stops capture.
    func reloadPolicy() {
        do {
            let policy = try PrivacyPolicy.load(userFile: supportDirectory.appendingPathComponent(ExcludeList.fileName))
            if pollTimer == nil {
                // Capture never started, because the list was broken. It is readable now.
                failure = nil
                start()
            }
            queue.async {
                self.policy = policy
                _ = try? self.store?.deleteObservations { bundleID, title, url in
                    !(policy.allowsApp(bundleID: bundleID) && policy.allowsWindow(title: title) && policy.allowsURL(url))
                }
            }
        } catch {
            queue.sync { self.policy = nil } // no valid policy, no capture
            failure = error.localizedDescription
        }
        refreshStatus()
        refreshSummary()
    }

    /// Tell the engine how long text is kept, and drop what is already older.
    private func applyRetention() {
        let retention = retention
        queue.async {
            self.ttl = retention.seconds
            try? self.store?.setMeta(Retention.metaKey, String(retention.rawValue))
            _ = try? self.store?.deleteObservations(olderThan: Date().addingTimeInterval(-retention.seconds))
        }
        refreshSummary()
    }

    /// Delete every observation now. Tasks already found stay; what is on screen
    /// at this moment is not kept again unless it changes.
    /// "Go to Source": raise the window a task was captured in and scroll to its line,
    /// under the same exclude list as capture. Runs on the capture queue, so it never
    /// reads a window at the same moment capture does.
    func goToSource(_ place: TaskPlace, done: @escaping (SourceJumper.Outcome) -> Void = { _ in }) {
        queue.async { [weak self] in
            let outcome = SourceJumper.go(to: place, policy: self?.policy)
            DispatchQueue.main.async { done(outcome) }
        }
    }

    /// What Report a Problem needs from the window you were last in (SCR-42): its outline and the
    /// lines capture keeps from it now, read once, in memory, on the capture queue, with the same
    /// checks as capture (the exclude list, its title and address, never a secure field or your
    /// draft). And the lines kept from that app lately. Calls `done` on the main thread.
    struct WindowReading {
        var app: String
        var bundleID: String
        var appVersion: String?
        var windowTitle: String
        var url: String?
        var outline: OutlineElement?
        var lines: [String]
        var kept: [String]
        var profile: AppProfile?
    }

    func readForDiagnostics(done: @escaping (Result<WindowReading, DiagnosticsRefusal>) -> Void) {
        guard !isPaused else { return done(.failure(.paused)) }
        guard let app = lastApp, !app.isTerminated, let bundleID = app.bundleIdentifier else { return done(.failure(.noWindow)) }
        queue.async {
            func finish(_ r: Result<WindowReading, DiagnosticsRefusal>) { DispatchQueue.main.async { done(r) } }
            guard let policy = self.policy, policy.allowsApp(bundleID: bundleID) else { return finish(.failure(.excluded)) }
            AXCapture.prepare(pid: app.processIdentifier, bundleID: bundleID)
            guard let window = AXCapture.focusedWindow(pid: app.processIdentifier) else { return finish(.failure(.noWindow)) }
            guard policy.allowsWindow(title: window.title) else { return finish(.failure(.excluded)) }
            var limits = AXCapture.Limits()
            limits.skipFocusedInput = !PrivacyPolicy.terminalBundleIDs.contains(bundleID)
            limits.app = bundleID
            let text = AXCapture.read(window: window.element, title: window.title, appName: app.localizedName ?? "", limits: limits)
            guard policy.allowsWindow(title: text.windowTitle), policy.allowsURL(text.url) else { return finish(.failure(.excluded)) }
            let outline = AXCapture.withLargeStack { OutlineElement.copy(LiveElement(ref: window.element)) }
            let kept = (try? self.store?.recentLines(bundleID: bundleID, limit: 80)) ?? []
            let profile = AppProfiles.forApp(bundleID) ?? AppProfiles.builtIn.first { $0.match.matches(url: text.url) }
            finish(.success(WindowReading(
                app: app.localizedName ?? bundleID, bundleID: bundleID,
                appVersion: app.bundleURL.flatMap { Bundle(url: $0)?.infoDictionary?["CFBundleShortVersionString"] as? String },
                windowTitle: text.windowTitle, url: text.url, outline: outline, lines: text.lines, kept: kept, profile: profile)))
        }
    }

    /// What the app knows that the engine can't, for `didja doctor` (SCR-79): versions, permissions,
    /// whether Apple's model can run here. Written at launch, when the status changes and before the
    /// troubleshooting report is built. `then` runs on the main thread once it is written.
    func writeAppFacts(then: @escaping () -> Void = {}) {
        let list = (try? ExcludeList.load(from: supportDirectory.appendingPathComponent(ExcludeList.fileName))) ?? ExcludeList()
        let facts = AppFacts.current(
            excluded: .init(apps: list.bundleIds.count, titles: list.windowPatterns.count, sites: list.urlPatterns.count),
            screenRecording: OCRCapture.isPermitted && OCRCapture.isEnabled, modelStatus: Judge.modelStatus)
        queue.async {
            try? self.store?.setMeta("app_facts", facts.json)
            DispatchQueue.main.async(execute: then)
        }
    }

    /// When capture last started capturing, for the Quick View's "isn't reading anything yet" (SCR-79).
    @Published private(set) var capturingSince: Date?

    func forgetCapturedText() {
        queue.async {
            _ = try? self.store?.deleteObservations(olderThan: .distantFuture)
            // And the lines kept around open tasks (SCR-31): they are screen text too.
            try? self.store?.deleteTaskContext()
        }
        refreshSummary()
    }

    func openAccessibilitySettings() {
        let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!
        NSWorkspace.shared.open(url)
    }

    private func refreshStatus() {
        let new: Status
        if let failure { new = .failed(failure) }
        else if !AXIsProcessTrusted() { new = .needsAccessibility }
        else if isPaused { new = .paused }
        else { new = .capturing }
        guard new != status else { return }
        status = new
        if new == .capturing { capturingSince = Date() } else if new != .starting { capturingSince = nil }
        writeAppFacts()
        // Leave a note in the database so `didja status` can say why nothing is arriving.
        let now = ISO8601DateFormatter().string(from: Date())
        let note = "\(new.label) (since \(now), app at \(Bundle.main.bundlePath))"
        queue.async {
            try? self.store?.setMeta("capture_status", note)
            // When capture started (at launch, and again on Resume): with "New Messages Only", mail
            // and chat messages dated before this are left out (the engine reads it).
            if new == .capturing { try? self.store?.setMeta("capturing_since", now) }
        }
    }

    /// Re-read the counts and task list shown in the menu. Runs even while paused.
    func refreshSummary() {
        queue.async {
            guard let store = self.store,
                  let count = try? store.observationCount(),
                  let tasks = try? store.tasks()
            else { return }
            let firstRun = FirstRunStatus.decode((try? store.meta(FirstRunStatus.key)) ?? nil)
            DispatchQueue.main.async {
                self.observationCount = count
                if self.firstRun != firstRun { self.firstRun = firstRun }
                let lingering = TaskBoard.lingering(in: tasks, now: Date())
                if self.tasks.tasks != tasks || self.tasks.lingering != lingering {
                    self.tasks = TaskBoard(tasks: tasks, lingering: lingering, showsRecentlyDone: self.showsRecentlyDone,
                                           sort: self.sort, focus: self.focus)
                }
            }
        }
    }

    /// Closes the Quick View's "no steps yet" note for good (SCR-89): the engine reads this and shows it no more.
    func dismissFirstRunNudge() {
        firstRun?.nudge = nil
        queue.async {
            try? self.store?.setMeta(FirstRunStatus.dismissedKey, ISO8601DateFormatter().string(from: Date()))
        }
    }

    @objc private func frontmostAppChanged() {
        requestCapture()
    }

    /// Ask for a capture soon. Any number of requests within the debounce window become one capture.
    func requestCapture() {
        guard !capturePending else { return }
        capturePending = true
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.debounce) { [weak self] in
            guard let self else { return }
            self.capturePending = false
            self.refreshStatus()
            guard let app = NSWorkspace.shared.frontmostApplication else { return }
            guard self.status == .capturing else {
                // Why nothing is read from the app in front, for the troubleshooting report (SCR-79).
                let outcome: CaptureOutcome? = self.status == .paused ? .paused : self.status == .needsAccessibility ? .notTrusted : nil
                if let outcome, let bundleID = app.bundleIdentifier, bundleID != Bundle.main.bundleIdentifier {
                    let name = app.localizedName ?? bundleID
                    self.queue.async { self.note(outcome, bundleID: bundleID, app: name) }
                }
                return
            }
            if app.processIdentifier != ProcessInfo.processInfo.processIdentifier { self.lastApp = app }
            self.observe(app)
            let target = Target(pid: app.processIdentifier, bundleID: app.bundleIdentifier,
                                name: app.localizedName ?? "")
            self.queue.async { self.capture(target) }
        }
    }

    // MARK: Accessibility notifications (main thread)

    private func observe(_ app: NSRunningApplication) {
        let pid = app.processIdentifier
        guard pid != observedPID else { return }
        if let observer {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .defaultMode)
        }
        observer = nil
        observedPID = pid
        // Don't listen to ourselves, or to apps we would not read anyway.
        guard pid != ProcessInfo.processInfo.processIdentifier else { return }

        var created: AXObserver?
        let callback: AXObserverCallbackWithInfo = { _, element, name, info, refcon in
            guard let refcon else { return }
            let me = Unmanaged<CaptureCoordinator>.fromOpaque(refcon).takeUnretainedValue()
            me.heard(element: element, name: name as String, info: info as NSDictionary)
            me.requestCapture()
        }
        guard AXObserverCreateWithInfoCallback(pid, callback, &created) == .success, let created else { return }
        let element = AXUIElementCreateApplication(pid)
        let refcon = Unmanaged.passUnretained(self).toOpaque()
        for name in ["AXFocusedWindowChanged", "AXFocusedUIElementChanged", "AXTitleChanged", "AXValueChanged"]
            + Self.noticeNotifications {
            AXObserverAddNotification(created, element, name as CFString, refcon)
        }
        CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(created), .defaultMode)
        observer = created
    }

    /// Notices an app announces: "Message sent", "Saved", "Merged" (SCR-68). Not `AXCreated`: web
    /// apps post it for every new element. A new sheet is read by the next ordinary capture.
    private static let noticeNotifications = ["AXAnnouncementRequested", "AXLiveRegionChanged", "AXLiveRegionCreated"]

    private struct HeardNotice {
        enum Content {
            /// An announcement's text, as the app gave it.
            case text(String)
            /// A live region, read only once capture has checked the window against the exclude list.
            case element(AXUIElement)
        }
        var pid: pid_t
        var content: Content
        var at: Date
    }

    private func heard(element: AXUIElement, name: String, info: NSDictionary) {
        let content: HeardNotice.Content
        switch name {
        case "AXAnnouncementRequested":
            guard let text = info["AXAnnouncementKey"] as? String else { return }
            content = .text(text)
        case "AXLiveRegionChanged", "AXLiveRegionCreated":
            content = .element(element)
        default:
            return
        }
        let notice = HeardNotice(pid: observedPID, content: content, at: Date())
        let bundleID = NSRunningApplication(processIdentifier: observedPID)?.bundleIdentifier
        queue.async {
            // An app the exclude list covers: not even held in memory.
            guard let policy = self.policy, let bundleID, policy.allowsApp(bundleID: bundleID) else { return }
            self.heardNotices.append(notice)
            if self.heardNotices.count > 20 { self.heardNotices.removeFirst() }
        }
    }

    /// The notices heard from this app just now, as text. Called once capture has checked the app
    /// and its window against the exclude list; a live region is read only here, and only if the
    /// window it is in is allowed too. Notices from any other app are dropped unread.
    private func takeNotices(_ heard: [HeardNotice], pid: pid_t, bundleID: String, policy: PrivacyPolicy) -> [String] {
        let now = Date()
        let mine = heard.filter { $0.pid == pid && now.timeIntervalSince($0.at) <= NoticeWatcher.maxAge }
        return mine.compactMap { heard in
            switch heard.content {
            case .text(let text):
                return NoticeWatcher.notice(from: text)
            case .element(let element):
                var window: AnyObject?
                if AXUIElementCopyAttributeValue(element, "AXWindow" as CFString, &window) == .success,
                   let window, CFGetTypeID(window) == AXUIElementGetTypeID() {
                    var title: AnyObject?
                    AXUIElementCopyAttributeValue(window as! AXUIElement, "AXTitle" as CFString, &title)
                    guard policy.allowsWindow(title: title as? String ?? "") else { return nil }
                }
                var limits = AXCapture.Limits()
                limits.maxDepth = 8
                limits.maxNodes = 40
                limits.maxChars = 400
                limits.skipFocusedInput = true
                limits.app = bundleID
                limits.profiles = []
                let read = AXCapture.read(root: LiveElement(ref: element), title: "", appName: "", limits: limits)
                return NoticeWatcher.notice(from: read.lines)
            }
        }
    }

    // MARK: Capture (capture queue)

    private struct Target {
        var pid: pid_t
        var bundleID: String?
        var name: String
    }

    private func capture(_ target: Target, quickLook: Bool = false) {
        // Whatever was heard is used by this capture or dropped, never kept for a later one.
        let pendingNotices = heardNotices
        heardNotices.removeAll()
        guard let policy, let store else { return }
        // An app with no bundle ID can't be checked against the denylist, so it is never read.
        guard let bundleID = target.bundleID, bundleID != Bundle.main.bundleIdentifier else { return }
        guard policy.allowsApp(bundleID: bundleID) else { return note(.excluded, bundleID: bundleID, app: target.name) }

        if preparedPIDs.insert(target.pid).inserted {
            AXCapture.prepare(pid: target.pid, bundleID: bundleID)
        }
        // Check the window's title before reading anything inside it.
        guard let window = AXCapture.focusedWindow(pid: target.pid) else {
            var value: AnyObject?
            let error = AXUIElementCopyAttributeValue(AXUIElementCreateApplication(target.pid), "AXFocusedWindow" as CFString, &value)
            return note(.noWindow(error), bundleID: bundleID, app: target.name)
        }
        guard policy.allowsWindow(title: window.title) else { return note(.excluded, bundleID: bundleID, app: target.name) }

        // What you are typing right now is a draft, not something to keep; a terminal is the exception.
        var limits = AXCapture.Limits()
        limits.skipFocusedInput = !PrivacyPolicy.terminalBundleIDs.contains(bundleID)
        limits.app = bundleID
        let text = AXCapture.read(window: window.element, title: window.title, appName: target.name, limits: limits)
        guard policy.allowsWindow(title: text.windowTitle), policy.allowsURL(text.url) else {
            return note(.excluded, bundleID: bundleID, app: target.name)
        }

        var lines = text.lines
        var source = ObservationStore.Source.ax
        let axChars = lines.reduce(0) { $0 + $1.count }
        if OCRCapture.shouldRun(axChars: axChars, permitted: OCRCapture.isPermitted, enabled: OCRCapture.isEnabled,
                                sinceLast: Date().timeIntervalSince(lastOCR),
                                minChars: Self.minAXChars, minInterval: Self.minOCRInterval) {
            lastOCR = Date()
            let recognized = Self.runOCR(pid: target.pid, windowTitle: window.title, allows: policy.allowsWindow(title:))
            if recognized.reduce(0, { $0 + $1.count }) > axChars {
                lines = recognized
                source = .ocr
            }
        }

        let electron = electronApps[target.pid] ?? {
            let found = CaptureOutcome.isElectron(NSRunningApplication(processIdentifier: target.pid)?.bundleURL)
            electronApps[target.pid] = found
            return found
        }()
        note(.afterRead(lines: lines.count, chars: lines.reduce(0) { $0 + $1.count }, usedOCR: source == .ocr, isElectron: electron,
                        ocrEnabled: OCRCapture.isEnabled, ocrPermitted: OCRCapture.isPermitted),
             bundleID: bundleID, app: target.name)

        let key = Differ.windowKey(bundleID: bundleID, title: text.windowTitle, url: text.url)
        // An email archived just now is noted for the engine, whether or not anything else is new.
        let archived = archives.archived(windowKey: key, lines: lines).map(ArchiveWatcher.line(forSubject:))
        if archives.wantsAnotherLook, !quickLook {
            // An email just left the pane, or the "Archived" notice just went away. If an email
            // was archived, the notice (re)appears within a second or so, sometimes for less
            // than a second, which ordinary captures (at most one a second) can miss. Look at
            // this window a few more times, quickly, while it is still the one in front.
            for delay in ArchiveWatcher.quickLooks {
                queue.asyncAfter(deadline: .now() + delay) { [weak self] in
                    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == target.pid else { return }
                    self?.capture(target, quickLook: true)
                }
            }
        }
        // Notices the app announced since the last capture (SCR-68), each once.
        let heard = notices.fresh(windowKey: key, notices: takeNotices(pendingNotices, pid: target.pid, bundleID: bundleID, policy: policy))
            .map(NoticeWatcher.line)
        let fresh = differ.newLines(windowKey: key, lines: lines) + archived + heard
        do {
            if !fresh.isEmpty {
                try store.insert(
                    bundleID: bundleID, app: target.name, windowTitle: text.windowTitle, url: text.url,
                    source: source, text: String(fresh.joined(separator: "\n").prefix(Self.maxObservationChars)),
                    windowKey: key)
                // The engine reads it at once rather than at its next pass (SCR-76).
                onObservation?()
            }
            if Date().timeIntervalSince(lastPrune) > 600 {
                lastPrune = Date()
                try store.deleteObservations(olderThan: Date().addingTimeInterval(-ttl))
            }
        } catch {
            let message = "Database error: \(error.localizedDescription)"
            DispatchQueue.main.async {
                self.failure = message
                self.refreshStatus()
            }
        }
    }

    /// Keep what capture did with an app, for the troubleshooting report (SCR-79): a code and a line
    /// count, never the text. On the capture queue.
    private func note(_ outcome: CaptureOutcome, bundleID: String, app: String) {
        try? store?.recordCaptureOutcome(bundleID: bundleID, app: app, result: outcome.code, lines: outcome.lines)
    }

    private static func runOCR(pid: pid_t, windowTitle: String, allows: @escaping (String) -> Bool) -> [String] {
        let done = DispatchSemaphore(value: 0)
        var lines: [String] = []
        Task.detached {
            lines = await OCRCapture.recognizeText(pid: pid, windowTitle: windowTitle, allows: allows)
            done.signal()
        }
        return done.wait(timeout: .now() + 5) == .success ? lines : []
    }
}
