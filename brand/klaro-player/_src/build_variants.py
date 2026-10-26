"""Sub-variants of the two chosen signs: B Cut Arch and C Cut Slant (same 2026 language)."""
import math
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from marks import PAL, clip_convex, f, halfplane, poly  # noqa: E402
from build_presentation import FONT, glass_icon, wordmark_geist  # noqa: E402
from build_options import arch_pts, rounded_poly_pts  # noqa: E402

P = PAL
OUT = ROOT / "concepts" / "variants"
OUT.mkdir(parents=True, exist_ok=True)


def k_cut(body, stem_p, stem_dir, jy, gap=12, up_deg=45, dn_deg=45, head_shift=(0, 0)):
    """Cut a convex body into a K: stem cut along (stem_p, stem_dir), arm/leg cuts from the junction at jy.

    Angles are measured from the horizontal. Returns list of point lists.
    """
    g = gap / 2
    L = math.hypot(*stem_dir)
    n = (stem_dir[1] / L, -stem_dir[0] / L)            # normal pointing to the right of the stem line
    if n[0] < 0:
        n = (-n[0], -n[1])
    sl = (stem_p[0] - n[0] * g, stem_p[1] - n[1] * g)
    sr = (stem_p[0] + n[0] * g, stem_p[1] + n[1] * g)
    left = clip_convex(body, halfplane(sl, stem_dir, (-500, 128)))
    right = clip_convex(body, halfplane(sr, stem_dir, (756, 128)))
    # junction on the stem's right edge at height jy
    t = (jy - sr[1]) / stem_dir[1]
    jx = sr[0] + stem_dir[0] * t
    up = (math.cos(math.radians(up_deg)), -math.sin(math.radians(up_deg)))
    dn = (math.cos(math.radians(dn_deg)), math.sin(math.radians(dn_deg)))

    def shifted(p, d, s):                               # move line point perpendicular by s
        nn = (-d[1], d[0])
        return (p[0] + nn[0] * s, p[1] + nn[1] * s)

    j = (jx, jy)
    # the normal of `up` points down-right (towards the head), the normal of `dn` points down-left
    upper = clip_convex(right, halfplane(shifted(j, up, -g), up, (jx, -500)))
    lower = clip_convex(right, halfplane(shifted(j, dn, g), dn, (jx, 756)))
    head = clip_convex(right, halfplane(shifted(j, up, g), up, (756, jy)))
    head = clip_convex(head, halfplane(shifted(j, dn, -g), dn, (756, jy)))
    head = [(x + head_shift[0], y + head_shift[1]) for x, y in head]
    return [p for p in (left, upper, lower, head) if len(p) > 2]


def centred(parts):
    xs = [x for p in parts for x, _ in p]; ys = [y for p in parts for _, y in p]
    dx = 128 - (min(xs) + max(xs)) / 2; dy = 128 - (min(ys) + max(ys)) / 2
    return [poly([(x + dx, y + dy) for x, y in p]) for p in parts]


# ------------------------------------------------------------------ B · Cut Arch variants
def arch(w=176, h=196, rb=18, stem=0.30, jy=0.56, gap=12, up=45, dn=45, shift=(0, 0)):
    x0, y0 = 128 - w / 2, 128 - h / 2
    body = arch_pts(x0, y0, w, h, rb)
    xs = x0 + w * stem
    return centred(k_cut(body, (xs, 128), (0, -1), y0 + h * jy, gap, up, dn, shift))


B = [
    ("B1", "Original", "reference", arch()),
    ("B2", "Tall", "portrait proportions — like a phone", arch(w=156, h=204, stem=0.32)),
    ("B3", "Wide & calm", "wider, softer base", arch(w=200, h=188, rb=30, stem=0.28, jy=0.58)),
    ("B4", "Open door", "the K's head steps out of the arch — motion", arch(shift=(16, 0))),
    ("B5", "Fine cut", "thinner cuts, higher junction — refined", arch(gap=8, jy=0.52)),
    ("B6", "Steep K", "arms at 60°, narrower stem — more letter", arch(stem=0.27, up=60, dn=55, jy=0.55)),
]


# ------------------------------------------------------------------ C · Cut Slant variants
def slant(w=150, slant=15, r=16, stem=0.30, jy=132, gap=12, up=45, dn=45, shift=(0, 0), top=36, bot=220):
    k = math.tan(math.radians(slant))
    H = bot - top
    x0 = 128 - (w + H * k) / 2
    pts = [(x0 + H * k, top), (x0 + H * k + w, top), (x0 + w, bot), (x0, bot)]
    body = rounded_poly_pts(pts, r)
    xs_b = x0 + w * stem
    return centred(k_cut(body, (xs_b, bot), (k * H, -H), jy, gap, up, dn, shift))


C = [
    ("C1", "Original", "reference", slant()),
    ("C2", "Soft", "bigger corner radius — friendlier", slant(r=34)),
    ("C3", "Narrow", "a tall italic block", slant(w=124, stem=0.34)),
    ("C4", "Bold", "a wider, heavier block", slant(w=176, stem=0.27)),
    ("C5", "Forward step", "the K's head steps forward along the slant", slant(shift=(14, -4))),
    ("C6", "Sharp K", "arms at 60°/45° — dynamic, still stable", slant(up=60, dn=45, jy=128)),
]


def mono(paths, c):
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">' + "".join(f'<path fill="{c}" d="{d}"/>' for d in paths) + "</svg>"


def card(key, name, note, paths):
    (OUT / f"{key.lower()}-{name.lower().replace(' & ', '-').replace(' ', '-')}.svg").write_text(
        mono(paths, P["ink"]).replace("<svg ", '<svg width="256" height="256" ', 1))
    g = glass_icon(f"v{key}", paths).replace('width="256" height="256"', 'class="g"', 1)
    m = mono(paths, P["ink"])
    sm = lambda s: m.replace("<svg ", f'<svg style="width:{s}px;height:{s}px" ', 1)
    gs = lambda s: glass_icon(f"v{key}{s}", paths).replace('width="256" height="256"', f'style="width:{s}px;height:{s}px;border-radius:{s * .22:.0f}px"', 1)
    return f"""<div class="card"><div class="top"><span class="k">{key}</span><span class="n">{name}</span></div>
      {g}<div class="note">{note}</div>
      <div class="light">{sm(64)}{sm(32)}{sm(16)}<span class="sp"></span>{gs(64)}{gs(32)}{gs(16)}</div></div>"""


def row(title, items):
    return f'<h2>{title}</h2><div class="grid">' + "".join(card(*it) for it in items) + "</div>"


html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: Geist; src: url('{FONT}'); font-weight: 100 900; }}
* {{ box-sizing: border-box; margin: 0; }}
body {{ width: 1500px; background: #05070D; color: #F5F8FF; font-family: Geist, sans-serif; -webkit-font-smoothing: antialiased; padding: 72px 80px 80px;
       background-image: radial-gradient(900px 500px at 12% 0%, rgba(51,102,255,.22), transparent 60%); }}
.eyebrow {{ font-size: 14px; letter-spacing: .18em; text-transform: uppercase; color: #7F8AA3; }}
h1 {{ font-size: 50px; font-weight: 650; letter-spacing: -.035em; margin-top: 14px; }}
h2 {{ font-size: 28px; font-weight: 620; letter-spacing: -.03em; margin: 56px 0 22px; }}
.grid {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }}
.card {{ background: #0B0F1A; border-radius: 28px; padding: 30px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); }}
.top {{ display: flex; gap: 10px; align-items: baseline; }}
.k {{ font-size: 22px; font-weight: 650; color: #9BE7FF; }}
.n {{ font-size: 22px; font-weight: 560; letter-spacing: -.02em; }}
.g {{ width: 300px; height: 300px; border-radius: 66px; display: block; margin: 22px auto 18px; box-shadow: 0 24px 48px rgba(0,0,0,.5); }}
.note {{ font-size: 15px; color: #8C96AA; line-height: 1.4; min-height: 38px; }}
.light {{ margin-top: 14px; background: #F5F8FF; border-radius: 14px; padding: 12px; display: flex; align-items: center; gap: 10px; }}
.sp {{ flex: 1; }}
</style></head><body>
<div class="eyebrow">Klaro Player · sub-variants</div>
<h1>B · Cut Arch and C · Cut Slant — six takes each.</h1>
{row("B · Cut Arch", B)}
{row("C · Cut Slant", C)}
</body></html>"""
(ROOT / "klaro-2026-variants.html").write_text(html)
print("ok")
