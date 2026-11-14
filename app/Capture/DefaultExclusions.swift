import Foundation

/// Sites and apps never read unless you remove them from the exclude list (SCR-94): banks,
/// brokerages, payment checkouts and patient portals. Generic, well-known names only. They are
/// written into `exclude.json` once (`ExcludeList.addDefaultsOnce`) and from then on are ordinary
/// entries there: they apply before anything is read, like anything you add.
///
/// A site covers its subdomains. Developer dashboards where steps are often done are left out on
/// purpose (stripe.com itself is not here, only its hosted checkout and billing pages).
enum DefaultExclusions {
    /// Raise when the list grows: installs that have an older version get the new entries once.
    static let version = 1

    static let sites: [String] = [
        // Banks
        "chase.com", "bankofamerica.com", "wellsfargo.com", "citi.com", "citibank.com", "capitalone.com",
        "usbank.com", "pnc.com", "td.com", "tdbank.com", "ally.com", "discover.com", "americanexpress.com",
        "hsbc.com", "hsbc.co.uk", "barclays.co.uk", "lloydsbank.com", "natwest.com", "santander.co.uk",
        "santander.com", "bnpparibas.com", "deutsche-bank.de", "ing.com", "rbc.com", "scotiabank.com",
        "commbank.com.au", "monzo.com", "revolut.com", "n26.com", "wise.com",
        "bankhapoalim.co.il", "leumi.co.il", "discountbank.co.il", "mizrahi-tefahot.co.il", "fibi.co.il",
        // Brokerages and exchanges
        "schwab.com", "fidelity.com", "vanguard.com", "etrade.com", "robinhood.com", "interactivebrokers.com",
        "coinbase.com", "kraken.com", "binance.com",
        // Payments and checkouts
        "paypal.com", "venmo.com", "checkout.stripe.com", "billing.stripe.com", "pay.google.com",
        "klarna.com", "affirm.com", "afterpay.com",
        // Patient portals and health insurers
        "mychart.com", "kp.org", "myquest.questdiagnostics.com", "patient.labcorp.com", "followmyhealth.com",
        "nhsapp.service.nhs.uk", "clalit.co.il", "maccabi4u.co.il", "meuhedet.co.il", "leumit.co.il",
    ]

    /// Window titles: portals hosted on a hospital's own domain still name themselves in the title.
    static let titleWords: [String] = ["MyChart", "Patient Portal"]

    /// Bundle-ID namespaces of these organisations' apps, matched as prefixes. The trailing dot keeps
    /// a prefix to that organisation's own apps.
    static let bundlePrefixes: [String] = [
        "com.chase.", "com.bankofamerica.", "com.wellsfargo.", "com.capitalone.", "com.americanexpress.",
        "com.paypal.", "com.venmo.", "com.robinhood.", "com.schwab.", "com.fidelity.", "com.vanguard.",
        "com.coinbase.", "com.revolut.", "com.monzo.", "com.transferwise.",
    ]

    static var urlPatterns: [String] { sites.map(ExcludeList.sitePattern(host:)) }
    static var windowPatterns: [String] { titleWords.map(NSRegularExpression.escapedPattern(for:)) }

    static func isDefault(urlPattern: String) -> Bool { urlPatterns.contains(urlPattern) }
    static func isDefault(windowPattern: String) -> Bool { windowPatterns.contains(windowPattern) }
    static func isDefault(bundleID: String) -> Bool {
        bundlePrefixes.contains { $0.caseInsensitiveCompare(bundleID) == .orderedSame }
    }
}
