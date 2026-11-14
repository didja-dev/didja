import CryptoKit
import Foundation
import Security

/// The key that seals screen text in Didja's database (SCR-101): 256 random bits, made once and
/// kept in your login Keychain ("Didja database key"). Never written anywhere else: the app hands
/// it to the engine it starts, in that process's environment.
enum DatabaseKey {
    static let service = "dev.didja.database-key"
    static let account = "aes-256-gcm"

    /// Read (or made) once. Nil in unit tests, or when the Keychain cannot give it: capture then
    /// keeps working, stores text unsealed, and Privacy says so.
    static let shared: SymmetricKey? = {
        guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil else { return nil }
        return loadOrCreate()
    }()

    /// For the engine's environment: base64, as `DIDJA_DB_KEY`.
    static var base64: String? {
        shared.map { $0.withUnsafeBytes { Data($0).base64EncodedString() } }
    }

    /// The saved key; a new one only when none is saved. An existing key is never replaced.
    static func loadOrCreate() -> SymmetricKey? {
        if let saved = read() { return saved.count == 32 ? SymmetricKey(data: saved) : nil }
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { return nil }
        let data = Data(bytes)
        let add: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrLabel as String: "Didja database key",
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
            kSecValueData as String: data,
        ]
        let status = SecItemAdd(add as CFDictionary, nil)
        if status == errSecDuplicateItem { return read().flatMap { $0.count == 32 ? SymmetricKey(data: $0) : nil } }
        return status == errSecSuccess ? SymmetricKey(data: data) : nil
    }

    private static func read() -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else { return nil }
        return item as? Data
    }
}

/// Sealed values (SCR-101): "enc1:" + base64 of AES-GCM's combined box (nonce, ciphertext, tag),
/// the layout the engine writes and reads too (engine/src/sealed.ts).
enum Sealed {
    static let prefix = "enc1:"

    static func seal(_ text: String, key: SymmetricKey) -> String? {
        guard let combined = try? AES.GCM.seal(Data(text.utf8), using: key).combined else { return nil }
        return prefix + combined.base64EncodedString()
    }

    /// The text: as it is when never sealed; nil when sealed and the key is missing or wrong.
    static func open(_ value: String, key: SymmetricKey?) -> String? {
        guard value.hasPrefix(prefix) else { return value }
        guard let key, let data = Data(base64Encoded: String(value.dropFirst(prefix.count))),
              let box = try? AES.GCM.SealedBox(combined: data),
              let plain = try? AES.GCM.open(box, using: key)
        else { return nil }
        return String(data: plain, encoding: .utf8)
    }
}
