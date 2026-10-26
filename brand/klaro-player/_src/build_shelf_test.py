"""INTERNAL shelf test: Klaro icons (B3, C4) among real OTT/IPTV competitor icons.

Competitor icons are trademarks of their owners, fetched from public store listings, embedded only
for this internal comparison. Do not publish the output.
"""
import base64
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import io, contextlib  # noqa: E402
with contextlib.redirect_stdout(io.StringIO()):
    from build_variants import B, C  # noqa: E402
    from build_presentation import FONT, glass_icon, wordmark_geist  # noqa: E402
from marks import PAL, f  # noqa: E402

ICONS = Path(sys.argv[1])
OUT = ROOT / "_internal"
OUT.mkdir(exist_ok=True)
COMP = [("TiviMate", "tivimate"), ("IPTV Smarters", "smarters"), ("Plex", "plex"), ("VLC", "vlc"), ("Kodi", "kodi"),
        ("Stremio", "stremio"), ("Jellyfin", "jellyfin"), ("Infuse", "infuse"), ("GSE IPTV", "gse"), ("XCIPTV", "xciptv"),
        ("Netflix", "netflix"), ("YouTube", "youtube"), ("Max", "hbomax"), ("Disney+", "disney"), ("Prime Video", "primevideo")]


def img(name, size, radius):
    b64 = base64.b64encode((ICONS / f"{name}.png").read_bytes()).decode()
    return f'<img src="data:image/png;base64,{b64}" style="width:{size}px;height:{size}px;border-radius:{radius}px">'


paths = {"B3": dict((k, p) for k, *_, p in B)["B3"], "C4": dict((k, p) for k, *_, p in C)["C4"]}


def klaro(key, size, radius):
    return glass_icon(f"t{key}{size}", paths[key]).replace('width="256" height="256"', f'style="width:{size}px;height:{size}px;border-radius:{radius}px"', 1)


def phone(key):
    order = COMP[:9] + [("Klaro", None)] + COMP[9:]
    cells = ""
    for name, fn in order:
        icon = klaro(key, 72, 17) if fn is None else img(fn, 72, 17)
        cells += f'<div class="app">{icon}<span>{name}</span></div>'
    return f'<div class="phone"><div class="status">9:41</div><div class="apps">{cells}</div></div>'


def tv(key):
    lock_paths = paths[key]
    wm, ww = wordmark_geist(300, 168, 80, PAL["white"], "#9AA4B8")
    body = "".join(f'<path fill="{PAL["white"]}" d="{d}"/>' for d in lock_paths)
    lock = f'<svg viewBox="0 0 {f(300 + ww + 30)} 256" style="height:54px;width:auto">{body}{wm}</svg>'
    cards = ""
    picks = [("Netflix", "netflix", "#141414"), ("YouTube", "youtube", "#1f1f1f"), ("TiviMate", "tivimate", "#15202e"),
             (None, None, None), ("Plex", "plex", "#1f1f1f"), ("Kodi", "kodi", "#16232f"), ("Stremio", "stremio", "#1c1630")]
    for name, fn, bg in picks:
        if fn is None:
            cards += f'<div class="tvcard focus" style="background:radial-gradient(260px 160px at 25% 20%, #24408f, #070a12 75%)">{lock}</div>'
        else:
            cards += f'<div class="tvcard" style="background:{bg}">{img(fn, 84, 20)}</div>'
    return f'<div class="tv"><div class="tvrow">{cards}</div></div>'


def tile_variant(key, style, size=72, radius=17):
    """Flat-glass tile colour options: night (current), blue, ice, paper."""
    bgs = {"night": ("#1B2F6E", "#05070D", "#FFFFFF", "#9BE7FF"),
           "blue": ("#4D7CFF", "#1E45D8", "#FFFFFF", "#D6F6FF"),
           "ice": ("#E9FBFF", "#9BE7FF", "#2F5BFF", "#1633B8"),
           "paper": ("#FFFFFF", "#E3E9F5", "#3366FF", "#1B3FCC")}
    b0, b1, m0, m1 = bgs[style]
    uid = f"tv{key}{style}{size}"
    body = "".join(f'<path d="{d}"/>' for d in paths[key])
    return (f'<svg viewBox="0 0 256 256" style="width:{size}px;height:{size}px;border-radius:{radius}px"><defs>'
            f'<linearGradient id="b{uid}" x1="0" y1="0" x2="0" y2="256" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{b0}"/><stop offset="1" stop-color="{b1}"/></linearGradient>'
            f'<linearGradient id="m{uid}" x1="0" y1="40" x2="0" y2="220" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{m0}"/><stop offset="1" stop-color="{m1}"/></linearGradient></defs>'
            f'<rect width="256" height="256" rx="57" fill="url(#b{uid})"/><g fill="url(#m{uid})">{body}</g>'
            f'<rect x="1" y="1" width="254" height="254" rx="56" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="2"/></svg>')


def colour_row(key):
    comp = COMP[:4]
    cells = "".join(f'<div class="app">{img(fn, 72, 17)}<span>{n}</span></div>' for n, fn in comp)
    cells += "".join(f'<div class="app">{tile_variant(key, st)}<span>{st}</span></div>' for st in ("night", "blue", "ice", "paper"))
    cells += "".join(f'<div class="app">{img(fn, 72, 17)}<span>{n}</span></div>' for n, fn in COMP[4:8])
    return f'<div class="phone wide"><div class="apps" style="grid-template-columns: repeat(12, 1fr)">{cells}</div></div>'


def tiny(key):
    order = COMP[:6] + [("Klaro", None)] + COMP[6:12]
    out = ""
    for name, fn in order:
        out += klaro(key, 32, 7) if fn is None else img(fn, 32, 7)
    return out


html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: Geist; src: url('{FONT}'); font-weight: 100 900; }}
* {{ box-sizing: border-box; margin: 0; }}
body {{ width: 1600px; background: #05070D; color: #F5F8FF; font-family: Geist, sans-serif; -webkit-font-smoothing: antialiased; padding: 64px 80px 80px; }}
.eyebrow {{ font-size: 14px; letter-spacing: .18em; text-transform: uppercase; color: #7F8AA3; }}
h1 {{ font-size: 46px; font-weight: 650; letter-spacing: -.035em; margin-top: 12px; }}
.warn {{ color: #FFB86B; font-size: 14px; margin-top: 10px; }}
.phones {{ display: grid; grid-template-columns: 1fr 1fr; gap: 60px; margin-top: 44px; }}
.phone {{ width: 100%; max-width: 640px; border-radius: 60px; padding: 36px 36px 50px; margin: 18px auto 0;
         background: radial-gradient(400px 360px at 15% 10%, #3a2f7a, transparent 70%), radial-gradient(420px 420px at 90% 90%, #0f6b7a, transparent 70%), radial-gradient(360px 300px at 80% 25%, #7a3b2f, transparent 70%), #080b14;
         box-shadow: 0 0 0 12px #111521, 0 50px 100px rgba(0,0,0,.6); }}
.phone.wide {{ max-width: none; padding: 34px 30px; border-radius: 34px; margin-top: 16px; }}
.status {{ font-size: 15px; font-weight: 600; margin: 0 0 28px 12px; }}
.apps {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 26px 10px; }}
.app {{ text-align: center; font-size: 12.5px; color: #E6EAF2; }}
.app img, .app svg {{ display: block; margin: 0 auto 7px; box-shadow: 0 6px 14px rgba(0,0,0,.35); }}
.tv {{ border-radius: 26px; padding: 40px 0 40px 40px; margin-top: 18px; overflow: hidden; background: linear-gradient(180deg, #0B0F1A, #05070D); box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); }}
.tvrow {{ display: flex; gap: 20px; }}
.tvcard {{ flex: none; width: 250px; height: 141px; border-radius: 16px; display: flex; align-items: center; justify-content: center; }}
.tvcard.focus {{ width: 290px; height: 163px; outline: 3px solid #F5F8FF; outline-offset: 5px; }}
.tiny {{ display: flex; gap: 14px; padding: 20px 24px; border-radius: 18px; margin-top: 16px; }}
.lbl {{ font-size: 20px; font-weight: 600; letter-spacing: -.02em; margin-top: 56px; }}
</style></head><body>
<div class="eyebrow">Klaro Player · internal shelf test</div>
<h1>Does Klaro stand out among the apps it lives next to?</h1>
<div class="warn">Internal comparison only — competitor icons are trademarks of their owners. Do not publish.</div>
<div class="phones">
  <div><div class="lbl">B3 · Cut Arch (wide &amp; calm)</div>{phone("B3")}</div>
  <div><div class="lbl">C4 · Cut Slant (bold)</div>{phone("C4")}</div>
</div>
<div class="lbl">Tile colour — which one pops among the others? (B3 / C4)</div>
{colour_row("B3")}
{colour_row("C4")}
<div class="lbl">TV launcher — B3</div>{tv("B3")}
<div class="lbl">TV launcher — C4</div>{tv("C4")}
<div class="lbl">32 px — app list / search results</div>
<div class="tiny" style="background:#0B0F1A">{tiny("B3")}</div>
<div class="tiny" style="background:#0B0F1A">{tiny("C4")}</div>
<div class="tiny" style="background:#F5F8FF">{tiny("B3")}</div>
<div class="tiny" style="background:#F5F8FF">{tiny("C4")}</div>
</body></html>"""
(OUT / "shelf-test.html").write_text(html)
(OUT / "README.md").write_text("# Interno\n\nUporedni shelf test sa ikonama konkurenata (tuđi žigovi, preuzeti sa javnih prodavnica). Samo za internu procenu — **ne objavljivati, ne commit-ovati u javni repo, ne slati spolja**.\n")
print("ok")
