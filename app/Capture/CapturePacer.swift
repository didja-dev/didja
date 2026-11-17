import Foundation

/// When the next capture may start. Reading a large window (a long conversation, a busy web page)
/// can take seconds, and the app being read slows down while it answers. Before, every change in
/// the window asked for another read, and reads queued up behind each other, so capture ran without
/// a break and both apps lagged. Now one read runs at a time, requests that arrive meanwhile become
/// one more read, and after each read capture rests in proportion to how long it took: a quick read
/// barely waits, a three-second one waits six. Switching apps is read at once (unless a read is
/// running), so what you just opened is never held back by the last app's slow read.
struct CapturePacer {
    /// How long to rest after a read, as a multiple of how long it took: reading at most a third of the time.
    var restFactor: Double = 2
    /// Never rest longer than this, so a slow window is still read every so often.
    var maxRest: TimeInterval = 15

    private(set) var running = false
    /// A request came in while reading or resting, and is still to be served.
    private(set) var waiting = false
    private(set) var restUntil = Date.distantPast

    enum Decision: Equatable {
        /// Read now.
        case now
        /// Read after this delay: call `fire()` then.
        case later(TimeInterval)
        /// A read is running or already scheduled; this request is folded into it.
        case folded
    }

    mutating func request(at now: Date, appChanged: Bool = false) -> Decision {
        if running {
            waiting = true
            return .folded
        }
        if appChanged || now >= restUntil {
            running = true
            waiting = false
            return .now
        }
        if waiting { return .folded }
        waiting = true
        return .later(restUntil.timeIntervalSince(now))
    }

    /// A read ended after `took` seconds. Returns the delay before the request that came in
    /// meanwhile should be read (then call `fire()`), or nil when none did.
    mutating func finished(at now: Date, took: TimeInterval) -> TimeInterval? {
        running = false
        restUntil = now.addingTimeInterval(min(maxRest, max(0, took) * restFactor))
        return waiting ? restUntil.timeIntervalSince(now) : nil
    }

    /// A scheduled read is due. True to read now; false when it was already served.
    mutating func fire() -> Bool {
        guard waiting, !running else { return false }
        waiting = false
        running = true
        return true
    }

    /// A scheduled read had nothing to read (capture paused, no app in front): forget it.
    mutating func drop() {
        waiting = false
    }
}
