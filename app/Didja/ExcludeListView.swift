import AppKit
import SwiftUI

/// Holds the exclude list while its window is open, and writes every change
/// to `exclude.json` straight away.
final class ExcludeListModel: ObservableObject {
    struct App: Identifiable, Equatable {
        var name: String
        var bundleID: String
        var id: String { bundleID }
    }

    @Published private(set) var list = ExcludeList()
    /// Why the last change, or reading the file, did not work.
    @Published private(set) var error: String?
    /// False when the file on disk cannot be read: it is left alone, not overwritten.
    @Published private(set) var editable = true

    let file: URL
    private let changed: () -> Void
    private let running: () -> [App]
    private let nameOf: (String) -> String?

    init(file: URL, changed: @escaping () -> Void = {},
         running: @escaping () -> [App] = ExcludeListModel.runningApps,
         nameOf: @escaping (String) -> String? = ExcludeListModel.installedName) {
        self.file = file
        self.changed = changed
        self.running = running
        self.nameOf = nameOf
        do {
            list = try ExcludeList.load(from: file)
        } catch {
            self.error = "\(error.localizedDescription). Fix or delete the file, then open this window again."
            editable = false
        }
    }

    /// Apps open now that could be added: not this one, not ones already listed.
    var candidates: [App] {
        running()
            .filter { app in
                app.bundleID != Bundle.main.bundleIdentifier
                    && !list.bundleIds.contains { $0.caseInsensitiveCompare(app.bundleID) == .orderedSame }
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    /// The apps you excluded, by name where the app can be found on this Mac. Default entries are shown apart.
    var apps: [App] {
        list.bundleIds.filter { !DefaultExclusions.isDefault(bundleID: $0) }.map { App(name: nameOf($0) ?? $0, bundleID: $0) }
    }

    /// The window titles and sites you added yourself.
    var windowPatterns: [String] { list.windowPatterns.filter { !DefaultExclusions.isDefault(windowPattern: $0) } }
    var urlPatterns: [String] { list.urlPatterns.filter { !DefaultExclusions.isDefault(urlPattern: $0) } }

    /// One entry of the default list still on yours (SCR-94).
    struct DefaultEntry: Identifiable, Equatable {
        enum Kind { case site, title, app }
        var kind: Kind
        var stored: String
        var label: String
        var id: String { stored }
    }

    /// The default entries still on the list: sites, then window titles, then apps.
    var defaults: [DefaultEntry] {
        list.urlPatterns.filter(DefaultExclusions.isDefault(urlPattern:))
            .map { DefaultEntry(kind: .site, stored: $0, label: ExcludeList.label(forURLPattern: $0)) }
            + list.windowPatterns.filter(DefaultExclusions.isDefault(windowPattern:))
            .map { DefaultEntry(kind: .title, stored: $0, label: "Title: " + ExcludeList.label(forPattern: $0)) }
            + list.bundleIds.filter(DefaultExclusions.isDefault(bundleID:))
            .map { DefaultEntry(kind: .app, stored: $0, label: "Apps: " + $0 + "…") }
    }

    func remove(_ entry: DefaultEntry) {
        switch entry.kind {
        case .site: removeURLPattern(entry.stored)
        case .title: removeWindowPattern(entry.stored)
        case .app: removeApp(entry.stored)
        }
    }

    /// Puts back every default entry you removed; your own entries are kept.
    func restoreDefaults() { change { $0.addDefaults() } }

    func addApp(_ bundleID: String) { change { $0.addApp(bundleID: bundleID) } }

    /// False when the text was not something that can be added, so the field keeps it.
    @discardableResult
    func addWindowText(_ text: String) -> Bool { change { $0.addWindowText(text) } }

    @discardableResult
    func addSite(_ text: String) -> Bool {
        guard ExcludeList.host(from: text) != nil else {
            error = "“\(text.trimmingCharacters(in: .whitespaces))” is not a site name. Try something like mybank.com."
            return false
        }
        return change { $0.addSite(text) }
    }

    func removeApp(_ bundleID: String) { change { $0.bundleIds.removeAll { $0 == bundleID }; return true } }
    func removeWindowPattern(_ pattern: String) { change { $0.windowPatterns.removeAll { $0 == pattern }; return true } }
    func removeURLPattern(_ pattern: String) { change { $0.urlPatterns.removeAll { $0 == pattern }; return true } }

    @discardableResult
    private func change(_ edit: (inout ExcludeList) -> Bool) -> Bool {
        guard editable else { return false }
        var next = list
        guard edit(&next) else { return false }
        do {
            try next.save(to: file)
            list = next
            error = nil
            changed()
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    static func runningApps() -> [App] {
        NSWorkspace.shared.runningApplications.compactMap { app in
            guard app.activationPolicy == .regular, let id = app.bundleIdentifier else { return nil }
            return App(name: app.localizedName ?? id, bundleID: id)
        }
    }

    static func installedName(bundleID: String) -> String? {
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) else { return nil }
        return FileManager.default.displayName(atPath: url.path).replacingOccurrences(of: ".app", with: "")
    }
}

/// The window where you choose what Didja never reads.
struct ExcludeListView: View {
    @ObservedObject var model: ExcludeListModel
    @State private var windowText = ""
    @State private var siteText = ""
    @State private var showDefaults: Bool

    init(model: ExcludeListModel, showDefaults: Bool = false) {
        self.model = model
        _showDefaults = State(initialValue: showDefaults)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Exclude list").font(.title2.weight(.semibold))
                Text("Didja never reads these. A change applies at once, and text already kept from anything you add is deleted.")
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let error = model.error {
                Text(error).font(.callout).foregroundStyle(Palette.attention).fixedSize(horizontal: false, vertical: true)
            }

            group("app.dashed", "Apps") {
                ForEach(model.apps) { app in
                    row(app.name, detail: app.name == app.bundleID ? nil : app.bundleID) { model.removeApp(app.bundleID) }
                }
                Menu {
                    ForEach(model.candidates) { app in
                        Button(app.name) { model.addApp(app.bundleID) }
                    }
                } label: {
                    Label("Add an Open App", systemImage: "plus")
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                .disabled(!model.editable)
            }

            group("macwindow", "Windows whose title contains") {
                ForEach(model.windowPatterns, id: \.self) { pattern in
                    row(ExcludeList.label(forPattern: pattern)) { model.removeWindowPattern(pattern) }
                }
                entry("Payroll, Medical results…", text: $windowText) {
                    if model.addWindowText(windowText) { windowText = "" }
                }
            }

            group("globe", "Sites") {
                ForEach(model.urlPatterns, id: \.self) { pattern in
                    row(ExcludeList.label(forURLPattern: pattern)) { model.removeURLPattern(pattern) }
                }
                entry("mybank.com", text: $siteText) {
                    if model.addSite(siteText) { siteText = "" }
                }
            }

            group("building.columns", "Banks, payments and health") {
                Text("\(model.defaults.count) sites and apps are never read unless you remove them: banks, brokerages, payment checkouts and patient portals. Remove one you want Didja to read, such as a portal you work in.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                DisclosureGroup(isExpanded: $showDefaults) {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(model.defaults) { entry in
                            row(entry.label) { model.remove(entry) }
                        }
                    }
                    .padding(.top, 4)
                } label: {
                    Text(showDefaults ? "Hide the List" : "Show the List")
                }
                if model.list.removedDefaults > 0 {
                    Button("Restore Defaults (\(model.list.removedDefaults) removed)", action: model.restoreDefaults)
                        .buttonStyle(DidjaButtonStyle.secondary)
                        .disabled(!model.editable)
                }
            }

            Divider()
            Text("Always excluded, whatever is listed here: password managers, password prompts and password fields, card and bank-account fields, and private or incognito browser windows.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(24)
        .frame(width: 480)
        .background(Palette.surface)
    }

    private func group<Content: View>(_ symbol: String, _ title: String, @ViewBuilder content: () -> Content) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 15))
                .foregroundStyle(Palette.accent)
                .frame(width: 22, height: 20)
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.headline)
                content()
            }
            Spacer(minLength: 0)
        }
    }

    private func row(_ title: String, detail: String? = nil, remove: @escaping () -> Void) -> some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 0) {
                Text(title).lineLimit(1).truncationMode(.middle)
                if let detail {
                    Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                }
            }
            Spacer(minLength: 8)
            Button(action: remove) { Image(systemName: "xmark") }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("Remove “\(title)” from the list")
                .accessibilityLabel("Remove \(title)")
                .disabled(!model.editable)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(RoundedRectangle(cornerRadius: 6).fill(Palette.chip))
    }

    private func entry(_ prompt: String, text: Binding<String>, add: @escaping () -> Void) -> some View {
        HStack(spacing: 8) {
            TextField(prompt, text: text)
                .textFieldStyle(.roundedBorder)
                .onSubmit(add)
            Button("Add", action: add)
                .buttonStyle(DidjaButtonStyle.secondary)
                .disabled(text.wrappedValue.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .disabled(!model.editable)
    }
}

/// The exclude list as its window shows it: fixed width, scrolling when the list is long.
struct ExcludeListWindowContent: View {
    static let width: CGFloat = 480
    @ObservedObject var model: ExcludeListModel

    var body: some View {
        ScrollView {
            ExcludeListView(model: model)
        }
        .frame(width: Self.width)
        .frame(minHeight: 320, maxHeight: .infinity, alignment: .top)
        .background(Palette.surface)
    }
}
