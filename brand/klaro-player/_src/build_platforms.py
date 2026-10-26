"""Platform test board for the 3D fold concepts: macOS Dock, Windows taskbar, TV launcher (Android/Google TV,
Fire TV, Samsung/LG), store listing and true small-size renders. Writes concept SVGs + klaro-flow3d.html.
Placeholder apps are neutral grey tiles (no third-party marks: this board can be shared).
"""
import itertools
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from build_flow3d import NAVY, BLUE, WHITE, lockup, set_view, svg, svg_mark  # noqa: E402
from marks import f  # noqa: E402
from typekit import text  # noqa: E402

OUT = ROOT / "concepts" / "flow3d"
FONT = (HERE / "fonts" / "InterTight[wght].ttf").as_uri()
ICE_A, ICE_B = "#F4F8FF", "#DDE9FF"
NIGHT_A, NIGHT_B = "#15223B", "#0A1222"

# Gentle 3D view: screens turned only 15° so they read as TV screens (iso 30° made the mark tall and narrow).
set_view(15, (-0.62, 0.36))
BASE = dict(W=320, H1=180, H2=180, R=26)
CONCEPTS = {
    "a": dict(name="Tok", note="Ekran 1 se meko savija i teče u ekran 2; plava prelazi u navy duž toka.",
              p=dict(BASE, D=130, r=45, lift=0.3)),
    "b": dict(name="Pregib", note="Ista ideja sa oštrim pregibom: dva ekrana spojena jednom svetlom plohom.",
              p=dict(BASE, D=100, r=0, lift=0.3)),
}
_uid = itertools.count()


def m(key, tone="light", size=200, box=256, cue="bar"):
    p = dict(CONCEPTS[key]["p"], cue=cue)
    return svg_mark(p, tone, size, box, uid=f"u{next(_uid)}")


def inline(defs, body, view="0 0 256 256", cls="", style=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}" class="{cls}" style="{style}">'
            f'<defs>{defs}</defs>{body}</svg>')


def tile(key, kind="ice", cue="bar", mark_size=176):
    """App icon: rounded tile (256 grid) with the mark; night tile uses the dark-tone mark."""
    gid = f"t{next(_uid)}"
    a, b = (ICE_A, ICE_B) if kind == "ice" else (NIGHT_A, NIGHT_B)
    d, bd = m(key, "light" if kind == "ice" else "dark", mark_size, cue=cue)
    bg = (f'<linearGradient id="{gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{a}"/>'
          f'<stop offset="1" stop-color="{b}"/></linearGradient>')
    return d + bg, f'<rect width="256" height="256" rx="57" fill="url(#{gid})"/>' + bd


def banner(key, kind="night"):
    """16:9 TV launcher banner (Android TV 320x180 / Fire TV tile): mark + name."""
    c = WHITE if kind == "night" else NAVY
    gid = f"b{next(_uid)}"
    a, b = (NIGHT_A, NIGHT_B) if kind == "night" else (ICE_A, ICE_B)
    d, bd = m(key, "dark" if kind == "night" else "light", 132, 180)
    cap = 30
    d1, w1 = text("Klaro", "InterTight", cap, x=0, base=0, tracking=-cap * 0.025, wght=700)
    d2, w2 = text("Player", "InterTight", cap, x=0, base=0, tracking=-cap * 0.01, wght=400)
    tx = 172
    body = (f'<rect width="320" height="180" fill="url(#{gid})"/>'
            f'<g transform="translate(8 0)">{bd}</g>'
            f'<g transform="translate({tx} 86)"><path fill="{c}" d="{d1}"/></g>'
            f'<g transform="translate({tx} 122)"><path fill="{c}" d="{d2}"/></g>')
    defs = d + (f'<linearGradient id="{gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{a}"/>'
                f'<stop offset="1" stop-color="{b}"/></linearGradient>')
    return inline(defs, body, "0 0 320 180", "banner")


def grey_tiles(n, cls):
    return "".join(f'<div class="{cls} ph"></div>' for _ in range(n))


def write_files():
    for k in CONCEPTS:
        for tone in ("light", "dark"):
            d, b = m(k, tone)
            (OUT / f"{k}-{tone}.svg").write_text(svg(d, b))
            d, b = m(k, tone, cue=None)
            (OUT / f"{k}-{tone}-small.svg").write_text(svg(d, b))
        d, b = m(k)
        (OUT / f"{k}-lockup.svg").write_text(lockup(d, b))
        d, b = m(k, "dark")
        (OUT / f"{k}-lockup-dark.svg").write_text(lockup(d, b, dark=True))
        for kind in ("ice", "night"):
            d, b = tile(k, kind)
            (OUT / f"{k}-icon-{kind}.svg").write_text(svg(d, b))
            d, b = tile(k, kind, cue=None, mark_size=204)
            (OUT / f"{k}-icon-{kind}-small.svg").write_text(svg(d, b))


def section(key):
    c = CONCEPTS[key]
    ice = lambda px, cue="bar", ms=176: inline(*tile(key, "ice", cue, ms), style=f"width:{px}px;height:{px}px")
    night = lambda px, cue="bar", ms=176: inline(*tile(key, "night", cue, ms), style=f"width:{px}px;height:{px}px")
    bare = lambda px, tone="light": inline(*m(key, tone, 236, cue=None), style=f"width:{px}px;height:{px}px")
    dlock, blk = m(key)
    dlock2, blk2 = m(key, "dark")
    lock_l = Path(OUT / f"{key}-lockup.svg").read_text()
    lock_d = Path(OUT / f"{key}-lockup-dark.svg").read_text()
    dock = "".join(f'<div class="app ph"></div>' for _ in range(3)) + ice(64) + \
        "".join(f'<div class="app ph"></div>' for _ in range(3))
    dock2 = "".join(f'<div class="app ph"></div>' for _ in range(3)) + night(64) + \
        "".join(f'<div class="app ph"></div>' for _ in range(3))
    tb = lambda theme, icon: (f'<div class="taskbar {theme}"><div class="tbi ph"></div><div class="tbi ph"></div>'
                              f'<div class="tbi me">{icon}</div><div class="tbi ph"></div><div class="tbi ph"></div></div>')
    ladder = "".join(f'<div class="lad"><div class="px">{ice(s, None, 204)}</div><span>{s}</span></div>' for s in (16, 24, 32, 48, 64)) + \
        "".join(f'<div class="lad dk"><div class="px">{night(s, None, 204)}</div><span>{s}</span></div>' for s in (16, 24, 32, 48, 64))
    tvrow = grey_tiles(1, "tvt") + f'<div class="tvt focus">{banner(key, "night")}</div>' + grey_tiles(3, "tvt")
    tvrow2 = grey_tiles(1, "tvt") + f'<div class="tvt focus">{banner(key, "ice")}</div>' + grey_tiles(3, "tvt")
    return f"""
<section>
  <div class="head"><span class="big">{key.upper()}</span><div><h2>{c['name']}</h2><p>{c['note']}</p></div></div>
  <div class="hero">
    <div class="card w">{inline(*m(key), style="width:230px;height:230px")}<div class="lk">{lock_l}</div></div>
    <div class="card n">{inline(*m(key, "dark"), style="width:230px;height:230px")}<div class="lk">{lock_d}</div></div>
    <div class="card icons"><div class="lab">App ikona · ice / night</div><div class="row">{ice(150)}{night(150)}</div>
      <div class="lab">Male veličine (bez trake): 16 · 24 · 32 · 48 · 64 px</div><div class="ladder">{ladder}</div></div>
  </div>
  <div class="ctx">
    <div class="cbox mac"><div class="lab light">macOS Dock</div><div class="wall"><div class="dock">{dock}</div><div class="dock">{dock2}</div></div></div>
    <div class="cbox win"><div class="lab">Windows 11 taskbar (24 px) · svetla i tamna tema</div>{tb("light", ice(24, None, 204))}{tb("dark", night(24, None, 204))}
      <div class="lab" style="margin-top:14px">Naslovna traka prozora (16 px)</div>
      <div class="titlebar">{ice(16, None, 204)}<span>Klaro Player</span></div></div>
  </div>
  <div class="cbox tv"><div class="lab light">TV launcher (Android TV / Google TV / Fire TV baner 16:9, fokusiran) · night i ice</div>
    <div class="tvscreen"><div class="tvrow">{tvrow}</div><div class="tvrow">{tvrow2}</div>
    <div class="tvsq"><div class="lab light">Samsung / LG traka sa kvadratnim ikonama</div><div class="sqrow">{grey_tiles(2, "sq")}<div class="sq me">{night(96)}</div>{grey_tiles(2, "sq")}<div class="sq me">{ice(96)}</div></div></div></div>
  </div>
  <div class="cbox store"><div class="lab">Prodavnica (TV store / Fire TV Appstore)</div>
    <div class="listing">{ice(120)}<div><div class="nm">Klaro Player</div><div class="sub">One setup. Every screen.</div><div class="get">Preuzmi</div></div>{banner(key, "night")}</div></div>
</section>"""


def board():
    write_files()
    secs = "".join(section(k) for k in CONCEPTS)
    html = f"""<!doctype html><html><head><meta charset="utf-8"><title>Klaro 3D Fold</title><style>
@font-face {{ font-family: IT; src: url('{FONT}'); font-weight: 100 900; }}
* {{ box-sizing: border-box; margin: 0; }}
body {{ width: 1600px; background: #F4F6FA; color: {NAVY}; font-family: IT, sans-serif; -webkit-font-smoothing: antialiased; padding: 60px 72px 72px; }}
.eyebrow {{ font-size: 14px; letter-spacing: .18em; text-transform: uppercase; color: #6B7488; }}
h1 {{ font-size: 44px; font-weight: 700; letter-spacing: -.03em; margin-top: 10px; }}
.sub {{ font-size: 18px; color: #4A5368; margin-top: 8px; max-width: 1300px; }}
section {{ margin-top: 52px; }}
.head {{ display: flex; gap: 18px; align-items: flex-start; margin-bottom: 18px; }}
.big {{ font-size: 44px; font-weight: 700; color: {BLUE}; line-height: 1; }}
h2 {{ font-size: 28px; font-weight: 700; letter-spacing: -.02em; }}
.head p {{ font-size: 17px; color: #4A5368; margin-top: 4px; }}
.hero {{ display: grid; grid-template-columns: 330px 330px 1fr; gap: 18px; }}
.card {{ border-radius: 24px; padding: 22px; display: flex; flex-direction: column; align-items: center; gap: 10px; }}
.card.w {{ background: #fff; }} .card.n {{ background: {NAVY}; }}
.card.icons {{ background: #fff; align-items: flex-start; }}
.lk svg {{ width: 270px; height: auto; display: block; }}
.row {{ display: flex; gap: 22px; }}
.row svg {{ filter: drop-shadow(0 10px 18px rgba(13,23,41,.18)); }}
.lab {{ font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: #6B7488; margin-bottom: 10px; }}
.lab.light {{ color: rgba(255,255,255,.7); }}
.ladder {{ display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }}
.lad {{ display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 11px; color: #6B7488; }}
.lad .px {{ padding: 8px; border-radius: 8px; background: #fff; box-shadow: 0 0 0 1px rgba(13,23,41,.08); display: flex; }}
.lad.dk .px {{ background: #1c1c1e; }}
.ctx {{ display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 18px; }}
.cbox {{ border-radius: 24px; padding: 22px; background: #fff; }}
.cbox.mac {{ background: linear-gradient(135deg,#3B4C7A,#7A5C8E 55%,#C98E7A); }}
.wall {{ display: flex; flex-direction: column; gap: 16px; align-items: center; padding: 14px 0 4px; }}
.dock {{ display: flex; gap: 10px; padding: 9px 12px; border-radius: 22px; background: rgba(255,255,255,.28); backdrop-filter: blur(20px); box-shadow: inset 0 0 0 1px rgba(255,255,255,.35); align-items: center; }}
.app {{ width: 64px; height: 64px; border-radius: 15px; }}
.ph {{ background: linear-gradient(#C9CFDA,#AEB6C4); }}
.taskbar {{ display: flex; gap: 8px; justify-content: center; padding: 8px; border-radius: 10px; margin-bottom: 10px; }}
.taskbar.light {{ background: #EEF1F5; }} .taskbar.dark {{ background: #1F1F1F; }}
.tbi {{ width: 40px; height: 40px; border-radius: 6px; display: flex; align-items: center; justify-content: center; }}
.tbi.ph {{ width: 24px; height: 24px; margin: 8px; border-radius: 5px; }}
.dark .tbi.me {{ background: rgba(255,255,255,.08); }} .light .tbi.me {{ background: rgba(0,0,0,.05); }}
.titlebar {{ display: flex; gap: 8px; align-items: center; background: #F3F3F3; border-radius: 8px; padding: 8px 12px; font-size: 13px; font-family: "Segoe UI", sans-serif; }}
.cbox.tv {{ background: #05070C; margin-top: 18px; }}
.tvscreen {{ background: radial-gradient(1200px 400px at 30% 0%,#1B2A4A,#070B14); border-radius: 14px; padding: 26px; }}
.tvrow {{ display: flex; gap: 18px; align-items: center; margin-bottom: 22px; }}
.tvt {{ width: 240px; height: 135px; border-radius: 10px; overflow: hidden; flex: none; }}
.tvt.ph {{ background: linear-gradient(#2A3346,#1D2433); }}
.tvt.focus {{ width: 272px; height: 153px; box-shadow: 0 0 0 4px #fff, 0 18px 40px rgba(0,0,0,.6); }}
.banner {{ width: 100%; height: 100%; display: block; }}
.tvsq {{ margin-top: 6px; }} .sqrow {{ display: flex; gap: 14px; }}
.sq {{ width: 96px; height: 96px; border-radius: 22px; }} .sq.ph {{ background: linear-gradient(#2A3346,#1D2433); }}
.cbox.store {{ margin-top: 18px; }}
.listing {{ display: flex; gap: 24px; align-items: center; }}
.listing .nm {{ font-size: 26px; font-weight: 700; }} .listing .sub {{ color: #4A5368; margin-top: 4px; }}
.listing .get {{ display: inline-block; margin-top: 12px; background: {BLUE}; color: #fff; padding: 8px 22px; border-radius: 999px; font-weight: 600; }}
.listing > svg.banner {{ width: 320px; height: 180px; border-radius: 12px; margin-left: auto; }}
</style></head><body>
<div class="eyebrow">Klaro Player · dva ekrana, jedan tok · 3D pregib</div>
<h1>Ekran 1 teče u ekran 2</h1>
<div class="sub">Traka u blagom 3D pogledu (ekrani okrenuti 15°): ekran 1 (plavi, gore) se savija ka napred i nastavlja kao ekran 2 (navy, dole). Ekrani su 16:9, a traka napretka na ekranu 2 suptilno kaže „media player“. Ispod 64 px traka se izostavlja. Siva polja su neutralne tuđe aplikacije.</div>
{secs}
</body></html>"""
    (ROOT / "klaro-flow3d.html").write_text(html)


if __name__ == "__main__":
    board()
    print("ok")
