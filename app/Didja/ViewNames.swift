/// The two views' names, used wherever the app talks about them (SCR-37): the Quick View drops
/// down from the menu bar icon (or floats where you pinned it); the Full View is the big window
/// with every view, source and Settings. In the code they are still the popover/panel and the
/// task window.
enum ViewNames {
    static let quick = "Quick View"
    static let full = "Full View"
    static let pinTitle = "Pin \(quick) (Move and Resize It)"
    static let unpinTitle = "Unpin \(quick) (Back Under the Icon)"
}
