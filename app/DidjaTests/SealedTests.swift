import CryptoKit
import SQLite3
import XCTest
@testable import Didja

/// SCR-101: screen text sealed at rest, as the app writes and reads it. Made-up content only.
final class SealedTests: XCTestCase {
    let key = SymmetricKey(data: Data(repeating: 7, count: 32))

    func testSealsAndOpensAndFailsClosed() throws {
        let sealed = try XCTUnwrap(Sealed.seal("Send Noa the slides", key: key))
        XCTAssertTrue(sealed.hasPrefix("enc1:"))
        XCTAssertFalse(sealed.contains("Noa"))
        XCTAssertEqual(Sealed.open(sealed, key: key), "Send Noa the slides")
        XCTAssertNil(Sealed.open(sealed, key: SymmetricKey(size: .bits256)), "another key opens nothing")
        XCTAssertNil(Sealed.open(sealed, key: nil))
        XCTAssertEqual(Sealed.open("never sealed", key: nil), "never sealed")
    }

    func testReadsWhatTheEngineSealed() {
        // Sealed by the engine (engine/test/sealed.test.ts opens the app's vector the other way).
        XCTAssertEqual(Sealed.open("enc1:yy44zCZLOARkDkakPTVg0+/xt0W2XKIhm0++WjEJLlM1Trw7w/lI95FfK+EbKl3iKeyvojrLPq+xrhvVLbVJ", key: key),
                       "Run the migration: supabase db push")
    }

    func testObservationsAreStoredSealedAndOnlyYouCanReadTheFolder() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = try ObservationStore(directory: dir, migrations: ObservationStore.bundledMigrations(), key: key)
        try store.insert(bundleID: "net.whatsapp.WhatsApp", app: "WhatsApp", windowTitle: "Dana Levi", url: nil, source: .ax,
                         text: "Can you send me the Acme contract?")
        XCTAssertEqual(try store.recentLines(bundleID: "net.whatsapp.WhatsApp", limit: 5), ["Can you send me the Acme contract?"])
        var db: OpaquePointer?
        XCTAssertEqual(sqlite3_open(dir.appendingPathComponent("didja.db").path, &db), SQLITE_OK)
        defer { sqlite3_close(db) }
        var statement: OpaquePointer?
        XCTAssertEqual(sqlite3_prepare_v2(db, "SELECT text FROM observations", -1, &statement, nil), SQLITE_OK)
        defer { sqlite3_finalize(statement) }
        XCTAssertEqual(sqlite3_step(statement), SQLITE_ROW)
        let stored = String(cString: sqlite3_column_text(statement, 0))
        XCTAssertTrue(stored.hasPrefix("enc1:"))
        XCTAssertFalse(stored.contains("Acme"))
        // Another key reads nothing, and changes nothing.
        let other = try ObservationStore(directory: dir, migrations: ObservationStore.bundledMigrations(), key: SymmetricKey(size: .bits256))
        XCTAssertEqual(try other.recentLines(bundleID: "net.whatsapp.WhatsApp", limit: 5), [])
        let mode = try FileManager.default.attributesOfItem(atPath: dir.path)[.posixPermissions] as? Int
        XCTAssertEqual(mode, 0o700)
        let fileMode = try FileManager.default.attributesOfItem(atPath: dir.appendingPathComponent("didja.db").path)[.posixPermissions] as? Int
        XCTAssertEqual(fileMode, 0o600)
    }

    func testPrivacySaysHowItStands() {
        XCTAssertTrue(PrivacyFacts.Encryption.decode(#"{"state":"on","clear":0}"#).words.hasPrefix("On."))
        XCTAssertTrue(PrivacyFacts.Encryption.decode(#"{"state":"off","clear":12}"#).words.contains("12 values"))
        XCTAssertEqual(PrivacyFacts.Encryption.decode(nil).state, "off")
    }
}
