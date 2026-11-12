import XCTest
@testable import Didja

/// App profiles (`profiles/*.json`): each app's window, written down as an outline with made-up
/// text, read through the same walk capture uses, must come out labelled as before profiles.
enum Profiles {
    static let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    static let folder = repo.appendingPathComponent("profiles")
    static let all = AppProfiles.load(from: folder)

    static func q(_ s: String) -> String { OutlineElement.quote(s) }

    /// The lines capture keeps from an outline of `app`'s window.
    static func lines(_ app: String, _ outline: [String], profiles: [AppProfile] = all) throws -> [String] {
        var limits = AXCapture.Limits()
        limits.app = app
        limits.profiles = profiles
        limits.skipFocusedInput = true
        let root = try OutlineElement.parse(outline.joined(separator: "\n"))
        return AXCapture.read(root: root, title: "", appName: "", limits: limits).lines
    }
}

final class ProfileTests: XCTestCase {
    private let q = Profiles.q
    private let whatsApp = "net.whatsapp.WhatsApp"

    func testEveryProfileInTheRepositoryLoadsAndShipsWithTheApp() throws {
        let files = try FileManager.default.contentsOfDirectory(atPath: Profiles.folder.path).filter { $0.hasSuffix(".json") }
        XCTAssertGreaterThanOrEqual(files.count, 6)
        XCTAssertEqual(Profiles.all.count, files.count, "every profile passes its checks")
        XCTAssertEqual(Set(Profiles.all.map(\.id)).count, files.count, "ids are unique")
        for file in files {
            let profile = try XCTUnwrap(Profiles.all.first { "\($0.id).json" == file }, "\(file) is named after its id")
            XCTAssertNotNil(profile.about, "\(file) says what the app is")
        }
        XCTAssertEqual(AppProfiles.builtIn.map(\.id).sorted(), Profiles.all.map(\.id).sorted(), "the app bundles the same profiles")
        XCTAssertEqual(AppProfiles.forApp(whatsApp)?.name, "WhatsApp")
        XCTAssertNil(AppProfiles.forApp("com.apple.TextEdit"))
    }

    func testOutlinesRoundTrip() throws {
        let text = """
        AXWindow title="Chat"
         AXGroup/AXDocumentArticle id="a" dom="b" class="x y" desc="Say \\"hi\\" — שלום"
          AXTextField value="draft" focused
         AXLink url="https://example.com/a"
        """
        let root = try OutlineElement.parse(text)
        XCTAssertEqual(root.outline(), text)
        XCTAssertEqual(root.children()[0].classes(), ["x", "y"])
        XCTAssertEqual(root.children()[0].string("AXDescription"), "Say \"hi\" — שלום")
        XCTAssertTrue(root.children()[0].children()[0].isFocused())
        XCTAssertThrowsError(try OutlineElement.parse("AXWindow\n   AXGroup"), "a level skipped")
        XCTAssertThrowsError(try OutlineElement.parse("AXWindow\nAXWindow"), "two roots")
        XCTAssertThrowsError(try OutlineElement.parse("AXWindow nope=\"x\""), "an unknown attribute")
    }

    // MARK: WhatsApp

    private func cell(_ description: String) -> String {
        "  AXCell id=\"WAMessageBubbleTableViewCell\" desc=\(q(description))"
    }

    func testWhatsAppMessagesAreReadFromTheirDescriptions() throws {
        let lines = try Profiles.lines(whatsApp, [
            "AXWindow",
            " AXTable id=\"ChatMessagesTableView\" desc=\(q("\u{200E}Messages in chat with Dana Levi"))",
            cell("Messages and calls are end-to-end encrypted."),
            cell("\u{200E}message, Can you send it, by Friday?, 9 October at 12:34, \u{200E}Received from Dana Levi"),
            cell("\u{200E}Your message, Sent it, Today at 9:40, \u{200E}Sent to Dana Levi, \u{200E}Read"),
            cell("\u{200E}Your photo, 9 October at 12:41, \u{200E}Sent to Dana Levi, \u{200E}Delivered"),
            // Today's messages show only the time; a time inside the text is not the label's.
            cell("\u{200E}message, Meet at 9:30, ok? Call 911 if late, 10:54, \u{200E}Received from Dana Levi"),
            cell("\u{200E}Your message, Done, 11:02, \u{200E}Sent to Dana Levi, \u{200E}Read"),
            " AXTextArea value=\"a draft\" focused",
        ])
        XCTAssertEqual(lines, [
            "⟦Chat message: Dana Levi (direct) — from Dana Levi — 9 October at 12:34⟧", "Can you send it, by Friday?",
            "⟦Chat message: Dana Levi (direct) — from me — Today at 9:40⟧", "Sent it",
            "⟦Chat message: Dana Levi (direct) — from me — 9 October at 12:41⟧", "[photo]",
            "⟦Chat message: Dana Levi (direct) — from Dana Levi — 10:54⟧", "Meet at 9:30, ok? Call 911 if late",
            "⟦Chat message: Dana Levi (direct) — from me — 11:02⟧", "Done",
            "⟦Page⟧",
        ])
    }

    func testAWhatsAppChatIsAGroupWhenTheSenderIsNamedOrSomeoneElseWrites() throws {
        let group = try Profiles.lines(whatsApp, [
            "AXWindow",
            " AXTable id=\"ChatMessagesTableView\" desc=\(q("Messages in chat with Family"))",
            cell("\u{200E}Message from Ron Cohen, Can you swap shifts?, 10:54, \u{200E}Received in Family"),
        ])
        XCTAssertEqual(group.first, "⟦Chat message: Family (group) — from Ron Cohen — 10:54⟧")
        let two = try Profiles.lines(whatsApp, [
            "AXWindow",
            " AXTable id=\"ChatMessagesTableView\" desc=\(q("Messages in chat with Team"))",
            cell("message, Hi, 10:50, Received from Dana"),
            cell("message, Hello, 10:51, Received from Ron"),
        ])
        XCTAssertEqual(two.first, "⟦Chat message: Team (group) — from Dana — 10:50⟧")
        let unknown = try Profiles.lines(whatsApp, [
            "AXWindow",
            " AXTable id=\"ChatMessagesTableView\" desc=\(q("Messages in chat with Dana"))",
            cell("Your message, Hi, 10:50, Sent to Dana"),
        ])
        XCTAssertEqual(unknown.first, "⟦Chat message: Dana (unknown) — from me — 10:50⟧")
    }

    func testYourWhatsAppReactionIsAReplyAfterTheMessage() throws {
        let lines = try Profiles.lines(whatsApp, [
            "AXWindow",
            " AXTable id=\"ChatMessagesTableView\" desc=\(q("Messages in chat with Dana"))",
            cell("message, Happy birthday, Mike!, 10:00, Received from Dana"),
            "  AXGroup desc=\(q("\u{200E}You reacted ❤️ to \"Happy birthday, Mike!\", 10:12"))",
            cell("message, Dana reacted ❤️ to \"Hi\", 10:20, Received from Dana"),
        ])
        XCTAssertEqual(lines, [
            "⟦Chat message: Dana (direct) — from Dana — 10:00⟧", "Happy birthday, Mike!",
            "⟦Chat message: Dana (direct) — from me — 10:00⟧", "[reacted ❤️ to “Happy birthday, Mike!”]",
            "⟦Chat message: Dana (direct) — from Dana — 10:20⟧", "Dana reacted ❤️ to \"Hi\"",
            "⟦Page⟧",
        ])
    }

    func testYourReactionInWhatsAppsChatListIsAReplyInThatChat() throws {
        let lines = try Profiles.lines(whatsApp, [
            "AXWindow",
            " AXTable id=\"ChatListView_TableView\"",
            "  AXRow desc=\"Choir\" value=\(q("\u{200E}You reacted 👍 to \"*חזרה ביום שלישי*\nתאשרו הגעה 🎵\""))",
            "  AXRow desc=\"Family\" value=\(q("Message from Dana, Hi, 10:00, Received in Family"))",
            "  AXRow desc=\"\" value=\(q("You reacted 👍 to \"Hi\""))",
        ])
        XCTAssertEqual(lines, ["⟦Chat message: Choir (unknown) — from me — reaction⟧", "[reacted 👍 to “חזרה ביום שלישי”]", "⟦Page⟧"])
    }

    // MARK: Teams and Slack

    func testTeamsMessagesComeFromTheirIDs() throws {
        let lines = try Profiles.lines("com.microsoft.teams2", [
            "AXWindow",
            " AXGroup dom=\"chat-header-19:abc@thread.v2\"",
            "  AXHeading title=\"Design review\"",
            " AXGroup dom=\"message-body-1794226016279\" title=\"Ron Cohen mentioned you. Can you review?\"",
            "  AXGroup dom=\"author-1794226016279\"",
            "   AXStaticText value=\"Ron Cohen\"",
            "  AXGroup dom=\"timestamp-1794226016279\" title=\"9 November 2026 12:34.\"",
            "  AXGroup dom=\"content-1794226016279\"",
            "   AXStaticText value=\"Can you review the deck?\"",
            "  AXButton class=\"diverse-reaction-pill diverse-reaction-pill-checked\" title=\"1 Heart reaction.\"",
            " AXGroup dom=\"content-control-message-5\"",
            "  AXStaticText value=\"Ron added Sam\"",
            " AXGroup dom=\"message-body-2\" class=\"fui-ChatControlMessage x\"",
            "  AXStaticText value=\"Ron renamed the chat\"",
            " AXGroup dom=\"message-body-3\" title=\"Ron Cohen: Also the budget\"",
            "  AXGroup dom=\"content-3\"",
            "   AXStaticText value=\"Also the budget\"",
        ])
        XCTAssertEqual(lines, [
            "⟦Chat message: Design review (group) — from Ron Cohen, mentions me — 9 November 2026 12:34⟧", "Can you review the deck?",
            "⟦Chat message: Design review (group) — from me — 9 November 2026 12:34⟧", "[reacted Heart to “Can you review the deck?”]",
            "⟦Page⟧",
            // The next message carries on from the one before: same sender, same time.
            "⟦Chat message: Design review (group) — from Ron Cohen — 9 November 2026 12:34⟧", "Also the budget",
            "⟦Page⟧",
        ])
    }

    func testAOneToOneTeamsChatIsNamedAfterThePersonNotItsHeading() throws {
        let lines = try Profiles.lines("com.microsoft.teams2", [
            "AXWindow",
            " AXGroup dom=\"chat-header-19:abc_def@unq.gbl.spaces\"",
            "  AXHeading title=\"Chat participants\"",
            "   AXGroup dom=\"chat-topic-person-1\"",
            "    AXStaticText value=\"Sam Carter\"",
            " AXGroup dom=\"message-body-9\"",
            "  AXGroup dom=\"author-9\"",
            "   AXStaticText value=\"Sam Carter\"",
            "  AXGroup dom=\"timestamp-9\" title=\"10 November 2026 09:00.\"",
            "  AXGroup dom=\"content-9\"",
            "   AXStaticText value=\"Lunch?\"",
            "  AXButton class=\"diverse-reaction-pill\" title=\"2 Like reactions.\"",
        ])
        XCTAssertEqual(lines.filter { $0.hasPrefix("⟦Chat") }, ["⟦Chat message: Sam Carter (direct) — from Sam Carter — 10 November 2026 09:00⟧"],
                       "a reaction that is not yours is not a reply")
        let unnamed = try Profiles.lines("com.microsoft.teams2", [
            "AXWindow",
            " AXGroup dom=\"chat-header-19:x@unq.gbl.spaces\"",
            "  AXHeading title=\"Chat participants\"",
            " AXGroup dom=\"message-body-1\"",
            "  AXGroup dom=\"author-1\"",
            "   AXStaticText value=\"Sam\"",
            "  AXGroup dom=\"content-1\"",
            "   AXStaticText value=\"Hi\"",
        ])
        XCTAssertEqual(unnamed.first, "⟦Chat message:  (direct) — from Sam — ⟧", "no name rather than the participants label")
    }

    func testSlackMessagesComeFromItsClassNames() throws {
        let lines = try Profiles.lines("com.tinyspeck.slackmacgap", [
            "AXWindow",
            " AXGroup class=\"p-view_header__channel_title\"",
            "  AXStaticText value=\"design\"",
            " AXGroup class=\"c-message_kit__background\"",
            "  AXButton class=\"c-message__sender_button\"",
            "   AXStaticText value=\"Ron\"",
            "  AXLink class=\"c-timestamp\" desc=\"Today at 9:05\"",
            "  AXGroup class=\"c-message_kit__blocks\"",
            "   AXStaticText value=\"Can someone check the build?\"",
            " AXGroup class=\"c-message_kit__background\"",
            "  AXGroup class=\"c-message_kit__blocks\"",
            "   AXStaticText value=\"It is red again\"",
        ])
        XCTAssertEqual(lines, [
            "design",
            "⟦Chat message: design (unknown) — from Ron — Today at 9:05⟧", "Can someone check the build?", "⟦Page⟧",
            "⟦Chat message: design (unknown) — from Ron — Today at 9:05⟧", "It is red again", "⟦Page⟧",
        ])
    }

    // MARK: Email

    func testOutlookLabelsTheOpenEmail() throws {
        let lines = try Profiles.lines("com.microsoft.Outlook", [
            "AXWindow",
            " AXGroup",
            "  AXStaticText value=\"Inbox\"",
            " AXGroup id=\"HeaderMainContainer\"",
            "  AXStaticText value=\" Q3 budget numbers \"",
            "  AXStaticText id=\"messageHeaderFromContent\" value=\"Von: Dana Levi, dana@example.com\"",
            "  AXStaticText id=\"messageHeaderRecipientsContent\" value=\"Recipients: To: me@example.com; Ron Avital\"",
            "  AXStaticText id=\"messageHeaderTimeStampContent\" value=\"Today at 15:05\"",
            "  AXStaticText id=\"messageHeaderContextualControlsReplyButton\" value=\"Reply\"",
            " AXButton desc=\"1 Like No more reactions\"",
            " AXButton desc=\"0 Like reactions\"",
            " AXButton desc=\"2 attachments\"",
            " AXWebArea",
            "  AXGroup",
            "   AXStaticText value=\"Please sign here:\"",
            "  AXLink url=\"https://sign.example.com/d/1\"",
            "   AXStaticText value=\"Review\"",
        ])
        XCTAssertEqual(lines, [
            "Inbox",
            "⟦Email: Q3 budget numbers⟧", "From: Dana Levi, dana@example.com", "To: me@example.com; Ron Avital",
            "Date: Today at 15:05", "Reply",
            "Reactions: 1 Like",
            "Please sign here:", "Review ⟨https://sign.example.com/d/1⟩",
        ])
    }

    func testGmailLabelsEachMessageOfTheConversation() throws {
        let page = [
            "  AXHeading class=\"hP\"",
            "   AXStaticText value=\"Q3 numbers\"",
            "  AXGroup class=\"h7 ie\"",
            "   AXGroup class=\"gD\" title=\"Dana  Levi\"",
            "   AXGroup class=\"g3\"",
            "    AXStaticText value=\"Mon 9 Nov, 15:05 (2 hours ago)\"",
            "   AXGroup class=\"iw ajw\"",
            "    AXStaticText value=\"to me, Ron\"",
            "   AXGroup class=\"a3s aiL\"",
            "    AXStaticText value=\"Can you send the numbers?\"",
            "    AXLink url=\"https://forms.example.com/f/9\"",
            "     AXStaticText value=\"Open the form\"",
            "  AXStaticText value=\"Reply\"",
        ]
        let gmail = try Profiles.lines("com.google.Chrome",
                                       ["AXWindow", " AXWebArea url=\"https://mail.google.com/mail/u/0/#inbox/abc\""] + page)
        XCTAssertEqual(gmail, [
            "Q3 numbers",
            "⟦Email 1: Q3 numbers⟧", "From: Dana Levi", "Date: Mon 9 Nov, 15:05 (2 hours ago)", "To: me, Ron",
            "Can you send the numbers?", "Open the form ⟨https://forms.example.com/f/9⟩", "⟦Page⟧",
            "Reply",
        ])
        let elsewhere = try Profiles.lines("com.google.Chrome",
                                           ["AXWindow", " AXWebArea url=\"https://example.com/mail.google.com/\""] + page)
        XCTAssertFalse(elsewhere.contains { $0.hasPrefix("⟦Email") }, "another site with the same class names")
        XCTAssertFalse(elsewhere.contains { $0.contains("⟨") }, "and no link targets kept outside an email")
    }

    func testOutlookOnTheWebIsKnownBySiteAndItsPartsByTheirIds() throws {
        let page = [
            "  AXHeading dom=\"CONV_SNCQ_SUBJECT\" title=\"Q3 numbers\"",
            "  AXHeading dom=\"MSG_AAIpRHG4AAA_SUBJECT\" title=\"Q3 numbers\"",
            "  AXGroup dom=\"MSG_AAIpRHG4AAA_FROM\" title=\"Von:  Dana Levi\"",
            "  AXGroup dom=\"MSG_AAIpRHG4AAA_TO\"",
            "   AXStaticText value=\"To:  Mike;  Ron Avital\"",
            "  AXGroup dom=\"MSG_AAIpRHG4AAA_DATETIME\" title=\"Mon 11/9/2026 9:15 AM\"",
            "  AXGroup dom=\"UniqueMessageBody_7\"",
            "   AXStaticText value=\"Can you approve the budget?\"",
            "  AXStaticText value=\"Reply all\"",
        ]
        let web = try Profiles.lines("com.apple.Safari",
                                     ["AXWindow", " AXWebArea url=\"https://outlook.office.com/mail/inbox/id/AAA\""] + page)
        XCTAssertEqual(web, [
            "⟦Email 1: Q3 numbers⟧", "From: Dana Levi", "To: Mike; Ron Avital", "Date: Mon 11/9/2026 9:15 AM",
            "Can you approve the budget?", "⟦Page⟧", "Reply all",
        ])
        for other in ["https://outlook.office.com.evil.test/mail/", "https://example.com/?next=https://outlook.office.com/",
                      "http://outlook.office.com/mail/"] {
            let lines = try Profiles.lines("com.apple.Safari", ["AXWindow", " AXWebArea url=\(q(other))"] + page)
            XCTAssertFalse(lines.contains { $0.hasPrefix("⟦Email") }, other)
        }
    }

    // MARK: Safety

    func testAProfileNeverReadsASecureFieldOrTheDraftBeingTyped() throws {
        let profile = try AppProfile.load(Data("""
        {"id": "greedy", "name": "Greedy", "kind": "chat", "match": {"bundleIds": ["com.example.chat"]},
         "rules": [{"is": "line", "where": {"role": ["AXTextField", "AXGroup"]}, "text": {"attr": ["value", "title"]}, "line": "Seen: {v}"}]}
        """.utf8))
        let lines = try Profiles.lines("com.example.chat", [
            "AXWindow",
            " AXTextField/AXSecureTextField value=\"hunter2\"",
            " AXTextField value=\"half-typed reply\" focused",
            " AXGroup title=\"Shown\"",
        ], profiles: [profile])
        XCTAssertEqual(lines, ["Seen: Shown"])
        // And it applies only to its own app.
        XCTAssertEqual(try Profiles.lines("com.example.other", ["AXWindow", " AXGroup title=\"Shown\""], profiles: [profile]), [])
    }

    func testRunawayPatternsAreRefused() {
        for bad in ["(a+)+", "(?:x*y)*", "(a|b+){2,}", "((a)+)+", "(x)\\1", "\\k<v>", "(?<=a)b", "(?<!a)b",
                    String(repeating: "a", count: 301), "(unclosed"] {
            XCTAssertThrowsError(try ProfilePattern(bad), bad)
        }
        for good in ["^(?<v>.+?) (?i:reaction)", "(?:, .*)?$", "\\d{1,2}:\\d{2}", "(?:(?:\\d{1,2} x)? at )?", "[(+*]+"] {
            XCTAssertNoThrow(try ProfilePattern(good), good)
        }
        // A long label is cut before it is matched.
        let p = try! ProfilePattern("b$")
        XCTAssertNil(p.match(String(repeating: "a", count: 5_000) + "b"))
    }

    func testAProfileIsCheckedWhenItLoads() {
        func load(_ json: String) -> Error? {
            do { _ = try AppProfile.load(Data(json.utf8)); return nil } catch { return error }
        }
        let rule = #""rules": [{"is": "line", "where": {"role": ["AXGroup"]}, "text": "title", "line": "From: {v}"}]"#
        XCTAssertNil(load(#"{"id": "ok", "name": "Ok", "kind": "email", "match": {"bundleIds": ["a.b"]}, \#(rule)}"#))
        XCTAssertNotNil(load(#"{"id": "Bad Id", "name": "x", "kind": "email", "match": {"bundleIds": ["a.b"]}, \#(rule)}"#))
        XCTAssertNotNil(load(#"{"id": "x", "name": "x", "kind": "email", "match": {}, \#(rule)}"#), "matches nothing")
        XCTAssertNotNil(load(#"{"id": "x", "name": "x", "kind": "email", "match": {"urlPrefixes": ["http://a"]}, \#(rule)}"#))
        XCTAssertNotNil(load(#"{"id": "x", "name": "x", "kind": "email", "match": {"bundleIds": ["a.b"]}, "rules": []}"#))
        XCTAssertNotNil(load(#"{"id": "x", "name": "x", "kind": "chat", "match": {"bundleIds": ["a.b"]}, "rules": [{"is": "message", "where": {}}]}"#),
                        "a message rule says where its sender and body are")
        XCTAssertNotNil(load(#"{"id": "x", "name": "x", "kind": "email", "match": {"bundleIds": ["a.b"]}, "rules": [{"is": "line", "where": {}, "text": "title", "line": "{who}"}]}"#),
                        "a template may use only its pattern's groups")
        XCTAssertNotNil(load(#"{"id": "x", "name": "x", "kind": "email", "match": {"bundleIds": ["a.b"]}, "rules": [{"is": "run", "where": {}}]}"#),
                        "only the fixed kinds of rule")
    }
}

/// Each `profiles/fixtures/*.json`: an app's window as an outline with made-up text, and the lines
/// capture must keep from it. The engine's tests read the same files for what it makes of the lines.
final class ProfileFixtureTests: XCTestCase {
    struct Fixture: Decodable {
        var about: String
        var profile: String
        var app: String
        var outline: [String]
        var lines: [String]
    }

    func testEveryFixtureComesOutAsItSays() throws {
        let folder = Profiles.folder.appendingPathComponent("fixtures")
        let files = try FileManager.default.contentsOfDirectory(atPath: folder.path).filter { $0.hasSuffix(".json") }.sorted()
        XCTAssertFalse(files.isEmpty)
        var covered = Set<String>()
        for file in files {
            let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: folder.appendingPathComponent(file)))
            XCTAssertTrue(file.hasPrefix(fixture.profile + "-"), "\(file) starts with its profile's id")
            covered.insert(fixture.profile)
            XCTAssertEqual(try Profiles.lines(fixture.app, fixture.outline), fixture.lines, file)
        }
        XCTAssertEqual(covered, Set(Profiles.all.map(\.id)), "every profile has a fixture")
    }
}
