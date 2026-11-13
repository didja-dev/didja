import AppKit
import ApplicationServices

/// A node of the accessibility tree, reduced to what text capture needs.
struct AXNode {
    var role: String
    var subrole: String = ""
    /// The element's value for text roles; the title for links and buttons.
    var text: String = ""
    var children: [AXNode] = []
    /// Where a link in an email's body points, when its address is not its words ("Approve").
    var url: String? = nil
    /// A checkbox, radio button or switch's state as written in the text: "[x]", "[ ]", "[on]", "[off]", "[-]".
    var state: String? = nil
    /// Holds the focused input of an editor's built-in terminal, not yet wrapped as its section (SCR-69).
    var terminalInput = false
}

/// The text of one window, as lines.
struct WindowText {
    var windowTitle: String
    var url: String?
    var lines: [String]
}

/// Primary capture source: reads the focused window through the Accessibility API.
enum AXCapture {
    struct Limits {
        var maxDepth = 100
        var maxNodes = 10_000
        var maxChars = 100_000
        /// Text areas can hold a whole terminal scrollback; keep only the end.
        var maxFieldChars = 20_000
        /// Leave out the text field that has keyboard focus (the draft being typed).
        var skipFocusedInput = false
        /// The app's bundle id: an app with a profile gets its chats or emails labelled (see `AppProfile`).
        var app: String?
        /// The profiles to label with: the app's own, and any for the site a web area shows.
        var profiles: [AppProfile] = AppProfiles.builtIn
    }

    /// A line that starts a new section of the window, such as one message in a
    /// chat: "⟦Message 23⟧". Sections let readers of the text tell which lines
    /// belong together without knowing anything about the app.
    static let sectionOpen: Character = "⟦"
    static func sectionLine(_ name: String) -> String {
        "⟦\(name.isEmpty ? "section" : name)⟧"
    }

    private static let textRoles: Set<String> = ["AXStaticText", "AXListMarker", "AXTextArea", "AXTextField"]
    private static let titledRoles: Set<String> = ["AXLink", "AXButton"]
    /// Controls whose state is written before their label (SCR-68).
    static let toggleRoles: Set<String> = ["AXCheckBox", "AXRadioButton", "AXSwitch"]
    /// Editors with a built-in terminal (xterm.js): VS Code, Cursor, Windsurf (SCR-69).
    static let editorBundles: Set<String> = ["com.microsoft.VSCode", "com.todesktop.230313mzl4w4u92", "com.exafunction.windsurf"]
    /// The section an editor's terminal is written under while it has focus.
    static let terminalSection = "Terminal"

    /// At most this many link targets are kept from the main content of a page.
    static let maxPageLinkTargets = 20

    /// How a control's state is written: "[x]" / "[ ]" for a checkbox or radio button, "[on]" /
    /// "[off]" for a switch, "[-]" for a mixed checkbox. Nil when it has no state to read.
    static func stateMark(role: String, subrole: String, value: Int?) -> String? {
        guard let value else { return nil }
        let isSwitch = role == "AXSwitch" || subrole == "AXSwitch" || subrole == "AXToggle"
        switch value {
        case 0: return isSwitch ? "[off]" : "[ ]"
        case 1: return isSwitch ? "[on]" : "[x]"
        case 2: return "[-]"
        default: return nil
        }
    }

    /// Where a link in a page's main content points, kept so a PR, issue or deploy link is not lost:
    /// a web address with no query or fragment (they can carry tokens), at most 200 characters. Nil
    /// for other schemes and for links within the page itself.
    static func pageLinkTarget(_ url: URL?, page: String?) -> String? {
        guard let url, let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              var parts = URLComponents(url: url, resolvingAgainstBaseURL: false), parts.host != nil
        else { return nil }
        parts.query = nil
        parts.fragment = nil
        parts.user = nil
        parts.password = nil
        guard let text = parts.string, text.count <= 200 else { return nil }
        if let page, var here = URLComponents(string: page) {
            here.query = nil
            here.fragment = nil
            if here.string == text { return nil }
        }
        return text
    }

    /// A link target worth keeping from an email: a web address, at most 500 characters. Nil for
    /// mail, phone and in-page links.
    static func mailLinkTarget(_ url: URL?) -> String? {
        guard let url, let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else { return nil }
        let text = url.absoluteString
        return text.count <= 500 ? text : nil
    }
    private static let chromiumBrowsers: Set<String> = [
        "com.google.Chrome", "com.microsoft.edgemac", "com.brave.Browser", "company.thebrowser.Browser",
        "com.vivaldi.Vivaldi", "com.operasoftware.Opera", "org.chromium.Chromium", "company.thebrowser.dia",
    ]

    // MARK: Reading the live tree

    /// Chromium and Electron apps only build their accessibility tree when asked.
    static func prepare(pid: pid_t, bundleID: String) {
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 1.0)
        let electron = AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
        if electron != .success, chromiumBrowsers.contains(bundleID) {
            AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
        }
    }

    /// The app's focused window and its title, without reading its content.
    static func focusedWindow(pid: pid_t) -> (element: AXUIElement, title: String)? {
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 1.0)
        guard let window = attribute(app, "AXFocusedWindow") ?? attribute(app, "AXMainWindow"),
              CFGetTypeID(window) == AXUIElementGetTypeID()
        else { return nil }
        let element = window as! AXUIElement
        return (element, attribute(element, "AXTitle") as? String ?? "")
    }

    /// Walk a window's tree and return its text.
    static func read(window: AXUIElement, title: String, appName: String, limits: Limits = Limits()) -> WindowText {
        // The walk recurses once per level of the tree, up to `maxDepth`. A dispatch queue's thread
        // has a 512 KB stack, which a deep web page (100 levels) overflowed: run it on a big one.
        withLargeStack { read(root: LiveElement(ref: window), title: title, appName: appName, limits: limits) }
    }

    /// Stack size for walking a window's tree: room for `maxDepth` levels with plenty to spare.
    static let walkStackSize = 16 << 20

    /// Run `body` on a new thread with a `walkStackSize` stack and wait for it.
    static func withLargeStack<T>(_ body: @escaping () -> T) -> T {
        var result: T?
        let done = DispatchSemaphore(value: 0)
        let thread = Thread { result = body(); done.signal() }
        thread.stackSize = walkStackSize
        thread.qualityOfService = .utility
        thread.start()
        done.wait()
        return result!
    }

    /// Walk any element tree, live or an outline, on the current thread.
    static func read<E: AXElement>(root: E, title: String, appName: String, limits: Limits = Limits()) -> WindowText {
        var walk = Walk<E>(limits: limits)
        let built = walk.node(for: root, depth: 0) ?? AXNode(role: "AXWindow")
        var windowTitle = title
        // Electron windows are titled after the app; the page title says what is open.
        if let pageTitle = walk.pageTitle, title.isEmpty || title == appName {
            windowTitle = pageTitle
        }
        return WindowText(windowTitle: windowTitle, url: walk.url, lines: lines(from: built))
    }

    /// What one element is, read once each and only when a rule asks.
    private final class Facts<E: AXElement> {
        let element: E
        let role: String
        init(_ element: E, role: String) { self.element = element; self.role = role }
        lazy var identifier = element.string("AXIdentifier")
        lazy var dom = element.string("AXDOMIdentifier")
        lazy var classes = element.classes()
    }

    private struct Walk<E: AXElement> {
        let limits: Limits
        var nodes = 0
        var chars = 0
        var url: String?
        var pageTitle: String?
        /// The profiles in use: the app's, and once the page's address is known, the site's.
        var profiles: [AppProfile]
        /// Email: the open conversation's subject, and how many of its messages have been read so far.
        var mailSubject = ""
        /// True while reading the body of an open email.
        var inMailBody = false
        /// True inside a web area: in Outlook for Mac, the open email's body is one.
        var insideWebArea = false
        /// True inside a page's main content (its main landmark).
        var insideMain = false
        /// How many link targets have been kept from main content so far.
        var pageLinks = 0
        var mailCount = 0
        /// The open chat: its name and kind, and the last sender and time seen, for a message that
        /// follows on from the one before without repeating them.
        var chatName = ""
        var chatKind = ChatAdapter.Kind.unknown
        var lastSender = ""
        var lastTime = ""

        init(limits: Limits) {
            self.limits = limits
            profiles = limits.profiles.filter { $0.match.matches(bundleID: limits.app) }
        }

        /// The first element under `element` (itself included), up to 12 levels down, that `matches`.
        static func first(under element: E, depth: Int = 0, _ matches: (E) -> Bool) -> E? {
            if matches(element) { return element }
            guard depth < 12 else { return nil }
            for child in element.children() {
                if let found = Self.first(under: child, depth: depth + 1, matches) { return found }
            }
            return nil
        }

        /// Every element under `element` (itself included), up to 12 levels down.
        static func collect(under element: E, depth: Int = 0, _ visit: (E) -> Void) {
            visit(element)
            guard depth < 12 else { return }
            for child in element.children() { collect(under: child, depth: depth + 1, visit) }
        }

        // MARK: Profile rules

        func matches(_ m: AppProfile.Matcher, _ facts: Facts<E>, id: String? = nil) -> Bool {
            if let roles = m.role, !roles.contains(facts.role) { return false }
            if let t = m.identifier, !t.test(facts.identifier, id: id) { return false }
            if let t = m.dom, !t.test(facts.dom, id: id) { return false }
            if let wanted = m.classes, !wanted.contains(where: facts.classes.contains) { return false }
            if let prefix = m.classPrefix, !facts.classes.contains(where: { $0.hasPrefix(prefix) }) { return false }
            return true
        }

        func matches(_ m: AppProfile.Matcher, _ element: E, id: String? = nil) -> Bool {
            matches(m, Facts(element, role: element.roleAndSubrole()?.role ?? ""), id: id)
        }

        /// A piece of text a rule asks for, with its pattern's groups.
        mutating func read(_ source: AppProfile.Source?, on element: E, depth: Int, id: String? = nil,
                           profile: AppProfile) -> (text: String, groups: [String: String]) {
            guard let source else { return ("", [:]) }
            for step in source.steps {
                var targets: [E] = []
                if let of = step.of {
                    if step.all {
                        Self.collect(under: element) { if matches(of, $0, id: id) { targets.append($0) } }
                    } else if let found = Self.first(under: element, { matches(of, $0, id: id) }) {
                        targets = [found]
                    }
                } else {
                    targets = [element]
                }
                var texts: [String] = []
                var groups: [String: String] = [:]
                for target in targets {
                    let (text, found) = read(step, on: target, depth: depth, profile: profile)
                    if !text.isEmpty, !texts.contains(text) { texts.append(text) }
                    if groups.isEmpty { groups = found }
                }
                let text = texts.joined(separator: step.join)
                if !text.isEmpty {
                    groups["v"] = text
                    return (text, groups)
                }
            }
            return ("", [:])
        }

        private mutating func read(_ step: AppProfile.SourceStep, on element: E, depth: Int,
                                   profile: AppProfile) -> (String, [String: String]) {
            // The same limits as reading the window: never a secure field, nor the draft being typed.
            guard let (role, subrole) = element.roleAndSubrole(),
                  !PrivacyPolicy.isSecureField(role: role, subrole: subrole) else { return ("", [:]) }
            let isDraft = limits.skipFocusedInput && (role == "AXTextArea" || role == "AXTextField") && element.isFocused()
            var text = ""
            for attribute in step.attr {
                if let name = attribute.axName {
                    if isDraft && attribute == .value { continue }
                    text = element.string(name) ?? ""
                } else if !isDraft {
                    text = plainText(of: element, depth: depth)
                }
                if profile.stripBidiMarks == true { text = ChatAdapter.stripMarks(text) }
                text = text.trimmingCharacters(in: .whitespacesAndNewlines)
                if !text.isEmpty { break }
            }
            if step.squash { text = text.split(whereSeparator: \.isWhitespace).joined(separator: " ") }
            for _ in 0..<step.dropLabel {
                if let colon = text.range(of: ": "), text.distance(from: text.startIndex, to: colon.lowerBound) <= 14 {
                    text = String(text[colon.upperBound...])
                }
            }
            if let reject = step.reject, reject.contains(where: { text.range(of: $0, options: .caseInsensitive) != nil }) {
                return ("", [:])
            }
            if let wanted = step.contains {
                return (text.range(of: wanted, options: .caseInsensitive) != nil ? "1" : "", [:])
            }
            var groups: [String: String] = [:]
            if let pattern = step.pattern {
                guard let found = pattern.match(text) else { return ("", [:]) }
                groups = found.mapValues { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                text = groups["v"] ?? ""
            }
            var trim = CharacterSet.whitespacesAndNewlines
            if let extra = step.trim { trim.formUnion(CharacterSet(charactersIn: extra)) }
            return (text.trimmingCharacters(in: trim), groups)
        }

        /// A message as a section with its text lines under it.
        mutating func chatMessage(_ message: ChatAdapter.Message, body: AXNode? = nil) -> AXNode {
            var node = AXNode(role: "AXGroup", subrole: "AXDocumentArticle", text: ChatAdapter.sectionName(message))
            if let body {
                node.children = [body]
            } else {
                node.children = message.text.split(separator: "\n", omittingEmptySubsequences: true)
                    .map { AXNode(role: "AXStaticText", text: String($0)) }
            }
            chars += message.text.count
            return node
        }

        /// What follows a chat's messages or an email in the window (the box you type in) is not part of it.
        static var page: AXNode { AXNode(role: "AXGroup", subrole: "AXDocumentArticle", text: "Page") }

        static func section(_ name: String, children: [AXNode] = []) -> AXNode {
            AXNode(role: "AXGroup", subrole: "AXDocumentArticle", text: name, children: children)
        }

        static func lineNode(_ line: String) -> AXNode {
            AXNode(role: "AXGroup", children: [AXNode(role: "AXStaticText", text: line)])
        }

        /// What a profile makes of this element: a labelled node, an empty group for something left
        /// out, or nil to read it as usual.
        mutating func profileNode(_ element: E, role: String, depth: Int) -> AXNode? {
            guard !profiles.isEmpty else { return nil }
            let facts = Facts(element, role: role)
            for profile in profiles {
                for rule in profile.rules where matches(rule.matcher, facts) {
                    return apply(rule, of: profile, to: element, facts: facts, depth: depth)
                }
            }
            return nil
        }

        private mutating func apply(_ rule: AppProfile.Rule, of profile: AppProfile, to element: E, facts: Facts<E>,
                                    depth: Int) -> AXNode? {
            switch rule.action {
            case .skip:
                return AXNode(role: "AXGroup")

            case .chatName:
                let name = read(rule.chat, on: element, depth: depth, profile: profile).text
                if !name.isEmpty { chatName = name }
                if let group = rule.groupIf { chatKind = matches(group, facts) ? .group : .direct }
                return nil

            case .message:
                if let unless = rule.unless, matches(unless, facts) { return AXNode(role: "AXGroup") }
                let id = rule.idAfter.flatMap { prefix in
                    (facts.dom ?? facts.identifier).flatMap { $0.hasPrefix(prefix) ? String($0.dropFirst(prefix.count)) : nil }
                }
                var sender = read(rule.from, on: element, depth: depth, id: id, profile: profile).text
                if sender.isEmpty { sender = lastSender }
                var time = read(rule.time, on: element, depth: depth, id: id, profile: profile).text
                if time.isEmpty { time = lastTime }
                lastSender = sender
                lastTime = time
                var body: AXNode?
                if let wanted = rule.body, let content = Self.first(under: element, { matches(wanted, $0, id: id) }) {
                    body = node(for: content, depth: depth + 1, labelling: false)
                }
                let mentions = !read(rule.mentionsMe, on: element, depth: depth, id: id, profile: profile).text.isEmpty
                let message = ChatAdapter.Message(chat: chatName, kind: chatKind, from: sender, mentionsMe: mentions,
                                                  time: time, text: "")
                var parts = [chatMessage(message, body: body)]
                // Your reaction to it, as a short reply from you.
                let reaction = read(rule.myReaction, on: element, depth: depth, id: id, profile: profile).text
                if !reaction.isEmpty {
                    func gather(_ n: AXNode) -> [String] { n.role == "AXStaticText" ? [n.text] : n.children.flatMap(gather) }
                    var quoted = message
                    quoted.text = body.map { gather($0).joined(separator: " ") } ?? ""
                    parts.append(chatMessage(ChatAdapter.reaction(reaction, to: quoted)))
                }
                return AXNode(role: "AXGroup", children: parts + [Self.page])

            case .messageList:
                return messageList(rule, of: profile, element: element, depth: depth)

            case .reactionList:
                var group = AXNode(role: "AXGroup")
                for row in element.children() {
                    let chat = read(rule.rowChat, on: row, depth: depth + 1, profile: profile).text
                    let label = read(rule.rowLabel, on: row, depth: depth + 1, profile: profile).text
                    guard !chat.isEmpty, let r = Self.reaction(label, rule.reactions ?? []) else { continue }
                    group.children.append(chatMessage(ChatAdapter.listReaction(emoji: r.emoji, quote: r.quote, chat: chat)))
                }
                group.children.append(Self.page)
                return group

            case .line:
                let (text, groups) = read(rule.text, on: element, depth: depth, profile: profile)
                guard !text.isEmpty, let template = rule.line else { return nil }
                var line = template
                for (name, value) in groups { line = line.replacingOccurrences(of: "{\(name)}", with: value) }
                chars += line.count
                return Self.lineNode(line)

            case .emailHeader:
                // A section named after the subject, the header's first plain line.
                var header = Self.section(MailSection.name(subject: ""))
                var subjectFound = false
                for child in element.children() {
                    guard let built = node(for: child, depth: depth + 1) else { continue }
                    if !subjectFound, built.role == "AXStaticText", !built.text.isEmpty {
                        header.text = MailSection.name(subject: built.text)
                        subjectFound = true
                        continue
                    }
                    header.children.append(built)
                }
                return header

            case .emailSubject:
                mailSubject = read(rule.text, on: element, depth: depth, profile: profile).text
                return nil

            case .emailSection:
                mailCount += 1
                let subject = read(rule.text, on: element, depth: depth, profile: profile).text
                return Self.section(MailSection.name(subject: subject, index: mailCount))

            case .emailMessage, .emailBody:
                if rule.action == .emailMessage { mailCount += 1 }
                var body = AXNode(role: "AXGroup")
                let wasInBody = inMailBody
                inMailBody = true
                for child in element.children() {
                    if let built = node(for: child, depth: depth + 1) { body.children.append(built) }
                }
                inMailBody = wasInBody
                if rule.action == .emailMessage {
                    body = Self.section(MailSection.name(subject: mailSubject, index: mailCount), children: body.children)
                }
                return AXNode(role: "AXGroup", children: [body, Self.page])
            }
        }

        /// A list whose items each describe one message in a single label (WhatsApp): the label is
        /// read with the rule's parse steps, and your reactions are placed after the message they are on.
        private mutating func messageList(_ rule: AppProfile.Rule, of profile: AppProfile, element: E, depth: Int) -> AXNode {
            let chat = read(rule.chat, on: element, depth: depth, profile: profile).text
            var parsed: [ParsedMessage] = []
            /// Your reactions, each with the index of the message it is on.
            var reactions: [(index: Int, emoji: String)] = []
            let item = rule.item ?? AppProfile.Matcher()
            for child in element.children() {
                let label = read(rule.label, on: child, depth: depth + 1, profile: profile).text
                let isItem = matches(item, child)
                // "You reacted ❤️ to "…"": on the message's own label, or on its own nearby.
                let labels = [label] + child.children().map { read(rule.label, on: $0, depth: depth + 2, profile: profile).text }
                for text in labels {
                    guard let r = Self.reaction(text, rule.reactions ?? []) else { continue }
                    let quoted = parsed.lastIndex { !r.quote.isEmpty && $0.text.hasPrefix(String(r.quote.prefix(20))) }
                    let index = quoted ?? (isItem ? parsed.count : parsed.count - 1)
                    if index >= 0 { reactions.append((index, r.emoji)) }
                }
                guard isItem, let m = Self.parseLabel(label, rule) else { continue }
                parsed.append(m)
            }
            let kind = ChatAdapter.kind(chat: chat, senders: parsed.compactMap { $0.mine ? nil : ($0.from ?? chat) },
                                        anyInGroup: parsed.contains { $0.inGroup })
            var group = AXNode(role: "AXGroup")
            for (index, m) in parsed.enumerated() {
                let message = ChatAdapter.Message(chat: chat, kind: kind, from: m.mine ? "me" : (m.from ?? chat), time: m.time, text: m.text)
                group.children.append(chatMessage(message))
                for r in reactions where r.index == index && !m.mine {
                    group.children.append(chatMessage(ChatAdapter.reaction(r.emoji, to: message)))
                }
            }
            group.children.append(Self.page)
            return group
        }

        static func reaction(_ text: String, _ patterns: [ProfilePattern]) -> (emoji: String, quote: String)? {
            for pattern in patterns {
                guard let g = pattern.match(text) else { continue }
                let emoji = (g["emoji"] ?? "").trimmingCharacters(in: .whitespaces)
                if !emoji.isEmpty { return (emoji, g["quote"] ?? "") }
            }
            return nil
        }

        static func parseLabel(_ label: String, _ rule: AppProfile.Rule) -> ParsedMessage? {
            ParsedMessage.parse(label, steps: rule.parse ?? [], plainKinds: rule.plainKinds)
        }

        /// All the text under an element, in order, on one line.
        mutating func plainText(of element: E, depth: Int) -> String {
            guard let built = node(for: element, depth: depth + 1, labelling: false) else { return "" }
            func gather(_ node: AXNode) -> [String] {
                node.role == "AXStaticText" ? [node.text] : node.children.flatMap(gather)
            }
            return gather(built).joined(separator: " ")
        }

        /// `labelling` is off while reading the inside of a part that is itself being labelled.
        mutating func node(for element: E, depth: Int, labelling: Bool = true) -> AXNode? {
            guard depth <= limits.maxDepth, nodes < limits.maxNodes, chars < limits.maxChars else { return nil }
            nodes += 1

            guard let (role, subrole) = element.roleAndSubrole() else { return nil }

            // Never ask for the contents of a password field.
            if PrivacyPolicy.isSecureField(role: role, subrole: subrole) { return nil }

            if labelling, let labelled = profileNode(element, role: role, depth: depth) { return labelled }

            var node = AXNode(role: role, subrole: subrole)
            if limits.skipFocusedInput, role == "AXTextArea" || role == "AXTextField", element.isFocused() {
                // An editor's terminal has focus (its hidden input): the terminal around it is marked (SCR-69).
                if let app = limits.app, AXCapture.editorBundles.contains(app), element.classes().contains("xterm-helper-textarea") {
                    var input = AXNode(role: "AXGroup")
                    input.terminalInput = true
                    return input
                }
                return nil
            }
            if AXCapture.textRoles.contains(role) {
                var value = element.string("AXValue") ?? ""
                if value.count > limits.maxFieldChars { value = String(value.suffix(limits.maxFieldChars)) }
                node.text = value
                chars += value.count
                return node // text elements have no children worth reading
            }

            if role == "AXWebArea" {
                if url == nil, let found = element.url(), let scheme = found.scheme, scheme.hasPrefix("http") {
                    url = found.absoluteString
                    // A site with its own profile (Gmail, Outlook on the web) is labelled from here on.
                    for profile in limits.profiles where profile.match.matches(url: url) && !profiles.contains(profile) {
                        profiles.append(profile)
                    }
                }
                if pageTitle == nil, let title = element.string("AXTitle"), !title.isEmpty {
                    pageTitle = title
                }
            }
            // Web pages mark up self-contained pieces, such as each chat message, as articles.
            if subrole == "AXDocumentArticle" {
                node.text = element.string("AXDescription") ?? ""
            }
            // A link or button in the middle of a sentence (a file link, say) carries its words in its title.
            if AXCapture.titledRoles.contains(role) {
                node.text = element.string("AXTitle") ?? ""
            }
            // In an email's body, keep where a link points, so following it can be noticed later.
            // Nowhere else: on other pages a link's target is not something to keep.
            if role == "AXLink", inMailBody || (insideWebArea && profiles.contains { $0.linkTargets == .webArea }) {
                node.url = AXCapture.mailLinkTarget(element.url())
            } else if role == "AXLink", insideWebArea, insideMain, profiles.isEmpty,
                      pageLinks < AXCapture.maxPageLinkTargets,
                      let target = AXCapture.pageLinkTarget(element.url(), page: url) {
                // In the main content of a page no chat or email profile labels (SCR-68): where a pull
                // request, issue or deploy link points, without its query.
                node.url = target
                pageLinks += 1
            }
            // A checkbox, radio button or switch: its state, and its label if it has one (SCR-68).
            if AXCapture.toggleRoles.contains(role) {
                node.state = AXCapture.stateMark(role: role, subrole: subrole, value: element.number("AXValue"))
                let title = element.string("AXTitle") ?? ""
                node.text = title.isEmpty ? (element.string("AXDescription") ?? "") : title
                chars += node.text.count
            }

            let wasInWebArea = insideWebArea
            let wasInMain = insideMain
            if role == "AXWebArea" { insideWebArea = true }
            if subrole == "AXLandmarkMain" { insideMain = true }
            defer { insideWebArea = wasInWebArea; insideMain = wasInMain }
            node.children = element.children().compactMap { self.node(for: $0, depth: depth + 1) }
            // The nearest element around a focused terminal input that holds text is the terminal:
            // its lines go under "⟦Terminal⟧", and what follows it under "⟦Page⟧".
            if node.children.contains(where: \.terminalInput) {
                if AXCapture.hasText(node) {
                    return AXNode(role: "AXGroup", children: [Self.section(AXCapture.terminalSection, children: [node]), Self.page])
                }
                node.terminalInput = true
            }
            return node
        }
    }

    static func hasText(_ node: AXNode) -> Bool {
        node.children.contains { (["AXStaticText", "AXTextArea", "AXTextField"].contains($0.role) && !$0.text.isEmpty) || hasText($0) }
    }

    private static func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
        var value: AnyObject?
        return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
    }

    // MARK: Tree → lines (pure)

    /// Flatten a tree into lines of text, one per paragraph or list item.
    ///
    /// - Inline pieces (bold, links, inline code) are joined into the line of the
    ///   block they sit in; inline code is wrapped in backticks so its exact
    ///   boundaries survive.
    /// - List markers ("1. ", "• ") are kept. A list item's first line is indented
    ///   two spaces per level of nesting; anything else inside the item (further
    ///   paragraphs, code) is indented one level deeper, so it reads as belonging
    ///   to the item.
    static func lines(from root: AXNode) -> [String] {
        var out = LineBuilder()
        out.visit(root)
        out.flush()
        return out.lines
    }

    private struct LineBuilder {
        var lines: [String] = []
        private var buffer = ""
        /// True while the buffer holds only a list marker, waiting for the item's text.
        private var markerOnly = false
        /// True if the line being built began with a list marker.
        private var startsWithMarker = false
        private var listDepth = 0
        private let maxLineLength = 2_000
        private let maxInlineTitle = 80

        mutating func visit(_ node: AXNode) {
            switch node.role {
            case "AXStaticText":
                appendInline(node.text)
            case "AXListMarker":
                flush()
                buffer = node.text
                markerOnly = true
                startsWithMarker = true
            case "AXTextArea", "AXTextField":
                flush()
                // Keep indentation: terminals wrap long lines with leading spaces.
                for line in node.text.split(whereSeparator: \.isNewline) {
                    emit(String(line).replacingOccurrences(of: "\t", with: "    "), verbatim: true)
                }
            case "AXList":
                flush()
                listDepth += 1
                node.children.forEach { visit($0) }
                flush()
                listDepth -= 1
            case "AXCheckBox", "AXRadioButton", "AXSwitch":
                toggle(node)
            case "AXLink", "AXButton":
                let hasText = Self.containsText(node)
                defer { if let url = node.url { showTarget(url) } }
                if node.role == "AXLink", hasText {
                    node.children.forEach { visit($0) }
                } else if !hasText, isMidLine, !node.text.isEmpty, node.text.count <= maxInlineTitle,
                          !node.text.contains(where: \.isNewline) {
                    // e.g. "…remove the line from [.env]." where the file link is a button.
                    if buffer.last?.isWhitespace == false { buffer += " " }
                    buffer += node.text
                } else {
                    visitBlock(node)
                }
            default:
                if node.subrole == "AXDocumentArticle" {
                    flush()
                    emit(AXCapture.sectionLine(node.text), verbatim: true)
                    visitBlock(node)
                } else if node.role == "AXGroup", node.subrole == "AXCodeStyleGroup" {
                    let code = Self.plainText(node)
                    if code.contains(where: \.isNewline) {
                        visitBlock(node) // a code block: one line per line of code
                    } else if !code.trimmingCharacters(in: .whitespaces).isEmpty {
                        appendInline("`\(code)`", isCode: true)
                    }
                } else if node.role == "AXGroup", node.subrole.hasSuffix("StyleGroup") {
                    node.children.forEach { visit($0) }
                } else {
                    visitBlock(node)
                }
            }
        }

        /// "[x] Approve 4410": a control's state before its label. A control with no label of its
        /// own (a task list's box) is put before the text that follows it, like a list marker.
        private mutating func toggle(_ node: AXNode) {
            guard let mark = node.state else { return visitBlock(node) }
            let label = node.text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
            if !label.isEmpty, label.count <= 200 {
                if markerOnly {
                    if buffer.last?.isWhitespace == false { buffer += " " }
                    buffer += "\(mark) \(label)"
                    markerOnly = false
                } else {
                    flush()
                    buffer = "\(mark) \(label)"
                    startsWithMarker = true
                }
                flush()
            } else if isMidLine {
                buffer += " \(mark)"
                node.children.forEach { visit($0) }
            } else {
                if markerOnly {
                    if buffer.last?.isWhitespace == false { buffer += " " }
                    buffer += "\(mark) "
                } else {
                    flush()
                    buffer = "\(mark) "
                    startsWithMarker = true
                }
                markerOnly = true
                node.children.forEach { visit($0) }
            }
        }

        /// "Approve ⟨https://…⟩": a link's target after its words, unless its words are the address.
        private mutating func showTarget(_ url: String) {
            if buffer.contains(url) { return }
            if buffer.allSatisfy(\.isWhitespace) {
                emit("⟨\(url)⟩", verbatim: true)
            } else {
                buffer += " ⟨\(url)⟩"
            }
        }

        private mutating func visitBlock(_ node: AXNode) {
            flush()
            node.children.forEach { visit($0) }
            flush()
        }

        private var isMidLine: Bool {
            !markerOnly && !buffer.allSatisfy(\.isWhitespace)
        }

        private static func containsText(_ node: AXNode) -> Bool {
            node.children.contains { ($0.role == "AXStaticText" && !$0.text.isEmpty) || containsText($0) }
        }

        private static func plainText(_ node: AXNode) -> String {
            node.role == "AXStaticText" ? node.text : node.children.map(plainText).joined()
        }

        private mutating func appendInline(_ text: String, isCode: Bool = false) {
            let parts = text.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline)
            for (index, part) in parts.enumerated() {
                if index > 0 { flush() }
                guard !part.isEmpty else { continue }
                // A bold lead-in followed by a soft line break arrives as two elements
                // with nothing between them ("Check the values" + "Scroll down…").
                // Put the line break back.
                if !isCode, isSoftBreak(before: part) { flush() }
                buffer += part
                if !part.allSatisfy(\.isWhitespace) { markerOnly = false }
            }
        }

        private func isSoftBreak(before part: Substring) -> Bool {
            guard isMidLine, let last = buffer.last, let first = part.first, first.isUppercase else { return false }
            return last.isLowercase || ".:!?)".contains(last)
        }

        /// End the current line. A lone list marker is kept open, because the
        /// item's text may sit in a nested paragraph.
        mutating func flush() {
            guard !markerOnly else { return }
            let line = buffer
            buffer = ""
            emit(line, verbatim: false)
            startsWithMarker = false
        }

        private mutating func emit(_ raw: String, verbatim: Bool) {
            var line = raw
            if verbatim {
                while line.last?.isWhitespace == true { line.removeLast() }
            } else {
                line = line.split(whereSeparator: \.isWhitespace).joined(separator: " ")
                // Item lines sit at their list's level; other lines in a list belong to an item.
                let level = startsWithMarker ? listDepth - 1 : listDepth
                if !line.isEmpty, level > 0 { line = String(repeating: "  ", count: level) + line }
            }
            guard !line.allSatisfy(\.isWhitespace) else { return }
            lines.append(String(line.prefix(maxLineLength)))
        }
    }
}
