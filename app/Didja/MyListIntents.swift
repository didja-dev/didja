import AppIntents
import Foundation

/// My List (SCR-46): tasks you add yourself, by Siri, Shortcuts or `didja keep`. They stay until you
/// tick them: nothing on screen ticks them, and Fresh Start leaves them. The engine keeps them.
enum MyList {
    static let name = "My List"

    /// The words Siri heard, tidied; nil when there is nothing to add.
    static func clean(_ text: String) -> String? {
        let words = text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        let trimmed = words.trimmingCharacters(in: CharacterSet(charactersIn: ".,;: "))
        return trimmed.isEmpty ? nil : String(trimmed.prefix(300))
    }

    static func add(_ text: String, run: ([String]) -> Bool = { EngineRunner.run($0) }) -> String? {
        guard let title = clean(text), run(["keep", title]) else { return nil }
        return title
    }
}

struct AddToMyListIntent: AppIntent {
    static let title: LocalizedStringResource = "Add to My List"
    static let description = IntentDescription("Adds a task to My List in Didja. It stays until you tick it.")
    static let openAppWhenRun = false

    @Parameter(title: "Task", requestValueDialog: "What should I add to My List?")
    var task: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let added = MyList.add(task) else {
            return .result(dialog: "I couldn't add that to My List.")
        }
        return .result(dialog: "Added \u{201C}\(added)\u{201D} to My List.")
    }
}

/// "Hey Siri, add to Didja": Siri then asks what to add.
struct DidjaShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddToMyListIntent(),
            phrases: [
                "Add to \(.applicationName)",
                "Add a task to \(.applicationName)",
                "Add to my list in \(.applicationName)",
                "Remind me in \(.applicationName)",
            ],
            shortTitle: "Add to My List",
            systemImageName: "text.badge.plus")
    }
}
