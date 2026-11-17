import XCTest
@testable import Didja

/// One read at a time, requests folded while reading, and a rest after each read in proportion to
/// how long it took, so a slow window is no longer read without a break.
final class CapturePacerTests: XCTestCase {
    let t0 = Date(timeIntervalSince1970: 1_000_000)

    func testAQuickReadBarelyWaits() {
        var p = CapturePacer()
        XCTAssertEqual(p.request(at: t0), .now)
        XCTAssertNil(p.finished(at: t0.addingTimeInterval(0.05), took: 0.05))
        // A second later the rest (0.1 s) is long over: read at once.
        XCTAssertEqual(p.request(at: t0.addingTimeInterval(1)), .now)
    }

    func testRequestsDuringASlowReadBecomeOneReadAfterARest() {
        var p = CapturePacer()
        XCTAssertEqual(p.request(at: t0), .now)
        // Ten changes in the window while a 3-second read runs: no reads pile up.
        for i in 1...10 { XCTAssertEqual(p.request(at: t0.addingTimeInterval(Double(i) * 0.25)), .folded) }
        // One read follows, after resting twice as long as the read took.
        let rest = p.finished(at: t0.addingTimeInterval(3), took: 3)
        XCTAssertEqual(rest!, 6, accuracy: 0.001)
        XCTAssertEqual(p.request(at: t0.addingTimeInterval(4)), .folded) // already scheduled
        XCTAssertTrue(p.fire())
        XCTAssertFalse(p.fire()) // once
        XCTAssertEqual(p.request(at: t0.addingTimeInterval(9.5)), .folded) // it is running
    }

    func testAChangeWhileRestingIsReadWhenTheRestEnds() {
        var p = CapturePacer()
        _ = p.request(at: t0)
        XCTAssertNil(p.finished(at: t0.addingTimeInterval(2), took: 2)) // rests until t0+6
        guard case .later(let delay) = p.request(at: t0.addingTimeInterval(3)) else { return XCTFail("should wait") }
        XCTAssertEqual(delay, 3, accuracy: 0.001)
        XCTAssertEqual(p.request(at: t0.addingTimeInterval(4)), .folded)
        XCTAssertTrue(p.fire())
    }

    func testSwitchingAppsIsReadAtOnceUnlessAReadIsRunning() {
        var p = CapturePacer()
        _ = p.request(at: t0)
        XCTAssertEqual(p.request(at: t0.addingTimeInterval(1), appChanged: true), .folded) // still reading
        _ = p.finished(at: t0.addingTimeInterval(4), took: 4)
        // Resting until t0+12, but you switched apps: read the new one now; the held read is then not repeated.
        XCTAssertEqual(p.request(at: t0.addingTimeInterval(5), appChanged: true), .now)
        XCTAssertFalse(p.fire())
    }

    func testTheRestIsCapped() {
        var p = CapturePacer()
        _ = p.request(at: t0)
        _ = p.request(at: t0.addingTimeInterval(1))
        XCTAssertEqual(p.finished(at: t0.addingTimeInterval(30), took: 30)!, 15, accuracy: 0.001)
    }

    func testAHeldReadWithNothingToReadIsForgotten() {
        var p = CapturePacer()
        _ = p.request(at: t0)
        _ = p.finished(at: t0.addingTimeInterval(2), took: 2)
        _ = p.request(at: t0.addingTimeInterval(3)) // held
        p.drop()
        XCTAssertFalse(p.fire())
        XCTAssertEqual(p.request(at: t0.addingTimeInterval(7)), .now)
    }
}
