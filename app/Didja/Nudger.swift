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

        var heading: String { "Didja finish that? \(title)" }
        var detail: String { total > 1 ? "\(left) of \(total) steps left · \(source)" : source }
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
            guard let json = EngineRunner.output(["nudges"]), let nudges = try? Self.decode(json), !nudges.isEmpty else { return }
            let center = UNUserNotificationCenter.current()
            // Asks once, the first time there is something to say.
            center.requestAuthorization(options: [.alert]) { granted, _ in
                guard granted else { return }
                for nudge in nudges {
                    let content = UNMutableNotificationContent()
                    content.title = nudge.heading
                    content.body = nudge.detail
                    center.add(UNNotificationRequest(identifier: "nudge-\(nudge.id)", content: content, trigger: nil))
                }
            }
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
