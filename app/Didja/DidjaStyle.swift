import SwiftUI

// Buttons and tags, in one place (SCR-43). The rule: yellow marks things, it never means
// "click me". A tag is soft yellow and does nothing; a button is ink, outlined or bare,
// by how much it matters, and never yellow.

extension Palette {
    /// Primary button fill, button text, text links and the keyboard focus ring:
    /// ink in light mode, paper in dark. The app's `AccentColor` asset holds the same pair,
    /// so system toggles and default buttons never fall back to blue.
    static let ink = dynamic(light: 0x141414, dark: 0xFAFAF7)
    /// Text on an ink (or, in dark mode, paper) fill.
    static let onInk = dynamic(light: 0xFFFFFF, dark: 0x141414)
    /// A secondary button's 1 pt border: at least 3:1 against the surface and the hover fill.
    static let buttonBorder = dynamic(light: 0x8A8980, dark: 0x76756E)
}

/// The app's three kinds of button.
struct DidjaButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary, icon }
    enum Size { case regular, small }

    var kind: Kind
    var size: Size = .regular

    /// Ink fill, white text (paper fill, ink text in dark mode). At most one per view.
    static let primary = DidjaButtonStyle(kind: .primary)
    /// Outlined: a 1 pt border, no fill until hovered.
    static let secondary = DidjaButtonStyle(kind: .secondary)
    /// No fill or border, a 28 × 28 target; give it a tooltip.
    static let icon = DidjaButtonStyle(kind: .icon)

    /// How tall each button is: 28 pt in the panel, 22 pt for the small size.
    static func height(_ size: Size) -> CGFloat { size == .small ? 22 : 28 }

    func makeBody(configuration: Configuration) -> some View {
        DidjaButtonBody(configuration: configuration, kind: kind, size: size)
    }
}

private struct DidjaButtonBody: View {
    let configuration: ButtonStyleConfiguration
    let kind: DidjaButtonStyle.Kind
    let size: DidjaButtonStyle.Size
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.isFocused) private var isFocused
    @State private var hovering = false

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: 7) }

    var body: some View {
        configuration.label
            .font(size == .small ? .system(size: 12, weight: .medium) : .callout.weight(.medium))
            .foregroundStyle(kind == .primary ? Palette.onInk : kind == .icon ? Color.secondary : Palette.ink)
            .padding(.horizontal, kind == .icon ? 0 : size == .small ? 8 : 12)
            .frame(minWidth: kind == .icon ? DidjaButtonStyle.height(size) : nil,
                   minHeight: DidjaButtonStyle.height(size))
            .background(shape.fill(fill))
            .overlay(shape.fill(Color.black.opacity(configuration.isPressed ? 0.08 : 0)))
            .overlay(shape.strokeBorder(kind == .secondary ? Palette.buttonBorder : .clear, lineWidth: 1))
            // A 2 pt ring with a 2 pt gap when the keyboard is on it.
            .overlay(shape.inset(by: -4).strokeBorder(isFocused ? Palette.ink : .clear, lineWidth: 2))
            .contentShape(shape)
            .opacity(isEnabled ? 1 : 0.4)
            .onHover { hovering = $0 }
    }

    private var fill: Color {
        switch kind {
        case .primary: return Palette.ink
        case .secondary, .icon: return hovering && isEnabled ? Palette.chip : .clear
        }
    }
}

/// A text link: ink, underlined on hover, never blue.
struct DidjaLinkStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        DidjaLinkBody(configuration: configuration)
    }
}

private struct DidjaLinkBody: View {
    let configuration: ButtonStyleConfiguration
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.isFocused) private var isFocused
    @State private var hovering = false

    var body: some View {
        configuration.label
            .foregroundStyle(Palette.ink)
            .underline(hovering || isFocused)
            .opacity(isEnabled ? (configuration.isPressed ? 0.7 : 1) : 0.4)
            .contentShape(Rectangle())
            .onHover { hovering = $0 }
    }
}

/// The hover look of an icon button, for controls that cannot take a button style (the "…" menu).
struct IconHover: ViewModifier {
    @State private var hovering = false

    func body(content: Content) -> some View {
        content
            .frame(width: DidjaButtonStyle.height(.regular), height: DidjaButtonStyle.height(.regular))
            .background(RoundedRectangle(cornerRadius: 7).fill(hovering ? Palette.chip : .clear))
            .contentShape(RoundedRectangle(cornerRadius: 7))
            .onHover { hovering = $0 }
    }
}

/// A label that marks something and does nothing when clicked: soft yellow, no border, no hover.
struct TagView: View {
    let text: String

    static let fontSize: CGFloat = 12

    var body: some View {
        Text(text)
            .font(.system(size: Self.fontSize, weight: .semibold))
            .foregroundStyle(Palette.accentText)
            .lineLimit(1)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(Capsule().fill(Palette.selection))
    }
}
