"""B 'Always in Sync' with a Navy -> Blue gradient, plus C1/C2 'Continuous' for comparison.

Geometry comes from build_refs (sync / cont). Gradients are linear, userSpaceOnUse, and their end points are
computed from each part's own extent along the gradient direction, so every stop lands exactly on the shape.
The flat two-colour and the one-colour versions stay the masters (skill rule: gradients are an enhancement).
"""
import math
import sys
from pathlib import Path

from shapely.geometry import LineString

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from build_refs import cont, d_of, sync, to_canvas  # noqa: E402
from marks import f  # noqa: E402
from typekit import text  # noqa: E402

OUT = ROOT / "concepts" / "gradient"
OUT.mkdir(parents=True, exist_ok=True)
NAVY, BLUE, WHITE, MIST = "#0D1729", "#0669FE", "#FFFFFF", "#F3F5F9"
SKY = "#DCE8FF"          # light end used on dark backgrounds (navy would vanish there)


# ------------------------------------------------------------------ gradient helpers
def ends(geom, ang):
    """Gradient end points spanning geom along direction ang (degrees, SVG y-down)."""
    u = (math.cos(math.radians(ang)), math.sin(math.radians(ang)))
    pts = [c for p in getattr(geom, "geoms", [geom]) for c in p.exterior.coords]
    proj = [x * u[0] + y * u[1] for x, y in pts]
    cx = sum(x for x, _ in pts) / len(pts); cy = sum(y for _, y in pts) / len(pts)
    c0 = cx * u[0] + cy * u[1]
    lo, hi = min(proj) - c0, max(proj) - c0
    return (cx + u[0] * lo, cy + u[1] * lo), (cx + u[0] * hi, cy + u[1] * hi)


def lin(gid, p0, p1, stops):
    s = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
    return (f'<linearGradient id="{gid}" gradientUnits="userSpaceOnUse" x1="{f(p0[0])}" y1="{f(p0[1])}" '
            f'x2="{f(p1[0])}" y2="{f(p1[1])}">{s}</linearGradient>')


def polys(g):
    """Drop stray lines/points that shapely boolean ops can leave behind."""
    from shapely.geometry import MultiPolygon, Polygon
    ps = [p for p in getattr(g, "geoms", [g]) if isinstance(p, Polygon) and p.area > 1e-6]
    return ps[0] if len(ps) == 1 else MultiPolygon(ps)


def placed_sync(size=200, box_=256, fold=True):
    """sync() split into navy panel, blue body and the fold flap, placed on the canvas."""
    parts = sync()
    navy, blue = parts[0][0], parts[1][0]
    # the flap = the part of the blue panel left of the navy panel's right edge
    from shapely.geometry import box
    minx = blue.bounds[0]
    flap = polys(blue.intersection(box(minx - 1, -1e4, 290, 1e4)))
    body = polys(blue.difference(flap).buffer(0))
    raw = [(navy, "navy"), (body, "body"), (flap, "flap")] if fold else [(navy, "navy"), (blue, "blue")]
    return to_canvas(raw, size, box_)


# ------------------------------------------------------------------ B gradient concepts
def b_grad(style, dark=False, size=200, uid="x"):
    """Return (defs, body) for one B concept on a 256 canvas."""
    P = dict((r, g) for g, r in placed_sync(size))
    navy, body, flap = P["navy"], P["body"], P["flap"]
    lo = SKY if dark else NAVY
    defs, out = [], []

    def fill(g, gid, ang, stops):
        a, b = ends(g, ang)
        defs.append(lin(f"{uid}-{gid}", a, b, stops))
        out.append(f'<path fill="url(#{uid}-{gid})" d="{d_of(g)}"/>')

    # Anti-alias seams: each lower layer reaches 1 unit under the layer drawn on top of it (never outside the mark).
    from shapely.ops import unary_union
    whole = unary_union([navy, body, flap])
    under = lambda g: polys(g.buffer(1.0, 16).intersection(whole))
    navy_u, blue = under(navy), polys(unary_union([body, flap]))
    if style == "flow":
        # G1 Tok: the mark flows Navy -> Blue from bottom-left to top-right; each panel covers its own stretch
        # of the ramp and the blue panel starts a step lighter, so the seam still separates the two panels.
        fill(navy_u, "n", -45, [(0, lo), (0.25, lo), (1, mix(lo, BLUE, .55))])
        fill(blue, "b", -45, [(0, mix(lo, BLUE, .62)), (0.55, BLUE), (1, BLUE)])
    elif style == "twin":
        # G2 Dva ista: both panels carry the SAME gradient (Navy bottom -> Blue top): two screens, one state.
        fill(navy_u, "n", -90, [(0, lo), (0.12, lo), (1, BLUE)])
        fill(blue, "b", -90, [(0, lo), (0.12, lo), (1, BLUE)])
    elif style == "handoff":
        # G3 Predaja: flat Navy and flat Blue; only the fold flap turns Navy into Blue (Jira-style shade).
        out.append(f'<path fill="{lo}" d="{d_of(navy_u)}"/>')
        out.append(f'<path fill="{BLUE}" d="{d_of(under(body))}"/>')
        fill(flap, "f", 0, [(0, lo), (1, BLUE)])
    return "".join(defs), "".join(out)


def mix(a, b, t):
    ca = [int(a[i:i + 2], 16) for i in (1, 3, 5)]; cb = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(x + (y - x) * t):02X}" for x, y in zip(ca, cb))


def b_mono(gap=7.0, size=200):
    """One-colour master: the panels separated by a gap along the shared diagonal (they touch in colour)."""
    P = dict((r, g) for g, r in placed_sync(size, fold=False))
    navy, blue = P["navy"], P["blue"]
    seam = navy.buffer(gap, 32, join_style=1)
    return navy, blue.difference(seam)


# ------------------------------------------------------------------ C (flat, as liked) + gradient option
def c_parts(which, size=200):
    parts = cont(leg=((-0.35, 0.24), 36)) if which == "c1" else cont(g=0.10)
    return to_canvas(parts, size)


def c_body(which, style="flat", dark=False, size=200, uid="c"):
    lo = WHITE if dark else NAVY
    defs, out = [], []
    for i, (g, role) in enumerate(c_parts(which, size)):
        if role == "b":
            out.append(f'<path fill="{BLUE}" d="{d_of(g)}"/>')
        elif style == "grad":
            a, b = ends(g, 0)
            defs.append(lin(f"{uid}{i}", a, b, [(0, SKY if dark else NAVY), (0.45, SKY if dark else NAVY), (1, BLUE)]))
            out.append(f'<path fill="url(#{uid}{i})" d="{d_of(g)}"/>')
        else:
            out.append(f'<path fill="{lo}" d="{d_of(g)}"/>')
    return "".join(defs), "".join(out)


# ------------------------------------------------------------------ files
def svg(defs, body, view="0 0 256 256", w=256, h=256):
    d = f"<defs>{defs}</defs>" if defs else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{f(w)}" height="{f(h)}" viewBox="{view}">'
            f'<title>Klaro Player</title>{d}{body}</svg>')


def lockup(defs, body, dark=False, font="InterTight"):
    """Horizontal lockup: mark + 'Klaro' Bold + 'Player' Regular (outlined)."""
    c = WHITE if dark else NAVY
    cap = 96
    d1, w1 = text("Klaro", font, cap, x=300, base=176, tracking=-cap * 0.025, wght=700)
    d2, w2 = text("Player", font, cap, x=300 + w1 + cap * 0.27, base=176, tracking=-cap * 0.01, wght=400)
    W = 300 + w1 + cap * 0.27 + w2 + 16
    return svg(defs, body + f'<path fill="{c}" d="{d1}"/><path fill="{c}" d="{d2}"/>', f"0 0 {f(W)} 256", W, 256)


B_STYLES = [("g1", "flow"), ("g2", "twin"), ("g3", "handoff")]

if __name__ == "__main__":
    for key, style in B_STYLES:
        for dark in (False, True):
            tag = "dark" if dark else "light"
            dfs, bd = b_grad(style, dark, uid=f"{key}{tag[0]}")
            (OUT / f"b-{key}-{tag}.svg").write_text(svg(dfs, bd))
        dfs, bd = b_grad(style, uid=f"{key}L")
        (OUT / f"b-{key}-lockup.svg").write_text(lockup(dfs, bd))
    n, b = b_mono()
    (OUT / "b-mono.svg").write_text(svg("", f'<path fill="#000" d="{d_of(n)}"/><path fill="#000" d="{d_of(b)}"/>'))
    for which in ("c1", "c2"):
        for style in ("flat",):
            for dark in (False, True):
                dfs, bd = c_body(which, style, dark, uid=f"{which}{style[0]}{int(dark)}")
                (OUT / f"{which}-{style}-{'dark' if dark else 'light'}.svg").write_text(svg(dfs, bd))
        dfs, bd = c_body(which, "flat", uid=f"{which}L")
        (OUT / f"{which}-lockup.svg").write_text(lockup(dfs, bd))
    print("ok")
