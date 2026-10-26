"""Round 2 of the glass K: four takes on 'Aura oko' (1a–1d) and four on 'Svetlosni obod' (4a–4d).
Two of them (1c, 4b) carry PLAYER under the K. Chrome-rendered; board -> klaro-kaura2.html/.png.
"""
import math
import subprocess
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from build_kaura import RENDER, S, blur, geom, glass_k  # noqa: E402
from typekit import text  # noqa: E402

OUT = ROOT / "concepts" / "kaura2"
PNG = ROOT / "_internal" / "kaura2-png"
OUT.mkdir(parents=True, exist_ok=True)
PNG.mkdir(parents=True, exist_ok=True)

R, Y, G, C, B, M = "#FF2D55", "#FFC23D", "#1FE0A0", "#2FD3FF", "#0A6CFF", "#B14DFF"

V = [
    # ---- 1 · Aura oko
    dict(id="1a", g=1, name="Meka aura", kind="halo", offs=[(R, -44, 6), (G, 38, -40), (B, 38, 46)], sw=40, sd=48,
         note="Doterana opcija 1: tri kanala oko svojih poteza (stub R, gornji krak G, donji krak B), mek prelaz."),
    dict(id="1b", g=1, name="Neon", kind="halo", offs=[(R, -18, 4), (G, 16, -16), (B, 16, 18)], sw=16, sd=18,
         note="Aura tik uz staklo, jače zasićena. Najbolje drži oblik na 32 i 16 px."),
    dict(id="1c", g=1, name="Ambijent + PLAYER", kind="halo", offs=[(R, -70, 10), (G, 60, -60), (B, 60, 70)], sw=80,
         sd=90, player=True, note="Široko, mirno svetlo i natpis PLAYER. Ikona ima i verziju bez natpisa za male veličine."),
    dict(id="1d", g=1, name="Spektar", kind="halo", ring=True, sw=30, sd=40,
         note="Šest boja u krug (crvena, žuta, zelena, cijan, plava, ljubičasta) umesto tri: pun spektar oko slova."),
    # ---- 4 · Svetlosni obod
    dict(id="4a", g=4, name="Sjajni obod", kind="rim", rim_w=26, rim_sd=16, sharp=5,
         note="Doterana opcija 4: RGB linija oko ivice sa mekim sjajem."),
    dict(id="4b", g=4, name="Tanka linija + PLAYER", kind="rim", rim_w=10, rim_sd=6, sharp=6, glow_op=.6, player=True,
         note="Precizna svetlosna linija, skoro bez sjaja, i natpis PLAYER. Najmirnija i najčistija."),
    dict(id="4c", g=4, name="Svetlo iznutra", kind="rim", inner=True, sharp=4,
         note="Svetlo ulazi u staklo kroz ivice: obojene su unutrašnje ivice, ne okolina. Najviše „staklo“."),
    dict(id="4d", g=4, name="Kometa", kind="rim", comet=True, rim_w=26, rim_sd=14, sharp=6,
         note="Svetlo je samo na delu ivice i u animaciji kruži oko slova (učitavanje, splash)."),
]


def tile(light):
    return ('<radialGradient id="tile" cx=".3" cy=".15" r="1.1"><stop offset="0" stop-color="#F7F9FD"/>'
            '<stop offset="1" stop-color="#DFE6F1"/></radialGradient>' if light else
            '<radialGradient id="tile" cx=".3" cy=".15" r="1.1"><stop offset="0" stop-color="#121D36"/>'
            '<stop offset="1" stop-color="#03060D"/></radialGradient>')


def player_text(light, cap=58, base=838):
    ink = "#0D1729" if light else "#FFFFFF"
    kw = dict(cap=cap, tracking=cap * 0.42, wght=620)
    _, w = text("PLAYER", "InterTight", x=0, base=0, **kw)
    d, _ = text("PLAYER", "InterTight", x=(S - w) / 2, base=base, **kw)
    return f'<path fill="{ink}" fill-opacity="{.92 if not light else .88}" d="{d}"/>'


def icon(v, light=False, with_player=None):
    player = v.get("player") if with_player is None else with_player
    kd, bb = geom(430, 430) if player else geom(520, 512)
    x0, y0, x1, y1 = bb
    mode, op = ("normal", .75) if light else ("screen", 1.0)
    spec = (f'<linearGradient id="spec" x1="{x0}" y1="{y1}" x2="{x1}" y2="{y0}" gradientUnits="userSpaceOnUse">'
            + (f'<stop offset="0" stop-color="{R}" stop-opacity="0"/><stop offset=".42" stop-color="{R}" stop-opacity="0"/>'
               f'<stop offset=".6" stop-color="{R}"/><stop offset=".8" stop-color="{G}"/><stop offset="1" stop-color="{B}"/>'
               if v.get("comet") else
               f'<stop offset="0" stop-color="{R}"/><stop offset=".5" stop-color="{G}"/><stop offset="1" stop-color="{B}"/>')
            + "</linearGradient>")
    k = 430 / 520 if player else 1.0                  # scale offsets with the letter
    extra_defs, layers, over = "", "", ""
    if v["kind"] == "halo":
        if v.get("ring"):
            hues = [(R, 180), (Y, 240), (G, 300), (C, 0), (B, 60), (M, 120)]
            offs = [(c, 40 * math.cos(math.radians(a)), 40 * math.sin(math.radians(a))) for c, a in hues]
        else:
            offs = v["offs"]
        aura = "".join(f'<path d="{kd}" fill="{c}" stroke="{c}" stroke-width="{v["sw"] * k:.0f}" '
                       f'transform="translate({dx * k:.1f} {dy * k:.1f})"/>' for c, dx, dy in offs)
        sd = v["sd"] * k
        layers = (f'<g style="mix-blend-mode:{mode}" opacity="{op * .5}" filter="url(#wide)">{aura}</g>'
                  f'<g style="mix-blend-mode:{mode}" opacity="{op}" filter="url(#aura)">{aura}</g>')
        extra_defs = blur("aura", sd) + blur("wide", sd * 2.4)
        tint, tint_op = aura, .08
    else:
        if v.get("inner"):
            aura = f'<path d="{kd}" fill="none" stroke="url(#spec)" stroke-width="70"/>'
            extra_defs = blur("aura", 20) + blur("wide", 60)
            layers = (f'<g style="mix-blend-mode:{mode}" opacity="{op * .45}" filter="url(#wide)">{aura}</g>')
            over = (f'<g clip-path="url(#k)" style="mix-blend-mode:{"multiply" if light else "screen"}">'
                    f'<g filter="url(#aura)" opacity=".95">{aura}</g></g>')
            tint, tint_op = "", 0
        else:
            aura = f'<path d="{kd}" fill="none" stroke="url(#spec)" stroke-width="{v["rim_w"]}"/>'
            extra_defs = blur("aura", v["rim_sd"]) + blur("wide", v["rim_sd"] * 3.5)
            g = v.get("glow_op", 1.0)
            layers = (f'<g style="mix-blend-mode:{mode}" opacity="{op * .45 * g}" filter="url(#wide)">{aura}</g>'
                      f'<g style="mix-blend-mode:{mode}" opacity="{op * g}" filter="url(#aura)">{aura}</g>')
            tint, tint_op = aura, .25
        over += f'<path d="{kd}" fill="none" stroke="url(#spec)" stroke-width="{v["sharp"]}"/>'
    gdefs, gbody = glass_k(kd, bb, light, tint, tint_op, frost=(".985", ".93") if v["kind"] == "halo" else None)
    txt = player_text(light) if player else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}" viewBox="0 0 {S} {S}">'
            f'<defs>{tile(light)}{spec}{extra_defs}{gdefs}</defs><rect width="{S}" height="{S}" fill="url(#tile)"/>'
            f'{layers}{gbody}{over}{txt}</svg>\n')


def render(svg_path, png_path):
    subprocess.run([sys.executable, RENDER, str(svg_path), "-o", str(png_path), "--size", "1024", "--backend", "chrome"],
                   check=True, capture_output=True)


def build_icons():
    for v in V:
        for tone in ("dark", "light"):
            p = OUT / f"{v['id']}-{tone}.svg"
            p.write_text(icon(v, tone == "light"))
            render(p, PNG / f"{v['id']}-{tone}.png")
            im = Image.open(PNG / f"{v['id']}-{tone}.png").convert("RGBA")
            for n in (180, 120, 64, 32, 16):
                im.resize((n, n), Image.LANCZOS).save(PNG / f"{v['id']}-{tone}-{n}.png")
        if v.get("player"):                        # small-size cut without the word
            p = OUT / f"{v['id']}-dark-small.svg"
            p.write_text(icon(v, False, with_player=False))
            render(p, PNG / f"{v['id']}-dark-small.png")
            im = Image.open(PNG / f"{v['id']}-dark-small.png").convert("RGBA")
            for n in (64, 32, 16):
                im.resize((n, n), Image.LANCZOS).save(PNG / f"{v['id']}-dark-small-{n}.png")


def card(v):
    P = "_internal/kaura2-png"
    i = v["id"]
    small = f"{i}-dark-small" if v.get("player") else f"{i}-dark"
    tag = '<span class="tag">PLAYER</span>' if v.get("player") else ""
    return f"""<article class="c"><header><span class="n">{i}</span><h2>{v["name"]}</h2>{tag}</header>
<img class="big" src="{P}/{i}-dark.png">
<div class="row"><img class="mid" src="{P}/{i}-light.png"><div class="sizes">
<img src="{P}/{small}-64.png" width="64"><img src="{P}/{small}-32.png" width="32"><img src="{P}/{small}-16.png" width="16"></div></div>
<p>{v["note"]}</p></article>"""


def ladder(i):
    P = "_internal/kaura2-png"
    sizes = "".join(f'<figure><img src="{P}/{i}-dark-{n}.png" width="{n}"><figcaption>{n}</figcaption></figure>' for n in (180, 120))
    sizes += "".join(f'<figure><img src="{P}/{i}-dark-small-{n}.png" width="{n}"><figcaption>{n}</figcaption></figure>' for n in (64, 32, 16))
    return f'<div class="ladder"><b>{i}</b>{sizes}</div>'


def board():
    g1 = "".join(card(v) for v in V if v["g"] == 1)
    g4 = "".join(card(v) for v in V if v["g"] == 4)
    return f"""<!doctype html><html lang="sr-Latn"><head><meta charset="utf-8"><title>Klaro K Aura 2</title><style>
@font-face{{font-family:"Inter Tight";src:url("_src/fonts/InterTight[wght].ttf") format("truetype");font-weight:100 900}}
*{{box-sizing:border-box;margin:0}}
body{{background:radial-gradient(1100px 600px at 15% -5%,#15264D,transparent 60%),radial-gradient(900px 600px at 100% 0%,#2B1030,transparent 55%),#05080F;color:#EEF3FF;font:15px/1.5 "Inter Tight",system-ui,sans-serif;-webkit-font-smoothing:antialiased}}
.page{{width:1680px;padding:48px 56px 56px;margin:0 auto}}
small.k{{letter-spacing:.2em;text-transform:uppercase;color:#8C9AB8;font-size:12px}}
h1{{font-size:50px;letter-spacing:-.03em;margin:8px 0 8px;line-height:1.05}} .lead{{color:#8C9AB8;font-size:16px;max-width:100ch}}
h3{{margin:34px 0 14px;font-size:14px;letter-spacing:.18em;text-transform:uppercase;color:#C9D4EA}}
.grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}}
.c{{background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.015));border:1px solid #1B2640;border-radius:24px;padding:18px}}
header{{display:flex;gap:10px;align-items:center;margin-bottom:12px}} .n{{min-width:34px;height:30px;padding:0 6px;border-radius:9px;display:grid;place-items:center;background:rgba(255,255,255,.08);font-weight:700;font-size:14px}}
h2{{font-size:19px;letter-spacing:-.02em}} .tag{{margin-left:auto;font-size:11px;letter-spacing:.14em;padding:4px 8px;border-radius:99px;border:1px solid #3A4B72;color:#C9D4EA}}
.big{{width:100%;border-radius:22.5%;box-shadow:0 22px 50px rgba(0,0,0,.55)}}
.row{{display:flex;gap:14px;align-items:flex-end;margin-top:12px}} .mid{{width:104px;border-radius:22.5%}}
.sizes{{display:flex;gap:10px;align-items:flex-end}} .sizes img{{border-radius:22%}} .sizes img[width="16"]{{border-radius:4px}}
.c p{{color:#B7C3DB;font-size:13.5px;margin-top:12px}}
.ladders{{display:grid;grid-template-columns:1fr 1fr;gap:18px}}
.ladder{{display:flex;align-items:flex-end;gap:22px;background:#070A12;border:1px solid #1B2640;border-radius:24px;padding:22px 26px}}
.ladder b{{align-self:flex-start;font-size:18px}} .ladder figure{{text-align:center;color:#8C9AB8;font-size:12px}}
.ladder img{{border-radius:22.5%;display:block;margin-bottom:6px}} .ladder img[width="16"]{{border-radius:4px}}
.foot{{color:#8C9AB8;font-size:13.5px;margin-top:12px}}
</style></head><body><div class="page"><small class="k">Klaro Player · razrada 1 i 4</small>
<h1>Aura oko i svetlosni obod: po četiri varijante</h1>
<p class="lead">Isti stakleni K. Menja se samo svetlo: koliko je široko, koliko zasićeno i gde sedi. 1c i 4b imaju natpis PLAYER.</p>
<h3>1 · Aura oko</h3><div class="grid">{g1}</div>
<h3>4 · Svetlosni obod</h3><div class="grid">{g4}</div>
<h3>PLAYER na svim veličinama</h3><div class="ladders">{ladder("1c")}{ladder("4b")}</div>
<p class="foot">PLAYER je Inter Tight SemiBold, velikim slovima i sa širokim razmakom, kao pravi oblici (ne font). Čitljiv je do ~120 px. Na 64 px i manje koristi se verzija bez natpisa (isti K, isto svetlo), jer bi natpis tu bio samo siva linija. Favicon i male sistemske ikone su uvek bez natpisa.</p>
</div></body></html>"""


def main():
    build_icons()
    html = ROOT / "klaro-kaura2.html"
    html.write_text(board())
    subprocess.run([sys.executable, RENDER, str(html), "-o", str(ROOT / "klaro-kaura2.png"), "--width", "1680",
                    "--height", "1900"], check=True)


if __name__ == "__main__":
    main()
