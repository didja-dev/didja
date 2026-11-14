import Foundation

/// What capture is never allowed to read.
///
/// Built-in rules cover password managers, system password prompts and
/// private browsing windows. The user can add apps, window titles and URLs in
/// `~/Library/Application Support/Didja/exclude.json`.
struct PrivacyPolicy {
    /// Bundle-ID prefixes, lowercased. `com.agilebits.onepassword` also covers `com.agilebits.onepassword7`.
    /// Matching by prefix errs on the side of not reading.
    private(set) var deniedBundlePrefixes: [String]
    private(set) var windowPatterns: [NSRegularExpression]
    private(set) var urlPatterns: [NSRegularExpression]

    static let defaultDeniedBundlePrefixes = [
        // Password managers
        "com.1password", "com.agilebits.onepassword", "com.bitwarden", "com.lastpass",
        "com.dashlane", "org.keepassxc", "in.sinew.enpass", "me.proton.pass",
        "com.apple.keychainaccess", "com.apple.passwords",
        // System prompts that ask for credentials
        "com.apple.securityagent", "com.apple.loginwindow",
        "com.apple.localauthentication", "com.apple.authenticationservices",
    ]

    /// Terminals show their whole session in one focused text area, so they are
    /// the one place where the focused text field is still read.
    static let terminalBundleIDs: Set<String> = [
        "com.apple.Terminal", "com.googlecode.iterm2", "com.mitchellh.ghostty", "dev.warp.Warp-Stable",
        "net.kovidgoyal.kitty", "org.alacritty", "com.github.wez.wezterm", "co.zeit.hyper",
    ]

    /// Window titles browsers use for private windows.
    static let privateWindowPatterns = [
        "private browsing", "incognito", "inprivate", "private window",
    ]

    enum LoadError: LocalizedError {
        case malformed(String)
        var errorDescription: String? {
            switch self {
            case .malformed(let why): return "exclude.json is invalid: \(why)"
            }
        }
    }

    private struct UserFile: Decodable {
        var bundleIds: [String]?
        var windowPatterns: [String]?
        var urlPatterns: [String]?
    }

    init(bundleIds: [String] = [], windowPatterns: [String] = [], urlPatterns: [String] = []) throws {
        func compile(_ patterns: [String]) throws -> [NSRegularExpression] {
            try patterns.map { pattern in
                guard !pattern.trimmingCharacters(in: .whitespaces).isEmpty,
                      let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
                else { throw LoadError.malformed("bad pattern \"\(pattern)\"") }
                return regex
            }
        }
        let extra = bundleIds.map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
        guard !extra.contains("") else { throw LoadError.malformed("empty bundle id") }
        deniedBundlePrefixes = Self.defaultDeniedBundlePrefixes + extra
        self.windowPatterns = try compile(Self.privateWindowPatterns + windowPatterns)
        self.urlPatterns = try compile(urlPatterns)
    }

    /// Built-in rules plus the user's file. A missing file is fine; a broken one
    /// throws, and capture must not start without a valid policy.
    static func load(userFile: URL) throws -> PrivacyPolicy {
        guard FileManager.default.fileExists(atPath: userFile.path) else { return try PrivacyPolicy() }
        do {
            let file = try JSONDecoder().decode(UserFile.self, from: Data(contentsOf: userFile))
            return try PrivacyPolicy(
                bundleIds: file.bundleIds ?? [],
                windowPatterns: file.windowPatterns ?? [],
                urlPatterns: file.urlPatterns ?? [])
        } catch let error as LoadError {
            throw error
        } catch {
            throw LoadError.malformed(error.localizedDescription)
        }
    }

    func allowsApp(bundleID: String) -> Bool {
        let id = bundleID.lowercased()
        return !deniedBundlePrefixes.contains { id.hasPrefix($0) }
    }

    func allowsWindow(title: String) -> Bool {
        !Self.matches(windowPatterns, title)
    }

    func allowsURL(_ url: String?) -> Bool {
        guard let url else { return true }
        return !Self.matches(urlPatterns, url)
    }

    /// Password fields. Their value is never requested from the Accessibility API.
    static func isSecureField(role: String, subrole: String) -> Bool {
        subrole == "AXSecureTextField" || role == "AXSecureTextField"
    }

    /// Card and bank-account fields (SCR-94): a text field labelled as one (card number, CVV/CVC,
    /// security code, expiry date, IBAN, routing or account number, sort code), or one whose value is
    /// a card number (13 to 19 digits that pass the Luhn check). Its value is never kept. Only plain
    /// text fields and combo boxes are checked: never a terminal, and never text on the page.
    static func isPaymentField<E: AXElement>(_ element: E, role: String) -> Bool {
        guard paymentFieldRoles.contains(role) else { return false }
        for attribute in ["AXTitle", "AXDescription", "AXHelp", "AXPlaceholderValue", "AXIdentifier", "AXDOMIdentifier"] {
            if let label = element.string(attribute), !label.isEmpty, isPaymentLabel(label) { return true }
        }
        if let value = element.string("AXValue"), looksLikeCardNumber(value) { return true }
        return false
    }

    static let paymentFieldRoles: Set<String> = ["AXTextField", "AXComboBox"]

    private static let paymentLabel = try! NSRegularExpression(
        pattern: #"card[ _-]?(number|num|no\b)|credit[ _-]?card|debit[ _-]?card|\bcc[ _-]?(number|num|csc|cvv|cvc|exp)|\bcvv2?\b|\bcvc2?\b|\bcsc\b|security[ _-]?code|\biban\b|routing[ _-]?number|account[ _-]?number|sort[ _-]?code|expir(y|ation)[ _-]?date|\bmm ?/ ?yy\b|מספר כרטיס|קוד אבטחה|תוקף כרטיס"#,
        options: [.caseInsensitive])

    static func isPaymentLabel(_ text: String) -> Bool {
        paymentLabel.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    /// 13 to 19 digits, spaces or dashes between them, that pass the Luhn check.
    static func looksLikeCardNumber(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, trimmed.allSatisfy({ $0.isASCII && ($0.isNumber || $0 == " " || $0 == "-") }) else { return false }
        let digits = trimmed.compactMap { $0.wholeNumberValue }
        guard (13...19).contains(digits.count) else { return false }
        var sum = 0
        for (index, digit) in digits.reversed().enumerated() {
            if index % 2 == 1 {
                let doubled = digit * 2
                sum += doubled > 9 ? doubled - 9 : doubled
            } else {
                sum += digit
            }
        }
        return sum % 10 == 0
    }

    private static func matches(_ patterns: [NSRegularExpression], _ text: String) -> Bool {
        let range = NSRange(text.startIndex..., in: text)
        return patterns.contains { $0.firstMatch(in: text, range: range) != nil }
    }
}
