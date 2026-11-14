import XCTest
@testable import Didja

/// The heading over each conversation's tasks names the tool, then the conversation, plainly.
final class SourceLabelTests: XCTestCase {
    func testClaudeCodeTab() {
        XCTAssertEqual(SourceHeader.label("Claude — Release plan for Acme - Claude Code"), "Claude Code · Release plan for Acme")
    }

    func testClaudeChat() {
        XCTAssertEqual(SourceHeader.label("Claude — Stripe webhooks - Claude"), "Claude · Stripe webhooks")
        XCTAssertEqual(SourceHeader.label("Claude — Stripe webhooks"), "Claude · Stripe webhooks")
    }

    func testChatsAndMail() {
        XCTAssertEqual(SourceHeader.label("WhatsApp — Sam Carter"), "WhatsApp · Sam Carter")
        XCTAssertEqual(SourceHeader.label("WhatsApp — נועה כץ"), "WhatsApp · נועה כץ")
        XCTAssertEqual(SourceHeader.label("Mail — Inbox — Acme"), "Mail · Inbox — Acme")
    }

    func testUnknownShapesAreLeftAlone() {
        XCTAssertEqual(SourceHeader.label("Added by you"), "Added by you")
        XCTAssertEqual(SourceHeader.label("Claude — Claude"), "Claude")
    }
}
