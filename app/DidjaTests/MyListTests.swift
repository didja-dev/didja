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

    // SCR-119: "add this to Didja", with what is on screen.

    func testScreenContentIsAddedThroughTheEngineWithItsApp() {
        var asked: [[String]] = []
        let text = "Book the venue for the offsite.\nThen the invites"
        let added = MyList.add(task: nil, screen: Data(text.utf8), app: "  Notes ",
                               run: { _ in XCTFail("not the words path"); return true },
                               output: { asked.append($0); return "#7 on My List: Book the venue for the offsite." })
        XCTAssertEqual(added, "Book the venue for the offsite.")
        XCTAssertEqual(asked, [["keep", "--screen", "--from", "Notes", text]])
    }

    func testScreenContentWithoutAnAppSaysNoApp() {
        XCTAssertEqual(MyList.screenArguments(text: "Call the office", app: nil), ["keep", "--screen", "Call the office"])
        XCTAssertEqual(MyList.screenArguments(text: "Call the office", app: "   "), ["keep", "--screen", "Call the office"])
    }

    func testWithoutScreenContentItBehavesAsBefore() {
        var ran: [[String]] = []
        let added = MyList.add(task: " renew the passport. ", screen: nil, app: "Notes",
                               run: { ran.append($0); return true },
                               output: { _ in XCTFail("not the screen path"); return nil })
        XCTAssertEqual(added, "renew the passport")
        XCTAssertEqual(ran, [["keep", "renew the passport"]])
        XCTAssertNil(MyList.add(task: nil, screen: nil, app: nil, run: { _ in XCTFail(); return true }, output: { _ in XCTFail(); return nil }))
    }

    func testScreenContentWithNoWordsFallsBackToTheWords() {
        var ran: [[String]] = []
        let added = MyList.add(task: "call Noa", screen: Data(" \n — ".utf8), app: "Notes",
                               run: { ran.append($0); return true },
                               output: { _ in XCTFail("nothing on screen to add"); return nil })
        XCTAssertEqual(added, "call Noa")
        XCTAssertEqual(ran, [["keep", "call Noa"]])
    }

    func testScreenContentIsCutAndTheEnginesAnswerIsRead() {
        let long = String(repeating: "word ", count: 2000)
        XCTAssertEqual(MyList.screenText(Data(long.utf8))?.count, MyList.screenTextLimit)
        XCTAssertNil(MyList.screenText(Data("...".utf8)))
        XCTAssertEqual(MyList.addedTitle("#12 on My List: שלח לנועה את החשבונית"), "שלח לנועה את החשבונית")
        XCTAssertNil(MyList.addedTitle(nil))
        XCTAssertNil(MyList.addedTitle(""), "the engine added nothing")
        XCTAssertNil(MyList.addedTitle("#12 on My List"), "an answer without a title is not taken")
        XCTAssertNil(MyList.addFromScreen("Call the office", app: nil, output: { _ in "" }), "the engine refused")
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
