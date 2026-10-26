"""Klaro Player — 2026 round: masters + a cinematic presentation (HTML -> PNG via headless Chrome).

Hero concept: CUT PLAY — the silhouette is a play button; two cuts inside it write a K.
Alternates (type-led): SLANT K (Geist, only the K leans forward) and CHARACTER K (Bricolage Grotesque).
"""
import math
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from marks import PAL, cut_play, f, poly, rrect, slant_k, svg  # noqa: E402
from typekit import bounds, glyph, text  # noqa: E402

OUT = ROOT / "concepts"
OUT.mkdir(exist_ok=True)
P = PAL
CP = cut_play(gap=12, stem_ratio=0.30, r=20)
PIECES = [CP["stem"], CP["upper"], CP["lower"], CP["head"]]
TILE_R = 57          # ~22% corner radius on a 256 tile


def cut_play_body(c):
    return "".join(f'<path fill="{c}" d="{poly(p)}"/>' for p in PIECES)


def char_k(cap=172):
    x0, y0, x1, y1 = bounds("K", "Bricolage", cap, wght=780, opsz=96, wdth=92)
    d, _ = glyph("K", "Bricolage", cap, x=128 - (x0 + x1) / 2, base=128 + cap / 2, wght=780, opsz=96, wdth=92)
    return d


# ------------------------------------------------------------------ glass app icons (presentation renders)
def glass_icon(uid, mark_paths, variant="dark"):
    """Layered 'liquid glass' icon: deep tile + luminous glass mark + specular highlight + rim light."""
    if variant == "dark":
        bg0, bg1, glow = "#1B2F6E", "#05070D", "#3D6BFF"
        m0, m1 = "#FFFFFF", "#9BE7FF"
    else:
        bg0, bg1, glow = "#FFFFFF", "#DDE6F5", "#3366FF"
        m0, m1 = "#4D7CFF", "#1E3FCC"
    clip = "".join(f'<path d="{d}"/>' for d in mark_paths)
    marks = "".join(f'<path d="{d}"/>' for d in mark_paths)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
<defs>
  <radialGradient id="bg{uid}" cx="30%" cy="18%" r="95%"><stop offset="0" stop-color="{bg0}"/><stop offset="1" stop-color="{bg1}"/></radialGradient>
  <linearGradient id="mk{uid}" x1="0" y1="40" x2="0" y2="220" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{m0}"/><stop offset="1" stop-color="{m1}"/></linearGradient>
  <linearGradient id="hl{uid}" x1="0" y1="30" x2="0" y2="130" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".75"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>
  <linearGradient id="rim{uid}" x1="0" y1="0" x2="0" y2="256" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".35"/><stop offset=".5" stop-color="#FFFFFF" stop-opacity=".04"/><stop offset="1" stop-color="#FFFFFF" stop-opacity=".12"/></linearGradient>
  <filter id="gl{uid}" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="14"/></filter>
  <filter id="sh{uid}" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#000" flood-opacity=".35"/></filter>
  <clipPath id="cl{uid}">{clip}</clipPath>
</defs>
<rect width="256" height="256" rx="{TILE_R}" fill="url(#bg{uid})"/>
<g fill="{glow}" opacity="{'.55' if variant == 'dark' else '.25'}" filter="url(#gl{uid})">{marks}</g>
<g fill="url(#mk{uid})" filter="url(#sh{uid})">{marks}</g>
<rect x="0" y="0" width="256" height="128" fill="url(#hl{uid})" clip-path="url(#cl{uid})" opacity=".55"/>
<rect x="1" y="1" width="254" height="254" rx="{TILE_R - 1}" fill="none" stroke="url(#rim{uid})" stroke-width="2"/>
</svg>'''


def flat_icon(body, bg):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="{TILE_R}" fill="{bg}"/>{body}</svg>'


# ------------------------------------------------------------------ wordmarks (outlined Geist / Bricolage)
def wordmark_geist(x, base, cap, c1, c2, slant_k_letter=False):
    kern = {"Kl": -cap * 0.02}
    if slant_k_letter:
        dk, wk = glyph("K", "Geist", cap, x=x, base=base, skew=12, wght=650)
        d1, w1 = text("laro", "Geist", cap, x=x + wk - cap * 0.02, base=base, tracking=-cap * 0.035, wght=650)
        w1 += wk - cap * 0.02
        d1 = dk + " " + d1
    else:
        d1, w1 = text("Klaro", "Geist", cap, x=x, base=base, tracking=-cap * 0.035, kern=kern, wght=650)
    d2, w2 = text("Player", "Geist", cap, x=x + w1 + cap * 0.26, base=base, tracking=-cap * 0.025, wght=400)
    return f'<path fill="{c1}" d="{d1}"/><path fill="{c2}" d="{d2}"/>', w1 + cap * 0.26 + w2


def wordmark_bricolage(x, base, cap, c1, c2):
    ax = dict(wght=760, opsz=96, wdth=92)
    d1, w1 = text("Klaro", "Bricolage", cap, x=x, base=base, tracking=-cap * 0.03, **ax)
    d2, w2 = text("Player", "Bricolage", cap, x=x + w1 + cap * 0.24, base=base, tracking=-cap * 0.02, wght=420, opsz=96, wdth=92)
    return f'<path fill="{c1}" d="{d1}"/><path fill="{c2}" d="{d2}"/>', w1 + cap * 0.24 + w2


def lockup(symbol_body, wm_fn, dark=True, **kw):
    c1 = P["white"] if dark else P["ink"]
    c2 = "#9AA4B8" if dark else "#5A6478"
    wm, ww = wm_fn(300, 128 + 40, 80, c1, c2, **kw)
    W = 300 + ww + 30
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(W)} 256" width="{f(W)}" height="256">{symbol_body}{wm}</svg>', W


# ------------------------------------------------------------------ write masters
def write(name, content):
    (OUT / name).write_text(content)


write("cut-play-mono.svg", svg(cut_play_body(P["ink"]), "Klaro Player — Cut Play, one colour"))
write("cut-play-blue.svg", svg(cut_play_body(P["blue"]), "Klaro Player — Cut Play, brand blue"))
write("cut-play-reversed.svg", svg(f'<rect width="256" height="256" fill="{P["ink"]}"/>' + cut_play_body(P["white"]), "Klaro Player — Cut Play, reversed"))
write("cut-play-icon-glass-dark.svg", glass_icon("a", [poly(p) for p in PIECES]))
write("cut-play-icon-glass-light.svg", glass_icon("b", [poly(p) for p in PIECES], "light"))
write("slant-k-icon-glass-dark.svg", glass_icon("c", [slant_k(cap=150, weight=700)]))
write("character-k-icon-glass-dark.svg", glass_icon("d", [char_k(150)]))
lk, _ = lockup(cut_play_body(P["white"]), wordmark_geist)
write("cut-play-lockup-dark.svg", lk)
lk, _ = lockup(cut_play_body(P["ink"]), wordmark_geist, dark=False)
write("cut-play-lockup-light.svg", lk)
print("masters ok")


# ------------------------------------------------------------------ presentation HTML
def inline(svg_text, cls="", style=""):
    return svg_text.replace("<svg ", f'<svg class="{cls}" style="{style}" ', 1)


def construction():
    H = 196; W = H * math.sqrt(3) / 2; x0 = 128 - W * 0.42
    tri = f"M{f(x0)} {f(128 - H / 2)} L{f(x0 + W)} 128 L{f(x0)} {f(128 + H / 2)} Z"
    xs = x0 + W * 0.30
    jx = xs + 6          # centre of both 45deg cuts (the stem's right edge + half the gap)
    pieces = "".join(f'<path d="{poly(p)}" fill="#3366FF" fill-opacity=".16" stroke="#9BE7FF" stroke-width="1.2"/>' for p in PIECES)
    guides = (f'<path d="{tri}" fill="none" stroke="#7F8AA3" stroke-width=".8" stroke-dasharray="4 4"/>'
              f'<line x1="{f(xs)}" y1="10" x2="{f(xs)}" y2="246" stroke="#7F8AA3" stroke-width=".8" stroke-dasharray="4 4"/>'
              f'<line x1="{f(jx - 70)}" y1="{f(128 + 70)}" x2="{f(jx + 118)}" y2="{f(128 - 118)}" stroke="#7F8AA3" stroke-width=".8" stroke-dasharray="4 4"/>'
              f'<line x1="{f(jx - 70)}" y1="{f(128 - 70)}" x2="{f(jx + 118)}" y2="{f(128 + 118)}" stroke="#7F8AA3" stroke-width=".8" stroke-dasharray="4 4"/>'
              f'<line x1="0" y1="128" x2="256" y2="128" stroke="#7F8AA3" stroke-width=".5" stroke-dasharray="2 5"/>')
    labels = ('<text x="178" y="60" fill="#9BE7FF" font-family="Geist" font-size="9">45°</text>'
              '<text x="178" y="206" fill="#9BE7FF" font-family="Geist" font-size="9">45°</text>'
              f'<text x="{f(xs + 4)}" y="22" fill="#9BE7FF" font-family="Geist" font-size="9">stem cut · 0.30 W</text>'
              '<text x="14" y="238" fill="#9BE7FF" font-family="Geist" font-size="9">equilateral · r20 · gap 12</text>')
    return f'<svg viewBox="0 0 256 256" width="100%" height="100%">{guides}{pieces}{labels}</svg>'


glass_dark = glass_icon("h1", [poly(p) for p in PIECES])
glass_light = glass_icon("h2", [poly(p) for p in PIECES], "light")
glass_slant = glass_icon("h3", [slant_k(cap=150, weight=700)])
glass_char = glass_icon("h4", [char_k(150)])
lock_dark, _ = lockup(cut_play_body(P["white"]), wordmark_geist)
lock_light, _ = lockup(cut_play_body(P["ink"]), wordmark_geist, dark=False)
def wordmark_only(fn, **kw):
    wm, ww = fn(10, 110, 80, P["white"], "#9AA4B8", **kw)
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(ww + 20)} 140" width="{f(ww + 20)}" height="140">{wm}</svg>'


lock_slant = wordmark_only(wordmark_geist, slant_k_letter=True)
lock_char = wordmark_only(wordmark_bricolage)
mono = svg(cut_play_body(P["ink"]), "mono")
blue = svg(cut_play_body(P["blue"]), "blue")
white = svg(cut_play_body(P["white"]), "white")


def generic_icon(i):
    hues = ["#2A3346", "#31283F", "#223A36", "#3B2F28", "#2B3140", "#263545", "#3A2A36"]
    return (f'<svg viewBox="0 0 256 256"><rect width="256" height="256" rx="{TILE_R}" fill="{hues[i % len(hues)]}"/>'
            f'<rect x="1" y="1" width="254" height="254" rx="{TILE_R - 1}" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="2"/></svg>')


# storyboard: pieces arrive from different "screens" and lock into the play
def frame(offsets, opacity=1.0, word=False):
    body = ""
    for pts, (dx, dy, rot) in zip(PIECES, offsets):
        cx = sum(x for x, _ in pts) / len(pts); cy = sum(y for _, y in pts) / len(pts)
        body += f'<g transform="translate({dx} {dy}) rotate({rot} {f(cx)} {f(cy)})"><path fill="#F5F8FF" fill-opacity="{opacity}" d="{poly(pts)}"/></g>'
    return f'<svg viewBox="-60 -40 376 336" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">{body}</svg>'


frames = [
    frame([(-70, 50, -18), (40, -70, 14), (60, 80, -10), (90, 10, 8)], .55),
    frame([(-24, 16, -6), (14, -24, 5), (20, 26, -4), (30, 4, 3)], .8),
    frame([(0, 0, 0)] * 4),
]
FONT = (HERE / "fonts" / "Geist[wght].ttf").as_uri()

tv_banners = "".join(
    f'<div class="banner" style="background:{c}"><span>{t}</span></div>'
    for c, t in [("#1d2433", "Settings"), ("#23202f", "Music")]
)

html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: Geist; src: url('{FONT}'); font-weight: 100 900; }}
* {{ box-sizing: border-box; margin: 0; }}
body {{ width: 1600px; background: #05070D; color: #F5F8FF; font-family: Geist, sans-serif; -webkit-font-smoothing: antialiased; }}
section {{ padding: 72px 96px; }}
.eyebrow {{ font-size: 14px; letter-spacing: .18em; text-transform: uppercase; color: #7F8AA3; }}
h1 {{ font-size: 64px; font-weight: 650; letter-spacing: -.035em; line-height: 1.02; margin-top: 18px; }}
h2 {{ font-size: 34px; font-weight: 600; letter-spacing: -.03em; }}
p.lead {{ font-size: 22px; color: #AEB7C9; max-width: 820px; line-height: 1.45; margin-top: 18px; letter-spacing: -.01em; }}
.hero {{ display: grid; grid-template-columns: 560px 1fr; gap: 72px; align-items: center; padding-top: 88px;
        background: radial-gradient(900px 600px at 18% 30%, rgba(51,102,255,.28), transparent 60%), radial-gradient(700px 500px at 85% 80%, rgba(155,231,255,.10), transparent 60%); }}
.hero svg.icon {{ width: 520px; height: 520px; border-radius: 116px; box-shadow: 0 60px 120px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.04); }}
.lock {{ height: 110px; width: auto; margin-top: 44px; }}
.grid4 {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-top: 36px; }}
.card {{ border-radius: 28px; padding: 36px; min-height: 300px; display: flex; flex-direction: column; justify-content: space-between; }}
.card .cap {{ font-size: 14px; color: #7F8AA3; letter-spacing: .02em; }}
.card svg {{ width: 150px; height: 150px; }}
.sizes {{ display: flex; align-items: center; gap: 28px; }}
.phone {{ width: 430px; height: 880px; border-radius: 64px; padding: 90px 34px; margin-top: 36px;
         background: radial-gradient(420px 380px at 20% 20%, #2a3f8a, transparent 70%), radial-gradient(420px 420px at 90% 85%, #0f6b7a, transparent 70%), #080b14;
         box-shadow: 0 0 0 12px #111521, 0 50px 100px rgba(0,0,0,.6); }}
.apps {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 30px 22px; }}
.app {{ text-align: center; font-size: 12px; color: #D9DEEA; }}
.app svg {{ width: 76px; height: 76px; display: block; margin: 0 auto 8px; border-radius: 18px; }}
.tv {{ border-radius: 28px; padding: 44px; margin-top: 36px; background: linear-gradient(180deg, #0B0F1A, #05070D); box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); }}
.row {{ display: flex; gap: 26px; align-items: center; }}
.banner {{ width: 220px; height: 124px; flex: none; border-radius: 18px; display: flex; align-items: flex-end; padding: 18px; font-size: 16px; color: #9AA4B8; }}
.banner.klaro {{ background: radial-gradient(300px 200px at 25% 20%, #24408f, #070a12 75%); width: 320px; height: 180px; outline: 3px solid #F5F8FF; outline-offset: 6px; align-items: center; justify-content: center; }}
.banner.klaro svg {{ height: 62px; width: auto; }}
.story {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-top: 36px; }}
.story div {{ background: #0B0F1A; border-radius: 24px; aspect-ratio: 16/10; display: flex; align-items: center; justify-content: center; box-shadow: inset 0 0 0 1px rgba(255,255,255,.05); }}
.story > div {{ padding: 28px; }} .story svg {{ width: 100%; height: 100%; }}
.story .last svg {{ width: 88%; height: auto; }}
.story-cap {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-top: 14px; font-size: 15px; color: #7F8AA3; }}
.alt {{ display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 36px; }}
.alt > div {{ background: #0B0F1A; border-radius: 28px; padding: 40px; display: flex; gap: 40px; align-items: center; box-shadow: inset 0 0 0 1px rgba(255,255,255,.05); }}
.alt svg.i {{ width: 150px; height: 150px; border-radius: 34px; flex: none; }}
.alt svg.l {{ height: 70px; width: auto; }}
.alt p {{ color: #8C96AA; font-size: 16px; margin-top: 14px; line-height: 1.45; }}
.split {{ display: grid; grid-template-columns: 430px 1fr; gap: 64px; }}
.palette {{ display: flex; gap: 14px; margin-top: 28px; }}
.sw {{ width: 150px; height: 120px; border-radius: 20px; padding: 16px; font-size: 13px; display: flex; flex-direction: column; justify-content: flex-end; }}
</style></head><body>

<section class="hero">
  <div>{inline(glass_dark, "icon")}</div>
  <div>
    <div class="eyebrow">Klaro Player · identity concept · 2026</div>
    <h1>The play button,<br>cut into a K.</h1>
    <p class="lead">From a distance it is the one sign everyone knows: play. Up close, two precise cuts write the K of Klaro. Four pieces, one shape — the same way your channels, favourites and progress come together on every screen.</p>
    {inline(lock_dark, "lock")}
  </div>
</section>

<section>
  <div class="eyebrow">Master mark</div>
  <div class="grid4">
    <div class="card" style="background:#F5F8FF;color:#07090F">{inline(mono)}<div class="cap" style="color:#5A6478">One colour</div></div>
    <div class="card" style="background:#3366FF">{inline(white)}<div class="cap" style="color:#DDE6FF">Reversed on Klaro Blue</div></div>
    <div class="card" style="background:#0B0F1A;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)">{inline(blue)}<div class="cap">Brand colour on night</div></div>
    <div class="card" style="background:#F5F8FF">
      <div class="sizes">{inline(mono, style="width:64px;height:64px")}{inline(mono, style="width:32px;height:32px")}{inline(mono, style="width:16px;height:16px")}</div>
      <div class="sizes">{inline(glass_dark, style="width:64px;height:64px;border-radius:14px")}{inline(glass_dark, style="width:32px;height:32px;border-radius:7px")}{inline(glass_dark, style="width:16px;height:16px;border-radius:4px")}</div>
      <div class="cap" style="color:#5A6478">64 · 32 · 16 px — play at a glance, K up close</div></div>
  </div>
</section>

<section class="split">
  <div>
    <div class="eyebrow">iOS 26 · Liquid Glass</div>
    <div class="phone"><div class="apps">
      {''.join(f'<div class="app">{generic_icon(i)}<span>App</span></div>' for i in range(5))}
      <div class="app">{glass_dark.replace('width="256" height="256"', '')}<span>Klaro</span></div>
      {''.join(f'<div class="app">{generic_icon(i + 5)}<span>App</span></div>' for i in range(6))}
    </div></div>
  </div>
  <div>
    <div class="eyebrow">TV launcher · 10-foot UI</div>
    <div class="tv"><div class="row">
      <div class="banner klaro">{lock_dark}</div>{tv_banners}
    </div></div>
    <div class="eyebrow" style="margin-top:56px">Light &amp; dark icon</div>
    <div class="row" style="margin-top:28px;gap:28px">{inline(glass_dark, style="width:180px;height:180px;border-radius:40px")}{inline(glass_light, style="width:180px;height:180px;border-radius:40px")}</div>
    <div class="eyebrow" style="margin-top:56px">Palette</div>
    <div class="palette">
      <div class="sw" style="background:#07090F;box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)">Night<br>#07090F</div>
      <div class="sw" style="background:#3366FF">Klaro Blue<br>#3366FF</div>
      <div class="sw" style="background:#9BE7FF;color:#07090F">Clear<br>#9BE7FF</div>
      <div class="sw" style="background:#F5F8FF;color:#07090F">Paper<br>#F5F8FF</div>
    </div>
  </div>
</section>

<section class="split" style="grid-template-columns: 1fr 1fr; align-items:center">
  <div style="background:#0B0F1A;border-radius:28px;padding:40px;aspect-ratio:1;box-shadow:inset 0 0 0 1px rgba(255,255,255,.05)">{construction()}</div>
  <div><div class="eyebrow">Construction</div><h2 style="margin-top:16px">One equilateral triangle.<br>Two cuts. Exact angles.</h2>
  <p class="lead">A vertical cut at 30% of the width is the stem. From its edge, two cuts at exactly 45° are the arm and the leg. Every gap is the same 12 units, every outer corner the same radius — so the mark stays calm and stable at 16 px and on a 75-inch TV.</p></div>
</section>

<section>
  <div class="eyebrow">Motion · splash / startup (≈1.2 s)</div>
  <div class="story">
    <div>{frames[0]}</div><div>{frames[1]}</div><div>{frames[2]}</div><div class="last">{lock_dark}</div>
  </div>
  <div class="story-cap"><span>1 · Four pieces arrive from different screens</span><span>2 · They snap together</span><span>3 · One shape: play</span><span>4 · The name settles in</span></div>
</section>

<section>
  <div class="eyebrow">Alternatives · type-led</div>
  <div class="alt">
    <div>{inline(glass_slant, "i")}<div>{inline(lock_slant, "l")}<p><b style="color:#F5F8FF">Slant K</b> — only the K leans forward, like pressing play. Swiss-clean (Geist).</p></div></div>
    <div>{inline(glass_char, "i")}<div>{inline(lock_char, "l")}<p><b style="color:#F5F8FF">Character K</b> — a contemporary grotesk with ink-trap detail (Bricolage Grotesque).</p></div></div>
  </div>
</section>
</body></html>"""
(ROOT / "klaro-2026.html").write_text(html)
print("html ok")
