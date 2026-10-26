"""Clean vector builds of the three AI references the owner liked (references/ref-*.png).

Two-tone flat marks: Navy + Blue sampled from the references. Geometry is rebuilt with exact circles,
lines and angles (shapely booleans), not traced.
"""
import math
import sys
from pathlib import Path

from shapely.geometry import Point, Polygon, box
from shapely import affinity

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from marks import f, rpoly  # noqa: E402
from typekit import text  # noqa: E402

FONT = (HERE / "fonts" / "Geist[wght].ttf").as_uri()
OUT = ROOT / "concepts" / "refs"
OUT.mkdir(parents=True, exist_ok=True)
NAVY, BLUE, WHITE = "#0D1729", "#0669FE", "#FFFFFF"
RES = 128


# ------------------------------------------------------------------ helpers
def circ3(a, b, c):
    """Circle through three points -> (cx, cy, r)."""
    ax, ay = a; bx, by = b; cx, cy = c
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d
    uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d
    return ux, uy, math.hypot(ax - ux, ay - uy)


def disk(a, b, c):
    x, y, r = circ3(a, b, c)
    return Point(x, y).buffer(r, RES)


def half(p, ang_deg, side=1, size=10):
    """Half-plane left (side=1) or right (side=-1) of the directed line through p at angle."""
    u = (math.cos(math.radians(ang_deg)), math.sin(math.radians(ang_deg)))
    n = (-u[1] * side, u[0] * side)
    a = (p[0] - u[0] * size, p[1] - u[1] * size); b = (p[0] + u[0] * size, p[1] + u[1] * size)
    return Polygon([a, b, (b[0] + n[0] * size, b[1] + n[1] * size), (a[0] + n[0] * size, a[1] + n[1] * size)])


def soften(g, r):
    """Round convex corners (morphological opening)."""
    return g.buffer(-r, RES // 4, join_style=1).buffer(r, RES // 4, join_style=1) if r else g


def d_of(g):
    """SVG path for a (multi)polygon."""
    polys = getattr(g, "geoms", [g])
    out = []
    for p in polys:
        for ring in [p.exterior, *p.interiors]:
            pts = list(ring.coords)[:-1]
            out.append("M" + " L".join(f"{f(x)} {f(y)}" for x, y in pts) + " Z")
    return " ".join(out)


def to_canvas(parts, size=200, box_=256):
    """Scale/centre a list of (geom, role) into the 256 canvas with the mark's longest side = size."""
    from shapely.ops import unary_union
    minx, miny, maxx, maxy = unary_union([g for g, _ in parts]).bounds
    s = size / max(maxx - minx, maxy - miny)
    out = []
    for g, role in parts:
        g = affinity.translate(g, -(minx + maxx) / 2, -(miny + maxy) / 2)
        g = affinity.scale(g, s, s, origin=(0, 0))
        g = affinity.translate(g, box_ / 2, box_ / 2)
        out.append((g, role))
    return out


# ------------------------------------------------------------------ A · Flow Forward
def flow(gap_top=0.05, sliver=True):
    C = Point(0, 0).buffer(1, RES)
    top = (math.cos(math.radians(-43)), math.sin(math.radians(-43)))
    top2 = (math.cos(math.radians(-43 + gap_top * 60)), math.sin(math.radians(-43 + gap_top * 60)))
    A = disk(top, (-0.29, -0.18), (-0.76, 0.69))
    B = disk(top2, (-0.22, 0.30), (-0.03, 1.0))
    navy = C.difference(A)
    blue = C.intersection(B)
    parts = [(navy, "a")]
    if sliver:
        S = disk((0.98, 0.10), (0.44, 0.62), (0.14, 0.99))
        parts += [(blue.difference(S), "b"), (C.intersection(S).intersection(B), "a")]
    else:
        parts += [(blue, "b")]
    return parts


# ------------------------------------------------------------------ B · Always in Sync
def sync(t_deg=30, fold_tone="b"):
    t = math.tan(math.radians(t_deg))
    x0, x1, x2, x3 = 90, 310, 290, 540
    line = lambda x: 245 + (x - 150) * t           # shared diagonal: navy below, blue above
    h = 235
    navy = [(x0, line(x0)), (x1, line(x1)), (x1, line(x1) + h), (x0, line(x0) + h)]
    yA = 46                                         # blue panel sits higher and is a bit taller (as in the reference)
    blue = [(x2, yA), (x3, yA + (x3 - x2) * t), (x3, line(x3)), (150, 245), (x2, 245)]
    parts = [(Polygon(_round(navy, [34, 0, 58, 18])), "a"),
             (Polygon(_round(blue, [50, 18, 58, 0, 0])), "b")]
    if fold_tone != "b":
        fold = Polygon([(150, 245), (x2, 245), (x2, line(x2))])
        parts.append((fold.intersection(parts[1][0]), fold_tone))
    return parts


def _round(pts, radii, seg=16):
    """Polygon points with per-corner radii (sampled arcs)."""
    out, n = [], len(pts)
    for i in range(n):
        p0, p1, p2 = pts[i - 1], pts[i], pts[(i + 1) % n]
        r = radii[i]
        if r <= 0:
            out.append(p1); continue
        v1 = (p0[0] - p1[0], p0[1] - p1[1]); v2 = (p2[0] - p1[0], p2[1] - p1[1])
        l1, l2 = math.hypot(*v1), math.hypot(*v2)
        u1 = (v1[0] / l1, v1[1] / l1); u2 = (v2[0] / l2, v2[1] / l2)
        ang = math.acos(max(-1, min(1, u1[0] * u2[0] + u1[1] * u2[1])))
        d = min(r / math.tan(ang / 2), l1 / 2, l2 / 2)
        re = d * math.tan(ang / 2)
        bis = (u1[0] + u2[0], u1[1] + u2[1]); bl = math.hypot(*bis); bis = (bis[0] / bl, bis[1] / bl)
        c = (p1[0] + bis[0] * re / math.sin(ang / 2), p1[1] + bis[1] * re / math.sin(ang / 2))
        a = (p1[0] + u1[0] * d, p1[1] + u1[1] * d); b = (p1[0] + u2[0] * d, p1[1] + u2[1] * d)
        a0 = math.atan2(a[1] - c[1], a[0] - c[0]); a1 = math.atan2(b[1] - c[1], b[0] - c[0])
        da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
        out += [(c[0] + re * math.cos(a0 + da * k / seg), c[1] + re * math.sin(a0 + da * k / seg)) for k in range(seg + 1)]
    return out


# ------------------------------------------------------------------ C · Continuous (circle cut into a K)
def cont(g=0.12, stem_deg=-50, up=-38, dn=40, r=0.045, apex=(0.0, 0.0), leg=None):
    """leg=(point, angle): the bottom piece's top edge; None = parallel to the blue edge at gap g."""
    from marks import halfplane
    C = Point(0, 0).buffer(1, RES)
    hp = lambda p, u, keep: Polygon(halfplane(p, u, keep, size=10))
    dirv = lambda a: (math.cos(math.radians(a)), math.sin(math.radians(a)))
    p = (-0.30, 0.0)                                   # the diagonal 'stem' cut passes here
    u = dirv(stem_deg)
    n = (-u[1], u[0])                                  # points down-right, towards the blue side
    big = C.intersection(hp((p[0] - n[0] * g / 2, p[1] - n[1] * g / 2), u, (-1, -1)))
    rest = C.intersection(hp((p[0] + n[0] * g / 2, p[1] + n[1] * g / 2), u, (1, 1)))
    uu, ud = dirv(up), dirv(dn)
    wedge = Polygon([apex, (apex[0] + 3 * uu[0], apex[1] + 3 * uu[1]), (apex[0] + 3 * ud[0], apex[1] + 3 * ud[1])])
    blue = rest.intersection(wedge)
    if leg:
        bottom = rest.intersection(hp(leg[0], dirv(leg[1]), (0, 1.5)))
    else:
        off = (apex[0] - ud[1] * g, apex[1] + ud[0] * g)
        bottom = rest.intersection(hp(off, ud, (0, 1.5)))
    return [(soften(big, r), "a"), (soften(blue, r), "b"), (soften(bottom, r), "a")]


# ------------------------------------------------------------------ rendering
DIRS = [
    ("A", "Flow Forward", "Krug sa zamahom: sadržaj teče dalje, na sledeći ekran.",
     "krug + zamah je čest oblik (sport, banke); Claro koristi krug, ali crveni", [
         ("A1", "Original", flow()),
         ("A2", "Bez donjeg luka", flow(sliver=False)),
     ]),
    ("B", "Always in Sync", "Dva panela spojena preklopom: jedan uređaj predaje drugom, uvek u sinhronizaciji.",
     "može da se pročita kao slovo N ili Z", [
         ("B1", "Original", sync()),
         ("B2", "Tamniji preklop", sync(fold_tone="f")),
     ]),
    ("C", "Continuous", "Krug isečen u K: jedan znak, sve na jednom mestu.",
     "plavi deo je trougao koji pokazuje ulevo (daleka asocijacija na premotavanje)", [
         ("C1", "Original", cont(leg=((-0.35, 0.24), 36))),
         ("C2", "Jednaki rezovi", cont(g=0.10)),
     ]),
]
TONES = {
    "light": {"a": NAVY, "b": BLUE, "f": "#0550C4"},
    "dark": {"a": WHITE, "b": BLUE, "f": "#0550C4"},
    "black": {"a": "#000", "b": "#000", "f": "#000"},
    "white": {"a": WHITE, "b": WHITE, "f": WHITE},
}


def mark(parts, tone="light", size=200):
    placed = to_canvas(parts, size)
    return "".join(f'<path fill="{TONES[tone][role]}" d="{d_of(g)}"/>' for g, role in placed)


def svg(body, px=None, radius=None, view="0 0 256 256"):
    st = f' style="width:{px}px;height:{px}px' + (f';border-radius:{radius}px' if radius else '') + '"' if px else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}"{st}>{body}</svg>'


def app_icon(parts, dark, px, radius):
    bg = f'<rect width="256" height="256" rx="57" fill="{NAVY if dark else WHITE}"/>'
    return svg(bg + mark(parts, "dark" if dark else "light", 150), px, radius)


def lockup_stacked(parts, dark=False):
    c = WHITE if dark else NAVY
    cap = 56
    d1, w1 = text("Klaro", "Geist", cap, x=0, base=0, tracking=-cap * 0.03, wght=700)
    d2, w2 = text("Player", "Geist", cap, x=0, base=0, tracking=-cap * 0.02, wght=400)
    gapw = cap * 0.28
    W = w1 + gapw + w2
    box_w = max(256, W + 40)
    body = (f'<g transform="translate({f(box_w / 2 - 128)} -24)">{mark(parts, "dark" if dark else "light", 170)}</g>'
            f'<g transform="translate({f(box_w / 2 - W / 2)} 262)"><path fill="{c}" d="{d1}"/><path fill="{c}" transform="translate({f(w1 + gapw)} 0)" d="{d2}"/></g>')
    return svg(body, view=f"0 10 {f(box_w)} 270")


def lockup_h(parts, dark=False):
    c1 = WHITE if dark else NAVY
    cap = 80
    d1, w1 = text("Klaro", "Geist", cap, x=280, base=168, tracking=-cap * 0.03, wght=700)
    d2, w2 = text("Player", "Geist", cap, x=280 + w1 + cap * 0.26, base=168, tracking=-cap * 0.02, wght=400)
    W = 280 + w1 + cap * 0.26 + w2 + 20
    return svg(mark(parts, "dark" if dark else "light", 190) + f'<path fill="{c1}" d="{d1}"/><path fill="{c1}" d="{d2}"/>', view=f"0 0 {f(W)} 256")


if __name__ == "__main__":
    sections = ""
    for key, title, idea, risk, variants in DIRS:
        cards = ""
        for vk, vname, parts in variants:
            for tone in ("light", "black"):
                (OUT / f"{vk.lower()}-{tone}.svg").write_text(
                    svg(mark(parts, tone)).replace("<svg ", '<svg width="256" height="256" ', 1))
            small = "".join(app_icon(parts, d, s, s * .22) for s in (32, 16) for d in (False, True))
            cards += f"""<div class="card"><div class="top"><span class="k">{vk}</span><span class="n">{vname}</span></div>
              <div class="row"><div class="stack">{lockup_stacked(parts)}</div>
                <div class="icons">{app_icon(parts, False, 112, 25)}{app_icon(parts, True, 112, 25)}<div class="sm">{small}</div></div></div>
              <div class="dark">{lockup_h(parts, True)}</div></div>"""
        sections += f"""<section><div class="head"><span class="big">{key}</span><div><h2>{title}</h2><p>{idea}</p><p class="risk">Rizik: {risk}</p></div></div>
          <div class="grid">{cards}</div></section>"""

    html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face {{ font-family: Geist; src: url('{FONT}'); font-weight: 100 900; }}
    * {{ box-sizing: border-box; margin: 0; }}
    body {{ width: 1600px; background: #F4F6FA; color: {NAVY}; font-family: Geist, sans-serif; -webkit-font-smoothing: antialiased; padding: 64px 80px 72px; }}
    .eyebrow {{ font-size: 14px; letter-spacing: .18em; text-transform: uppercase; color: #6B7488; }}
    h1 {{ font-size: 44px; font-weight: 700; letter-spacing: -.035em; margin-top: 12px; }}
    .sub {{ font-size: 18px; color: #4A5368; margin-top: 10px; }}
    section {{ margin-top: 44px; }}
    .head {{ display: flex; gap: 20px; align-items: flex-start; margin-bottom: 18px; }}
    .big {{ font-size: 44px; font-weight: 700; color: {BLUE}; line-height: 1; }}
    h2 {{ font-size: 26px; font-weight: 650; letter-spacing: -.02em; }}
    .head p {{ font-size: 16px; color: #4A5368; margin-top: 4px; }}
    .head p.risk {{ color: #B4540A; font-size: 14px; }}
    .grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }}
    .card {{ background: #fff; border-radius: 26px; padding: 26px; box-shadow: 0 1px 0 rgba(13,23,41,.06), 0 12px 30px rgba(13,23,41,.06); }}
    .top {{ display: flex; gap: 10px; align-items: baseline; }}
    .k {{ font-size: 18px; font-weight: 700; color: {BLUE}; }}
    .n {{ font-size: 18px; font-weight: 560; }}
    .row {{ display: flex; gap: 24px; align-items: center; margin-top: 8px; }}
    .stack svg {{ width: 250px; height: auto; display: block; }}
    .icons {{ display: grid; grid-template-columns: 112px 112px; gap: 14px; align-items: end; }}
    .icons > svg {{ box-shadow: 0 10px 24px rgba(13,23,41,.16), 0 0 0 1px rgba(13,23,41,.06); }}
    .sm {{ grid-column: 1 / 3; display: flex; gap: 10px; align-items: flex-end; }}
    .sm svg {{ box-shadow: 0 0 0 1px rgba(13,23,41,.08); }}
    .dark {{ margin-top: 16px; background: {NAVY}; border-radius: 16px; padding: 18px 22px; }}
    .dark svg {{ height: 46px; width: auto; display: block; }}
    </style></head><body>
    <div class="eyebrow">Klaro Player · tvoje tri reference, čisto nacrtane</div>
    <h1>Flow Forward · Always in Sync · Continuous</h1>
    <div class="sub">Tačni krugovi, linije i uglovi umesto AI slike. Dve boje iz referenci: Navy {NAVY} i Blue {BLUE}. Po dve varijante svake.</div>
    {sections}
    </body></html>"""
    (ROOT / "klaro-refs.html").write_text(html)
    print("ok")
