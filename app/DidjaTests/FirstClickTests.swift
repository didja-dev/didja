import AppKit
import SwiftUI
import XCTest
@testable import Didja

/// The panel acts on the first click while Didja is not the active app: + adds at once.
final class FirstClickTests: XCTestCase {
    @MainActor
    func testThePanelsViewTakesTheFirstClick() {
        let controller = FirstClickHostingController(rootView: Text("Panel").frame(width: 300, height: 120), followsContent: true)
        XCTAssertTrue(controller.view.acceptsFirstMouse(for: nil))
        // The drop-down panel still takes the list's size.
        controller.view.layoutSubtreeIfNeeded()
        XCTAssertEqual(controller.preferredContentSize.width, 300, accuracy: 1)
        XCTAssertEqual(controller.preferredContentSize.height, 120, accuracy: 1)
        // A plain hosting view does not: that was the extra click.
        XCTAssertFalse(NSHostingView(rootView: Text("Panel")).acceptsFirstMouse(for: nil))
    }
}
