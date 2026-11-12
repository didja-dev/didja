import Foundation
import Sparkle

/// Updates (SCR-33): Sparkle checks https://didja.dev/appcast.xml once a day, shows the standard
/// "A new version of Didja is available" window with the release notes, and installs the update
/// only when its EdDSA signature matches the public key in Info.plist. The only request it makes
/// is for that feed (and the update itself): nothing from the screen or the database is sent.
final class Updates: ObservableObject {
    static let shared = Updates()

    private let controller: SPUStandardUpdaterController?

    private init() {
        // Not in Debug builds or under tests: a development build must never replace itself with a
        // release, and tests must make no network requests.
        if Self.isActive {
            controller = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
        } else {
            controller = nil
        }
    }

    /// Release builds with a real signing key only.
    static var isActive: Bool {
        #if DEBUG
        return false
        #else
        let key = Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String ?? ""
        return !key.isEmpty && !key.contains("PLACEHOLDER")
            && ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil
        #endif
    }

    /// "Check for Updates…": look now and say what was found, even "you're up to date".
    func checkNow() {
        controller?.checkForUpdates(nil)
    }

    var canCheck: Bool { controller != nil }

    /// The daily check, on unless you turn it off in Settings › General.
    var checksAutomatically: Bool {
        get { controller?.updater.automaticallyChecksForUpdates ?? true }
        set {
            controller?.updater.automaticallyChecksForUpdates = newValue
            objectWillChange.send()
        }
    }
}
