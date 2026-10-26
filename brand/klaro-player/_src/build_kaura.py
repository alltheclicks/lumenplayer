"""K from option A as clear glass; the RGB leaves the letter and becomes an aura (around / below / above / rim).

Outputs: concepts/kaura/*.svg (1024 icon masters), _internal/kaura-png/*.png, klaro-kaura.html/.png (board).
"""
import subprocess
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from kglass_geom import d_of, pill_k, placed  # noqa: E402

OUT = ROOT / "concepts" / "kaura"
PNG = ROOT / "_internal" / "kaura-png"
OUT.mkdir(parents=True, exist_ok=True)
PNG.mkdir(parents=True, exist_ok=True)
RENDER = "/Users/filip/.claude/plugins/cache/logo-design-skill/logo-design/1.4.4/skills/logo-design/scripts/render_png.py"

R, G, B = "#FF2D55", "#1FE0A0", "#0A6CFF"
S = 1024


def geom(size=520, cy=512):
    k = placed(pill_k(join=0.66, split=0.30), size, 512, cy)
    return d_of(k), k.bounds


def blur(i, sd):
    return (f'<filter id="{i}" filterUnits="userSpaceOnUse" x="-300" y="-300" width="1624" height="1624">'
            f'<feGaussianBlur stdDeviation="{sd}"/></filter>')


def glass_k(kd, bb, light, tint, tint_op=.42, frost=None):
    """Clear glass K: white frost, faint tint of the aura inside, top sheen and a bright rim."""
    x0, y0, x1, y1 = bb
    top, bot = frost or ((".96", ".80") if not light else (".92", ".74"))
    defs = (f'<clipPath id="k"><path d="{kd}"/></clipPath>'
            f'<linearGradient id="frost" x1="0" y1="{y0}" x2="0" y2="{y1}" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="#FFFFFF" stop-opacity="{top}"/><stop offset="1" stop-color="#EAF0FF" stop-opacity="{bot}"/></linearGradient>'
            f'<linearGradient id="sheen" x1="0" y1="{y0}" x2="0" y2="{(y0 + y1) / 2}" gradientUnits="userSpaceOnUse">'
            '<stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>'
            f'<linearGradient id="rim" x1="{x0}" y1="{y0}" x2="{x1}" y2="{y1}" gradientUnits="userSpaceOnUse">'
            '<stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#fff" stop-opacity=".35"/>'
            '<stop offset="1" stop-color="#fff" stop-opacity=".8"/></linearGradient>'
            + blur("tint", 30))
    shadow = "#0B1830" if light else "#000"
    body = (f'<path d="{kd}" fill="{shadow}" opacity="{.34 if light else .45}" filter="url(#tint)" transform="translate(0 22)"/>'
            f'<g clip-path="url(#k)"><rect width="{S}" height="{S}" fill="url(#frost)"/>'
            f'<g filter="url(#tint)" opacity="{tint_op}">{tint}</g>'
            f'<rect width="{S}" height="{(y0 + y1) / 2}" fill="url(#sheen)" opacity=".55"/></g>'
            f'<path d="{kd}" fill="none" stroke="url(#rim)" stroke-width="5" clip-path="url(#k)"/>'
            + (f'<path d="{kd}" fill="none" stroke="#0D1729" stroke-opacity=".14" stroke-width="3"/>' if light else ""))
    return defs, body


def icon(kind, light=False):
    cy = {"below": 470, "above": 548}.get(kind, 512)
    kd, bb = geom(500 if kind in ("below", "above") else 520, cy)
    x0, y0, x1, y1 = bb
    cx = (x0 + x1) / 2
    bg = ('<radialGradient id="tile" cx=".3" cy=".15" r="1.1"><stop offset="0" stop-color="#F7F9FD"/><stop offset="1" stop-color="#DFE6F1"/></radialGradient>'
          if light else
          '<radialGradient id="tile" cx=".3" cy=".15" r="1.1"><stop offset="0" stop-color="#121D36"/><stop offset="1" stop-color="#03060D"/></radialGradient>')
    mode = "normal" if light else "screen"
    op = .75 if light else 1.0
    if kind == "around":        # halo that follows the silhouette: R by the stem, G by the arm, B by the leg
        aura = (f'<path d="{kd}" fill="{R}" stroke="{R}" stroke-width="40" transform="translate(-44 6)"/>'
                f'<path d="{kd}" fill="{G}" stroke="{G}" stroke-width="40" transform="translate(38 -40)"/>'
                f'<path d="{kd}" fill="{B}" stroke="{B}" stroke-width="40" transform="translate(38 46)"/>')
        sd = 48
    elif kind == "below":       # bias light on the wall below, like a TV's ambient light
        aura = (f'<ellipse cx="{cx - 170}" cy="{y1 + 20}" rx="190" ry="95" fill="{R}"/>'
                f'<ellipse cx="{cx}" cy="{y1 + 44}" rx="190" ry="95" fill="{G}"/>'
                f'<ellipse cx="{cx + 170}" cy="{y1 + 20}" rx="190" ry="95" fill="{B}"/>')
        sd = 58
    elif kind == "above":       # backlight rising over the top, like a sunrise behind the letter
        aura = (f'<ellipse cx="{cx - 170}" cy="{y0 - 10}" rx="190" ry="105" fill="{R}"/>'
                f'<ellipse cx="{cx}" cy="{y0 - 40}" rx="190" ry="105" fill="{G}"/>'
                f'<ellipse cx="{cx + 170}" cy="{y0 - 10}" rx="190" ry="105" fill="{B}"/>')
        sd = 58
    else:                       # rim: a thin RGB light that runs around the glass edge
        aura = f'<path d="{kd}" fill="none" stroke="url(#spec)" stroke-width="26"/>'
        sd = 16
    spec = (f'<linearGradient id="spec" x1="{x0}" y1="{y1}" x2="{x1}" y2="{y0}" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{R}"/><stop offset=".5" stop-color="{G}"/><stop offset="1" stop-color="{B}"/></linearGradient>')
    gdefs, gbody = glass_k(kd, bb, light, aura, {"around": .16, "rim": .25}.get(kind, .42))
    rim_sharp = (f'<path d="{kd}" fill="none" stroke="url(#spec)" stroke-width="5"/>' if kind == "rim" else "")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}" viewBox="0 0 {S} {S}">'
            f'<defs>{bg}{spec}{blur("aura", sd)}{blur("wide", sd * 2.2)}{gdefs}</defs>'
            f'<rect width="{S}" height="{S}" fill="url(#tile)"/>'
            f'<g style="mix-blend-mode:{mode}" opacity="{op * .55}" filter="url(#wide)">{aura}</g>'
            f'<g style="mix-blend-mode:{mode}" opacity="{op}" filter="url(#aura)">{aura}</g>'
            f'{gbody}{rim_sharp}</svg>\n')


VARIANTS = [
    ("around", "Aura oko", "RGB svetlo prati obris slova: stub isijava crveno, gornji krak zeleno, donji plavo. Staklo ostaje čisto."),
    ("below", "Aura ispod", "Svetlo pada ispod slova, kao ambijentalno svetlo iza televizora (Ambilight). Najjasnija veza sa TV-om."),
    ("above", "Aura iznad", "Svetlo se diže iza vrha slova, kao izlazak sunca. Više „premijerno“, kao najava sadržaja."),
    ("rim", "Svetlosni obod", "Tanka RGB linija svetla obilazi staklenu ivicu. Najsuptilnije, ali blisko Apple Intelligence sjaju."),
]


def render(svg_path, png_path):
    subprocess.run([sys.executable, RENDER, str(svg_path), "-o", str(png_path), "--size", "1024", "--backend", "chrome"],
                   check=True, capture_output=True)


def board():
    P = "_internal/kaura-png"
    cards = []
    for i, (k, name, note) in enumerate(VARIANTS):
        cards.append(f"""<article class="c"><header><span class="n">{i + 1}</span><h2>{name}</h2></header>
  <img class="big" src="{P}/{k}-dark.png">
  <div class="row"><img class="mid" src="{P}/{k}-light.png"><div class="sizes"><img src="{P}/{k}-dark-64.png" width="64"><img src="{P}/{k}-dark-32.png" width="32"><img src="{P}/{k}-dark-16.png" width="16"></div></div>
  <div class="lock"><img src="{P}/{k}-dark.png"><b>Klaro</b>&nbsp;<span>Player</span></div><p>{note}</p></article>""")
    tv = "".join(f'<div class="tv-t ours"><img src="{P}/{k}-dark.png"><b>Klaro</b>&nbsp;<span>Player</span></div>' for k, *_ in VARIANTS)
    return f"""<!doctype html><html lang="sr-Latn"><head><meta charset="utf-8"><title>Klaro K Aura</title><style>
@font-face{{font-family:"Inter Tight";src:url("_src/fonts/InterTight[wght].ttf") format("truetype");font-weight:100 900}}
*{{box-sizing:border-box;margin:0}}
body{{background:radial-gradient(1100px 600px at 15% -10%,#15264D,transparent 60%),radial-gradient(900px 600px at 100% 0%,#2B1030,transparent 55%),#05080F;color:#EEF3FF;font:15px/1.5 "Inter Tight",system-ui,sans-serif;-webkit-font-smoothing:antialiased}}
.page{{width:1680px;padding:52px 56px 56px;margin:0 auto}}
small.k{{letter-spacing:.2em;text-transform:uppercase;color:#8C9AB8;font-size:12px}}
h1{{font-size:52px;letter-spacing:-.03em;margin:8px 0 10px;line-height:1.05}} .lead{{color:#8C9AB8;font-size:16px;max-width:95ch}}
.grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;margin-top:32px}}
.c{{background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.015));border:1px solid #1B2640;border-radius:26px;padding:20px}}
header{{display:flex;gap:10px;align-items:center;margin-bottom:14px}} .n{{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:rgba(255,255,255,.08);font-weight:700}}
h2{{font-size:21px;letter-spacing:-.02em}}
.big{{width:100%;border-radius:22.5%;box-shadow:0 26px 60px rgba(0,0,0,.55)}}
.row{{display:flex;gap:16px;align-items:flex-end;margin-top:14px}} .mid{{width:120px;border-radius:22.5%}}
.sizes{{display:flex;gap:10px;align-items:flex-end}} .sizes img{{border-radius:22%}} .sizes img[width="16"]{{border-radius:4px}}
.lock{{display:flex;align-items:center;margin:18px 0 10px;font-size:28px;letter-spacing:-.025em}} .lock img{{width:48px;border-radius:22.5%;margin-right:12px}}
.lock b{{font-weight:700}} .lock span{{color:#C9D4EA}} .c p{{color:#B7C3DB;font-size:14px}}
h3{{margin:36px 0 14px;font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#8C9AB8}}
.tv{{border-radius:26px;padding:28px;background:#070A12;border:1px solid #1B2640;display:grid;grid-template-columns:repeat(4,1fr);gap:16px}}
.tv-t{{aspect-ratio:16/9;border-radius:14px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#101A31,#060910);border:1px solid #22304F;font-size:22px;letter-spacing:-.02em}}
.tv-t img{{width:52px;border-radius:22.5%;margin-right:12px}} .tv-t span{{color:#C9D4EA}}
</style></head><body><div class="page"><small class="k">Klaro Player · razrada A · aura</small>
<h1>K od stakla, RGB kao aura</h1>
<p class="lead">Slovo je isto kao u A, ali je sada čisto, providno staklo. R, G i B su izašli iz slova i postali svetlo oko njega. Četiri položaja aure; ravna jednobojna verzija ostaje ista kao ranije.</p>
<div class="grid">{"".join(cards)}</div><h3>TV launcher</h3><div class="tv">{tv}</div></div></body></html>"""


def main():
    for k, *_ in VARIANTS:
        for tone in ("dark", "light"):
            p = OUT / f"{k}-{tone}.svg"
            p.write_text(icon(k, light=tone == "light"))
            render(p, PNG / f"{k}-{tone}.png")
            im = Image.open(PNG / f"{k}-{tone}.png").convert("RGBA")
            for n in (64, 32, 16):
                im.resize((n, n), Image.LANCZOS).save(PNG / f"{k}-{tone}-{n}.png")
    html = ROOT / "klaro-kaura.html"
    html.write_text(board())
    subprocess.run([sys.executable, RENDER, str(html), "-o", str(ROOT / "klaro-kaura.png"), "--width", "1680", "--height", "1330"],
                   check=True)


if __name__ == "__main__":
    main()
