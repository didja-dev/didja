import XCTest
@testable import Didja

/// SCR-46 My List by Siri, SCR-48 Fresh Start: the app's side (the engine's is in freshstart.test.ts).
final class MyListTests: XCTestCase {
    func testWhatSiriHeardIsAddedThroughTheEngine() {
        var ran: [[String]] = []
        XCTAssertEqual(MyList.add("  renew the   passport. ", run: { ran.append($0); return true }), "renew the passport")
        XCTAssertEqual(ran, [["keep", "renew the passport"]])
        XCTAssertNil(MyList.add(" . ", run: { _ in XCTFail("nothing to add"); return true }))
        XCTAssertNil(MyList.add("call Noa", run: { _ in false }), "the engine refused")
    }

    func testSiriKnowsThePhrases() {
        XCTAssertEqual(DidjaShortcuts.appShortcuts.count, 1)
    }

    func testFreshStartCanBeUndoneForADay() {
        let defaults = UserDefaults(suiteName: "didja-test-\(UUID().uuidString)")!
        let at = Date(timeIntervalSince1970: 1_794_484_800)
        XCTAssertFalse(FreshStart.canUndo(now: at, defaults: defaults))
        FreshStart.didStart(at: at, defaults: defaults)
        XCTAssertTrue(FreshStart.canUndo(now: at.addingTimeInterval(23 * 3600), defaults: defaults))
        XCTAssertFalse(FreshStart.canUndo(now: at.addingTimeInterval(25 * 3600), defaults: defaults))
        FreshStart.didUndo(defaults: defaults)
        XCTAssertFalse(FreshStart.canUndo(now: at, defaults: defaults))
        XCTAssertTrue(FreshStart.message.contains("Nothing is deleted"))
        XCTAssertTrue(FreshStart.message.contains("My List stays"))
    }
}
