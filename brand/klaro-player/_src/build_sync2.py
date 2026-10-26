"""Klaro Player — 'In Sync' round (from the owner's refined core-mark board, 30 Sep 2026).

Construction (unit = panel width W):
  panels     two parallelograms with vertical sides and 30° top/bottom edges (isometric slant)
  navy       apex TL (0,0); acute corners (TL, BR) radius R, obtuse BL radius R2, TR sharp (hidden by the join)
  blue       same panel moved (DX, -DY) so its bottom edge is collinear with navy's top edge (one diagonal)
  bridge     blue fills the shoulder above navy: a horizontal edge tangent to the top of navy's TL arc,
             down to the shared diagonal — the 'handoff' that makes the two panels read as one sign
Directions: A In Sync (flat, faithful) · B Flow (colour runs from screen 1 into screen 2) · C Split (clean gap).
"""
import math
import sys
from pathlib import Path

from shapely import affinity
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from klaro_mark import _corner, d_of  # noqa: E402
from typekit import text  # noqa: E402

OUT = ROOT / "concepts" / "sync2"
OUT.mkdir(parents=True, exist_ok=True)
NAVY, BLUE, WHITE, MIST = "#0D1729", "#0669FE", "#FFFFFF", "#F3F5F9"
BLUE_DEEP, NAVY_LIFT = "#0A47C8", "#1A2C55"
SKY = "#E6EEFF"                      # navy replacement on dark backgrounds

T = math.tan(math.radians(30))
W, H, DX = 1.0, 1.12, 0.88
DY = H - DX * T
R, R2, GAP = 0.25, 0.10, 0.045


def rpoly(pts, radii):
    out = []
    n = len(pts)
    for i, p in enumerate(pts):
        r = radii[i]
        if r <= 0:
            out.append(p)
        else:
            out += _corner(pts[i - 1], p, pts[(i + 1) % n], r, 32)
    return Polygon(out).buffer(0)


def panels(gap=0.0, open_r=0.0):
    """(navy, blue) in units of W. gap > 0 lifts blue off the shared diagonal by exactly gap (split / one-colour)."""
    navy = rpoly([(0, 0), (W, T * W), (W, T * W + H), (0, H)], [R, 0, R, R2])
    nx, ny = 0.5 * gap, -math.cos(math.radians(30)) * gap          # normal of the 30° diagonal
    blue = rpoly([(DX, -DY), (DX + W, -DY + T * W), (DX + W, T * (DX + W)), (DX, T * DX)], [R, R2, R, 0])
    blue = affinity.translate(blue, nx, ny)
    y_top = 2 * R * math.cos(math.radians(30)) - R - gap          # tangent to the top of navy's TL arc (+gap)
    guard = navy.buffer(gap, 64) if gap else navy
    bridge = box(R, y_top, DX + nx + 1e-6, T * DX + 0.02).difference(guard)
    blue = unary_union([blue, bridge]).buffer(1e-7).buffer(-1e-7)
    if open_r:
        blue = blue.buffer(-open_r, 32).buffer(open_r, 32)         # drop the hair-thin tip at the arc
    return navy, blue


def place(geoms, size=204, box_=256.0, cx=None, cy=None, ref=None):
    minx, miny, maxx, maxy = unary_union(ref or geoms).bounds
    k = size / max(maxx - minx, maxy - miny)
    cx = box_ / 2 if cx is None else cx
    cy = box_ / 2 if cy is None else cy
    out = []
    for g in geoms:
        g = affinity.translate(g, -(minx + maxx) / 2, -(miny + maxy) / 2)
        g = affinity.scale(g, k, k, origin=(0, 0))
        out.append(affinity.translate(g, cx, cy))
    return out


def grad(gid, g, c0, c1):
    """Vertical gradient spanning g's own extent (top c0 -> bottom c1)."""
    _, y0, _, y1 = g.bounds
    return (f'<linearGradient id="{gid}" gradientUnits="userSpaceOnUse" x1="0" y1="{y0:.2f}" x2="0" y2="{y1:.2f}">'
            f'<stop offset="0" stop-color="{c0}"/><stop offset="1" stop-color="{c1}"/></linearGradient>')


def body(direction, navy, blue, dark=False, mono=None, uid="m", navy_s=None, blue_s=None):
    """SVG fragment (defs, paths) for one direction in its colourway."""
    if mono:
        n, b = navy_s, blue_s
        return "", f'<path fill="{mono}" d="{d_of(unary_union([n, b]))}"/>'
    n_col = SKY if dark else NAVY
    if direction == "C":
        navy, blue = navy_s, blue_s
    if direction == "B":
        defs = grad(f"{uid}b", blue, BLUE, BLUE_DEEP) + (grad(f"{uid}n", navy, NAVY_LIFT, NAVY) if not dark
                                                          else grad(f"{uid}n", navy, "#FFFFFF", "#C9D8F5"))
        return defs, (f'<path fill="url(#{uid}n)" d="{d_of(navy)}"/>'
                      f'<path fill="url(#{uid}b)" d="{d_of(blue)}"/>')
    return "", f'<path fill="{n_col}" d="{d_of(navy)}"/><path fill="{BLUE}" d="{d_of(blue)}"/>'


def svg(inner, defs="", view="0 0 256 256", w=256, h=256, bg=None, rx=0):
    back = f'<rect width="{w}" height="{h}" rx="{rx}" fill="{bg}"/>' if bg else ""
    d = f"<defs>{defs}</defs>" if defs else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="{view}">'
            f"{d}{back}{inner}</svg>")


def placed(size=204, **kw):
    """navy, blue, navy_split, blue_split — one shared transform (bounds of the unsplit mark)."""
    raw = list(panels())
    n, b, ns, bs = place(raw + list(panels(GAP, 0.022)), size=size, ref=raw, **kw)
    return n, b, dict(navy_s=ns, blue_s=bs)


def lockup(direction, dark=False):
    navy, blue, sp = placed(size=150, cx=100, cy=128)
    defs, inner = body(direction, navy, blue, dark, uid="l", **sp)
    ink = WHITE if dark else NAVY
    cap = 74
    d1, w1 = text("Klaro", "InterTight", cap=cap, x=200, base=128 + cap / 2, tracking=-1.5, wght=700)
    d2, w2 = text("Player", "InterTight", cap=cap, x=200 + w1 + 22, base=128 + cap / 2, tracking=-1.0, wght=380)
    width = int(200 + w1 + 22 + w2 + 34)
    inner += f'<path fill="{ink}" d="{d1}"/><path fill="{ink}" d="{d2}"/>'
    return svg(inner, defs, view=f"0 0 {width} 256", w=width, h=256, bg=NAVY if dark else None)


def main():
    for key in "ABC":
        k = key.lower()
        navy, blue, sp = placed()
        defs, inner = body(key, navy, blue, uid=k, **sp)
        (OUT / f"{k}-light.svg").write_text(svg(inner, defs))
        defs, inner = body(key, navy, blue, dark=True, uid=k, **sp)
        (OUT / f"{k}-dark.svg").write_text(svg(inner, defs, bg=NAVY))
        (OUT / f"{k}-lockup.svg").write_text(lockup(key))
        (OUT / f"{k}-lockup-dark.svg").write_text(lockup(key, dark=True))
        n2, b2, sp2 = placed(size=150)                      # app icon: mist tile, mark at ~59 %
        defs, inner = body(key, n2, b2, uid=k + "i", **sp2)
        (OUT / f"{k}-icon.svg").write_text(svg(inner, defs, bg=MIST, rx=57))
    navy, blue, sp = placed()
    for name, col in (("mono-navy", NAVY), ("mono-black", "#000000")):
        _, inner = body("A", navy, blue, mono=col, **sp)
        (OUT / f"{name}.svg").write_text(svg(inner))
    print("written", len(list(OUT.iterdir())))


if __name__ == "__main__":
    main()
