"""Klaro Player — 2026 round: three marks (flat masters) + shared palette.

1 Ribbon K     — one luminous ribbon folds into the K's arm and leg (LogoLounge 2026 'Roll Over').
2 Slant K      — type-led: only the K leans forward, like pressing play (LogoLounge 2026 'Slant Break').
3 Colorforms K — the K assembled from three primitives: pill, quarter-disc, play (LogoLounge 2026 'Colorforms').
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from typekit import bounds, glyph  # noqa: E402

PAL = dict(ink="#07090F", night="#0E1424", blue="#3366FF", ice="#9BE7FF", lime="#D4FF4F", white="#F5F8FF", slate="#8A94A8")


def f(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s == "-0" else s


def rpoly(pts, r):
    n = len(pts)
    rs = r if isinstance(r, (list, tuple)) else [r] * n
    out = []
    for i in range(n):
        p0, p1, p2 = pts[i - 1], pts[i], pts[(i + 1) % n]
        if rs[i] <= 0:
            out.append(("M" if i == 0 else "L") + f"{f(p1[0])} {f(p1[1])}")
            continue
        v1 = (p0[0] - p1[0], p0[1] - p1[1]); v2 = (p2[0] - p1[0], p2[1] - p1[1])
        l1, l2 = math.hypot(*v1), math.hypot(*v2)
        u1 = (v1[0] / l1, v1[1] / l1); u2 = (v2[0] / l2, v2[1] / l2)
        ang = math.acos(max(-1, min(1, u1[0] * u2[0] + u1[1] * u2[1])))
        d = min(rs[i] / math.tan(ang / 2), l1 / 2, l2 / 2)
        re = d * math.tan(ang / 2)
        a = (p1[0] + u1[0] * d, p1[1] + u1[1] * d); b = (p1[0] + u2[0] * d, p1[1] + u2[1] * d)
        cross = (p1[0] - p0[0]) * (p2[1] - p1[1]) - (p1[1] - p0[1]) * (p2[0] - p1[0])
        out.append(("M" if i == 0 else "L") + f"{f(a[0])} {f(a[1])} A{f(re)} {f(re)} 0 0 {1 if cross > 0 else 0} {f(b[0])} {f(b[1])}")
    return " ".join(out) + " Z"


def rrect(x, y, w, h, r):
    return rpoly([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], r)


# ------------------------------------------------------------------ 1 Ribbon K
def ribbon_k():
    """Returns layers: stem, arm (back), fold (back face), leg (front). 256 canvas.

    The arm and the leg are one ribbon: it runs down-left along the arm, folds at the vertex and
    continues down-right as the leg. The fold shows the ribbon's back face as a small triangle.
    """
    T = 46                                   # ribbon / stem thickness
    top, bot = 36, 220
    sx = 58                                  # stem x
    stem = rrect(sx, top, T, bot - top, 12)
    d = T / math.sqrt(2)                     # 45deg band: horizontal half-width offset
    vx = sx + T + 14 + d                     # vertex (centre line) just right of the stem
    vy = 128
    ex = vx + (vy - top) - d                 # arm/leg end x (45deg, outer edge reaches top/bottom)
    # arm: parallelogram along 45deg from vertex up-right, ends cut horizontally at `top`
    arm = [(vx - d, vy), (ex - 0, top), (ex + 2 * d, top), (vx + d, vy)]
    leg = [(vx - d, vy), (vx + d, vy), (ex + 2 * d, bot), (ex, bot)]
    # fold: the back face — triangle between the two outer edges at the vertex
    fold = [(vx - d, vy), (vx + d, vy), (vx, vy + d)]
    return dict(
        stem=stem,
        arm=rpoly(arm, [0, 8, 8, 0]),
        leg=rpoly(leg, [0, 0, 8, 8]),
        fold=rpoly(fold, 0),
    )


# ------------------------------------------------------------------ 2 Slant K
SLANT = 12


def slant_k(cap=176, weight=700):
    """Geist K leaning forward by SLANT degrees, centred on the 256 canvas."""
    x0, y0, x1, y1 = bounds("K", "Geist", cap, wght=weight)
    k = math.tan(math.radians(SLANT))
    w = (x1 - x0) + cap * k
    base = 128 + cap / 2
    x = 128 - w / 2 - x0
    d, _ = glyph("K", "Geist", cap, x=x, base=base, skew=SLANT, wght=weight)
    return d


# ------------------------------------------------------------------ 3 Colorforms K
def colorforms_k():
    top, bot, sx, T = 36, 220, 52, 48
    stem = rrect(sx, top, T, bot - top, T / 2)                   # pill
    # quarter disc: centre at (sx+T+10, 128), radius 92, occupying the upper-right quadrant
    cx, cy, R = sx + T + 12, 124, 88
    quarter = f"M{f(cx)} {f(cy)} L{f(cx)} {f(cy - R)} A{f(R)} {f(R)} 0 0 1 {f(cx + R)} {f(cy)} Z"
    # play: rounded triangle in the lower-right quadrant, left edge vertical at cx
    h = bot - (cy + 12)
    play = rpoly([(cx, cy + 12), (cx + h * 0.9, cy + 12 + h / 2), (cx, bot)], [6, 12, 6])
    return dict(stem=stem, quarter=quarter, play=play)


def svg(body, title, view="0 0 256 256", w=256, h=256, defs=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}" width="{w}" height="{h}" role="img" '
            f'aria-labelledby="t"><title id="t">{title}</title>{defs}{body}</svg>\n')


def flat(name, c=PAL["ink"], c2=None, c3=None, back=None):
    """One-colour (or brand-colour) flat master bodies."""
    if name == "ribbon":
        r = ribbon_k()
        b = back or c
        return (f'<path fill="{c}" d="{r["stem"]}"/><path fill="{c2 or c}" d="{r["arm"]}"/>'
                f'<path fill="{b}" d="{r["fold"]}"/><path fill="{c3 or c}" d="{r["leg"]}"/>')
    if name == "slant":
        return f'<path fill="{c}" d="{slant_k()}"/>'
    if name == "colorforms":
        k = colorforms_k()
        return (f'<path fill="{c}" d="{k["stem"]}"/><path fill="{c2 or c}" d="{k["quarter"]}"/>'
                f'<path fill="{c3 or c}" d="{k["play"]}"/>')
    raise KeyError(name)


if __name__ == "__main__":
    out = Path(__file__).parent.parent / "concepts"
    out.mkdir(exist_ok=True)
    P = PAL
    (out / "1-ribbon-k-mono.svg").write_text(svg(flat("ribbon", P["ink"], back="#4A5163"), "Ribbon K one colour"))
    (out / "1-ribbon-k-colour.svg").write_text(svg(flat("ribbon", P["blue"], P["blue"], P["ice"], back="#1C3A99"), "Ribbon K colour"))
    (out / "2-slant-k-mono.svg").write_text(svg(flat("slant", P["ink"]), "Slant K one colour"))
    (out / "3-colorforms-k-mono.svg").write_text(svg(flat("colorforms", P["ink"]), "Colorforms K one colour"))
    (out / "3-colorforms-k-colour.svg").write_text(svg(flat("colorforms", P["blue"], P["ice"], P["lime"]), "Colorforms K colour"))
    print("ok")


# ------------------------------------------------------------------ geometry helpers for Cut Play
def clip_convex(subject, clip):
    def inside(p, a, b, sign):
        return sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >= -1e-9

    def inter(p1, p2, a, b):
        x1, y1 = p1; x2, y2 = p2; x3, y3 = a; x4, y4 = b
        den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
        t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
        return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))

    area = sum(clip[i][0] * clip[(i + 1) % len(clip)][1] - clip[(i + 1) % len(clip)][0] * clip[i][1] for i in range(len(clip)))
    sign = 1 if area > 0 else -1
    out = list(subject)
    for i in range(len(clip)):
        a, b = clip[i], clip[(i + 1) % len(clip)]
        inp, out = out, []
        if not inp:
            break
        s = inp[-1]
        for e in inp:
            if inside(e, a, b, sign):
                if not inside(s, a, b, sign):
                    out.append(inter(s, e, a, b))
                out.append(e)
            elif inside(s, a, b, sign):
                out.append(inter(s, e, a, b))
            s = e
    return out


def halfplane(p, direction, keep, size=2000):
    """Big convex polygon: side of the line (p, direction) that contains `keep`."""
    L = math.hypot(*direction)
    u = (direction[0] / L, direction[1] / L)
    n = (-u[1], u[0])
    if (keep[0] - p[0]) * n[0] + (keep[1] - p[1]) * n[1] < 0:
        n = (-n[0], -n[1])
    a = (p[0] - u[0] * size, p[1] - u[1] * size)
    b = (p[0] + u[0] * size, p[1] + u[1] * size)
    return [a, b, (b[0] + n[0] * size, b[1] + n[1] * size), (a[0] + n[0] * size, a[1] + n[1] * size)]


def rounded_triangle_pts(pts, r, seg=14):
    """Convex triangle with rounded corners, sampled as points (so it can be clipped)."""
    out = []
    n = len(pts)
    for i in range(n):
        p0, p1, p2 = pts[i - 1], pts[i], pts[(i + 1) % n]
        v1 = (p0[0] - p1[0], p0[1] - p1[1]); v2 = (p2[0] - p1[0], p2[1] - p1[1])
        l1, l2 = math.hypot(*v1), math.hypot(*v2)
        u1 = (v1[0] / l1, v1[1] / l1); u2 = (v2[0] / l2, v2[1] / l2)
        ang = math.acos(u1[0] * u2[0] + u1[1] * u2[1])
        d = r / math.tan(ang / 2)
        bis = (u1[0] + u2[0], u1[1] + u2[1]); bl = math.hypot(*bis); bis = (bis[0] / bl, bis[1] / bl)
        c = (p1[0] + bis[0] * r / math.sin(ang / 2), p1[1] + bis[1] * r / math.sin(ang / 2))
        a = (p1[0] + u1[0] * d, p1[1] + u1[1] * d); b = (p1[0] + u2[0] * d, p1[1] + u2[1] * d)
        a0 = math.atan2(a[1] - c[1], a[0] - c[0]); a1 = math.atan2(b[1] - c[1], b[0] - c[0])
        da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
        for k in range(seg + 1):
            t = a0 + da * k / seg
            out.append((c[0] + r * math.cos(t), c[1] + r * math.sin(t)))
    return out


def poly(pts):
    return "M" + " L".join(f"{f(x)} {f(y)}" for x, y in pts) + " Z"


def cut_play(gap=9.0, stem_ratio=0.27, r=20):
    """A play triangle cut into pieces by a K: vertical cut + two 45deg cuts from the stem junction.

    Returns dict of piece polygons (point lists): stem, upper, lower, head.
    """
    H = 196
    W = H * math.sqrt(3) / 2
    # optical centre: a right-pointing triangle is centred on ~42% of its width
    x0 = 128 - W * 0.42
    tri = [(x0, 128 - H / 2), (x0 + W, 128), (x0, 128 + H / 2)]
    body = rounded_triangle_pts(tri, r)
    xs = x0 + W * stem_ratio                       # the stem cut (vertical)
    g = gap / 2
    left = clip_convex(body, halfplane((xs - g, 0), (0, 1), (0, 128)))
    right = clip_convex(body, halfplane((xs + g, 0), (0, 1), (256, 128)))
    j = (xs + g, 128)                              # K junction on the stem's right edge
    off = g * math.sqrt(2)                         # perpendicular gap -> offset along x for 45deg lines
    up_dir, dn_dir = (1, -1), (1, 1)
    upper = clip_convex(right, halfplane((j[0] - off, j[1]), up_dir, (j[0], 0)))
    lower = clip_convex(right, halfplane((j[0] - off, j[1]), dn_dir, (j[0], 256)))
    head = clip_convex(right, halfplane((j[0] + off, j[1]), up_dir, (256, 128)))
    head = clip_convex(head, halfplane((j[0] + off, j[1]), dn_dir, (256, 128)))
    return dict(stem=left, upper=upper, lower=lower, head=head)
