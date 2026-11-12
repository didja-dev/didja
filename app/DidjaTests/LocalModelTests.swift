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
