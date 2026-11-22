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

/// The ⋯ menu opens on the first click: it waits until Didja is in front, once.
final class MoreMenuOpeningTests: XCTestCase {
    func testInFrontAlreadyItOpensAtOnce() {
        var opened = 0
        var activated = false
        MoreMenu.whenFront(isActive: true, activate: { activated = true }, becameActive: { _ in nil }, stopWatching: { _ in },
                           after: { _, _ in XCTFail("no wait") }, open: { opened += 1 })
        XCTAssertEqual(opened, 1)
        XCTAssertFalse(activated)
    }

    func testFromAnotherAppItAsksToComeForwardAndOpensOnceAfter() {
        var opened = 0
        var activated = false
        var whenActive: (() -> Void)?
        var fallback: (() -> Void)?
        var stopped = false
        MoreMenu.whenFront(isActive: false, activate: { activated = true },
                           becameActive: { run in whenActive = run; return "token" }, stopWatching: { _ in stopped = true },
                           after: { delay, run in XCTAssertEqual(delay, 0.3); fallback = run }, open: { opened += 1 })
        XCTAssertTrue(activated)
        XCTAssertEqual(opened, 0) // not while Didja is still coming forward
        // The fallback fires (macOS said no, or was slow): it opens, once.
        fallback?()
        XCTAssertEqual(opened, 1)
        XCTAssertTrue(stopped)
        whenActive?() // a late "became active" opens nothing more
        let done = expectation(description: "main queue")
        DispatchQueue.main.async { done.fulfill() }
        wait(for: [done], timeout: 1)
        XCTAssertEqual(opened, 1)
    }
}
