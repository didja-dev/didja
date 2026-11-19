import XCTest
@testable import Didja

/// The list's timestamps are read by hand (a date formatter per task made each read of the list
/// take most of a second); the result must be what the formatter gives, to the millisecond.
final class TimestampParseTests: XCTestCase {
    let formatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    func testTheEnginesTimestampsReadAsTheFormatterReadsThem() {
        for text in ["2026-11-18T13:19:07.123Z", "2026-01-01T00:00:00.000Z", "2024-02-29T23:59:59.999Z",
                     "1999-12-31T12:00:00.500Z", "2026-03-01T08:30:00.000Z", "2100-02-28T01:02:03.004Z"] {
            let mine = ObservationStore.parseTimestamp(text)
            let theirs = formatter.date(from: text)
            XCTAssertNotNil(mine, text)
            XCTAssertEqual(mine!.timeIntervalSince1970, theirs!.timeIntervalSince1970, accuracy: 0.0005, text)
        }
    }

    func testEveryDayOfTwoYearsMatches() {
        var date = formatter.date(from: "2025-01-01T06:07:08.090Z")!
        for _ in 0..<730 {
            let text = formatter.string(from: date)
            XCTAssertEqual(ObservationStore.parseTimestamp(text)!.timeIntervalSince1970, date.timeIntervalSince1970, accuracy: 0.0005, text)
            date = date.addingTimeInterval(86_400 + 3_601.25)
        }
    }

    func testOtherShapesGoToTheFormatterOrNowhere() {
        // Without fractional seconds it still reads, as a whole second.
        XCTAssertEqual(ObservationStore.parseTimestamp("2026-11-18T13:19:07Z"), Date(timeIntervalSince1970: formatter.date(from: "2026-11-18T13:19:07.000Z")!.timeIntervalSince1970))
        XCTAssertNil(ObservationStore.parseTimestamp("not a date"))
        XCTAssertNil(ObservationStore.parseTimestamp("2026-13-18T13:19:07.000Z"))
        XCTAssertNil(ObservationStore.parseTimestamp("2026-11-18 13:19:07.000Z"))
        XCTAssertNil(ObservationStore.parseTimestamp(""))
    }

    func testAThousandTimestampsTakeAFewMilliseconds() {
        let texts = (0..<4000).map { formatter.string(from: Date(timeIntervalSince1970: 1_790_000_000 + Double($0) * 977.5)) }
        let start = Date()
        for t in texts { _ = ObservationStore.parseTimestamp(t) }
        XCTAssertLessThan(Date().timeIntervalSince(start), 0.1)
    }

    func testLastSeenIsKeptToTheMinuteSoSmallMovesDoNotRedrawTheList() {
        let a = ObservationStore.parseTimestamp("2026-11-19T13:31:19.025Z")!
        let b = ObservationStore.parseTimestamp("2026-11-19T13:31:39.486Z")!
        let c = ObservationStore.parseTimestamp("2026-11-19T13:32:00.000Z")!
        XCTAssertEqual(ObservationStore.toMinute(a), ObservationStore.toMinute(b))
        XCTAssertNotEqual(ObservationStore.toMinute(b), ObservationStore.toMinute(c))
        XCTAssertEqual(ObservationStore.toMinute(c), c)
    }
}
