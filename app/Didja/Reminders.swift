import EventKit
import Foundation
import SwiftUI

/// Apple Reminders (SCR-121), opt-in: captured tasks written to a Reminders list and kept in step
/// both ways. The app reads and writes Reminders with EventKit; every rule (which tasks go there,
/// what a completed or deleted reminder means) is the engine's (`didja reminders plan | written`).
/// A reminder holds the engine-written title and a `didja://task/<id>` link, and nothing else
/// unless you choose "include who asked". Reminders syncs through iCloud if you use it.
enum Reminders {
    struct Status: Decodable, Equatable {
        var on: Bool
        var list: String
        var sources: [String]
        var who: Bool
        var written: Int
    }

    struct Create: Decodable, Equatable {
        var taskId: Int
        var title: String
        var url: String
        var notes: String?
    }

    struct Plan: Decodable, Equatable {
        var list: String
        var create: [Create]
        var complete: [String]
        var reopen: [String]
        var ticked: Int
        var dismissed: Int
        var held: Bool
    }

    struct Seen: Encodable, Equatable {
        var id: String
        var completed: Bool
    }

    struct Written: Encodable, Equatable {
        struct Created: Encodable, Equatable { var taskId: Int; var reminderId: String }
        var created: [Created] = []
        var completed: [String] = []
        var reopened: [String] = []
        var isEmpty: Bool { created.isEmpty && completed.isEmpty && reopened.isEmpty }
    }

    /// The groups of tasks you can send, as the engine names them.
    static let sources: [(key: String, label: String)] = [
        ("chat", "Chats"), ("email", "Emails"), ("ai", "AI steps"), ("mylist", "My List"), ("other", "Everything else"),
    ]

    /// Said at the switch, so it is clear what leaves the Mac.
    static let iCloudNote = "Reminders syncs through iCloud if you use it; titles then leave this Mac."

    /// The task id in a Didja link (`didja://task/12`), or nil.
    static func taskId(of url: URL?) -> Int? {
        guard let url, url.scheme == "didja", url.host == "task" else { return nil }
        let rest = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let id = Int(rest), id > 0 else { return nil }
        return id
    }

    /// Carry out the engine's plan on a Reminders store: create, complete and reopen exactly the
    /// reminders it names, and nothing else. Returns what was written, for `didja reminders written`.
    static func apply(_ plan: Plan, to store: ReminderStore) -> Written {
        var written = Written()
        for id in plan.complete where store.setCompleted(id, true) { written.completed.append(id) }
        for id in plan.reopen where store.setCompleted(id, false) { written.reopened.append(id) }
        if !plan.create.isEmpty, let list = store.list(named: plan.list) {
            for item in plan.create {
                guard let url = URL(string: item.url), taskId(of: url) == item.taskId,
                      let id = store.add(title: item.title, url: url, notes: item.notes, list: list) else { continue }
                written.created.append(.init(taskId: item.taskId, reminderId: id))
            }
        }
        return written
    }

    // MARK: The engine

    static func status() -> Status? {
        guard let output = EngineRunner.output(["reminders", "status", "--json"]) else { return nil }
        return try? JSONDecoder().decode(Status.self, from: Data(output.utf8))
    }

    /// One sync: what Reminders shows goes to the engine, its plan is carried out, and what was
    /// written goes back. Does nothing while it is off or Reminders cannot be read.
    @discardableResult
    static func sync(store: ReminderStore = EventKitReminders.shared) -> Plan? {
        guard status()?.on == true, store.canWrite, let seen = store.didjaReminders() else { return nil }
        let body = (try? JSONEncoder().encode(["reminders": seen])).map { String(decoding: $0, as: UTF8.self) } ?? "{}"
        guard let output = EngineRunner.output(["reminders", "plan"], input: body),
              let plan = try? JSONDecoder().decode(Plan.self, from: Data(output.utf8)) else { return nil }
        let written = apply(plan, to: store)
        if !written.isEmpty, let data = try? JSONEncoder().encode(written) {
            EngineRunner.run(["reminders", "written"], input: String(decoding: data, as: UTF8.self))
        }
        return plan
    }
}

/// What a sync needs from Reminders; EventKit in the app, a fake in tests.
protocol ReminderStore {
    var canWrite: Bool { get }
    /// Every reminder carrying a Didja link, in any list; nil when Reminders could not be read.
    func didjaReminders() -> [Reminders.Seen]?
    /// The list's identifier, made if it is not there yet.
    func list(named name: String) -> String?
    func add(title: String, url: URL, notes: String?, list: String) -> String?
    /// Complete or reopen one reminder. False when it is not there.
    func setCompleted(_ id: String, _ completed: Bool) -> Bool
}

final class EventKitReminders: ReminderStore {
    static let shared = EventKitReminders()
    let store = EKEventStore()

    var canWrite: Bool { EKEventStore.authorizationStatus(for: .reminder) == .fullAccess }

    /// Ask macOS for access to Reminders (it asks you once).
    func requestAccess(_ done: @escaping (Bool) -> Void) {
        store.requestFullAccessToReminders { granted, _ in DispatchQueue.main.async { done(granted) } }
    }

    func didjaReminders() -> [Reminders.Seen]? {
        guard canWrite else { return nil }
        let wait = DispatchSemaphore(value: 0)
        var found: [EKReminder]?
        store.fetchReminders(matching: store.predicateForReminders(in: nil)) { reminders in
            found = reminders
            wait.signal()
        }
        guard wait.wait(timeout: .now() + 20) == .success, let found else { return nil }
        return found.compactMap { r in
            Reminders.taskId(of: r.url) == nil ? nil : Reminders.Seen(id: r.calendarItemIdentifier, completed: r.isCompleted)
        }
    }

    func list(named name: String) -> String? {
        if let list = store.calendars(for: .reminder).first(where: { $0.title == name }) { return list.calendarIdentifier }
        guard let source = store.defaultCalendarForNewReminders()?.source ?? store.sources.first(where: { $0.sourceType == .local }) else { return nil }
        let list = EKCalendar(for: .reminder, eventStore: store)
        list.title = name
        list.source = source
        do {
            try store.saveCalendar(list, commit: true)
            return list.calendarIdentifier
        } catch {
            NSLog("Didja: could not make the Reminders list")
            return nil
        }
    }

    func add(title: String, url: URL, notes: String?, list: String) -> String? {
        guard let calendar = store.calendar(withIdentifier: list) else { return nil }
        let reminder = EKReminder(eventStore: store)
        reminder.title = title
        reminder.url = url
        reminder.notes = notes
        reminder.calendar = calendar
        do {
            try store.save(reminder, commit: true)
            return reminder.calendarItemIdentifier
        } catch {
            return nil
        }
    }

    func setCompleted(_ id: String, _ completed: Bool) -> Bool {
        guard let reminder = store.calendarItem(withIdentifier: id) as? EKReminder else { return false }
        if reminder.isCompleted == completed { return true }
        reminder.isCompleted = completed
        return (try? store.save(reminder, commit: true)) != nil
    }
}

/// Keeps Reminders in step while the app runs: every minute, and soon after Reminders changes.
final class RemindersSyncer {
    static let shared = RemindersSyncer()
    private let queue = DispatchQueue(label: "dev.didja.reminders")
    private var timer: DispatchSourceTimer?
    private var observer: NSObjectProtocol?
    private var pending = false

    func start() {
        guard timer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 15, repeating: 60)
        timer.setEventHandler { Reminders.sync() }
        timer.resume()
        self.timer = timer
        observer = NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: EventKitReminders.shared.store, queue: nil) { [weak self] _ in
            self?.soon()
        }
    }

    /// Sync in a few seconds; changes that come meanwhile are folded into it.
    func soon() {
        queue.async { [self] in
            guard !pending else { return }
            pending = true
            queue.asyncAfter(deadline: .now() + 3) { [self] in
                pending = false
                Reminders.sync()
            }
        }
    }
}

/// Settings › Connections › Apple Reminders.
final class RemindersModel: ObservableObject {
    @Published private(set) var status: Reminders.Status?
    @Published private(set) var message: String?
    @Published var listName = ""

    init() { reload() }

    /// For tests and renders: a fixed state, without asking the engine.
    init(status: Reminders.Status?) {
        self.status = status
        listName = status?.list ?? "Didja"
    }

    func reload() {
        status = Reminders.status()
        listName = status?.list ?? "Didja"
    }

    func setOn(_ on: Bool) {
        guard on else {
            EngineRunner.run(["reminders", "off"])
            message = nil
            reload()
            return
        }
        EventKitReminders.shared.requestAccess { [weak self] granted in
            guard let self else { return }
            guard granted else {
                message = "Didja may not use Reminders. Allow it in System Settings › Privacy & Security › Reminders, then turn this on again."
                reload()
                return
            }
            EngineRunner.run(["reminders", "on"])
            message = "New tasks go to “\(status?.list ?? "Didja")” in Reminders from now on."
            reload()
            RemindersSyncer.shared.soon()
        }
    }

    func commitList() {
        let name = listName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name != status?.list else { listName = status?.list ?? "Didja"; return }
        EngineRunner.run(["reminders", "list", name])
        reload()
    }

    func setSource(_ key: String, _ on: Bool) {
        var chosen = Set(status?.sources ?? [])
        if on { chosen.insert(key) } else { chosen.remove(key) }
        let keys = Reminders.sources.map(\.key).filter(chosen.contains)
        EngineRunner.run(["reminders", "sources", keys.isEmpty ? "none" : keys.joined(separator: ",")])
        reload()
    }

    func setWho(_ on: Bool) {
        EngineRunner.run(["reminders", "who", on ? "on" : "off"])
        reload()
    }
}

struct RemindersSection: View {
    @ObservedObject var model: RemindersModel

    var body: some View {
        let status = model.status
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Apple Reminders").font(.headline)
                Spacer()
                Toggle("", isOn: Binding(get: { status?.on == true }, set: { model.setOn($0) }))
                    .toggleStyle(.switch).labelsHidden()
                    .accessibilityLabel("Write tasks to Apple Reminders")
            }
            Text("New tasks also go to a Reminders list: the title and a link back to Didja, nothing else. Complete one there and it is ticked here as done by you; delete it there and it is dismissed here. Reminders you make yourself are never touched.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Text(Reminders.iCloudNote)
                .font(.callout.weight(.medium)).fixedSize(horizontal: false, vertical: true)
            if status?.on == true {
                HStack {
                    Text("List")
                    TextField("Didja", text: $model.listName, onCommit: { model.commitList() })
                        .frame(maxWidth: 220)
                }
                .font(.callout)
                Text("Send").font(.subheadline.weight(.semibold))
                HStack(spacing: 14) {
                    ForEach(Reminders.sources, id: \.key) { source in
                        Toggle(source.label, isOn: Binding(
                            get: { status?.sources.contains(source.key) == true },
                            set: { model.setSource(source.key, $0) }))
                    }
                }
                .font(.callout)
                Toggle("Include who asked (the chat, or the email's sender and subject)", isOn: Binding(
                    get: { status?.who == true }, set: { model.setWho($0) }))
                    .font(.callout)
                Text("Only tasks captured after you turned this on go there. \(status?.written ?? 0) written so far.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let message = model.message {
                Text(message).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))
    }
}
