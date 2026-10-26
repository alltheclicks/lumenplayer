"""Klaro Player logo kit (1d Spektar + P1) -> brand/klaro-player/kit/.

Vector masters are SVG (glass + aura use filters/blend modes: render them in a browser, not in print tools).
PNG exports are rendered in Chrome. Flat one-colour files are the print/emboss masters.
Motion is rendered separately by motion_spektar.mjs (Playwright) from the HTML drivers written here.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageOps

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import klaro_spektar as ks  # noqa: E402

KIT = ROOT / "kit"
RENDER = "/Users/filip/.claude/plugins/cache/logo-design-skill/logo-design/1.4.4/skills/logo-design/scripts/render_png.py"


def write(p, s):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(s)


def png(svg_path, out, w, h=None):
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, RENDER, str(svg_path), "-o", str(out), "--width", str(w), "--height", str(h or w),
                    "--backend", "chrome"], check=True, capture_output=True)


def down(src, out, n):
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.open(src).convert("RGBA").resize((n, n), Image.LANCZOS).save(out)


# ------------------------------------------------------------------ logo files
def symbol_file(way, size=1024):
    """K + aura (or flat K) on transparent, centred, with room for the aura."""
    h = size * .56
    if way in ("dark", "light"):
        d, b = ks.mark(h, size / 2, size / 2, way)
        return ks.svg(size, size, d, b)
    return ks.svg(size, size, "", ks.flat(size * .80, size / 2, size / 2, {"mono-white": ks.WHITE, "mono-black": ks.BLACK,
                                                                            "mono-navy": ks.NAVY}[way]))


def horizontal(way, hs=200.0):
    """Symbol + 'Klaro Player'. Aura needs ~0.3·hs of air, so spacing is generous."""
    flat = way.startswith("mono")
    ink = {"dark": ks.WHITE, "light": ks.NAVY, "mono-white": ks.WHITE, "mono-black": ks.BLACK, "mono-navy": ks.NAVY}[way]
    pad = (0.18 if flat else 0.52) * hs
    kd, bb = ks.k_path(hs, 0, 0)
    kw = bb[2] - bb[0]
    cx, cy = pad + kw / 2, pad + hs / 2
    if flat:
        d, b = "", ks.flat(hs, cx, cy, ink)
    else:
        d, b = ks.mark(hs, cx, cy, way)
    cap = 0.50 * hs
    gap = (0.30 if flat else 0.48) * hs
    nb, nw = ks.name(pad + kw + gap, cy + cap / 2, cap, ink)
    w = pad + kw + gap + nw + pad
    return ks.svg(round(w, 1), round(hs + 2 * pad, 1), d, b + nb)


def stacked(way, hs=260.0):
    flat = way.startswith("mono")
    ink = {"dark": ks.WHITE, "light": ks.NAVY, "mono-white": ks.WHITE, "mono-black": ks.BLACK, "mono-navy": ks.NAVY}[way]
    pad = (0.18 if flat else 0.52) * hs
    cap = 0.24 * hs
    _, nw = ks.name(0, 0, cap, ink)
    w = max(nw, hs) + 2 * pad
    cy = pad + hs / 2
    if flat:
        d, b = "", ks.flat(hs, w / 2, cy, ink)
    else:
        d, b = ks.mark(hs, w / 2, cy, way)
    gap = (0.26 if flat else 0.42) * hs
    nb, _ = ks.name((w - nw) / 2, pad + hs + gap + cap, cap, ink)
    return ks.svg(round(w, 1), round(pad + hs + gap + cap * 1.25 + pad, 1), d, b + nb)


def wordmark(way):
    ink = {"dark": ks.WHITE, "light": ks.NAVY, "mono-black": ks.BLACK}[way]
    cap, pad = 100.0, 35.0
    nb, nw = ks.name(pad, pad + cap, cap, ink)
    return ks.svg(round(nw + 2 * pad, 1), round(cap * 1.25 + 2 * pad, 1), "", nb)


def dims(svg_text):
    import re
    return tuple(float(v) for v in re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', svg_text).groups())


# ------------------------------------------------------------------ icons
def tv_banner(w=1280, h=720, tone="dark"):
    td, tb = ks.tile(w, h, "t", tone)
    hs = 0.34 * h
    kd, bb = ks.k_path(hs, 0, 0)
    kw = bb[2] - bb[0]
    cap = 0.42 * hs
    gap = 0.42 * hs
    ink = ks.WHITE if tone == "dark" else ks.NAVY
    _, nw = ks.name(0, 0, cap, ink)
    x0 = (w - (kw + gap + nw)) / 2
    md, mb = ks.mark(hs, x0 + kw / 2, h / 2, "dark" if tone == "dark" else "light")
    nb, _ = ks.name(x0 + kw + gap, h / 2 + cap / 2, cap, ink)
    return ks.svg(w, h, td + md, tb + mb + nb)


def macos():
    """macOS: 824 px rounded tile with a 100 px margin on a 1024 canvas, soft shadow."""
    inner = ks.icon("dark", True, rx=0)
    import re
    body = re.sub(r"^.*?<defs>", "<defs>", inner.strip(), flags=re.S).replace("</svg>", "")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><title>Klaro Player</title>'
            '<defs><clipPath id="mc"><rect x="100" y="100" width="824" height="824" rx="185"/></clipPath>'
            '<filter id="ms" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-opacity=".32"/></filter></defs>'
            '<rect x="100" y="100" width="824" height="824" rx="185" fill="#03060D" filter="url(#ms)"/>'
            f'<g clip-path="url(#mc)"><g transform="translate(100 100) scale({824 / 1024})">{body}</g></g>'
            '<rect x="100.5" y="100.5" width="823" height="823" rx="185" fill="none" stroke="#fff" stroke-opacity=".08"/></svg>\n')


def build():
    if KIT.exists():
        shutil.rmtree(KIT)
    L = KIT / "logo"
    for way in ("dark", "light", "mono-white", "mono-black", "mono-navy"):
        s = symbol_file(way)
        write(L / "symbol" / f"klaro-symbol-{way}.svg", s)
        png(L / "symbol" / f"klaro-symbol-{way}.svg", L / "symbol" / f"klaro-symbol-{way}.png", 1024)
        for kind, fn in (("horizontal", horizontal), ("stacked", stacked)):
            s = fn(way)
            p = L / kind / f"klaro-{kind}-{way}.svg"
            write(p, s)
            w, h = dims(s)
            k = 2400 / w
            png(p, p.with_suffix(".png"), 2400, round(h * k))
    for way in ("dark", "light", "mono-black"):
        s = wordmark(way)
        p = L / "wordmark" / f"klaro-wordmark-{way}.svg"
        write(p, s)
        w, h = dims(s)
        png(p, p.with_suffix(".png"), 2000, round(h * 2000 / w))

    # --- app icon masters
    A = KIT / "icons" / "app"
    for name, args in (("klaro-icon-dark", ("dark", True)), ("klaro-icon-light", ("light", True)),
                       ("klaro-icon-small-dark", ("dark", False)), ("klaro-icon-small-light", ("light", False))):
        write(A / f"{name}.svg", ks.icon(*args))
        png(A / f"{name}.svg", A / f"{name}-1024.png", 1024)

    # --- web / PWA
    Wd = KIT / "icons" / "web"
    write(Wd / "favicon.svg", ks.icon("dark", False, rx=230))
    for n in (16, 32, 48):
        down(A / "klaro-icon-small-dark-1024.png", Wd / f"favicon-{n}.png", n)
    ims = [Image.open(Wd / f"favicon-{n}.png") for n in (16, 32, 48)]
    ims[2].save(Wd / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)], append_images=ims[:2])
    down(A / "klaro-icon-dark-1024.png", Wd / "apple-touch-icon.png", 180)
    down(A / "klaro-icon-dark-1024.png", Wd / "icon-192.png", 192)
    down(A / "klaro-icon-dark-1024.png", Wd / "icon-512.png", 512)
    write(Wd / "_maskable.svg", ks.svg(1024, 1024, *(lambda t, m: (t[0] + m[0], t[1] + m[1]))(
        ks.tile(1024, 1024, "t", "dark"), ks.mark(400, 512, 512, "dark"))))          # K within the 80 % safe circle
    png(Wd / "_maskable.svg", Wd / "maskable-512.png", 512)
    (Wd / "_maskable.svg").unlink()
    write(Wd / "site.webmanifest", json.dumps({
        "name": "Klaro Player", "short_name": "Klaro", "theme_color": ks.NIGHT, "background_color": ks.NIGHT,
        "icons": [{"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"},
                  {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"},
                  {"src": "/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}]}, indent=2) + "\n")
    write(Wd / "head-snippet.html",
          '<link rel="icon" href="/favicon.ico" sizes="48x48">\n<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n'
          '<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n<link rel="manifest" href="/site.webmanifest">\n'
          f'<meta name="theme-color" content="{ks.NIGHT}">\n')

    # --- iOS / iPadOS (system masks the square)
    I = KIT / "icons" / "ios"
    I.mkdir(parents=True, exist_ok=True)
    shutil.copy(A / "klaro-icon-dark-1024.png", I / "AppIcon-1024.png")
    shutil.copy(A / "klaro-icon-dark-1024.png", I / "AppIcon-1024-dark.png")
    g = ImageOps.grayscale(Image.open(A / "klaro-icon-dark-1024.png").convert("RGB"))
    ImageOps.autocontrast(g).save(I / "AppIcon-1024-tinted.png")

    # --- Android adaptive (108 dp = 432 px @xxxhdpi; keep the mark inside the 66 dp safe circle)
    D = KIT / "icons" / "android"
    fd, fb = ks.mark(150, 216, 216, "dark")
    write(D / "_fg.svg", ks.svg(432, 432, fd, fb))
    png(D / "_fg.svg", D / "ic_launcher_foreground.png", 432)
    td, tb = ks.tile(432, 432, "t", "dark")
    write(D / "_bg.svg", ks.svg(432, 432, td, tb))
    png(D / "_bg.svg", D / "ic_launcher_background.png", 432)
    write(D / "_mono.svg", ks.svg(432, 432, "", ks.flat(170, 216, 216, ks.WHITE)))
    png(D / "_mono.svg", D / "ic_launcher_monochrome.png", 432)
    for f in D.glob("_*.svg"):
        f.unlink()
    down(A / "klaro-icon-dark-1024.png", D / "playstore-icon-512.png", 512)
    write(D / "ic_launcher.xml",
          '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
          '    <background android:drawable="@mipmap/ic_launcher_background" />\n'
          '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
          '    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />\n</adaptive-icon>\n')

    # --- TV (Android TV / Google TV / Fire TV banners; square for Samsung / LG stores)
    T = KIT / "icons" / "tv"
    for tone in ("dark", "light"):
        write(T / f"tv-banner-{tone}.svg", tv_banner(tone=tone))
        png(T / f"tv-banner-{tone}.svg", T / f"tv-banner-1280x720-{tone}.png", 1280, 720)
        img = Image.open(T / f"tv-banner-1280x720-{tone}.png").convert("RGB")
        img.resize((320, 180), Image.LANCZOS).save(T / f"tv-banner-320x180-{tone}.png")
    down(A / "klaro-icon-dark-1024.png", T / "tv-icon-512.png", 512)

    # --- desktop
    Dk = KIT / "icons" / "desktop"
    write(Dk / "macos-1024.svg", macos())
    png(Dk / "macos-1024.svg", Dk / "macos-1024.png", 1024)
    sizes = [16, 24, 32, 48, 64, 128, 256]
    src_small, src_big = Image.open(A / "klaro-icon-small-dark-1024.png"), Image.open(A / "klaro-icon-dark-1024.png")
    frames = [(src_small if n <= 64 else src_big).convert("RGBA").resize((n, n), Image.LANCZOS) for n in sizes]
    frames[-1].save(Dk / "windows.ico", sizes=[(n, n) for n in sizes], append_images=frames[:-1])
    down(A / "klaro-icon-dark-1024.png", Dk / "linux-512.png", 512)

    # --- motion drivers (live SVG + HTML used by motion_spektar.mjs)
    M = KIT / "motion"
    write(M / "klaro-live.svg", ks.icon("dark", True, live=True))
    write(M / "klaro-live-small.svg", ks.icon("dark", False, live=True))
    d, b = ks.mark(560, 512, 512, "dark", live=True)
    write(M / "klaro-live-transparent.svg", ks.svg(1024, 1024, d, b))
    print("kit ->", KIT, sum(1 for _ in KIT.rglob("*") if _.is_file()), "files")


if __name__ == "__main__":
    build()
