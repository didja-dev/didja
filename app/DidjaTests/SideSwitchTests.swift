import AppKit
import SwiftUI
import XCTest
@testable import Didja

/// The two-sided switch under the menu bar icon: labels, flipping, saving, where it goes.
final class SideSwitchTests: XCTestCase {
    func testOffUntilTurnedOnWithSandboxAndProd() {
        let defaults = UserDefaults(suiteName: "SideSwitchTests-\(UUID())")!
        let s = SideSwitchSettings.load(defaults)
        XCTAssertFalse(s.on)
        XCTAssertEqual([s.left, s.right, s.current], ["Sandbox", "Prod", "Sandbox"])
        XCTAssertEqual(s.accent, .highlighter)
    }

    func testFlipAndSaveRoundTrip() {
        let defaults = UserDefaults(suiteName: "SideSwitchTests-\(UUID())")!
        var s = SideSwitchSettings.load(defaults)
        s.on = true
        s.left = "Clean"
        s.right = "Dirty"
        s.accent = .amber
        s.flip()
        XCTAssertEqual(s.current, "Dirty")
        XCTAssertEqual(s.other, "Clean")
        s.save(defaults)
        XCTAssertEqual(SideSwitchSettings.load(defaults), s)
        s.flip()
        XCTAssertEqual(s.current, "Clean")
    }

    func testLabelsAreOneShortLineAndNeverEmpty() {
        XCTAssertEqual(SideSwitchSettings.clean("  Staging   env \n", otherwise: "x"), "Staging env")
        XCTAssertEqual(SideSwitchSettings.clean("Production server", otherwise: "x"), "Production s")
        XCTAssertEqual(SideSwitchSettings.clean("   ", otherwise: "Prod"), "Prod")
        XCTAssertEqual(SideSwitchSettings.clean("בית", otherwise: "x"), "בית")
    }

    func testItHangsUnderTheIconAndStaysOnItsScreen() {
        let screen = NSRect(x: 0, y: 0, width: 1512, height: 982)
        let icon = NSRect(x: 1200, y: 958, width: 32, height: 24)
        let size = NSSize(width: 160, height: 40)
        let f = SideSwitchSettings.frame(size: size, icon: icon, screens: [screen])!
        XCTAssertEqual(f.midX, icon.midX, accuracy: 1)
        XCTAssertEqual(f.maxY, icon.minY - 2, accuracy: 1)
        // Near the right edge it is pulled back on screen.
        let edge = SideSwitchSettings.frame(size: size, icon: NSRect(x: 1490, y: 958, width: 20, height: 24), screens: [screen])!
        XCTAssertLessThanOrEqual(edge.maxX, screen.maxX - 4)
        // No icon on a screen (menu bar hidden, or crowded out): not shown.
        XCTAssertNil(SideSwitchSettings.frame(size: size, icon: nil, screens: [screen]))
        XCTAssertNil(SideSwitchSettings.frame(size: size, icon: NSRect(x: 4000, y: 2000, width: 32, height: 24), screens: [screen]))
    }

    /// Draws both sides on a light and a dark bar to $TMPDIR/didja-ui/switch.png.
    @MainActor
    func testRenderSwitch() throws {
        var s = SideSwitchSettings()
        s.on = true
        var right = s
        right.onRight = true
        let view = VStack(spacing: 12) {
            HStack(spacing: 24) {
                SideSwitchView(settings: s, dark: false)
                SideSwitchView(settings: right, dark: false)
            }
            .padding(16).background(Color(red: 0.87, green: 0.89, blue: 0.92))
            HStack(spacing: 24) {
                SideSwitchView(settings: s, dark: true)
                SideSwitchView(settings: right, dark: true)
            }
            .padding(16).background(Color(red: 0.12, green: 0.13, blue: 0.16))
        }
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage)
        XCTAssertGreaterThan(image.size.width, 200)
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("didja-ui")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let png = try XCTUnwrap(image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))?.representation(using: .png, properties: [:]))
        try png.write(to: dir.appendingPathComponent("switch.png"))
    }
}
