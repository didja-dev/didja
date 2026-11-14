import ApplicationServices
import Foundation

/// What capture needs from one element of an app's window. It is either live (`LiveElement`, read
/// through Accessibility) or written down as an outline (`OutlineElement`): the same walk reads
/// both, which is how app profiles are tested against fixtures without the app running.
protocol AXElement {
    /// Role and subrole, or nil if the element has gone.
    func roleAndSubrole() -> (role: String, subrole: String)?
    /// A text attribute: "AXTitle", "AXValue", "AXDescription", "AXHelp", "AXIdentifier", "AXDOMIdentifier".
    func string(_ attribute: String) -> String?
    /// A number attribute, such as a checkbox's "AXValue" (0 off, 1 on, 2 mixed).
    func number(_ attribute: String) -> Int?
    /// A web element's class names.
    func classes() -> [String]
    /// A link's target, or a web area's address.
    func url() -> URL?
    func isFocused() -> Bool
    func children() -> [Self]
}

/// An element of a running app's window.
struct LiveElement: AXElement {
    let ref: AXUIElement

    private func attribute(_ name: String) -> AnyObject? {
        var value: AnyObject?
        return AXUIElementCopyAttributeValue(ref, name as CFString, &value) == .success ? value : nil
    }

    func roleAndSubrole() -> (role: String, subrole: String)? {
        var raw: CFArray?
        guard AXUIElementCopyMultipleAttributeValues(ref, ["AXRole", "AXSubrole"] as CFArray, [], &raw) == .success,
              let head = raw as? [AnyObject], head.count == 2 else { return nil }
        return (head[0] as? String ?? "", head[1] as? String ?? "")
    }

    func string(_ attribute: String) -> String? { self.attribute(attribute) as? String }
    func number(_ attribute: String) -> Int? {
        let value = self.attribute(attribute)
        return (value as? NSNumber)?.intValue ?? (value as? String).flatMap { Int($0) }
    }
    func classes() -> [String] { attribute("AXDOMClassList") as? [String] ?? [] }
    func url() -> URL? { attribute("AXURL") as? URL }
    func isFocused() -> Bool { attribute("AXFocused") as? Bool == true }
    func children() -> [LiveElement] {
        (attribute("AXChildren") as? [AXUIElement] ?? []).map(LiveElement.init)
    }
}

/// An element written down as one line of an outline, indented one space per level:
///
///     AXWindow title="WhatsApp"
///      AXTable id="ChatMessagesTableView" desc="Messages in chat with Sam Carter"
///       AXCell id="WAMessageBubbleTableViewCell" desc="message, Hi, 10:54, Received from Sam Carter"
///
/// Each attribute is `name="…"` with the value as a JSON string: `id` (AXIdentifier), `dom`
/// (AXDOMIdentifier), `class` (class names, space separated), `title`, `value`, `desc`, `help` and
/// `url`. `focused` stands alone. Fixtures and the diagnostics file use this form.
final class OutlineElement: AXElement {
    var role: String
    var subrole: String
    var attributes: [String: String]
    var kids: [OutlineElement]
    var focused: Bool

    init(role: String, subrole: String = "", attributes: [String: String] = [:], children: [OutlineElement] = [], focused: Bool = false) {
        self.role = role
        self.subrole = subrole
        self.attributes = attributes
        self.kids = children
        self.focused = focused
    }

    static let names: [String: String] = [
        "id": "AXIdentifier", "dom": "AXDOMIdentifier", "title": "AXTitle", "value": "AXValue",
        "desc": "AXDescription", "help": "AXHelp",
    ]

    func roleAndSubrole() -> (role: String, subrole: String)? { (role, subrole) }
    func string(_ attribute: String) -> String? {
        Self.names.first { $0.value == attribute }.flatMap { attributes[$0.key] }
    }
    func number(_ attribute: String) -> Int? { string(attribute).flatMap { Int($0) } }
    func classes() -> [String] { (attributes["class"] ?? "").split(separator: " ").map(String.init) }
    func url() -> URL? { attributes["url"].flatMap(URL.init(string:)) }
    func isFocused() -> Bool { focused }
    func children() -> [OutlineElement] { kids }

    enum ParseError: Error, Equatable { case badLine(Int), noRoot }

    /// Parse an outline. Blank lines and lines starting with `#` are skipped.
    static func parse(_ text: String) throws -> OutlineElement {
        var stack: [(depth: Int, node: OutlineElement)] = []
        var root: OutlineElement?
        for (index, raw) in text.split(separator: "\n", omittingEmptySubsequences: false).enumerated() {
            let line = String(raw)
            let body = line.drop { $0 == " " }
            if body.isEmpty || body.hasPrefix("#") { continue }
            let depth = line.count - body.count
            guard let node = parseLine(String(body)) else { throw ParseError.badLine(index + 1) }
            while let last = stack.last, last.depth >= depth { stack.removeLast() }
            if let parent = stack.last {
                guard depth == parent.depth + 1 else { throw ParseError.badLine(index + 1) }
                parent.node.kids.append(node)
            } else {
                guard root == nil, depth == 0 else { throw ParseError.badLine(index + 1) }
                root = node
            }
            stack.append((depth, node))
        }
        guard let root else { throw ParseError.noRoot }
        return root
    }

    private static func parseLine(_ line: String) -> OutlineElement? {
        var rest = Substring(line)
        let head = rest.prefix { $0 != " " }
        rest = rest.dropFirst(head.count)
        let parts = head.split(separator: "/", maxSplits: 1)
        guard let role = parts.first, role.hasPrefix("AX") else { return nil }
        let node = OutlineElement(role: String(role), subrole: parts.count > 1 ? String(parts[1]) : "")
        while true {
            rest = rest.drop { $0 == " " }
            if rest.isEmpty { return node }
            let key = rest.prefix { $0 != "=" && $0 != " " }
            rest = rest.dropFirst(key.count)
            if key == "focused", rest.first != "=" { node.focused = true; continue }
            guard rest.first == "=", Self.names[String(key)] != nil || key == "class" || key == "url" else { return nil }
            rest = rest.dropFirst()
            guard rest.first == "\"" else { return nil }
            // The value runs to the next quote that is not escaped.
            var end = rest.index(after: rest.startIndex)
            var escaped = false
            while end < rest.endIndex {
                let c = rest[end]
                if escaped { escaped = false } else if c == "\\" { escaped = true } else if c == "\"" { break }
                end = rest.index(after: end)
            }
            guard end < rest.endIndex else { return nil }
            let literal = rest[rest.startIndex...end]
            guard let value = try? JSONDecoder().decode(String.self, from: Data(literal.utf8)) else { return nil }
            node.attributes[String(key)] = value
            rest = rest[rest.index(after: end)...]
        }
    }

    /// The element and everything under it as outline text. `transform` may change each value
    /// (given its key: "id", "title"…) before it is written.
    func outline(depth: Int = 0, transform: (String, String) -> String = { $1 }) -> String {
        outlineLines(depth: depth, transform: transform).joined(separator: "\n")
    }

    /// One line per element, in order.
    func outlineLines(depth: Int = 0, transform: (String, String) -> String = { $1 }) -> [String] {
        var line = String(repeating: " ", count: depth) + role + (subrole.isEmpty ? "" : "/\(subrole)")
        for key in ["id", "dom", "class", "title", "value", "desc", "help", "url"] {
            guard let value = attributes[key], !value.isEmpty else { continue }
            line += " \(key)=\(Self.quote(transform(key, value)))"
        }
        if focused { line += " focused" }
        return [line] + kids.flatMap { $0.outlineLines(depth: depth + 1, transform: transform) }
    }

    static func quote(_ s: String) -> String {
        let data = (try? JSONEncoder().encode(s)) ?? Data("\"\"".utf8)
        // JSONEncoder escapes "/" as "\/"; plain is easier to read and parses the same.
        return String(decoding: data, as: UTF8.self).replacingOccurrences(of: "\\/", with: "/")
    }

    /// Copy a live element and what is under it, up to `maxNodes`, in memory. A secure field is
    /// written as its role alone, and the text field you are typing in has no value.
    static func copy<E: AXElement>(_ element: E, maxNodes: Int = 6_000, maxDepth: Int = 80) -> OutlineElement? {
        var budget = maxNodes
        func walk(_ e: E, _ depth: Int) -> OutlineElement? {
            guard depth <= maxDepth, budget > 0, let (role, subrole) = e.roleAndSubrole() else { return nil }
            budget -= 1
            let node = OutlineElement(role: role, subrole: subrole)
            if PrivacyPolicy.isSecureField(role: role, subrole: subrole) || PrivacyPolicy.isPaymentField(e, role: role) { return node }
            node.focused = e.isFocused()
            let isDraft = node.focused && (role == "AXTextArea" || role == "AXTextField")
            for (key, name) in names {
                if isDraft && key == "value" { continue }
                // A checkbox's value is a number: write it down as one.
                guard let value = e.string(name) ?? (key == "value" ? e.number(name).map(String.init) : nil),
                      !value.isEmpty else { continue }
                node.attributes[key] = String(value.prefix(2_000))
            }
            let classes = e.classes()
            if !classes.isEmpty { node.attributes["class"] = classes.joined(separator: " ") }
            if let url = e.url()?.absoluteString, !url.isEmpty { node.attributes["url"] = url }
            node.kids = e.children().compactMap { walk($0, depth + 1) }
            return node
        }
        return walk(element, 0)
    }
}
