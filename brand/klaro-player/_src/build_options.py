"""Klaro Player — new signs (no play, no TV), same 2026 language as the Cut Play presentation.

A Open Axis K — four pills radiate from ONE point (your setup) and together write K (LogoLounge 2026 'Open Axis').
B Cut Arch    — an arch (a doorway, a stable flat base) cut into a K, like the Cut Play principle.
C Facet K     — a K made of crystal facets that catch the light differently ('klaro' = crystal clear).
"""
import math
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from marks import PAL, clip_convex, f, halfplane, poly  # noqa: E402
from build_presentation import FONT, TILE_R, glass_icon, wordmark_geist  # noqa: E402

P = PAL
OUT = ROOT / "concepts"


def pill(p, q, r):
    """Capsule from p to q with radius r (round caps)."""
    dx, dy = q[0] - p[0], q[1] - p[1]
    L = math.hypot(dx, dy)
    n = (-dy / L * r, dx / L * r)
    a = (p[0] + n[0], p[1] + n[1]); b = (q[0] + n[0], q[1] + n[1])
    c = (q[0] - n[0], q[1] - n[1]); d = (p[0] - n[0], p[1] - n[1])
    return (f"M{f(a[0])} {f(a[1])} L{f(b[0])} {f(b[1])} A{f(r)} {f(r)} 0 0 0 {f(c[0])} {f(c[1])} "
            f"L{f(d[0])} {f(d[1])} A{f(r)} {f(r)} 0 0 0 {f(a[0])} {f(a[1])} Z")


# ------------------------------------------------------------------ A Open Axis K
def open_axis(r=15, gap=38, top=40, bot=216, dot=True):
    cy = (top + bot) / 2
    reach = cy - top - r                       # vertical spoke length (cap to cap centre)
    diag = reach * math.sqrt(2)                # 45deg spokes end at the same height as the stem
    width = r + reach + r * 0.72               # left edge of stem .. right tip of the diagonals
    cx = 128 - width / 2 + r
    c = (cx, cy)
    u = 1 / math.sqrt(2)
    spokes = [
        pill((cx, cy - gap), (cx, top + r), r),
        pill((cx, cy + gap), (cx, bot - r), r),
        pill((cx + gap * u, cy - gap * u), (cx + reach, cy - reach), r),
        pill((cx + gap * u, cy + gap * u), (cx + reach, cy + reach), r),
    ]
    if dot:
        dr = r * 0.8
        spokes.append(f"M{f(cx - dr)} {f(cy)} A{f(dr)} {f(dr)} 0 1 0 {f(cx + dr)} {f(cy)} A{f(dr)} {f(dr)} 0 1 0 {f(cx - dr)} {f(cy)} Z")
    return spokes


# ------------------------------------------------------------------ B Cut Arch
def arch_pts(x0, y0, w, h, r_bottom=18, seg=40):
    """Arch: semicircle top + straight sides + rounded bottom corners (convex, sampled)."""
    R = w / 2
    cx = x0 + R
    pts = []
    for k in range(seg + 1):                   # top semicircle from left to right
        t = math.pi + math.pi * k / seg
        pts.append((cx + R * math.cos(t), y0 + R + R * math.sin(t)))
    yb = y0 + h
    for k in range(seg // 4 + 1):              # bottom-right corner
        t = 0 + (math.pi / 2) * k / (seg // 4)
        pts.append((x0 + w - r_bottom + r_bottom * math.cos(t), yb - r_bottom + r_bottom * math.sin(t)))
    for k in range(seg // 4 + 1):              # bottom-left corner
        t = math.pi / 2 + (math.pi / 2) * k / (seg // 4)
        pts.append((x0 + r_bottom + r_bottom * math.cos(t), yb - r_bottom + r_bottom * math.sin(t)))
    return pts


def cut_arch(gap=12, stem_ratio=0.30):
    w, h = 176, 196
    x0, y0 = 128 - w / 2, 128 - h / 2
    body = arch_pts(x0, y0, w, h)
    xs = x0 + w * stem_ratio
    g = gap / 2
    jy = y0 + h * 0.56                          # junction a little below centre: stable, K-like
    left = clip_convex(body, halfplane((xs - g, 0), (0, 1), (0, 128)))
    right = clip_convex(body, halfplane((xs + g, 0), (0, 1), (256, 128)))
    j = (xs + g, jy)
    off = g * math.sqrt(2)
    upper = clip_convex(right, halfplane((j[0] - off, j[1]), (1, -1), (j[0], 0)))
    lower = clip_convex(right, halfplane((j[0] - off, j[1]), (1, 1), (j[0], 256)))
    head = clip_convex(right, halfplane((j[0] + off, j[1]), (1, -1), (256, jy)))
    head = clip_convex(head, halfplane((j[0] + off, j[1]), (1, 1), (256, jy)))
    return [poly(p) for p in (left, upper, lower, head) if len(p) > 2]


# ------------------------------------------------------------------ C Cut Slant
SLANT = 15


def rounded_poly_pts(pts, r, seg=10):
    """Convex polygon with rounded corners, sampled as points (clippable)."""
    out = []
    n = len(pts)
    for i in range(n):
        p0, p1, p2 = pts[i - 1], pts[i], pts[(i + 1) % n]
        v1 = (p0[0] - p1[0], p0[1] - p1[1]); v2 = (p2[0] - p1[0], p2[1] - p1[1])
        l1, l2 = math.hypot(*v1), math.hypot(*v2)
        u1 = (v1[0] / l1, v1[1] / l1); u2 = (v2[0] / l2, v2[1] / l2)
        ang = math.acos(max(-1, min(1, u1[0] * u2[0] + u1[1] * u2[1])))
        bis = (u1[0] + u2[0], u1[1] + u2[1]); bl = math.hypot(*bis); bis = (bis[0] / bl, bis[1] / bl)
        c = (p1[0] + bis[0] * r / math.sin(ang / 2), p1[1] + bis[1] * r / math.sin(ang / 2))
        d = r / math.tan(ang / 2)
        a = (p1[0] + u1[0] * d, p1[1] + u1[1] * d); b = (p1[0] + u2[0] * d, p1[1] + u2[1] * d)
        a0 = math.atan2(a[1] - c[1], a[0] - c[0]); a1 = math.atan2(b[1] - c[1], b[0] - c[0])
        da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
        for k in range(seg + 1):
            t = a0 + da * k / seg
            out.append((c[0] + r * math.cos(t), c[1] + r * math.sin(t)))
    return out


def cut_slant(gap=12, stem_ratio=0.30):
    """A block leaning forward (15deg) — cut into a K. The stem cut follows the slant."""
    top, bot, w = 36, 220, 150
    k = math.tan(math.radians(SLANT))
    H = bot - top
    x0 = 128 - (w + H * k) / 2
    pts = [(x0 + H * k, top), (x0 + H * k + w, top), (x0 + w, bot), (x0, bot)]
    body = rounded_poly_pts(pts, 16)
    g = gap / 2
    sdir = (k * H, -H)                               # slant direction (bottom -> top)
    xs_b = x0 + w * stem_ratio                       # stem cut at the baseline
    left = clip_convex(body, halfplane((xs_b - g, bot), sdir, (0, 128)))
    right = clip_convex(body, halfplane((xs_b + g, bot), sdir, (256, 128)))
    jy = 132
    jx = xs_b + g + (bot - jy) * k                   # junction on the slanted stem edge
    off = g * math.sqrt(2)
    upper = clip_convex(right, halfplane((jx - off, jy), (1, -1), (jx, 0)))
    lower = clip_convex(right, halfplane((jx - off, jy), (1, 1), (jx, 256)))
    head = clip_convex(right, halfplane((jx + off, jy), (1, -1), (256, jy)))
    head = clip_convex(head, halfplane((jx + off, jy), (1, 1), (256, jy)))
    return [poly(p) for p in (left, upper, lower, head) if len(p) > 2]


def mono_svg(paths, c):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">'
            + "".join(f'<path fill="{c}" d="{d}"/>' for d in paths) + "</svg>")


def lockup_svg(paths):
    wm, ww = wordmark_geist(300, 168, 80, P["white"], "#9AA4B8")
    body = "".join(f'<path fill="{P["white"]}" d="{d}"/>' for d in paths)
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(300 + ww + 30)} 256">{body}{wm}</svg>'


OPTS = [
    ("A", "Open Axis K", "Four strokes leave one point — your setup — and reach every screen. Together they write K.", open_axis()),
    ("B", "Cut Arch", "A doorway with a flat, stable base, cut into a K. Step through: everything is already there.", cut_arch()),
    ("C", "Cut Slant", "A block leaning forward, cut into a K — always moving on, right where you left off.", cut_slant()),
]

for key, name, _, paths in OPTS:
    slug = name.lower().replace(" ", "-")
    (OUT / f"{slug}-mono.svg").write_text(mono_svg(paths, P["ink"]).replace("<svg ", '<svg width="256" height="256" ', 1))
    (OUT / f"{slug}-icon-glass-dark.svg").write_text(glass_icon(f"o{key}", paths))

cards = ""
for key, name, idea, paths in OPTS:
    g = glass_icon(f"x{key}", paths).replace('width="256" height="256"', 'class="hero"', 1)
    small_g = lambda s: glass_icon(f"s{key}{s}", paths).replace('width="256" height="256"', f'style="width:{s}px;height:{s}px;border-radius:{s * .22:.0f}px"', 1)
    m = mono_svg(paths, P["ink"])
    cards += f"""
    <div class="card">
      <div class="k">{key}</div>
      {g}
      <div class="name">{name}</div>
      <p>{idea}</p>
      <div class="lock">{lockup_svg(paths)}</div>
      <div class="light">
        {m.replace('<svg ', '<svg style="width:84px;height:84px" ', 1)}
        {m.replace('<svg ', '<svg style="width:32px;height:32px" ', 1)}
        {m.replace('<svg ', '<svg style="width:16px;height:16px" ', 1)}
        <span class="sp"></span>{small_g(64)}{small_g(32)}{small_g(16)}
      </div>
    </div>"""

html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: Geist; src: url('{FONT}'); font-weight: 100 900; }}
* {{ box-sizing: border-box; margin: 0; }}
body {{ width: 1700px; background: #05070D; color: #F5F8FF; font-family: Geist, sans-serif; -webkit-font-smoothing: antialiased; padding: 80px 90px 90px;
       background-image: radial-gradient(900px 500px at 15% 0%, rgba(51,102,255,.22), transparent 60%); }}
.eyebrow {{ font-size: 14px; letter-spacing: .18em; text-transform: uppercase; color: #7F8AA3; }}
h1 {{ font-size: 56px; font-weight: 650; letter-spacing: -.035em; margin-top: 16px; }}
.sub {{ font-size: 20px; color: #AEB7C9; margin-top: 14px; }}
.grid {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 56px; }}
.card {{ background: #0B0F1A; border-radius: 32px; padding: 40px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); position: relative; }}
.k {{ position: absolute; top: 28px; right: 34px; font-size: 22px; color: #56627A; font-weight: 600; }}
.hero {{ width: 300px; height: 300px; border-radius: 66px; display: block; margin: 10px auto 36px; box-shadow: 0 40px 80px rgba(0,0,0,.55); }}
.name {{ font-size: 30px; font-weight: 620; letter-spacing: -.03em; }}
.card p {{ color: #9AA4B8; font-size: 17px; line-height: 1.5; margin-top: 10px; min-height: 78px; }}
.lock svg {{ height: 58px; width: auto; margin-top: 26px; }}
.light {{ margin-top: 30px; background: #F5F8FF; border-radius: 20px; padding: 22px; display: flex; align-items: center; gap: 22px; }}
.sp {{ flex: 1; }}
</style></head><body>
<div class="eyebrow">Klaro Player · new signs · no play, no TV</div>
<h1>Three signs in the same 2026 language.</h1>
<div class="sub">Pick one — it gets the full presentation, glass icon layers, motion and the complete kit.</div>
<div class="grid">{cards}</div>
</body></html>"""
(ROOT / "klaro-2026-signs.html").write_text(html)
print("ok")
