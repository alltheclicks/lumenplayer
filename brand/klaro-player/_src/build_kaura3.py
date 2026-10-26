"""1d 'Spektar' development: living spectrum halo + four PLAYER treatments, plus 1c with PLAYER.

Outputs: concepts/kaura3/*.svg (static 1024 masters) and 1d-live.svg (SMIL animation),
         _internal/kaura3-png/*, klaro-spektar-live.mp4/.gif, klaro-spektar.html/.png (board).
"""
import math
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from build_kaura import RENDER, S, blur, geom, glass_k  # noqa: E402
from build_kaura2 import B, C, G, M, R, Y, tile  # noqa: E402
from typekit import text  # noqa: E402

OUT = ROOT / "concepts" / "kaura3"
PNG = ROOT / "_internal" / "kaura3-png"
FR = ROOT / "_internal" / "kaura3-frames"
for d in (OUT, PNG):
    d.mkdir(parents=True, exist_ok=True)

HUES = [R, Y, G, C, B, M]          # spectrum order, 60° apart, starting at the left (stem)
RAD, SW, SD = 66, 16, 30           # orbit radius, dilation, blur (at letter size 520)


# ------------------------------------------------------------------ PLAYER treatments
def _w(txt, **kw):
    return text(txt, "InterTight", x=0, base=0, **kw)[1]


def player(style, light, base=838):
    ink = "#0D1729" if light else "#FFFFFF"
    if style == "caps":                                          # P1 tracked caps, SemiBold
        kw = dict(cap=58, tracking=58 * .42, wght=620)
        d, _ = text("PLAYER", "InterTight", x=(S - _w("PLAYER", **kw)) / 2, base=base, **kw)
        return "", f'<path fill="{ink}" fill-opacity=".94" d="{d}"/>'
    if style == "word":                                          # P2 mixed case, larger, tight: most legible small
        kw = dict(cap=84, tracking=-1.5, wght=560)
        d, _ = text("Player", "InterTight", x=(S - _w("Player", **kw)) / 2, base=base + 18, **kw)
        return "", f'<path fill="{ink}" fill-opacity=".94" d="{d}"/>'
    if style == "spectrum":                                      # P3 caps picking up the halo's spectrum
        kw = dict(cap=60, tracking=60 * .40, wght=680)
        w = _w("PLAYER", **kw)
        x0 = (S - w) / 2
        d, _ = text("PLAYER", "InterTight", x=x0, base=base, **kw)
        stops = "".join(f'<stop offset="{i / 5:.2f}" stop-color="{c}"/>' for i, c in enumerate([R, Y, G, C, B, M]))
        defs = (f'<linearGradient id="ptx" x1="{x0}" y1="0" x2="{x0 + w}" y2="0" gradientUnits="userSpaceOnUse">{stops}</linearGradient>'
                + blur("ptg", 10))
        glow = "" if light else f'<path fill="url(#ptx)" opacity=".7" filter="url(#ptg)" d="{d}"/>'
        top = "" if light else f'<path fill="#fff" fill-opacity=".55" d="{d}"/>'
        return defs, f'{glow}<path fill="url(#ptx)" d="{d}"/>{top}'
    if style == "pill":                                          # P4 frosted glass capsule
        kw = dict(cap=46, tracking=46 * .36, wght=650)
        w = _w("PLAYER", **kw)
        pw, ph = w + 110, 104
        px, py = (S - pw) / 2, base - 46 / 2 - ph / 2 - 6
        d, _ = text("PLAYER", "InterTight", x=(S - w) / 2, base=py + ph / 2 + 46 / 2, **kw)
        fill, stroke = (("#0D1729", ".06"), ("#0D1729", ".16")) if light else (("#FFFFFF", ".12"), ("#FFFFFF", ".38"))
        return "", (f'<rect x="{px:.1f}" y="{py:.1f}" width="{pw:.1f}" height="{ph}" rx="{ph / 2}" fill="{fill[0]}" '
                    f'fill-opacity="{fill[1]}" stroke="{stroke[0]}" stroke-opacity="{stroke[1]}" stroke-width="3"/>'
                    f'<path fill="{ink}" d="{d}"/>')
    return "", ""


# ------------------------------------------------------------------ the icon
def halo_layers(kd, k, phase, mode, op, live=False, spectrum=True, offs=None, sw=SW, sd=SD):
    """Coloured, dilated copies of the K orbiting its centre; `phase` rotates the spectrum (degrees)."""
    parts = []
    if spectrum:
        for i, c in enumerate(HUES):
            a = math.radians(180 + i * 60 + phase)
            dx, dy = RAD * k * math.cos(a), RAD * k * math.sin(a)
            anim = ""
            if live:                                             # orbit: 12 points on the circle, 8 s per turn
                pts = ";".join(f"{RAD * k * math.cos(a + j * math.pi / 6):.1f} {RAD * k * math.sin(a + j * math.pi / 6):.1f}"
                               for j in range(13))
                anim = f'<animateTransform attributeName="transform" type="translate" values="{pts}" dur="8s" repeatCount="indefinite"/>'
            parts.append(f'<path d="{kd}" fill="{c}" stroke="{c}" stroke-width="{sw * k:.0f}" '
                         f'transform="translate({dx:.1f} {dy:.1f})">{anim}</path>')
    else:
        parts = [f'<path d="{kd}" fill="{c}" stroke="{c}" stroke-width="{sw * k:.0f}" transform="translate({dx * k:.1f} {dy * k:.1f})"/>'
                 for c, dx, dy in offs]
    aura = "".join(parts)
    breathe = ('<animate attributeName="opacity" values="{a};{b};{a}" dur="4s" repeatCount="indefinite"/>' if live else "")
    return aura, (f'<g style="mix-blend-mode:{mode}" opacity="{op * .5}" filter="url(#wide)">{aura}'
                  f'{breathe.format(a=op * .4, b=op * .62)}</g>'
                  f'<g style="mix-blend-mode:{mode}" opacity="{op}" filter="url(#aura)">{aura}</g>'), blur("aura", sd * k) + blur("wide", sd * k * 2.4)


def icon(style=None, light=False, phase=0.0, live=False, base="1d"):
    has_text = style is not None
    kd, bb = geom(430, 430) if has_text else geom(520, 512)
    k = 430 / 520 if has_text else 1.0
    mode, op = ("normal", .75) if light else ("screen", 1.0)
    if base == "1d":
        aura, layers, bdefs = halo_layers(kd, k, phase, mode, op, live)
    else:                                                        # 1c: wide ambient R / G / B
        aura, layers, bdefs = halo_layers(kd, k, 0, mode, op, spectrum=False,
                                          offs=[(R, -70, 10), (G, 60, -60), (B, 60, 70)], sw=80, sd=90)
    gdefs, gbody = glass_k(kd, bb, light, aura, 0 if base == "1d" else .08, frost=(".99", ".96"))
    tdefs, tbody = player(style, light)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}" viewBox="0 0 {S} {S}">'
            f'<defs>{tile(light)}{bdefs}{gdefs}{tdefs}</defs><rect width="{S}" height="{S}" fill="url(#tile)"/>'
            f'{layers}{gbody}{tbody}</svg>\n')


V = [
    ("1d", None, "1d Spektar", "Samo K. Šest boja kruži oko slova; ovo je ikona za male veličine i favicon."),
    ("1d-p1", "caps", "P1 · PLAYER razmaknut", "SemiBold, velika slova, širok razmak. Mirno i premium, kao potpis ispod znaka."),
    ("1d-p2", "word", "P2 · Player", "Veće, obična slova, bez razmaka. Najčitljivije na malim veličinama (do ~90 px)."),
    ("1d-p3", "spectrum", "P3 · PLAYER u spektru", "Natpis preuzima boje aure; u animaciji spektar putuje kroz slova."),
    ("1d-p4", "pill", "P4 · Staklena kapsula", "PLAYER u staklenoj kapsuli, kao oznaka. Najjasnije odvojen od slova."),
    ("1c-p1", "caps", "1c · Ambijent + PLAYER", "Doterani 1c: široko, mirno RGB svetlo (bez kruženja), isti natpis kao P1."),
]


def render(svg_path, png_path, size=1024):
    subprocess.run([sys.executable, RENDER, str(svg_path), "-o", str(png_path), "--size", str(size), "--backend", "chrome"],
                   check=True, capture_output=True)


def build_static():
    for vid, style, *_ in V:
        base = "1c" if vid.startswith("1c") else "1d"
        for tone in ("dark", "light"):
            p = OUT / f"{vid}-{tone}.svg"
            p.write_text(icon(style, tone == "light", base=base))
            render(p, PNG / f"{vid}-{tone}.png")
            im = Image.open(PNG / f"{vid}-{tone}.png").convert("RGBA")
            for n in (180, 120, 90, 64, 32, 16):
                im.resize((n, n), Image.LANCZOS).save(PNG / f"{vid}-{tone}-{n}.png")
    (OUT / "1d-live.svg").write_text(icon(None, live=True))
    (OUT / "1d-p1-live.svg").write_text(icon("caps", live=True))


def build_motion(frames=48, size=640):
    """Spectrum orbit: one full turn in `frames` steps, rendered frame by frame (Chrome), then MP4 + GIF via ffmpeg."""
    if FR.exists():
        shutil.rmtree(FR)
    FR.mkdir(parents=True)
    for i in range(frames):
        p = FR / f"f{i:03d}.svg"
        p.write_text(icon("caps", phase=360 * i / frames))
        render(p, FR / f"f{i:03d}.png", size)
    rate = frames / 8                                            # 8 s per turn
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", f"{rate}", "-i", str(FR / "f%03d.png"),
                    "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-crf", "18",
                    str(ROOT / "klaro-spektar-live.mp4")], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", f"{rate}", "-i", str(FR / "f%03d.png"),
                    "-vf", "scale=360:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256[p];[b][p]paletteuse=dither=sierra2_4a",
                    "-loop", "0", str(ROOT / "klaro-spektar-live.gif")], check=True)
    strip = Image.new("RGB", (6 * 170, 170), "#05080F")
    for j, i in enumerate(range(0, frames, frames // 6)):
        strip.paste(Image.open(FR / f"f{i:03d}.png").convert("RGB").resize((160, 160), Image.LANCZOS), (j * 170 + 5, 5))
    strip.save(PNG / "motion-strip.png")


def board():
    P = "_internal/kaura3-png"
    live = (OUT / "1d-p1-live.svg").read_text()
    cards = []
    for vid, style, name, note in V:
        cards.append(f"""<article class="c"><header><h2>{name}</h2></header>
<img class="big" src="{P}/{vid}-dark.png"><div class="row"><img class="mid" src="{P}/{vid}-light.png">
<div class="sizes"><img src="{P}/{vid}-dark-90.png" width="90"><img src="{P}/1d-dark-32.png" width="32"><img src="{P}/1d-dark-16.png" width="16"></div></div>
<p>{note}</p></article>""")
    ladders = "".join(
        f'<div class="lad"><b>{n}</b>' + "".join(f'<figure><img src="{P}/{vid}-dark-{s}.png" width="{s}"><figcaption>{s}</figcaption></figure>'
                                               for s in (180, 120, 90, 64)) + "</div>"
        for vid, _, n, _ in V[1:5])
    return f"""<!doctype html><html lang="sr-Latn"><head><meta charset="utf-8"><title>Klaro Spektar</title><style>
@font-face{{font-family:"Inter Tight";src:url("_src/fonts/InterTight[wght].ttf") format("truetype");font-weight:100 900}}
*{{box-sizing:border-box;margin:0}}
body{{background:radial-gradient(1100px 600px at 15% -5%,#15264D,transparent 60%),radial-gradient(900px 600px at 100% 0%,#2B1030,transparent 55%),#05080F;color:#EEF3FF;font:15px/1.5 "Inter Tight",system-ui,sans-serif;-webkit-font-smoothing:antialiased}}
.page{{width:1680px;padding:48px 56px 56px;margin:0 auto}}
small.k{{letter-spacing:.2em;text-transform:uppercase;color:#8C9AB8;font-size:12px}}
h1{{font-size:50px;letter-spacing:-.03em;margin:8px 0;line-height:1.05}} .lead{{color:#8C9AB8;font-size:16px;max-width:110ch}}
.top{{display:grid;grid-template-columns:1fr 520px;gap:28px;align-items:center}}
.live{{background:#070A12;border:1px solid #1B2640;border-radius:28px;padding:22px;text-align:center;color:#8C9AB8;font-size:13px}}
.live svg{{width:300px;height:300px;border-radius:22.5%;box-shadow:0 26px 60px rgba(0,0,0,.6)}} .live img{{width:100%;margin-top:14px;border-radius:12px}}
h3{{margin:30px 0 14px;font-size:14px;letter-spacing:.18em;text-transform:uppercase;color:#C9D4EA}}
.grid{{display:grid;grid-template-columns:repeat(6,1fr);gap:16px}}
.c{{background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.015));border:1px solid #1B2640;border-radius:22px;padding:14px}}
h2{{font-size:16px;letter-spacing:-.01em;margin-bottom:10px}}
.big{{width:100%;border-radius:22.5%;box-shadow:0 18px 40px rgba(0,0,0,.55)}}
.row{{display:flex;gap:10px;align-items:flex-end;margin-top:10px;flex-wrap:wrap}} .mid{{width:78px;border-radius:22.5%}}
.sizes{{display:flex;gap:8px;align-items:flex-end}} .sizes img{{border-radius:22%}} .sizes img[width="16"]{{border-radius:4px}}
.c p{{color:#B7C3DB;font-size:13px;margin-top:10px}}
.lads{{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}}
.lad{{display:flex;align-items:flex-end;gap:12px;background:#070A12;border:1px solid #1B2640;border-radius:20px;padding:16px;flex-wrap:wrap}}
.lad b{{width:100%;font-size:14px}} .lad figure{{text-align:center;color:#8C9AB8;font-size:11px}} .lad img{{border-radius:22.5%;display:block;margin-bottom:4px}}
.foot{{color:#8C9AB8;font-size:13.5px;margin-top:12px}}
</style></head><body><div class="page">
<div class="top"><div><small class="k">Klaro Player · razrada 1d + 1c</small>
<h1>Spektar koji živi, i PLAYER u četiri stila</h1>
<p class="lead">K je čisto staklo; šest boja spektra (crvena, žuta, zelena, cijan, plava, ljubičasta) kruži oko njega. Jedan krug traje 8 s, a aura blago „diše“ (4 s). Tako izgleda splash, TV intro i ikona na tvOS/Android TV fokusu. Statična ikona je jedan kadar tog kruženja. Desno je živa animacija (u HTML-u), a ispod su kadrovi.</p></div>
<div class="live">{live}<img src="{P}/motion-strip.png"><div style="margin-top:8px">klaro-spektar-live.mp4 · .gif</div></div></div>
<h3>Varijante</h3><div class="grid">{"".join(cards)}</div>
<h3>PLAYER na veličinama 180 · 120 · 90 · 64</h3><div class="lads">{ladders}</div>
<p class="foot">Natpis je pretvoren u oblike (Inter Tight). Na 64 px i manje koristi se ikona bez natpisa (prva kartica), kao i za favicon.</p>
</div></body></html>"""


def main():
    build_static()
    build_motion()
    html = ROOT / "klaro-spektar.html"
    html.write_text(board())
    subprocess.run([sys.executable, RENDER, str(html), "-o", str(ROOT / "klaro-spektar.png"), "--width", "1680",
                    "--height", "1760"], check=True)


if __name__ == "__main__":
    main()
