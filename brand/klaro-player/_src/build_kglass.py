"""2026 glass K round: one pill K, three finishes (Clear glass · RGB · Shine). Chrome-rendered (filters, blend modes).

Outputs: concepts/kglass/*.svg (icon masters, 1024), _internal/kglass-png/*.png, klaro-kglass.html/.png (board).
"""
import subprocess
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from kglass_geom import d_of, pill_k, placed  # noqa: E402

OUT = ROOT / "concepts" / "kglass"
PNG = ROOT / "_internal" / "kglass-png"
OUT.mkdir(parents=True, exist_ok=True)
PNG.mkdir(parents=True, exist_ok=True)
RENDER = "/Users/filip/.claude/plugins/cache/logo-design-skill/logo-design/1.4.4/skills/logo-design/scripts/render_png.py"

KG = pill_k(join=0.66, split=0.30)
S = 1024
K = placed(KG, 560, 512, 512)
KD = d_of(K)
x0, y0, x1, y1 = K.bounds
TILE = f'<rect width="{S}" height="{S}" fill="url(#tile)"/>'


def wrap(defs, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}" viewBox="0 0 {S} {S}">'
            f'<defs>{defs}</defs>{body}</svg>\n')


def tile_grad(c0, c1):
    return (f'<radialGradient id="tile" cx="0.3" cy="0.2" r="1.1"><stop offset="0" stop-color="{c0}"/>'
            f'<stop offset="1" stop-color="{c1}"/></radialGradient>')


# ------------------------------------------------------------------ A · Clear glass K with RGB refraction
def clear(light=False):
    bg0, bg1 = ("#F4F7FC", "#DCE3EF") if light else ("#101B33", "#03060D")
    # one channel per stroke: R = stem, G = arm, B = leg; where they meet the light turns white
    orbs = (f'<ellipse cx="{x0 + 70}" cy="{(y0 + y1) / 2}" rx="120" ry="260" fill="#FF2D55"/>'
            f'<circle cx="{x1 - 80}" cy="{y0 + 80}" r="150" fill="#22E08A"/>'
            f'<circle cx="{x1 - 80}" cy="{y1 - 80}" r="150" fill="#0A6CFF"/>'
            f'<circle cx="{x0 + 190}" cy="{(y0 + y1) / 2 + 10}" r="70" fill="#FFFFFF"/>')
    defs = (tile_grad(bg0, bg1)
            + f'<clipPath id="k"><path d="{KD}"/></clipPath>'
            + '<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="90"/></filter>'
            + '<filter id="frost" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>'
            + '<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="26"/></filter>'
            + f'<linearGradient id="sheen" x1="0" y1="{y0}" x2="0" y2="{y1}" gradientUnits="userSpaceOnUse">'
              '<stop offset="0" stop-color="#fff" stop-opacity=".62"/><stop offset=".45" stop-color="#fff" stop-opacity=".16"/>'
              '<stop offset="1" stop-color="#fff" stop-opacity=".30"/></linearGradient>'
            + f'<linearGradient id="rim" x1="{x0}" y1="{y0}" x2="{x1}" y2="{y1}" gradientUnits="userSpaceOnUse">'
              '<stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".5" stop-color="#fff" stop-opacity=".25"/>'
              '<stop offset="1" stop-color="#fff" stop-opacity=".7"/></linearGradient>')
    amb = .22 if light else .30
    body = (TILE
            + f'<g filter="url(#soft)" opacity="{amb}">{orbs}</g>'                         # ambient light behind
            + f'<path d="{KD}" fill="#000" opacity="{.10 if light else .35}" filter="url(#glow)" transform="translate(0 24)"/>'
            + f'<g clip-path="url(#k)"><rect width="{S}" height="{S}" fill="{"#E9EEF7" if light else "#0B1224"}"/>'
              f'<g filter="url(#frost)" opacity=".95">{orbs}</g>'
              f'<rect width="{S}" height="{S}" fill="url(#sheen)"/></g>'
            # RGB fringe: the refracting edge splits into channels
            + f'<g fill="none" stroke-width="7" style="mix-blend-mode:screen" opacity=".9">'
              f'<path d="{KD}" stroke="#FF2D55" transform="translate(-6 -3)"/>'
              f'<path d="{KD}" stroke="#22E08A"/>'
              f'<path d="{KD}" stroke="#0A6CFF" transform="translate(6 3)"/></g>'
            + f'<path d="{KD}" fill="none" stroke="url(#rim)" stroke-width="5" clip-path="url(#k)"/>')
    return wrap(defs, body)


# ------------------------------------------------------------------ B · RGB K (additive channels)
def rgb(light=False):
    bg0, bg1 = ("#FFFFFF", "#E8ECF3") if light else ("#0B0F18", "#000000")
    off = 16
    blend = "multiply" if light else "screen"
    cols = ("#00E5FF", "#FF2BD6", "#FFE500") if light else ("#FF1F4B", "#1FFF7A", "#1F6BFF")   # CMY on light, RGB on dark
    defs = (tile_grad(bg0, bg1)
            + '<filter id="bloom" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="34"/></filter>')
    if light:
        layers = (f'<path d="{KD}" fill="#FF1F4B" transform="translate({-off} {-off * .6})"/>'
                  f'<path d="{KD}" fill="#1F6BFF" transform="translate({off} {off * .6})"/>'
                  f'<path d="{KD}" fill="#0D1729"/>')
        return wrap(defs, TILE + layers)
    layers = "".join(
        f'<path d="{KD}" fill="{c}" transform="translate({dx} {dy})" style="mix-blend-mode:{blend}"/>'
        for c, (dx, dy) in zip(cols, ((-off, -off * .6), (0, 0), (off, off * .6))))
    body = (TILE
            + f'<g filter="url(#bloom)" opacity=".55">{layers}</g>'
            + f'<g style="isolation:isolate">{layers}</g>')
    return wrap(defs, body)


# ------------------------------------------------------------------ C · Shine: Klaro blue glass K + spectral glint
def shine(light=False):
    bg0, bg1 = ("#F4F7FC", "#DCE3EF") if light else ("#15233F", "#060B16")
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    defs = (tile_grad(bg0, bg1)
            + f'<clipPath id="k"><path d="{KD}"/></clipPath>'
            + f'<linearGradient id="body" x1="0" y1="{y0}" x2="0" y2="{y1}" gradientUnits="userSpaceOnUse">'
              '<stop offset="0" stop-color="#4A98FF"/><stop offset=".48" stop-color="#0669FE"/>'
              '<stop offset="1" stop-color="#0A2E8A"/></linearGradient>'
            + f'<linearGradient id="gloss" x1="0" y1="{y0}" x2="0" y2="{cy}" gradientUnits="userSpaceOnUse">'
              '<stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>'
            + f'<linearGradient id="spec" x1="{cx - 120}" y1="{cy + 120}" x2="{cx + 120}" y2="{cy - 120}" gradientUnits="userSpaceOnUse">'
              '<stop offset="0" stop-color="#FF2D55" stop-opacity="0"/><stop offset=".2" stop-color="#FF2D55"/>'
              '<stop offset=".4" stop-color="#FFD60A"/><stop offset=".55" stop-color="#30D158"/>'
              '<stop offset=".72" stop-color="#64D2FF"/><stop offset=".86" stop-color="#BF5AF2"/>'
              '<stop offset="1" stop-color="#BF5AF2" stop-opacity="0"/></linearGradient>'
            + '<filter id="blur8" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8"/></filter>'
            + '<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>')
    band = (f'<g transform="rotate(-45 {cx} {cy})">'
            f'<rect x="{cx - 400}" y="{cy - 34}" width="800" height="68" fill="url(#spec)" filter="url(#blur8)" opacity=".95"/>'
            f'<rect x="{cx - 400}" y="{cy - 5}" width="800" height="10" fill="#fff" opacity=".85" filter="url(#blur8)"/></g>')
    body = (TILE
            + f'<path d="{KD}" fill="#0669FE" opacity="{.25 if light else .55}" filter="url(#glow)" transform="translate(0 30)"/>'
            + f'<path d="{KD}" fill="url(#body)"/>'
            + f'<g clip-path="url(#k)"><rect width="{S}" height="{S}" fill="url(#gloss)"/>'
              f'<g style="mix-blend-mode:screen">{band}</g></g>'
            + f'<path d="{KD}" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="4" clip-path="url(#k)"/>')
    return wrap(defs, body)


def flat(colour="#0D1729", bg=None):
    back = f'<rect width="{S}" height="{S}" fill="{bg}"/>' if bg else ""
    return wrap("", back + f'<path d="{KD}" fill="{colour}"/>')


CONCEPTS = [
    ("a-clear", "Clear", clear,
     "Providno staklo; tri poteza K su tri kanala ekrana: stub R, gornji krak G, donji krak B. Gde se spoje, svetlo je belo (klaro = bistro).",
     "Rizik: staklo i RGB ivica traže dobar render; na 16 px ostaje samo svetli K."),
    ("b-rgb", "RGB", rgb,
     "Tri kanala ekrana (R, G, B) se sabiraju u beli K: slika postaje jasna tek kad se sve spoji.",
     "Rizik: pomak kanala podseća na TikTok efekat; ovde idu tri kanala i dijagonala, ne dva i horizontala."),
    ("c-shine", "Shine", shine,
     "Klaro plavi stakleni K sa jednim spektralnim odsjajem preko spoja. Taj odsjaj je potpis brenda.",
     "Rizik: plavi K je u OTT svetu blizu Kodi-ja; razlika je jedan pun, mekan oblik (ne delovi) i odsjaj."),
]


def render(svg_path, png_path):
    subprocess.run([sys.executable, RENDER, str(svg_path), "-o", str(png_path), "--size", "1024",
                    "--backend", "chrome"], check=True, capture_output=True)


def main():
    for key, _, fn, _, _ in CONCEPTS:
        for tone in ("dark", "light"):
            p = OUT / f"{key}-{tone}.svg"
            p.write_text(fn(light=tone == "light"))
            render(p, PNG / f"{key}-{tone}.png")
            im = Image.open(PNG / f"{key}-{tone}.png").convert("RGBA")
            for n in (64, 32, 16):
                im.resize((n, n), Image.LANCZOS).save(PNG / f"{key}-{tone}-{n}.png")
    (OUT / "k-flat-navy.svg").write_text(flat())
    (OUT / "k-flat-white.svg").write_text(flat("#FFFFFF", "#0D1729"))
    render(OUT / "k-flat-navy.svg", PNG / "k-flat-navy.png")
    print("ok")


if __name__ == "__main__":
    main()
