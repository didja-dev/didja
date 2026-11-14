import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// The on-device model's two questions about chats (WhatsApp, Teams, Slack). Run by the engine as
/// `Didja --chat` and `Didja --chat-reply`, with JSON on standard input. Apple's on-device model,
/// or for `--chat` the local model in Ollama when you turned it on (SCR-108); nothing leaves the Mac.
extension Judge {
    // MARK: Does this message ask something of me?

    struct ChatRequest: Decodable {
        struct Earlier: Decodable { var from: String; var text: String }
        var app: String
        var chat: String
        var group: Bool
        /// In a group: "named" (it tags or names you), "everyone" (it asks every member) or, with
        /// Capture: Everything only, "group" (it names no one; SCR-95).
        var addressed: String?
        /// Your names, so a group message can be seen to be addressed to you.
        var me: [String]
        var from: String
        var message: String
        var before: [Earlier]
        var teach: Teach?
        /// The local model to ask first, when you turned one on (LocalModel.swift, SCR-108).
        var local: LocalModel.Choice?
    }

    struct ChatReply: Encodable {
        var available: Bool
        var asks: Bool?
        var task: String?
        /// The local model that answered; nil for Apple's.
        var model: String?
        var reason: String?
    }

    static let chatInstructions = """
        You read one chat message sent to the reader and decide whether it asks the reader to do something. \
        Answer asks true if the sender wants the reader to answer a question, decide, approve, send, check, fix, \
        buy, call, book or otherwise act. Answer false for greetings, thanks, congratulations, \
        birthday wishes and replies to them, news, jokes, opinions, \
        things the sender will do themselves, and questions that are only small talk. \
        Answer false for statements about the sender: their plans, wishes, offers or feelings \
        ("I want to join as a partner", "I'm thinking of quitting", "I can help next week") ask nothing of the reader. \
        Answer false when the reader already answered it in the earlier messages. \
        A message that thanks the reader or answers something the reader said is false even when it names the reader. \
        "Reply to the message" or "respond to the thanks" is never a task. \
        In a group chat, answer true only if the request is addressed to the reader: by name, by an @mention, \
        or as a direct reply to the reader; or if it asks every member for their own answer or action, \
        such as "everyone please confirm", "each of you vote", "כולם תאשרו הגעה". \
        A request that any one person can handle for the group ("can someone restart the server?", "מישהו יכול…?"), \
        or one meant for someone else, is false. \
        Then write the task: what the reader has to do, as an instruction of 3 to 9 words that starts with a verb \
        and names the person asking. Examples: Send Dana the signed contract. Approve Maya's budget request. \
        When the sender asks a question or the reader's opinion, write "Answer <name>: " and the question in a few words, \
        as in: Answer Ron: does Tuesday work. Answer Noa: are 20 options enough. \
        Never write a vague task such as "Tell Ron what he thinks" or "Tell Ron what you think": say what the question is. \
        For false, write: none. \
        Write the whole task in the language of the message, names included.
        """

    /// Added for a message written mostly in Hebrew, as for mail (kept apart so Hebrew examples do
    /// not leak into English tasks).
    static let hebrewChatInstructions = """
        This message is written in Hebrew. Write the task in Hebrew, naming the person in Hebrew as they wrote it. \
        Hebrew examples: שלח למיכל את החשבונית של מרץ. אשר את התקציב של מאיה. \
        For a question: ענה לרון: האם יום שלישי מתאים. ענה לנועה: האם 20 אפשרויות מספיקות. \
        The names in the examples are made up and must never be copied.
        """

    static func chatInstructions(for request: ChatRequest) -> String {
        let base = compose(chatInstructions, request.teach.map { Teach(instructions: $0.instructions, examples: nil) })
        let language = isHebrew(request.message) ? base + " " + hebrewChatInstructions : base
        return compose(language, request.teach.map { Teach(instructions: nil, examples: $0.examples) })
    }

    static func chatPrompt(for request: ChatRequest) -> String {
        let earlier = request.before.suffix(6)
            .map { "\($0.from == "me" ? "The reader" : String($0.from.prefix(60))): \($0.text.prefix(300))" }
            .joined(separator: "\n")
        return """
        App: \(request.app.prefix(40))
        Chat: \(request.chat.prefix(80)) (\(request.group ? "a group chat" : "a one-to-one chat with the sender"))\(request.addressed == "everyone" ? "\nIt does not name the reader; it may be addressed to every member." : request.addressed == "named" ? "\nIt tags or names the reader." : request.addressed == "group" ? "\nIt names no one: it was said to the whole group. Answer true only if it asks the group for something the reader, as a member, could be the one to do." : "")
        \(request.group ? "The reader's names: \(request.me.prefix(4).joined(separator: ", ").prefix(160))\n" : "")        \(earlier.isEmpty ? "" : "Earlier messages:\n\(earlier)\n")
        The message, from \(request.from.prefix(60)), who is the person asking:
        \(request.message.prefix(1200))

        Does this message ask the reader to do something, and what? \
        In the task, "me" in the message is \(request.from.prefix(60)); name \(request.from.prefix(60)), never the reader.
        """
    }

    /// Entry point for `Didja --chat`. Never returns.
    static func chatFromCommandLine() -> Never {
        JudgeServer.oneShot("chat")
    }

    static func readChat(_ request: ChatRequest) async -> ChatReply {
        if let local = request.local, let reply = await LocalModel.readChat(request, model: local.model) { return reply }
        #if canImport(FoundationModels)
        if #available(macOS 26.0, *) { return await OnDeviceChat.read(request) }
        #endif
        return ChatReply(available: false, reason: "needs macOS 26 or later")
    }

    // MARK: Does my reply settle it, or put it off?

    struct ReplyRequest: Decodable {
        var app: String
        var task: String
        var ask: String
        var reply: String
        var teach: Teach?
    }

    struct ReplyVerdict: Encodable {
        var available: Bool
        /// "settles", "defers" or "unsure".
        var verdict: String?
        var reason: String?
    }

    static let replyInstructions = """
        Someone asked the reader to do something in a chat, and the reader replied. Decide what the reply means. \
        settles: the reply does it or answers it now: gives the answer, the decision, the approval, says it is done or sent, \
        or attaches what was asked for. \
        defers: the reply puts it off or only acknowledges it: later, tomorrow, will check, will do, on it, let me see, \
        a question back, or anything that leaves it still to be done. \
        unsure: cannot tell. When in doubt, answer defers or unsure, never settles. \
        A reply saying it has already been done, often one word in the past tense, settles it: \
        ordered, sent, paid, booked, done, approved, fixed. In Hebrew: הזמנתי, שלחתי, שילמתי, קבעתי, בוצע, סגרתי, אישרתי, טיפלתי. \
        A reply about doing it in the future defers it: I will order it, אזמין, אשלח מחר, אבדוק. \
        Emoji, sent as a reply or as a reaction ("[reacted 👍 to …]"): they settle an ask that only wanted \
        a yes, an acknowledgement, a like or an approval (confirm, ok?, agree?, thanks, a greeting); \
        they defer an ask that needs something done or sent, where 👍 means "will do".
        """

    static func replyPrompt(for request: ReplyRequest) -> String {
        """
        The task: \(request.task.prefix(200))
        \(request.ask.isEmpty ? "" : "What was asked: \(request.ask.prefix(600))\n")The reader's reply: \(request.reply.prefix(600))

        Does the reply settle the task, or put it off?
        """
    }

    /// Entry point for `Didja --chat-reply`. Never returns.
    static func chatReplyFromCommandLine() -> Never {
        JudgeServer.oneShot("chat-reply")
    }

    static func judgeReply(_ request: ReplyRequest) async -> ReplyVerdict {
        #if canImport(FoundationModels)
        if #available(macOS 26.0, *) { return await OnDeviceChat.judgeReply(request) }
        #endif
        return ReplyVerdict(available: false, reason: "needs macOS 26 or later")
    }
}

#if canImport(FoundationModels)
@available(macOS 26.0, *)
private enum OnDeviceChat {
    @Generable
    struct Ask {
        @Guide(description: "true only if the message asks the reader to do something; in a group chat, only if it is addressed to the reader.")
        var asks: Bool
        @Guide(description: "The thing to do, 3 to 9 words, starting with a verb and naming the sender who asks, never the reader. 'none' if nothing is asked.")
        var task: String
    }

    @Generable
    enum Meaning: String { case settles, defers, unsure }

    @Generable
    struct Settled {
        @Guide(description: "settles: the reply does or answers it now. defers: it puts it off or only acknowledges it. unsure: cannot tell.")
        var meaning: Meaning
    }

    static func read(_ request: Judge.ChatRequest) async -> Judge.ChatReply {
        let model = SystemLanguageModel.default
        guard case .available = model.availability else {
            return Judge.ChatReply(available: false, reason: "on-device model unavailable: \(model.availability)")
        }
        do {
            let session = LanguageModelSession(model: model, instructions: Judge.chatInstructions(for: request))
            let response = try await session.respond(
                to: Judge.chatPrompt(for: request), generating: Ask.self, options: GenerationOptions(temperature: 0))
            return Judge.ChatReply(available: true, asks: response.content.asks, task: response.content.task)
        } catch {
            return Judge.ChatReply(available: false, reason: "model error: \(error.localizedDescription)")
        }
    }

    static func judgeReply(_ request: Judge.ReplyRequest) async -> Judge.ReplyVerdict {
        let model = SystemLanguageModel.default
        guard case .available = model.availability else {
            return Judge.ReplyVerdict(available: false, reason: "on-device model unavailable: \(model.availability)")
        }
        do {
            let session = LanguageModelSession(model: model, instructions: Judge.compose(Judge.replyInstructions, request.teach))
            let response = try await session.respond(
                to: Judge.replyPrompt(for: request), generating: Settled.self, options: GenerationOptions(temperature: 0))
            return Judge.ReplyVerdict(available: true, verdict: response.content.meaning.rawValue)
        } catch {
            return Judge.ReplyVerdict(available: false, reason: "model error: \(error.localizedDescription)")
        }
    }
}
#endif
