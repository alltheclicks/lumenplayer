"""Pill K for the 2026 glass round: three round-capped strokes (stem, arm, leg) fused into one soft letter."""
from shapely.geometry import LineString
from shapely.ops import unary_union
from shapely import affinity


def pill_k(weight=0.32, join=0.62, split=0.40, top=1.0, foot=1.0, fillet=0.06):
    """Unit box ~1×1.2 (y down). Arm runs from the stem axis at height `join` to the top-right; the leg leaves the
    arm's axis at fraction `split` and runs to the bottom-right. All caps are round and every start point sits inside
    another stroke, so there are no lumps at the joins."""
    h = 1.2
    r = weight / 2
    stem = LineString([(r, r), (r, h - r)]).buffer(r, 64)
    j, t = (r, join * h), (top - r, r)
    arm = LineString([j, t]).buffer(r, 64)
    sp = (j[0] + (t[0] - j[0]) * split, j[1] + (t[1] - j[1]) * split)
    leg = LineString([sp, (foot - r, h - r)]).buffer(r, 64)
    k = unary_union([stem, arm, leg])
    return k.buffer(fillet, 64).buffer(-fillet, 64)


def placed(g, size, cx, cy):
    x0, y0, x1, y1 = g.bounds
    s = size / max(x1 - x0, y1 - y0)
    g = affinity.translate(g, -(x0 + x1) / 2, -(y0 + y1) / 2)
    g = affinity.scale(g, s, s, origin=(0, 0))
    return affinity.translate(g, cx, cy)


def d_of(g, nd=1):
    out = []
    for p in getattr(g, "geoms", [g]):
        for ring in [p.exterior, *p.interiors]:
            pts = list(ring.coords)[:-1]
            out.append("M" + " L".join(f"{x:.{nd}f} {y:.{nd}f}" for x, y in pts) + " Z")
    return " ".join(out)
