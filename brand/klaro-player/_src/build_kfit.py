"""Round: (1) fix the joins — the navy curve now starts exactly at the blue corner (owner: 'not synced');
(2) make the middle read more like the upper part of a K, so a zoom from 'Klaro Player' into the K can land on the mark.

V0  S counter (reference), joins synced
V1  straight diagonal: the counter becomes the K's upper crotch (stem + arm), closed at the top
V2  open K: the navy panel is the stem, the blue panel's diagonal is the arm, the V opens upward like a real K
"""
import math
import sys
from pathlib import Path

from shapely import affinity
from shapely.geometry import Point, Polygon

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from klaro_mark import SEG, _corner, d_of, fit  # noqa: E402
from typekit import glyph, text  # noqa: E402

FONT = (HERE / "fonts" / "Montserrat[wght].ttf").as_uri()
OUT = ROOT / "concepts" / "klaro-k"
OUT.mkdir(parents=True, exist_ok=True)
NAVY, BLUE, MIST, WHITE = "#0D1729", "#0669FE", "#F3F5F9", "#FFFFFF"
LEAN = 15.0
ARM = 1 / math.tan(math.radians(46.5))          # Montserrat Bold K: the arm rises at 46.5°


def poly(spec):
    """spec: list of (point, radius); radius 0 = sharp."""
    pts, n = [], len(spec)
    for i in range(n):
        p0, p1, p2 = spec[i - 1][0], spec[i][0], spec[(i + 1) % n][0]
        r = spec[i][1]
        pts += _corner(p0, p1, p2, r) if r else [p1]
    return Polygon(pts)


def shear(g, cy):
    s = math.tan(math.radians(LEAN))
    return affinity.affine_transform(g, [1, -s, 0, 1, s * cy, 0])


def v0():
    W, H, BAND, L, R = 270.0, 336.0, 92.0, 112.0, 48.0
    A = W - BAND
    pts = _corner((0, H), (0, 0), (W, 0), R) + _corner((0, 0), (W, 0), (W, L), R) + [(W, L)]
    for k in range(1, SEG * 2 + 1):                        # fillet starts exactly at the blue corner (W, L)
        t = -math.pi / 2 - (math.pi / 2) * k / (SEG * 2)
        pts.append((W + BAND * math.cos(t), L + BAND + BAND * math.sin(t)))
    pts += [(A, H)] + _corner((A, H), (0, H), (0, 0), R)
    navy = Polygon(pts)
    cx, cy = (A + W) / 2, (H + L) / 2                      # join = 0: panels meet in single points
    blue = affinity.rotate(navy, 180, origin=(cx, cy))
    return shear(navy, cy), shear(blue, cy), (shear(Point(A, H), cy), H)


def v1():
    W, H, L, R, A = 270.0, 336.0, 112.0, 48.0, 178.0
    navy = poly([((0, 0), R), ((W, 0), R), ((W, L), 0), ((A, L), 34), ((A, H), 0), ((0, H), R)])
    Xr, Yb = A + W, L + H
    blue = poly([((W, L), 0), ((Xr, L), R), ((Xr, Yb), R), ((A, Yb), R), ((A, H), 0)])
    return shear(navy, (H + L) / 2), shear(blue, (H + L) / 2), (shear(Point(A, H), (H + L) / 2), H)


def v2(stem=150.0, jy=196.0, arm_w=150.0, gap=0.0):
    H, R = 336.0, 48.0
    navy = poly([((0, 0), R), ((stem, 0), 18), ((stem, H), 0), ((0, H), R)])
    top_x = stem + gap + ARM * jy                          # the arm's inner edge meets the cap line here
    Xr = top_x + arm_w
    Yb = H + 112
    blue = poly([((top_x, 0), 10), ((Xr, 0), R), ((Xr, Yb), R), ((stem + gap, Yb), R), ((stem + gap, jy), 0)])
    return shear(navy, H / 2), shear(blue, H / 2), (shear(Point(stem, H), H / 2), H)


V = [("V0", "S-otvor, spojevi usklađeni", "Kao tvoja referenca; krivina sada kreće tačno iz plavog ugla.", v0()),
     ("V1", "Prava dijagonala", "Otvor postaje „krilo“ slova K (stub + krak), ali je zatvoren odozgo.", v1()),
     ("V2", "Otvoreno K", "Tamni panel je stub, plava dijagonala je krak K; V se otvara nagore kao pravo K.", v2())]


def placed(v, size, box=256):
    """Fit navy/blue into the box and return them with the transformed K anchor and scale."""
    n, b, (pt, cap) = v
    (n2, b2, p2), k = fit([n, b, pt], size, box)
    return n2, b2, p2, cap * k


def body(v, size=200, c1=NAVY, c2=BLUE, box=256, stroke=False):
    n, b, _, _ = placed(v, size, box)
    if stroke:
        return (f'<path fill="{NAVY}" fill-opacity=".08" stroke="{NAVY}" stroke-width="1.2" d="{d_of(n)}"/>'
                f'<path fill="{BLUE}" fill-opacity=".12" stroke="{BLUE}" stroke-width="1.2" d="{d_of(b)}"/>')
    return f'<path fill="{c1}" d="{d_of(n)}"/><path fill="{c2}" d="{d_of(b)}"/>'


def k_path(v, size, box=256, colour="#FF5A36", opacity=".3"):
    """Montserrat Bold K, leaned 15°: cap height = navy panel height, stem's right edge on the mark's stem edge."""
    n, b, p, cap = placed(v, size, box)
    d, _ = glyph("K", "Montserrat", cap, x=0, base=0, skew=LEAN, wght=700)
    stem_right = 243.74 / 700 * cap                     # Montserrat Bold K stem right edge at the baseline
    return f'<path fill="{colour}" fill-opacity="{opacity}" transform="translate({p.x - stem_right:.1f} {p.y:.1f})" d="{d}"/>'


def s(inner, view="0 0 256 256", cls=""):
    return f'<svg viewBox="{view}" class="{cls}">{inner}</svg>'


def k_overlay(v):
    return body(v, 170, stroke=True) + k_path(v, 170)


def zoom_frames(v):
    wm1 = text("Klaro", "Montserrat", 48, x=0, base=0, tracking=-0.6, wght=700)
    wm2 = text("Player", "Montserrat", 48, x=wm1[1] + 13, base=0, tracking=-0.5, wght=400)
    wm = f'<path fill="{NAVY}" d="{wm1[0]}"/><path fill="{NAVY}" d="{wm2[0]}"/>'
    W = wm1[1] + 13 + wm2[1]
    f1 = s(f'<g transform="translate({(420 - W) / 2:.1f} 146)">{wm}</g>', "0 0 420 256")
    f2 = s(f'<g transform="translate(82 0)">{k_path(v, 190, colour=NAVY, opacity="1").replace("skewX", "skewX")}</g>', "0 0 420 256")
    f3 = s(f'<g transform="translate(82 0)">{k_path(v, 190, colour=NAVY, opacity=".18")}{body(v, 190)}</g>', "0 0 420 256")
    f4 = s(f'<g transform="translate(82 0)">{body(v, 190)}</g>', "0 0 420 256")
    return [("1", "Klaro Player", f1), ("2", "zoom na K (nagnuto 15°)", f2), ("3", "K se razdvaja u dva panela", f3), ("4", "znak", f4)]


cards = ""
for key, name, note, pair in V:
    (OUT / f"{key.lower()}.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">{body(pair, 220)}</svg>')
    icons = "".join(f'<svg viewBox="0 0 256 256" style="width:{px}px;height:{px}px;border-radius:{px * .2237:.1f}px">'
                    f'<rect width="256" height="256" fill="{bg}"/>{body(pair, 150, c1=c1)}</svg>'
                    for px in (96, 32, 16) for bg, c1 in ((MIST, NAVY), (NAVY, WHITE)))
    cards += f"""<div class="card"><div class="top"><span class="k">{key}</span><span class="n">{name}</span></div>
      <div class="pair">{s(body(pair, 210), cls="big")}{s(k_overlay(pair), "0 0 256 256", "big")}</div>
      <div class="icons">{icons}</div><div class="note">{note}</div></div>"""

zoom = "".join(f'<div class="zf">{svg}<div class="zt">{n}. {t}</div></div>' for n, t, svg in zoom_frames(V[1][3]))

html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: Montserrat; src: url('{FONT}'); font-weight: 100 900; }}
* {{ box-sizing: border-box; margin: 0; }}
body {{ width: 1600px; background: {WHITE}; color: {NAVY}; font-family: Montserrat, sans-serif; -webkit-font-smoothing: antialiased; padding: 56px 72px 64px; }}
.lbl {{ font-size: 13px; letter-spacing: .2em; text-transform: uppercase; color: #5B6478; font-weight: 500; }}
h1 {{ font-size: 36px; font-weight: 700; letter-spacing: -.02em; margin: 10px 0 8px; }}
.sub {{ font-size: 16px; color: #5B6478; }}
.grid {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 30px; }}
.card {{ border: 1px solid #E4E8EF; border-radius: 22px; padding: 24px; }}
.top {{ display: flex; gap: 10px; align-items: baseline; }}
.k {{ font-size: 18px; font-weight: 700; color: {BLUE}; }}
.n {{ font-size: 18px; font-weight: 600; }}
.pair {{ display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }}
.big {{ width: 100%; height: auto; display: block; }}
.icons {{ display: flex; gap: 10px; align-items: flex-end; margin-top: 10px; }}
.icons svg {{ box-shadow: 0 0 0 1px rgba(13,23,41,.08); }}
.note {{ font-size: 14px; color: #5B6478; margin-top: 14px; line-height: 1.45; min-height: 40px; }}
.zoom {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-top: 18px; }}
.zf {{ border: 1px solid #E4E8EF; border-radius: 18px; overflow: hidden; }}
.zf svg {{ width: 100%; height: auto; display: block; background: {MIST}; }}
.zt {{ font-size: 14px; font-weight: 600; padding: 12px 16px; }}
.legend {{ font-size: 13px; color: #5B6478; margin-top: 10px; }}
.legend b {{ color: #FF5A36; }}
</style></head><body>
<div class="lbl">Klaro Player · spojevi + K</div>
<h1>Spojevi usklađeni. Sredina bliže gornjem delu slova K.</h1>
<div class="sub">Levo je znak, desno proba: <b style="color:#FF5A36">narandžasto</b> je K iz fonta Montserrat Bold (nagnut 15°) preko znaka.</div>
<div class="grid">{cards}</div>
<div class="lbl" style="margin-top:44px">Animacija (skica za V1): Klaro Player → zoom na K → znak</div>
<div class="zoom">{zoom}</div>
</body></html>"""
(ROOT / "klaro-k.html").write_text(html)
print("ok")
