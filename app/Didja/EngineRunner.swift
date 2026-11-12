import Foundation
import os

/// Runs the engine (the Bun binary bundled at Contents/Helpers/didja)
/// for as long as the app is open. The engine reads observations and writes tasks.
final class EngineRunner {
    private var process: Process?

    static var bundledEngine: URL {
        Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/didja")
    }

    func start() {
        let engine = Self.bundledEngine
        guard process == nil, FileManager.default.isExecutableFile(atPath: engine.path) else { return }
        let process = Process()
        process.executableURL = engine
        process.arguments = ["run"]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            self.process = process
        } catch {
            NSLog("Didja: could not start engine: \(error.localizedDescription)")
        }
    }

    /// Run one engine command and wait for it (e.g. `done 12`). The engine owns
    /// the rules for ticking, so the app asks it rather than writing tasks itself.
    @discardableResult
    /// Run one engine command. A failed one is logged with what the engine said, and tried once
    /// more after a moment (the database may have been busy), so a click is never silently lost.
    static func run(_ arguments: [String]) -> Bool {
        for attempt in 0..<2 {
            let process = Process()
            let errors = Pipe()
            process.executableURL = bundledEngine
            process.arguments = arguments
            process.standardOutput = FileHandle.nullDevice
            process.standardError = errors
            guard (try? process.run()) != nil else {
                log.error("engine \(arguments.first ?? "", privacy: .public) could not start")
                return false
            }
            let said = String(decoding: errors.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            process.waitUntilExit()
            if process.terminationStatus == 0 { return true }
            // The command name only, never its arguments (they can hold a task's words).
            log.error("engine \(arguments.first ?? "", privacy: .public) failed (attempt \(attempt + 1)): \(said.prefix(300), privacy: .private)")
            if attempt == 0 { Thread.sleep(forTimeInterval: 0.5) }
        }
        return false
    }

    private static let log = Logger(subsystem: "dev.didja.app", category: "engine")

    /// Run one engine command with text on its standard input.
    @discardableResult
    static func run(_ arguments: [String], input: String?) -> Bool {
        guard let input else { return run(arguments) }
        let process = Process()
        let pipe = Pipe()
        process.executableURL = bundledEngine
        process.arguments = arguments
        process.standardInput = pipe
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        guard (try? process.run()) != nil else { return false }
        pipe.fileHandleForWriting.write(Data(input.utf8))
        try? pipe.fileHandleForWriting.close()
        process.waitUntilExit()
        return process.terminationStatus == 0
    }

    /// Run one engine command and return what it printed.
    static func output(_ arguments: [String]) -> String? {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = bundledEngine
        process.arguments = arguments
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        guard (try? process.run()) != nil else { return nil }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func stop() {
        process?.terminate()
        process = nil
    }
}
