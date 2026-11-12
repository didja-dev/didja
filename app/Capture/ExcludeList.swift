import Foundation

/// The user's own additions to what is never read: the contents of
/// `exclude.json`. The built-in rules live in `PrivacyPolicy` and are not in
/// this file, so they cannot be removed by editing it.
struct ExcludeList: Codable, Equatable {
    /// Bundle IDs of apps, matched as prefixes.
    var bundleIds: [String] = []
    /// Regular expressions matched against window titles.
    var windowPatterns: [String] = []
    /// Regular expressions matched against page addresses.
    var urlPatterns: [String] = []

    static let fileName = "exclude.json"

    init(bundleIds: [String] = [], windowPatterns: [String] = [], urlPatterns: [String] = []) {
        self.bundleIds = bundleIds
        self.windowPatterns = windowPatterns
        self.urlPatterns = urlPatterns
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        bundleIds = try values.decodeIfPresent([String].self, forKey: .bundleIds) ?? []
        windowPatterns = try values.decodeIfPresent([String].self, forKey: .windowPatterns) ?? []
        urlPatterns = try values.decodeIfPresent([String].self, forKey: .urlPatterns) ?? []
    }

    /// A missing file is an empty list. A broken one throws: it is never silently replaced.
    static func load(from file: URL) throws -> ExcludeList {
        guard FileManager.default.fileExists(atPath: file.path) else { return ExcludeList() }
        do {
            return try JSONDecoder().decode(ExcludeList.self, from: Data(contentsOf: file))
        } catch {
            throw PrivacyPolicy.LoadError.malformed(error.localizedDescription)
        }
    }

    /// Writes the file, after checking capture would accept it.
    func save(to file: URL) throws {
        _ = try PrivacyPolicy(bundleIds: bundleIds, windowPatterns: windowPatterns, urlPatterns: urlPatterns)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try encoder.encode(self).write(to: file, options: .atomic)
    }

    /// Never read this app. False if there is nothing to add.
    @discardableResult
    mutating func addApp(bundleID: String) -> Bool {
        let id = bundleID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty, !bundleIds.contains(where: { $0.caseInsensitiveCompare(id) == .orderedSame }) else { return false }
        bundleIds.append(id)
        return true
    }

    /// Never read windows whose title contains this text, in any letter case.
    @discardableResult
    mutating func addWindowText(_ text: String) -> Bool {
        let words = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let pattern = NSRegularExpression.escapedPattern(for: words)
        guard !words.isEmpty, !windowPatterns.contains(pattern) else { return false }
        windowPatterns.append(pattern)
        return true
    }

    /// Never read pages on this site or its subdomains. Takes "mybank.com",
    /// "www.mybank.com/login" or a whole address.
    @discardableResult
    mutating func addSite(_ text: String) -> Bool {
        guard let host = Self.host(from: text) else { return false }
        let pattern = Self.sitePattern(host: host)
        guard !urlPatterns.contains(pattern) else { return false }
        urlPatterns.append(pattern)
        return true
    }

    /// "https://www.MyBank.com/login?x=1" → "mybank.com". Nil if it is not a site name.
    static func host(from text: String) -> String? {
        var rest = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if let scheme = rest.range(of: "://") { rest = String(rest[scheme.upperBound...]) }
        rest = String(rest.prefix { !"/?#:".contains($0) })
        if rest.hasPrefix("www.") { rest.removeFirst(4) }
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789.-")
        guard rest.contains("."), !rest.hasPrefix("."), !rest.hasSuffix("."),
              rest.unicodeScalars.allSatisfy(allowed.contains)
        else { return nil }
        return rest
    }

    private static let sitePrefix = "^[a-z][a-z0-9+.-]*://([^/?#]*\\.)?"
    private static let siteSuffix = "([:/?#]|$)"

    /// Matches the host itself and any subdomain, and nothing that merely mentions it.
    static func sitePattern(host: String) -> String {
        sitePrefix + NSRegularExpression.escapedPattern(for: host) + siteSuffix
    }

    /// How a stored pattern is shown: the site name or the plain words where the
    /// pattern is one this screen wrote, the pattern itself where it was written by hand.
    static func label(forURLPattern pattern: String) -> String {
        guard pattern.hasPrefix(sitePrefix), pattern.hasSuffix(siteSuffix) else { return label(forPattern: pattern) }
        return label(forPattern: String(pattern.dropFirst(sitePrefix.count).dropLast(siteSuffix.count)))
    }

    static func label(forPattern pattern: String) -> String {
        let plain = pattern.replacingOccurrences(of: "\\\\(.)", with: "$1", options: .regularExpression)
        return NSRegularExpression.escapedPattern(for: plain) == pattern ? plain : pattern
    }
}
