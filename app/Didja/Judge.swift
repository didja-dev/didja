import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Asks Apple's on-device language model who a list is for: something Claude
/// is asking you to do, or Claude's own plan or report.
///
/// The engine calls this by running the app's binary as `Didja --judge`
/// with the list as JSON on standard input, and reads JSON back.
///
/// Only `SystemLanguageModel`, which runs on this Mac, is used. The framework
/// also offers a Private Cloud Compute model; that one must never be used here,
/// because nothing may leave the device.
enum Judge {
    /// What you taught the model for one job (SCR-24), sent by the engine with each question.
    struct Teach: Codable, Equatable {
        /// Your instructions, replacing the built-in ones.
        var instructions: String?
        /// Your corrections, as sentences.
        var examples: [String]?
    }

    /// The instructions for one question: yours if you wrote some, otherwise the built-in
    /// ones, followed by the corrections you made.
    static func compose(_ builtIn: String, _ teach: Teach?) -> String {
        let own = teach?.instructions?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        var text = own.isEmpty ? builtIn : String(own.prefix(4000))
        let examples = (teach?.examples ?? []).suffix(12).map { "- \($0.prefix(240))" }
        if !examples.isEmpty {
            text += "\n\nThe person using this app corrected earlier answers. Answer the same way in cases like these:\n" + examples.joined(separator: "\n")
        }
        return text
    }

    /// Whether the on-device model can be used on this Mac, in words, for the Privacy window.
    static var modelStatus: String {
        #if canImport(FoundationModels)
        if #available(macOS 26.0, *) { return OnDevice.status }
        #endif
        return "Not available: needs macOS 26 or later"
    }

    struct Request: Decodable {
        /// The line that introduces the list.
        var leadIn: String
        var steps: [String]
        /// The first lines of text after the list, when there are any.
        var after: [String]?
        /// What the person asked just before the reply the list is in, when it is in view.
        var asked: String?
        /// The whole reply the list is in, bounded by the engine (SCR-70).
        var reply: String?
        var teach: Teach?
        /// The local model to ask first, when you turned one on (LocalModel.swift). Lists only (SCR-70):
        /// it was measured on them (engine/eval/lists.ts); titles stay with Apple's model.
        var local: LocalModel.Choice?
    }

    struct Reply: Encodable {
        var available: Bool
        /// "user" or "assistant" when available.
        var audience: String?
        var model: String?
        /// Why there is no answer.
        var reason: String?
    }

    struct TitleReply: Encodable {
        var available: Bool
        var title: String?
        var reason: String?
    }

    static let titleInstructions = """
        You name to-do checklists. You are given the sentence that introduced a checklist and its steps. \
        Write a short heading for the checklist: 2 to 6 words, saying what the steps achieve, \
        the way a person would title a to-do list. Start with a verb or name the goal. \
        Do not repeat the introducing sentence, do not mention who said what, no quotes, no full stop. \
        Examples. Steps about installing a command-line tool and logging in: Set up the Vercel CLI. \
        Steps about finding a key in a dashboard and replacing it: Rotate the API key. \
        Steps about opening a page and checking numbers: Check the billing totals.
        """

    static func titlePrompt(for request: Request) -> String {
        let steps = request.steps.prefix(10).enumerated()
            .map { "\($0.offset + 1). \(String($0.element.prefix(200)))" }
            .joined(separator: "\n")
        return "Introduced by: \"\(request.leadIn.prefix(300))\"\n\(steps)\n\nA short heading for this checklist:"
    }

    /// Entry point for `Didja --title`. Never returns.
    static func titleFromCommandLine() -> Never {
        JudgeServer.oneShot("title")
    }

    static func suggestTitle(_ request: Request) async -> TitleReply {
        #if canImport(FoundationModels)
        if #available(macOS 26.0, *) {
            return await OnDevice.title(request)
        }
        #endif
        return TitleReply(available: false, reason: "needs macOS 26 or later")
    }

    // MARK: Does an email need a reply?

    struct MailRequest: Decodable {
        var from: String
        var subject: String
        /// The start of the message.
        var body: String
        /// True when `from` only passed the message on.
        var forwarded: Bool?
        /// Who wrote the forwarded message, where its quoted header says.
        var writtenBy: String?
        var teach: Teach?
        /// The local model to ask first, when you turned one on (LocalModel.swift).
        var local: LocalModel.Choice?
    }

    struct MailReply: Encodable, Equatable {
        var available: Bool
        /// "reply": the sender is waiting for an answer. "action": the reader has
        /// to do something elsewhere. "none": nothing is asked.
        var need: String?
        /// What the reader has to do, as a short instruction.
        var task: String?
        /// Who is asking: the person who wrote the request, not one who forwarded it.
        var asker: String?
        /// Which model answered: the local model's name, or Apple's.
        var model: String?
        var reason: String?
    }

    static let mailInstructions = """
        You read one email and work out what, if anything, its reader has to do. \
        Answer reply if the sender is waiting for a written answer: a question, a request for information, a choice of times, an approval. \
        Answer action if the email asks the reader to do something somewhere else and no written answer is needed: \
        update or confirm account details, pay, sign, fill in a form, complete a step on a website. \
        Answer none if it only informs, thanks, confirms, announces, is a receipt, a newsletter or an automatic notification, or says no action is needed. \
        A polite sign-off such as "let me know if you have questions" does not count. \
        Then write the task itself: what the reader has to do, as an instruction of 3 to 9 words that starts with a verb \
        and names the person or service. Say the actual thing to do, not "reply to the email". \
        Examples: Send Dana the updated Q3 numbers. Update card details on PayPal. Pick an interview time for Noa. \
        Check why Ron cannot log in to staging. For none, write: none. \
        The person to name is the one who wrote the request: the name the message is signed with. \
        When the message was forwarded, that is the writer of the original message, never the person who only passed it on.
        """

    /// Added for an email written mostly in Hebrew. Kept apart from `mailInstructions`
    /// because Hebrew examples there leak into English tasks (SCR-11).
    static let hebrewMailInstructions = """
        This email is written in Hebrew. Write the task in Hebrew. \
        Use the person or service named in this email; the names in the examples are made up and must never be copied. \
        When a company or service sent it, name that company or service in the task. \
        Name each thing the email asks the reader to send or do, in its own words, and nothing it only mentions in passing. \
        Hebrew examples: שלח למיכל את החשבונית של מרץ. מלא וחתום על טופס 101 לנועה. \
        The signature may add a role after a dash, with a quotation mark inside an abbreviation, as in נועה - מש"א. \
        That whole line is the name. \
        A closing line offering help, such as "אם יש שאלות אני כאן" or "אשמח לעזור", asks for nothing.
        """

    /// Whether a message is written mostly in Hebrew: more Hebrew letters than Latin ones.
    static func isHebrew(_ text: String) -> Bool {
        var hebrew = 0, latin = 0
        for scalar in text.unicodeScalars {
            if (0x05D0...0x05EA).contains(scalar.value) { hebrew += 1 } else if scalar.properties.isAlphabetic && scalar.isASCII { latin += 1 }
        }
        return hebrew > latin
    }

    /// The instructions for one email: the English ones, plus the Hebrew paragraph when it applies.
    static func mailInstructions(for request: MailRequest) -> String {
        // Your own instructions replace the English ones; Hebrew mail still gets its Hebrew guidance.
        let base = compose(mailInstructions, request.teach.map { Teach(instructions: $0.instructions, examples: nil) })
        let language = isHebrew(request.subject + "\n" + request.body) ? base + " " + hebrewMailInstructions : base
        return compose(language, request.teach.map { Teach(instructions: nil, examples: $0.examples) })
    }

    static func mailPrompt(for request: MailRequest) -> String {
        var header = "From: \(request.from.prefix(120))"
        if request.forwarded == true {
            header = "Forwarded to the reader by: \(request.from.prefix(120)), who did not write it."
            if let writer = request.writtenBy, !writer.isEmpty { header += "\nThe original message came from: \(writer.prefix(120)). Whoever signed it by name is the person asking." }
        }
        return """
        \(header)
        Subject: \(request.subject.prefix(200))

        \(request.body.prefix(1600))

        What does the reader have to do, and who is asking?
        """
    }

    /// Entry point for `Didja --needs-reply`. Never returns.
    static func mailFromCommandLine() -> Never {
        JudgeServer.oneShot("needs-reply")
    }

    static func needsReply(_ request: MailRequest) async -> MailReply {
        if let local = request.local, let reply = await LocalModel.needsReply(request, model: local.model) { return reply }
        #if canImport(FoundationModels)
        if #available(macOS 26.0, *) {
            return await OnDevice.needsReply(request)
        }
        #endif
        return MailReply(available: false, reason: "needs macOS 26 or later")
    }

    // MARK: Does a screen show a task done?

    struct LookRequest: Decodable {
        var task: String
        var app: String
        /// Where the text was seen: app and page, no query string.
        var page: String
        /// The lines of the screen that have to do with the task.
        var text: String
        var teach: Teach?
        /// The local model to ask first, when you turned one on (LocalModel.swift).
        var local: LocalModel.Choice?
    }

    struct LookReply: Encodable, Equatable {
        var available: Bool
        /// "done", "notDone" or "unsure".
        var seen: String?
        /// Which model answered: the local model's name, or Apple's.
        var model: String?
        var reason: String?
    }

    static let lookInstructions = """
        You check whether a to-do item has been carried out, from a snapshot of text on the person's screen taken after the item was written. \
        Answer done if the screen shows the outcome the task was meant to produce. That can be a success message, but it can also simply be the result being there: \
        the item that had to be added now appears in the list, the thing that had to be created now has its own page, the thing that had to be deleted is gone and the page says so, \
        the person is signed in after a task to check signing in. \
        Answer notDone if the screen merely mentions the task, shows instructions or documentation, shows code, shows a chat about it, shows an empty form or a button not yet used, or shows an error. \
        Answer unsure if it is unclear.
        """

    static func lookPrompt(for request: LookRequest) -> String {
        """
        To-do item: \(request.task.prefix(300))
        App: \(request.app.prefix(80))
        Page: \(request.page.prefix(200))
        Text on screen:
        \(request.text.prefix(1200))

        Has the to-do item been carried out?
        """
    }

    /// Entry point for `Didja --looks-done`. Never returns.
    static func lookFromCommandLine() -> Never {
        JudgeServer.oneShot("looks-done")
    }

    static func looksDone(_ request: LookRequest) async -> LookReply {
        if let local = request.local, let reply = await LocalModel.looksDone(request, model: local.model) { return reply }
        #if canImport(FoundationModels)
        if #available(macOS 26.0, *) {
            return await OnDevice.looksDone(request)
        }
        #endif
        return LookReply(available: false, reason: "needs macOS 26 or later")
    }

    // MARK: What would a screen showing a task done have? (SCR-67)

    struct CriteriaRequest: Decodable {
        var task: String
        var leadIn: String?
        var neighbours: [String]?
        /// Where the task came from: "Claude — Open source", "Microsoft Outlook".
        var source: String?
        /// The lines kept around the task where it was captured.
        var context: [String]?
        var links: [String]?
    }

    struct CriteriaReply: Encodable, Equatable {
        var available: Bool
        var `where`: [String]?
        var success: [String]?
        var pending: [String]?
        var tokens: [String]?
        var model: String?
        var reason: String?
    }

    static let criteriaInstructions = """
        You help a to-do app notice when a to-do item has been done, by describing what the person's screen would show at that moment. \
        You are given the item, the list it came from and the text around it. Think about this item only. \
        where: the app or website where this item would be done. Use a website's host, such as the service the item or its text names, or an app's name. \
        success: up to 3 short phrases, 1 to 4 words, that this app or website shows once this item is done, for example the status a record changes to. \
        pending: up to 3 short phrases that the same page shows while this item is still not done. \
        tokens: ids or names copied from the item or its text that must be on that page, such as an order number or a ticket key. \
        Leave a list empty when you cannot tell. Never write ids, names or phrases that have nothing to do with this item.
        """

    static func criteriaPrompt(for request: CriteriaRequest) -> String {
        var parts = ["To-do item: \(request.task.prefix(300))"]
        if let lead = request.leadIn?.trimmingCharacters(in: .whitespacesAndNewlines), !lead.isEmpty {
            parts.append("Introduced by: \(lead.prefix(200))")
        }
        let others = (request.neighbours ?? []).prefix(6).map { "- \($0.prefix(160))" }
        if !others.isEmpty { parts.append("Other steps in the same list:\n\(others.joined(separator: "\n"))") }
        if let source = request.source, !source.isEmpty { parts.append("From: \(source.prefix(120))") }
        let context = (request.context ?? []).prefix(7).map { String($0.prefix(200)) }
        if !context.isEmpty { parts.append("Text around it:\n\(context.joined(separator: "\n"))") }
        let links = (request.links ?? []).prefix(4).map { String($0.prefix(200)) }
        if !links.isEmpty { parts.append("Links: \(links.joined(separator: " "))") }
        parts.append("What would the screen show once this item is done?")
        return parts.joined(separator: "\n")
    }

    /// Entry point for `Didja --criteria`. Never returns.
    static func criteriaFromCommandLine() -> Never {
        JudgeServer.oneShot("criteria")
    }

    /// Apple's on-device model only: the local model is not used for this job until it has been
    /// measured on it (CLAUDE.md; engine/eval/criteria.ts).
    static func doneCriteria(_ request: CriteriaRequest) async -> CriteriaReply {
        #if canImport(FoundationModels)
        if #available(macOS 26.0, *) {
            return await OnDevice.doneCriteria(request)
        }
        #endif
        return CriteriaReply(available: false, reason: "needs macOS 26 or later")
    }

    static let modelName = "apple-on-device"

    static let instructions = """
        You are given a numbered list copied from an AI coding assistant's message to the person it is helping. \
        Decide who the list is for, taken as a whole. \
        "user": the assistant is asking the person to do these things themselves, on their own computer or in a website \
        (run a command, click, set a value, check something). \
        "assistant": the list is the assistant's own plan, a report of what it did, or a description of how software behaves. \
        Clues: steps that happen in apps, dashboards, terminals or settings the person controls are for the user. \
        Steps about changing the code, schema, tests or design of the project are the assistant's. \
        Examples. "Deploy checklist: 1. Set API_KEY in Vercel 2. Run npm run migrate" is for the user. \
        "Implementation plan: 1. Add a users table 2. Write the login handler 3. Add tests" is the assistant's. \
        "What I changed: 1. Fixed the redirect 2. Updated the README" is the assistant's. \
        The text after the list is a strong clue. If the assistant offers to do the work \
        ("Say go and I'll start", "Want me to do these?"), the list is the assistant's. \
        If it asks the person to report back ("Tell me when that's done"), the list is for the user. \
        What the person asked just before is a strong clue too. If they asked how to do something \
        ("How do I tag a release?", "What should I run to fix this?") and the list answers with steps or commands, \
        the list is for the user. If they asked the assistant to do or plan the work, it is the assistant's.
        """

    static func prompt(for request: Request) -> String {
        let steps = request.steps.prefix(12).enumerated()
            .map { "\($0.offset + 1). \(String($0.element.prefix(300)))" }
            .joined(separator: "\n")
        let after = (request.after ?? []).prefix(3).map { String($0.prefix(240)) }.joined(separator: " ")
        let tail = after.isEmpty ? "" : "\nText after the list: \"\(after)\""
        let asked = (request.asked ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let head = asked.isEmpty ? "" : "The person asked: \"\(asked.prefix(240))\"\n"
        // The whole reply, so the words around the list count too (SCR-70).
        let reply = (request.reply ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let whole = reply.isEmpty ? "" : "The assistant's whole reply:\n\"\"\"\n\(reply.prefix(2000))\n\"\"\"\n"
        return "\(head)\(whole)Introduced by: \"\(request.leadIn.prefix(200))\"\n\(steps)\(tail)\n\nWho is this list for, taken as a whole?"
    }

    /// Entry point for `Didja --judge`. Never returns.
    static func runFromCommandLine() -> Never {
        JudgeServer.oneShot("judge")
    }

    static func judge(_ request: Request) async -> Reply {
        if let local = request.local, let reply = await LocalModel.judgeList(request, model: local.model) { return reply }
        #if canImport(FoundationModels)
        if #available(macOS 26.0, *) {
            return await OnDevice.judge(request)
        }
        #endif
        return Reply(available: false, reason: "needs macOS 26 or later")
    }
}

#if canImport(FoundationModels)
@available(macOS 26.0, *)
private enum OnDevice {
    static var status: String {
        switch SystemLanguageModel.default.availability {
        case .available: return "Available"
        case .unavailable(.appleIntelligenceNotEnabled): return "Not available: Apple Intelligence is turned off"
        case .unavailable(.deviceNotEligible): return "Not available on this Mac"
        case .unavailable(.modelNotReady): return "Not ready yet: the model is still downloading"
        case .unavailable: return "Not available"
        }
    }

    @Generable
    enum Audience: String {
        case user, assistant
    }

    @Generable
    struct Verdict {
        @Guide(description: "user: the list tells the reader what to do themselves. assistant: the list is the assistant's own plan, or a report of what it did or how something works.")
        var audience: Audience
    }

    @Generable
    enum Where: String {
        case writeBack, elsewhere, nothing
    }

    @Generable
    struct MailVerdict {
        @Guide(description: "true only if the email explicitly asks the reader to answer a question or to do something. false if it thanks, agrees, confirms, informs or says something is available.")
        var asks: Bool
        @Guide(description: "The thing to do, 3 to 9 words, starting with a verb and naming the person or service. 'none' if nothing is asked.")
        var task: String
        @Guide(description: "How that task gets done. writeBack: by writing an answer to the sender, who is a person waiting for it. elsewhere: on a website, in an app, on a document, by paying or signing; no written answer needed. nothing: no task.")
        var doneBy: Where
        @Guide(description: "The name signed under the request, after the thanks or regards, copied exactly as written there in its own language. If nobody signed, the sender. For a forwarded message never the forwarder.")
        var asker: String
    }

    static func needsReply(_ request: Judge.MailRequest) async -> Judge.MailReply {
        let model = SystemLanguageModel.default
        guard case .available = model.availability else {
            return Judge.MailReply(available: false, reason: "on-device model unavailable: \(model.availability)")
        }
        do {
            let session = LanguageModelSession(model: model, instructions: Judge.mailInstructions(for: request))
            let response = try await session.respond(
                to: Judge.mailPrompt(for: request), generating: MailVerdict.self,
                options: GenerationOptions(temperature: 0))
            let how = response.content.asks ? response.content.doneBy : .nothing
            let need = [Where.writeBack: "reply", .elsewhere: "action", .nothing: "none"][how] ?? "none"
            return Judge.MailReply(available: true, need: need, task: response.content.task, asker: response.content.asker, model: Judge.modelName)
        } catch {
            return Judge.MailReply(available: false, reason: "model error: \(error.localizedDescription)")
        }
    }

    @Generable
    enum Seen: String {
        case done, notDone, unsure
    }

    @Generable
    struct Look {
        @Guide(description: "done: the screen shows the outcome of the task. notDone: it only mentions it, or shows instructions, code, an unused form or an error. unsure: cannot tell.")
        var seen: Seen
    }

    static func looksDone(_ request: Judge.LookRequest) async -> Judge.LookReply {
        let model = SystemLanguageModel.default
        guard case .available = model.availability else {
            return Judge.LookReply(available: false, reason: "on-device model unavailable: \(model.availability)")
        }
        do {
            let session = LanguageModelSession(model: model, instructions: Judge.compose(Judge.lookInstructions, request.teach))
            let response = try await session.respond(
                to: Judge.lookPrompt(for: request), generating: Look.self,
                options: GenerationOptions(temperature: 0))
            return Judge.LookReply(available: true, seen: response.content.seen.rawValue, model: Judge.modelName)
        } catch {
            return Judge.LookReply(available: false, reason: "model error: \(error.localizedDescription)")
        }
    }

    @Generable
    struct DoneLooks {
        @Guide(description: "Apps or websites where it would be done: a host and path when the text names them, or an app name. Empty if unknown.")
        var places: [String]
        @Guide(description: "Up to 4 short phrases, 1 to 5 words, that appear on that screen once it is done.")
        var success: [String]
        @Guide(description: "Up to 4 short phrases that show on that screen it is not done yet.")
        var pending: [String]
        @Guide(description: "Ids or names from the given text that must be on that screen. Never invented.")
        var tokens: [String]
    }

    static func doneCriteria(_ request: Judge.CriteriaRequest) async -> Judge.CriteriaReply {
        let model = SystemLanguageModel.default
        guard case .available = model.availability else {
            return Judge.CriteriaReply(available: false, reason: "on-device model unavailable: \(model.availability)")
        }
        do {
            let session = LanguageModelSession(model: model, instructions: Judge.criteriaInstructions)
            let response = try await session.respond(
                to: Judge.criteriaPrompt(for: request), generating: DoneLooks.self,
                options: GenerationOptions(temperature: 0))
            let c = response.content
            return Judge.CriteriaReply(available: true, where: c.places, success: c.success, pending: c.pending, tokens: c.tokens, model: Judge.modelName)
        } catch {
            return Judge.CriteriaReply(available: false, reason: "model error: \(error.localizedDescription)")
        }
    }

    @Generable
    struct Heading {
        @Guide(description: "A heading of 2 to 6 words for the checklist, with no quotes and no full stop.")
        var title: String
    }

    static func title(_ request: Judge.Request) async -> Judge.TitleReply {
        let model = SystemLanguageModel.default
        guard case .available = model.availability else {
            return Judge.TitleReply(available: false, reason: "on-device model unavailable: \(model.availability)")
        }
        do {
            let session = LanguageModelSession(model: model, instructions: Judge.compose(Judge.titleInstructions, request.teach))
            let response = try await session.respond(
                to: Judge.titlePrompt(for: request), generating: Heading.self,
                options: GenerationOptions(temperature: 0))
            return Judge.TitleReply(available: true, title: response.content.title)
        } catch {
            return Judge.TitleReply(available: false, reason: "model error: \(error.localizedDescription)")
        }
    }

    static func judge(_ request: Judge.Request) async -> Judge.Reply {
        let model = SystemLanguageModel.default
        guard case .available = model.availability else {
            return Judge.Reply(available: false, reason: "on-device model unavailable: \(model.availability)")
        }
        do {
            let session = LanguageModelSession(model: model, instructions: Judge.compose(Judge.instructions, request.teach))
            let response = try await session.respond(
                to: Judge.prompt(for: request), generating: Verdict.self,
                options: GenerationOptions(temperature: 0))
            return Judge.Reply(available: true, audience: response.content.audience.rawValue, model: Judge.modelName)
        } catch {
            return Judge.Reply(available: false, reason: "model error: \(error.localizedDescription)")
        }
    }
}
#endif
