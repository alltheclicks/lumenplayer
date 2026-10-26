"""B 'Always in Sync' as a real 3D fold: screen 1 (top, blue) flows down, bends forward and continues as screen 2
(bottom, navy). Built in 3D and projected isometrically (30° edges, vertical sides), so the fold reads as depth.

Ribbon profile lives in the (y, z) plane and is extruded along x (screen width):
  screen 1: y = 0, z from top down to the first bend
  floor:    z = const, y from 0 to D (towards the viewer)
  screen 2: y = D, z down to the bottom
Flow colour runs along the ribbon's arc length: Blue at the top of screen 1 -> Navy at the bottom of screen 2.
Faces pointing up (+z) are lifted towards white a little: one light source, few tones.
"""
import math
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from marks import f  # noqa: E402
from typekit import text  # noqa: E402

OUT = ROOT / "concepts" / "flow3d"
OUT.mkdir(parents=True, exist_ok=True)
NAVY, BLUE, WHITE = "#0D1729", "#0669FE", "#FFFFFF"
C30, S30 = math.cos(math.radians(30)), 0.5


VIEW = {"x": (C30, S30), "y": (-C30, S30)}   # projected unit vectors; default = isometric


def set_view(x_deg=30, y_vec=None):
    """x_deg: slope of the screen width axis; y_vec: projected depth unit (towards viewer). Default isometric."""
    VIEW["x"] = (math.cos(math.radians(x_deg)), math.sin(math.radians(x_deg)))
    VIEW["y"] = y_vec or (-C30, S30)


def proj(x, y, z):
    """x -> screen width (right-down), y -> depth towards the viewer (left-down), z -> up."""
    (ax, ay), (bx, by) = VIEW["x"], VIEW["y"]
    return (x * ax + y * bx, x * ay + y * by - z)


def hexrgb(c):
    return [int(c[i:i + 2], 16) for i in (1, 3, 5)]


def mix(a, b, t):
    ca, cb = hexrgb(a), hexrgb(b)
    return "#" + "".join(f"{round(x + (y - x) * t):02X}" for x, y in zip(ca, cb))


def profile(H1, D, H2, r, n=18):
    """Ribbon centre profile [(y, z, s)] with rounded bends of radius r (r=0 -> sharp)."""
    pts = []
    zf = 0.0                                 # floor height
    if r <= 0:
        raw = [(0, H1), (0, zf), (D, zf), (D, -H2)]
    else:
        raw = [(0, H1), (0, zf + r)]
        for k in range(1, n + 1):            # concave bend: down -> forward (centre (r, zf + r))
            a = math.pi + (math.pi / 2) * k / n
            raw.append((r + r * math.cos(a), zf + r + r * math.sin(a)))
        raw.append((D - r, zf))
        for k in range(1, n + 1):            # convex bend: forward -> down (centre (D - r, zf - r))
            a = math.pi / 2 - (math.pi / 2) * k / n
            raw.append((D - r + r * math.cos(a), zf - r + r * math.sin(a)))
        raw.append((D, -H2))
    s = 0.0
    for i, (y, z) in enumerate(raw):
        if i:
            s += math.hypot(y - raw[i - 1][0], z - raw[i - 1][1])
        pts.append((y, z, s))
    return pts


def mark(W=250, H1=250, D=120, H2=250, r=40, R=34, lift=0.16, stops=None, tone="light", cue=None, fill=0.62):
    """Return (defs, body, bbox) for the ribbon, unscaled."""
    hi, lo = (BLUE, NAVY) if tone == "light" else (BLUE, "#DCE8FF")
    if tone == "mono":
        hi = lo = "#000000"
    prof = profile(H1, D, H2, r)
    L = prof[-1][2]
    col = lambda s: mix(hi, lo, min(1, max(0, s / L)))
    out, defs = [], []

    # flat part of screen 1: rounded top corners, gradient straight down (flow direction)
    y0, zt, zb = 0, H1, prof[1][1]
    s1 = rounded_screen(W, y0, zb, zt, R, top=True)
    g = f"g1{tone}"
    a, b = proj(W / 2, 0, zt), proj(W / 2, 0, zb)
    defs.append(grad(g, a, b, [(0, col(0)), (1, col(prof[1][2]))]))
    out.append(f'<path fill="url(#{g})" d="{s1}"/>')

    # bends + floor as thin strips (flat colour each; faces up are lifted towards white)
    for i in range(1, len(prof) - 2):
        (ya, za, sa), (yb, zb_, sb) = prof[i], prof[i + 1]
        nz = (yb - ya) / max(1e-9, math.hypot(yb - ya, zb_ - za))      # 1 = facing up
        c = mix(col((sa + sb) / 2), WHITE, lift * nz) if tone != "mono" else "#000"
        # extend each strip along the flow (never across the width) so it overlaps its neighbour: no AA seams
        t = ((yb - ya), (zb_ - za)); tl = math.hypot(*t) or 1; t = (t[0] / tl * 4, t[1] / tl * 4)
        ya2, za2, yb2, zb2 = ya - t[0], za - t[1], yb + t[0], zb_ + t[1]
        quad = [proj(0, ya2, za2), proj(W, ya2, za2), proj(W, yb2, zb2), proj(0, yb2, zb2)]
        out.append(f'<path fill="{c}" d="M{" L".join(f"{f(x)} {f(y)}" for x, y in quad)} Z"/>')

    # flat part of screen 2: rounded bottom corners
    zt2 = prof[-2][1]
    s2 = rounded_screen(W, D, -H2, zt2 + 0.6, R, top=False)
    g = f"g2{tone}"
    a, b = proj(W / 2, D, zt2), proj(W / 2, D, -H2)
    defs.append(grad(g, a, b, [(0, col(prof[-2][2])), (1, col(L))]))
    out.append(f'<path fill="url(#{g})" d="{s2}"/>')

    # subtle 'this is a player' cue, drawn in the plane of its screen
    if cue == "bar" and tone != "mono":
        m, th = W * 0.12, H2 * 0.075
        zb2 = -H2 + H2 * 0.2
        track, done = ("#FFFFFF", "#FFFFFF") if tone == "light" else (NAVY, BLUE)
        out.append(f'<path fill="{track}" fill-opacity="0.28" d="{xz_path(pill(m, W - m, zb2, th), D)}"/>')
        out.append(f'<path fill="{done}" d="{xz_path(pill(m, m + (W - 2 * m) * fill, zb2, th), D)}"/>')
    elif cue == "play" and tone != "mono":
        cz = (H1 + prof[1][1]) / 2 + H1 * 0.04
        h = H1 * 0.36
        tri = rtri([(W / 2 - h * 0.42, cz + h / 2), (W / 2 + h * 0.5, cz), (W / 2 - h * 0.42, cz - h / 2)], h * 0.09)
        out.append(f'<path fill="#FFFFFF" d="{xz_path(tri, 0)}"/>')

    xs = [proj(x, y, z) for x in (0, W) for y, z, _ in prof]
    bb = (min(p[0] for p in xs), min(p[1] for p in xs), max(p[0] for p in xs), max(p[1] for p in xs))
    return "".join(defs), "".join(out), bb


def pill(x0, x1, zc, th, n=10):
    """Horizontal pill in the x-z plane (rounded ends)."""
    r = th / 2
    pts = [(x1 - r + r * math.cos(a), zc + r * math.sin(a)) for a in [math.pi / 2 - math.pi * k / n for k in range(n + 1)]]
    pts += [(x0 + r + r * math.cos(a), zc + r * math.sin(a)) for a in [-math.pi / 2 - math.pi * k / n for k in range(n + 1)]]
    return pts


def rtri(P, r, n=8):
    """Triangle with rounded corners (sampled)."""
    out = []
    for i in range(3):
        p0, p1, p2 = P[i - 1], P[i], P[(i + 1) % 3]
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
        out += [(c[0] + r * math.cos(a0 + da * k / n), c[1] + r * math.sin(a0 + da * k / n)) for k in range(n + 1)]
    return out


def xz_path(pts, y):
    P = [proj(x, y, z) for x, z in pts]
    return "M" + " L".join(f"{f(a)} {f(b)}" for a, b in P) + " Z"


def grow(quad, e):
    cx = sum(p[0] for p in quad) / 4; cy = sum(p[1] for p in quad) / 4
    out = []
    for x, y in quad:
        dx, dy = x - cx, y - cy; d = math.hypot(dx, dy) or 1
        out.append((x + dx / d * e, y + dy / d * e))
    return out


def rounded_screen(W, y, zb, zt, R, top=True, n=12):
    """Screen face in the x-z plane at depth y; outer corners (top or bottom) rounded, projected."""
    pts = []
    if top:
        pts.append((0, zb))
        for k in range(n + 1):                                   # top-left corner
            a = math.pi - (math.pi / 2) * k / n
            pts.append((R + R * math.cos(a), zt - R + R * math.sin(a)))
        for k in range(n + 1):                                   # top-right corner
            a = math.pi / 2 - (math.pi / 2) * k / n
            pts.append((W - R + R * math.cos(a), zt - R + R * math.sin(a)))
        pts.append((W, zb))
    else:
        pts.append((0, zt))
        pts.append((W, zt))
        for k in range(n + 1):                                   # bottom-right corner
            a = 0 - (math.pi / 2) * k / n
            pts.append((W - R + R * math.cos(a), zb + R + R * math.sin(a)))
        for k in range(n + 1):                                   # bottom-left corner
            a = -math.pi / 2 - (math.pi / 2) * k / n
            pts.append((R + R * math.cos(a), zb + R + R * math.sin(a)))
    P = [proj(x, y, z) for x, z in pts]
    return "M" + " L".join(f"{f(x)} {f(yy)}" for x, yy in P) + " Z"


def grad(gid, a, b, stops):
    s = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
    return (f'<linearGradient id="{gid}" gradientUnits="userSpaceOnUse" x1="{f(a[0])}" y1="{f(a[1])}" '
            f'x2="{f(b[0])}" y2="{f(b[1])}">{s}</linearGradient>')


def svg_mark(params, tone="light", size=200, box=256, uid=""):
    defs, body, (x0, y0, x1, y1) = mark(tone=tone, **params)
    s = size / max(x1 - x0, y1 - y0)
    tx, ty = box / 2 - (x0 + x1) / 2 * s, box / 2 - (y0 + y1) / 2 * s
    defs = defs.replace('id="g', f'id="{uid}g')
    body = body.replace('url(#g', f'url(#{uid}g')
    return defs, f'<g transform="translate({f(tx)} {f(ty)}) scale({f(s)})">{body}</g>'


def svg(defs, body, view="0 0 256 256", w=256, h=256):
    d = f"<defs>{defs}</defs>" if defs else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{f(w)}" height="{f(h)}" viewBox="{view}">'
            f'<title>Klaro Player</title>{d}{body}</svg>')


def lockup(defs, body, dark=False):
    c = WHITE if dark else NAVY
    cap = 96
    d1, w1 = text("Klaro", "InterTight", cap, x=300, base=176, tracking=-cap * 0.025, wght=700)
    d2, w2 = text("Player", "InterTight", cap, x=300 + w1 + cap * 0.27, base=176, tracking=-cap * 0.01, wght=400)
    W = 300 + w1 + cap * 0.27 + w2 + 16
    return svg(defs, body + f'<path fill="{c}" d="{d1}"/><path fill="{c}" d="{d2}"/>', f"0 0 {f(W)} 256", W, 256)


EXPLORE = {
    "u1-round": dict(W=320, H1=180, D=100, H2=180, r=32, R=26, cue="bar"),
    "u2-sharp": dict(W=320, H1=180, D=90, H2=180, r=0, R=26, cue="bar"),
    "u3-round-lit": dict(W=320, H1=180, D=110, H2=180, r=40, R=26, cue="bar", lift=0.3),
    "u4-sharp-lit": dict(W=320, H1=180, D=80, H2=180, r=0, R=26, cue="bar", lift=0.3),
    "u5-round-small": dict(W=320, H1=180, D=80, H2=180, r=24, R=26, cue="bar", lift=0.24),
    "u6-round-nobar": dict(W=320, H1=180, D=100, H2=180, r=32, R=26, lift=0.24),
}

if __name__ == "__main__":
    which = sys.argv[1:] or list(EXPLORE)
    for k in which:
        p = EXPLORE[k]
        for tone in ("light", "dark"):
            d, b = svg_mark(p, tone, uid=f"{k[:2]}{tone[0]}")
            (OUT / f"{k}-{tone}.svg").write_text(svg(d, b))
        d, b = svg_mark(p, "light", uid=f"{k[:2]}L")
        (OUT / f"{k}-lockup.svg").write_text(lockup(d, b))
    print("ok")
