import AppKit
import SwiftUI

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

/// A hosting view that acts on the first click even while Didja is not the active app. The panel
/// opens from the menu bar icon or the shortcut while you are in another app, and macOS may not let
/// Didja come to the front; without this, the first click (on +, a tick, a row) only brought Didja
/// forward and did nothing else, so you had to click twice.
final class FirstClickHostingView<Content: View>: NSHostingView<Content> {
    /// Called when the content's size may have changed (the list grew or shrank).
    var sizeChanged: (() -> Void)?

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func invalidateIntrinsicContentSize() {
        super.invalidateIntrinsicContentSize()
        sizeChanged?()
    }

    // After every layout too: the list can grow (rows read in, a fold opened) without the size
    // being reported as changed, and the panel stayed at its first, smaller size.
    override func layout() {
        super.layout()
        sizeChanged?()
    }
}

/// A view controller showing SwiftUI in a `FirstClickHostingView`. (`NSHostingController` makes its
/// own view, so a subclass cannot swap in one that takes the first click.) With `followsContent` its
/// preferred size follows the SwiftUI content, as the drop-down panel needs to fit the list.
final class FirstClickHostingController<Content: View>: NSViewController {
    let host: FirstClickHostingView<Content>

    init(rootView: Content, followsContent: Bool = false) {
        host = FirstClickHostingView(rootView: rootView)
        host.sizingOptions = followsContent ? [.intrinsicContentSize] : []
        super.init(nibName: nil, bundle: nil)
        guard followsContent else { return }
        host.sizeChanged = { [weak self] in self?.followContent() }
        followContent()
    }

    /// The panel takes the content's size, as `NSHostingController`'s `.preferredContentSize` did.
    private func followContent() {
        // The content's ideal size (what `NSHostingController` uses), not `fittingSize`: that is the
        // smallest size, and a list in a scroll view can shrink to nothing, which cut off the
        // panel's header and footer.
        let size = host.intrinsicContentSize
        if size.width > 0, size.height > 0, preferredContentSize != size { preferredContentSize = size }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override func loadView() { view = host }
}
