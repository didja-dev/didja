import Foundation

/// How Didja reads one app or site: which elements of its window are a chat message, its sender,
/// its time, an email's header, and so on. Profiles are data (`profiles/*.json` in the repository,
/// bundled into the app), so supporting a new app needs no Swift.
///
/// A profile can only label what the window walk is already reading. It cannot reach another app,
/// read a secure field or the draft you are typing, turn off the exclude list, make a network call
/// or run code: the walk checks all of that before any rule is applied, and every rule is one of
/// the fixed kinds below. Patterns are checked when the profile loads (`ProfilePattern`).
struct AppProfile: Decodable, Equatable {
    var id: String
    var name: String
    var kind: Kind
    /// "builtIn" for the profiles the maintainer wrote; "community" ones say so in the app, and
    /// "communityNew" ones are new in this release.
    var status: Status?
    /// What the app is and how its window is laid out, for whoever reads the profile.
    var about: String?
    var match: Match
    /// Where a link's target is kept: in an email's body, or anywhere in a web area (Outlook for Mac,
    /// whose email body is one).
    var linkTargets: LinkTargets?
    /// Remove the invisible left-to-right marks some apps put around their labels.
    var stripBidiMarks: Bool?
    var rules: [Rule]

    var isCommunity: Bool { status == .community || status == .communityNew }

    /// What the app tells people about a profile.
    struct Summary: Equatable {
        var name: String
        var kind: Kind
        var status: Status
    }
    var summary: Summary { Summary(name: name, kind: kind, status: status ?? .builtIn) }

    enum Kind: String, Decodable { case chat, email }
    enum Status: String, Decodable { case builtIn, community, communityNew }
    enum LinkTargets: String, Decodable { case emailBody, webArea }

    struct Match: Decodable, Equatable {
        var bundleIds: [String] = []
        /// Page addresses starting with one of these (https only).
        var urlPrefixes: [String] = []
        /// Pages on exactly one of these hosts, over https.
        var hosts: [String] = []

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            bundleIds = try c.decodeIfPresent([String].self, forKey: .bundleIds) ?? []
            urlPrefixes = try c.decodeIfPresent([String].self, forKey: .urlPrefixes) ?? []
            hosts = try c.decodeIfPresent([String].self, forKey: .hosts) ?? []
        }
        enum CodingKeys: String, CodingKey { case bundleIds, urlPrefixes, hosts }

        func matches(bundleID: String?) -> Bool {
            guard let bundleID else { return false }
            return bundleIds.contains(bundleID)
        }

        func matches(url: String?) -> Bool {
            guard let url else { return false }
            if urlPrefixes.contains(where: { url.hasPrefix($0) }) { return true }
            guard !hosts.isEmpty, let parsed = URL(string: url), parsed.scheme == "https", let host = parsed.host else { return false }
            return hosts.contains(host.lowercased())
        }
    }

    enum Action: String, Decodable {
        /// Names the open chat (and its kind); the element is then read as usual.
        case chatName
        /// One chat message: sender, time and body from the parts under it.
        case message
        /// A list whose items are messages described entirely by one label each (WhatsApp).
        case messageList
        /// A list of chats whose rows show your own reactions (WhatsApp's chat list).
        case reactionList
        /// Left out.
        case skip
        /// One labelled line, from a template: "From: {v}".
        case line
        /// An email's header block: a section named after its first line, the subject (Outlook for Mac).
        case emailHeader
        /// Remembers the open conversation's subject; the element is then read as usual (Gmail).
        case emailSubject
        /// Starts a numbered email section named after this element's text (Outlook on the web).
        case emailSection
        /// One email of a conversation: a numbered section holding its body (Gmail).
        case emailMessage
        /// An email's body, ended by a page marker (Outlook on the web).
        case emailBody
    }

    struct Rule: Decodable, Equatable {
        var action: Action
        var matcher: Matcher
        /// message: the element's own id after this prefix, used as `$id` in the matchers below it.
        var idAfter: String?
        /// message: a message that also matches this is left out (a system notice).
        var unless: Matcher?
        /// chatName, messageList: the chat's name.
        var chat: Source?
        /// chatName: the chat is a group when the element matches this, else direct.
        var groupIf: Matcher?
        var from: Source?
        var time: Source?
        /// message: the element holding the message's text, read as usual.
        var body: Matcher?
        /// message: non-empty when the message mentions you.
        var mentionsMe: Source?
        /// message: the name of your own reaction to it.
        var myReaction: Source?
        /// messageList: which children are messages, and their label.
        var item: Matcher?
        var label: Source?
        var parse: [ParseStep]?
        /// messageList: a message whose `kind` field is not one of these is media: "[photo] …".
        var plainKinds: [String]?
        /// messageList, reactionList: your reaction, with `emoji` and `quote` groups.
        var reactions: [ProfilePattern]?
        /// reactionList: the row's chat name and the label holding the reaction.
        var rowChat: Source?
        var rowLabel: Source?
        /// line, emailSubject, emailSection: the text.
        var text: Source?
        /// line: the template, filled from the text's pattern groups ({v} is the whole text).
        var line: String?

        enum CodingKeys: String, CodingKey {
            case action = "is", matcher = "where", idAfter, unless, chat, groupIf, from, time, body, mentionsMe, myReaction,
                 item, label, parse, plainKinds, reactions, rowChat, rowLabel, text, line
        }
    }

    /// Which elements a rule applies to. Every condition given must hold.
    struct Matcher: Decodable, Equatable {
        var role: [String]?
        var identifier: StringTest?
        var dom: StringTest?
        /// Any of these class names.
        var classes: [String]?
        var classPrefix: String?

        enum CodingKeys: String, CodingKey { case role, identifier, dom, classes = "class", classPrefix }
    }

    /// A string equal to a value, or with a given start, end or part. `$id` stands for the id of
    /// the message being read.
    struct StringTest: Decodable, Equatable {
        var equals: String?
        var prefix: String?
        var suffix: String?
        var contains: [String]?

        init(from decoder: Decoder) throws {
            if let plain = try? decoder.singleValueContainer().decode(String.self) {
                equals = plain
                return
            }
            let c = try decoder.container(keyedBy: CodingKeys.self)
            equals = try c.decodeIfPresent(String.self, forKey: .equals)
            prefix = try c.decodeIfPresent(String.self, forKey: .prefix)
            suffix = try c.decodeIfPresent(String.self, forKey: .suffix)
            contains = try c.decodeIfPresent([String].self, forKey: .contains)
        }
        enum CodingKeys: String, CodingKey { case equals, prefix, suffix, contains }

        func test(_ value: String?, id: String?) -> Bool {
            guard let value else { return false }
            func fill(_ s: String) -> String { id.map { s.replacingOccurrences(of: "$id", with: $0) } ?? s }
            if let equals, value != fill(equals) { return false }
            if let prefix, !value.hasPrefix(fill(prefix)) { return false }
            if let suffix, !value.hasSuffix(fill(suffix)) { return false }
            if let contains, !contains.contains(where: { value.contains(fill($0)) }) { return false }
            return true
        }
    }

    enum Attribute: String, Decodable {
        case title, description, value, help
        /// All the text under the element, read as usual, on one line.
        case text

        var axName: String? {
            switch self {
            case .title: "AXTitle"
            case .description: "AXDescription"
            case .value: "AXValue"
            case .help: "AXHelp"
            case .text: nil
            }
        }
    }

    /// Where a piece of text comes from, and how it is cleaned. Written as a list, the first that
    /// gives any text wins; as a plain string, it names the attribute.
    struct Source: Decodable, Equatable {
        var steps: [SourceStep]

        init(from decoder: Decoder) throws {
            if let list = try? decoder.singleValueContainer().decode([SourceStep].self) {
                steps = list
            } else {
                steps = [try SourceStep(from: decoder)]
            }
        }
    }

    struct SourceStep: Decodable, Equatable {
        /// Read from the first element under this one (itself included, up to 12 levels) that matches.
        var of: Matcher?
        /// With `of`: every match, each read once, joined with `join`.
        var all = false
        var join = ", "
        /// The attributes to read, the first with any text wins.
        var attr: [Attribute] = [.text]
        /// Collapse runs of white space into one space.
        var squash = false
        /// Remove a label such as "From: " (in whatever language) this many times, when its colon is
        /// within the first 14 characters.
        var dropLabel = 0
        /// Keep only what matches; its group `v` if it has one.
        var pattern: ProfilePattern?
        /// Characters to trim from both ends, besides white space.
        var trim: String?
        /// No text when it contains any of these (ignoring case).
        var reject: [String]?
        /// "1" when the text contains this (ignoring case), else nothing.
        var contains: String?

        init(from decoder: Decoder) throws {
            if let plain = try? decoder.singleValueContainer().decode(Attribute.self) {
                attr = [plain]
                return
            }
            let c = try decoder.container(keyedBy: CodingKeys.self)
            of = try c.decodeIfPresent(Matcher.self, forKey: .of)
            all = try c.decodeIfPresent(Bool.self, forKey: .all) ?? false
            join = try c.decodeIfPresent(String.self, forKey: .join) ?? ", "
            if let one = try? c.decode(Attribute.self, forKey: .attr) {
                attr = [one]
            } else {
                attr = try c.decodeIfPresent([Attribute].self, forKey: .attr) ?? [.text]
            }
            squash = try c.decodeIfPresent(Bool.self, forKey: .squash) ?? false
            dropLabel = min(try c.decodeIfPresent(Int.self, forKey: .dropLabel) ?? 0, 3)
            pattern = try c.decodeIfPresent(ProfilePattern.self, forKey: .pattern)
            trim = try c.decodeIfPresent(String.self, forKey: .trim)
            reject = try c.decodeIfPresent([String].self, forKey: .reject)
            contains = try c.decodeIfPresent(String.self, forKey: .contains)
        }
        enum CodingKeys: String, CodingKey { case of, all, join, attr, squash, dropLabel, pattern, trim, reject, contains }
    }

    /// One step of reading a message's label: match `field` against `pattern`; its named groups
    /// become fields, and `set` sets more. A step whose field is empty or does not match is passed
    /// over, unless it is `required`, which drops the label. `unless` skips the step when that field
    /// already has a value.
    struct ParseStep: Decodable, Equatable {
        var field: String
        var pattern: ProfilePattern
        var set: [String: String]?
        var unless: String?
        var required: Bool?
    }

    // MARK: Checking

    enum Invalid: Error, Equatable, CustomStringConvertible {
        case tooBig, noRules, tooManyRules, noMatch, badID(String), missing(rule: Int, field: String), badPattern(String), badTemplate(String)
        var description: String {
            switch self {
            case .tooBig: "the profile is over 64 KB"
            case .noRules: "the profile has no rules"
            case .tooManyRules: "the profile has more than 60 rules"
            case .noMatch: "the profile matches no app or site"
            case .badID(let id): "the id \(id) must be lowercase letters, digits and dashes"
            case .missing(let rule, let field): "rule \(rule + 1) needs \(field)"
            case .badPattern(let why): why
            case .badTemplate(let line): "the line template \(line) uses a group its pattern does not have"
            }
        }
    }

    /// Parse and check a profile. Patterns are checked as they are read.
    static func load(_ data: Data) throws -> AppProfile {
        guard data.count <= 64 * 1024 else { throw Invalid.tooBig }
        let profile = try JSONDecoder().decode(AppProfile.self, from: data)
        try profile.check()
        return profile
    }

    func check() throws {
        guard id.range(of: "^[a-z0-9-]{1,40}$", options: .regularExpression) != nil else { throw Invalid.badID(id) }
        guard !rules.isEmpty else { throw Invalid.noRules }
        guard rules.count <= 60 else { throw Invalid.tooManyRules }
        guard !match.bundleIds.isEmpty || !match.hosts.isEmpty || !match.urlPrefixes.isEmpty else { throw Invalid.noMatch }
        for prefix in match.urlPrefixes where !prefix.hasPrefix("https://") || prefix.count < 12 {
            throw Invalid.badPattern("a page address must start with https:// and name its site: \(prefix)")
        }
        for (i, rule) in rules.enumerated() {
            func need(_ value: Any?, _ field: String) throws { if value == nil { throw Invalid.missing(rule: i, field: field) } }
            switch rule.action {
            case .chatName: try need(rule.chat, "chat")
            case .message: try need(rule.from, "from"); try need(rule.body, "body")
            case .messageList:
                try need(rule.item, "item"); try need(rule.label, "label"); try need(rule.parse, "parse")
            case .reactionList: try need(rule.rowChat, "rowChat"); try need(rule.rowLabel, "rowLabel"); try need(rule.reactions, "reactions")
            case .line:
                try need(rule.text, "text"); try need(rule.line, "line")
                let groups = Set(rule.text?.steps.compactMap(\.pattern).flatMap(\.groups) ?? []).union(["v"])
                let used = ProfilePattern.placeholders(in: rule.line ?? "")
                guard used.isSubset(of: groups) else { throw Invalid.badTemplate(rule.line ?? "") }
            case .emailSubject, .emailSection: try need(rule.text, "text")
            case .skip, .emailHeader, .emailMessage, .emailBody: break
            }
        }
    }
}

/// A regular expression from a profile. Kept small and simple so a bad one cannot stall capture:
/// at most 300 characters, no back-references or look-behind, and no repeated group that itself
/// repeats (the shape behind runaway matching). Text longer than 2,000 characters is cut before
/// it is matched.
struct ProfilePattern: Decodable, Equatable {
    let source: String
    let regex: NSRegularExpression
    let groups: [String]

    static let maxInput = 2_000

    init(_ source: String) throws {
        if let why = Self.unsafe(source) { throw AppProfile.Invalid.badPattern("\(why): \(source)") }
        self.source = source
        do { regex = try NSRegularExpression(pattern: source) } catch {
            throw AppProfile.Invalid.badPattern("not a valid pattern: \(source)")
        }
        groups = Self.names(in: source)
    }

    init(from decoder: Decoder) throws {
        try self.init(try decoder.singleValueContainer().decode(String.self))
    }

    static func == (a: ProfilePattern, b: ProfilePattern) -> Bool { a.source == b.source }

    /// Why a pattern is refused, or nil.
    static func unsafe(_ p: String) -> String? {
        if p.count > 300 { return "a pattern is over 300 characters" }
        if p.range(of: #"\\[1-9]|\\k<"#, options: .regularExpression) != nil { return "a pattern may not refer back to a group" }
        if p.contains("(?<=") || p.contains("(?<!") { return "a pattern may not look behind" }
        // A quantified group whose inside also repeats: "(a+)+", "(?:x*y)*", "(a|b+){2,}".
        var stack: [Bool] = [] // whether each open group has a quantifier inside
        var escaped = false
        var inClass = false
        let chars = Array(p)
        var i = 0
        while i < chars.count {
            let c = chars[i]
            defer { i += 1 }
            if escaped { escaped = false; continue }
            if c == "\\" { escaped = true; continue }
            if inClass { if c == "]" { inClass = false }; continue }
            switch c {
            case "[": inClass = true
            case "(": stack.append(false)
            case ")":
                let repeatsInside = stack.popLast() ?? false
                let next = i + 1 < chars.count ? chars[i + 1] : " "
                let openBrace = next == "{" && (chars[(i + 1)...].firstIndex(of: "}").map { String(chars[(i + 1)...$0]).contains(",") } ?? false)
                if repeatsInside, next == "*" || next == "+" || openBrace { return "a repeated group may not repeat inside" }
                if repeatsInside || next == "*" || next == "+" || next == "{", !stack.isEmpty { stack[stack.count - 1] = true }
            case "*", "+": if !stack.isEmpty { stack[stack.count - 1] = true }
            case "{":
                if !stack.isEmpty, let close = chars[i...].firstIndex(of: "}"), String(chars[i...close]).contains(",") {
                    stack[stack.count - 1] = true
                }
            default: break
            }
        }
        return nil
    }

    static func names(in p: String) -> [String] {
        guard let r = try? NSRegularExpression(pattern: #"\(\?<([A-Za-z][A-Za-z0-9]*)>"#) else { return [] }
        let ns = p as NSString
        return r.matches(in: p, range: NSRange(location: 0, length: ns.length)).map { ns.substring(with: $0.range(at: 1)) }
    }

    static func placeholders(in template: String) -> Set<String> {
        guard let r = try? NSRegularExpression(pattern: #"\{([A-Za-z][A-Za-z0-9]*)\}"#) else { return [] }
        let ns = template as NSString
        return Set(r.matches(in: template, range: NSRange(location: 0, length: ns.length)).map { ns.substring(with: $0.range(at: 1)) })
    }

    /// The first match: the whole of it under "v" (unless the pattern has its own `v`), and each named group.
    func match(_ text: String) -> [String: String]? {
        let cut = text.count > Self.maxInput ? String(text.prefix(Self.maxInput)) : text
        let ns = cut as NSString
        guard let m = regex.firstMatch(in: cut, range: NSRange(location: 0, length: ns.length)) else { return nil }
        var out = ["v": ns.substring(with: m.range)]
        for name in groups {
            let r = m.range(withName: name)
            if r.location != NSNotFound { out[name] = ns.substring(with: r) }
        }
        return out
    }
}

/// The profiles that come with the app, from its Resources/profiles folder.
enum AppProfiles {
    static let builtIn: [AppProfile] = load(from: Bundle.main.resourceURL?.appendingPathComponent("profiles"))

    /// Every valid profile in a folder; a profile that fails its checks is left out and logged.
    static func load(from folder: URL?) -> [AppProfile] {
        guard let folder, let names = try? FileManager.default.contentsOfDirectory(atPath: folder.path) else { return [] }
        return names.filter { $0.hasSuffix(".json") }.sorted().compactMap { name in
            do {
                return try AppProfile.load(Data(contentsOf: folder.appendingPathComponent(name)))
            } catch {
                NSLog("Didja: the profile %@ was not loaded: %@", name, String(describing: error))
                return nil
            }
        }
    }

    /// The profile for an app, by its bundle id.
    static func forApp(_ bundleID: String?, in profiles: [AppProfile] = builtIn) -> AppProfile? {
        profiles.first { $0.match.matches(bundleID: bundleID) }
    }
}
