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

    // MARK: "Add this to Didja" (SCR-119)

    /// The most text taken from what Siri passes: enough for a title, never a whole document.
    static let screenTextLimit = 4000

    /// The text the system passed from the screen, as UTF-8, cut to `screenTextLimit`; nil when it has no words.
    static func screenText(_ data: Data) -> String? {
        guard let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .utf16) else { return nil }
        let cut = String(text.prefix(screenTextLimit))
        return cut.unicodeScalars.contains(where: { CharacterSet.alphanumerics.contains($0) }) ? cut : nil
    }

    /// The engine command for text from the screen: the engine writes the title and keeps nothing else.
    static func screenArguments(text: String, app: String?) -> [String] {
        let from = app.map { $0.split(whereSeparator: \.isWhitespace).joined(separator: " ") }.flatMap { $0.isEmpty ? nil : String($0.prefix(60)) }
        return ["keep", "--screen"] + (from.map { ["--from", $0] } ?? []) + [text]
    }

    /// The title the engine printed (`#12 on My List: <title>`), or nil if it added nothing.
    static func addedTitle(_ output: String?) -> String? {
        guard let output, let range = output.range(of: " on My List: "), output.hasPrefix("#") else { return nil }
        let title = output[range.upperBound...].trimmingCharacters(in: .whitespacesAndNewlines)
        return title.isEmpty ? nil : title
    }

    /// Add text Siri passed from the screen; returns the title the engine gave it.
    static func addFromScreen(_ text: String, app: String?, output: ([String]) -> String? = { EngineRunner.output($0) }) -> String? {
        guard text.unicodeScalars.contains(where: { CharacterSet.alphanumerics.contains($0) }) else { return nil }
        return addedTitle(output(screenArguments(text: String(text.prefix(screenTextLimit)), app: app)))
    }

    /// What the intent does: text from the screen when the system passed some, otherwise the words
    /// you said, as before. Nil means there was nothing to add (or the engine could not add it).
    static func add(task: String?, screen: Data?, app: String?,
                    run: ([String]) -> Bool = { EngineRunner.run($0) },
                    output: ([String]) -> String? = { EngineRunner.output($0) }) -> String? {
        if let screen, let text = screenText(screen) { return addFromScreen(text, app: app, output: output) }
        guard let task else { return nil }
        return add(task, run: run)
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

/// "Add this to Didja" (SCR-119), macOS 27 and later: when you ask Siri to add what is on screen,
/// the system hands this intent that content as text, and the engine turns it into a My List item
/// with a title of its own and the app it came from. Didja reads nothing itself: only what Siri
/// passes, when you ask. Without content it asks what to add, as `AddToMyListIntent` does; on
/// earlier systems that intent is the only one.
@available(macOS 27.0, *)
struct AddScreenToMyListIntent: AppIntent {
    static let title: LocalizedStringResource = "Add This to My List"
    static let description = IntentDescription("Adds what is on screen to My List in Didja, titled for you. It stays until you tick it.")
    static let openAppWhenRun = false

    @Parameter(title: "Content", supportedContentTypes: [.plainText, .utf8PlainText, .text])
    var content: IntentFile?

    @Parameter(title: "From App")
    var sourceApp: String?

    @Parameter(title: "Task")
    var task: String?

    func perform() async throws -> some IntentResult & ProvidesDialog {
        if content == nil, task == nil {
            throw $task.needsValueError("What should I add to My List?")
        }
        guard let added = MyList.add(task: task, screen: content?.data, app: sourceApp) else {
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
