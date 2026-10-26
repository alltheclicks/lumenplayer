"""Klaro motion: icon loop (8 s), small loop (GIF) and a 5 s TV intro (1920×1080).

Python writes deterministic HTML drivers (window.frame(t) poses the SVG at time t), Playwright screenshots every frame
(motion_frames.mjs), ffmpeg encodes. Outputs -> kit/motion/.
"""
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import klaro_spektar as ks  # noqa: E402

WORK = ROOT / "_internal" / "motion"
OUT = ROOT / "kit" / "motion"
REPO = ROOT.parent.parent
PW = REPO / "node_modules" / ".pnpm" / "playwright@1.58.2" / "node_modules"

JS = """
<script>
const TURN = %(turn)s, BREATH = 4;
const hues = [...document.querySelectorAll('.hue')];
const breathe = [...document.querySelectorAll('.breathe')];
const ease = x => x < 0 ? 0 : x > 1 ? 1 : (x < .5 ? 4*x*x*x : 1 - Math.pow(-2*x + 2, 3) / 2);
const seg = (t, a, b) => ease((t - a) / (b - a));
function pose(el, o, s, dy, cx, cy) {
  if (!el) return;
  el.setAttribute('opacity', o.toFixed(3));
  el.setAttribute('transform', `translate(${cx} ${cy + dy}) scale(${s}) translate(${-cx} ${-cy})`);
}
window.frame = t => {
  const ph = 2 * Math.PI * t / TURN;
  for (const h of hues) {
    const i = +h.dataset.i, r = +h.dataset.rad, a = Math.PI + i * Math.PI / 3 + ph;
    h.setAttribute('transform', `translate(${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)})`);
  }
  const b = .5 - .5 * Math.cos(2 * Math.PI * t / BREATH);
  for (const g of breathe) g.setAttribute('opacity', (+g.dataset.op * (.40 + .22 * b)).toFixed(3));
  %(intro)s
};
window.frame(0);
</script>"""

INTRO = """
  const C = %(c)s;
  pose(document.querySelector('.aura'), seg(t, 0, .9), .55 + .45 * seg(t, 0, 1.2), 0, C[0], C[1]);
  pose(document.querySelector('.k'), seg(t, .35, 1.25), .9 + .1 * seg(t, .35, 1.4), 24 * (1 - seg(t, .35, 1.4)), C[0], C[1]);
  const n = document.querySelector('.name');
  if (n) { n.setAttribute('opacity', seg(t, 1.5, 2.3).toFixed(3));
           n.setAttribute('transform', `translate(0 ${(18 * (1 - seg(t, 1.5, 2.4))).toFixed(2)})`); }
"""


def page(svg, w, h, turn=8, intro=None):
    js = JS % {"turn": turn, "intro": INTRO % {"c": json.dumps(intro)} if intro else ""}
    return (f'<!doctype html><html><head><meta charset="utf-8"><style>html,body{{margin:0;background:#03060D}}'
            f'svg{{display:block;width:{w}px;height:{h}px}}</style></head><body>{svg}{js}</body></html>')


def intro_svg():
    w, h = 1920, 1080
    td, tb = ks.tile(w, h, "t", "dark")
    md, mb = ks.mark(380, 960, 470, "dark")
    cap = 64
    _, nw = ks.name(0, 0, cap, ks.WHITE)
    nb, _ = ks.name(960 - nw / 2, 850, cap, ks.WHITE)
    return ks.svg(w, h, td + md, tb + mb + f'<g class="name" opacity="0">{nb}</g>'), (960, 470)


JOBS = [
    # name, svg, w, h, seconds, fps, turn, intro-centre
    ("klaro-loop", lambda: ks.icon("dark", True, size=1080), 1080, 1080, 8, 30, 8, None),
    ("klaro-loop-small", lambda: ks.icon("dark", False, size=512), 512, 512, 8, 20, 8, None),
    ("klaro-intro", None, 1920, 1080, 5, 30, 5, True),
]


def run():
    if WORK.exists():
        shutil.rmtree(WORK)
    WORK.mkdir(parents=True)
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = []
    for name, mk, w, h, secs, fps, turn, intro in JOBS:
        if intro:
            svg, c = intro_svg()
        else:
            svg, c = mk(), None
        (WORK / f"{name}.html").write_text(page(svg, w, h, turn, c))
        jobs.append({"name": name, "html": str(WORK / f"{name}.html"), "w": w, "h": h, "frames": secs * fps, "fps": fps,
                     "out": str(WORK / name)})
    (WORK / "jobs.json").write_text(json.dumps(jobs))
    subprocess.run(["node", str(HERE / "motion_frames.mjs"), str(WORK / "jobs.json")], check=True,
                   env={"NODE_PATH": str(PW), "PATH": "/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin"})
    for j in jobs:
        src = f"{j['out']}/f%04d.png"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(j["fps"]), "-i", src,
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-movflags", "+faststart",
                        str(OUT / f"{j['name']}.mp4")], check=True)
        if j["name"] != "klaro-intro":
            size = 480 if j["name"] == "klaro-loop" else 256
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(j["fps"]), "-i", src, "-vf",
                            f"fps=20,scale={size}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256[p];[b][p]paletteuse=dither=sierra2_4a",
                            "-loop", "0", str(OUT / f"{j['name']}.gif")], check=True)
        if j["name"] == "klaro-intro":                    # poster frames for the guide
            for t in (0.4, 1.0, 1.8, 4.0):
                shutil.copy(f"{j['out']}/f{int(t * j['fps']):04d}.png", WORK / f"intro-{t:.1f}.png")
    print("motion ->", OUT)


if __name__ == "__main__":
    run()
