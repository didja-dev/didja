import Foundation
import os

/// Runs the engine (the Bun binary bundled at Contents/Helpers/didja)
/// for as long as the app is open. The engine reads observations and writes tasks.
final class EngineRunner {
    private var process: Process?
    /// The engine's standard input: one line each time capture writes new screens (SCR-76).
    private var waker: EngineWaker?

    static var bundledEngine: URL {
        Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/didja")
    }

    /// The engine's environment: the app's, plus the database key (SCR-101), so the engine can
    /// read and seal screen text. In the environment of the processes the app starts only; never on disk.
    static var environment: [String: String] {
        var env = ProcessInfo.processInfo.environment
        env["DIDJA_FROM_APP"] = "1"
        if let key = DatabaseKey.base64 { env["DIDJA_DB_KEY"] = key }
        return env
    }

    func start() {
        let engine = Self.bundledEngine
        guard process == nil, FileManager.default.isExecutableFile(atPath: engine.path) else { return }
        let process = Process()
        process.executableURL = engine
        process.arguments = ["run"]
        process.environment = Self.environment
        let input = Pipe()
        process.standardInput = input
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            self.process = process
            waker = EngineWaker(fileDescriptor: input.fileHandleForWriting.fileDescriptor, handle: input.fileHandleForWriting)
        } catch {
            NSLog("Didja: could not start engine: \(error.localizedDescription)")
        }
    }

    /// Tell the running engine that new screens were written, so it reads them at once instead of
    /// at its next 5-second pass (SCR-76). Cheap, never blocks, and harmless if the engine has gone.
    func wake() {
        guard process?.isRunning == true else { return }
        waker?.wake()
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
            process.environment = environment
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
        process.environment = environment
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
        process.environment = environment
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


/// Writes one line to the engine's standard input to wake it (SCR-76). Wakes that come while one is
/// still being written are folded into it; a closed pipe is ignored rather than raising SIGPIPE.
final class EngineWaker {
    private let fd: Int32
    /// Kept so the pipe's write end stays open as long as the waker.
    private let handle: FileHandle?
    private let queue = DispatchQueue(label: "dev.didja.engine-wake")
    private var pending = false
    private let lock = NSLock()

    init(fileDescriptor: Int32, handle: FileHandle? = nil) {
        fd = fileDescriptor
        self.handle = handle
        // Writing to a pipe the engine has closed returns EPIPE instead of killing the app.
        _ = fcntl(fd, F_SETNOSIGPIPE, 1)
        // Never block capture: if the engine is not reading, a wake is simply dropped.
        _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK)
    }

    func wake() {
        lock.lock()
        defer { lock.unlock() }
        guard !pending else { return }
        pending = true
        queue.async { [self] in
            lock.lock()
            pending = false
            lock.unlock()
            var newline: UInt8 = 10
            _ = Darwin.write(fd, &newline, 1)
        }
    }
}
