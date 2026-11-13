import Foundation
import SQLite3

/// Writes observations to the SQLite database shared with the engine.
/// Use from one thread at a time (the capture queue).
final class ObservationStore {
    enum Source: String {
        case ax, ocr
    }

    struct StoreError: LocalizedError {
        var message: String
        var errorDescription: String? { message }
    }

    /// The app was called ScrolledAway until 2026-11-11. Its data folder and database move to the
    /// new name the first time the app starts (the engine does the same if it starts first).
    /// Nothing is overwritten: if the new place has a database already, the old one is left alone.
    static func moveFromOldName(fileManager: FileManager = .default,
                                support: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]) {
        let old = support.appendingPathComponent("ScrolledAway")
        let new = support.appendingPathComponent("Didja")
        if fileManager.fileExists(atPath: old.path), !fileManager.fileExists(atPath: new.path) {
            try? fileManager.moveItem(at: old, to: new)
        }
        guard !fileManager.fileExists(atPath: new.appendingPathComponent("didja.db").path) else { return }
        for ext in ["", "-wal", "-shm"] {
            let from = new.appendingPathComponent("scrolledaway.db\(ext)")
            if fileManager.fileExists(atPath: from.path) {
                try? fileManager.moveItem(at: from, to: new.appendingPathComponent("didja.db\(ext)"))
            }
        }
    }

    /// Settings kept by the app under its old identity (pinned panel, appearance, welcome seen,
    /// reminders…), copied once into the new one.
    static func copyOldPreferences(to defaults: UserDefaults = .standard, from oldDomain: String = "com.scrolledaway.app") {
        let flag = "copiedPreferencesFromScrolledAway"
        guard !defaults.bool(forKey: flag) else { return }
        for (key, value) in UserDefaults.standard.persistentDomain(forName: oldDomain) ?? [:] where defaults.object(forKey: key) == nil {
            defaults.set(value, forKey: key)
        }
        defaults.set(true, forKey: flag)
    }

    static var defaultDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Didja", isDirectory: true)
    }

    private var db: OpaquePointer?
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    private static let timestamp: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    /// One step of the shared schema (`schema/NNN_*.sql`, bundled with the app).
    struct Migration {
        var version: Int
        var sql: String
    }

    /// Opens (and if needed creates) `didja.db` in `directory` and brings
    /// its schema up to date. The engine does the same, so each step is applied
    /// under the write lock and only by whichever side gets there first.
    init(directory: URL, migrations: [Migration]? = nil) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let path = directory.appendingPathComponent("didja.db").path
        guard sqlite3_open(path, &db) == SQLITE_OK else { throw lastError("open") }
        try exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;")

        let steps = migrations ?? Self.bundledMigrations()
        guard !steps.isEmpty else { throw StoreError(message: "Database schema is missing from the app bundle") }
        try exec("BEGIN IMMEDIATE")
        do {
            let current = try scalar("PRAGMA user_version")
            for step in steps.sorted(by: { $0.version < $1.version }) where step.version > current {
                try exec(step.sql)
            }
            try exec("COMMIT")
        } catch {
            try? exec("ROLLBACK")
            throw error
        }
    }

    deinit {
        sqlite3_close(db)
    }

    static func bundledMigrations() -> [Migration] {
        (Bundle.main.urls(forResourcesWithExtension: "sql", subdirectory: nil) ?? []).compactMap { url in
            guard let version = Int(url.lastPathComponent.prefix(3)),
                  let sql = try? String(contentsOf: url, encoding: .utf8)
            else { return nil }
            return Migration(version: version, sql: sql)
        }
    }

    /// Stores one observation. `windowKey` is the window it was seen in (`Differ.windowKey`, SCR-72);
    /// the engine reads a window's history by it.
    func insert(bundleID: String, app: String, windowTitle: String, url: String?, source: Source,
                text: String, windowKey: String? = nil, at date: Date = Date()) throws {
        let sql = """
            INSERT INTO observations (ts, bundle_id, app, window_title, url, source, text, window_key)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { throw lastError("prepare") }
        defer { sqlite3_finalize(statement) }
        let key = windowKey ?? Differ.windowKey(bundleID: bundleID, title: windowTitle, url: url)
        let values: [String?] = [Self.timestamp.string(from: date), bundleID, app, windowTitle, url, source.rawValue, text, key]
        for (index, value) in values.enumerated() {
            if let value {
                sqlite3_bind_text(statement, Int32(index + 1), value, -1, transient)
            } else {
                sqlite3_bind_null(statement, Int32(index + 1))
            }
        }
        guard sqlite3_step(statement) == SQLITE_DONE else { throw lastError("insert") }
    }

    /// The newest lines kept from an app, oldest first: for Report a Problem (SCR-42), never saved by it.
    func recentLines(bundleID: String, limit: Int) throws -> [String] {
        let sql = "SELECT text FROM observations WHERE bundle_id = ? ORDER BY id DESC LIMIT 40"
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { throw lastError("prepare") }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, bundleID, -1, transient)
        var texts: [String] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            if let text = sqlite3_column_text(statement, 0) { texts.append(String(cString: text)) }
        }
        let lines = texts.reversed().flatMap { $0.split(separator: "\n").map(String.init) }
        return Array(lines.suffix(limit))
    }

    /// Enforces the retention limit. Returns how many observations were removed.
    @discardableResult
    func deleteObservations(olderThan cutoff: Date) throws -> Int {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, "DELETE FROM observations WHERE ts < ?", -1, &statement, nil) == SQLITE_OK
        else { throw lastError("prepare") }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, Self.timestamp.string(from: cutoff), -1, transient)
        guard sqlite3_step(statement) == SQLITE_DONE else { throw lastError("delete") }
        return Int(sqlite3_changes(db))
    }

    /// Forgets what was kept from windows that may no longer be read, after the
    /// exclude list grows. Returns how many observations were removed.
    @discardableResult
    func deleteObservations(where excluded: (_ bundleID: String, _ windowTitle: String, _ url: String?) -> Bool) throws -> Int {
        var select: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT id, bundle_id, window_title, url FROM observations", -1, &select, nil) == SQLITE_OK
        else { throw lastError("prepare") }
        var doomed: [Int64] = []
        while sqlite3_step(select) == SQLITE_ROW {
            func text(_ column: Int32) -> String? { sqlite3_column_text(select, column).map { String(cString: $0) } }
            if excluded(text(1) ?? "", text(2) ?? "", text(3)) { doomed.append(sqlite3_column_int64(select, 0)) }
        }
        sqlite3_finalize(select)
        for id in doomed { try exec("DELETE FROM observations WHERE id = \(id)") }
        // The lines kept with open tasks (SCR-31) come from the same windows: forget those too.
        var contexts: OpaquePointer?
        if sqlite3_prepare_v2(db, "SELECT task_id, bundle_id, window_title, url FROM task_context", -1, &contexts, nil) == SQLITE_OK {
            var gone: [Int64] = []
            while sqlite3_step(contexts) == SQLITE_ROW {
                func text(_ column: Int32) -> String? { sqlite3_column_text(contexts, column).map { String(cString: $0) } }
                if excluded(text(1) ?? "", text(2) ?? "", text(3)) { gone.append(sqlite3_column_int64(contexts, 0)) }
            }
            sqlite3_finalize(contexts)
            for id in gone { try exec("DELETE FROM task_context WHERE task_id = \(id)") }
        }
        return doomed.count
    }

    /// Forgets the lines kept with open tasks (SCR-31), as "Forget Captured Text Now" does.
    func deleteTaskContext() throws {
        try exec("DELETE FROM task_context")
    }

    /// Every task: top-level items first (newest source and newest item first), then
    /// everything nested under them in list order. `TaskBoard` assembles the tree.
    func tasks(limit: Int = 2000) throws -> [TaskItem] {
        let sql = """
            SELECT t.id, COALESCE(t.custom_title, NULLIF(t.model_title, ''), t.title), t.status, s.ref, t.parent_id, t.is_group,
                   t.done_at, t.snoozed_until, t.created_at, t.collapsed, t.auto, t.suggestion,
                   t.last_seen_at, t.accepted_from,
                   (SELECT e.detail FROM evidence e
                    WHERE e.task_id = t.id AND e.detail IS NOT NULL ORDER BY e.ts DESC, e.id DESC LIMIT 1),
                   json_extract(t.criteria, '$.external.key'), json_extract(t.criteria, '$.external.url'),
                   (SELECT CASE WHEN ms.other_id = t.id THEN ms.task_id ELSE ms.other_id END FROM merge_suggestions ms
                     WHERE ms.status = 'suggested' AND ((ms.other_id = t.id AND (SELECT x.status FROM tasks x WHERE x.id = ms.other_id) = 'open')
                       OR (ms.task_id = t.id AND (SELECT x.status FROM tasks x WHERE x.id = ms.other_id) != 'open')) LIMIT 1),
                   (SELECT COALESCE(p.custom_title, NULLIF(p.model_title, ''), p.title) FROM tasks p WHERE p.id = (SELECT CASE WHEN ms.other_id = t.id THEN ms.task_id ELSE ms.other_id END FROM merge_suggestions ms
                     WHERE ms.status = 'suggested' AND ((ms.other_id = t.id AND (SELECT x.status FROM tasks x WHERE x.id = ms.other_id) = 'open')
                       OR (ms.task_id = t.id AND (SELECT x.status FROM tasks x WHERE x.id = ms.other_id) != 'open')) LIMIT 1)),
                   (SELECT ps.ref FROM tasks p JOIN sources ps ON ps.id = p.source WHERE p.id = (SELECT CASE WHEN ms.other_id = t.id THEN ms.task_id ELSE ms.other_id END FROM merge_suggestions ms
                     WHERE ms.status = 'suggested' AND ((ms.other_id = t.id AND (SELECT x.status FROM tasks x WHERE x.id = ms.other_id) = 'open')
                       OR (ms.task_id = t.id AND (SELECT x.status FROM tasks x WHERE x.id = ms.other_id) != 'open')) LIMIT 1)),
                   (SELECT group_concat(ms2.ref, char(10)) FROM tasks m JOIN sources ms2 ON ms2.id = m.source WHERE m.merged_into = t.id),
                   json_extract(t.criteria, '$.chat.from'),
                   (SELECT e.detail FROM evidence e WHERE e.task_id = t.id AND e.kind = 'origin' ORDER BY e.id DESC LIMIT 1),
                   t.confidence
            FROM tasks t JOIN sources s ON s.id = t.source
            WHERE t.merged_into IS NULL
            ORDER BY s.id DESC, t.parent_id IS NOT NULL,
                     CASE WHEN t.parent_id IS NULL THEN -t.id END, t.position IS NULL, t.position, t.id
            LIMIT \(limit)
            """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { throw lastError("prepare") }
        defer { sqlite3_finalize(statement) }
        func text(_ column: Int32) -> String? {
            sqlite3_column_text(statement, column).map { String(cString: $0) }
        }
        var rows: [TaskItem] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            rows.append(TaskItem(
                id: Int(sqlite3_column_int64(statement, 0)),
                title: text(1) ?? "",
                status: TaskItem.Status(rawValue: text(2) ?? "") ?? .open,
                source: text(3) ?? "",
                parentID: sqlite3_column_type(statement, 4) == SQLITE_NULL ? nil : Int(sqlite3_column_int64(statement, 4)),
                isGroup: sqlite3_column_int(statement, 5) == 1,
                doneAt: text(6).flatMap(Self.timestamp.date(from:)),
                snoozedUntil: text(7).flatMap(Self.timestamp.date(from:)),
                capturedAt: text(8).flatMap(Self.timestamp.date(from:)),
                collapsed: sqlite3_column_int(statement, 9) == 1,
                auto: sqlite3_column_int(statement, 10) == 1,
                suggestion: text(11),
                note: text(14),
                activeAt: text(12).flatMap(Self.timestamp.date(from:)),
                acceptedFrom: text(13),
                externalKey: text(15),
                externalURL: text(16),
                mergeWith: sqlite3_column_type(statement, 17) == SQLITE_NULL ? nil : Int(sqlite3_column_int64(statement, 17)),
                mergeWithTitle: text(18),
                mergeWithSource: text(19),
                alsoFrom: text(20).map { $0.split(separator: "\n").map(String.init) } ?? [],
                asker: TaskItem.asker(chatFrom: text(21), origin: text(22)),
                maybe: sqlite3_column_type(statement, 23) != SQLITE_NULL && sqlite3_column_double(statement, 23) <= TaskItem.maybeLimit))
        }
        return rows
    }

    /// Small shared key/value notes, e.g. the capture status the CLI reports.
    func setMeta(_ key: String, _ value: String) throws {
        let sql = "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { throw lastError("prepare") }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, key, -1, transient)
        sqlite3_bind_text(statement, 2, value, -1, transient)
        guard sqlite3_step(statement) == SQLITE_DONE else { throw lastError("meta") }
    }

    func observationCount() throws -> Int {
        try scalar("SELECT COUNT(*) FROM observations")
    }

    private func exec(_ sql: String) throws {
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw lastError("exec") }
    }

    private func scalar(_ sql: String) throws -> Int {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { throw lastError("prepare") }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW else { throw lastError("step") }
        return Int(sqlite3_column_int64(statement, 0))
    }

    private func lastError(_ what: String) -> StoreError {
        StoreError(message: "SQLite \(what) failed: \(String(cString: sqlite3_errmsg(db)))")
    }
}
