"""KP monogram round: two letters, two tones, one overlap (owner reference: the PayPal 'PP' idea).

Letters are OFL fonts converted to outlines (Geist, Bricolage Grotesque). The overlap is its own third tone.
"""
import math
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from typekit import bounds, glyph, text  # noqa: E402
from marks import f  # noqa: E402

FONT = (HERE / "fonts" / "Geist[wght].ttf").as_uri()
OUT = ROOT / "concepts" / "kp"
OUT.mkdir(parents=True, exist_ok=True)

GEIST = dict(name="Geist", wght=800)
BRIC = dict(name="Bricolage", wght=800, opsz=96, wdth=90)

# (char, font spec, dx in cap units, raise in cap units, scale)
V = [
    ("KP1", "Preklop", "Dva kosa slova, jedno preko drugog, treća boja u preseku. Najbliže PayPal ideji.",
     "najbliže PayPal-u (kosa slova + dve plave); boje i slova moraju ostati svoji",
     dict(skew=12, letters=[("K", GEIST, 0, .10, 1), ("P", GEIST, .58, -.10, 1)])),
    ("KP2", "Uspravno", "Ista ideja, uspravna slova: mirnije i stabilnije.",
     "manje dinamike od kosog", dict(skew=0, letters=[("K", GEIST, 0, 0, 1), ("P", GEIST, .60, -.06, 1)])),
    ("KP3", "Mala slova kp", "k gore, p dole: dva slova koja se prirodno uklapaju, uzlazni i silazni potez.",
     "mala slova u Bricolage-u deluju toplije, manje „tech“",
     dict(skew=0, letters=[("k", BRIC, 0, 0, 1), ("p", BRIC, .54, 0, 1)])),
    ("KP4", "P iza K", "Veliko P kao pozadina, K ispred njega: Player nosi Klaro.",
     "K dominira, pa više čita samo K", dict(skew=10, letters=[("P", GEIST, .40, .10, 1.08), ("K", GEIST, 0, -.08, .92)])),
    ("KP5", "Kurziv sa rezom", "Kao KP1, ali P od K odvaja tanak rez: radi i u jednoj boji.",
     "rez mora ostati vidljiv na 16 px", dict(skew=12, cut=True, letters=[("K", GEIST, 0, .10, 1), ("P", GEIST, .58, -.10, 1)])),
    ("KP6", "Staklo", "Dva staklena slova, presek svetli najjače: 2026 Liquid Glass.",
     "zavisi od efekta; za štampu treba ravna verzija (KP1)",
     dict(skew=12, glass=True, letters=[("K", GEIST, 0, .10, 1), ("P", GEIST, .58, -.10, 1)])),
]

CAP = 100


def build(spec):
    """Return (paths[list of d], bbox) in cap-100 units."""
    k = math.tan(math.radians(spec["skew"]))
    out, xs, ys = [], [], []
    for ch, fnt, dx, up, sc in spec["letters"]:
        ax = {a: b for a, b in fnt.items() if a != "name"}
        cap = CAP * sc
        x, base = dx * CAP, -up * CAP
        d, _ = glyph(ch, fnt["name"], cap, x=x, base=base, skew=spec["skew"], **ax)
        x0, y0, x1, y1 = bounds(ch, fnt["name"], cap, **ax)
        xs += [x + x0 + k * y0, x + x1 + k * y1]
        ys += [base - y1, base - y0]
        out.append(d)
    return out, (min(xs), min(ys), max(xs), max(ys))


def fit(bbox, box=256, size=150):
    x0, y0, x1, y1 = bbox
    s = size / max(x1 - x0, y1 - y0)
    tx = box / 2 - (x0 + x1) / 2 * s
    ty = box / 2 - (y0 + y1) / 2 * s
    return f"translate({f(tx)} {f(ty)}) scale({f(s)})"


TONES = {  # back letter, front letter, overlap
    "ice": ("#2448E8", "#1FB6FF", "#0B1F8F"),
    "night": ("#3D6BFF", "#8FE3FF", "#FFFFFF"),
    "paper": ("#2448E8", "#1FB6FF", "#0B1F8F"),
    "mono": ("#07090F", "#07090F", "#07090F"),
    "white": ("#F5F8FF", "#F5F8FF", "#F5F8FF"),
}
BG = {"ice": ("#EAFBFF", "#A5E9FF"), "night": ("#1B2F6E", "#05070D"), "paper": ("#FFFFFF", "#E8EEF8")}


def body(uid, spec, tone, size=150, cut_colour=None):
    paths, bbox = build(spec)
    a, b = paths
    ca, cb, co = TONES[tone]
    t = fit(bbox, size=size)
    cut = ""
    if spec.get("cut") or tone in ("mono", "white"):
        # knockout: a thin outline around the front letter in the background colour separates the two
        cut = f'<path d="{b}" fill="none" stroke="{cut_colour or "#fff"}" stroke-width="7" stroke-linejoin="round"/>'
    if spec.get("glass") and tone == "night":
        return (f'<defs><clipPath id="c{uid}"><path d="{a}"/></clipPath>'
                f'<filter id="g{uid}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9"/></filter></defs>'
                f'<g transform="{t}"><g filter="url(#g{uid})" opacity=".7" fill="#3D6BFF"><path d="{a}"/><path d="{b}"/></g>'
                f'<path d="{a}" fill="#9BB4FF" fill-opacity=".55"/><path d="{b}" fill="#9BE7FF" fill-opacity=".55"/>'
                f'<path d="{b}" fill="#FFFFFF" clip-path="url(#c{uid})"/>'
                f'<path d="{a}" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.2"/>'
                f'<path d="{b}" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.2"/></g>')
    return (f'<defs><clipPath id="c{uid}"><path d="{a}"/></clipPath></defs><g transform="{t}">'
            f'<path d="{a}" fill="{ca}"/>{cut}<path d="{b}" fill="{cb}"/><path d="{b}" fill="{co}" clip-path="url(#c{uid})"/></g>')


def tile(uid, spec, style, px, radius):
    b0, b1 = BG[style]
    cut = b0 if style != "night" else "#0E1A40"
    return (f'<svg viewBox="0 0 256 256" style="width:{px}px;height:{px}px;border-radius:{radius}px"><defs>'
            f'<linearGradient id="t{uid}" x1="0" y1="0" x2="0" y2="256" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{b0}"/><stop offset="1" stop-color="{b1}"/></linearGradient></defs>'
            f'<rect width="256" height="256" rx="57" fill="url(#t{uid})"/>{body(uid + "b", spec, style, 150, cut)}'
            f'<rect x="1" y="1" width="254" height="254" rx="56" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2"/></svg>')


def lockup(uid, spec, dark=True):
    cap = 80
    c1, c2 = ("#F5F8FF", "#8C96AA") if dark else ("#07090F", "#5A6478")
    d1, w1 = text("Klaro", "Geist", cap, x=300, base=168, tracking=-cap * 0.03, wght=600)
    d2, w2 = text("Player", "Geist", cap, x=300 + w1 + cap * 0.26, base=168, tracking=-cap * 0.02, wght=400)
    W = 300 + w1 + cap * 0.26 + w2 + 20
    return (f'<svg viewBox="0 0 {f(W)} 256">{body(uid, spec, "night" if dark else "paper", 200, "#0B0F1A" if dark else "#fff")}'
            f'<path fill="{c1}" d="{d1}"/><path fill="{c2}" d="{d2}"/></svg>')


def mono_svg(uid, spec, tone="mono", bg=None):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">{body(uid, spec, tone, 170, bg)}</svg>'


cards = ""
for key, name, idea, risk, spec in V:
    (OUT / f"{key.lower()}-colour.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">{body(key + "m", spec, "paper", 170)}</svg>')
    (OUT / f"{key.lower()}-black.svg").write_text(mono_svg(key + "k", spec))
    big = tile(key + "I", spec, "ice", 200, 44)
    dark = tile(key + "N", spec, "night", 96, 21)
    small = tile(key + "s", spec, "ice", 32, 7) + tile(key + "t", spec, "night", 32, 7)
    blk = mono_svg(key + "z", spec).replace("<svg ", '<svg style="width:32px;height:32px" ', 1).replace('width="256" height="256"', "", 1)
    blk16 = mono_svg(key + "y", spec).replace("<svg ", '<svg style="width:16px;height:16px" ', 1).replace('width="256" height="256"', "", 1)
    cards += f"""<div class="card"><div class="top"><span class="k">{key}</span><span class="n">{name}</span></div>
      <div class="hero">{big}<div class="side">{dark}<div class="sm">{small}</div><div class="sm light">{blk}{blk16}</div></div></div>
      <div class="lock">{lockup(key + "L", spec)}</div>
      <div class="idea">{idea}</div><div class="risk">Rizik: {risk}</div></div>"""

html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: Geist; src: url('{FONT}'); font-weight: 100 900; }}
* {{ box-sizing: border-box; margin: 0; }}
body {{ width: 1600px; background: #05070D; color: #F5F8FF; font-family: Geist, sans-serif; -webkit-font-smoothing: antialiased; padding: 64px 80px 80px;
       background-image: radial-gradient(900px 500px at 12% 0%, rgba(51,102,255,.2), transparent 60%); }}
.eyebrow {{ font-size: 14px; letter-spacing: .18em; text-transform: uppercase; color: #7F8AA3; }}
h1 {{ font-size: 46px; font-weight: 650; letter-spacing: -.035em; margin-top: 12px; }}
.sub {{ font-size: 19px; color: #AEB7C9; margin-top: 12px; }}
.grid {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 40px; }}
.card {{ background: #0B0F1A; border-radius: 28px; padding: 28px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); }}
.top {{ display: flex; gap: 10px; align-items: baseline; }}
.k {{ font-size: 20px; font-weight: 650; color: #9BE7FF; }}
.n {{ font-size: 20px; font-weight: 560; letter-spacing: -.02em; }}
.hero {{ display: flex; gap: 20px; margin-top: 22px; align-items: flex-start; }}
.hero > svg {{ box-shadow: 0 24px 48px rgba(0,0,0,.5); }}
.side {{ display: flex; flex-direction: column; gap: 14px; }}
.side > svg {{ box-shadow: 0 12px 26px rgba(0,0,0,.4); }}
.sm {{ display: flex; gap: 10px; align-items: flex-end; }}
.sm.light {{ background: #fff; border-radius: 10px; padding: 8px 10px; width: max-content; }}
.lock svg {{ height: 44px; width: auto; display: block; margin: 26px 0 18px; }}
.idea {{ font-size: 16px; line-height: 1.4; color: #D8DEEA; min-height: 45px; }}
.risk {{ font-size: 13.5px; color: #FFB86B; margin-top: 8px; }}
</style></head><body>
<div class="eyebrow">Klaro Player · KP monogram</div>
<h1>K + P: dva slova, dve boje, jedan presek.</h1>
<div class="sub">Po ideji PayPal znaka, ali sa našim slovima, bojama i pločicom. Presek je treća boja.</div>
<div class="grid">{cards}</div>
</body></html>"""
(ROOT / "klaro-2026-kp.html").write_text(html)
print("ok")
