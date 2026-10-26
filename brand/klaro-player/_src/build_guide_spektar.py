"""One-page usage guide for the Klaro Player 'Spektar' logo -> kit/klaro-brand-guide.html/.png."""
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import klaro_spektar as ks  # noqa: E402
from build_guide import contrast  # noqa: E402

KIT = ROOT / "kit"
RENDER = "/Users/filip/.claude/plugins/cache/logo-design-skill/logo-design/1.4.4/skills/logo-design/scripts/render_png.py"


def storyboard():
    src = ROOT / "_internal" / "motion"
    frames = [Image.open(src / f"intro-{t}.png").convert("RGB").resize((480, 270), Image.LANCZOS) for t in ("0.4", "1.0", "1.8", "4.0")]
    sb = Image.new("RGB", (4 * 480 + 3 * 12, 270), "#05080F")
    for i, f in enumerate(frames):
        sb.paste(f, (i * 492, 0))
    sb.save(KIT / "motion" / "klaro-intro-storyboard.png")


def construction():
    """Flat K with its three stroke axes, and the aura orbit with the hue order."""
    h, cx, cy = 300, 190, 210
    kd, (x0, y0, x1, y1) = ks.k_path(h, cx, cy)
    b = ks.KSHAPE.bounds
    s = h / max(b[2] - b[0], b[3] - b[1])
    mp = lambda x, y: ((x - (b[0] + b[2]) / 2) * s + cx, (y - (b[1] + b[3]) / 2) * s + cy)
    r, H = 0.16, 1.2
    j, t = (r, .70 * H), (1 - r, r)
    sp = (j[0] + (t[0] - j[0]) * .353, j[1] + (t[1] - j[1]) * .353)
    axes = [((r, r), (r, H - r)), (j, t), (sp, (1 - r, H - r))]
    lines = "".join(f'<line x1="{mp(*a)[0]:.1f}" y1="{mp(*a)[1]:.1f}" x2="{mp(*c)[0]:.1f}" y2="{mp(*c)[1]:.1f}" class="ax"/>'
                    f'<circle cx="{mp(*a)[0]:.1f}" cy="{mp(*a)[1]:.1f}" r="4" class="dot"/><circle cx="{mp(*c)[0]:.1f}" cy="{mp(*c)[1]:.1f}" r="4" class="dot"/>'
                    for a, c in axes)
    wpx = 0.32 * s
    orbit_cx, orbit_cy, R = 520, 210, 92
    import math
    dots = ""
    for i, (nm, c) in enumerate(ks.HUES):
        a = math.radians(180 + i * 60)
        x, y = orbit_cx + R * math.cos(a), orbit_cy + R * math.sin(a)
        dots += (f'<circle cx="{x:.1f}" cy="{y:.1f}" r="15" fill="{c}"/>'
                 f'<text x="{orbit_cx + (R + 40) * math.cos(a):.1f}" y="{orbit_cy + (R + 40) * math.sin(a) + 5:.1f}" class="lbl" text-anchor="middle">{i + 1}</text>')
    kd2, _ = ks.k_path(86, orbit_cx, orbit_cy)
    return (f'<svg viewBox="0 0 660 420" class="construct">'
            f'<path d="{kd}" class="kf"/>{lines}'
            f'<line x1="{x1 + 18:.1f}" y1="{y0:.1f}" x2="{x1 + 18:.1f}" y2="{y1:.1f}" class="dim"/>'
            f'<text x="{x1 + 28:.1f}" y="{(y0 + y1) / 2:.1f}" class="lbl">h</text>'
            f'<text x="{cx:.1f}" y="{y1 + 44:.1f}" class="lbl" text-anchor="middle">potez = {wpx / h:.2f} h · zaobljeni krajevi</text>'
            f'<circle cx="{orbit_cx}" cy="{orbit_cy}" r="{R}" class="orb"/><path d="{kd2}" class="kf"/>{dots}'
            f'<text x="{orbit_cx}" y="{orbit_cy + R + 84}" class="lbl" text-anchor="middle">6 boja na orbiti 0,127 h · krug 8 s</text></svg>')


def swatches():
    rows = [("Night", ks.NIGHT, "Podloga ikone (dno)"), ("Night top", ks.NIGHT_TOP, "Podloga ikone (vrh)"),
            ("Navy", ks.NAVY, "K na svetloj podlozi, tekst"), ("Mist", ks.MIST, "Svetle podloge"), ("White", ks.WHITE, "Stakleni K, tekst na tamnom")]
    out = "".join(f'<div class="sw"><i style="background:{c}"></i><b>{n}</b><code>{c}</code><span>{u}</span></div>' for n, c, u in rows)
    spec = "".join(f'<div class="hue"><i style="background:{c}"></i><b>{i + 1} · {n}</b><code>{c}</code></div>' for i, (n, c) in enumerate(ks.HUES))
    return out, spec


def misuse():
    kd, _ = ks.k_path(100, 80, 80)
    grad = "".join(f'<stop offset="{i / 5:.2f}" stop-color="{c}"/>' for i, (_, c) in enumerate(ks.HUES))
    items = [
        (f'<defs><linearGradient id="mg1" x1="0" x2="1">{grad}</linearGradient></defs><rect width="160" height="160" fill="#03060D"/>'
         f'<path d="{kd}" fill="url(#mg1)"/>', "Spektar ne ide u slovo"),
        (f'<rect width="160" height="160" fill="#F3F5F9"/><path d="{kd}" fill="#fff" stroke="#E4E9F2"/>', "Beli K ne ide na svetlo"),
        (f'<rect width="160" height="160" fill="#03060D"/><g transform="translate(80 80) scale(1.4 .8) translate(-80 -80)"><path d="{kd}" fill="#fff"/></g>', "Ne razvlačiti"),
        (f'<rect width="160" height="160" fill="#03060D"/><path d="{kd}" fill="#fff" transform="rotate(-15 80 80)"/>', "Ne rotirati"),
        (f'<rect width="160" height="160" fill="#03060D"/><path d="{kd}" fill="none" stroke="#FF2D55" stroke-width="6"/><path d="{kd}" fill="#fff"/>'
         f'<circle cx="126" cy="36" r="10" fill="#FFD60A"/>', "Bez novih boja i dodataka"),
        (f'<defs><linearGradient id="mg2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a5a3a"/><stop offset=".5" stop-color="#d9b48a"/>'
         f'<stop offset="1" stop-color="#3a6a4a"/></linearGradient></defs><rect width="160" height="160" fill="url(#mg2)"/><path d="{kd}" fill="#fff" opacity=".85"/>',
         "Aura ne ide na fotografiju"),
        (f'<rect width="160" height="160" fill="#03060D"/><path d="{kd}" fill="#fff"/><text x="80" y="150" font-size="14" fill="#fff" text-anchor="middle" '
         f'font-family="Inter Tight" letter-spacing="1">TV · IPTV · 4K</text>', "U ikoni samo PLAYER"),
        (f'<rect width="160" height="160" fill="#fff"/><path d="{kd}" fill="#0D1729"/><circle cx="80" cy="80" r="70" fill="none" stroke="#FF2D55" stroke-width="3" stroke-dasharray="4 6"/>',
         "Sjaj se ne štampa (koristi ravnu)"),
    ]
    return "".join(f'<figure class="bad"><svg viewBox="0 0 160 160">{s}</svg><figcaption>{t}</figcaption></figure>' for s, t in items)


def page():
    sw, spec = swatches()
    return f"""<!doctype html><html lang="sr-Latn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Klaro Player Logo Guide</title><style>
@font-face{{font-family:"Inter Tight";src:url("../_src/fonts/InterTight[wght].ttf") format("truetype");font-weight:100 900}}
:root{{--bg:#05080F;--panel:#0B1222;--line:#1B2640;--ink:#EEF3FF;--muted:#8C9AB8;--navy:{ks.NAVY}}}
*{{box-sizing:border-box;margin:0}}
body{{background:radial-gradient(1100px 600px at 12% -5%,#15264D,transparent 60%),radial-gradient(900px 600px at 100% 0%,#2B1030,transparent 55%),var(--bg);
color:var(--ink);font:15px/1.5 "Inter Tight",system-ui,sans-serif;-webkit-font-smoothing:antialiased}}
.page{{max-width:1560px;margin:0 auto;padding:34px 40px 44px}}
.hero{{display:grid;grid-template-columns:300px 1fr auto;gap:40px;align-items:center;border:1px solid var(--line);border-radius:30px;padding:34px 40px;
background:linear-gradient(135deg,#0E1830,#05080F)}}
.hero .icon{{width:300px;border-radius:22.5%;box-shadow:0 30px 70px rgba(0,0,0,.6)}}
.hero .lk{{width:100%;max-width:620px}} .hero .meta{{color:var(--muted);text-align:right}} .hero .meta b{{display:block;color:#fff;font-size:22px;font-weight:600}}
.tag{{letter-spacing:.34em;color:#C9D4EA;font-size:14px;margin-top:10px}}
.grid{{display:grid;gap:18px;margin-top:18px}} .g3{{grid-template-columns:1fr 1.3fr 1.2fr}} .g2{{grid-template-columns:1fr 1fr}} .g21{{grid-template-columns:1.55fr 1fr}}
section{{background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.015));border:1px solid var(--line);border-radius:24px;padding:24px 26px}}
h2{{font-size:12.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);font-weight:600;margin-bottom:14px}} h2 i{{font-style:normal;color:#fff;margin-right:8px}}
p{{color:#C9D4EA}} p.lead{{font-size:17px;color:#fff}} p.s{{font-size:13.5px;color:var(--muted);margin-top:10px}}
.construct{{width:100%;height:auto}} .kf{{fill:#1A2745}} .ax{{stroke:#FF2D55;stroke-width:2}} .dot{{fill:#FF2D55}} .dim{{stroke:#8C9AB8}}
.orb{{fill:none;stroke:#3A4B72;stroke-dasharray:4 5}} .lbl{{fill:#C9D4EA;font:500 14px "Inter Tight",sans-serif}}
.motion img{{width:100%;border-radius:14px;margin-top:4px}} .spec{{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;margin-top:12px;font-size:13.5px;color:#C9D4EA}}
.spec b{{color:#fff;font-weight:600}}
.vers{{display:grid;grid-template-columns:1.1fr 1.1fr .8fr .8fr .8fr .8fr;gap:14px;align-items:stretch}}
.vers figure{{border:1px solid var(--line);border-radius:16px;padding:14px;display:flex;flex-direction:column;justify-content:space-between;gap:10px}}
.vers img{{width:100%;border-radius:10px;margin:auto 0}} .vers img.ic{{border-radius:22.5%}} figcaption{{font-size:12.5px;color:var(--muted)}}
.on-light{{background:#fff}} .on-mist{{background:#F3F5F9}}
.bgs{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}} .bgs figure{{border-radius:14px;padding:18px 16px 10px;border:1px solid var(--line)}}
.bgs img{{width:100%}} .bgs figure.l figcaption{{color:#5B6479}}
table{{width:100%;border-collapse:collapse;font-size:14px;margin-top:6px}} td,th{{padding:7px 6px;border-top:1px solid var(--line);text-align:left}} th{{color:var(--muted);font-weight:500}}
.sws{{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}} .sw i,.hue i{{display:block;height:64px;border-radius:12px;border:1px solid var(--line);margin-bottom:8px}}
.sw b,.hue b{{display:block;font-size:14px}} code{{font:12.5px ui-monospace,Menlo,monospace;color:#C9D4EA}} .sw span{{display:block;font-size:12px;color:var(--muted)}}
.hues{{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-top:14px}} .hue i{{height:40px}}
.type .sample{{font-size:52px;letter-spacing:-.025em;line-height:1.05}} .type .sample b{{font-weight:700}} .type .sample span{{font-weight:400}}
.type .p{{letter-spacing:.42em;font-weight:620;font-size:18px;margin:14px 0 8px}}
.icons{{display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap}} .icons figure{{display:flex;flex-direction:column;gap:6px}}
.icons img{{width:104px;border-radius:22.5%}} .icons img.mac{{border-radius:0}} .icons img.tv{{width:208px;border-radius:12px}}
.icons img.fav{{width:32px;border-radius:6px}} .icons img.fav16{{width:16px;border-radius:3px}} .icons img.fg{{background:#121D36;border-radius:50%}}
.misuse{{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}} .bad{{border:1px solid var(--line);border-radius:14px;padding:8px;position:relative}}
.bad svg{{width:100%;border-radius:8px;display:block}} .bad figcaption{{margin-top:6px}} .bad::after{{content:"✕";position:absolute;top:10px;right:14px;color:#FF5C6C;font-weight:700}}
footer{{margin-top:18px;color:var(--muted);font-size:13px;display:flex;justify-content:space-between}}
</style></head><body><div class="page">

<header class="hero"><img class="icon" src="motion/klaro-live.svg" alt="">
<div><img class="lk" src="logo/horizontal/klaro-horizontal-dark.svg" alt=""><div class="tag">ONE SETUP. EVERY SCREEN.</div></div>
<div class="meta"><b>Logo guide · v2.0</b>30. septembar 2026<br>klaroplayer.com</div></header>

<div class="grid g3">
<section><h2><i>01</i>Znak</h2><p class="lead">Čisto stakleno K. Oko njega kruži ceo spektar ekrana.</p>
<p class="s">„Klaro“ znači bistro: slovo je providno i mirno, a boja je svetlo oko njega, kao ambijentalno svetlo iza televizora. Šest boja su svi ekrani na kojima Klaro radi. Spektar je živ: kruži i diše, pa ikona ne izgleda isto u dve sekunde, a uvek je prepoznatljiva.</p>
<p class="s">Na tamnoj podlozi K je belo staklo. Na svetloj podlozi K je Navy, a aura ostaje ista.</p></section>
<section><h2><i>02</i>Konstrukcija</h2>{construction()}
<p class="s">K čine tri poteza sa zaobljenim krajevima, spojena u jedan oblik (nije sastavljen od delova). Krak kreće sa ose stuba na 0,70 visine, a noga iz kraka na 0,353 njegove dužine, pa oba idu pod tačnih 45° i seku se pod pravim uglom. Aura je šest proširenih kopija K (+0,031 h), pomerenih 0,127 h u koracima od 60° i zamućenih.</p></section>
<section class="motion"><h2><i>03</i>Pokret</h2><img src="motion/klaro-intro-storyboard.png" alt="">
<div class="spec"><span><b>Petlja</b> · spektar pravi krug za 8 s, linearno</span><span><b>Disanje</b> · spoljni sjaj 40 → 62 % za 4 s</span>
<span><b>TV intro</b> · 5 s: aura se rascveta (0–1,2 s), K ulazi (0,35–1,4 s), ime (1,5–2,4 s)</span><span><b>Mirovanje</b> · uz „smanji pokret“ ide statična ikona</span></div>
<p class="s">Fajlovi: motion/klaro-loop.mp4 · klaro-loop-small.mp4/.gif · klaro-intro.mp4 (1920×1080) · klaro-live.svg (živa ikona za web i splash).</p></section>
</div>

<section style="margin-top:18px"><h2><i>04</i>Verzije</h2><div class="vers">
<figure style="background:#05080F"><img src="logo/horizontal/klaro-horizontal-dark.png" alt=""><figcaption>Horizontalni · tamna podloga (primarni)</figcaption></figure>
<figure class="on-light"><img src="logo/horizontal/klaro-horizontal-light.png" alt=""><figcaption>Horizontalni · svetla podloga</figcaption></figure>
<figure style="background:#05080F"><img src="logo/stacked/klaro-stacked-dark.png" alt=""><figcaption>Složeni</figcaption></figure>
<figure><img class="ic" src="icons/app/klaro-icon-dark-1024.png" alt=""><figcaption>App ikona · K + PLAYER (od 120 px)</figcaption></figure>
<figure><img class="ic" src="icons/app/klaro-icon-small-dark-1024.png" alt=""><figcaption>Mala ikona · samo K (do 64 px, favicon)</figcaption></figure>
<figure class="on-light"><img src="logo/symbol/klaro-symbol-mono-navy.png" alt=""><figcaption>Ravni K · jedna boja (štampa, vez, monochrome)</figcaption></figure>
</div></section>

<div class="grid g21">
<section><h2><i>05</i>Podloge</h2><div class="bgs">
<figure style="background:#03060D"><img src="logo/horizontal/klaro-horizontal-dark.png" alt=""><figcaption>Tamna: stakleni K + aura</figcaption></figure>
<figure class="l" style="background:#fff"><img src="logo/horizontal/klaro-horizontal-light.png" alt=""><figcaption>Svetla: Navy K + aura</figcaption></figure>
<figure style="background:#0A6CFF"><img src="logo/horizontal/klaro-horizontal-mono-white.png" alt=""><figcaption>Boja ili fotografija: ravna bela</figcaption></figure>
<figure class="l" style="background:#fff"><img src="logo/horizontal/klaro-horizontal-mono-black.png" alt=""><figcaption>Štampa: ravna crna ili Navy</figcaption></figure>
</div><p class="s">Aura se koristi samo na mirnoj tamnoj ili svetloj podlozi. Na fotografiji, obojenoj površini i u štampi uvek ide ravna verzija u jednoj boji.</p></section>
<section><h2><i>06</i>Prostor i minimum</h2><table>
<tr><th>Verzija</th><th>Ekran</th><th>Štampa</th></tr>
<tr><td>App ikona sa PLAYER</td><td>od 120 px</td><td>—</td></tr><tr><td>Mala ikona (samo K)</td><td>16–64 px</td><td>—</td></tr>
<tr><td>Horizontalni sa aurom</td><td>od 140 px širine</td><td>ravna verzija</td></tr><tr><td>Horizontalni ravni</td><td>od 90 px širine</td><td>25 mm</td></tr>
<tr><td>Ravni K</td><td>16 px</td><td>5 mm</td></tr></table>
<p class="s">Slobodan prostor oko znaka je pola širine K. Aura je već uračunata u fajlove, pa ništa ne sme da uđe u njihovu ivicu.</p></section>
</div>

<div class="grid g2">
<section><h2><i>07</i>Boje</h2><div class="sws">{sw}</div><div class="hues">{spec}</div>
<p class="s">Spektar uvek ide ovim redom, kružno: 1 je uz stub (levo), zatim u smeru kazaljke. Navy na beloj: {contrast(ks.NAVY, ks.WHITE):.1f}:1; bela na Night: {contrast(ks.WHITE, ks.NIGHT):.1f}:1. Boje spektra nisu za tekst.</p></section>
<section class="type"><h2><i>08</i>Tipografija</h2><div class="sample"><b>Klaro</b> <span>Player</span></div><div class="p">PLAYER</div>
<p class="s">Inter Tight (SIL OFL 1.1). „Klaro“ Bold 700, „Player“ Regular 400. Natpis u ikoni je PLAYER: velika slova, 620, razmak 0,42 visine slova. Sav tekst u logo fajlovima je pretvoren u oblike. Za UI: Inter ili Inter Tight 400/500/600.</p></section>
</div>

<div class="grid g21">
<section><h2><i>09</i>Ikone</h2><div class="icons">
<figure><img src="icons/ios/AppIcon-1024.png" alt=""><figcaption>iOS / iPadOS</figcaption></figure>
<figure><img src="icons/ios/AppIcon-1024-tinted.png" alt=""><figcaption>iOS tinted</figcaption></figure>
<figure><img class="fg" src="icons/android/ic_launcher_foreground.png" alt=""><figcaption>Android adaptivna</figcaption></figure>
<figure><img class="mac" src="icons/desktop/macos-1024.png" alt=""><figcaption>macOS</figcaption></figure>
<figure><img class="tv" src="icons/tv/tv-banner-1280x720-dark.png" alt=""><figcaption>TV baner 16:9</figcaption></figure>
<figure><span style="display:flex;gap:12px;align-items:flex-end"><img class="fav" src="icons/web/favicon-32.png" alt=""><img class="fav16" src="icons/web/favicon-16.png" alt=""></span><figcaption>favicon 32 · 16</figcaption></figure>
</div><p class="s">Od 120 px naviše ikona nosi PLAYER. Od 64 px naniže koristi se samo K sa aurom. Android monochrome koristi ravni beli K; iOS tinted je siva verzija ikone.</p></section>
<section><h2><i>10</i>Ne raditi</h2><div class="misuse">{misuse()}</div></section>
</div>
<footer><span>Klaro Player · One setup. Every screen.</span><span>Izvor: brand/klaro-player/_src/build_kit_spektar.py · build_motion_spektar.py</span></footer>
</div></body></html>"""


def main():
    storyboard()
    (KIT / "klaro-brand-guide.html").write_text(page())
    subprocess.run([sys.executable, RENDER, str(KIT / "klaro-brand-guide.html"), "-o", str(KIT / "klaro-brand-guide.png"),
                    "--width", "1560", "--height", "2480"], check=True)


if __name__ == "__main__":
    main()
