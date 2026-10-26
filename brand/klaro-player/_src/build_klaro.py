"""Klaro Player — direction presentation for the chosen mark (two panels, S counter).

Writes masters to brand/klaro-player/concepts/klaro/ and the board klaro-direction.html.
"""
import math
import sys
from pathlib import Path

from shapely import affinity

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from klaro_mark import BAND, LEAN, R, d_of, fit, mono, parts  # noqa: E402
from typekit import text  # noqa: E402

OUT = ROOT / "concepts" / "klaro"
OUT.mkdir(parents=True, exist_ok=True)
FONT = (HERE / "fonts" / "Montserrat[wght].ttf").as_uri()
NAVY, BLUE, MIST, WHITE = "#0D1729", "#0669FE", "#F3F5F9", "#FFFFFF"
TAG = "ONE SETUP. EVERY SCREEN."

NAVY_G, BLUE_G = parts()


def mark_body(size=200, c1=NAVY, c2=BLUE, box=256, one=None):
    (n, b), k = fit([NAVY_G, BLUE_G], size, box)
    if one:
        return f'<path fill="{one}" d="{d_of(mono(n, b, 0))}"/>'
    return f'<path fill="{c1}" d="{d_of(n)}"/><path fill="{c2}" d="{d_of(b)}"/>'


def svg(body, view="0 0 256 256", style="", xmlns=True):
    ns = ' xmlns="http://www.w3.org/2000/svg"' if xmlns else ""
    st = f' style="{style}"' if style else ""
    return f'<svg{ns} viewBox="{view}"{st}>{body}</svg>'


def wordmark(cap, c1, c2=None, x=0.0, base=0.0):
    c2 = c2 or c1
    d1, w1 = text("Klaro", "Montserrat", cap, x=x, base=base, tracking=-cap * 0.012, wght=700)
    gap = cap * 0.26
    d2, w2 = text("Player", "Montserrat", cap, x=x + w1 + gap, base=base, tracking=-cap * 0.01, wght=400)
    return f'<path fill="{c1}" d="{d1}"/><path fill="{c2}" d="{d2}"/>', w1 + gap + w2


def tagline(cap, c, x=0.0, base=0.0):
    d, w = text(TAG, "Montserrat", cap, x=x, base=base, tracking=cap * 0.28, wght=500)
    return f'<path fill="{c}" d="{d}"/>', w


def lockup_h(dark=False, tag=True):
    c1 = WHITE if dark else NAVY
    wm, ww = wordmark(92, c1, x=290, base=160)
    body = mark_body(230, c1=c1 if dark else NAVY, c2=BLUE) + wm
    W = 290 + ww + 10
    if tag:
        tg, tw = tagline(22, "#8B95AA" if dark else "#5B6478", x=294, base=222)
        body += tg
        W = max(W, 294 + tw + 10)
    return svg(body, f"0 0 {W:.0f} 256"), W


def lockup_stacked(dark=False):
    c1 = WHITE if dark else NAVY
    wm, ww = wordmark(64, c1)
    tg, tw = tagline(15, "#8B95AA" if dark else "#5B6478")
    W = max(ww, tw, 256) + 40
    body = (f'<g transform="translate({(W - 256) / 2:.1f} 0)">{mark_body(200, c1=c1 if dark else NAVY)}</g>'
            f'<g transform="translate({(W - ww) / 2:.1f} 300)">{wm}</g>'
            f'<g transform="translate({(W - tw) / 2:.1f} 342)">{tg}</g>')
    return svg(body, f"0 10 {W:.0f} 350"), W


def app_icon(style, px, radius=None):
    bg, c1, c2 = {"mist": (MIST, NAVY, BLUE), "navy": (NAVY, WHITE, BLUE), "blue": (BLUE, NAVY, WHITE),
                  "white": (WHITE, NAVY, BLUE)}[style]
    rr = radius if radius is not None else px * 0.2237
    return svg(f'<rect width="256" height="256" rx="57.3" fill="{bg}"/>{mark_body(150, c1, c2)}',
               style=f"width:{px}px;height:{px}px;border-radius:{rr:.1f}px")


def construction():
    """Mark with its geometry: 15° lean, band = fillet radius, outer radius R."""
    (n, b), k = fit([NAVY_G, BLUE_G], 300, 400)
    s = math.tan(math.radians(LEAN))
    minx, miny, maxx, maxy = n.union(b).bounds
    lines = ""
    for g in (n, b):
        x0, y0, x1, y1 = g.bounds
    # lean guides through the panels' straight sides
    for gx in [p for p in [minx + 30, maxx - 30]]:
        pass
    body = (f'<path fill="{NAVY}" fill-opacity=".10" d="{d_of(n)}"/><path fill="{BLUE}" fill-opacity=".14" d="{d_of(b)}"/>'
            f'<path fill="none" stroke="{NAVY}" stroke-width="1.4" d="{d_of(n)}"/><path fill="none" stroke="{BLUE}" stroke-width="1.4" d="{d_of(b)}"/>')
    # 15° guide lines across the whole mark
    for off in (-150, -60, 30, 120):
        x_top, x_bot = 200 + off + s * 200, 200 + off - s * 200
        lines += f'<line x1="{x_top:.1f}" y1="0" x2="{x_bot:.1f}" y2="400" stroke="#9AA3B5" stroke-width="1" stroke-dasharray="4 5"/>'
    return svg(lines + body + '<text x="16" y="386" font-family="Montserrat" font-size="15" fill="#5B6478">15° · pojas = poluprečnik krivine · uglovi R</text>',
               "0 0 400 400")


def pattern(w=1200, h=420, cell=230):
    """Modular pattern: big crops of the mark on a leaning grid; every other mark is turned 180°."""
    (n, b), k = fit([NAVY_G, BLUE_G], cell, cell)
    s = math.tan(math.radians(LEAN))
    out = ""
    for r in range(-1, 3):
        for c in range(-1, 7):
            dx = c * cell * 1.08 - r * cell * s * 0.5
            dy = r * cell * 0.92
            gn, gb = affinity.translate(n, dx - 40, dy - 30), affinity.translate(b, dx - 40, dy - 30)
            if (r + c) % 2:
                gn, gb = affinity.rotate(gn, 180, origin=gn.union(gb).centroid), affinity.rotate(gb, 180, origin=gn.union(gb).centroid)
            out += f'<path fill="{NAVY}" d="{d_of(gn, 1)}"/><path fill="{BLUE}" d="{d_of(gb, 1)}"/>'
    return svg(f'<defs><clipPath id="pc"><rect width="{w}" height="{h}" rx="28"/></clipPath></defs>'
               f'<rect width="{w}" height="{h}" rx="28" fill="{MIST}"/><g clip-path="url(#pc)">{out}</g>', f"0 0 {w} {h}")


def motion():
    frames = [("1. Odvojeno", "jedan nalog", 44), ("2. Spajanje", "bez prekida", 16), ("3. U sinhronizaciji", "One setup. Every screen.", 0)]
    out = ""
    for title, sub, d in frames:
        (n, b), k = fit([NAVY_G, BLUE_G], 150)
        s = math.tan(math.radians(LEAN))
        n2 = affinity.translate(n, -d * 0.6 - d * s * 0.3, -d * 0.5)
        b2 = affinity.translate(b, d * 0.6 + d * s * 0.3, d * 0.5)
        (n3, b3), _ = fit([n2, b2], 150 + d * 1.2)
        op = "1" if d == 0 else ".92"
        out += (f'<div class="frame">{svg(f"<path fill={chr(34)}{NAVY}{chr(34)} d={chr(34)}{d_of(n3)}{chr(34)} opacity={chr(34)}{op}{chr(34)}/><path fill={chr(34)}{BLUE}{chr(34)} d={chr(34)}{d_of(b3)}{chr(34)}/>", xmlns=False)}'
                f'<div class="ft">{title}</div><div class="fs">{sub}</div></div>')
        if d:
            out += '<div class="arrow">→</div>'
    return out


def small_sizes():
    return "".join(app_icon("mist", s) for s in (64, 32, 16)) + "".join(app_icon("navy", s) for s in (64, 32, 16))


def one_colour():
    return (f'<div class="oc" style="background:{WHITE}">{svg(mark_body(170, one=NAVY))}</div>'
            f'<div class="oc" style="background:{NAVY}">{svg(mark_body(170, one=WHITE))}</div>'
            f'<div class="oc" style="background:{BLUE}">{svg(mark_body(170, one=WHITE))}</div>'
            f'<div class="oc" style="background:{WHITE}">{svg(mark_body(170, one="#000"))}</div>')


def tv_banner():
    wm, ww = wordmark(56, WHITE)
    sc = min(1.0, 380 / ww)
    body = (f'<rect width="640" height="360" rx="22" fill="{NAVY}"/>'
            f'<g transform="translate(22 48)">{mark_body(140, c1=WHITE)}</g>'
            f'<g transform="translate(236 200) scale({sc:.3f})">{wm}</g>')
    return svg(body, "0 0 640 360", style="width:100%;height:auto;display:block;border-radius:14px")


# ------------------------------------------------------------------ masters
def write(name, body, view="0 0 256 256", w=256, h=256):
    (OUT / name).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}" width="{w}" height="{h}">{body}</svg>')


write("klaro-mark.svg", mark_body(220))
write("klaro-mark-white.svg", mark_body(220, c1=WHITE))
write("klaro-mark-navy-1c.svg", mark_body(220, one=NAVY))
write("klaro-mark-black-1c.svg", mark_body(220, one="#000"))
for st in ("mist", "navy", "blue"):
    (OUT / f"klaro-app-icon-{st}.svg").write_text(app_icon(st, 256).replace(' style="width:256px;height:256px;border-radius:57.3px"', ' width="256" height="256"'))
lh, lw = lockup_h()
(OUT / "klaro-lockup-horizontal.svg").write_text(lh.replace("<svg ", f'<svg width="{lw:.0f}" height="256" ', 1))
lhd, _ = lockup_h(dark=True)
(OUT / "klaro-lockup-horizontal-dark.svg").write_text(lhd.replace("<svg ", f'<svg width="{lw:.0f}" height="256" ', 1))
ls, lsw = lockup_stacked()
(OUT / "klaro-lockup-stacked.svg").write_text(ls.replace("<svg ", f'<svg width="{lsw:.0f}" height="350" ', 1))

# ------------------------------------------------------------------ board
html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: Montserrat; src: url('{FONT}'); font-weight: 100 900; }}
* {{ box-sizing: border-box; margin: 0; }}
body {{ width: 1600px; background: {WHITE}; color: {NAVY}; font-family: Montserrat, sans-serif; -webkit-font-smoothing: antialiased; padding: 56px 72px 72px; }}
.lbl {{ font-size: 13px; letter-spacing: .2em; text-transform: uppercase; color: #5B6478; font-weight: 500; margin-bottom: 22px; }}
.grid {{ display: grid; gap: 0; border-top: 1px solid #E4E8EF; }}
.cell {{ padding: 36px 32px; border-bottom: 1px solid #E4E8EF; }}
.cell + .cell {{ border-left: 1px solid #E4E8EF; }}
.r1 {{ grid-template-columns: 1.05fr 1fr; }}
.r2 {{ grid-template-columns: 1fr 1fr 1fr; }}
.r3 {{ grid-template-columns: 1.4fr 1fr; }}
.hero svg {{ width: 100%; height: 520px; display: block; }}
.hlock svg {{ width: 100%; height: auto; display: block; margin-top: 28px; }}
.hlock.dark {{ background: {NAVY}; border-radius: 18px; padding: 26px 30px; margin-top: 28px; }}
.hlock.dark svg {{ margin: 0; }}
.stack svg {{ width: 330px; height: auto; display: block; margin: 0 auto; }}
.icons {{ display: flex; gap: 22px; align-items: flex-end; flex-wrap: wrap; }}
.icons svg {{ box-shadow: 0 12px 30px rgba(13,23,41,.14), 0 0 0 1px rgba(13,23,41,.05); }}
.icons .round {{ border-radius: 50% !important; }}
.sizes {{ display: flex; gap: 16px; align-items: flex-end; margin-top: 26px; }}
.sizes svg {{ box-shadow: 0 0 0 1px rgba(13,23,41,.08); }}
.ocs {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }}
.oc {{ border-radius: 16px; aspect-ratio: 1; box-shadow: 0 0 0 1px rgba(13,23,41,.07); }}
.oc svg {{ width: 100%; height: 100%; display: block; }}
.pattern svg {{ width: 100%; height: auto; display: block; }}
.motion {{ display: flex; align-items: center; justify-content: space-between; }}
.frame {{ text-align: center; width: 250px; }}
.frame svg {{ width: 230px; height: 230px; display: block; margin: 0 auto 10px; }}
.ft {{ font-size: 15px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; }}
.fs {{ font-size: 14px; color: #5B6478; margin-top: 6px; }}
.arrow {{ font-size: 34px; color: #9AA3B5; }}
.pal {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }}
.sw {{ border-radius: 16px; height: 130px; padding: 16px; display: flex; flex-direction: column; justify-content: flex-end; font-size: 13px; font-weight: 600; box-shadow: 0 0 0 1px rgba(13,23,41,.07); }}
.sw span {{ font-weight: 400; opacity: .8; margin-top: 3px; }}
.type {{ margin-top: 26px; font-size: 44px; font-weight: 700; letter-spacing: -.01em; }}
.type b {{ font-weight: 400; }}
.type small {{ display: block; font-size: 14px; font-weight: 400; color: #5B6478; margin-top: 8px; letter-spacing: 0; }}
.tv svg {{ box-shadow: 0 16px 36px rgba(13,23,41,.2); }}
.note {{ font-size: 14px; color: #5B6478; line-height: 1.5; margin-top: 18px; }}
</style></head><body>
<div class="grid r1">
  <div class="cell hero"><div class="lbl">01 — Znak</div>{svg(mark_body(236), xmlns=False)}</div>
  <div class="cell"><div class="lbl">02 — Horizontalni lockup</div><div class="hlock">{lockup_h()[0]}</div>
     <div class="hlock dark">{lockup_h(dark=True)[0]}</div>
     <div class="lbl" style="margin-top:40px">03 — Složeni lockup</div><div class="stack">{lockup_stacked()[0]}</div></div>
</div>
<div class="grid r2">
  <div class="cell"><div class="lbl">04 — App ikona</div><div class="icons">{app_icon("mist", 132)}{app_icon("navy", 132)}{app_icon("blue", 96)}</div>
     <div class="sizes">{small_sizes()}</div><div class="note">iOS · Android (maska) · 64 / 32 / 16 px</div></div>
  <div class="cell"><div class="lbl">05 — Jedna boja</div><div class="ocs">{one_colour()}</div>
     <div class="note">U jednoj boji paneli se spajaju u jednu siluetu; S-otvor ostaje prepoznatljiv.</div></div>
  <div class="cell"><div class="lbl">06 — Konstrukcija</div><div style="width:100%">{construction().replace('<svg ', '<svg style="width:100%;height:auto;display:block" ', 1)}</div></div>
</div>
<div class="grid r3">
  <div class="cell"><div class="lbl">07 — Pattern</div><div class="pattern">{pattern()}</div></div>
  <div class="cell tv"><div class="lbl">08 — TV baner</div>{tv_banner()}</div>
</div>
<div class="grid" style="grid-template-columns:1fr">
  <div class="cell"><div class="lbl">09 — Animacija: zajedno, u sinhronizaciji</div><div class="motion">{motion()}</div></div>
</div>
<div class="grid r1">
  <div class="cell"><div class="lbl">10 — Boje</div><div class="pal">
    <div class="sw" style="background:{NAVY};color:#fff">Klaro Navy<span>{NAVY}</span></div>
    <div class="sw" style="background:{BLUE};color:#fff">Klaro Blue<span>{BLUE}</span></div>
    <div class="sw" style="background:{MIST}">Mist<span>{MIST}</span></div>
    <div class="sw" style="background:{WHITE}">White<span>{WHITE}</span></div></div></div>
  <div class="cell"><div class="lbl">11 — Font</div><div class="type">Klaro <b>Player</b><small>Montserrat Bold / Regular · SIL Open Font License (besplatan, dozvoljen u logou)</small></div></div>
</div>
</body></html>"""
(ROOT / "klaro-direction.html").write_text(html)
print("ok")
