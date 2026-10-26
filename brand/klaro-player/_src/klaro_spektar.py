"""Klaro Player — approved mark (1d 'Spektar' + P1), 30 Sep 2026.

A clear-glass pill K; six spectrum hues orbit it as a soft aura (8 s per turn, 4 s breathing).
This module builds SVG fragments; build_kit_spektar.py composes the delivery files.

Construction (K height h):
  K       three round-capped strokes, weight 0.32·(K width); arm leaves the stem axis at 0.70 of the height, leg leaves
          the arm at 0.353 of its length, so arm and leg run at exactly 45° (kglass_geom.pill_k)
  aura    six copies of the K, dilated by 0.031h, each offset 0.127h from the centre at 60° steps (hue order R Y G C B M,
          red on the stem side), blurred 0.058h (inner) and 0.139h (outer, 50 % opacity)
  PLAYER  Inter Tight 620, caps, tracking 0.42 cap; cap = 0.135h; baseline 0.95h below the K's top when stacked in the icon
"""
import math
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from kglass_geom import pill_k, placed  # noqa: E402
from typekit import text  # noqa: E402

NIGHT, NIGHT_TOP, NAVY, MIST, WHITE, BLACK = "#03060D", "#121D36", "#0D1729", "#F3F5F9", "#FFFFFF", "#000000"
HUES = [("Red", "#FF2D55"), ("Amber", "#FFC23D"), ("Green", "#1FE0A0"), ("Cyan", "#2FD3FF"), ("Blue", "#0A6CFF"),
        ("Violet", "#B14DFF")]
FONT = "InterTight"

KSHAPE = pill_k(join=0.70, split=0.353)   # arm and leg at exactly 45° (perpendicular)


def k_path(height, cx, cy):
    """Placed K (height in px) -> (path d, bounds). Arcs are flattened; simplify keeps it light."""
    g = placed(KSHAPE, height, cx, cy).simplify(0.18 * height / 520)
    pts = list(g.exterior.coords)[:-1]
    d = "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in pts) + " Z"
    return d, g.bounds


def blur(fid, sd):
    return (f'<filter id="{fid}" filterUnits="userSpaceOnUse" x="-4000" y="-4000" width="12000" height="12000">'
            f'<feGaussianBlur stdDeviation="{sd:.1f}"/></filter>')


def aura(kd, h, p="a", phase=0.0, blend="screen", op=1.0, live=False):
    """Spectrum aura around a K of height h. Returns (defs, body)."""
    k = h / 520
    rad, sw, sd = 66 * k, 16 * k, 30 * k
    copies = []
    for i, (_, c) in enumerate(HUES):
        a = math.radians(180 + i * 60 + phase)
        anim = ""
        if live:
            pts = ";".join(f"{rad * math.cos(a + j * math.pi / 6):.1f} {rad * math.sin(a + j * math.pi / 6):.1f}" for j in range(13))
            anim = f'<animateTransform attributeName="transform" type="translate" values="{pts}" dur="8s" repeatCount="indefinite"/>'
        copies.append(f'<path class="hue" data-i="{i}" data-rad="{rad:.2f}" d="{kd}" fill="{c}" stroke="{c}" stroke-width="{sw:.1f}" stroke-linejoin="round" '
                      f'transform="translate({rad * math.cos(a):.1f} {rad * math.sin(a):.1f})">{anim}</path>')
    inner = "".join(copies)
    breathe = (f'<animate attributeName="opacity" values="{op * .40:.2f};{op * .62:.2f};{op * .40:.2f}" dur="4s" '
               f'repeatCount="indefinite"/>' if live else "")
    defs = blur(f"{p}i", sd) + blur(f"{p}o", sd * 2.4)
    body = (f'<g class="breathe" data-op="{op:.2f}" style="mix-blend-mode:{blend}" opacity="{op * .5:.2f}" filter="url(#{p}o)">{inner}{breathe}</g>'
            f'<g style="mix-blend-mode:{blend}" opacity="{op:.2f}" filter="url(#{p}i)">{inner}</g>')
    return defs, body


def glass(kd, bb, p="g", shadow=.45):
    """Clear-glass K: near-opaque white frost, top sheen, bright rim, soft drop shadow."""
    x0, y0, x1, y1 = bb
    h = y1 - y0
    defs = (f'<clipPath id="{p}c"><path d="{kd}"/></clipPath>'
            f'<linearGradient id="{p}f" x1="0" y1="{y0:.1f}" x2="0" y2="{y1:.1f}" gradientUnits="userSpaceOnUse">'
            '<stop offset="0" stop-color="#FFFFFF" stop-opacity=".99"/><stop offset="1" stop-color="#EAF0FF" stop-opacity=".96"/></linearGradient>'
            f'<linearGradient id="{p}s" x1="0" y1="{y0:.1f}" x2="0" y2="{(y0 + y1) / 2:.1f}" gradientUnits="userSpaceOnUse">'
            '<stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>'
            f'<linearGradient id="{p}r" x1="{x0:.1f}" y1="{y0:.1f}" x2="{x1:.1f}" y2="{y1:.1f}" gradientUnits="userSpaceOnUse">'
            '<stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#fff" stop-opacity=".35"/>'
            '<stop offset="1" stop-color="#fff" stop-opacity=".8"/></linearGradient>'
            + blur(f"{p}b", h * .058))
    body = (f'<path d="{kd}" fill="#000" opacity="{shadow}" filter="url(#{p}b)" transform="translate(0 {h * .042:.1f})"/>'
            f'<g clip-path="url(#{p}c)"><rect x="{x0 - 10:.1f}" y="{y0 - 10:.1f}" width="{x1 - x0 + 20:.1f}" height="{h + 20:.1f}" fill="url(#{p}f)"/>'
            f'<rect x="{x0 - 10:.1f}" y="{y0 - 10:.1f}" width="{x1 - x0 + 20:.1f}" height="{h / 2 + 10:.1f}" fill="url(#{p}s)" opacity=".55"/></g>'
            f'<path d="{kd}" fill="none" stroke="url(#{p}r)" stroke-width="{h * .0096:.1f}" clip-path="url(#{p}c)"/>')
    return defs, body


def mark(h, cx, cy, on="dark", p="m", phase=0.0, live=False):
    """The symbol: K + aura. on='dark' -> white glass K, screen-blended aura; on='light' -> Navy K, normal aura."""
    kd, bb = k_path(h, cx, cy)
    if on == "dark":
        ad, ab = aura(kd, h, p + "a", phase, "screen", 1.0, live)
        gd, gb = glass(kd, bb, p + "g")
        return ad + gd, f'<g class="aura">{ab}</g><g class="k">{gb}</g>'
    ad, ab = aura(kd, h, p + "a", phase, "normal", .72, live)
    return ad, f'<g class="aura">{ab}</g><g class="k"><path d="{kd}" fill="{NAVY}"/></g>'


def flat(h, cx, cy, colour):
    kd, _ = k_path(h, cx, cy)
    return f'<path d="{kd}" fill="{colour}"/>'


def player(cx, base, cap, ink, opacity=.94):
    kw = dict(cap=cap, tracking=cap * 0.42, wght=620)
    _, w = text("PLAYER", FONT, x=0, base=0, **kw)
    d, _ = text("PLAYER", FONT, x=cx - w / 2, base=base, **kw)
    return f'<path fill="{ink}" fill-opacity="{opacity}" d="{d}"/>', w


def name(x, base, cap, ink):
    """'Klaro' Bold + 'Player' Regular as outlines -> (svg, width)."""
    d1, w1 = text("Klaro", FONT, cap=cap, x=x, base=base, tracking=-0.02 * cap, wght=700)
    sp = 0.30 * cap
    d2, w2 = text("Player", FONT, cap=cap, x=x + w1 + sp, base=base, tracking=-0.012 * cap, wght=400)
    return f'<path fill="{ink}" d="{d1} {d2}"/>', w1 + sp + w2


def tile(w, h, p="t", tone="dark", rx=0):
    if tone == "dark":
        g = (f'<radialGradient id="{p}" cx=".3" cy=".15" r="1.1"><stop offset="0" stop-color="{NIGHT_TOP}"/>'
             f'<stop offset="1" stop-color="{NIGHT}"/></radialGradient>')
    else:
        g = (f'<radialGradient id="{p}" cx=".3" cy=".15" r="1.1"><stop offset="0" stop-color="#F7F9FD"/>'
             f'<stop offset="1" stop-color="#DFE6F1"/></radialGradient>')
    return g, f'<rect width="{w}" height="{h}" rx="{rx}" fill="url(#{p})"/>'


def svg(w, h, defs, body, title="Klaro Player"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w:g}" height="{h:g}" viewBox="0 0 {w:g} {h:g}">'
            f'<title>{title}</title><defs>{defs}</defs>{body}</svg>\n')


# ------------------------------------------------------------------ app icon compositions (1024 space)
def icon(tone="dark", text=True, rx=0, phase=0.0, live=False, size=1024):
    """App icon. text=True: K + PLAYER (≥ 120 px); text=False: K only (small cut, ≤ 64 px, favicon)."""
    s = size / 1024
    td, tb = tile(size, size, "t", tone, rx)
    if text:
        md, mb = mark(430 * s, 512 * s, 430 * s, "dark" if tone == "dark" else "light", "m", phase, live)
        pb, _ = player(512 * s, 838 * s, 58 * s, WHITE if tone == "dark" else NAVY)
    else:
        md, mb = mark(520 * s, 512 * s, 512 * s, "dark" if tone == "dark" else "light", "m", phase, live)
        pb = ""
    return svg(size, size, td + md, tb + mb + pb)
