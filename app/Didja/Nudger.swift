import Foundation
import UserNotifications

/// Reminds you, once, about a checklist that has sat unfinished for hours.
/// The engine decides which ones are due (`didja nudges`); this posts
/// a notification for each. Clicking one opens the panel.
final class Nudger: NSObject, UNUserNotificationCenterDelegate {
    struct Nudge: Decodable, Equatable {
        var id: Int
        var title: String
        var source: String
        var left: Int
        var total: Int
        /// Set when the reminder is for the day a task falls due (SCR-97).
        var due: String? = nil
        /// Set (to when you asked) when the reminder is for an ask you sent that has no answer yet (SCR-99).
        var waiting: String? = nil

        var heading: String { waiting != nil ? "No reply yet · \(title)" : "Didja finish that? \(title)" }
        var identifier: String { waiting != nil ? "waiting-\(id)" : "nudge-\(id)" }
        var detail: String {
            if waiting != nil { return "You asked in \(source)" }
            if due != nil { return "Due today · \(source)" }
            return total > 1 ? "\(left) of \(total) steps left · \(source)" : source
        }
    }

    private static let enabledKey = "nudgesOff"
    /// On unless you turn it off in the panel's menu.
    static var isEnabled: Bool {
        get { !UserDefaults.standard.bool(forKey: enabledKey) }
        set { UserDefaults.standard.set(!newValue, forKey: enabledKey) }
    }

    private var timer: Timer?
    private var open: () -> Void = {}

    static func decode(_ json: String) throws -> [Nudge] {
        try JSONDecoder().decode([Nudge].self, from: Data(json.utf8))
    }

    /// Check every few minutes. `open` is what a click on a reminder does.
    func start(open: @escaping () -> Void) {
        self.open = open
        UNUserNotificationCenter.current().delegate = self
        timer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in self?.check() }
    }

    private func check() {
        guard Self.isEnabled else { return }
        DispatchQueue.global(qos: .utility).async {
            Self.remindOfReview()
            guard let json = EngineRunner.output(["nudges"]), let nudges = try? Self.decode(json), !nudges.isEmpty else { return }
            let center = UNUserNotificationCenter.current()
            // Asks once, the first time there is something to say.
            center.requestAuthorization(options: [.alert]) { granted, _ in
                guard granted else { return }
                for nudge in nudges {
                    let content = UNMutableNotificationContent()
                    content.title = nudge.heading
                    content.body = nudge.detail
                    center.add(UNNotificationRequest(identifier: nudge.identifier, content: content, trigger: nil))
                }
            }
        }
    }

    /// The Day Review you chose a time for (SCR-100): one notification when it is due; opening the
    /// panel shows it. Once a day per review, kept here so the engine still shows it when you open the panel.
    static func reviewReminder(_ kind: String) -> (title: String, body: String) {
        kind == "morning"
            ? ("Morning list", "Due today, overdue, and who you are waiting on.")
            : ("Day Review", "What Didja ticked for you today, and what is left.")
    }

    private static func remindOfReview() {
        guard let kind = DayReviewEngine.due(take: false) else { return }
        let key = "reviewReminded"
        let stamp = "\(kind)-\(Calendar.current.startOfDay(for: Date()).timeIntervalSince1970)"
        guard UserDefaults.standard.string(forKey: key) != stamp else { return }
        UserDefaults.standard.set(stamp, forKey: key)
        let (title, body) = reviewReminder(kind)
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert]) { granted, _ in
            guard granted else { return }
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "review-\(kind)", content: content, trigger: nil))
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        DispatchQueue.main.async { self.open() }
        completionHandler()
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner])
    }
}
