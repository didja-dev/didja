import AppKit
import SwiftUI

/// Who you are, for chats: your name, and the names and nicknames people call or tag you by, in any
/// language. A group message becomes a task only when it names or tags you (or asks everyone), and
/// your own messages are told apart by your names. Kept by the engine (`didja names`).
final class NamesModel: ObservableObject {
    struct Names: Decodable, Equatable {
        var mac: String?
        var name: String?
        var mail: [String]
        var others: [String]
    }

    @Published private(set) var names = Names(mac: nil, name: nil, mail: [], others: [])
    /// What is in the "Your name" field.
    @Published var nameDraft = ""
    /// What is in the "Add a name" field.
    @Published var newName = ""
    @Published private(set) var error: String?

    private let fetch: () -> String?
    private let run: ([String]) -> Bool

    init(fetch: @escaping () -> String? = { EngineRunner.output(["names", "--json"]) },
         run: @escaping ([String]) -> Bool = { EngineRunner.run($0) }) {
        self.fetch = fetch
        self.run = run
        reload()
    }

    func reload() {
        guard let text = fetch(), let shown = try? JSONDecoder().decode(Names.self, from: Data(text.utf8)) else {
            error = "Could not read your names."
            return
        }
        names = shown
        nameDraft = shown.name ?? shown.mac ?? ""
        error = nil
    }

    /// The name in use: the one you set, or your Mac account's.
    var nameInUse: String { names.name ?? names.mac ?? "" }

    var nameEdited: Bool { Self.clean(nameDraft) != nameInUse }

    /// Save the "Your name" field. Empty, or the Mac's own name, goes back to following the Mac.
    func saveName() {
        let name = Self.clean(nameDraft)
        let follow = name.isEmpty || name == names.mac
        change(follow ? ["names", "set"] : ["names", "set", name])
    }

    func add() {
        let name = Self.clean(newName)
        guard !name.isEmpty else { return }
        if change(["names", "add", name]) { newName = "" }
    }

    func remove(_ name: String) {
        change(["names", "remove", name])
    }

    @discardableResult
    private func change(_ arguments: [String]) -> Bool {
        guard run(arguments) else {
            error = "Could not save. Is Didja's engine in the app?"
            return false
        }
        reload()
        return true
    }

    static func clean(_ text: String) -> String {
        text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }
}

/// The Your Names window: fixed width, scrolling content (a window sized by SwiftUI content can loop and crash).
struct NamesView: View {
    static let width: CGFloat = 520
    @ObservedObject var model: NamesModel

    var body: some View {
        ScrollView { NamesContent(model: model) }
            .frame(width: Self.width)
    }
}

struct NamesContent: View {
    @ObservedObject var model: NamesModel

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Image(systemName: "person.text.rectangle").font(.system(size: 20)).foregroundStyle(Palette.accent)
                    Text("Your Names").font(.title2.weight(.semibold))
                }
                Text("How people call you and tag you in chats, in any language. In a group, a message becomes a task only when it tags or names you, or asks everyone; your own messages are known by these names too.")
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if let error = model.error {
                    Text(error).font(.callout).foregroundStyle(Palette.attention)
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Your name").font(.headline)
                HStack {
                    TextField(model.names.mac ?? "Your name", text: $model.nameDraft)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit { model.saveName() }
                    Button("Save") { model.saveName() }
                        .disabled(!model.nameEdited)
                }
                if let mac = model.names.mac {
                    Text(model.names.name == nil
                         ? "Your Mac account's name. Change it here if people know you by another."
                         : "Set by you. Clear the field and save to use your Mac account's name (\(mac)) again.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Other names and nicknames").font(.headline)
                Text("Add each name people use for you, in each language and spelling, as they would write it to tag you: for example מייק, Mikey, Mike R.")
                    .font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if model.names.others.isEmpty {
                    Text("None yet.").foregroundStyle(.secondary)
                }
                ForEach(model.names.others, id: \.self) { name in
                    HStack {
                        Text(name)
                        Spacer()
                        Button { model.remove(name) } label: { Image(systemName: "xmark.circle") }
                            .buttonStyle(.plain).foregroundStyle(.secondary)
                            .help("Remove \(name)")
                    }
                    .padding(.vertical, 4).padding(.horizontal, 10)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.05)))
                }
                HStack {
                    TextField("Add a name or nickname", text: $model.newName)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit { model.add() }
                    Button("Add") { model.add() }
                        .disabled(NamesModel.clean(model.newName).isEmpty)
                }
            }

            if !model.names.mail.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Learned from your mail").font(.headline)
                    Text("The names your own emails are sent under. Used too.")
                        .font(.caption).foregroundStyle(.secondary)
                    ForEach(model.names.mail, id: \.self) { Text($0).foregroundStyle(.secondary) }
                }
            }
        }
        .padding(24)
        .frame(width: NamesView.width, alignment: .leading)
    }
}
