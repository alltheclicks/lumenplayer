"""Wordmark-led round: the name IS the logo (like Netflix, Max, Prime Video, Tubi, Hulu).

Lesson from the shelf test: a blue geometric K reads as Kodi. No symbol, no K monogram built from pieces.
Tile colour 'ice' tested as the most distinctive among OTT/IPTV icons.
"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from typekit import text  # noqa: E402
from marks import f  # noqa: E402

FONT = (HERE / "fonts" / "Geist[wght].ttf").as_uri()
INK, ICE0, ICE1, BLUE, NIGHT0, NIGHT1 = "#07090F", "#EAFBFF", "#A5E9FF", "#2448E8", "#1B2F6E", "#05070D"

W = [
    ("W1", "Geist Heavy", "clean, confident, very 2026", dict(name="Geist", wght=800, track=-0.045, txt="Klaro")),
    ("W2", "Caps", "calm premium caps, open spacing", dict(name="Geist", wght=700, track=0.06, txt="KLARO")),
    ("W3", "Character", "contemporary grotesk with ink traps", dict(name="Bricolage", wght=800, opsz=96, wdth=88, track=-0.03, txt="Klaro")),
    ("W4", "Compact", "tight, narrow, strong on TV banners", dict(name="Bricolage", wght=700, opsz=96, wdth=75, track=-0.02, txt="Klaro")),
    ("W5", "Clear cut", "one thin horizontal line of light cuts the name", dict(name="Geist", wght=800, track=-0.045, txt="Klaro", cut=True)),
    ("W6", "Inter Tight", "neutral, sharp, highly legible", dict(name="InterTight", wght=800, track=-0.04, txt="Klaro")),
]


def word(spec, cap=100):
    ax = {k: v for k, v in spec.items() if k in ("wght", "opsz", "wdth")}
    d, w = text(spec["txt"], spec["name"], cap, 0, 0, tracking=cap * spec["track"], **ax)
    return d, w


def word_svg(spec, colour, cap=100, pad=0.0):
    d, w = word(spec, cap)
    top, bot = -cap * 1.02, cap * 0.02
    body = f'<path fill="{colour}" d="{d}"/>'
    if spec.get("cut"):
        # a 'line of light' through the x-height: a real gap, so it works in one colour too
        y = -cap * 0.36
        body = (f'<defs><mask id="m{abs(hash(colour)) % 9999}"><rect x="-10" y="{top - 10}" width="{w + 20}" height="{cap * 1.3}" fill="#fff"/>'
                f'<rect x="-10" y="{y - cap * 0.03}" width="{w + 20}" height="{cap * 0.06}" fill="#000"/></mask></defs>'
                f'<path fill="{colour}" d="{d}" mask="url(#m{abs(hash(colour)) % 9999})"/>')
    return f'<svg viewBox="{f(-pad)} {f(top - pad)} {f(w + 2 * pad)} {f(bot - top + 2 * pad)}">{body}</svg>', w


def icon(spec, style="ice", uid="x"):
    """App icon: the name on the tile, optically sized (~74% of the tile width)."""
    d, w = word(spec, 100)
    s = 256 * 0.74 / w
    tx = (256 - w * s) / 2
    ty = 128 + 100 * s * 0.5
    if style == "ice":
        bg = f'<linearGradient id="bg{uid}" x1="0" y1="0" x2="0" y2="256" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{ICE0}"/><stop offset="1" stop-color="{ICE1}"/></linearGradient>'
        fill = BLUE
    else:
        bg = f'<radialGradient id="bg{uid}" cx="30%" cy="18%" r="95%"><stop offset="0" stop-color="{NIGHT0}"/><stop offset="1" stop-color="{NIGHT1}"/></radialGradient>'
        fill = "#F5F8FF"
    body = f'<path fill="{fill}" transform="translate({f(tx)} {f(ty)}) scale({f(s)})" d="{d}"/>'
    if spec.get("cut"):
        y = ty - 100 * s * 0.36
        body += f'<rect x="0" y="{f(y - 100 * s * 0.03)}" width="256" height="{f(100 * s * 0.06)}" fill="url(#bg{uid})"/>'
    return (f'<svg viewBox="0 0 256 256" class="ic"><defs>{bg}</defs><rect width="256" height="256" rx="57" fill="url(#bg{uid})"/>{body}'
            f'<rect x="1" y="1" width="254" height="254" rx="56" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2"/></svg>')


def fav(spec, uid):
    """16/32 px: the first letter on the ice tile (like Netflix's N)."""
    first = {**spec, "txt": spec["txt"][0], "track": 0}
    d, w = word(first, 100)
    s = 150 / 100
    tx = (256 - w * s) / 2
    ty = 128 + 100 * s * 0.5
    return (f'<svg viewBox="0 0 256 256"><defs><linearGradient id="f{uid}" x1="0" y1="0" x2="0" y2="256" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{ICE0}"/><stop offset="1" stop-color="{ICE1}"/></linearGradient></defs>'
            f'<rect width="256" height="256" rx="57" fill="url(#f{uid})"/><path fill="{BLUE}" transform="translate({f(tx)} {f(ty)}) scale({f(s)})" d="{d}"/></svg>')


cards = ""
for key, name, note, spec in W:
    wm_dark, _ = word_svg(spec, "#F5F8FF", pad=4)
    wm_light, _ = word_svg(spec, INK, pad=4)
    fv = fav(spec, key)
    cards += f"""<div class="card"><div class="top"><span class="k">{key}</span><span class="n">{name}</span></div>
      <div class="wm">{wm_dark}</div>
      <div class="icons">{icon(spec, "ice", key + "i")}{icon(spec, "night", key + "n")}
        <div class="fv">{fv.replace('<svg ', '<svg style="width:32px;height:32px" ', 1)}{fv.replace('<svg ', '<svg style="width:16px;height:16px" ', 1)}</div></div>
      <div class="light">{wm_light}</div>
      <div class="note">{note}</div></div>"""

html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: Geist; src: url('{FONT}'); font-weight: 100 900; }}
* {{ box-sizing: border-box; margin: 0; }}
body {{ width: 1600px; background: #05070D; color: #F5F8FF; font-family: Geist, sans-serif; -webkit-font-smoothing: antialiased; padding: 64px 80px 80px;
       background-image: radial-gradient(900px 500px at 12% 0%, rgba(51,102,255,.2), transparent 60%); }}
.eyebrow {{ font-size: 14px; letter-spacing: .18em; text-transform: uppercase; color: #7F8AA3; }}
h1 {{ font-size: 46px; font-weight: 650; letter-spacing: -.035em; margin-top: 12px; }}
.sub {{ font-size: 19px; color: #AEB7C9; margin-top: 12px; }}
.grid {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 44px; }}
.card {{ background: #0B0F1A; border-radius: 28px; padding: 30px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); }}
.top {{ display: flex; gap: 10px; align-items: baseline; }}
.k {{ font-size: 20px; font-weight: 650; color: #9BE7FF; }}
.n {{ font-size: 20px; font-weight: 560; letter-spacing: -.02em; }}
.wm svg {{ height: 74px; width: auto; display: block; margin: 36px 0 34px; }}
.icons {{ display: flex; gap: 16px; align-items: flex-end; }}
.ic {{ width: 118px; height: 118px; border-radius: 26px; box-shadow: 0 16px 34px rgba(0,0,0,.45); }}
.fv {{ display: flex; gap: 10px; align-items: flex-end; margin-left: 6px; }}
.fv svg {{ border-radius: 22%; }}
.light {{ margin-top: 24px; background: #F5F8FF; border-radius: 16px; padding: 18px 22px; }}
.light svg {{ height: 36px; width: auto; display: block; }}
.note {{ font-size: 15px; color: #8C96AA; margin-top: 16px; }}
</style></head><body>
<div class="eyebrow">Klaro Player · wordmark-led</div>
<h1>The name is the logo.</h1>
<div class="sub">Like Netflix, Max, Prime Video, Tubi and Hulu — no symbol to be confused with anyone else's. App icon: the name on the “ice” tile; favicon: the first letter.</div>
<div class="grid">{cards}</div>
</body></html>"""
(ROOT / "klaro-2026-wordmarks.html").write_text(html)
print("ok")
