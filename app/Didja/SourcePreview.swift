import SwiftUI

/// How a task looked where it was captured (SCR-31): the lines around it, kept with the task
/// while it is open. Read from the engine (`didja context <id>`).
struct TaskContext: Decodable, Equatable {
    struct Line: Decodable, Equatable {
        var text: String
        /// The task's own line.
        var task: Bool
    }

    var app: String
    var window: String
    var url: String?
    var lines: [Line]
    var capturedAt: String

    /// What the small title bar says: the app and window, or the site for a browser page.
    var title: String {
        if let url, let host = URL(string: url)?.host { return "\(app) — \(host)" }
        return window.isEmpty || window == app ? app : "\(app) — \(window)"
    }
}

/// The lines as a small window: a title bar naming where it was, then the text as it was
/// there, the task's own line highlighted. Text only, never a picture of the screen.
struct SourcePreview: View {
    let context: TaskContext

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 5) {
                ForEach(0..<3) { _ in Circle().fill(Color.secondary.opacity(0.35)).frame(width: 7, height: 7) }
                Text(context.title).font(.caption2.weight(.medium)).foregroundStyle(.secondary).lineLimit(1)
                    .padding(.leading, 4)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            Divider()
            VStack(alignment: .leading, spacing: 3) {
                ForEach(Array(context.lines.enumerated()), id: \.offset) { _, line in
                    Text(line.text)
                        .font(.caption)
                        .foregroundStyle(line.task ? Color.primary : Color.secondary)
                        .fontWeight(line.task ? .semibold : .regular)
                        .padding(.horizontal, line.task ? 4 : 0)
                        .padding(.vertical, line.task ? 1 : 0)
                        .background(RoundedRectangle(cornerRadius: 4).fill(line.task ? Palette.selection : .clear))
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                }
            }
            .padding(8)
        }
        .background(RoundedRectangle(cornerRadius: 8).fill(Palette.surface))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("How it looked in \(context.title)")
    }
}
