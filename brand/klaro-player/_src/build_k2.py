"""Round: the white centre is taken 1:1 from the wordmark font's K (Inter Tight Bold), plus softer V1 and a font study.

K1  Krak   — the white centre is the K's upper arm (exact stroke); navy = stem side, blue = the rest
K2  Krilo  — the white centre is the K's upper counter (between stem and arm), exact; joins meet in points
K3  Krilo meko — K2 with soft corners (the owner's 'V1, but softer edges')
"""
import math
import sys
from pathlib import Path

from shapely import affinity
from shapely.geometry import Point, Polygon, box
from shapely.ops import unary_union

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from klaro_mark import d_of, fit  # noqa: E402
from typekit import glyph, text  # noqa: E402

OUT = ROOT / "concepts" / "klaro-k2"
OUT.mkdir(parents=True, exist_ok=True)
NAVY, BLUE, MIST, WHITE = "#0D1729", "#0669FE", "#F3F5F9", "#FFFFFF"
LEAN = 15.0
FONT_NAME, FONT_FILE = "InterTight", "InterTight[wght].ttf"

# Inter Tight Bold K, font units (y up, cap 1490): stem right edge x=410, counter and arm corners
STEM_R, CAP = 410.0, 1490.0
COUNTER = [(410, 1490), (410, 833), (430, 833), (966, 1490)]
ARM = [(430, 833), (966, 1490), (1343, 1490), (791, 823)]
H, L, A, R = 336.0, 140.0, 150.0, 52.0
k = (H - L) / (CAP - 833)                              # the counter spans exactly from the ledge (L) to the navy base (H)


def fmap(pts):
    """Font units -> mark units: stem right edge on x=A, cap line on y=L (y down)."""
    return [(A + (x - STEM_R) * k, L + (CAP - y) * k) for x, y in pts]


def rounded(g, r):
    return g.buffer(-r, 16, join_style=1).buffer(r, 16, join_style=1) if r else g


def filleted(g, r):
    """Round concave corners (closing)."""
    return g.buffer(r, 16, join_style=1).buffer(-r, 16, join_style=1) if r else g


def shear(g, cy):
    s = math.tan(math.radians(LEAN))
    return affinity.affine_transform(g, [1, -s, 0, 1, s * cy, 0])


def k2(soft=False):
    counter = Polygon(fmap(COUNTER))
    W = counter.bounds[2]                                # navy's top reaches the counter's top-right corner
    navy = unary_union([box(0, 0, W, L), box(0, 0, A, H)])
    bw = W                                               # blue panel = same width as the navy panel
    blue = box(A, L, A + bw, L + H).difference(counter)
    if soft:
        navy = rounded(filleted(navy, 30), R + 8)
        blue = rounded(blue, 16)
        blue = rounded(blue.union(blue), 16)
        # outer corners of the blue panel get the same big radius as the navy panel
        outer = rounded(box(A, L, A + bw, L + H), R + 8)
        blue = blue.intersection(outer)
    else:
        navy = rounded(navy, R)
        outer = rounded(box(A, L, A + bw, L + H), R)
        blue = blue.intersection(outer)
    anchor = Point(A, L + CAP * k)                       # K baseline at the stem's right edge
    cy = (L + H) / 2 + L / 2
    return shear(navy, cy), shear(blue, cy), (shear(anchor, cy), CAP * k)


def k1():
    arm = Polygon(fmap(ARM))
    counter = Polygon(fmap(COUNTER))
    W = counter.bounds[2]
    top_r = arm.bounds[2]                                # arm's outer edge at the cap line
    navy = unary_union([box(0, 0, W, L), box(0, 0, A, H), counter]).difference(arm)
    blue_x1 = top_r + 110
    blue = box(A, L, blue_x1, L + H)
    left_of_arm = Polygon([(A - 1, L - 1), (top_r, L - 1)] + list(reversed(fmap(ARM)))[0:2] + [(A - 1, H + 4)])
    blue = blue.difference(arm).difference(counter)
    # remove the part of the blue box left of the arm's outer edge (above the arm's foot)
    cut = Polygon([(A - 5, L - 5), fmap([(1343, 1490)])[0], fmap([(791, 823)])[0], (A - 5, fmap([(791, 823)])[0][1])])
    blue = blue.difference(cut)
    navy = rounded(navy, 0)
    navy = rounded(navy.intersection(rounded(box(0, 0, W, H), R)), 0)
    blue = blue.intersection(rounded(box(A, L, blue_x1, L + H), R))
    anchor = Point(A, L + CAP * k)
    cy = (L + H) / 2 + L / 2
    return shear(navy, cy), shear(blue, cy), (shear(anchor, cy), CAP * k)


V = [("K1", "Krak K", "Beli centar je gornji krak slova K, 1:1 iz fonta. Znak sam „piše“ K.", k1()),
     ("K2", "Krilo K", "Beli centar je otvor slova K (između stuba i kraka), 1:1 iz fonta.", k2()),
     ("K3", "Krilo K, meko", "Isto kao K2, ali sa mekšim ivicama (tvoj V1, zaobljeniji).", k2(soft=True))]


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


def k_path(v, size, box_=256, colour="#FF5A36", opacity=".3", font=FONT_NAME):
    n, b, p, cap = placed(v, size, box_)
    d, _ = glyph("K", font, cap, x=0, base=0, skew=LEAN, wght=700)
    return f'<path fill="{colour}" fill-opacity="{opacity}" transform="translate({p.x - STEM_R / CAP * cap:.1f} {p.y:.1f})" d="{d}"/>'


def s(inner, view="0 0 256 256", cls=""):
    return f'<svg viewBox="{view}" class="{cls}">{inner}</svg>'


def wordmark(font, cap, c=NAVY, w1=700, w2=400):
    d1, a = text("Klaro", font, cap, x=0, base=0, tracking=-cap * 0.02, wght=w1)
    d2, b = text("Player", font, cap, x=a + cap * 0.24, base=0, tracking=-cap * 0.012, wght=w2)
    return f'<path fill="{c}" d="{d1}"/><path fill="{c}" d="{d2}"/>', a + cap * 0.24 + b


def lockup(v, font=FONT_NAME, dark=False):
    c = WHITE if dark else NAVY
    wm, w = wordmark(font, 88, c)
    return s(f'{body(v, 210, c1=c)}<g transform="translate(270 162)">{wm}</g>', f"0 0 {270 + w + 16:.0f} 256")


def zoom_frames(v):
    wm, w = wordmark(FONT_NAME, 52)
    f1 = s(f'<g transform="translate({(420 - w) / 2:.1f} 146)">{wm}</g>', "0 0 420 256")
    f2 = s(f'<g transform="translate(82 0)">{k_path(v, 190, colour=NAVY, opacity="1")}</g>', "0 0 420 256")
    f3 = s(f'<g transform="translate(82 0)">{k_path(v, 190, colour=NAVY, opacity=".16")}{body(v, 190)}</g>', "0 0 420 256")
    f4 = s(f'<g transform="translate(82 0)">{body(v, 190)}</g>', "0 0 420 256")
    return [("1", "Klaro Player", f1), ("2", "zoom na K, nagne se 15°", f2), ("3", "K se razdvaja u dva panela", f3), ("4", "znak", f4)]


FONTS = [("InterTight", "Inter Tight", "Apple TV / SF Pro karakter: neutralan, precizan, premium. Moja preporuka."),
         ("Figtree", "Figtree", "Najbliže Netflix Sans: prijateljski, čitljiv na TV-u."),
         ("Outfit", "Outfit", "Geometrijski, kao Max / Disney+: moderan, okrugao."),
         ("Geist", "Geist", "Vercel/tech 2026: oštar, savremen.")]

cards = ""
for key, name, note, v in V:
    (OUT / f"{key.lower()}.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">{body(v, 220)}</svg>')
    icons = "".join(f'<svg viewBox="0 0 256 256" style="width:{px}px;height:{px}px;border-radius:{px * .2237:.1f}px">'
                    f'<rect width="256" height="256" fill="{bg}"/>{body(v, 150, c1=c1)}</svg>'
                    for px in (96, 32, 16) for bg, c1 in ((MIST, NAVY), (NAVY, WHITE)))
    cards += f"""<div class="card"><div class="top"><span class="k">{key}</span><span class="n">{name}</span></div>
      <div class="pair">{s(body(v, 210), cls="big")}{s(body(v, 150, stroke=True) + k_path(v, 150), "0 0 256 256", cls="big")}</div>
      <div class="icons">{icons}</div><div class="note">{note}</div></div>"""

fonts = ""
for fk, fname, fnote in FONTS:
    wm, w = wordmark(fk, 64)
    kd, _ = glyph("K", fk, 64, x=0, base=0, wght=700)
    fonts += (f'<div class="font"><div class="fn">{fname}</div>{s(f"<g transform={chr(34)}translate(4 70){chr(34)}>{wm}</g>", f"0 0 {w + 10:.0f} 90", "fw")}'
              f'<div class="note">{fnote}</div></div>')

zoom = "".join(f'<div class="zf">{sv}<div class="zt">{n}. {t}</div></div>' for n, t, sv in zoom_frames(V[2][3]))

html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: Inter Tight; src: url('{(HERE / "fonts" / FONT_FILE).as_uri()}'); font-weight: 100 900; }}
* {{ box-sizing: border-box; margin: 0; }}
body {{ width: 1600px; background: {WHITE}; color: {NAVY}; font-family: 'Inter Tight', sans-serif; -webkit-font-smoothing: antialiased; padding: 56px 72px 64px; }}
.lbl {{ font-size: 13px; letter-spacing: .2em; text-transform: uppercase; color: #5B6478; font-weight: 500; }}
h1 {{ font-size: 38px; font-weight: 700; letter-spacing: -.025em; margin: 10px 0 8px; }}
.sub {{ font-size: 16px; color: #5B6478; }}
.grid {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 28px; }}
.card {{ border: 1px solid #E4E8EF; border-radius: 22px; padding: 24px; }}
.top {{ display: flex; gap: 10px; align-items: baseline; }}
.k {{ font-size: 18px; font-weight: 700; color: {BLUE}; }}
.n {{ font-size: 18px; font-weight: 600; }}
.pair {{ display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }}
.big {{ width: 100%; height: auto; display: block; }}
.icons {{ display: flex; gap: 10px; align-items: flex-end; margin-top: 10px; }}
.icons svg {{ box-shadow: 0 0 0 1px rgba(13,23,41,.08); }}
.note {{ font-size: 14px; color: #5B6478; margin-top: 12px; line-height: 1.45; }}
.fonts {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; margin-top: 18px; }}
.font {{ border: 1px solid #E4E8EF; border-radius: 18px; padding: 20px 22px; }}
.fn {{ font-size: 13px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: {BLUE}; margin-bottom: 12px; }}
.fw {{ width: 100%; height: auto; display: block; }}
.lock {{ display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 18px; }}
.lk {{ border-radius: 18px; padding: 34px 40px; border: 1px solid #E4E8EF; }}
.lk svg {{ width: 100%; height: auto; display: block; }}
.lk.dark {{ background: {NAVY}; border: 0; }}
.zoom {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-top: 18px; }}
.zf {{ border: 1px solid #E4E8EF; border-radius: 18px; overflow: hidden; }}
.zf svg {{ width: 100%; height: auto; display: block; background: {MIST}; }}
.zt {{ font-size: 14px; font-weight: 600; padding: 12px 16px; }}
</style></head><body>
<div class="lbl">Klaro Player · beli centar = slovo K iz fonta</div>
<h1>Beli centar je sada deo slova K, tačno iz fonta.</h1>
<div class="sub">Font: Inter Tight Bold. Desno u svakoj kartici: <b style="color:#FF5A36">narandžasto</b> je K iz fonta (nagnut 15°) preko znaka; beli deo mu se poklapa 1:1.</div>
<div class="grid">{cards}</div>
<div class="lbl" style="margin-top:40px">Lockup sa K3 · Inter Tight Bold / Regular</div>
<div class="lock"><div class="lk">{lockup(V[2][3])}</div><div class="lk dark">{lockup(V[2][3], dark=True)}</div></div>
<div class="lbl" style="margin-top:40px">Font za „Klaro Player“ — moderni OTT fontovi (svi besplatni, licenca OFL dozvoljava logo)</div>
<div class="fonts">{fonts}</div>
<div class="lbl" style="margin-top:40px">Animacija (K3): Klaro Player → zoom na K → znak</div>
<div class="zoom">{zoom}</div>
</body></html>"""
(ROOT / "klaro-k2.html").write_text(html)
print("ok")
