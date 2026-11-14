import Foundation

/// A local model in Ollama, the maintainer's chosen exception to "Apple's on-device model only"
/// (docs/DECISIONS.md, 2026-11-12). Off until you turn it on in Settings › General; the engine
/// keeps the switch (`didja local-model`) and sends `local: { model }` with the jobs it was
/// measured on: emails (`--needs-reply`), whether a screen shows a task done (`--looks-done`), who a
/// list is for (`--judge`, SCR-70) and whether a chat message asks something of you (`--chat`, SCR-108).
///
/// It asks Ollama on this Mac only: the address is fixed to 127.0.0.1, never a name or another
/// host, and the system proxy is not used. Same instructions and prompts as Apple's model. Any
/// failure (Ollama not running, the model missing, a slow or odd answer) gives nil, and the judge
/// asks Apple's model instead.
enum LocalModel {
    struct Choice: Codable, Equatable {
        var model: String
    }

    static let base = URL(string: "http://127.0.0.1:11434")!
    /// How long Ollama keeps the model loaded after a question (SCR-77).
    static let keepAlive = "30m"

    /// A model name as `ollama list` prints it ("qwen3.8:latest"); the engine checks the same.
    static func isModelName(_ name: String) -> Bool {
        name.range(of: #"^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}(:[A-Za-z0-9._-]{1,40})?$"#, options: .regularExpression) != nil
    }

    // MARK: Answer shapes

    /// For email, the words the instructions use (reply, action, none): with Apple's shape
    /// (asks + writeBack/elsewhere/nothing) a local model got 5 of 14 right, with these 14 (engine/eval/ollama.ts).
    static let mailSchema: [String: Any] = [
        "type": "object", "required": ["need", "task", "asker"],
        "properties": [
            "need": ["type": "string", "enum": ["reply", "action", "none"]],
            "task": ["type": "string", "description": "The thing to do, 3 to 9 words, starting with a verb and naming the person or service. 'none' if nothing is asked."],
            "asker": ["type": "string", "description": "The name signed under the request, after the thanks or regards, copied exactly as written there in its own language. If nobody signed, the sender. For a forwarded message never the forwarder."],
        ],
    ]

    static let lookSchema: [String: Any] = [
        "type": "object", "required": ["seen"],
        "properties": [
            "seen": ["type": "string", "enum": ["done", "notDone", "unsure"],
                     "description": "done: the screen shows the outcome of the task. notDone: it only mentions it, or shows instructions, code, an unused form or an error. unsure: cannot tell."],
        ],
    ]

    /// Who a list is for (SCR-70): the same answer shape as Apple's `Verdict`.
    static let listSchema: [String: Any] = [
        "type": "object", "required": ["audience"],
        "properties": [
            "audience": ["type": "string", "enum": ["user", "assistant"],
                         "description": "user: the list tells the reader what to do themselves. assistant: the list is the assistant's own plan, or a report of what it did or how something works."],
        ],
    ]

    /// Does a chat message ask the reader to do something (SCR-108): the same answer shape as
    /// Apple's `Ask` in ChatJudge.swift, guides included.
    static let chatAskSchema: [String: Any] = [
        "type": "object", "required": ["asks", "task"],
        "properties": [
            "asks": ["type": "boolean", "description": "true only if the message asks the reader to do something; in a group chat, only if it is addressed to the reader."],
            "task": ["type": "string", "description": "The thing to do, 3 to 9 words, starting with a verb and naming the sender who asks, never the reader. 'none' if nothing is asked."],
        ],
    ]

    // MARK: Requests and answers (pure, tested)

    static func chatBody(model: String, system: String, prompt: String, schema: [String: Any]) -> Data {
        let body: [String: Any] = [
            "model": model, "stream": false, "think": false, "format": schema,
            // Kept loaded between questions (SCR-77): a cold start took about 8 s, a warm one 2–3 s.
            "keep_alive": keepAlive,
            "options": ["temperature": 0],
            "messages": [["role": "system", "content": system], ["role": "user", "content": prompt]],
        ]
        return (try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])) ?? Data()
    }

    /// The object the model wrote, from Ollama's /api/chat reply.
    static func answer(from data: Data) -> [String: Any]? {
        guard let reply = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let content = (reply["message"] as? [String: Any])?["content"] as? String,
              let object = try? JSONSerialization.jsonObject(with: Data(content.utf8)) as? [String: Any] else { return nil }
        return object
    }

    static func mailReply(from answer: [String: Any], model: String) -> Judge.MailReply? {
        guard let need = answer["need"] as? String, ["reply", "action", "none"].contains(need) else { return nil }
        let task = (answer["task"] as? String).map { String($0.prefix(200)) } ?? ""
        let asker = (answer["asker"] as? String).map { String($0.prefix(120)) }
        return Judge.MailReply(available: true, need: need, task: need == "none" ? "none" : task, asker: asker, model: model)
    }

    static func lookReply(from answer: [String: Any], model: String) -> Judge.LookReply? {
        guard let seen = answer["seen"] as? String, ["done", "notDone", "unsure"].contains(seen) else { return nil }
        return Judge.LookReply(available: true, seen: seen, model: model)
    }

    static func listReply(from answer: [String: Any], model: String) -> Judge.Reply? {
        guard let audience = answer["audience"] as? String, ["user", "assistant"].contains(audience) else { return nil }
        return Judge.Reply(available: true, audience: audience, model: model)
    }

    static func chatAskReply(from answer: [String: Any], model: String) -> Judge.ChatReply? {
        // A JSON boolean only: NSNumber 0/1 also casts to Bool, so check it is a real boolean.
        guard let value = answer["asks"] as? NSNumber, CFGetTypeID(value) == CFBooleanGetTypeID() else { return nil }
        let asks = value.boolValue
        let task = (answer["task"] as? String).map { String($0.prefix(200)) } ?? ""
        return Judge.ChatReply(available: true, asks: asks, task: asks ? task : "none", model: model)
    }

    /// The model names in Ollama's /api/tags reply.
    static func modelNames(from data: Data) -> [String] {
        guard let reply = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let models = reply["models"] as? [[String: Any]] else { return [] }
        return models.compactMap { $0["name"] as? String }.filter(isModelName).sorted()
    }

    // MARK: Asking Ollama

    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.connectionProxyDictionary = [:]
        config.timeoutIntervalForRequest = 30
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }()

    private static func chat(model: String, system: String, prompt: String, schema: [String: Any]) async -> [String: Any]? {
        guard isModelName(model) else { return nil }
        var request = URLRequest(url: base.appendingPathComponent("api/chat"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = chatBody(model: model, system: system, prompt: prompt, schema: schema)
        guard let (data, response) = try? await session.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return answer(from: data)
    }

    static func needsReply(_ request: Judge.MailRequest, model: String) async -> Judge.MailReply? {
        guard let answer = await chat(model: model, system: Judge.mailInstructions(for: request),
                                      prompt: Judge.mailPrompt(for: request), schema: mailSchema) else { return nil }
        return mailReply(from: answer, model: model)
    }

    static func looksDone(_ request: Judge.LookRequest, model: String) async -> Judge.LookReply? {
        guard let answer = await chat(model: model, system: Judge.compose(Judge.lookInstructions, request.teach),
                                      prompt: Judge.lookPrompt(for: request), schema: lookSchema) else { return nil }
        return lookReply(from: answer, model: model)
    }

    static func judgeList(_ request: Judge.Request, model: String) async -> Judge.Reply? {
        guard let answer = await chat(model: model, system: Judge.compose(Judge.instructions, request.teach),
                                      prompt: Judge.prompt(for: request), schema: listSchema) else { return nil }
        return listReply(from: answer, model: model)
    }

    static func readChat(_ request: Judge.ChatRequest, model: String) async -> Judge.ChatReply? {
        guard let answer = await chat(model: model, system: Judge.chatInstructions(for: request),
                                      prompt: Judge.chatPrompt(for: request), schema: chatAskSchema) else { return nil }
        return chatAskReply(from: answer, model: model)
    }

    /// A request that only loads the model, and keeps it loaded (SCR-77): Ollama loads a model for
    /// a generate request with no prompt. Asked when the judge server starts with a local model on.
    static func warmBody(model: String) -> Data {
        (try? JSONSerialization.data(withJSONObject: ["model": model, "keep_alive": keepAlive], options: [.sortedKeys])) ?? Data()
    }

    @discardableResult
    static func warm(model: String) async -> Bool {
        guard isModelName(model) else { return false }
        var request = URLRequest(url: base.appendingPathComponent("api/generate"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = warmBody(model: model)
        guard let (_, response) = try? await session.data(for: request) else { return false }
        return (response as? HTTPURLResponse)?.statusCode == 200
    }

    /// The models Ollama has on this Mac, or nil when Ollama is not running. For Settings.
    static func installed() async -> [String]? {
        var request = URLRequest(url: base.appendingPathComponent("api/tags"))
        request.timeoutInterval = 3
        guard let (data, response) = try? await session.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return modelNames(from: data)
    }

    // MARK: The switch (kept by the engine)

    struct Status: Decodable, Equatable {
        var on: Bool
        var model: String?
    }

    static func status() -> Status {
        let output = EngineRunner.output(["local-model", "status", "--json"]) ?? ""
        return (try? JSONDecoder().decode(Status.self, from: Data(output.utf8))) ?? Status(on: false, model: nil)
    }

    @discardableResult
    static func set(_ model: String?) -> Bool {
        guard let model else { return EngineRunner.run(["local-model", "off"]) }
        return isModelName(model) && EngineRunner.run(["local-model", "on", model])
    }
}
