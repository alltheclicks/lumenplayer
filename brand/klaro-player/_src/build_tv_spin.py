"""A vs 'TV' spin — side-by-side board (klaro-tv-spin.png). Both built from klaro_sync specs via build_kit."""
import base64
import io
import re
import sys
from pathlib import Path

import cairosvg

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import build_kit as bk  # noqa: E402
import klaro_sync as ks  # noqa: E402

INK, MUTED, LINE = "#0D1729", "#5B6479", "#DDE2EC"


def inner(svg_text):
    """Body of an svg (without the root tag and title) plus its viewBox size."""
    w, h = map(float, re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', svg_text).groups())
    body = re.sub(r"^<svg[^>]*>|</svg>\s*$", "", svg_text.strip())
    return re.sub(r"<title>.*?</title>", "", body), w, h


def place(svg_text, x, y, width=None, height=None):
    body, w, h = inner(svg_text)
    s = width / w if width else height / h
    return f'<g transform="translate({x:.1f} {y:.1f}) scale({s:.5f})">{body}</g>', w * s, h * s


def raster(svg_text, px, x, y, show):
    """Render at true px, then show enlarged ×1 (honest small-size preview, nearest-neighbour look)."""
    b = io.BytesIO()
    cairosvg.svg2png(bytestring=svg_text.encode(), write_to=b, output_width=px, output_height=px)
    uri = "data:image/png;base64," + base64.b64encode(b.getvalue()).decode()
    return f'<image x="{x}" y="{y}" width="{show}" height="{show}" href="{uri}" style="image-rendering:pixelated"/>'


def label(x, y, t, size=15, fill=MUTED, weight=500):
    return f'<text x="{x}" y="{y}" font-family="Inter, Helvetica, Arial" font-size="{size}" font-weight="{weight}" fill="{fill}">{t}</text>'


def row(spec, y, name, note):
    out = [label(60, y + 8, name, 26, INK, 700), label(60, y + 36, note, 15)]
    y0 = y + 70
    g, w, _ = place(bk.symbol_file(spec, "colour", 512, 0.9), 40, y0, height=250)
    out.append(g)
    g, w, h = place(bk.lockup_horizontal(spec, "colour"), 330, y0 + 20, height=120)
    out.append(g)
    g, _, _ = place(bk.lockup_horizontal(spec, "colour", tagline=True), 330, y0 + 140, height=110)
    out.append(g)
    x = 900
    for bg_way in (("colour", bk.MIST), ("dark", bk.NAVY)):
        t = bk.tile(spec, bg_way[0], bg_way[1], 1024, 0.60)
        t = t.replace('<rect width="1024" height="1024" rx="0"', '<rect width="1024" height="1024" rx="230"')
        g, _, _ = place(t, x, y0 + 20, height=150)
        out.append(g)
        x += 170
    g, _, _ = place(bk.tv_banner(spec, True), 1240, y0 + 20, height=150)
    out.append(g)
    sx = 900
    for px in (48, 32, 16):
        out.append(raster(bk.symbol_file(spec, "colour", 256, 0.95), px, sx, y0 + 200, px))
        out.append(label(sx, y0 + 272, f"{px} px", 12))
        sx += px + 30
    out.append(raster(bk.tile(spec, "colour", bk.MIST, 1024, 0.6), 32, sx + 20, y0 + 200, 32))
    out.append(label(sx + 20, y0 + 272, "ikona 32", 12))
    return "".join(out)


def main():
    W, H = 1580, 900
    body = [f'<rect width="{W}" height="{H}" fill="#F7F8FB"/>',
            label(60, 60, "Klaro Player · A i TV spin", 34, INK, 700),
            label(60, 92, "Ista ideja (dva panela, jedna dijagonala, plavi se preliva na tamni). "
                  "TV spin: paneli su tačni 16:9 ekrani u izometriji, uglovi uži kao kod ekrana.", 16),
            row(ks.A, 130, "A · In Sync (odobreno)", "Panel skoro kvadratan (1 : 0,97), uglovi R 0,25 · komplet je u kit/"),
            f'<line x1="60" x2="{W - 60}" y1="500" y2="500" stroke="{LINE}"/>',
            row(ks.TV, 530, "TV · In Sync 16:9 (spin)",
                "Paneli 16:9, drugi ekran pomeren za pola širine, uglovi R 0,15 · komplet: python3 build_kit.py --spec tv")]
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">{"".join(body)}</svg>'
    (ROOT / "klaro-tv-spin.svg").write_text(svg)
    cairosvg.svg2png(bytestring=svg.encode(), write_to=str(ROOT / "klaro-tv-spin.png"), output_width=W * 2)
    # masters of the spin, for reference
    out = ROOT / "concepts" / "tv-spin"
    out.mkdir(parents=True, exist_ok=True)
    for way in ("colour", "dark", "mono-black"):
        (out / f"klaro-tv-symbol-{way}.svg").write_text(bk.symbol_file(ks.TV, way))
    (out / "klaro-tv-horizontal-colour.svg").write_text(bk.lockup_horizontal(ks.TV, "colour"))
    print("ok")


if __name__ == "__main__":
    main()
