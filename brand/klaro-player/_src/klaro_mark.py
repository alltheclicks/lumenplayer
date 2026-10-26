"""Klaro Player mark — two leaning panels joined by an S-shaped counter (from references/board-10).

Construction (unsheared units, then a 15° forward lean):
  panel      L-shape, width W, height H; the lower-right part is cut away below the ledge at y = LEDGE
  counter    band between the two inner lines, width BAND; its ends are fillets with radius = BAND
  blue       = navy panel rotated 180° about the mark centre; the two panels share a short edge JOIN
  corners    outer corners radius R; the join corners stay sharp
"""
import math

from shapely import affinity
from shapely.geometry import Polygon

W, H, BAND, LEDGE, JOIN, R = 270.0, 336.0, 92.0, 112.0, 12.0, 48.0
LEAN = 15.0
A, B = W - BAND, W                                  # inner line x (navy) / outer right edge x (navy)
SEG = 24


def _corner(p0, p1, p2, r, seg=SEG):
    v1 = (p0[0] - p1[0], p0[1] - p1[1]); v2 = (p2[0] - p1[0], p2[1] - p1[1])
    l1, l2 = math.hypot(*v1), math.hypot(*v2)
    u1 = (v1[0] / l1, v1[1] / l1); u2 = (v2[0] / l2, v2[1] / l2)
    ang = math.acos(max(-1, min(1, u1[0] * u2[0] + u1[1] * u2[1])))
    d = r / math.tan(ang / 2)
    bis = (u1[0] + u2[0], u1[1] + u2[1]); bl = math.hypot(*bis); bis = (bis[0] / bl, bis[1] / bl)
    c = (p1[0] + bis[0] * r / math.sin(ang / 2), p1[1] + bis[1] * r / math.sin(ang / 2))
    a = (p1[0] + u1[0] * d, p1[1] + u1[1] * d); b = (p1[0] + u2[0] * d, p1[1] + u2[1] * d)
    a0 = math.atan2(a[1] - c[1], a[0] - c[0]); a1 = math.atan2(b[1] - c[1], b[0] - c[0])
    da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
    return [(c[0] + r * math.cos(a0 + da * k / seg), c[1] + r * math.sin(a0 + da * k / seg)) for k in range(seg + 1)]


def navy_panel(r=R, band=BAND, ledge=LEDGE):
    a = W - band
    pts = []
    pts += _corner((0, H), (0, 0), (W, 0), r)                   # top-left
    pts += _corner((0, 0), (W, 0), (W, ledge), r)               # top-right
    pts.append((W, ledge))                                      # join corner (sharp)
    cx, cy = W, ledge + band                                    # fillet: concave quarter circle, radius = band
    for k in range(1, SEG * 2 + 1):
        t = -math.pi / 2 - (math.pi / 2) * k / (SEG * 2)
        pts.append((cx + band * math.cos(t), cy + band * math.sin(t)))
    pts.append((a, H))                                          # join corner (sharp)
    pts += _corner((a, H), (0, H), (0, 0), r)                   # bottom-left
    return Polygon(pts)


def parts(lean=LEAN, **kw):
    """Return (navy, blue) shapely polygons, leaned forward, in raw units."""
    band = kw.get("band", BAND)
    navy = navy_panel(kw.get("r", R), band, kw.get("ledge", LEDGE))
    cx = (W - band + W) / 2                                     # rotation centre: blue = navy turned 180°
    cy = (H + kw.get("ledge", LEDGE) - kw.get("join", JOIN)) / 2
    blue = affinity.rotate(navy, 180, origin=(cx, cy))
    s = math.tan(math.radians(lean))
    shear = lambda g: affinity.affine_transform(g, [1, -s, 0, 1, s * cy, 0])   # x' = x - s*(y - cy)
    return shear(navy), shear(blue)


def fit(geoms, size, box=256.0):
    from shapely.ops import unary_union
    minx, miny, maxx, maxy = unary_union(geoms).bounds
    k = size / max(maxx - minx, maxy - miny)
    out = []
    for g in geoms:
        g = affinity.translate(g, -(minx + maxx) / 2, -(miny + maxy) / 2)
        g = affinity.scale(g, k, k, origin=(0, 0))
        out.append(affinity.translate(g, box / 2, box / 2))
    return out, k


def d_of(g, nd=2):
    polys = getattr(g, "geoms", [g])
    out = []
    for p in polys:
        for ring in [p.exterior, *p.interiors]:
            pts = list(ring.coords)[:-1]
            out.append("M" + " L".join(f"{round(x, nd):g} {round(y, nd):g}" for x, y in pts) + " Z")
    return " ".join(out)


def mono(navy, blue, gap):
    """One-colour version: a thin cut separates the panels along their shared edges."""
    return navy.union(blue.difference(navy.buffer(gap, 8)))
