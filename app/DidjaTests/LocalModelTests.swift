import XCTest
@testable import Didja

/// The local model (Ollama): this Mac only, the same instructions as Apple's model, and an odd
/// answer is no answer (Apple's model is asked instead), never a tick.
final class LocalModelTests: XCTestCase {
    func testItOnlyEverTalksToThisMac() {
        XCTAssertEqual(LocalModel.base.scheme, "http")
        XCTAssertEqual(LocalModel.base.host, "127.0.0.1")
        XCTAssertEqual(LocalModel.base.port, 11434)
    }

    func testOnlyModelNamesAreTaken() {
        for name in ["qwen3.8:latest", "gemma3:12b", "library/llama3.1:8b-instruct-q4_K_M"] { XCTAssertTrue(LocalModel.isModelName(name), name) }
        for name in ["", " qwen", "http://example.com/m", "../m", "qwen;rm", "a b"] { XCTAssertFalse(LocalModel.isModelName(name), name) }
    }

    func testItIsShownWhatApplesModelIsShown() throws {
        let email = Judge.MailRequest(from: "Dana Levi", subject: "Q3 numbers", body: "Could you send me the Q3 numbers?\nDana")
        let body = LocalModel.chatBody(model: "qwen3.8:latest", system: Judge.mailInstructions(for: email),
                                       prompt: Judge.mailPrompt(for: email), schema: LocalModel.mailSchema)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(json["model"] as? String, "qwen3.8:latest")
        XCTAssertEqual(json["think"] as? Bool, false)
        XCTAssertEqual((json["options"] as? [String: Any])?["temperature"] as? Int, 0)
        let messages = try XCTUnwrap(json["messages"] as? [[String: String]])
        XCTAssertEqual(messages.map { $0["role"] }, ["system", "user"])
        XCTAssertEqual(messages[0]["content"], Judge.mailInstructions(for: email))
        XCTAssertEqual(messages[1]["content"], Judge.mailPrompt(for: email))
    }

    private func reply(_ content: String) -> Data {
        try! JSONSerialization.data(withJSONObject: ["message": ["role": "assistant", "content": content]])
    }

    func testAnswersAreReadAndNamedByTheModel() throws {
        let mail = try XCTUnwrap(LocalModel.answer(from: reply(#"{"need":"reply","task":"Send Dana the Q3 numbers","asker":"Dana Levi"}"#)))
        XCTAssertEqual(LocalModel.mailReply(from: mail, model: "qwen3.8:latest"),
                       Judge.MailReply(available: true, need: "reply", task: "Send Dana the Q3 numbers", asker: "Dana Levi", model: "qwen3.8:latest"))
        let look = try XCTUnwrap(LocalModel.answer(from: reply(#"{"seen":"notDone"}"#)))
        XCTAssertEqual(LocalModel.lookReply(from: look, model: "m")?.seen, "notDone")
    }

    /// A wrong tick is the bug Didja exists to prevent: anything but a clean answer falls back.
    func testAnOddAnswerIsNoAnswerNeverDone() {
        for content in [#"{"seen":"Done"}"#, #"{"seen":"yes"}"#, #"{"done":true}"#, "done", "", #"{"seen":null}"#] {
            let answer = LocalModel.answer(from: reply(content))
            XCTAssertNil(answer.flatMap { LocalModel.lookReply(from: $0, model: "m") }, content)
        }
        XCTAssertNil(LocalModel.answer(from: Data(#"{"error":"model 'x' not found"}"#.utf8)))
        XCTAssertNil(LocalModel.mailReply(from: ["need": "maybe", "task": "x"], model: "m"))
    }

    func testTheModelsOllamaHas() {
        let tags = Data(#"{"models":[{"name":"qwen3.8:latest"},{"name":"gemma3:12b"},{"name":"bad name"}]}"#.utf8)
        XCTAssertEqual(LocalModel.modelNames(from: tags), ["gemma3:12b", "qwen3.8:latest"])
        XCTAssertEqual(LocalModel.modelNames(from: Data("nope".utf8)), [])
    }
}

/// SCR-70: the local model may judge who a list is for; an odd answer falls back to Apple's.
final class LocalListJudgeTests: XCTestCase {
    func testAListVerdictIsReadAndAnOddOneIsNot() throws {
        XCTAssertEqual(LocalModel.listReply(from: ["audience": "assistant"], model: "m")?.audience, "assistant")
        XCTAssertEqual(LocalModel.listReply(from: ["audience": "user"], model: "m")?.model, "m")
        for odd: [String: Any] in [["audience": "User"], ["audience": "both"], ["who": "user"], [:]] {
            XCTAssertNil(LocalModel.listReply(from: odd, model: "m"))
        }
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: LocalModel.chatBody(
            model: "m", system: Judge.instructions, prompt: "p", schema: LocalModel.listSchema)) as? [String: Any])
        XCTAssertEqual((body["format"] as? [String: Any])?["required"] as? [String], ["audience"])
    }

    func testTheJudgeRequestCarriesTheLocalModelAndTheReply() throws {
        let request = try JSONDecoder().decode(Judge.Request.self, from: Data(
            #"{"leadIn":"Next steps:","steps":["Run it"],"reply":"Done.\nNext steps:\n1. Run it","local":{"model":"qwen3.8:latest"}}"#.utf8))
        XCTAssertEqual(request.local?.model, "qwen3.8:latest")
        XCTAssertTrue(Judge.prompt(for: request).contains("The assistant's whole reply:\n\"\"\"\nDone.\nNext steps:\n1. Run it\n\"\"\""))
    }
}

/// SCR-77: the long-lived judge's line format, and Ollama kept loaded.
final class JudgeServerTests: XCTestCase {
    func testARequestLineIsReadWithItsIdJobAndRequest() throws {
        let line = #"{"id":7,"job":"judge","request":{"leadIn":"Next steps:","steps":["Run it"]}}"#
        let request = try XCTUnwrap(JudgeServer.parse(line))
        XCTAssertEqual(request.id, 7)
        XCTAssertEqual(request.job, "judge")
        let decoded = try JSONDecoder().decode(Judge.Request.self, from: request.body)
        XCTAssertEqual(decoded.steps, ["Run it"])
        // No request object is an empty one; no id or job, or not JSON, is not a request.
        XCTAssertEqual(JudgeServer.parse(#"{"id":1,"job":"warm"}"#)?.body, Data("{}".utf8))
        for bad in ["", "hello", #"{"job":"judge"}"#, #"{"id":"7","job":"judge"}"#, #"{"id":7}"#] {
            XCTAssertNil(JudgeServer.parse(bad), bad)
        }
    }

    func testAReplyLineCarriesTheJobsReplyAsItIs() throws {
        let reply = Data(#"{"audience":"user","available":true}"#.utf8)
        let line = JudgeServer.replyLine(id: 7, reply: reply)
        XCTAssertEqual(line, #"{"id":7,"reply":{"audience":"user","available":true}}"#)
        XCTAssertFalse(line.contains("\n"), "one reply, one line")
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
        XCTAssertEqual(object["id"] as? Int, 7)
        // An empty reply (it could not be written) still answers the question: not available.
        let empty = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(JudgeServer.replyLine(id: 8, reply: Data()).utf8)) as? [String: Any])
        XCTAssertEqual((empty["reply"] as? [String: Any])?["available"] as? Bool, false)
    }

    func testTheServerAnswersAsTheOneShotFlagsDo() async throws {
        // A bad request gets the same reply as `Didja --judge` gives it; an unknown job says so.
        let bad = await JudgeServer.answer(job: "judge", request: Data(#"{"leadIn":"x","steps":[]}"#.utf8))
        let decoded = try XCTUnwrap(JSONSerialization.jsonObject(with: bad) as? [String: Any])
        XCTAssertEqual(decoded["available"] as? Bool, false)
        XCTAssertEqual(decoded["reason"] as? String, "bad request")
        let unknown = await JudgeServer.answer(job: "nope", request: Data("{}".utf8))
        XCTAssertEqual((try JSONSerialization.jsonObject(with: unknown) as? [String: Any])?["reason"] as? String, "unknown job")
        for job in JudgeServer.jobs where job != "warm" {
            let reply = await JudgeServer.answer(job: job, request: Data("{}".utf8))
            XCTAssertEqual((try JSONSerialization.jsonObject(with: reply) as? [String: Any])?["available"] as? Bool, false, job)
        }
    }

    func testAQuestionThatTakesTooLongIsAnsweredNotAvailable() async {
        let started = Date()
        let late = await JudgeServer.within(0.1) {
            try? await Task.sleep(for: .seconds(5))
            return Data("late".utf8)
        }
        XCTAssertEqual(late, JudgeServer.unavailable)
        XCTAssertLessThan(Date().timeIntervalSince(started), 2)
        let quick = await JudgeServer.within(5) { Data("quick".utf8) }
        XCTAssertEqual(quick, Data("quick".utf8))
    }

    func testOllamaIsAskedToKeepTheModelLoaded() throws {
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: LocalModel.chatBody(
            model: "m", system: "s", prompt: "p", schema: LocalModel.lookSchema)) as? [String: Any])
        XCTAssertEqual(body["keep_alive"] as? String, "30m")
        let warm = try XCTUnwrap(JSONSerialization.jsonObject(with: LocalModel.warmBody(model: "qwen3.8:latest")) as? [String: Any])
        XCTAssertEqual(warm as? [String: String], ["model": "qwen3.8:latest", "keep_alive": "30m"])
    }
}
