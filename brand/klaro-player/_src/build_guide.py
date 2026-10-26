"""One-page usage guide for the Klaro Player logo -> kit/klaro-brand-guide.html (+ .png via headless Chrome)."""
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import build_kit as bk  # noqa: E402
import klaro_sync as ks  # noqa: E402

KIT = ROOT / "kit"
SPEC = ks.A
RENDER = Path("/Users/filip/.claude/plugins/cache/logo-design-skill/logo-design/1.4.4/skills/logo-design/scripts/render_png.py")

COLOURS = [("Navy", bk.NAVY, "Znak (donji panel), tekst, tamne podloge"),
           ("Blue", bk.BLUE, "Znak (gornji panel), akcenat, fokus"),
           ("Mist", bk.MIST, "Pločica app ikone, svetle podloge"),
           ("White", bk.WHITE, "Podloga; tamni panel na tamnoj podlozi")]


# ------------------------------------------------------------------ colour maths
def rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def lum(h):
    def ch(c):
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = map(ch, rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def cmyk(h):
    r, g, b = (v / 255 for v in rgb(h))
    k = 1 - max(r, g, b)
    if k >= 1:
        return (0, 0, 0, 100)
    return tuple(round(v * 100) for v in ((1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k))


# ------------------------------------------------------------------ svg snippets
def strip(svg_text, cls=""):
    """Inline an svg with responsive sizing (keeps its viewBox)."""
    s = re.sub(r'\swidth="[\d.]+" height="[\d.]+"', "", svg_text, count=1)
    return s.replace("<svg ", f'<svg class="{cls}" ', 1)


def construction():
    """Symbol with its construction: one shared 30° line, vertical sides, radii, x = panel width."""
    fac, k, _ = ks.fit(SPEC, 300, 260, 205)
    P = fac()
    p = P._p
    nd, bd = ks.mark_d(SPEC, fac)
    s = SPEC
    t = ks.T30
    lines = []
    a, b = p((-0.35, -0.35 * t)), p((s.DX + s.W + 0.35, t * (s.DX + s.W + 0.35)))
    lines.append(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" class="c-key"/>')
    for x in (0, s.W, s.DX, s.DX + s.W):
        a, b = p((x, -s.DY - 0.25)), p((x, s.H + t * s.W + 0.25))
        lines.append(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" class="c-line"/>')
    yt = 2 * s.R * ks.C30 - s.R
    a, b = p((-0.3, yt)), p((s.DX + 0.1, yt))
    lines.append(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" class="c-line"/>')
    # x dimension under navy
    y = s.H + t * s.W + 0.18
    a, b = p((0, y)), p((s.W, y))
    lines.append(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" class="c-dim"/>'
                 f'<text x="{(a[0] + b[0]) / 2:.1f}" y="{a[1] + 22:.1f}" class="c-txt" text-anchor="middle">x</text>')
    c = p((s.DX + s.W + 0.12, t * (s.DX + s.W + 0.12)))
    lines.append(f'<text x="{c[0]:.1f}" y="{c[1] - 10:.1f}" class="c-txt">30°</text>')
    c = p((s.R * 0.1, s.R * 1.4))
    lines.append(f'<text x="{c[0] - 44:.1f}" y="{c[1]:.1f}" class="c-txt">R</text>')
    c = p((s.W - 0.02, s.H + t * s.W - 0.1))
    lines.append(f'<text x="{c[0] + 16:.1f}" y="{c[1] + 30:.1f}" class="c-txt">R</text>')
    c = p((0, s.H))
    lines.append(f'<text x="{c[0] - 44:.1f}" y="{c[1] + 12:.1f}" class="c-txt">r</text>')
    c = p((s.DX + s.W, -s.DY + t * s.W))
    lines.append(f'<text x="{c[0] + 14:.1f}" y="{c[1] + 6:.1f}" class="c-txt">r</text>')
    return (f'<svg viewBox="0 0 520 440" class="construct"><path d="{nd}" class="c-navy"/><path d="{bd}" class="c-blue"/>'
            f'{"".join(lines)}</svg>')


def motion_frames():
    frames = []
    for i, (d, split, cap, sub) in enumerate(((0.32, True, "1. Odvojeno", "jedan nalog"),
                                              (0.0, True, "2. Spajanje", "predaja"),
                                              (0.0, False, "3. U sinhronizaciji", "One setup. Every screen."))):
        fac, k, _ = ks.fit(SPEC, 150, 120, 110)
        nd, bd = ks.mark_d(SPEC, fac, split=split)
        dx, dy = 0.5 * d * k, -ks.C30 * d * k
        frames.append(
            f'<figure class="frame"><svg viewBox="0 0 240 220">'
            f'<path d="{nd}" fill="var(--navy-mark)" transform="translate({-dx:.1f} {-dy:.1f})"/>'
            f'<path d="{bd}" fill="{bk.BLUE}" transform="translate({dx:.1f} {dy:.1f})"/></svg>'
            f'<figcaption><b>{cap}</b><span>{sub}</span></figcaption></figure>')
    return '<span class="arrow">→</span>'.join(frames)


def live_motion():
    fac, k, _ = ks.fit(SPEC, 150, 120, 110)
    nd, bd = ks.mark_d(SPEC, fac)
    ns, bs = ks.mark_d(SPEC, fac, split=True)
    d = 0.32 * k
    return (f'<svg viewBox="0 0 240 220" class="live" style="--dx:{0.5 * d:.1f}px;--dy:{-ks.C30 * d:.1f}px">'
            f'<path d="{nd}" fill="var(--navy-mark)" class="lv-n"/><path d="{bd}" fill="{bk.BLUE}" class="lv-b"/></svg>')


def misuse():
    fac, k, _ = ks.fit(SPEC, 110, 80, 80)
    nd, bd = ks.mark_d(SPEC, fac)
    base = lambda nf, bf, extra="", g="": (f'<svg viewBox="0 0 160 160"><g {g}><path d="{nd}" fill="{nf}" {extra}/>'
                                           f'<path d="{bd}" fill="{bf}" {extra}/></g></svg>')
    items = [
        (base(bk.NAVY, bk.BLUE, g='transform="rotate(-18 80 80)"'), "Ne rotirati"),
        (base(bk.BLUE, bk.NAVY), "Ne menjati redosled boja"),
        (base(bk.NAVY, bk.BLUE, g='transform="translate(80 80) scale(1.35 0.8) translate(-80 -80)"'), "Ne razvlačiti"),
        (f'<svg viewBox="0 0 160 160"><defs><linearGradient id="mg" x1="0" y1="0" x2="1" y2="1">'
         f'<stop offset="0" stop-color="#7B5CFF"/><stop offset="1" stop-color="#FF5C8A"/></linearGradient>'
         f'<filter id="ms"><feDropShadow dx="4" dy="6" stdDeviation="4" flood-opacity=".45"/></filter></defs>'
         f'<g filter="url(#ms)"><path d="{nd}" fill="url(#mg)"/><path d="{bd}" fill="url(#mg)"/></g></svg>',
         "Bez gradijenata i senki"),
        (base("none", "none", extra=f'stroke="{bk.NAVY}" stroke-width="3"'), "Bez kontura"),
        (f'<svg viewBox="0 0 160 160"><rect width="160" height="160" rx="12" fill="{bk.NAVY}"/>'
         f'<path d="{nd}" fill="{bk.NAVY}" stroke="#1A2540"/><path d="{bd}" fill="{bk.BLUE}"/></svg>',
         "Navy znak ne ide na tamno"),
        (f'<svg viewBox="0 0 160 160"><path d="{nd}" fill="{bk.NAVY}" transform="translate(-14 16)"/>'
         f'<path d="{bd}" fill="{bk.BLUE}" transform="translate(12 -8)"/></svg>', "Ne rastavljati panele"),
        (f'<svg viewBox="0 0 160 160"><g transform="translate(160 0) scale(-1 1)"><path d="{nd}" fill="{bk.NAVY}"/>'
         f'<path d="{bd}" fill="{bk.BLUE}"/></g></svg>', "Ne preslikavati"),
    ]
    return "".join(f'<figure class="bad">{s}<figcaption>{t}</figcaption></figure>' for s, t in items)


def backgrounds():
    rows = [("colour", bk.WHITE, "Boja na beloj"), ("colour", bk.MIST, "Boja na Mist"),
            ("dark", bk.NAVY, "Tamna varijanta na Navy"), ("mono-white", bk.BLUE, "Bela, jedna boja, na Blue"),
            ("mono-black", bk.WHITE, "Crna, jedna boja"), ("mono-white", "#2B2F36", "Bela na fotografiji / tamnom")]
    out = []
    for way, bg, cap in rows:
        body = re.sub(r"^<svg[^>]*>|</svg>\s*$", "", bk.lockup_horizontal(SPEC, way).strip())
        vb = re.search(r'viewBox="([^"]+)"', bk.lockup_horizontal(SPEC, way)).group(1)
        dk = " on-dark" if lum(bg) < 0.3 else ""
        out.append(f'<figure class="bg{dk}" style="background:{bg}"><svg viewBox="{vb}">{body}</svg>'
                   f'<figcaption>{cap}</figcaption></figure>')
    return "".join(out)


def colour_cards():
    out = []
    for name, h, use in COLOURS:
        r, g, b = rgb(h)
        c, m, y, k = cmyk(h)
        dark = lum(h) < 0.3
        cw, cn = contrast(h, bk.WHITE), contrast(h, bk.NAVY)
        out.append(
            f'<div class="swatch"><div class="chip" style="background:{h};color:{"#fff" if dark else bk.NAVY}">'
            f'<b>{name}</b><span>{h}</span></div><dl>'
            f'<dt>RGB</dt><dd>{r} {g} {b}</dd><dt>CMYK*</dt><dd>{c} {m} {y} {k}</dd>'
            f'<dt>Kontrast</dt><dd>{cw:.1f}:1 na beloj · {cn:.1f}:1 na Navy</dd></dl><p>{use}</p></div>')
    return "".join(out)


def icon(path, cls="ic"):
    return f'<img class="{cls}" src="{path}" alt="">'


# ------------------------------------------------------------------ page
def page():
    hz = strip(bk.lockup_horizontal(SPEC, "colour"), "lk")
    hz_tag = strip(bk.lockup_horizontal(SPEC, "colour", tagline=True), "lk")
    st = strip(bk.lockup_stacked(SPEC, "colour"), "lk st")
    sym = strip(bk.symbol_file(SPEC, "colour"), "lk sym")
    wm = strip(bk.wordmark(SPEC, "colour"), "lk wm")
    hero = strip(bk.lockup_horizontal(SPEC, "dark", tagline=True), "hero-lk")
    # clear space diagram: the horizontal lockup file already carries ½x padding on every side
    cs = bk.lockup_horizontal(SPEC, "colour")
    vbw, vbh = map(float, re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', cs).groups())
    _, _, kk = bk.symbol(SPEC, "colour", 0, 0, bk.HS, by="h")
    half = 0.5 * SPEC.W * kk
    cs_body = re.sub(r"^<svg[^>]*>|</svg>\s*$", "", cs.strip())
    clear = (f'<svg viewBox="-10 -10 {vbw + 20:.0f} {vbh + 20:.0f}" class="clear">'
             f'<rect x="0" y="0" width="{vbw}" height="{vbh}" class="cs-zone"/>'
             f'<rect x="{half:.1f}" y="{half:.1f}" width="{vbw - 2 * half:.1f}" height="{vbh - 2 * half:.1f}" class="cs-art"/>'
             f'{cs_body}'
             f'<text x="{half / 2:.1f}" y="{vbh / 2 + 14:.1f}" class="cs-t" text-anchor="middle">½x</text>'
             f'<text x="{vbw - half / 2:.1f}" y="{vbh / 2 + 14:.1f}" class="cs-t" text-anchor="middle">½x</text>'
             f'<text x="{vbw / 2:.1f}" y="{half / 2 + 14:.1f}" class="cs-t" text-anchor="middle">½x</text></svg>')

    return f"""<!doctype html>
<html lang="sr-Latn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Klaro Player Logo Guide</title>
<style>
@font-face{{font-family:"Inter Tight";src:url("../_src/fonts/InterTight[wght].ttf") format("truetype");font-weight:100 900}}
:root{{--navy:{bk.NAVY};--blue:{bk.BLUE};--mist:{bk.MIST};--paper:#FFFFFF;--ink:{bk.NAVY};--muted:#5B6479;--line:#E3E7EF;
--navy-mark:{bk.NAVY}}}
*{{box-sizing:border-box;margin:0}}
body{{background:var(--mist);color:var(--ink);font:15px/1.5 "Inter Tight",Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}}
.page{{max-width:1480px;margin:0 auto;padding:32px 40px 48px}}
header.hero{{background:var(--navy);color:#fff;border-radius:28px;padding:44px 52px;display:grid;grid-template-columns:1.4fr 1fr;gap:40px;align-items:center}}
.hero-lk{{width:100%;height:auto;max-width:620px}}
.hero .meta{{color:#AFC0E0;font-size:15px}} .hero .meta b{{color:#fff;font-size:22px;display:block;margin-bottom:6px;font-weight:600}}
.hero .live{{width:220px;height:auto;justify-self:end;--navy-mark:#fff}}
.grid{{display:grid;gap:20px;margin-top:20px}}
.g3{{grid-template-columns:1.1fr 1.3fr 1fr}} .g2{{grid-template-columns:1fr 1fr}} .g21{{grid-template-columns:1.6fr 1fr}}
section{{background:var(--paper);border-radius:22px;padding:26px 28px}}
h2{{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600;margin-bottom:16px}}
h2 i{{font-style:normal;color:var(--blue);margin-right:8px}}
p.lead{{font-size:16px;max-width:52ch}} p.small,figcaption{{font-size:13px;color:var(--muted)}}
.construct{{width:100%;height:auto}} .hero-sym{{width:100%;max-width:300px;height:auto;display:block;margin:18px auto 0}} .c-navy{{fill:var(--navy)}} .c-blue{{fill:var(--blue);opacity:.92}}
.c-line{{stroke:#9AA6BF;stroke-width:1;stroke-dasharray:4 4}} .c-key{{stroke:#FF4D6D;stroke-width:1.5}}
.c-dim{{stroke:var(--ink);stroke-width:1.5}} .c-txt{{font:600 16px "Inter Tight",sans-serif;fill:#FF4D6D}}
.versions{{display:grid;grid-template-columns:repeat(6,1fr);gap:14px;align-items:end}}
.versions figure{{border:1px solid var(--line);border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:10px;justify-content:space-between;min-height:170px}}
.versions .wide{{grid-column:span 2}} .lk{{width:100%;height:auto;max-height:110px}} .lk.sym{{max-height:96px}} .lk.st{{max-height:130px}}
.bgs{{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}}
.bg{{border-radius:14px;padding:22px 20px 12px;border:1px solid var(--line)}} .bg svg{{width:100%;height:auto;max-height:70px}}
.bg figcaption{{margin-top:8px}} .bg.on-dark figcaption{{color:#C9D3E6}}
.clear{{width:100%;height:auto}} .cs-zone{{fill:#EAF1FF;stroke:var(--blue);stroke-dasharray:6 6}} .cs-art{{fill:#fff}}
.cs-t{{font:600 40px "Inter Tight",sans-serif;fill:var(--blue)}}
table{{border-collapse:collapse;width:100%;font-size:14px;margin-top:14px}} td,th{{text-align:left;padding:7px 8px;border-top:1px solid var(--line)}} th{{color:var(--muted);font-weight:500}}
.swatches{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}}
.chip{{height:110px;border-radius:14px;padding:14px;display:flex;flex-direction:column;justify-content:space-between;border:1px solid var(--line)}}
.chip b{{font-size:18px}} .chip span{{font-family:ui-monospace,Menlo,monospace;font-size:14px}}
dl{{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:13px;margin:10px 2px 6px}} dt{{color:var(--muted)}}
.swatch p{{font-size:13px;color:var(--muted)}}
.type .sample{{font-size:54px;line-height:1.05;letter-spacing:-.02em}} .type .sample b{{font-weight:700}} .type .sample span{{font-weight:400}}
.type .tag{{font-weight:500;letter-spacing:.35em;font-size:13px;margin:12px 0 16px}}
.icons{{display:flex;gap:18px;align-items:flex-end;flex-wrap:wrap}}
.icons figure{{display:flex;flex-direction:column;gap:6px;align-items:flex-start}}
.ic{{width:112px;height:112px;border-radius:25px;box-shadow:0 1px 0 rgba(13,23,41,.06),0 8px 22px rgba(13,23,41,.10)}}
.ic.mac{{border-radius:0;box-shadow:none}} .ic.tv{{width:224px;height:126px;border-radius:12px}}
.ic.fav{{width:32px;height:32px;border-radius:0;box-shadow:none;image-rendering:pixelated}} .ic.fav16{{width:16px;height:16px;border-radius:0;box-shadow:none}}
.misuse{{display:grid;grid-template-columns:repeat(8,1fr);gap:12px}}
.bad{{border:1px solid var(--line);border-radius:14px;padding:8px 8px 10px;position:relative}} .bad svg{{width:100%;height:auto}}
.bad::after{{content:"✕";position:absolute;top:8px;right:10px;color:#E5484D;font-weight:700}}
.motion{{display:flex;align-items:center;gap:10px}} .frame{{flex:1;text-align:center}} .frame svg{{width:100%;max-width:190px;height:auto}}
.frame figcaption b{{display:block;color:var(--ink);font-size:14px}} .arrow{{color:var(--muted);font-size:24px}}
.lv-n,.lv-b{{animation:sync 3.6s cubic-bezier(.65,0,.35,1) infinite alternate}}
.lv-n{{--s:-1}} .lv-b{{--s:1}}
@keyframes sync{{0%,30%{{transform:none}}88%,100%{{transform:translate(calc(var(--s)*var(--dx)),calc(var(--s)*var(--dy)))}}}}
@media (prefers-reduced-motion:reduce){{.lv-n,.lv-b{{animation:none}}}}
footer{{margin-top:22px;color:var(--muted);font-size:13px;display:flex;justify-content:space-between}}
</style></head><body><div class="page">

<header class="hero">
  <div>{hero}</div>
  <div style="display:flex;align-items:center;gap:28px;justify-content:flex-end">
    <div class="meta"><b>Logo guide · v1.0</b>30. septembar 2026<br>klaroplayer.com</div>
    {live_motion()}
  </div>
</header>

<div class="grid g3">
  <section><h2><i>01</i>Znak</h2>
    <p class="lead">Dva ekrana koja dele jednu liniju. Plavi prelazi preko ramena tamnog: sadržaj prelazi sa uređaja na uređaj i ostaje u sinhronizaciji.</p>
    {strip(bk.symbol_file(SPEC, "colour", 512, 0.86), "hero-sym")}
    <p class="small" style="margin-top:12px">Znak je potpis. Ne objašnjava proizvod, već ga označava na svakom ekranu: telefon, TV, računar i web.</p></section>
  <section><h2><i>02</i>Konstrukcija</h2>{construction()}
    <p class="small">Stranice su vertikalne, ivice idu pod tačnih 30°. <b style="color:#FF4D6D">Jedna linija</b> je gornja ivica tamnog i donja ivica plavog panela. Oštri uglovi imaju R = ¼x, tupi r = ⅒x. Plava horizontala tangira vrh tamnog luka.</p></section>
  <section><h2><i>03</i>Pokret</h2><div class="motion">{motion_frames()}</div>
    <p class="small" style="margin-top:10px">Splash i intro: paneli dolaze po normali na zajedničku liniju i spajaju se. Trajanje 600–900 ms, ease-in-out. Kraj je uvek statičan znak.</p></section>
</div>

<section style="margin-top:20px"><h2><i>04</i>Verzije</h2>
  <div class="versions">
    <figure class="wide">{hz}<figcaption>Horizontalni · primarni</figcaption></figure>
    <figure class="wide">{hz_tag}<figcaption>Horizontalni sa sloganom · od 200 px širine</figcaption></figure>
    <figure>{st}<figcaption>Složeni</figcaption></figure>
    <figure>{sym}<figcaption>Samo znak · ikone, avatari</figcaption></figure>
  </div>
  <p class="small" style="margin-top:12px">Samo ime (<i>wordmark</i>) postoji za uske, tekstualne kontekste (npr. potpis u footeru, kredit u videu), uvek uz znak negde na istoj površini. „Klaro“ je Bold, „Player“ Regular. Ime se nikad ne kuca iznova, uvek se koristi fajl.</p>
</section>

<div class="grid g21">
  <section><h2><i>05</i>Svetla, tamna i jedna boja</h2><div class="bgs">{backgrounds()}</div>
    <p class="small" style="margin-top:12px">Na tamnoj podlozi Navy panel postaje beo, a plavi ostaje. U jednoj boji paneli se razdvajaju tankim razmakom (x/22) duž zajedničke linije. To je jedini način da oblik ostane čitljiv bez druge boje.</p></section>
  <section><h2><i>06</i>Slobodan prostor i minimum</h2>{clear}
    <p class="small">x = širina jednog panela. Oko logotipa ostavi najmanje ½x praznog prostora (fajlovi već imaju tu marginu).</p>
    <table><tr><th>Verzija</th><th>Ekran</th><th>Štampa</th></tr>
      <tr><td>Znak</td><td>16 px</td><td>5 mm</td></tr>
      <tr><td>Horizontalni</td><td>96 px širine</td><td>25 mm</td></tr>
      <tr><td>Sa sloganom</td><td>200 px širine</td><td>50 mm</td></tr>
      <tr><td>Složeni</td><td>64 px širine</td><td>18 mm</td></tr></table></section>
</div>

<div class="grid g2">
  <section><h2><i>07</i>Boje</h2><div class="swatches">{colour_cards()}</div>
    <p class="small" style="margin-top:10px">*CMYK je orijentaciona konverzija. Blue #0669FE je izvan CMYK opsega i u štampi ispada tamnije. Za štampu treba proof i Pantone uparen na fizičkom vodiču. Blue na beloj ima {contrast(bk.BLUE, bk.WHITE):.1f}:1, dovoljno za grafiku i veliki tekst; sitan tekst ide u Navy.</p></section>
  <section class="type"><h2><i>08</i>Tipografija</h2>
    <div class="sample"><b>Klaro</b> <span>Player</span></div>
    <div class="tag">ONE SETUP. EVERY SCREEN.</div>
    <p class="small">Inter Tight: Bold 700 za „Klaro“, Regular 400 za „Player“, Medium 500 sa širokim razmakom za slogan. Licenca SIL OFL 1.1 dozvoljava upotrebu u logou. Za UI i dugačak tekst predlažemo Inter ili Inter Tight (400/500/600).</p></section>
</div>

<div class="grid g21">
  <section><h2><i>09</i>Ikone aplikacije</h2>
    <div class="icons">
      <figure>{icon("icons/ios/AppIcon-1024-light.png")}<figcaption>iOS / Android · svetla</figcaption></figure>
      <figure>{icon("icons/ios/AppIcon-1024-dark.png")}<figcaption>tamna</figcaption></figure>
      <figure>{icon("icons/ios/AppIcon-1024-tinted.png")}<figcaption>tinted</figcaption></figure>
      <figure>{icon("icons/desktop/macos-1024.png", "ic mac")}<figcaption>macOS</figcaption></figure>
      <figure>{icon("icons/tv/tv-banner-1280x720-dark.png", "ic tv")}<figcaption>TV baner 16:9</figcaption></figure>
      <figure><span style="display:flex;gap:14px;align-items:flex-end">{icon("icons/web/favicon-32.png", "ic fav")}{icon("icons/web/favicon-16.png", "ic fav16")}</span><figcaption>favicon 32 / 16</figcaption></figure>
    </div>
    <p class="small" style="margin-top:12px">Pločica je Mist (svetla), a u tamnom režimu Navy. Znak zauzima 60 % pločice. Android koristi adaptivnu ikonu (foreground, background i monochrome); maskable web ikona drži znak unutar sigurnog kruga.</p></section>
  <section><h2><i>10</i>Pogrešna upotreba</h2><div class="misuse" style="grid-template-columns:repeat(4,1fr)">{misuse()}</div></section>
</div>

<footer><span>Klaro Player · One setup. Every screen.</span><span>Master fajlovi: brand/klaro-player/kit · izvor: _src/build_kit.py</span></footer>
</div></body></html>
"""


def main():
    html = KIT / "klaro-brand-guide.html"
    html.write_text(page())
    subprocess.run([sys.executable, str(RENDER), str(html), "-o", str(KIT / "klaro-brand-guide.png"),
                    "--width", "1480", "--height", "2640"], check=True)


if __name__ == "__main__":
    main()
