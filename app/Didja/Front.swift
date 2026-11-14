import AppKit

/// Bringing Didja's own windows to the front. Didja is a menu bar app, so it is never the front
/// app when you choose something from its menu. Since macOS 14 a request to come to the front is
/// one the system may turn down (`activate(ignoringOtherApps:)` is deprecated and can do nothing),
/// and a window ordered front by an app that is not active opens behind the app you were using:
/// Settings and the pinned Quick View seemed not to open at all. So a window is put on top
/// whether or not the activation is granted, then made key once it is.
enum Front {
    static func activate(_ app: NSApplication = .shared) {
        if #available(macOS 14.0, *) {
            app.activate()
        } else {
            app.activate(ignoringOtherApps: true)
        }
    }
}

extension NSWindow {
    /// Show this window on top of every other app's windows and give it the keyboard.
    func bringToFront() {
        // A titled window puts Didja in the Dock; switch first, so the switch does not
        // send the window back behind the app that was in front.
        if DockPresence.counts(title: title, titled: styleMask.contains(.titled), visible: true, miniaturized: false),
           NSApp.activationPolicy() != .regular {
            NSApp.setActivationPolicy(.regular)
            AppIcon.apply()
        }
        Front.activate()
        makeKeyAndOrderFront(nil)
        orderFrontRegardless()
        // The activation can land a moment later; take the keyboard then too.
        DispatchQueue.main.async { [weak self] in
            guard let self, self.isVisible, !self.isKeyWindow else { return }
            self.makeKey()
        }
    }
}
