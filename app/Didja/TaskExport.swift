import AppKit
import UniformTypeIdentifiers

/// Export All Tasks (SCR-114): every task to a file you choose, in Markdown or JSON, so your tasks
/// outlive the app. The engine builds and writes the file (`didja export`); Didja keeps no copy and
/// sends nothing. The lines kept with open tasks (screen text) go in only when you tick the box.
enum TaskExport {
    enum Format: String, CaseIterable, Identifiable {
        case markdown = "md"
        case json

        var id: String { rawValue }
        var fileExtension: String { rawValue }
        var label: String { self == .markdown ? "Markdown…" : "JSON…" }
        var contentType: UTType { self == .json ? .json : (UTType(filenameExtension: "md") ?? .plainText) }
    }

    /// The engine command that writes the export to `path`.
    static func arguments(_ format: Format, withContext: Bool, to path: String) -> [String] {
        ["export", format.rawValue] + (withContext ? ["--context"] : []) + ["--out", path]
    }

    /// "Didja tasks 2026-11-14.md": the day in the name, so exports sort and never overwrite one another by default.
    static func fileName(_ format: Format, on date: Date = Date()) -> String {
        let day = DateFormatter()
        day.locale = Locale(identifier: "en_US_POSIX")
        day.dateFormat = "yyyy-MM-dd"
        return "Didja tasks \(day.string(from: date)).\(format.fileExtension)"
    }

    /// Ask where to save, then have the engine write the file there. Beeps if it could not.
    static func save(_ format: Format, withContext: Bool) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = fileName(format)
        panel.allowedContentTypes = [format.contentType]
        NSApplication.shared.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        DispatchQueue.global(qos: .userInitiated).async {
            let ok = EngineRunner.run(arguments(format, withContext: withContext, to: url.path))
            if !ok { DispatchQueue.main.async { NSSound.beep() } }
        }
    }
}
