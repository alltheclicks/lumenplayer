"""Board for the 2026 glass K round -> klaro-kglass.html/.png (dark, cinematic; images from _internal/kglass-png)."""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from build_kglass import CONCEPTS, KD, RENDER  # noqa: E402

P = "_internal/kglass-png"


def card(i, key, name, note, risk):
    rec = '<span class="rec">Preporuka</span>' if key == "a-clear" else ""
    return f"""
<article class="c">
  <header><span class="n">{chr(65 + i)}</span><h2>{name}</h2>{rec}</header>
  <div class="hero">
    <img class="big" src="{P}/{key}-dark.png">
    <div class="side">
      <img class="mid" src="{P}/{key}-light.png">
      <div class="sizes">
        <img src="{P}/{key}-dark-64.png" width="64"><img src="{P}/{key}-dark-32.png" width="32"><img src="{P}/{key}-dark-16.png" width="16">
      </div>
      <small>64 · 32 · 16 px</small>
    </div>
  </div>
  <div class="lock"><img src="{P}/{key}-dark.png"><b>Klaro</b>&nbsp;<span>Player</span></div>
  <p>{note}</p><p class="risk">{risk}</p>
</article>"""


def phone():
    apps = "".join('<figure><i class="ph"></i><figcaption>&nbsp;</figcaption></figure>' for _ in range(3))
    icons = "".join(f'<figure><img src="{P}/{k}-dark.png"><figcaption>Klaro</figcaption></figure>' for k, *_ in CONCEPTS)
    return f'<div class="phone"><div class="row">{icons}{apps}</div></div>'


def tv():
    tiles = "".join(f'<div class="tv-t ph"></div>' for _ in range(2))
    ours = "".join(
        f'<div class="tv-t ours"><img src="{P}/{k}-dark.png"><b>Klaro</b>&nbsp;<span>Player</span></div>' for k, *_ in CONCEPTS)
    return f'<div class="tv"><div class="tv-row">{tiles[:len(tiles) // 2]}{ours}{tiles[len(tiles) // 2:]}</div></div>'


def page():
    cards = "".join(card(i, k, n, note, risk) for i, (k, n, _, note, risk) in enumerate(CONCEPTS))
    return f"""<!doctype html><html lang="sr-Latn"><head><meta charset="utf-8"><title>Klaro Glass K</title>
<style>
@font-face{{font-family:"Inter Tight";src:url("_src/fonts/InterTight[wght].ttf") format("truetype");font-weight:100 900}}
:root{{--bg:#05080F;--panel:#0B1222;--line:#1B2640;--ink:#EEF3FF;--muted:#8C9AB8;--blue:#0669FE}}
*{{box-sizing:border-box;margin:0}}
body{{background:radial-gradient(1200px 700px at 20% -10%,#14244A 0%,transparent 60%),radial-gradient(900px 600px at 100% 10%,#2A0F2E 0%,transparent 55%),var(--bg);
color:var(--ink);font:15px/1.5 "Inter Tight",system-ui,sans-serif;-webkit-font-smoothing:antialiased}}
.page{{width:1600px;margin:0 auto;padding:56px 56px 64px}}
.top small{{letter-spacing:.2em;text-transform:uppercase;color:var(--muted);font-size:12px}}
.top h1{{font-size:54px;letter-spacing:-.03em;line-height:1.05;margin:10px 0 12px;font-weight:700}}
.top p{{color:var(--muted);max-width:92ch;font-size:16px}}
.grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:36px}}
.c{{background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.015));border:1px solid var(--line);border-radius:28px;padding:24px;backdrop-filter:blur(20px)}}
.c header{{display:flex;align-items:center;gap:12px;margin-bottom:18px}}
.n{{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:rgba(255,255,255,.08);font-weight:700}}
.c h2{{font-size:24px;letter-spacing:-.02em}} .rec{{margin-left:auto;font-size:12px;letter-spacing:.12em;text-transform:uppercase;background:var(--blue);padding:5px 10px;border-radius:99px}}
.hero{{display:grid;grid-template-columns:1fr 150px;gap:16px;align-items:start}}
.big{{width:100%;border-radius:22.5%;box-shadow:0 30px 70px rgba(0,0,0,.55),inset 0 0 0 1px rgba(255,255,255,.08)}}
.side{{display:flex;flex-direction:column;gap:14px}} .mid{{width:150px;border-radius:22.5%}}
.sizes{{display:flex;align-items:flex-end;gap:12px}} .sizes img{{border-radius:22%}} .sizes img[width="16"]{{border-radius:4px}}
.side small,.c p.risk{{color:var(--muted);font-size:13px}}
.lock{{display:flex;align-items:center;margin:22px 0 14px;font-size:34px;letter-spacing:-.025em}} .lock img{{width:58px;border-radius:22.5%;margin-right:14px}}
.lock b{{font-weight:700}} .lock span{{font-weight:400;color:#C9D4EA}}
.c p{{font-size:15px}} .c p.risk{{margin-top:8px;color:#F2A65A}}
h3{{margin:44px 0 16px;font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);font-weight:600}}
.ctx{{display:grid;grid-template-columns:600px 1fr;gap:22px}}
.phone{{border-radius:36px;padding:38px 30px;background:radial-gradient(420px 300px at 20% 0%,#3B1D6E,transparent),radial-gradient(420px 320px at 100% 100%,#0C3E8A,transparent),#0B0F1D;border:1px solid var(--line)}}
.row{{display:grid;grid-template-columns:repeat(6,1fr);gap:16px}} .row figure{{text-align:center;font-size:12px;color:#DDE5F7}}
.row img{{width:100%;border-radius:22.5%;box-shadow:0 10px 24px rgba(0,0,0,.4)}} .row figcaption{{margin-top:6px}}
.ph{{display:block;aspect-ratio:1;border-radius:22.5%;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.12)}}
.tv{{border-radius:28px;padding:34px;background:#070A12;border:1px solid var(--line)}}
.tv-row{{display:grid;grid-template-columns:.6fr 1fr 1fr 1fr .6fr;gap:14px;align-items:center}}
.tv-t{{aspect-ratio:16/9;border-radius:14px}} .tv-t.ph{{aspect-ratio:16/9;border-radius:14px}}
.tv-t.ours{{display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#101A31,#060910);border:1px solid #22304F;font-size:20px;letter-spacing:-.02em}}
.tv-t.ours img{{width:44px;border-radius:22.5%;margin-right:10px}} .tv-t.ours span{{color:#C9D4EA}}
.tv-t.ours:nth-child(4){{outline:3px solid #fff;outline-offset:3px;transform:scale(1.06)}}
.flat{{display:flex;gap:18px;align-items:center;margin-top:18px;color:var(--muted);font-size:14px}}
.flat svg{{width:64px;height:64px;border-radius:14px}}
</style></head><body><div class="page">
<div class="top"><small>Klaro Player · krug 2026 · staklo + RGB</small>
<h1>Jedan K, tri završnice</h1>
<p>Oblik je isti u sva tri: mekan K od tri zaobljena poteza, spojen u jedan komad (ne od delova, zbog Kodi-ja). Prepoznatljivost nose materijal i svetlo: staklo, kanali R, G i B, spektralni odsjaj. Za štampu i 16 px uvek postoji ravna verzija u jednoj boji (dole).</p></div>
<div class="grid">{cards}</div>
<h3>U kontekstu · telefon i TV launcher</h3>
<div class="ctx">{phone()}{tv()}</div>
<div class="flat"><svg viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#fff"/><path d="{KD}" fill="#0D1729"/></svg>
<svg viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#0D1729"/><path d="{KD}" fill="#fff"/></svg>
Ravna verzija u jednoj boji: isti K za štampu, favicon, vez, gravuru i monochrome ikone (Android 13+, iOS tinted).</div>
</div></body></html>"""


def main():
    html = ROOT / "klaro-kglass.html"
    html.write_text(page())
    subprocess.run([sys.executable, RENDER, str(html), "-o", str(ROOT / "klaro-kglass.png"),
                    "--width", "1600", "--height", "1210"], check=True)


if __name__ == "__main__":
    main()
