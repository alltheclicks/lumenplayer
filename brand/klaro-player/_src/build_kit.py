"""Klaro Player logo kit — every delivery file generated from klaro_sync.Spec (true arcs, outlined type).

  python3 build_kit.py            -> kit/      (direction A, approved 30 Sep 2026)
  python3 build_kit.py --spec tv  -> kit-tv/   (the 16:9 'TV' spin, if it replaces A)

Layout units: Hs = symbol height, x = one panel's projected width (clear-space unit).
"""
import argparse
import io
import json
import shutil
import sys
from pathlib import Path

import cairosvg
from PIL import Image

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import klaro_sync as ks  # noqa: E402
from typekit import text  # noqa: E402

NAVY, BLUE, MIST, WHITE, BLACK = "#0D1729", "#0669FE", "#F3F5F9", "#FFFFFF", "#000000"
FONT = "InterTight"
TAGLINE = "ONE SETUP. EVERY SCREEN."
TITLE = "Klaro Player"

# colourways: (navy part, blue part, type) — mono ways use the split geometry
WAYS = {
    "colour": (NAVY, BLUE, NAVY, False),
    "dark": (WHITE, BLUE, WHITE, False),        # for Navy / dark backgrounds
    "mono-black": (BLACK, BLACK, BLACK, True),
    "mono-white": (WHITE, WHITE, WHITE, True),
    "mono-navy": (NAVY, NAVY, NAVY, True),
    "mono-blue": (BLUE, BLUE, BLUE, True),
}


# ------------------------------------------------------------------ svg helpers
def svg(inner, w, h, bg=None, rx=0, title=TITLE, extra=""):
    back = f'<rect width="{w:g}" height="{h:g}" rx="{rx:g}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w:g}" height="{h:g}" viewBox="0 0 {w:g} {h:g}">'
            f"<title>{title}</title>{extra}{back}{inner}</svg>\n")


def symbol(spec, way, cx, cy, size, by="max", cls=False):
    """Paths of the symbol placed with centre (cx, cy); returns (svg, (w, h), k)."""
    nav, blu, _, split = WAYS[way]
    fac, k, wh = ks.fit(spec, size, cx, cy, by=by)
    nd, bd = ks.mark_d(spec, fac, split=split)
    c = ' class="n"' if cls else ""
    if nav == blu:
        return f'<path fill="{nav}" d="{nd} {bd}"/>', wh, k
    return f'<path{c} fill="{nav}" d="{nd}"/><path fill="{blu}" d="{bd}"/>', wh, k


def name_paths(x, base, cap, ink):
    """'Klaro' Bold + 'Player' Regular as outlines; returns (svg, width)."""
    d1, w1 = text("Klaro", FONT, cap=cap, x=x, base=base, tracking=-0.02 * cap, wght=700)
    sp = 0.30 * cap
    d2, w2 = text("Player", FONT, cap=cap, x=x + w1 + sp, base=base, tracking=-0.012 * cap, wght=400)
    return f'<path fill="{ink}" d="{d1} {d2}"/>', w1 + sp + w2


def tagline_paths(x, base, cap, ink, width):
    """Tagline tracked so it spans exactly `width`."""
    _, w0 = text(TAGLINE, FONT, cap=cap, x=0, base=0, wght=500)
    tr = (width - w0) / (len(TAGLINE) - 1)
    d, w = text(TAGLINE, FONT, cap=cap, x=x, base=base, tracking=tr, wght=500)
    return f'<path fill="{ink}" d="{d}"/>', w


# ------------------------------------------------------------------ lockups
HS = 200.0                                         # master symbol height in lockups


def unit_x(spec, k):
    return spec.W * k


def lockup_horizontal(spec, way, tagline=False):
    ink = WAYS[way][2]
    _, (sw, _), k = symbol(spec, way, 0, 0, HS, by="h")
    x = unit_x(spec, k)
    pad = 0.5 * x
    cap = 0.49 * HS if not tagline else 0.40 * HS
    gap = 0.40 * x if not tagline else 0.45 * x
    sx0 = pad
    cx, cy = sx0 + sw / 2, pad + HS / 2
    sym, _, _ = symbol(spec, way, cx, cy, HS, by="h")
    tx = sx0 + sw + gap
    if not tagline:
        nm, nw = name_paths(tx, cy + cap / 2, cap, ink)
        body = sym + nm
    else:
        top = pad
        nm, nw = name_paths(tx, top + 0.60 * HS, cap, ink)
        tg, _ = tagline_paths(tx + 0.01 * HS, top + 0.93 * HS, 0.075 * HS, ink, nw - 0.02 * HS)
        body = sym + nm + tg
    w, h = tx + nw + pad, HS + 2 * pad
    return svg(body, round(w, 1), round(h, 1))


def lockup_stacked(spec, way):
    ink = WAYS[way][2]
    _, (sw, _), k = symbol(spec, way, 0, 0, HS, by="h")
    x = unit_x(spec, k)
    pad, cap, gap = 0.5 * x, 0.30 * HS, 0.30 * HS
    _, nw = name_paths(0, 0, cap, ink)
    w = max(sw, nw) + 2 * pad
    sym, _, _ = symbol(spec, way, w / 2, pad + HS / 2, HS, by="h")
    nm, _ = name_paths((w - nw) / 2, pad + HS + gap + cap, cap, ink)
    return svg(sym + nm, round(w, 1), round(pad + HS + gap + cap + pad, 1))


def wordmark(spec, way):
    ink = WAYS[way][2]
    cap = 100.0
    pad = 0.35 * cap
    nm, nw = name_paths(pad, pad + cap, cap, ink)
    return svg(nm, round(nw + 2 * pad, 1), round(cap * 1.25 + 2 * pad, 1))   # room for the descender of 'y'


def symbol_file(spec, way, size=512, fill=0.80):
    s, _, _ = symbol(spec, way, size / 2, size / 2, size * fill)
    return svg(s, size, size)


# ------------------------------------------------------------------ icons
def tile(spec, way, bg, size=1024, fill=0.56, rx=0, by="max"):
    s, _, _ = symbol(spec, way, size / 2, size / 2, size * fill, by=by)
    return svg(s, size, size, bg=bg, rx=rx)


def favicon_svg(spec):
    """Tab icon: tight, colour; swaps navy -> white when the browser UI is dark."""
    s, _, _ = symbol(spec, "colour", 128, 128, 244, cls=True)
    style = "<style>@media (prefers-color-scheme: dark){.n{fill:#FFFFFF}}</style>"
    return svg(s, 256, 256, extra=style)


def tv_banner(spec, dark=True, w=1280, h=720):
    """16:9 launcher banner (Android TV / Google TV / Fire TV): lockup centred on a solid field."""
    way = "dark" if dark else "colour"
    ink = WAYS[way][2]
    hs = 0.30 * h
    _, (sw, _), k = symbol(spec, way, 0, 0, hs, by="h")
    cap, gap = 0.49 * hs, 0.40 * spec.W * k
    _, nw = name_paths(0, 0, cap, ink)
    x0 = (w - (sw + gap + nw)) / 2
    sym, _, _ = symbol(spec, way, x0 + sw / 2, h / 2, hs, by="h")
    nm, _ = name_paths(x0 + sw + gap, h / 2 + cap / 2, cap, ink)
    return svg(sym + nm, w, h, bg=NAVY if dark else MIST)


# ------------------------------------------------------------------ writers
def png(svg_text, out, width=None, height=None):
    out.parent.mkdir(parents=True, exist_ok=True)
    cairosvg.svg2png(bytestring=svg_text.encode(), write_to=str(out), output_width=width, output_height=height)


def write(p, s):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(s)


def build(spec, out):
    if out.exists():
        shutil.rmtree(out)
    L = out / "logo"
    for way in WAYS:
        write(L / "symbol" / f"klaro-symbol-{way}.svg", symbol_file(spec, way))
        png(symbol_file(spec, way), L / "symbol" / f"klaro-symbol-{way}.png", 1024)
        for kind, fn in (("horizontal", lambda w: lockup_horizontal(spec, w)),
                         ("horizontal-tagline", lambda w: lockup_horizontal(spec, w, tagline=True)),
                         ("stacked", lambda w: lockup_stacked(spec, w)),
                         ("wordmark", lambda w: wordmark(spec, w))):
            if way == "mono-blue" and kind != "horizontal":
                continue
            s = fn(way)
            write(L / kind / f"klaro-{kind}-{way}.svg", s)
            png(s, L / kind / f"klaro-{kind}-{way}.png", width=2400)

    # --- web / PWA
    Wd = out / "icons" / "web"
    write(Wd / "favicon.svg", favicon_svg(spec))
    small = symbol_file(spec, "colour", 256, 0.95)
    for n in (16, 32, 48):
        png(small, Wd / f"favicon-{n}.png", n)
    ims = [Image.open(Wd / f"favicon-{n}.png") for n in (16, 32, 48)]
    ims[2].save(Wd / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)], append_images=ims[:2])
    png(tile(spec, "colour", MIST, 1024, 0.60), Wd / "apple-touch-icon.png", 180)
    png(tile(spec, "colour", MIST, 1024, 0.60), Wd / "icon-192.png", 192)
    png(tile(spec, "colour", MIST, 1024, 0.60), Wd / "icon-512.png", 512)
    png(tile(spec, "colour", MIST, 1024, 0.50), Wd / "maskable-512.png", 512)   # inside the 80 % safe circle
    write(Wd / "site.webmanifest", json.dumps({
        "name": "Klaro Player", "short_name": "Klaro", "theme_color": NAVY, "background_color": NAVY,
        "icons": [{"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"},
                  {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"},
                  {"src": "/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}]},
        indent=2) + "\n")
    write(Wd / "head-snippet.html",
          '<link rel="icon" href="/favicon.ico" sizes="48x48">\n'
          '<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n'
          '<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n'
          '<link rel="manifest" href="/site.webmanifest">\n'
          f'<meta name="theme-color" content="{NAVY}">\n')

    # --- iOS / iPadOS / tvOS-style square masters (system applies the mask)
    I = out / "icons" / "ios"
    png(tile(spec, "colour", MIST, 1024, 0.60), I / "AppIcon-1024-light.png")
    png(tile(spec, "dark", NAVY, 1024, 0.60), I / "AppIcon-1024-dark.png")
    png(tile(spec, "mono-white", BLACK, 1024, 0.60), I / "AppIcon-1024-tinted.png")
    write(I / "AppIcon-light.svg", tile(spec, "colour", MIST, 1024, 0.60))
    write(I / "AppIcon-dark.svg", tile(spec, "dark", NAVY, 1024, 0.60))

    # --- Android adaptive icon (108 dp canvas = 432 px @xxxhdpi, 66 dp safe circle)
    A = out / "icons" / "android"
    fg = svg(symbol(spec, "colour", 216, 216, 196)[0], 432, 432)
    mono = svg(symbol(spec, "mono-white", 216, 216, 196)[0], 432, 432)
    write(A / "ic_launcher_foreground.svg", fg)
    png(fg, A / "ic_launcher_foreground.png")
    png(svg("", 432, 432, bg=MIST), A / "ic_launcher_background.png")
    png(mono, A / "ic_launcher_monochrome.png")
    png(tile(spec, "colour", MIST, 1024, 0.60), A / "playstore-icon-512.png", 512)
    write(A / "ic_launcher.xml",
          '<?xml version="1.0" encoding="utf-8"?>\n'
          '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
          '    <background android:drawable="@color/klaro_mist" />\n'
          '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
          '    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />\n'
          '</adaptive-icon>\n'
          f'<!-- colors.xml: <color name="klaro_mist">{MIST}</color> -->\n')

    # --- TV (Android TV / Google TV / Fire TV banners; square for Samsung Tizen / LG webOS stores)
    T = out / "icons" / "tv"
    for dark in (True, False):
        tag = "dark" if dark else "light"
        write(T / f"tv-banner-{tag}.svg", tv_banner(spec, dark))
        png(tv_banner(spec, dark), T / f"tv-banner-1280x720-{tag}.png")
        png(tv_banner(spec, dark), T / f"tv-banner-320x180-{tag}.png", 320)
    png(tile(spec, "dark", NAVY, 1024, 0.58), T / "tv-icon-512-dark.png", 512)
    png(tile(spec, "colour", MIST, 1024, 0.58), T / "tv-icon-512-light.png", 512)

    # --- desktop (macOS rounded tile with standard 100 px margin; Windows/Linux glyph on transparent)
    D = out / "icons" / "desktop"
    mac = svg(f'<rect x="100" y="100" width="824" height="824" rx="185" fill="{MIST}"/>'
              + symbol(spec, "colour", 512, 512, 480)[0], 1024, 1024)
    write(D / "macos-1024.svg", mac)
    png(mac, D / "macos-1024.png")
    sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = []
    for n in sizes:
        buf = io.BytesIO()
        cairosvg.svg2png(bytestring=symbol_file(spec, "colour", 256, 0.94).encode(), write_to=buf,
                         output_width=n, output_height=n)
        frames.append(Image.open(io.BytesIO(buf.getvalue())))
    frames[-1].save(D / "windows.ico", sizes=[(n, n) for n in sizes], append_images=frames[:-1])
    png(symbol_file(spec, "colour", 512, 0.9), D / "linux-512.png", 512)
    print("kit ->", out, sum(1 for _ in out.rglob("*") if _.is_file()), "files")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", default="a", choices=["a", "tv"])
    a = ap.parse_args()
    build(ks.A if a.spec == "a" else ks.TV, ROOT / ("kit" if a.spec == "a" else "kit-tv"))
