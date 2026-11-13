import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// `Didja --judge-server` (SCR-77): the model jobs the engine asks, answered by one long-lived
/// process instead of a new one per question, so the app is launched and the on-device model
/// loaded once. One JSON request per line on standard input, one JSON reply per line on standard
/// output, in order. Same jobs, instructions, prompts and replies as the one-shot flags
/// (`--judge`, `--looks-done`, …), which now go through `answer` too.
///
///     → {"id": 7, "job": "judge", "request": { …what `Didja --judge` reads… }}
///     ← {"id": 7, "reply": { …what `Didja --judge` prints… }}
///
/// The first line it writes is `{"ready":true}`. It stops when its standard input closes.
enum JudgeServer {
    /// The jobs, by the one-shot flag they replace (without its dashes); "warm" loads the models.
    static let jobs = ["judge", "title", "needs-reply", "looks-done", "criteria", "chat", "chat-reply", "warm"]

    /// A question cut short after this long is answered "not available", as a one-shot spawn the
    /// engine gave up on was.
    static let timeout: TimeInterval = 40

    struct Request: Equatable {
        var id: Int
        var job: String
        /// The job's own request, as JSON.
        var body: Data
    }

    /// One request line, or nil when it is not one.
    static func parse(_ line: String) -> Request? {
        guard let object = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
              let id = object["id"] as? Int, let job = object["job"] as? String else { return nil }
        let request = object["request"] ?? [String: Any]()
        guard JSONSerialization.isValidJSONObject(request),
              let body = try? JSONSerialization.data(withJSONObject: request) else { return nil }
        return Request(id: id, job: job, body: body)
    }

    /// One reply line: the job's reply, exactly as the one-shot flag prints it.
    static func replyLine(id: Int, reply: Data) -> String {
        let text = reply.isEmpty ? "{\"available\":false,\"reason\":\"no answer\"}" : String(decoding: reply, as: UTF8.self)
        return "{\"id\":\(id),\"reply\":\(text)}"
    }

    static let unavailable = Data("{\"available\":false,\"reason\":\"timed out\"}".utf8)

    /// What `Didja --<job>` prints for this request.
    static func answer(job: String, request input: Data) async -> Data {
        func encode<T: Encodable>(_ value: T) -> Data { (try? JSONEncoder().encode(value)) ?? Data() }
        switch job {
        case "judge":
            if let request = try? JSONDecoder().decode(Judge.Request.self, from: input), !request.steps.isEmpty {
                return encode(await Judge.judge(request))
            }
            return encode(Judge.Reply(available: false, reason: "bad request"))
        case "title":
            if let request = try? JSONDecoder().decode(Judge.Request.self, from: input), !request.steps.isEmpty {
                return encode(await Judge.suggestTitle(request))
            }
            return encode(Judge.TitleReply(available: false, reason: "bad request"))
        case "needs-reply":
            if let request = try? JSONDecoder().decode(Judge.MailRequest.self, from: input), !request.body.isEmpty {
                return encode(await Judge.needsReply(request))
            }
            return encode(Judge.MailReply(available: false, reason: "bad request"))
        case "looks-done":
            if let request = try? JSONDecoder().decode(Judge.LookRequest.self, from: input), !request.text.isEmpty {
                return encode(await Judge.looksDone(request))
            }
            return encode(Judge.LookReply(available: false, reason: "bad request"))
        case "criteria":
            if let request = try? JSONDecoder().decode(Judge.CriteriaRequest.self, from: input), !request.task.isEmpty {
                return encode(await Judge.doneCriteria(request))
            }
            return encode(Judge.CriteriaReply(available: false, reason: "bad request"))
        case "chat":
            if let request = try? JSONDecoder().decode(Judge.ChatRequest.self, from: input), !request.message.isEmpty {
                return encode(await Judge.readChat(request))
            }
            return encode(Judge.ChatReply(available: false, reason: "bad request"))
        case "chat-reply":
            if let request = try? JSONDecoder().decode(Judge.ReplyRequest.self, from: input), !request.reply.isEmpty {
                return encode(await Judge.judgeReply(request))
            }
            return encode(Judge.ReplyVerdict(available: false, reason: "bad request"))
        case "warm":
            let local = try? JSONDecoder().decode(Warm.self, from: input)
            prewarm()
            if let model = local?.local?.model { await LocalModel.warm(model: model) }
            return Data("{\"available\":true}".utf8)
        default:
            return Data("{\"available\":false,\"reason\":\"unknown job\"}".utf8)
        }
    }

    private struct Warm: Decodable { var local: LocalModel.Choice? }

    /// Load Apple's on-device model now, so the first question does not wait for it.
    static func prewarm() {
        #if canImport(FoundationModels)
        if #available(macOS 26.0, *), case .available = SystemLanguageModel.default.availability {
            LanguageModelSession().prewarm()
        }
        #endif
    }

    /// The job's answer, or "not available" if it takes longer than `timeout`. A question that
    /// runs over is left to finish on its own; the next one is not held up by it.
    static func answer(_ request: Request, timeout: TimeInterval = timeout) async -> Data {
        await within(timeout) { await answer(job: request.job, request: request.body) }
    }

    /// `work`'s result, or `unavailable` if it takes longer than `seconds`.
    static func within(_ seconds: TimeInterval, _ work: @escaping @Sendable () async -> Data) async -> Data {
        await withCheckedContinuation { (done: CheckedContinuation<Data, Never>) in
            let once = Once()
            Task {
                let reply = await work()
                if once.claim() { done.resume(returning: reply) }
            }
            Task {
                try? await Task.sleep(for: .seconds(seconds))
                if once.claim() { done.resume(returning: unavailable) }
            }
        }
    }

    private final class Once: @unchecked Sendable {
        private let lock = NSLock()
        private var claimed = false
        func claim() -> Bool {
            lock.lock()
            defer { lock.unlock() }
            if claimed { return false }
            claimed = true
            return true
        }
    }

    /// One reply or line on standard output, whole.
    static func emit(_ line: String) {
        FileHandle.standardOutput.write(Data((line + "\n").utf8))
    }

    /// Entry point for `Didja --judge-server`. Never returns; exits when standard input closes.
    static func serve() -> Never {
        // The engine opens the pipe without blocking; read it the ordinary way.
        let flags = fcntl(STDIN_FILENO, F_GETFL)
        if flags >= 0 { _ = fcntl(STDIN_FILENO, F_SETFL, flags & ~O_NONBLOCK) }
        signal(SIGPIPE, SIG_IGN)
        prewarm()
        emit("{\"ready\":true}")
        let (lines, feed) = AsyncStream.makeStream(of: String.self)
        Thread.detachNewThread {
            while let line = readLine(strippingNewline: true) { feed.yield(line) }
            feed.finish()
        }
        Task {
            // One question at a time, in the order asked.
            for await line in lines {
                guard let request = parse(line) else { continue }
                emit(replyLine(id: request.id, reply: await answer(request)))
            }
            exit(0)
        }
        dispatchMain()
    }

    /// For the one-shot flags: read the whole request, print the reply, exit.
    static func oneShot(_ job: String) -> Never {
        let input = FileHandle.standardInput.readDataToEndOfFile()
        Task {
            let reply = await answer(job: job, request: input)
            if !reply.isEmpty { FileHandle.standardOutput.write(reply) }
            exit(0)
        }
        dispatchMain()
    }
}
