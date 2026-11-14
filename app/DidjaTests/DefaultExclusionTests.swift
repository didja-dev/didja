import SwiftUI
import XCTest
@testable import Didja

/// SCR-94: banks, payments and patient portals are on the exclude list from the start, and card
/// and bank-account fields are never read. Every outline and value here is made up (the card
/// numbers are the well-known test numbers).
final class DefaultExclusionTests: XCTestCase {
    private func tempFile() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("exclude.json")
    }

    private func lines(_ outline: String) throws -> [String] {
        var limits = AXCapture.Limits()
        limits.app = "com.google.Chrome"
        limits.profiles = Profiles.all
        limits.skipFocusedInput = true
        return AXCapture.read(root: try OutlineElement.parse(outline), title: "", appName: "", limits: limits).lines
    }

    func testANewInstallGetsTheDefaultsAndTheyApplyBeforeReading() throws {
        let file = tempFile()
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        ExcludeList.addDefaultsOnce(to: file)
        let list = try ExcludeList.load(from: file)
        XCTAssertEqual(list.defaultsAdded, DefaultExclusions.version)
        XCTAssertEqual(list.removedDefaults, 0)

        let policy = try PrivacyPolicy.load(userFile: file)
        XCTAssertFalse(policy.allowsURL("https://www.chase.com/personal/accounts"))
        XCTAssertFalse(policy.allowsURL("https://secure.bankofamerica.com/login"))
        XCTAssertFalse(policy.allowsURL("https://www.paypal.com/myaccount/summary"))
        XCTAssertFalse(policy.allowsURL("https://checkout.stripe.com/c/pay/cs_test_x"))
        XCTAssertFalse(policy.allowsURL("https://mychart.com/MyChart/Billing"))
        XCTAssertFalse(policy.allowsWindow(title: "MyChart - Test Results"), "a portal on a hospital's own domain, by its title")
        XCTAssertFalse(policy.allowsApp(bundleID: "com.paypal.app"))
        // Where steps are done is still read: Stripe's dashboard, and pages that only mention a bank.
        XCTAssertTrue(policy.allowsURL("https://dashboard.stripe.com/test/apikeys"))
        XCTAssertTrue(policy.allowsURL("https://example.com/?ref=https://chase.com/"))
        XCTAssertTrue(policy.allowsURL("https://notchase.com/"))
        XCTAssertTrue(policy.allowsApp(bundleID: "com.chasegame.app"), "a prefix covers the organisation's own apps only")
    }

    func testAnExistingListKeepsItsEntriesAndARemovedDefaultStaysRemoved() throws {
        let file = tempFile()
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        var mine = ExcludeList(bundleIds: ["com.mybank.app"])
        mine.addSite("intranet.example.com")
        try mine.save(to: file)

        ExcludeList.addDefaultsOnce(to: file)
        var list = try ExcludeList.load(from: file)
        XCTAssertEqual(list.bundleIds.first, "com.mybank.app", "your own entries are kept, first")
        XCTAssertTrue(list.urlPatterns.contains(ExcludeList.sitePattern(host: "intranet.example.com")))
        XCTAssertTrue(list.urlPatterns.contains(ExcludeList.sitePattern(host: "chase.com")))

        // Remove a default: that site is read again, and the next launch does not put it back.
        list.urlPatterns.removeAll { $0 == ExcludeList.sitePattern(host: "kp.org") }
        try list.save(to: file)
        ExcludeList.addDefaultsOnce(to: file)
        XCTAssertEqual(try ExcludeList.load(from: file).removedDefaults, 1)
        XCTAssertTrue(try PrivacyPolicy.load(userFile: file).allowsURL("https://healthy.kp.org/portal"))
        XCTAssertFalse(try PrivacyPolicy.load(userFile: file).allowsURL("https://www.chase.com/"))
    }

    func testABrokenFileIsLeftAlone() throws {
        let file = tempFile()
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("{ not json".utf8).write(to: file)
        ExcludeList.addDefaultsOnce(to: file)
        XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), "{ not json")
    }

    func testTheWindowShowsDefaultsApartAndRestoresThem() throws {
        let file = tempFile()
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        var mine = ExcludeList()
        mine.addSite("mybank.example")
        try mine.save(to: file)
        ExcludeList.addDefaultsOnce(to: file)

        let model = ExcludeListModel(file: file, running: { [] }, nameOf: { _ in nil })
        XCTAssertEqual(model.urlPatterns.map(ExcludeList.label(forURLPattern:)), ["mybank.example"], "only yours in Sites")
        XCTAssertTrue(model.apps.isEmpty)
        let total = DefaultExclusions.sites.count + DefaultExclusions.titleWords.count + DefaultExclusions.bundlePrefixes.count
        XCTAssertEqual(model.defaults.count, total)
        XCTAssertEqual(model.defaults.first?.label, "chase.com")

        let kp = try XCTUnwrap(model.defaults.first { $0.label == "kp.org" })
        model.remove(kp)
        model.remove(try XCTUnwrap(model.defaults.first { $0.kind == .app }))
        XCTAssertEqual(model.list.removedDefaults, 2)
        XCTAssertEqual(try ExcludeList.load(from: file).removedDefaults, 2, "saved at once")
        model.restoreDefaults()
        XCTAssertEqual(model.list.removedDefaults, 0)
        XCTAssertEqual(model.urlPatterns.count, 1, "restoring keeps your own entries")

        XCTAssertEqual(ExcludeList.defaultLabels(in: model.list).count, total)
        XCTAssertTrue(ExcludeList.defaultLabels(in: model.list).contains("MyChart (a window title)"))
    }

    func testACardFieldNextToANormalFieldIsDropped() throws {
        let out = try lines("""
        AXWindow title="Checkout"
         AXWebArea url="https://shop.example.com/checkout" title="Checkout"
          AXTextField desc="Name for the order" value="Sam Carter"
          AXTextField desc="Card number" value="4242 4242 4242 4242"
          AXTextField dom="cc-csc" value="123"
          AXTextField title="Expiry date" value="12/30"
          AXTextField value="4111-1111-1111-1111"
          AXTextField desc="IBAN" value="GB00 TEST 0000 0000 0000 00"
          AXTextField desc="Coupon" value="SPRING10"
        """)
        let text = out.joined(separator: "\n")
        XCTAssertTrue(text.contains("Sam Carter"))
        XCTAssertTrue(text.contains("SPRING10"))
        for secret in ["4242", "123", "12/30", "4111", "GB00"] {
            XCTAssertFalse(text.contains(secret), "\(secret) was read")
        }
    }

    func testTextOnThePageAndTerminalsAreNotTouched() throws {
        // Only input fields are checked: an order number in the page's text is read as before.
        let out = try lines("""
        AXWindow title="Order"
         AXStaticText value="Order 4242424242424242 is on its way"
         AXTextArea value="$ echo 4242424242424242"
        """)
        let text = out.joined(separator: "\n")
        XCTAssertTrue(text.contains("Order 4242424242424242 is on its way"))
        XCTAssertTrue(text.contains("echo 4242424242424242"))
    }

    /// Draws the exclude list with the default list open to $TMPDIR/didja-ui/exclude-defaults.png.
    @MainActor
    func testRenderTheDefaults() throws {
        let file = tempFile()
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        var mine = ExcludeList()
        mine.addSite("mybank.example")
        try mine.save(to: file)
        ExcludeList.addDefaultsOnce(to: file)
        let model = ExcludeListModel(file: file, running: { [] }, nameOf: { _ in nil })
        model.remove(try XCTUnwrap(model.defaults.first { $0.label == "kp.org" }))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        for (name, open) in [("exclude-defaults", true), ("exclude-defaults-closed", false)] {
            let renderer = ImageRenderer(content: ExcludeListView(model: model, showDefaults: open))
            renderer.scale = 2
            let image = try XCTUnwrap(renderer.nsImage)
            XCTAssertEqual(image.size.width, 480)
            let png = try XCTUnwrap(image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?
                .representation(using: .png, properties: [:]))
            try png.write(to: dir.appendingPathComponent("\(name).png"))
        }
    }

    func testTheDiagnosticsFileKeepsOnlyTheRoleOfACardField() throws {
        let root = try OutlineElement.parse("""
        AXWindow title="Checkout"
         AXTextField desc="Card number" value="4242 4242 4242 4242"
         AXTextField desc="Coupon" value="SPRING10"
        """)
        let copy = try XCTUnwrap(OutlineElement.copy(root))
        XCTAssertEqual(copy.kids[0].attributes, [:])
        XCTAssertEqual(copy.kids[1].attributes["value"], "SPRING10")
    }

    func testCardNumbersAndLabels() {
        XCTAssertTrue(PrivacyPolicy.looksLikeCardNumber("4242 4242 4242 4242"))
        XCTAssertTrue(PrivacyPolicy.looksLikeCardNumber("5555-5555-5555-4444"))
        XCTAssertTrue(PrivacyPolicy.looksLikeCardNumber("378282246310005"))
        XCTAssertFalse(PrivacyPolicy.looksLikeCardNumber("4242 4242 4242 4241"), "fails the Luhn check")
        XCTAssertFalse(PrivacyPolicy.looksLikeCardNumber("123456"), "too short")
        XCTAssertFalse(PrivacyPolicy.looksLikeCardNumber("v4242424242424242"))
        XCTAssertFalse(PrivacyPolicy.looksLikeCardNumber("٤٢٤٢٤٢٤٢٤٢٤٢٤٢٤٢"), "ASCII digits only")
        for label in ["Card number", "cardNumber", "CVV", "cvc2", "Security code", "IBAN", "Routing number",
                      "Account number", "Expiration date", "MM / YY", "cc-exp", "מספר כרטיס"] {
            XCTAssertTrue(PrivacyPolicy.isPaymentLabel(label), label)
        }
        for label in ["Name on card", "Email", "Search", "Coupon code", "Discount", "Postcode"] {
            XCTAssertFalse(PrivacyPolicy.isPaymentLabel(label), label)
        }
    }
}
