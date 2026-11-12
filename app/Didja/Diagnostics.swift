import AppKit
import SwiftUI

/// Report a Problem with This Window… (SCR-42): a file that shows how Didja sees the window you
/// were last in, so an app it misreads can be fixed. Masked by default (`Redactor`): every letter
/// x, every digit 0. You choose any line to show as it is. Nothing is sent by Didja: you save the
/// file, copy it, or open an issue and attach it yourself.
struct DiagnosticsReport: Equatable {
    enum Section: String, CaseIterable {
        case about = "About"
        case outline = "The window's outline"
        case lines = "What capture keeps from it now"
        case kept = "What Didja kept from this app"
        case tasks = "Tasks from this app, and why"
        // Didja Missed This…
        case task = "The task, and what would tick it"
        case context = "How it looked where it was captured"
        case watching = "Where Didja looks for it done"
        case later = "What Didja saw since"

        static let window: [Section] = [.about, .outline, .lines, .kept, .tasks]
        static let missed: [Section] = [.task, .context, .watching, .later]
    }

    struct Line: Identifiable, Equatable {
        var id: Int
        var section: Section
        /// As read. Held in memory only; never written unless you choose to show this line.
        var raw: String
        var masked: String
        var shown = false
        var text: String { shown ? raw : masked }
        /// Lines with nothing to hide (the same either way) need no choice.
        var differs: Bool { raw != masked }
    }

    var app: String
    var lines: [Line]
    /// Which sections this report has, in order.
    var sections: [Section] = Section.window
    /// Shown in the window only (a missed task's title), never in a file name or a link.
    var heading: String?

    /// The new issue's title: the app's name for a window, nothing from the screen for a task.
    var issueTitle: String { sections == Section.missed ? "Didja missed a finished task" : "Didja misreads \(app)" }

    struct Task {
        var title: String
        var why: String
    }

    static func build(about: [(raw: String, masked: String)], outline: OutlineElement?, captured: [String],
                      kept: [String], tasks: [Task]) -> DiagnosticsReport {
        var out: [Line] = []
        func add(_ section: Section, _ raw: String, _ masked: String) {
            out.append(Line(id: out.count, section: section, raw: raw, masked: masked))
        }
        for line in about { add(.about, line.raw, line.masked) }
        if let outline {
            let raw = outline.outlineLines()
            let masked = outline.outlineLines(transform: { key, value in
                switch key {
                case "id", "dom": Redactor.identifier(value)
                case "class": value
                case "url": Redactor.url(value)
                default: Redactor.text(value)
                }
            })
            for (r, m) in zip(raw, masked) { add(.outline, r, m) }
        }
        for line in captured { add(.lines, line, Redactor.text(line)) }
        for line in kept { add(.kept, line, Redactor.text(line)) }
        for task in tasks {
            add(.tasks, task.title, Redactor.text(task.title))
            for line in task.why.split(separator: "\n") { add(.tasks, "  " + line, "  " + Redactor.text(String(line))) }
        }
        return DiagnosticsReport(app: about.first?.raw ?? "", lines: out)
    }

    /// Didja Missed This…: one task, from `didja missed <id>`.
    struct Missed: Decodable {
        struct Context: Decodable { var app: String; var window: String; var lines: [String] }
        struct Screen: Decodable, Identifiable, Equatable { var id: Int; var ts: String; var window: String; var lines: [String] }
        struct Place: Decodable, Equatable {
            var site: String; var app: String; var screens: Int; var lines: [String]; var watched: Bool
            var recent: [Screen]?
            var last: String?
            /// The word remembering it would use: the app, from the site's addresses or the conversation's name.
            var word: String?
            var screensKept: [Screen] { recent ?? [] }
        }
        var id: Int
        var title: String
        var source: String
        var status: String
        var why: String
        var context: Context?
        var watching: [String]
        var places: [Place]
        var word: String?
        var keywords: [String]?
        var conversation: String?
        var openInConversation: Int?
        var acceptsLooksDone: Bool?
    }

    static func missed(_ m: Missed) -> DiagnosticsReport {
        var out: [Line] = []
        func add(_ section: Section, _ raw: String, masked: String? = nil) {
            out.append(Line(id: out.count, section: section, raw: raw, masked: masked ?? Redactor.text(raw)))
        }
        add(.task, "Status: \(m.status)", masked: "Status: \(m.status)")
        for line in m.why.split(separator: "\n") { add(.task, String(line)) }
        if let c = m.context {
            add(.context, "\(c.app) — \(c.window)", masked: "\(c.app) — \(Redactor.text(c.window))")
            for line in c.lines { add(.context, "  " + line) }
        }
        // Where it looks is Didja's own wording around the task's words: masked like the rest.
        for line in m.watching { add(.watching, line) }
        for place in m.places {
            let head = "\(place.app) — \(place.site): \(place.screens) screens\(place.watched ? ", looked at" : ", not looked at")"
            add(.later, head, masked: "\(place.app) — \(Redactor.url("https://" + place.site).dropFirst(8)): \(place.screens) screens\(place.watched ? ", looked at" : ", not looked at")")
            for line in place.lines { add(.later, "  " + line) }
        }
        return DiagnosticsReport(app: "missed task", lines: out, sections: Section.missed, heading: m.title)
    }

    /// The file, as it would be shared.
    func text(madeAt date: Date = Date()) -> String {
        let stamp = ISO8601DateFormatter().string(from: date)
        var out = ["Didja diagnostics, made \(stamp).",
                   "Every letter is x and every digit 0, except words apps use in their own labels and any line chosen to be shown as it is (\(shownCount))."]
        for section in sections {
            let rows = lines.filter { $0.section == section }
            out.append("")
            out.append("== \(section.rawValue) ==")
            out += rows.isEmpty ? ["(nothing)"] : rows.map(\.text)
        }
        return out.joined(separator: "\n") + "\n"
    }

    var shownCount: Int { lines.filter(\.shown).count }

    /// A file name: "didja-diagnostics-whatsapp-2026-11-12.txt".
    func fileName(on date: Date = Date()) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        let slug = app.lowercased().map { $0.isLetter || $0.isNumber ? $0 : "-" }.reduce("") { $0 + String($1) }
        return "didja-diagnostics-\(slug.isEmpty ? "app" : slug)-\(f.string(from: date)).txt"
    }

    /// A new issue on GitHub, filled in except for the file, which you attach.
    static func issueURL(app: String) -> URL? { issueURL(title: "Didja misreads \(app)") }

    static func issueURL(title: String) -> URL? {
        var c = URLComponents(string: "https://github.com/didja-dev/didja/issues/new")
        c?.queryItems = [
            URLQueryItem(name: "title", value: title),
            URLQueryItem(name: "labels", value: "app support"),
            URLQueryItem(name: "body", value: """
                **What Didja got wrong** (made-up example text, please: no real names or messages)


                **The diagnostics file:** drag the file you saved here. Look through it first: it shows only what you chose to show.
                """),
        ]
        return c?.url
    }
}

/// Why no report could be made.
enum DiagnosticsRefusal: Error, Equatable {
    case noWindow
    case excluded
    case paused

    var message: String {
        switch self {
        case .noWindow: "Didja has not read a window yet. Click in the window you want to report, then choose Report a Problem again."
        case .excluded: "That window is on your exclude list, so Didja does not read it and has nothing to report."
        case .paused: "Didja is paused, so it reads nothing. Resume it, click in the window you want to report, then try again."
        }
    }
}

/// The preview: the exact file, line by line. Click a masked line to show it as it is.
final class DiagnosticsModel: ObservableObject {
    @Published var report: DiagnosticsReport
    init(_ report: DiagnosticsReport) { self.report = report }

    func toggle(_ id: Int) {
        guard report.lines.indices.contains(id), report.lines[id].differs else { return }
        report.lines[id].shown.toggle()
    }

    func maskAll() {
        for i in report.lines.indices { report.lines[i].shown = false }
    }

    func showAll() {
        for i in report.lines.indices where report.lines[i].differs { report.lines[i].shown = true }
    }
}

/// The masked lines of a file, one per row: click a line to put it in the file as it is.
struct MaskedLinesView: View {
    @ObservedObject var model: DiagnosticsModel
    /// Off in tests: an offscreen render does not draw a scroll view's content.
    var scrolls = true

    static let key = "Hidden lines show as x (letters) and 0 (digits). Click a line to put it in the file as it is; click again to hide it."

    private var list: some View {
        LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(model.report.sections, id: \.self) { section in
                Text(section.rawValue).font(.headline).padding(.top, 10).padding(.bottom, 4)
                let rows = model.report.lines.filter { $0.section == section }
                if rows.isEmpty { Text("(nothing)").foregroundStyle(.secondary) }
                ForEach(rows) { line in
                    Button { model.toggle(line.id) } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Image(systemName: line.shown ? "eye" : (line.differs ? "eye.slash" : "circle.dotted"))
                                .font(.system(size: 10)).foregroundStyle(line.shown ? Palette.accent : .secondary)
                                .frame(width: 14)
                            Text(line.text).font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(line.shown ? Color.primary : Color.secondary)
                                .lineLimit(1).truncationMode(.tail)
                            Spacer(minLength: 0)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(!line.differs)
                    .help(line.differs ? (line.shown ? "In the file as it is: click to hide" : "Hidden: click to put it in the file as it is") : "Nothing to hide")
                }
            }
        }
        .padding(.horizontal, 4)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(Self.key).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Group {
                if scrolls { ScrollView { list } } else { list.frame(maxHeight: .infinity, alignment: .top) }
            }
            .background(Palette.chip)
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
    }
}

/// Save, Copy, Open a GitHub Issue, and what is shown as is.
struct ReportButtons: View {
    @ObservedObject var model: DiagnosticsModel
    var save: (String) -> Void
    var copy: (String) -> Void
    var openIssue: () -> Void
    var shareWithClaude: ((String) -> Void)?

    var body: some View {
        HStack(spacing: 8) {
            Text(model.report.shownCount == 0 ? "Everything hidden." : "\(model.report.shownCount) in the file as is.")
                .foregroundStyle(.secondary)
            if model.report.shownCount > 0 {
                Button("Hide All") { model.maskAll() }.buttonStyle(DidjaButtonStyle.secondary)
            }
            Button("Show All") { model.showAll() }.buttonStyle(DidjaButtonStyle.secondary)
                .help("Put every line in the file as it is (read it before you share it)")
            Spacer()
            Button("Copy") { copy(model.report.text()) }.buttonStyle(DidjaButtonStyle.secondary)
            Button("Open a GitHub Issue…", action: openIssue).buttonStyle(DidjaButtonStyle.secondary)
            if let shareWithClaude {
                Button("Give to My Claude") { shareWithClaude(model.report.text()) }.buttonStyle(DidjaButtonStyle.secondary)
                    .help("Saved where `didja mcp` can read it, for your own Claude")
            }
            Button("Save…") { save(model.report.text()) }.buttonStyle(DidjaButtonStyle.primary)
        }
    }
}

struct DiagnosticsView: View {
    static let width: CGFloat = 780
    @ObservedObject var model: DiagnosticsModel
    var save: (String) -> Void = { _ in }
    var copy: (String) -> Void = { _ in }
    var openIssue: () -> Void = {}
    var shareWithClaude: ((String) -> Void)?
    /// Off in tests: an offscreen render does not draw a scroll view's content.
    var scrolls = true

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Image(systemName: "ladybug").font(.system(size: 18)).foregroundStyle(Palette.accent)
                    Text("Report a Problem: \(model.report.app)").font(.title3.weight(.semibold)).lineLimit(2)
                }
                Text("This is the whole file, as it would be shared: how Didja sees the window, what it kept from this app and the tasks it made. Didja sends nothing: you save or copy the file and decide where it goes.")
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            MaskedLinesView(model: model, scrolls: scrolls)
            ReportButtons(model: model, save: save, copy: copy, openIssue: openIssue, shareWithClaude: shareWithClaude)
        }
        .padding(20)
        .frame(width: Self.width)
        .frame(minHeight: 420, maxHeight: .infinity, alignment: .top)
        .background(Palette.surface)
    }
}
