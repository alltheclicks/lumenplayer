"""C3 'Staklo' — symmetry fix + a gentle spin.

Symmetry: the geometry was already exactly 180° symmetric (checked: symmetric difference 0), but the icon looked
lopsided because of a downward drop shadow, a top-to-bottom gradient on each pane and a sharp 90° corner at each
end of the clear band. Fix: centred shadow, light that falls symmetrically from the centre, band ends rounded equally.

Spins (all keep the same mark):
G1 Svetlo iznutra — the clear overlap is the light source; both panes glow from the centre outward
G2 Zrak           — a soft beam of light runs through both panes along the K arm: clarity passing through every screen
G3 Dubina         — the blue pane floats in front: the navy pane is seen through it, Liquid Glass rims catch the light
"""
import sys
from pathlib import Path

from shapely import affinity

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import io, contextlib  # noqa: E402
with contextlib.redirect_stdout(io.StringIO()):
    from build_clarity import ANG, G, NAVY, BLUE, WHITE, MIST, fit, panels, soft, wordmark  # noqa: E402
from klaro_mark import d_of  # noqa: E402
import math  # noqa: E402

OUT = ROOT / "concepts" / "klaro-glass"
OUT.mkdir(parents=True, exist_ok=True)


def geo(size):
    n, b = panels(True)
    (n, b), k = fit([n, b], size)
    band = soft(n.intersection(b), G * k * 0.22)          # both ends of the clear band rounded the same way
    return n, b, band, k


def bg(uid, dark=True):
    if dark:
        return (f'<radialGradient id="bg{uid}" cx="50%" cy="42%" r="75%"><stop offset="0" stop-color="#1A2A57"/><stop offset="1" stop-color="#060A14"/></radialGradient>',
                f'<rect width="256" height="256" fill="url(#bg{uid})"/>')
    return (f'<radialGradient id="bg{uid}" cx="50%" cy="42%" r="80%"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#E2E9F4"/></radialGradient>',
            f'<rect width="256" height="256" fill="url(#bg{uid})"/>')


def icon(kind, uid, dark=True, size=160):
    n, b, band, k = geo(size)
    c = band.centroid
    dn, db, dband = d_of(n), d_of(b), d_of(band)
    p1, p2 = ("#4F6BE8", "#1673FF") if dark else ("#1B2A4F", "#0669FE")
    core = "#F2FCFF" if dark else "#CFF1FF"
    bgdef, bgrect = bg(uid, dark)
    defs = [bgdef,
            f'<filter id="sh{uid}" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="9"/></filter>',
            f'<filter id="gl{uid}" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="{7 if dark else 5}"/></filter>',
            f'<clipPath id="cn{uid}"><path d="{dn}"/></clipPath><clipPath id="cb{uid}"><path d="{db}"/></clipPath>',
            # light that falls from the centre (the band) outward — identical for both panes, so the icon reads symmetric
            f'<radialGradient id="lt{uid}" cx="{c.x:.1f}" cy="{c.y:.1f}" r="{size * .62:.1f}" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="#FFFFFF" stop-opacity="{.55 if kind == "G1" else .22}"/><stop offset=".55" stop-color="#FFFFFF" stop-opacity="{.12 if kind == "G1" else .05}"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>',
            f'<linearGradient id="rim{uid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".85"/><stop offset=".45" stop-color="#FFFFFF" stop-opacity=".12"/><stop offset="1" stop-color="#FFFFFF" stop-opacity=".45"/></linearGradient>']
    shadow = f'<g filter="url(#sh{uid})" opacity="{.45 if dark else .18}" fill="#000"><path d="{dn}"/><path d="{db}"/></g>'  # centred: no offset
    panes = f'<path fill="{p1}" fill-opacity="{.92 if kind != "G3" else .95}" d="{dn}"/>'
    if kind == "G3":
        # the blue pane is in front and see-through: the navy pane shows through where they overlap
        panes += f'<path fill="{p2}" fill-opacity=".78" d="{db}"/>'
    else:
        panes += f'<path fill="{p2}" d="{db}"/>'
    light = (f'<rect width="256" height="256" fill="url(#lt{uid})" clip-path="url(#cn{uid})"/>'
             f'<rect width="256" height="256" fill="url(#lt{uid})" clip-path="url(#cb{uid})"/>')
    beam = ""
    if kind == "G2":
        u = (math.cos(ANG), -math.sin(ANG))
        L, w = 190, G * k * .9
        nx, ny = -u[1], u[0]
        pts = [(c.x - u[0] * L - nx * w / 2, c.y - u[1] * L - ny * w / 2), (c.x + u[0] * L - nx * w / 2, c.y + u[1] * L - ny * w / 2),
               (c.x + u[0] * L + nx * w / 2, c.y + u[1] * L + ny * w / 2), (c.x - u[0] * L + nx * w / 2, c.y - u[1] * L + ny * w / 2)]
        d = "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in pts) + " Z"
        defs.append(f'<linearGradient id="bm{uid}" gradientUnits="userSpaceOnUse" x1="{pts[0][0]:.1f}" y1="{pts[0][1]:.1f}" x2="{pts[1][0]:.1f}" y2="{pts[1][1]:.1f}">'
                    f'<stop offset="0" stop-color="#9FE3FF" stop-opacity="0"/><stop offset=".5" stop-color="#E9FBFF" stop-opacity=".9"/><stop offset="1" stop-color="#9FE3FF" stop-opacity="0"/></linearGradient>')
        beam = f'<path d="{d}" fill="url(#bm{uid})" filter="url(#gl{uid})" opacity="{.8 if dark else .6}"/>'
    glow = f'<path fill="#BFEFFF" opacity="{.9 if dark else .7}" filter="url(#gl{uid})" d="{dband}"/>'
    rims = (f'<path fill="none" stroke="url(#rim{uid})" stroke-width="{2 if kind == "G3" else 1.4}" d="{dn}"/>'
            f'<path fill="none" stroke="url(#rim{uid})" stroke-width="{2 if kind == "G3" else 1.4}" d="{db}"/>')
    return (f'<svg viewBox="0 0 256 256"><defs>{"".join(defs)}</defs>{bgrect}{shadow}{beam if kind == "G2" else ""}{panes}{light}'
            f'{glow}<path fill="{core}" d="{dband}"/>{rims}</svg>')


def sized(svg, px):
    return svg.replace("<svg ", f'<svg style="width:{px}px;height:{px}px;border-radius:{px * .2237:.1f}px" ', 1)


V = [("G0", "Simetrija ispravljena", "Isti C3: senka je centrirana, svetlo pada jednako na oba panela, a oba kraja bistrog preseka su zaobljena isto.", "G0"),
     ("G1", "Svetlo iznutra", "Bistri presek je izvor svetla: oba panela sijaju od sredine ka ivicama. „Klaro“ = svetlo tamo gde se ekrani spoje.", "G1"),
     ("G2", "Zrak", "Kroz oba panela prolazi mek zrak svetla, u pravcu kraka slova K: jasnoća koja prolazi kroz svaki ekran.", "G2"),
     ("G3", "Dubina", "Plavi panel lebdi ispred i providan je: kroz njega se vidi tamni. Ivice hvataju svetlo kao pravo staklo (Liquid Glass).", "G3")]

cards = ""
for key, name, note, kind in V:
    big = sized(icon(kind, key + "a"), 300)
    lt = sized(icon(kind, key + "b", dark=False), 110)
    dk = sized(icon(kind, key + "c"), 110)
    sm = "".join(sized(icon(kind, key + f"s{px}{int(d)}", dark=d), px) for px in (60, 32) for d in (True, False))
    (OUT / f"{key.lower()}-icon-dark.svg").write_text(icon(kind, key + "x").replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" ', 1))
    cards += f"""<div class="card"><div class="top"><span class="k">{key}</span><span class="n">{name}</span></div>
      <div class="row">{big}<div class="side">{lt}{dk}<div class="sm">{sm}</div></div></div>
      <div class="note">{note}</div></div>"""

html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: Inter Tight; src: url('{(HERE / "fonts" / "InterTight[wght].ttf").as_uri()}'); font-weight: 100 900; }}
* {{ box-sizing: border-box; margin: 0; }}
body {{ width: 1600px; background: #F6F8FB; color: {NAVY}; font-family: 'Inter Tight', sans-serif; -webkit-font-smoothing: antialiased; padding: 56px 72px 64px; }}
.lbl {{ font-size: 13px; letter-spacing: .2em; text-transform: uppercase; color: #5B6478; font-weight: 500; }}
h1 {{ font-size: 38px; font-weight: 700; letter-spacing: -.025em; margin: 10px 0 8px; }}
.sub {{ font-size: 16px; color: #5B6478; max-width: 1200px; line-height: 1.5; }}
.grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 28px; }}
.card {{ background: #fff; border-radius: 24px; padding: 26px 28px; box-shadow: 0 1px 0 rgba(13,23,41,.05), 0 10px 30px rgba(13,23,41,.06); }}
.top {{ display: flex; gap: 10px; align-items: baseline; }}
.k {{ font-size: 18px; font-weight: 700; color: {BLUE}; }}
.n {{ font-size: 18px; font-weight: 600; }}
.row {{ display: flex; gap: 22px; margin-top: 18px; align-items: flex-start; }}
.row > svg {{ box-shadow: 0 24px 50px rgba(6,10,20,.35); }}
.side {{ display: grid; grid-template-columns: 110px 110px; gap: 16px; }}
.side > svg {{ box-shadow: 0 12px 28px rgba(6,10,20,.22), 0 0 0 1px rgba(13,23,41,.05); }}
.sm {{ grid-column: 1 / 3; display: flex; gap: 12px; align-items: flex-end; }}
.sm svg {{ box-shadow: 0 0 0 1px rgba(13,23,41,.08); }}
.note {{ font-size: 15px; color: #5B6478; margin-top: 18px; line-height: 1.5; }}
</style></head><body>
<div class="lbl">Klaro Player · staklo, simetrija i spin</div>
<h1>Sredina je sad simetrična. Plus malo više svetla.</h1>
<div class="sub">Geometrija je bila tačno simetrična (proverio sam i numerički), ali ikona je delovala krivo zbog senke koja pada nadole, prelaza svetlo→tamno na svakom panelu i oštrih uglova na krajevima preseka. Sve troje je ispravljeno.</div>
<div class="grid">{cards}</div>
</body></html>"""
(ROOT / "klaro-glass.html").write_text(html)
print("ok")
