"""Klaro Player 'In Sync' mark — master geometry with true SVG arcs.

Construction (unit = projected panel width W = 1):
  panel   parallelogram with vertical sides and 30° top/bottom edges (a screen seen in isometric view)
  navy    apex TL at (0, 0); acute corners (TL, BR) radius R, obtuse BL radius R2, TR sharp (it sits on the join)
  blue    the same panel moved (DX, -DY) with DY = H - DX*tan30, so blue's bottom edge and navy's top edge are ONE line
  bridge  blue fills navy's shoulder: a horizontal edge tangent to the top of navy's TL arc, down to the shared line
  split   (one-colour) blue lifts off the shared line by GAP along its normal; the bridge edge drops by GAP and
          ends in a sharp 30° tip on the lifted line
Everything is expressed as lines + circular arcs, so the SVG has ~20 anchors per part.
"""
import math
from dataclasses import dataclass, replace

from shapely.geometry import Polygon
from shapely.ops import unary_union

S30, C30, T30 = 0.5, math.cos(math.radians(30)), math.tan(math.radians(30))


@dataclass(frozen=True)
class Spec:
    W: float = 1.0
    H: float = 1.12      # vertical side of a panel
    DX: float = 0.88     # blue panel's horizontal offset
    R: float = 0.25      # acute (60°) corners
    R2: float = 0.10     # obtuse (120°) corner
    GAP: float = 0.045   # split width (one-colour)

    @property
    def DY(self):
        return self.H - self.DX * T30


A = Spec()
# TV spin: the panels become true 16:9 screens in isometric view (slant length L = W / cos30, height = L * 9/16)
TV = Spec(H=round(1 / C30 * 9 / 16, 4), DX=0.50, R=0.15, R2=0.06, GAP=0.04)


# ------------------------------------------------------------------ path primitives
class Path:
    def __init__(self, k=1.0, ox=0.0, oy=0.0):
        self.k, self.ox, self.oy, self.cmd, self.pts = k, ox, oy, [], []
        self.nd = 2 if k >= 20 else 6                    # px output: 2 decimals; unit-space sampling: 6

    def _p(self, p):
        return (p[0] * self.k + self.ox, p[1] * self.k + self.oy)

    def M(self, p):
        x, y = self._p(p); self.cmd.append(f"M{self._f(x)} {self._f(y)}"); self.pts.append(p); return self

    def L(self, p):
        x, y = self._p(p); self.cmd.append(f"L{self._f(x)} {self._f(y)}"); self.pts.append(p); return self

    def A(self, r, p, sweep):
        x, y = self._p(p); rr = r * self.k
        self.cmd.append(f"A{self._f(rr)} {self._f(rr)} 0 0 {sweep} {self._f(x)} {self._f(y)}"); self.pts.append(p); return self

    def Z(self):
        self.cmd.append("Z"); return self

    def _f(self, v):
        return f"{round(v, self.nd):g}"

    def d(self):
        return " ".join(self.cmd)


def corner(p0, p1, p2, r):
    """Tangent points (a on p0-p1, b on p1-p2) and sweep flag for a fillet of radius r at p1."""
    v1 = (p0[0] - p1[0], p0[1] - p1[1]); v2 = (p2[0] - p1[0], p2[1] - p1[1])
    l1, l2 = math.hypot(*v1), math.hypot(*v2)
    u1 = (v1[0] / l1, v1[1] / l1); u2 = (v2[0] / l2, v2[1] / l2)
    ang = math.acos(max(-1, min(1, u1[0] * u2[0] + u1[1] * u2[1])))
    d = r / math.tan(ang / 2)
    a = (p1[0] + u1[0] * d, p1[1] + u1[1] * d); b = (p1[0] + u2[0] * d, p1[1] + u2[1] * d)
    cross = (p1[0] - p0[0]) * (p2[1] - p1[1]) - (p1[1] - p0[1]) * (p2[0] - p1[0])
    return a, b, 1 if cross > 0 else 0


# ------------------------------------------------------------------ the two parts
def navy_path(s: Spec, P: Path):
    pts = [(0, 0), (s.W, T30 * s.W), (s.W, T30 * s.W + s.H), (0, s.H)]
    radii = [s.R, 0, s.R, s.R2]
    first = True
    for i, p in enumerate(pts):
        prev, nxt = pts[i - 1], pts[(i + 1) % 4]
        if radii[i]:
            a, b, sw = corner(prev, p, nxt, radii[i])
            (P.M(a) if first else P.L(a)).A(radii[i], b, sw)
        else:
            (P.M(p) if first else P.L(p))
        first = False
    return P.Z()


def blue_path(s: Spec, P: Path, gap=0.0):
    nx, ny = S30 * gap, -C30 * gap                       # normal of the 30° line, pointing up-right
    o = lambda p: (p[0] + nx, p[1] + ny)
    tl, tr = o((s.DX, -s.DY)), o((s.DX + s.W, -s.DY + T30 * s.W))
    br, bl = o((s.DX + s.W, T30 * (s.DX + s.W))), o((s.DX, T30 * s.DX))
    cx, cy, rr = s.R, 2 * s.R * C30, s.R + gap           # navy's TL arc centre, bridge radius
    y_top = cy - rr                                      # bridge edge: tangent to the (offset) arc top
    a, b, sw = corner(bl, tl, tr, s.R)
    P.M(a).A(s.R, b, sw)
    a, b, sw = corner(tl, tr, br, s.R2)
    P.L(a).A(s.R2, b, sw)
    a, b, sw = corner(tr, br, bl, s.R)
    P.L(a).A(s.R, b, sw)
    if gap:
        # split: the bridge ends in a sharp 30° tip where the lifted shared line meets the bridge edge
        P.L(((y_top + gap / C30) / T30, y_top))
    else:
        # flush: follow navy's TL arc from the shared line up to its top, so the bridge edge is tangent to it
        P.L((cx + rr * S30, cy - rr * C30)).A(rr, (cx, y_top), 0)
    P.L((bl[0], y_top))
    return P.Z()


# ------------------------------------------------------------------ polygons (bounds, tests, booleans)
def _sample(s: Spec, fn, **kw):
    P = Path()
    fn(s, P, **kw)
    pts, cur = [], None
    for c in P.cmd:
        if c == "Z":
            continue
        op, rest = c[0], c[1:].split()
        vals = list(map(float, rest))
        if op in "ML":
            cur = (vals[0], vals[1]); pts.append(cur)
        else:
            r, sw, end = vals[0], int(vals[4]), (vals[5], vals[6])
            pts += _arc(cur, end, r, sw); cur = end
    return Polygon(pts).buffer(0)


def _arc(p0, p1, r, sweep, n=24):
    mx, my = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    q = math.hypot(dx, dy)
    h = math.sqrt(max(r * r - (q / 2) ** 2, 0))
    ux, uy = -dy / q, dx / q
    sgn = 1 if sweep else -1                             # small arc, centre on the sweep side
    c = (mx + sgn * ux * h, my + sgn * uy * h)
    a0 = math.atan2(p0[1] - c[1], p0[0] - c[0]); a1 = math.atan2(p1[1] - c[1], p1[0] - c[0])
    da = a1 - a0
    if sweep and da < 0: da += 2 * math.pi
    if not sweep and da > 0: da -= 2 * math.pi
    return [(c[0] + r * math.cos(a0 + da * i / n), c[1] + r * math.sin(a0 + da * i / n)) for i in range(1, n + 1)]


def polys(s: Spec = A, split=False):
    return _sample(s, navy_path), _sample(s, blue_path, gap=s.GAP if split else 0.0)


def bounds(s: Spec = A):
    return unary_union(polys(s)).bounds


def fit(s: Spec, size, cx, cy, by="max"):
    """Path factory placing the mark (bounds of the unsplit mark) with max dimension (or height) = size at (cx, cy)."""
    x0, y0, x1, y1 = bounds(s)
    k = size / (max(x1 - x0, y1 - y0) if by == "max" else (y1 - y0))
    return lambda: Path(k, cx - (x0 + x1) / 2 * k, cy - (y0 + y1) / 2 * k), k, ((x1 - x0) * k, (y1 - y0) * k)


def mark_d(s: Spec, factory, split=False):
    return navy_path(s, factory()).d(), blue_path(s, factory(), gap=s.GAP if split else 0.0).d()


def with_(s, **kw):
    return replace(s, **kw)
