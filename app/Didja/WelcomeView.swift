import ApplicationServices
import SwiftUI

/// The first-run screen, also reachable from the panel's menu: what
/// Didja reads, what it never reads, and the permissions it needs.
struct WelcomeView: View {
    static let width: CGFloat = 520

    /// Whether each permission is granted. Injected so the screen can be drawn in tests.
    var accessibilityGranted: () -> Bool = { AXIsProcessTrusted() }
    var screenRecordingGranted: () -> Bool = { OCRCapture.isPermitted }
    var openAccessibilitySettings: () -> Void = {}
    var requestScreenRecording: () -> Void = { OCRCapture.requestPermission() }
    var editExcludeList: () -> Void = {}
    var openPrivacy: () -> Void = {}
    var done: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 6) {
                Image("Lockup").resizable().scaledToFit().frame(height: 30)
                    .accessibilityLabel("Didja")
                    .padding(.bottom, 4)
                Text("Keeps track of what Claude asks you to do, and of emails in Outlook or Gmail that ask something of you. It reads the text of the window you are working in, notes what is asked of you, and ticks it off when it sees you do it.")
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            section("eye", "What it reads") {
                line("Only the window in front, as text. No screenshots or recordings are kept.")
                line("Text is kept for 24 hours, on this Mac, except a few lines around each open task, kept with it until it is done. Nothing you see is sent anywhere.")
            }

            section("eye.slash", "What it never reads") {
                line("Password managers and password prompts.")
                line("Password fields, and private or incognito browser windows.")
                line("The text box you are typing in, except in a terminal.")
                HStack(spacing: 8) {
                    line("Apps, window titles and sites you add to the exclude list.")
                    Button("Edit List…", action: editExcludeList).buttonStyle(DidjaButtonStyle.secondary)
                }
            }

            // Permissions can be granted while this is open; look again every second.
            TimelineView(.periodic(from: .now, by: 1)) { _ in
                section("lock.shield", "Permissions") {
                    permission(
                        "Accessibility", detail: "Required. This is how the window's text is read.",
                        granted: accessibilityGranted(), action: "Open Settings", perform: openAccessibilitySettings)
                    permission(
                        "Screen Recording", detail: "Optional. Lets it read windows that expose no text, one frame at a time, never saved.",
                        granted: screenRecordingGranted(), action: "Enable", perform: requestScreenRecording)
                }
            }

            section("keyboard", "Using it") {
                HStack(spacing: 6) {
                    KeyChip(text: GlobalHotKey.label)
                    line("opens the \(ViewNames.quick), your list, from anywhere.")
                }
                line("Click the Didja mark in the menu bar for the same \(ViewNames.quick), and Pause there to stop reading at any time. \(ViewNames.full) in its header opens everything, with Settings.")
            }

            HStack {
                Button("Privacy in Detail…", action: openPrivacy).buttonStyle(DidjaButtonStyle.secondary)
                Spacer()
                Button("Done", action: done).buttonStyle(DidjaButtonStyle.primary).keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: Self.width)
        .background(Palette.surface)
    }

    private func section<Content: View>(_ symbol: String, _ title: String, @ViewBuilder content: () -> Content) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 15))
                .foregroundStyle(Palette.accent)
                .frame(width: 22, height: 20)
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.headline)
                content()
            }
        }
    }

    private func line(_ text: String) -> some View {
        Text(text).fixedSize(horizontal: false, vertical: true)
    }

    private func permission(_ name: String, detail: String, granted: Bool, action: String,
                            perform: @escaping () -> Void) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: granted ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(granted ? Palette.done : Color.secondary)
                .frame(width: 18, height: 18)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(name).fontWeight(.medium)
                    Text(granted ? "Granted" : "Not granted")
                        .font(.caption)
                        .foregroundStyle(granted ? Palette.done : Palette.attention)
                }
                Text(detail).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            if !granted {
                Button(action, action: perform).buttonStyle(DidjaButtonStyle.secondary)
            }
        }
    }
}

/// The welcome screen as its window shows it: fixed width, scrolling when the window is short.
struct WelcomeWindowContent: View {
    var content: WelcomeView

    var body: some View {
        ScrollView { content }
            .frame(width: WelcomeView.width)
            .frame(minHeight: 320, maxHeight: .infinity, alignment: .top)
            .background(Palette.surface)
    }
}
