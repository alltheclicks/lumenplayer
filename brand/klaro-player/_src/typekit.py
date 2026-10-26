"""Outline type from OFL variable fonts (bundled in _src/fonts) into SVG path data."""
from functools import lru_cache
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

FONTS = Path(__file__).parent / "fonts"
FILES = {
    "Geist": "Geist[wght].ttf",
    "Bricolage": "BricolageGrotesque[opsz,wdth,wght].ttf",
    "InterTight": "InterTight[wght].ttf",
    "Montserrat": "Montserrat[wght].ttf",
    "Figtree": "Figtree[wght].ttf",
    "Manrope": "Manrope[wght].ttf",
    "Outfit": "Outfit[wght].ttf",
    "Sora": "Sora[wght].ttf",
    "PlusJakarta": "PlusJakartaSans[wght].ttf",
    "Onest": "Onest[wght].ttf",
}


@lru_cache(maxsize=None)
def font(name, **axes):
    vf = TTFont(FONTS / FILES[name])
    if "fvar" in vf:
        allowed = {a.axisTag for a in vf["fvar"].axes}
        return instancer.instantiateVariableFont(vf, {k: v for k, v in axes.items() if k in allowed})
    return vf


def cap_scale(f, cap):
    return cap / (f["OS/2"].sCapHeight or 700)


def text(txt, name, cap=100, x=0.0, base=0.0, tracking=0.0, kern=None, **axes):
    """Return (d, width). tracking in output units; kern: {pair: extra}."""
    f = font(name, **axes)
    gs, cmap = f.getGlyphSet(), f.getBestCmap()
    s = cap_scale(f, cap)
    ds, pen, prev = [], x, None
    for ch in txt:
        if prev and kern and (prev + ch) in kern:
            pen += kern[prev + ch]
        g = gs[cmap[ord(ch)]]
        p = SVGPathPen(gs)
        g.draw(TransformPen(p, (s, 0, 0, -s, pen, base)))
        ds.append(p.getCommands())
        pen += g.width * s + tracking
        prev = ch
    return " ".join(d for d in ds if d), pen - x - tracking


def glyph(ch, name, cap=100, x=0.0, base=0.0, skew=0.0, **axes):
    """Single glyph with optional skew (degrees, positive = lean right) around its baseline."""
    import math
    f = font(name, **axes)
    gs, cmap = f.getGlyphSet(), f.getBestCmap()
    s = cap_scale(f, cap)
    g = gs[cmap[ord(ch)]]
    k = math.tan(math.radians(skew))
    p = SVGPathPen(gs)
    g.draw(TransformPen(p, (s, 0, k * s, -s, x, base)))
    return p.getCommands(), g.width * s


def bounds(ch, name, cap=100, **axes):
    f = font(name, **axes)
    gs, cmap = f.getGlyphSet(), f.getBestCmap()
    bp = BoundsPen(gs)
    gs[cmap[ord(ch)]].draw(bp)
    s = cap_scale(f, cap)
    return tuple(v * s for v in bp.bounds)
