"""Upright round (owner: K3 is good, but upright like the wordmark; the navy top-left part feels undefined —
maybe centre it / make it read like a roof or play?).

All marks are upright. The white counter is 1:1 the Inter Tight Bold K counter (stem right edge, junction, arm edge).
U1  K3 upright (reference)
U2  Stub     — navy is a clean K stem; the counter opens upward like a real K
U3  Krov     — the navy stem gets a roof (gable) — 'home of everything you watch'
U4  Krov + krak — the roof's right slope runs parallel to the K arm, so navy and blue read as one K
"""
import math
import sys
from pathlib import Path

from shapely.geometry import Point, Polygon, box
from shapely.ops import unary_union

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from klaro_mark import d_of, fit  # noqa: E402
from typekit import glyph, text  # noqa: E402

OUT = ROOT / "concepts" / "klaro-upright"
OUT.mkdir(parents=True, exist_ok=True)
NAVY, BLUE, MIST, WHITE = "#0D1729", "#0669FE", "#F3F5F9", "#FFFFFF"
FONT = "InterTight"

STEM_R, CAP, JY = 410.0, 1490.0, 833.0
COUNTER = [(410, 1490), (410, 833), (430, 833), (966, 1490)]
ARM_DX = (966 - 430) / (1490 - 833)                    # arm edge: x grows this much per unit of height

H, L, A, R = 336.0, 140.0, 150.0, 60.0
k = (H - L) / (CAP - JY)


def fmap(pts, top=L):
    return [(A + (x - STEM_R) * k, top + (CAP - y) * k) for x, y in pts]


def soft(g, r_out, r_in=0):
    if r_in:
        g = g.buffer(r_in, 16, join_style=1).buffer(-r_in, 16, join_style=1)
    return g.buffer(-r_out, 16, join_style=1).buffer(r_out, 16, join_style=1)


def blue_panel(width=None, r_cut=16):
    counter = Polygon(fmap(COUNTER))
    W = width or counter.bounds[2]
    b = box(A, L, A + W, L + H).difference(counter)
    return soft(b, r_cut).intersection(soft(box(A, L, A + W, L + H), R))


def anchor():
    return Point(A, L + CAP * k), CAP * k


def u1():
    counter = Polygon(fmap(COUNTER))
    W = counter.bounds[2]
    navy = soft(unary_union([box(0, 0, W, L), box(0, 0, A, H)]), R, 30)
    return navy, blue_panel(W), anchor()


def u2():
    navy = soft(box(0, 0, A, H), R)
    return navy, blue_panel(), anchor()


def u3():
    pitch = A / 2
    navy = Polygon([(0, pitch), (A / 2, 0), (A, pitch), (A, H), (0, H)])
    navy = soft(navy, 34).intersection(soft(box(0, 0, A, H), R))
    navy = soft(Polygon([(0, pitch), (A / 2, 0), (A, pitch), (A, H), (0, H)]), 30)
    return navy, blue_panel(), anchor()


def u4():
    """Roof whose right slope is parallel to the K arm (a / slope mirrored): the gable points at the counter."""
    # left slope rises at the arm angle; the peak sits over the stem's right edge
    rise = A / ARM_DX
    navy = soft(Polygon([(0, rise), (A, 0), (A, H), (0, H)]), 34)
    return navy, blue_panel(), anchor()


def u5():
    """Two identical rounded squares (screens), turned 180° to each other; the white band between them
    is the Inter Tight K arm: exact angle (50.8°) and stroke (0.196 of cap height, cap = panel height)."""
    from shapely import affinity
    from marks import halfplane
    S = 300.0
    ang = math.atan((CAP - JY) / (966 - 430))                  # arm angle from horizontal
    w, h = 150.0, 150.0 * math.tan(ang)                        # overlap zone follows the arm angle
    ox, oy = S - w, S - h
    g = 0.196 * S                                              # arm stroke, perpendicular
    u = (math.cos(ang), -math.sin(ang))
    n = (-u[1], u[0])                                          # points down-right
    p0 = (ox - n[0] * g / 2, S - n[1] * g / 2)
    navy = box(0, 0, S, S).intersection(Polygon(halfplane(p0, u, (0, 0), size=2000)))
    navy = soft(navy, 12).intersection(soft(box(0, 0, S, S), R))
    cx, cy = (ox + S) / 2, (oy + S) / 2
    blue = affinity.rotate(navy, 180, origin=(cx, cy))
    k5 = S / CAP                                               # K with cap height = panel height, baseline on y = S
    jy = S - JY * k5                                           # the arm's inner edge starts at the junction (430, 833)
    t = (jy - p0[1]) / u[1]
    tx = p0[0] + t * u[0] - 430 * k5
    return navy, blue, (Point(tx + STEM_R * k5, S), S)


V = [("U1", "K3 uspravno", "Isti K3, samo uspravan kao slova u imenu.", u1()),
     ("U2", "Stub", "Tamni deo je čist stub slova K; otvor se otvara nagore kao pravo K. Najjasniji.", u2()),
     ("U3", "Krov", "Stub dobija krov: „dom svega što gledaš“.", u3()),
     ("U4", "Krov u pravcu kraka", "Kosina tamnog dela je paralelna kraku K: tamno i plavo zajedno pišu K i pokazuju napred.", u4()),
     ("U5", "Dva ekrana + krak K", "Dva ista panela (ekrana) okrenuta jedan prema drugom; beli pojas između je krak slova K (tačan ugao i debljina). Simetrično, pa deluje najodređenije.", u5())]


def placed(v, size, box_=256):
    n, b, (pt, cap) = v
    (n2, b2, p2), kk = fit([n, b, pt], size, box_)
    return n2, b2, p2, cap * kk


def body(v, size=200, c1=NAVY, c2=BLUE, box_=256, stroke=False):
    n, b, _, _ = placed(v, size, box_)
    if stroke:
        return (f'<path fill="{NAVY}" fill-opacity=".08" stroke="{NAVY}" stroke-width="1.2" d="{d_of(n)}"/>'
                f'<path fill="{BLUE}" fill-opacity=".12" stroke="{BLUE}" stroke-width="1.2" d="{d_of(b)}"/>')
    return f'<path fill="{c1}" d="{d_of(n)}"/><path fill="{c2}" d="{d_of(b)}"/>'


def k_path(v, size, box_=256, colour="#FF5A36", opacity=".3"):
    n, b, p, cap = placed(v, size, box_)
    d, _ = glyph("K", FONT, cap, x=0, base=0, wght=700)
    return f'<path fill="{colour}" fill-opacity="{opacity}" transform="translate({p.x - STEM_R / CAP * cap:.1f} {p.y:.1f})" d="{d}"/>'


def s(inner, view="0 0 256 256", cls=""):
    return f'<svg viewBox="{view}" class="{cls}">{inner}</svg>'


def wordmark(cap, c=NAVY):
    d1, a = text("Klaro", FONT, cap, x=0, base=0, tracking=-cap * 0.02, wght=700)
    d2, b = text("Player", FONT, cap, x=a + cap * 0.24, base=0, tracking=-cap * 0.012, wght=400)
    return f'<path fill="{c}" d="{d1}"/><path fill="{c}" d="{d2}"/>', a + cap * 0.24 + b


def lockup(v, dark=False):
    c = WHITE if dark else NAVY
    wm, w = wordmark(88, c)
    return s(f'{body(v, 200, c1=c)}<g transform="translate(262 160)">{wm}</g>', f"0 0 {262 + w + 16:.0f} 256")


cards = ""
for key, name, note, v in V:
    (OUT / f"{key.lower()}.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">{body(v, 220)}</svg>')
    icons = "".join(f'<svg viewBox="0 0 256 256" style="width:{px}px;height:{px}px;border-radius:{px * .2237:.1f}px">'
                    f'<rect width="256" height="256" fill="{bg}"/>{body(v, 150, c1=c1)}</svg>'
                    for px in (84, 32, 16) for bg, c1 in ((MIST, NAVY), (NAVY, WHITE)))
    cards += f"""<div class="card"><div class="top"><span class="k">{key}</span><span class="n">{name}</span></div>
      <div class="pair">{s(body(v, 200), cls="big")}{s(body(v, 150, stroke=True) + k_path(v, 150), cls="big")}</div>
      <div class="icons">{icons}</div>
      <div class="lk">{lockup(v)}</div>
      <div class="note">{note}</div></div>"""

html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: Inter Tight; src: url('{(HERE / "fonts" / "InterTight[wght].ttf").as_uri()}'); font-weight: 100 900; }}
* {{ box-sizing: border-box; margin: 0; }}
body {{ width: 1600px; background: {WHITE}; color: {NAVY}; font-family: 'Inter Tight', sans-serif; -webkit-font-smoothing: antialiased; padding: 56px 72px 64px; }}
.lbl {{ font-size: 13px; letter-spacing: .2em; text-transform: uppercase; color: #5B6478; font-weight: 500; }}
h1 {{ font-size: 38px; font-weight: 700; letter-spacing: -.025em; margin: 10px 0 8px; }}
.sub {{ font-size: 16px; color: #5B6478; }}
.grid {{ display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; margin-top: 28px; }}
.card {{ border: 1px solid #E4E8EF; border-radius: 22px; padding: 26px 28px; }}
.top {{ display: flex; gap: 10px; align-items: baseline; }}
.k {{ font-size: 18px; font-weight: 700; color: {BLUE}; }}
.n {{ font-size: 18px; font-weight: 600; }}
.pair {{ display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 4px; }}
.big {{ width: 100%; height: auto; display: block; max-height: 290px; }}
.icons {{ display: flex; gap: 10px; align-items: flex-end; margin-top: 6px; }}
.icons svg {{ box-shadow: 0 0 0 1px rgba(13,23,41,.08); }}
.lk {{ margin-top: 22px; }}
.lk svg {{ height: 64px; width: auto; display: block; }}
.note {{ font-size: 14.5px; color: #5B6478; margin-top: 16px; line-height: 1.45; }}
</style></head><body>
<div class="lbl">Klaro Player · uspravno</div>
<h1>Uspravno, kao slova u imenu. Tamni deo: jasniji oblik.</h1>
<div class="sub">Beli otvor je i dalje 1:1 iz Inter Tight Bold K. Desno u svakoj kartici: <b style="color:#FF5A36">narandžasto</b> K iz fonta preko znaka.</div>
<div class="grid">{cards}</div>
</body></html>"""
(ROOT / "klaro-upright.html").write_text(html)
print("ok")
