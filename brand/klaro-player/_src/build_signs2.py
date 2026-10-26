"""Round after the wordmark round (rejected: 'looks like Klarna').

Signs only — no K monogram (Kodi), no play (Google Play / category cliché), no TV frame, no circle (Claro),
no bold black wordmark (Klarna). The symbol leads; the name is set light next to it.
"""
import math
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import io, contextlib  # noqa: E402
with contextlib.redirect_stdout(io.StringIO()):
    from build_options import arch_pts, pill  # noqa: E402
from marks import clip_convex, f, halfplane, poly, rrect  # noqa: E402
from typekit import text  # noqa: E402

FONT = (HERE / "fonts" / "Geist[wght].ttf").as_uri()
OUT = ROOT / "concepts" / "signs2"
OUT.mkdir(parents=True, exist_ok=True)
INK = "#07090F"


# ------------------------------------------------------------------ signs: list of (path d, opacity)
def window():
    """Arch cut by one horizontal line of light: a clear view on a stable base."""
    w, h = 148, 184
    x0, y0 = 128 - w / 2, 128 - h / 2
    body = arch_pts(x0, y0, w, h, 22)
    yg, g = y0 + h * 0.70, 7
    top = clip_convex(body, halfplane((0, yg - g), (1, 0), (128, 0)))
    bot = clip_convex(body, halfplane((0, yg + g), (1, 0), (128, 256)))
    return [(poly(top), 1), (poly(bot), 1)]


def panes():
    """Three glass panes, one behind the other: one setup, every screen."""
    s, r, o = 120, 30, 26
    return [(rrect(128 - s / 2 + o, 128 - s / 2 - o, s, s, r), .28),
            (rrect(128 - s / 2, 128 - s / 2, s, s, r), .55),
            (rrect(128 - s / 2 - o, 128 - s / 2 + o, s, s, r), 1)]


def trail():
    """A block that moves on and leaves a trail: your stuff follows you."""
    h, r = 132, 30
    y = 128 - h / 2
    parts = [(rrect(40, y + 22, 16, h - 44, 8), .35), (rrect(66, y + 10, 26, h - 20, 12), .65),
             (rrect(102, y, h - 16, h, r), 1)]
    return parts


def bookmark():
    """A bookmark: your place is kept, on every screen."""
    x0, x1, y0, y1, notch = 76, 180, 44, 212, 46
    pts = [(x0, y0), (x1, y0), (x1, y1), (128, y1 - notch), (x0, y1)]
    from marks import rpoly
    return [(rpoly(pts, [26, 26, 10, 8, 10]), 1)]


def glint():
    """The shine on clean glass: 'klaro' = clear."""
    return [(pill((70, 166), (150, 86), 21), 1), (pill((136, 196), (186, 146), 21), 1)]


def focus():
    """Two corners frame what matters: everything else falls away."""
    t, L, r = 34, 92, 14
    a0, a1 = 52, 204
    c1 = [(a0, a0), (a0 + L, a0), (a0 + L, a0 + t), (a0 + t, a0 + t), (a0 + t, a0 + L), (a0, a0 + L)]
    c2 = [(a1, a1), (a1 - L, a1), (a1 - L, a1 - t), (a1 - t, a1 - t), (a1 - t, a1 - L), (a1, a1 - L)]
    from marks import rpoly
    return [(rpoly(c1, [r, 10, 10, 6, 10, 10]), 1), (rpoly(c2, [r, 10, 10, 6, 10, 10]), 1)]


S = [
    ("S1", "Prozor", "Luk presečen jednom linijom svetla: čist pogled na stabilnoj osnovi.", "vrata / nadgrobni kamen, ako se ne pazi na proporcije", window()),
    ("S2", "Slojevi", "Tri staklena panela jedan iza drugog: jedno podešavanje, svaki ekran.", "ikonica „slojevi“ (npr. Buffer); zahteva providnost", panes()),
    ("S3", "Trag", "Blok ide dalje i ostavlja trag: sve tvoje ide za tobom.", "„brzo“ (kuriri, dostava)", trail()),
    ("S4", "Obeleživač", "Traka za knjigu: tvoje mesto je sačuvano, na svakom ekranu.", "Pocket / bookmark ikonica", bookmark()),
    ("S5", "Odsjaj", "Odsjaj na čistom staklu: „klaro“ = bistro.", "kose crte „//“", glint()),
    ("S6", "Fokus", "Dva ugla uokviruju ono što je bitno; sve ostalo nestaje.", "ikonica za skeniranje / fullscreen", focus()),
]


# ------------------------------------------------------------------ rendering
def glass(uid, parts, variant="dark"):
    if variant == "dark":
        bg0, bg1, glow, m0, m1 = "#1B2F6E", "#05070D", "#3D6BFF", "#FFFFFF", "#9BE7FF"
    else:  # ice
        bg0, bg1, glow, m0, m1 = "#EAFBFF", "#A5E9FF", "#FFFFFF", "#3D6BFF", "#1633B8"
    paths = "".join(f'<path d="{d}" fill-opacity="{o}"/>' for d, o in parts)
    solid = "".join(f'<path d="{d}"/>' for d, o in parts if o == 1)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
<defs>
  <radialGradient id="bg{uid}" cx="30%" cy="18%" r="95%"><stop offset="0" stop-color="{bg0}"/><stop offset="1" stop-color="{bg1}"/></radialGradient>
  <linearGradient id="mk{uid}" x1="0" y1="40" x2="0" y2="220" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{m0}"/><stop offset="1" stop-color="{m1}"/></linearGradient>
  <linearGradient id="hl{uid}" x1="0" y1="30" x2="0" y2="130" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".7"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>
  <filter id="gl{uid}" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="14"/></filter>
  <filter id="sh{uid}" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#000" flood-opacity="{'.35' if variant == 'dark' else '.18'}"/></filter>
  <clipPath id="cl{uid}">{solid}</clipPath>
</defs>
<rect width="256" height="256" rx="57" fill="url(#bg{uid})"/>
<g fill="{glow}" opacity="{'.5' if variant == 'dark' else '.6'}" filter="url(#gl{uid})">{paths}</g>
<g fill="url(#mk{uid})" filter="url(#sh{uid})">{paths}</g>
<rect x="0" y="0" width="256" height="128" fill="url(#hl{uid})" clip-path="url(#cl{uid})" opacity=".5"/>
<rect x="1" y="1" width="254" height="254" rx="56" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="2"/>
</svg>'''


def mono(parts, c=INK):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">'
            + "".join(f'<path fill="{c}" fill-opacity="{o}" d="{d}"/>' for d, o in parts) + "</svg>")


def lockup(parts, c1, c2):
    cap = 80
    d1, w1 = text("Klaro", "Geist", cap, x=300, base=168, tracking=-cap * 0.03, wght=560)
    d2, w2 = text("Player", "Geist", cap, x=300 + w1 + cap * 0.26, base=168, tracking=-cap * 0.02, wght=380)
    W = 300 + w1 + cap * 0.26 + w2 + 20
    sym = "".join(f'<path fill="{c1}" fill-opacity="{o}" d="{d}"/>' for d, o in parts)
    return f'<svg viewBox="0 0 {f(W)} 256">{sym}<path fill="{c1}" d="{d1}"/><path fill="{c2}" d="{d2}"/></svg>'


def sized(svg, px, radius=None):
    rr = f";border-radius:{radius}px" if radius else ""
    return svg.replace("<svg ", f'<svg style="width:{px}px;height:{px}px{rr}" ', 1)


cards = ""
for key, name, idea, risk, parts in S:
    (OUT / f"{key.lower()}-{name.lower().replace('č', 'c').replace('ž', 'z')}.svg").write_text(
        mono(parts).replace("<svg ", '<svg width="256" height="256" ', 1))
    big = sized(glass(key + "d", parts), 220, 48)
    ice = sized(glass(key + "i", parts, "ice"), 96, 21)
    small = sized(glass(key + "s", parts), 32, 7) + sized(glass(key + "t", parts, "ice"), 32, 7)
    m = mono(parts)
    cards += f"""<div class="card"><div class="top"><span class="k">{key}</span><span class="n">{name}</span></div>
      <div class="hero">{big}<div class="side">{ice}<div class="sm">{small}</div><div class="sm light">{sized(m, 32)}{sized(m, 16)}</div></div></div>
      <div class="lock">{lockup(parts, "#F5F8FF", "#8C96AA")}</div>
      <div class="idea">{idea}</div><div class="risk">Može da podseti na: {risk}</div></div>"""

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
.sm.light {{ background: #F5F8FF; border-radius: 10px; padding: 8px 10px; width: max-content; }}
.lock svg {{ height: 40px; width: auto; display: block; margin: 26px 0 18px; }}
.idea {{ font-size: 16px; line-height: 1.4; color: #D8DEEA; min-height: 45px; }}
.risk {{ font-size: 13.5px; color: #FFB86B; margin-top: 8px; }}
</style></head><body>
<div class="eyebrow">Klaro Player · novi znakovi</div>
<h1>Bez K, bez play-a, bez TV-a, bez kruga.</h1>
<div class="sub">Znak vodi, ime stoji tiho pored njega (ne crni bold, zbog Klarne). Isti 2026 jezik: staklo, dubina, svetlo.</div>
<div class="grid">{cards}</div>
</body></html>"""
(ROOT / "klaro-2026-signs2.html").write_text(html)
print("ok")
