# Didja brand kit

Everything you need to show Didja: logos, app and menu bar icons, favicons, social images and color tokens. The full visual guide (logo rules, color, type, voice, UI kit) is the **Brand guide** artboard on the [Didja Website canvas](https://claude.ai/artifact/GS5sQoJovubMgfvSCKCT9d).

## The logo

The mark is **Prompt done**: a terminal prompt `>_` where the underscore has turned into a tick. It is drawn as two round-capped ink strokes on a highlighter-yellow tile.

- **Wordmark:** lowercase **didja** in Bricolage Grotesque 800. The SVGs here are outlined, so they don't need the font installed.
- **The name in sentences:** always **Didja**. Never "DidJa", "DIDJA" or "didJa".
- **Don't:** recolor the strokes, add a gradient, shadow, sparkle or outline, stretch or rotate the mark, or put the yellow tile on a yellow background.
- **Minimum size:** 16 px. At 48 px and below, use the favicon or small-icon files, which have heavier strokes.

## Files

| Folder | What | Use it for |
|---|---|---|
| `logo/svg/` | `didja-mark`, `didja-mark-dark`, `didja-mark-square`, `didja-lockup`, `didja-lockup-on-dark`, `didja-wordmark`, `didja-wordmark-white`, `didja-glyph-black`, `didja-glyph-white` | The master files: web, docs, anything that scales |
| `logo/png/` | Marks at 64–1024 px, lockups at 480 and 1200 px wide, wordmarks at 800 px wide, glyphs at 512 px wide | Slides, chat, anywhere that won't take SVG |
| `logo/pdf/` | Mark, lockup, lockup on dark, wordmark | Print, Keynote, Figma import |
| `app-icon/` | `AppIcon.appiconset/` (drop-in for Xcode, macOS 11+ grid with an 824 px tile on a 1024 px canvas), plus source SVGs and a dark variant | The app's Dock and Finder icon |
| `menu-bar/` | `MenuBarIcon.imageset/` (vector PDF, template rendering), plus PNGs at 18 and 36 px | The menu bar status item. Black on transparent: macOS tints it for light and dark menu bars. |
| `favicon/` | `favicon.svg` (heavy strokes), `favicon.ico` (16/32/48), PNGs, `apple-touch-icon.png` (180) | didja.dev and any other web page |
| `social/` | `og-image-1200x630.png`, `avatar-800.png`, `avatar-dark-800.png` | Link previews, GitHub, X, Bluesky, Product Hunt |
| `tokens/` | `didja.css`, `didja.tokens.json`, `Brand.swift` | Colors, fonts and radii in code |
| `source/generate.py` | The script that made all of the above | Edit the colors or geometry there and rerun it. Don't hand-edit the outputs. |

`social/og-image.svg` uses live text, so it needs the three fonts installed to render. The PNG is the file to use.

## Color

| Name | Hex | Use |
|---|---|---|
| Paper | `#FAFAF7` | Backgrounds |
| Ink | `#141414` | Text, primary buttons (paper in dark mode), dark surfaces |
| Highlighter | `#FFD93D` | The logo tile, one highlight per view, tags. Never an app button fill. Only ink text goes on it. |
| Done green | `#1F7A4D` | Ticked items, and nothing else |
| Nudge amber | `#9A4A00` | "Scrolled away" labels and warnings. Never red. |
| Graphite / Pencil | `#3D3D38` / `#5B5B55` | Body text and secondary text on paper |
| Line | `#E4E3DC` | Borders and dividers |

## Buttons and tags in the app

Yellow marks things; it never means "click me". The app's styles are in `app/Didja/DidjaStyle.swift`.

| Kind | Looks like | Used for |
|---|---|---|
| Tag (not clickable) | Highlighter-soft `#FFF6CC` fill (dark `#3A3216`), no border, no hover, 12 pt semibold, 2 × 8 padding | Counts like "81 open", status chips |
| Primary button (one per view at most) | Ink fill, white text. Dark mode: paper fill, ink text | Save, Done, Mark Done |
| Secondary button | No fill, 1 pt `#8A8980` border (dark `#76756E`), ink text (dark: paper), chip fill `#F1F0EA` (dark `#2A2A27`) on hover | Expand, Pause/Resume, Cancel, labelled toolbar actions |
| Icon button | No fill or border, 28 × 28, chip fill on hover, tooltip | +, …, close |
| Text link | Ink, underlined on hover. Never blue. | "How it works" |
| Keycap | Chip fill, 1 pt border heavier at the bottom, mono text | ⌃⌥S |

Every button: chip fill on hover, 8% darker when pressed, a 2 pt ink ring (paper in dark mode) with a 2 pt gap for keyboard focus, 40% opacity when disabled, at least 28 pt tall in the panel (22 pt for the small size). Highlighter `#FFD93D` itself stays on the logo tile, the selected row's soft tint, tags and the one highlight in a view; it is never a button fill.

## Type

- **Bricolage Grotesque:** 800 for display and the wordmark, 700 for subheads. Track tightly (−3.5%) at large sizes.
- **Inter:** 400, 500 and 600 for body text and UI. In the app, use the system font (SF Pro). Inter is for the web and marketing.
- **JetBrains Mono:** 500 for eyebrows, evidence labels and code.

All three are open source (SIL OFL), so you can self-host them.

## Voice

A friend who notices, not a manager who nags. Lead with the problem, then the relief. Use plain American English, everyday names (Sarah, Mike), no emoji and no exclamation marks. Say "Looks done — confirm?", not "1 task requires attention!".
