import AppKit
import ApplicationServices

/// Where a task was captured, as the engine reports it (`didja place <id>`).
struct TaskPlace: Decodable, Equatable {
    var bundleId: String
    var app: String
    var window: String
    var url: String?
    /// Phrases to find on screen, best first: an email's subject, the task's words.
    var look: [String]
}

/// "Go to Source": bring back the app and window a task was captured in, and scroll
/// to the line it came from. The window is read again, live, to find that line, under
/// the same rules as capture (exclude list first, never a password field); nothing
/// read here is kept.
enum SourceJumper {
    enum Outcome: Equatable {
        /// The window is in front and the line was scrolled into view.
        case scrolled
        /// The window is in front; the line was not found (or the window may not be read).
        case raisedWindow
        /// The window is gone; its page was opened again.
        case openedPage
        /// The window is gone; the app was brought forward.
        case openedApp
        /// Nothing to go to.
        case notFound
    }

    // MARK: Hands off: stop the moment you do anything

    /// Why to stop, if at all. Pure, so the rules can be tested; `Watch` feeds it live readings.
    /// - `secondsSinceInput`: since your last key, click (or Esc); `secondsSinceScroll`: since the
    ///   last scroll that was not one of ours.
    static func stopReason(scrolling: TimeInterval, running: TimeInterval, pointerMoved: CGFloat,
                           frontIsOurs: Bool, secondsSinceInput: TimeInterval,
                           secondsSinceScroll: TimeInterval) -> String? {
        if secondsSinceInput < running { return "you pressed a key or clicked" }
        if secondsSinceScroll < running { return "you scrolled" }
        if pointerMoved > 3 { return "you moved the pointer" }
        if !frontIsOurs { return "another app came to the front" }
        if scrolling > Watch.scrollLimit { return "time is up (\(Int(Watch.scrollLimit)) seconds of scrolling)" }
        if running > Watch.runLimit { return "time is up (\(Int(Watch.runLimit)) seconds)" }
        return nil
    }

    /// Live readings for `stopReason`, from when Go to Source started.
    final class Watch {
        static let scrollLimit: TimeInterval = 5
        static let runLimit: TimeInterval = 10
        let started = Date()
        let pointer = CGEvent(source: nil)?.location ?? .zero
        let allowed: Set<pid_t>
        var scrollStarted: Date?
        var lastOwnScroll: Date?

        init(target: pid_t) { allowed = [target, ProcessInfo.processInfo.processIdentifier] }

        /// Call before each scroll (which starts the scrolling clock the first time), or while waiting.
        func stop(scrolling: Bool = true) -> String? {
            let now = Date()
            if scrolling, scrollStarted == nil { scrollStarted = now }
            let since = { (type: CGEventType) in CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: type) }
            let input = [CGEventType.keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown].map(since).min() ?? .infinity
            // Our own wheel turns count as scrolls too: only one after our last one is yours.
            let ownAgo = lastOwnScroll.map { now.timeIntervalSince($0) } ?? .infinity
            let scroll = since(.scrollWheel)
            let yours = scroll < ownAgo - 0.15 ? scroll : .infinity
            let at = CGEvent(source: nil)?.location ?? pointer
            let front = NSWorkspace.shared.frontmostApplication?.processIdentifier
            return SourceJumper.stopReason(
                scrolling: now.timeIntervalSince(scrollStarted ?? now), running: now.timeIntervalSince(started),
                pointerMoved: hypot(at.x - pointer.x, at.y - pointer.y),
                frontIsOurs: front.map(allowed.contains) ?? true,
                secondsSinceInput: input, secondsSinceScroll: yours)
        }
    }

    /// The watch for the Go to Source under way.
    private static var watch: Watch?

    /// Whether to stop now; says why in the trace.
    private static func shouldStop(scrolling: Bool = true) -> Bool {
        guard let reason = watch?.stop(scrolling: scrolling) else { return false }
        trace?("stopped: \(reason)")
        return true
    }

    // MARK: Matching (pure)

    private static let filler: Set<String> = [
        "the", "and", "for", "with", "you", "your", "this", "that", "from", "into", "are", "was", "has", "have",
    ]

    /// The telling words of a phrase: lower-cased, at least three letters, no filler.
    static func words(_ text: String) -> [String] {
        text.lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { $0.count >= 3 && !filler.contains($0) }
    }

    /// How much of `phrase` is in `text`, from 0 to 1.
    static func score(_ phrase: [String], in text: String) -> Double {
        guard !phrase.isEmpty else { return 0 }
        let have = Set(words(text))
        return Double(phrase.filter(have.contains).count) / Double(phrase.count)
    }

    /// Which of the texts on screen holds the first phrase that can be found: most of
    /// its words present, and of those the shortest text (the line, not the page).
    static func bestMatch(look: [String], in texts: [String]) -> Int? {
        for phrase in look {
            let wanted = words(phrase)
            guard !wanted.isEmpty else { continue }
            let needed = wanted.count == 1 ? 1.0 : 0.75
            let hits = texts.indices.filter { score(wanted, in: texts[$0]) >= needed }
            if let best = hits.min(by: { texts[$0].count < texts[$1].count }) { return best }
        }
        return nil
    }

    /// A window title with what changes on its own taken out: unread counts like "(3)".
    static func steadyTitle(_ title: String) -> String {
        title.replacingOccurrences(of: #"\(\d+\)"#, with: "", options: .regularExpression)
            .lowercased()
            .split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    /// Which open window is the one the task was captured in: the same title, or the
    /// same apart from counts. An empty title matches nothing.
    static func windowIndex(title: String, among titles: [String]) -> Int? {
        guard !title.isEmpty else { return nil }
        if let exact = titles.firstIndex(of: title) { return exact }
        let steady = steadyTitle(title)
        return titles.firstIndex { steadyTitle($0) == steady }
    }

    // MARK: Going there

    /// Set to see each step (sizes and indexes only, never screen text).
    nonisolated(unsafe) static var trace: ((String) -> Void)?

    /// Call off the main thread: it waits for the app and reads its window.
    nonisolated(unsafe) private static var currentPolicy: PrivacyPolicy?

    static func go(to place: TaskPlace, policy: PrivacyPolicy?) -> Outcome {
        currentPolicy = policy
        let pageURL = place.url.flatMap(URL.init(string:)).flatMap { ["http", "https"].contains($0.scheme) ? $0 : nil }
        guard let running = NSRunningApplication.runningApplications(withBundleIdentifier: place.bundleId).first else {
            return open(pageURL, orApp: place.bundleId)
        }
        if Thread.isMainThread { _ = running.activate() } else { DispatchQueue.main.sync { _ = running.activate() } }

        watch = Watch(target: running.processIdentifier)
        defer { watch = nil }
        let app = AXUIElementCreateApplication(running.processIdentifier)
        AXUIElementSetMessagingTimeout(app, 1.0)
        AXCapture.prepare(pid: running.processIdentifier, bundleID: place.bundleId)
        let windows = (attribute(app, "AXWindows") as? [AXUIElement]) ?? []
        let titles = windows.map { attribute($0, "AXTitle") as? String ?? "" }
        trace?("windows: \(titles.count), wanted title length \(place.window.count), title lengths \(titles.map(\.count))")

        // The window with its title first; then the others, front first. Titles are not enough on
        // their own: an Electron app's window is titled after the app while capture names it after
        // the page, and a browser's title follows whichever tab is in front.
        let byTitle = windowIndex(title: place.window, among: titles)
        let order = (byTitle.map { [$0] } ?? []) + windows.indices.filter { $0 != byTitle }
        for index in order {
            // The same rules as capture, before anything inside a window is read.
            guard let policy, policy.allowsApp(bundleID: place.bundleId), policy.allowsWindow(title: titles[index]),
                  policy.allowsURL(place.url)
            else { continue }
            guard let found = find(place.look, in: windows[index]) else { continue }
            trace?("found in window \(index)")
            raise(windows[index])
            // Raising a window can re-lay it out: scroll once it has settled.
            Thread.sleep(forTimeInterval: 0.15)
            return scrollIntoView(found) ? .scrolled : .raisedWindow
        }

        // Not loaded yet: a long list (Outlook's messages) keeps only the rows near the top. Page down it.
        for index in order {
            guard let policy, policy.allowsWindow(title: titles[index]), policy.allowsApp(bundleID: place.bundleId) else { continue }
            if let row = pageThroughLists(place.look, in: windows[index]) {
                raise(windows[index])
                Thread.sleep(forTimeInterval: 0.15)
                // Select it, which opens an email in the reading pane.
                AXUIElementSetAttributeValue(row, kAXSelectedAttribute as CFString, kCFBooleanTrue)
                return scrollIntoView(row) ? .scrolled : .raisedWindow
            }
        }

        // Not on screen: an app with a sidebar of conversations (Claude, Slack) may list it by name.
        if let name = conversationName(place), let (item, index) = windows.enumerated()
            .lazy.compactMap({ i, w in pressable(named: name, in: w).map { ($0, i) } }).first {
            let window = item.element
            raise(windows[index])
            let opened = item.step == .follow
                ? AXUIElementPerformAction(window, kAXPressAction as CFString)
                : AXUIElementSetAttributeValue(window, kAXSelectedAttribute as CFString, kCFBooleanTrue)
            trace?("opened the conversation from the sidebar (\(item.step)): \(opened.rawValue)")
            if opened == .success, scrollOnceLoaded(place, app: app) { return .scrolled }
            // Opened, but the line is further up than the app has loaded: page up to it.
            if opened == .success, let found = pageUpThroughConversation(
                place.look, in: windows[index], besides: frame(of: window)) {
                return scrollIntoView(found) ? .scrolled : .raisedWindow
            }
            return .raisedWindow
        }

        // Not on screen in any window.
        if let byTitle {
            raise(windows[byTitle])
            return .raisedWindow
        }
        // Its page, in the browser it came from, when it came from a browser.
        if let pageURL, isBrowser(place.bundleId) {
            _ = open(pageURL, orApp: place.bundleId)
            return scrollOnceLoaded(place, app: app) ? .scrolled : .openedPage
        }
        return windows.isEmpty ? .openedApp : .raisedWindow
    }

    /// After a page is opened again: wait for it to load (up to 6 seconds), then scroll to the line.
    private static func scrollOnceLoaded(_ place: TaskPlace, app: AXUIElement) -> Bool {
        for attempt in 0..<12 {
            Thread.sleep(forTimeInterval: 0.5)
            if shouldStop(scrolling: false) { return false }
            guard let window = (attribute(app, "AXFocusedWindow") ?? attribute(app, "AXMainWindow")),
                  CFGetTypeID(window) == AXUIElementGetTypeID() else { continue }
            let element = window as! AXUIElement
            let title = attribute(element, "AXTitle") as? String ?? ""
            guard let policy = currentPolicy, policy.allowsApp(bundleID: place.bundleId),
                  policy.allowsWindow(title: title), policy.allowsURL(place.url) else { return false }
            if let found = find(place.look, in: element) {
                trace?("loaded after \(attempt + 1) tries")
                return scrollIntoView(found)
            }
        }
        return false
    }

    /// Tables and outlines in a window that hold more rows than they show.
    private static func lists(in element: AXUIElement, depth: Int = 0, budget: inout Int) -> [AXUIElement] {
        guard depth <= 30, budget > 0 else { return [] }
        budget -= 1
        let role = attribute(element, "AXRole") as? String ?? ""
        if role == "AXTable" || role == "AXOutline" { return [element] }
        if role == "AXWebArea" || role == "AXTextArea" { return [] }
        return ((attribute(element, "AXChildren") as? [AXUIElement]) ?? [])
            .flatMap { lists(in: $0, depth: depth + 1, budget: &budget) }
    }

    /// The row holding the line, scrolling each list down a page at a time (at most 30 times) so it
    /// loads more rows. A list that does not have it is put back where it was.
    private static func pageThroughLists(_ look: [String], in window: AXUIElement) -> AXUIElement? {
        var budget = 3_000
        for list in lists(in: window, budget: &budget) {
            let rows = { (attribute(list, "AXRows") as? [AXUIElement]) ?? [] }
            let first = rows().first
            var last: AXUIElement?
            for step in 0..<30 {
                let current = rows()
                let texts = current.map { row -> String in
                    var b = 300
                    var found: [(element: AXUIElement, text: String)] = []
                    return collect(row, depth: 0, budget: &b, into: &found)
                }
                if let hit = bestMatch(look: look, in: texts) {
                    trace?("found in a list after \(step) pages, row \(hit) of \(current.count)")
                    return current[hit]
                }
                trace?("list page \(step): \(current.count) rows")
                guard let end = current.last, last.map({ !CFEqual($0, end) }) ?? true else { break }
                last = end
                if shouldStop() { return nil }
                AXUIElementPerformAction(end, "AXScrollToVisible" as CFString)
                Thread.sleep(forTimeInterval: 0.35)
            }
            if let first { AXUIElementPerformAction(first, "AXScrollToVisible" as CFString) }
        }
        return nil
    }

    /// The parts of a window that scroll, each with how many pieces of text it holds, most first.
    private static func scrollers(in window: AXUIElement) -> [(element: AXUIElement, texts: Int)] {
        AXCapture.withLargeStack { () -> [(element: AXUIElement, texts: Int)] in
            var found: [AXUIElement] = []
            var budget = 6_000
            func walk(_ element: AXUIElement, depth: Int) {
                guard depth <= 60, budget > 0 else { return }
                budget -= 1
                let role = attribute(element, "AXRole") as? String ?? ""
                if role == "AXTextArea" || role == "AXTextField" { return }
                if role == "AXScrollArea" || attribute(element, "AXVerticalScrollBar") != nil { found.append(element) }
                for child in (attribute(element, "AXChildren") as? [AXUIElement]) ?? [] { walk(child, depth: depth + 1) }
            }
            walk(window, depth: 0)
            return found.map { element in
                var texts: [(element: AXUIElement, text: String)] = []
                var b = 6_000
                collect(element, depth: 0, budget: &b, into: &texts)
                return (element, texts.count)
            }.sorted { $0.texts > $1.texts }
        }
    }

    /// A conversation that loads earlier messages as you scroll up (Claude, chat apps): bring its top
    /// message into view, which loads the ones before it, until the line turns up (at most 30 times).
    /// `sidebar` is where the conversation's name was pressed: text in that column is not the conversation.
    private static func pageUpThroughConversation(_ look: [String], in window: AXUIElement,
                                                  besides sidebar: CGRect?) -> AXUIElement? {
        let areas = scrollers(in: window)
        trace?("scrolling parts: \(areas.count), texts in each \(areas.prefix(6).map(\.texts))")
        guard let conversation = areas.first?.element else { return nil }
        var lastTop: AXUIElement?
        var lastY: CGFloat?
        var unchanged = 0
        for step in 0..<60 {
            let texts = AXCapture.withLargeStack { () -> [(element: AXUIElement, text: String)] in
                var texts: [(element: AXUIElement, text: String)] = []
                var budget = 10_000
                collect(conversation, depth: 0, budget: &budget, into: &texts)
                return texts
            }
            if let hit = bestMatch(look: look, in: texts.map(\.text)) {
                trace?("found after paging up \(step) times")
                return texts[hit].element
            }
            // The top message loaded: the first sentence-long piece of text. Sidebar names, buttons
            // and headings are shorter, and the part that scrolls is often not marked as such.
            guard let top = texts.first(where: { text in
                isMessage(text.text) && !inColumn(frame(of: text.element), of: sidebar)
            })?.element else { return nil }
            // At the top when the same message stays in the same place, scroll as we may.
            let y = frame(of: top)?.minY
            if let lastTop, CFEqual(lastTop, top), y == lastY { unchanged += 1 } else { unchanged = 0 }
            if unchanged >= 2 { trace?("reached the top after \(step) pages"); return nil }
            lastTop = top
            lastY = y
            if shouldStop() { return nil }
            let asked = AXUIElementPerformAction(top, "AXScrollToVisible" as CFString)
            // Some apps only load earlier messages when the scroll wheel turns: turn it over the message.
            let wheeled = scrollUp(over: top, in: window)
            trace?("page up \(step): \(texts.count) texts, top at \(Int(y ?? -1)), scroll-to \(asked.rawValue), wheel \(wheeled)")
            Thread.sleep(forTimeInterval: 0.4)
        }
        return nil
    }

    /// Where an element is on screen.
    private static func frame(of element: AXUIElement) -> CGRect? {
        var position = CGPoint.zero, size = CGSize.zero
        guard let p = attribute(element, "AXPosition"), let z = attribute(element, "AXSize"),
              AXValueGetValue(p as! AXValue, .cgPoint, &position),
              AXValueGetValue(z as! AXValue, .cgSize, &size) else { return nil }
        return CGRect(origin: position, size: size)
    }

    /// Where to turn the wheel: level with the message (its column), halfway down the window. The
    /// message itself is usually above what is shown, so its own position may be off screen.
    static func wheelPoint(message: CGRect, window: CGRect) -> CGPoint {
        let x = min(max(message.midX, window.minX + 20), window.maxX - 20)
        return CGPoint(x: x, y: window.midY)
    }

    /// Turn the scroll wheel up a page or so over a conversation, as a person scrolling would.
    /// Posted from a private event source, so the checks for your own input do not see it.
    private static func scrollUp(over element: AXUIElement, in window: AXUIElement) -> Bool {
        guard let message = frame(of: element), let windowFrame = frame(of: window) else { return false }
        let point = wheelPoint(message: message, window: windowFrame)
        // The pointer is never moved: the wheel turns at `point`, and if the app only scrolls what is
        // under the pointer, nothing moves and paging stops at its time limit.
        for _ in 0..<12 {
            if shouldStop() { return false }
            guard let event = CGEvent(scrollWheelEvent2Source: CGEventSource(stateID: .privateState), units: .pixel, wheelCount: 1,
                                      wheel1: 300, wheel2: 0, wheel3: 0) else { return false }
            event.location = point
            event.post(tap: .cghidEventTap)
            watch?.lastOwnScroll = Date()
            Thread.sleep(forTimeInterval: 0.03)
        }
        return true
    }

    /// Whether `frame` sits in the same column as `column` (its middle within the column's sides).
    static func inColumn(_ frame: CGRect?, of column: CGRect?) -> Bool {
        guard let frame, let column else { return false }
        return frame.midX >= column.minX && frame.midX <= column.maxX
    }

    /// Long enough to be a message rather than a name, a button or a heading.
    static func isMessage(_ text: String) -> Bool { words(text).count >= 8 }

    /// The conversation's name from the window title capture kept: "Fix login - Claude Code" → "Fix login".
    static func conversationName(_ place: TaskPlace) -> String? {
        var name = place.window
        for suffix in [" - Claude Code", " - \(place.app)", " – \(place.app)", " | \(place.app)"] where name.hasSuffix(suffix) {
            name = String(name.dropLast(suffix.count))
        }
        name = name.trimmingCharacters(in: .whitespaces)
        return name.isEmpty || name == place.app ? nil : name
    }

    /// Read only, for diagnosis: where the conversation's name is in the app's windows, and the roles
    /// (and actions) of it and the elements around it. Nothing is brought forward, pressed or scrolled.
    static func describeSidebar(for place: TaskPlace) {
        guard let name = conversationName(place),
              let running = NSRunningApplication.runningApplications(withBundleIdentifier: place.bundleId).first
        else { trace?("no conversation name, or the app is not running"); return }
        let app = AXUIElementCreateApplication(running.processIdentifier)
        AXUIElementSetMessagingTimeout(app, 1.0)
        let windows = (attribute(app, "AXWindows") as? [AXUIElement]) ?? []
        for (index, window) in windows.enumerated() {
            // The first step of Go to Source: is the line already on screen?
            if find(place.look, in: window) != nil { trace?("window \(index): already shows the line, so it would scroll there and not switch") }
            AXCapture.withLargeStack {
                var texts: [(element: AXUIElement, text: String)] = []
                var budget = 10_000
                collect(window, depth: 0, budget: &budget, into: &texts)
                let hits = texts.filter { steadyTitle($0.text) == steadyTitle(name) }
                trace?("window \(index): \(hits.count) elements carry the name")
                for hit in hits.prefix(4) {
                    var chain: [String] = []
                    var current: AXUIElement? = hit.element
                    for _ in 0..<6 {
                        guard let node = current else { break }
                        var names: CFArray?
                        AXUIElementCopyActionNames(node, &names)
                        let actions = (names as? [String] ?? []).filter { !$0.hasPrefix("AXScroll") && $0 != "AXShowMenu" }
                        let role = attribute(node, "AXRole") as? String ?? "?"
                        let sub = attribute(node, "AXSubrole") as? String ?? ""
                        let selectable = attribute(node, "AXSelected") != nil
                        chain.append("\(role)\(sub.isEmpty ? "" : "/\(sub)")\(actions.isEmpty ? "" : " \(actions)")\(selectable ? " selectable" : "")")
                        current = attribute(node, "AXParent").map { $0 as! AXUIElement }
                    }
                    trace?("  " + chain.joined(separator: " ← "))
                }
            }
            if let item = pressable(named: name, in: window) {
                trace?("would open it: \(item.step) on \(attribute(item.element, "AXRole") as? String ?? "?")")
            } else {
                trace?("would not open it: nothing it may press or select")
            }
        }
    }

    /// What may be done to an element holding a conversation's name. Only what is known to do no
    /// more than open it: a link is followed, a row or cell is selected. A button is never pressed,
    /// whatever it says (the maintainer, 2026-11-11: no button clicks).
    enum SidebarStep: Equatable { case follow, select, never, climb }
    static func sidebarStep(role: String) -> SidebarStep {
        switch role {
        case "AXLink": return .follow
        case "AXRow", "AXCell": return .select
        case "AXButton", "AXMenuButton", "AXPopUpButton", "AXCheckBox", "AXRadioButton", "AXMenuItem": return .never
        default: return .climb
        }
    }

    /// The one button that may be pressed (the maintainer, 2026-11-11): a conversation in a sidebar, as Claude
    /// shows them. A plain button whose whole text is exactly the conversation's name, in the left
    /// third of the window. Pressing it only opens that conversation.
    static func mayPressConversationButton(role: String, text: String, name: String,
                                           button: CGRect?, window: CGRect?) -> Bool {
        guard role == "AXButton", let button, let window, !name.isEmpty,
              isNameWithStatus(text, name: name) else { return false }
        return button.midX < window.minX + window.width / 3
    }

    /// Words a sidebar shows after a conversation's name about its state, never an action.
    private static let statusWords: Set<String> = [
        "running", "working", "waiting", "idle", "unread", "new", "done", "ago", "now", "just",
    ]

    /// The name exactly, or the name followed by at most three status words ("Running", "2m", "5h ago").
    static func isNameWithStatus(_ text: String, name: String) -> Bool {
        let wanted = steadyTitle(name), have = steadyTitle(text)
        guard !wanted.isEmpty, have.hasPrefix(wanted) else { return false }
        let rest = have.dropFirst(wanted.count)
        guard rest.isEmpty || rest.first == " " else { return false }   // "Fix login" is not "Fix logins"
        let extra = rest.split(whereSeparator: { $0.isWhitespace || $0 == "·" || $0 == "•" }).map(String.init)
        return extra.count <= 3 && extra.allSatisfy { word in
            statusWords.contains(word) || word.range(of: #"^\d+(s|m|h|d|w|min|mins|hr|hrs)?$"#, options: .regularExpression) != nil
        }
    }

    /// A link, row or cell whose words are exactly `name`, or a sidebar button that is only that name:
    /// a conversation in a sidebar.
    private static func pressable(named name: String, in window: AXUIElement) -> (element: AXUIElement, step: SidebarStep)? {
        AXCapture.withLargeStack { () -> (element: AXUIElement, step: SidebarStep)? in
            var texts: [(element: AXUIElement, text: String)] = []
            var budget = 10_000
            collect(window, depth: 0, budget: &budget, into: &texts)
            let wanted = steadyTitle(name)
            for (element, text) in texts where steadyTitle(text) == wanted {
                // The text itself, or the nearest link, row or cell around it; never past a button.
                var current: AXUIElement? = element
                climbing: for _ in 0..<4 {
                    guard let node = current else { break }
                    let role = attribute(node, "AXRole") as? String ?? ""
                    let step = sidebarStep(role: role)
                    switch step {
                    case .follow, .select: return (node, step)
                    case .never:
                        var b = 300
                        var inner: [(element: AXUIElement, text: String)] = []
                        let whole = collect(node, depth: 0, budget: &b, into: &inner)
                        if mayPressConversationButton(role: role, text: whole, name: name,
                                                      button: frame(of: node), window: frame(of: window)) {
                            return (node, .follow)
                        }
                        break climbing
                    case .climb: current = attribute(node, "AXParent").map { $0 as! AXUIElement }
                    }
                }
            }
            return nil
        }
    }

    private static func raise(_ window: AXUIElement) {
        AXUIElementPerformAction(window, kAXRaiseAction as CFString)
        AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, kCFBooleanTrue)
    }

    private static func find(_ look: [String], in window: AXUIElement) -> AXUIElement? {
        AXCapture.withLargeStack { () -> AXUIElement? in
            var texts: [(element: AXUIElement, text: String)] = []
            var budget = 10_000
            collect(window, depth: 0, budget: &budget, into: &texts)
            trace?("texts: \(texts.count), visited \(10_000 - budget); look \(look.map { words($0).count }) words")
            guard let best = bestMatch(look: look, in: texts.map(\.text)) else {
                trace?("no match; best scores \(look.map { p in texts.map { score(words(p), in: $0.text) }.max() ?? 0 })")
                return nil
            }
            trace?("match role \(attribute(texts[best].element, "AXRole") as? String ?? "?") length \(texts[best].text.count)")
            return texts[best].element
        }
    }

    /// An app that opens web pages: only then is a page's address opened again.
    private static func isBrowser(_ bundleID: String) -> Bool {
        guard let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID),
              let web = URL(string: "https://example.com") else { return false }
        return NSWorkspace.shared.urlsForApplications(toOpen: web).contains(app)
    }

    private static func open(_ url: URL?, orApp bundleID: String) -> Outcome {
        guard let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) else {
            if let url { NSWorkspace.shared.open(url); return .openedPage }
            return .notFound
        }
        let configuration = NSWorkspace.OpenConfiguration()
        if let url {
            NSWorkspace.shared.open([url], withApplicationAt: appURL, configuration: configuration)
            return .openedPage
        }
        NSWorkspace.shared.openApplication(at: appURL, configuration: configuration)
        return .openedApp
    }

    /// Each element's text, gathered bottom up: a paragraph's text is its pieces joined,
    /// so a line split by a link or bold word is still found whole.
    @discardableResult
    private static func collect(_ element: AXUIElement, depth: Int, budget: inout Int,
                                into texts: inout [(element: AXUIElement, text: String)]) -> String {
        guard depth <= 100, budget > 0 else { return "" }
        budget -= 1
        let role = attribute(element, "AXRole") as? String ?? ""
        let subrole = attribute(element, "AXSubrole") as? String ?? ""
        if PrivacyPolicy.isSecureField(role: role, subrole: subrole) { return "" }

        var text = ""
        if role == "AXStaticText" || role == "AXHeading" || role == "AXLink" || role == "AXCell" || role == "AXRow" {
            text = (attribute(element, "AXValue") as? String) ?? (attribute(element, "AXTitle") as? String) ?? ""
        }
        if role != "AXTextArea", role != "AXTextField",
           let children = attribute(element, "AXChildren") as? [AXUIElement] {
            let inner = children.map { collect($0, depth: depth + 1, budget: &budget, into: &texts) }
                .filter { !$0.isEmpty }.joined(separator: " ")
            if !inner.isEmpty, !text.contains(inner) { text = text.isEmpty ? inner : "\(text) \(inner)" }
        }
        if !text.isEmpty, text.count <= 1000 { texts.append((element, text)) }
        return text.count <= 1000 ? text : ""
    }

    /// Ask the element, or the nearest of its parents that can, to scroll itself into view.
    private static func scrollIntoView(_ element: AXUIElement) -> Bool {
        var current: AXUIElement? = element
        for _ in 0..<6 {
            guard let node = current else { return false }
            let result = AXUIElementPerformAction(node, "AXScrollToVisible" as CFString)
            trace?("AXScrollToVisible on \(attribute(node, "AXRole") as? String ?? "?"): \(result.rawValue)")
            if result == .success { return true }
            current = attribute(node, "AXParent").map { $0 as! AXUIElement }
        }
        return false
    }

    private static func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
        var value: AnyObject?
        return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
    }
}
