"""Regenerate the Didja brand kit into <repo>/brand.

Needs rsvg-convert, ImageMagick (convert), Python fontTools, and the TTFs of Bricolage Grotesque 700/800,
Inter 400/600 and JetBrains Mono 500 in ~/.fonts (from @fontsource, converted from .woff).
Usage: python3 brand/source/generate.py .
"""
import json, os, subprocess, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen

REPO = sys.argv[1]
B = os.path.join(REPO, 'brand')
FONTS = os.path.expanduser('~/.fonts')

C = dict(paper='#FAFAF7', white='#FFFFFF', ink='#141414', ink2='#222220', graphite='#3D3D38',
         pencil='#5B5B55', line='#E4E3DC', placeholder='#F1F0EA', placeholderBorder='#C9C8BE',
         highlighter='#FFD93D', highlighterSoft='#FFF6CC', done='#1F7A4D', nudge='#9A4A00',
         # App buttons and tags (SCR-43): yellow marks things, never buttons.
         buttonBorder='#8A8980', buttonBorderDark='#76756E', tagDark='#3A3216', chipDark='#2A2A27')

CHEVRON = 'M11 19 L24 32 L11 45'
TICK = 'M30 38 L37 45 L53 27'


def w(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        f.write(text)


def png(svg, out, width, height=None):
    os.makedirs(os.path.dirname(out), exist_ok=True)
    args = ['rsvg-convert', '-w', str(width)]
    if height:
        args += ['-h', str(height)]
    subprocess.run(args + ['-o', out, svg], check=True)


def strokes(color, sw, transform=''):
    t = f' transform="{transform}"' if transform else ''
    return (f'<g{t} fill="none" stroke="{color}" stroke-width="{sw}" stroke-linecap="round" '
            f'stroke-linejoin="round"><path d="{CHEVRON}"/><path d="{TICK}"/></g>')


def svg(vb, body, w_=None, h_=None):
    size = f' width="{w_}" height="{h_}"' if w_ else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}"{size}>{body}</svg>\n'


# ---------- wordmark as outlines ----------
font = TTFont(os.path.join(FONTS, 'bricolage-grotesque-latin-800-normal.ttf'))
gs = font.getGlyphSet()
cmap = font.getBestCmap()
upem = font['head'].unitsPerEm
TRACK = -0.03 * upem


def text_path(text, size, x0, baseline):
    """Path for text at font-size `size`, origin x0, baseline y. Returns (d, advance_px)."""
    s = size / upem
    pen = SVGPathPen(gs)
    x = 0
    for i, ch in enumerate(text):
        g = cmap[ord(ch)]
        tp = TransformPen(pen, (s, 0, 0, -s, x0 + x * s, baseline))
        gs[g].draw(tp)
        x += gs[g].width + (TRACK if i < len(text) - 1 else 0)
    return pen.getCommands(), x * s


def glyph_bounds(text):
    bp = BoundsPen(gs)
    x = 0
    for i, ch in enumerate(text):
        g = cmap[ord(ch)]
        gs[g].draw(TransformPen(bp, (1, 0, 0, 1, x, 0)))
        x += gs[g].width + (TRACK if i < len(text) - 1 else 0)
    return bp.bounds  # xmin, ymin, xmax, ymax in font units (y up)


WORD = 'didja'
xmin, ymin, xmax, ymax = glyph_bounds(WORD)
d_bounds = glyph_bounds('d')  # ascender top of "d"


def wordmark_svg(color):
    size = 100
    s = size / upem
    pad = 0
    d, adv = text_path(WORD, size, -xmin * s, ymax * s)
    W = (xmax - xmin) * s
    H = (ymax - ymin) * s
    return svg(f'0 0 {W:.2f} {H:.2f}', f'<path fill="{color}" d="{d}"/>'), W, H


def lockup_svg(word_color, tile=C['highlighter'], mark=C['ink']):
    T = 64.0
    gap = 16.0
    # size the wordmark so the "d" ascender is 72% of the tile height, centred on it
    d_h = d_bounds[3]  # baseline to top of "d" in font units
    size = (0.72 * T) / (d_h / upem)
    s = size / upem
    baseline = T / 2 + (d_h * s) / 2
    x0 = T + gap - xmin * s
    d, adv = text_path(WORD, size, x0, baseline)
    W = T + gap + (xmax - xmin) * s
    bottom = max(T, baseline - ymin * s)
    body = (f'<rect width="{T}" height="{T}" rx="14" fill="{tile}"/>' + strokes(mark, 6.3) +
            f'<path fill="{word_color}" d="{d}"/>')
    return svg(f'0 0 {W:.2f} {bottom:.2f}', body), W, bottom


# ---------- logo SVGs ----------
L = os.path.join(B, 'logo')
marks = {
    'didja-mark': svg('0 0 64 64', f'<rect width="64" height="64" rx="14" fill="{C["highlighter"]}"/>' + strokes(C['ink'], 6.3)),
    'didja-mark-dark': svg('0 0 64 64', f'<rect width="64" height="64" rx="14" fill="{C["ink"]}"/>' + strokes(C['highlighter'], 6.3)),
    'didja-mark-square': svg('0 0 64 64', f'<rect width="64" height="64" fill="{C["highlighter"]}"/>' + strokes(C['ink'], 6.3, 'translate(6.4 6.4) scale(0.8)')),
    'didja-glyph-black': svg('4 10 56 44', strokes(C['ink'], 6.3)),
    'didja-glyph-white': svg('4 10 56 44', strokes('#FFFFFF', 6.3)),
}
for name, s_ in marks.items():
    w(f'{L}/svg/{name}.svg', s_)

for name, col in [('didja-wordmark', C['ink']), ('didja-wordmark-white', '#FFFFFF')]:
    s_, W, H = wordmark_svg(col)
    w(f'{L}/svg/{name}.svg', s_)
    png(f'{L}/svg/{name}.svg', f'{L}/png/{name}-800w.png', 800)

for name, col in [('didja-lockup', C['ink']), ('didja-lockup-on-dark', C['paper'])]:
    s_, W, H = lockup_svg(col)
    w(f'{L}/svg/{name}.svg', s_)
    for width in (480, 1200):
        png(f'{L}/svg/{name}.svg', f'{L}/png/{name}-{width}w.png', width)

for name in ('didja-mark', 'didja-mark-dark'):
    for px in (64, 128, 256, 512, 1024):
        png(f'{L}/svg/{name}.svg', f'{L}/png/{name}-{px}.png', px)
for name in ('didja-glyph-black', 'didja-glyph-white'):
    png(f'{L}/svg/{name}.svg', f'{L}/png/{name}-512w.png', 512)

# PDFs of the vector logos (print / decks)
for name in ('didja-mark', 'didja-lockup', 'didja-lockup-on-dark', 'didja-wordmark'):
    subprocess.run(['rsvg-convert', '-f', 'pdf', '-o', f'{L}/pdf/{name}.pdf', f'{L}/svg/{name}.svg'], check=True) if os.makedirs(f'{L}/pdf', exist_ok=True) is None else None

# ---------- favicon ----------
F = os.path.join(B, 'favicon')
fav = svg('0 0 64 64', f'<rect width="64" height="64" rx="14" fill="{C["highlighter"]}"/>' + strokes(C['ink'], 8))
w(f'{F}/favicon.svg', fav)
for px in (16, 32, 48):
    png(f'{F}/favicon.svg', f'{F}/favicon-{px}.png', px)
subprocess.run(['convert', f'{F}/favicon-16.png', f'{F}/favicon-32.png', f'{F}/favicon-48.png', f'{F}/favicon.ico'], check=True)
apple = svg('0 0 64 64', f'<rect width="64" height="64" fill="{C["highlighter"]}"/>' + strokes(C['ink'], 6.3, 'translate(9.6 9.6) scale(0.7)'))
w(f'{F}/apple-touch-icon.svg', apple)
png(f'{F}/apple-touch-icon.svg', f'{F}/apple-touch-icon.png', 180)

# ---------- macOS app icon (Big Sur grid: 824 tile on 1024 canvas) ----------
A = os.path.join(B, 'app-icon')


def app_icon_svg(sw, tile=C['highlighter'], mark=C['ink']):
    k = 824 / 64
    body = ('<defs><filter id="s" x="-10%" y="-10%" width="120%" height="125%">'
            '<feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity="0.22"/></filter></defs>'
            f'<rect x="100" y="100" width="824" height="824" rx="185" fill="{tile}" filter="url(#s)"/>'
            + strokes(mark, sw, f'translate(100 100) scale({k:.4f})'))
    return svg('0 0 1024 1024', body)


w(f'{A}/didja-app-icon.svg', app_icon_svg(6.3))
w(f'{A}/didja-app-icon-small.svg', app_icon_svg(8))
w(f'{A}/didja-app-icon-dark.svg', app_icon_svg(6.3, C['ink'], C['highlighter']))
iconset = f'{A}/AppIcon.appiconset'
for px in (16, 32, 64, 128, 256, 512, 1024):
    src = f'{A}/didja-app-icon-small.svg' if px <= 64 else f'{A}/didja-app-icon.svg'
    png(src, f'{iconset}/icon_{px}.png', px)
images = []
for pt, files in [(16, ('icon_16.png', 'icon_32.png')), (32, ('icon_32.png', 'icon_64.png')),
                  (128, ('icon_128.png', 'icon_256.png')), (256, ('icon_256.png', 'icon_512.png')),
                  (512, ('icon_512.png', 'icon_1024.png'))]:
    for scale, fn in zip(('1x', '2x'), files):
        images.append({'idiom': 'mac', 'size': f'{pt}x{pt}', 'scale': scale, 'filename': fn})
w(f'{iconset}/Contents.json', json.dumps({'images': images, 'info': {'author': 'xcode', 'version': 1}}, indent=2) + '\n')
png(f'{A}/didja-app-icon-dark.svg', f'{A}/didja-app-icon-dark-1024.png', 1024)

# ---------- menu bar template icon ----------
M = os.path.join(B, 'menu-bar')
mb = svg('4 4 56 56', strokes('#000000', 8))
w(f'{M}/didja-menubar-template.svg', mb)
mbset = f'{M}/MenuBarIcon.imageset'
os.makedirs(mbset, exist_ok=True)
subprocess.run(['rsvg-convert', '-f', 'pdf', '-w', '18', '-h', '18', '-o', f'{mbset}/didja-menubar.pdf', f'{M}/didja-menubar-template.svg'], check=True)
png(f'{M}/didja-menubar-template.svg', f'{M}/didja-menubar-18.png', 18)
png(f'{M}/didja-menubar-template.svg', f'{M}/didja-menubar-36.png', 36)
w(f'{mbset}/Contents.json', json.dumps({
    'images': [{'idiom': 'mac', 'filename': 'didja-menubar.pdf'}],
    'info': {'author': 'xcode', 'version': 1},
    'properties': {'template-rendering-intent': 'template', 'preserves-vector-representation': True}}, indent=2) + '\n')

# ---------- social ----------
S = os.path.join(B, 'social')
head_font = TTFont(os.path.join(FONTS, 'bricolage-grotesque-latin-800-normal.ttf'))
hcm, hgs, hupem = head_font.getBestCmap(), head_font.getGlyphSet(), head_font['head'].unitsPerEm


def measure(text, size, track=-0.035):
    x = 0
    for i, ch in enumerate(text):
        x += hgs[hcm[ord(ch)]].width + (track * hupem if i < len(text) - 1 else 0)
    return x * size / hupem


lock, LW, LH = lockup_svg(C['ink'])
lock_inner = lock.split('>', 1)[1].rsplit('</svg>', 1)[0]
hs = 76
l1, l2 = 'Ten tabs, four Claude sessions,', 'one forgotten step.'
w2 = measure(l2, hs)
og = svg('0 0 1200 630', f'''<rect width="1200" height="630" fill="{C['paper']}"/>
<g transform="translate(72 64) scale(0.9)">{lock_inner}</g>
<g font-family="Bricolage Grotesque" font-weight="800" font-size="{hs}" letter-spacing="-2.6" fill="{C['ink']}">
<text x="72" y="300">{l1}</text>
<rect x="64" y="{330}" width="{w2 + 18:.0f}" height="96" rx="14" fill="{C['highlighter']}"/>
<text x="72" y="402">{l2}</text>
</g>
<text x="72" y="560" font-family="JetBrains Mono" font-weight="500" font-size="28" fill="{C['ink']}">didja.dev</text>
<text x="1128" y="560" text-anchor="end" font-family="Inter" font-size="24" fill="{C['pencil']}">Free · open source · runs on your Mac</text>''', 1200, 630)
w(f'{S}/og-image.svg', og)
png(f'{S}/og-image.svg', f'{S}/og-image-1200x630.png', 1200, 630)
for name, tile, mk in [('avatar', C['highlighter'], C['ink']), ('avatar-dark', C['ink'], C['highlighter'])]:
    s_ = svg('0 0 64 64', f'<rect width="64" height="64" fill="{tile}"/>' + strokes(mk, 6.3, 'translate(9.6 9.6) scale(0.7)'))
    w(f'{S}/{name}.svg', s_)
    png(f'{S}/{name}.svg', f'{S}/{name}-800.png', 800)

# ---------- tokens ----------
T = os.path.join(B, 'tokens')
names = dict(paper='paper', white='white', ink='ink', ink2='ink-2', graphite='graphite', pencil='pencil', line='line',
             placeholder='placeholder-bg', placeholderBorder='placeholder-border', highlighter='highlighter',
             highlighterSoft='highlighter-soft', done='done', nudge='nudge',
             buttonBorder='button-border', buttonBorderDark='button-border-dark', tagDark='tag-dark', chipDark='chip-dark')
css = ':root {\n' + ''.join(f'  --{names[k]}: {v};\n' for k, v in C.items()) + '''
  --font-display: "Bricolage Grotesque", system-ui, sans-serif;
  --font-body: "Inter", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  --radius-pill: 999px;
  --radius-card: 18px;
  --radius-tile: 22%;
  --radius-cta: 28px;
}
'''
w(f'{T}/didja.css', css)
w(f'{T}/didja.tokens.json', json.dumps({
    'color': {names[k]: {'$value': v, '$type': 'color'} for k, v in C.items()},
    'font': {'display': {'$value': 'Bricolage Grotesque', 'weights': [700, 800]},
             'body': {'$value': 'Inter', 'weights': [400, 500, 600]},
             'mono': {'$value': 'JetBrains Mono', 'weights': [500]}},
    'radius': {'pill': '999px', 'card': '18px', 'cta': '28px', 'tile': '22%'}}, indent=2) + '\n')


def swift_color(hexs):
    r, g, b = (int(hexs[i:i + 2], 16) / 255 for i in (1, 3, 5))
    return f'Color(red: {r:.3f}, green: {g:.3f}, blue: {b:.3f})'


swift = '''// Didja brand colors. Generated from brand/tokens; keep in sync with didja.tokens.json.
import SwiftUI

enum Brand {
''' + ''.join(f'    static let {k} = {swift_color(v)}  // {v}\n' for k, v in C.items()) + '''}
'''
w(f'{T}/Brand.swift', swift)
print('done')
