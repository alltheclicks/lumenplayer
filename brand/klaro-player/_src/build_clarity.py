"""'Klaro' = clarity / clear / light. Spin on the approved two-panel mark (U5: two identical screens, K arm between).

C1 Prozirnost — the panels overlap like two sheets of clear glass; the overlap (the K arm) is the clearest, lightest tone.
               In one colour the overlap becomes a gap (= U5), so print and screen tell the same story.
C2 Svetlo     — the white K arm is a line of light between two screens; on dark it glows.
C3 Staklo     — app icon as two glass panes (iOS 26 Liquid Glass); where they overlap it is clearest.
"""
import math
import sys
from pathlib import Path

from shapely import affinity
from shapely.geometry import Polygon, box

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from klaro_mark import d_of, fit  # noqa: E402
from marks import halfplane  # noqa: E402
from typekit import text  # noqa: E402

OUT = ROOT / "concepts" / "klaro-clarity"
OUT.mkdir(parents=True, exist_ok=True)
NAVY, BLUE, CLEAR, MIST, WHITE = "#0D1729", "#0669FE", "#8FD8FF", "#F3F5F9", "#FFFFFF"
FONT = "InterTight"
S, R = 300.0, 60.0
ANG = math.atan((1490 - 833) / (966 - 430))                   # Inter Tight Bold K arm: 50.8°
G = 0.196 * S                                                 # arm stroke = 0.196 × cap (cap = panel height)


def soft(g, r):
    return g.buffer(-r, 16, join_style=1).buffer(r, 16, join_style=1)


def panels(overlap):
    """overlap=True: panels reach across the band (their intersection is the band); False: the band is a gap."""
    w = 150.0
    h = w * math.tan(ANG)
    ox, oy = S - w, S - h
    u = (math.cos(ANG), -math.sin(ANG))
    n = (-u[1], u[0])
    sgn = 1 if overlap else -1
    p0 = (ox + sgn * n[0] * G / 2, S + sgn * n[1] * G / 2)
    navy = box(0, 0, S, S).intersection(Polygon(halfplane(p0, u, (0, 0), size=2000)))
    navy = soft(navy, 12).intersection(soft(box(0, 0, S, S), R))
    blue = affinity.rotate(navy, 180, origin=((ox + S) / 2, (oy + S) / 2))
    return navy, blue


def layers(overlap=True, size=200, box_=256):
    n, b = panels(overlap)
    (n, b), _ = fit([n, b], size, box_)
    return n, b, n.intersection(b)


def flat(size=200, c1=NAVY, c2=BLUE, c3=CLEAR, overlap=True):
    n, b, o = layers(overlap, size)
    out = f'<path fill="{c1}" d="{d_of(n)}"/><path fill="{c2}" d="{d_of(b)}"/>'
    if overlap and not o.is_empty:
        out += f'<path fill="{c3}" d="{d_of(o)}"/>'
    return out


def light(size=200, dark=True, uid="l"):
    """C2: gap version; on dark the band carries a soft glow (light between two screens)."""
    n, b, _ = layers(False, size)
    band = layers(True, size)[2]
    c1 = WHITE if dark else NAVY
    glow = (f'<defs><filter id="gw{uid}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="{size * .05:.1f}"/></filter></defs>'
            f'<path fill="#9FE3FF" opacity="{.85 if dark else .55}" filter="url(#gw{uid})" d="{d_of(band)}"/>')
    return glow + f'<path fill="{c1}" d="{d_of(n)}"/><path fill="{BLUE}" d="{d_of(b)}"/>'


def glass(size=160, uid="g", dark=True):
    """C3: two glass panes; the overlap is the clearest (brightest) part."""
    n, b, o = layers(True, size)
    if dark:
        p1, p2, po, rim = "#6C8CFF", "#1E78FF", "#E8FAFF", ".55"
    else:
        p1, p2, po, rim = "#1B2A4F", "#0669FE", "#BDEBFF", ".7"
    return (f'<defs><linearGradient id="gn{uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{p1}" stop-opacity=".95"/><stop offset="1" stop-color="{p1}" stop-opacity=".7"/></linearGradient>'
            f'<linearGradient id="gb{uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{p2}" stop-opacity=".95"/><stop offset="1" stop-color="{p2}" stop-opacity=".78"/></linearGradient>'
            f'<filter id="gs{uid}" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="#000" flood-opacity=".35"/></filter>'
            f'<filter id="gg{uid}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="10"/></filter></defs>'
            f'<g filter="url(#gs{uid})"><path fill="url(#gn{uid})" d="{d_of(n)}"/><path fill="url(#gb{uid})" d="{d_of(b)}"/></g>'
            f'<path fill="{po}" opacity=".9" filter="url(#gg{uid})" d="{d_of(o)}"/><path fill="{po}" d="{d_of(o)}"/>'
            f'<path fill="none" stroke="#fff" stroke-opacity="{rim}" stroke-width="1.5" d="{d_of(n)}"/>'
            f'<path fill="none" stroke="#fff" stroke-opacity="{rim}" stroke-width="1.5" d="{d_of(b)}"/>')


def s(inner, view="0 0 256 256", style=""):
    st = f' style="{style}"' if style else ""
    return f'<svg viewBox="{view}"{st}>{inner}</svg>'


def tile(inner, bg, px):
    if bg.startswith("grad-dark"):
        bgd = ('<defs><radialGradient id="td" cx="30%" cy="15%" r="95%"><stop offset="0" stop-color="#1D2E5E"/><stop offset="1" stop-color="#070B16"/></radialGradient></defs>'
               '<rect width="256" height="256" fill="url(#td)"/>')
    elif bg.startswith("grad-light"):
        bgd = ('<defs><linearGradient id="tl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#E3EAF5"/></linearGradient></defs>'
               '<rect width="256" height="256" fill="url(#tl)"/>')
    else:
        bgd = f'<rect width="256" height="256" fill="{bg}"/>'
    return s(bgd + inner, style=f"width:{px}px;height:{px}px;border-radius:{px * .2237:.1f}px")


def wordmark(cap, c=NAVY):
    d1, a = text("Klaro", FONT, cap, x=0, base=0, tracking=-cap * 0.02, wght=700)
    d2, b = text("Player", FONT, cap, x=a + cap * 0.24, base=0, tracking=-cap * 0.012, wght=400)
    return f'<path fill="{c}" d="{d1}"/><path fill="{c}" d="{d2}"/>', a + cap * 0.24 + b


def lockup(mark, dark=False):
    wm, w = wordmark(88, WHITE if dark else NAVY)
    return s(f'{mark}<g transform="translate(262 160)">{wm}</g>', f"0 0 {262 + w + 16:.0f} 256")


C = [
    ("C1", "Prozirnost", "Paneli su kao dva lista čistog stakla: gde se preklope, najbistrije je, a taj presek je krak slova K. U jednoj boji presek postaje beli rez, pa je to ista priča.",
     s(flat(210)), [tile(flat(150), MIST, 96), tile(flat(150, c1=WHITE, c3="#9FE3FF"), NAVY, 96)],
     [tile(flat(150), MIST, 32), tile(flat(150, c1=WHITE, c3="#9FE3FF"), NAVY, 32), tile(flat(150), MIST, 16), tile(flat(150, c1=WHITE, c3="#9FE3FF"), NAVY, 16)],
     lockup(flat(200)), lockup(flat(200, c1=WHITE, c3="#9FE3FF"), True)),
    ("C2", "Svetlo", "Beli krak K je linija svetla između dva ekrana. Na tamnoj podlozi zasvetli: jasno, i u mraku.",
     s(light(210, False, "a")), [tile(light(150, False, "b"), MIST, 96), tile(light(150, True, "c"), NAVY, 96)],
     [tile(light(150, False, "d"), MIST, 32), tile(light(150, True, "e"), NAVY, 32), tile(light(150, False, "f"), MIST, 16), tile(light(150, True, "g"), NAVY, 16)],
     lockup(light(200, False, "h")), lockup(light(200, True, "i"), True)),
    ("C3", "Staklo", "App ikona kao dva staklena panela (iOS 26 Liquid Glass). Tamo gde se preklapaju, sve je najbistrije. Ravna verzija za štampu je C1.",
     s(tile(glass(170, "a"), "grad-dark", 0).replace('style="width:0px;height:0px;border-radius:0.0px"', 'style="width:100%;height:auto;clip-path:inset(0 round 22%)"')),
     [tile(glass(150, "b", False), "grad-light", 96), tile(glass(150, "c"), "grad-dark", 96)],
     [tile(glass(150, "d", False), "grad-light", 32), tile(glass(150, "e"), "grad-dark", 32), tile(glass(150, "f", False), "grad-light", 16), tile(glass(150, "g"), "grad-dark", 16)],
     lockup(flat(200)), lockup(glass(200, "h"), True)),
]

for key, name, *_ in C:
    pass
(OUT / "c1-flat.svg").write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">{flat(220)}</svg>')
(OUT / "c1-one-colour.svg").write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">{flat(220, c1=NAVY, c2=NAVY, overlap=False)}</svg>')

cards = ""
for key, name, note, big, icons, small, lk, lkd in C:
    cards += f"""<div class="card"><div class="top"><span class="k">{key}</span><span class="n">{name}</span></div>
      <div class="hero"><div class="bigm">{big}</div><div class="side"><div class="ic">{''.join(icons)}</div><div class="sm">{''.join(small)}</div></div></div>
      <div class="lk">{lk}</div><div class="lk dark">{lkd}</div>
      <div class="note">{note}</div></div>"""

one = (f'<div class="oc">{s(flat(170, c1=NAVY, c2=NAVY, overlap=False))}</div>'
       f'<div class="oc" style="background:{NAVY}">{s(flat(170, c1=WHITE, c2=WHITE, overlap=False))}</div>'
       f'<div class="oc">{s(flat(170))}</div>'
       f'<div class="oc" style="background:{NAVY}">{s(flat(170, c1=WHITE, c3="#9FE3FF"))}</div>')

html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: Inter Tight; src: url('{(HERE / "fonts" / "InterTight[wght].ttf").as_uri()}'); font-weight: 100 900; }}
* {{ box-sizing: border-box; margin: 0; }}
body {{ width: 1600px; background: {WHITE}; color: {NAVY}; font-family: 'Inter Tight', sans-serif; -webkit-font-smoothing: antialiased; padding: 56px 72px 64px; }}
.lbl {{ font-size: 13px; letter-spacing: .2em; text-transform: uppercase; color: #5B6478; font-weight: 500; }}
h1 {{ font-size: 40px; font-weight: 700; letter-spacing: -.025em; margin: 10px 0 14px; }}
.words {{ display: flex; gap: 10px; flex-wrap: wrap; }}
.w {{ font-size: 15px; padding: 8px 14px; border-radius: 999px; background: {MIST}; }}
.w b {{ color: {BLUE}; }}
.grid {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 30px; }}
.card {{ border: 1px solid #E4E8EF; border-radius: 22px; padding: 24px; }}
.top {{ display: flex; gap: 10px; align-items: baseline; }}
.k {{ font-size: 18px; font-weight: 700; color: {BLUE}; }}
.n {{ font-size: 18px; font-weight: 600; }}
.hero {{ display: grid; grid-template-columns: 1fr 104px; gap: 14px; margin-top: 10px; align-items: start; }}
.bigm svg {{ width: 100%; height: auto; display: block; }}
.side {{ display: flex; flex-direction: column; gap: 10px; }}
.ic {{ display: flex; flex-direction: column; gap: 10px; }}
.ic svg {{ box-shadow: 0 10px 24px rgba(13,23,41,.16), 0 0 0 1px rgba(13,23,41,.05); }}
.sm {{ display: flex; gap: 6px; align-items: flex-end; flex-wrap: wrap; }}
.sm svg {{ box-shadow: 0 0 0 1px rgba(13,23,41,.08); }}
.lk {{ margin-top: 16px; border: 1px solid #E4E8EF; border-radius: 14px; padding: 16px 20px; }}
.lk svg {{ height: 50px; width: auto; display: block; }}
.lk.dark {{ background: {NAVY}; border: 0; margin-top: 10px; }}
.note {{ font-size: 14.5px; color: #5B6478; margin-top: 16px; line-height: 1.5; }}
.ocs {{ display: grid; grid-template-columns: repeat(4, 180px); gap: 14px; margin-top: 16px; }}
.oc {{ border-radius: 18px; box-shadow: 0 0 0 1px rgba(13,23,41,.08); }}
.oc svg {{ width: 100%; height: auto; display: block; }}
</style></head><body>
<div class="lbl">Klaro Player · šta znači „klaro“</div>
<h1>Klaro = jasno, bistro, svetlo. Tamo gde se ekrani spoje, sve postaje jasno.</h1>
<div class="words"><span class="w"><b>claro</b> (es/pt) jasno, svetlo</span><span class="w"><b>chiaro</b> (it) bistro</span><span class="w"><b>klar</b> (de/skand.) čisto, jasno</span><span class="w"><b>clarus</b> (lat.) sjajan</span><span class="w"><b>„klaro!“</b> naravno, kapiram</span></div>
<div class="grid">{cards}</div>
<div class="lbl" style="margin-top:36px">Sistem: jedna boja = rez, ekran = bistar presek (C1)</div>
<div class="ocs">{one}</div>
</body></html>"""
(ROOT / "klaro-clarity.html").write_text(html)
print("ok")
