import ServiceManagement

/// Starts Didja when you log in. Off until you turn it on.
enum LoginItem {
    static var isEnabled: Bool {
        SMAppService.mainApp.status == .enabled
    }

    /// Returns the state after the change, which is unchanged if macOS refused.
    static func setEnabled(_ enabled: Bool) -> Bool {
        do {
            if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
        } catch {
            NSLog("Didja: could not change launch at login: \(error.localizedDescription)")
        }
        return isEnabled
    }
}
