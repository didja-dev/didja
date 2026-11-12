import XCTest
@testable import Didja

/// SCR-47: the app shows its current icon in its alerts and windows.
final class BrandTests: XCTestCase {
    func testTheAppIconIsTheBundledOneAndBecomesTheApplicationsIcon() throws {
        let image = try XCTUnwrap(AppIcon.image, "the asset catalog has AppIcon")
        XCTAssertGreaterThan(image.size.width, 0)
        let app = NSApplication.shared
        let before = app.applicationIconImage
        defer { app.applicationIconImage = before }
        app.applicationIconImage = nil
        AppIcon.apply(to: app)
        XCTAssertNotNil(app.applicationIconImage, "set from the bundle")
        // Alerts carry it themselves (macOS can show a stale cached icon otherwise).
        XCTAssertTrue(AppIcon.alert().icon === image)
        // The bundled icon is the brand's (brand/app-icon), not an older one.
        let brand = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("brand/app-icon/AppIcon.appiconset/icon_1024.png")
        let bundled = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Didja/Assets.xcassets/AppIcon.appiconset/icon_1024.png")
        XCTAssertEqual(try Data(contentsOf: brand), try Data(contentsOf: bundled))
    }
}
