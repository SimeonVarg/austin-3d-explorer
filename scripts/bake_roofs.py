# -*- coding: utf-8 -*-
"""Give the campus the pitched roofs it actually has.

THE PROBLEM. `fill-extrusion` has exactly one roof shape: flat. Every building
in this app is a prism, and on a campus where most of the orange roofs are
hipped and converge to a ridge, that is probably the single loudest tell that
the scene is generated.

WHY v1 ONLY REACHED 26 BUILDINGS — two separate failures, both mechanical:

  1. NO IMAGERY. `data/imagery_cache` held only the 176 z19 tiles fetched for an
     unrelated research task, so 1,933 of 2,453 footprints were never scored at
     all and fell through to flat. `scripts/fetch_roof_imagery.py` now derives
     the tile list from the footprints themselves. That alone took 26 -> 76.

  2. THE WRONG QUESTION. v1 asked "what fraction of the WHOLE footprint is
     terracotta?" and required 0.50. But the real hip roofs on this campus are
     mostly a tiled BAND around a flat central deck of white membrane and
     mechanical plant — look at `data/roof_band_015_062.png`. Welch, Calhoun,
     Hogg Auditorium, Gregory Gym, Blanton, Goldsmith, Gearing all read 0.30-0.55
     on a whole-footprint average and were rejected, while their perimeters are
     unmistakably tile. Averaging over the deck is what threw them away.

THE RULE (factual, from the photograph). Walk INWARD from the eave in ~0.9 m
steps. At each offset ring, sample the imagery along the ring itself and ask
what fraction reads terracotta. The slope runs from the eave to the first ring
that stops being tile — which IS the eave-to-deck run of a real hip roof, and is
measured per building rather than assumed. A flat membrane roof fails at the
first ring and is left alone; a full hip keeps passing until the ring collapses,
so its run is its half-span and it grows a ridge on its own.

Calibrated against the only ground truth available, the buildings OSM tags with
`roof:shape` (measured run against half-span, and the ring fraction at the eave):

    Sutton Hall                  hipped   run 11.6 m of hs 12.2   eave 0.78
    E. P. Schoch Building        hipped   run 10.7 m of hs 10.8   eave 0.70
    Rapoport Building            hipped   run  9.8 m of hs 10.6   eave 0.86
    University Teaching Center   flat     run  0.0 m              eave 0.03

Three hipped roofs run essentially to their own half-span — they have no deck,
and the rule finds that without being told. The flat one stops at the first ring.

THE SHAPE (generative, and labelled as such). A hip is approximated by STEPPED
INSET FACETS: the footprint offset inward in equal steps, each sitting higher
than the last, stopping at the measured run. Offsetting a long rectangle inward
collapses its short axis to a line, so an elongated hall produces a ridge
honestly rather than having one drawn on. The pitch is 5:12 (22.6 deg) — Spanish
clay tile needs at least 4:12 and these low hips sit near the bottom of that
range. From flying altitude the steps read as a slope; up close they read as
steps, and that is stated rather than hidden.

Each step is emitted as one quad PER EDGE carrying `az`, the direction that
slope faces, because MapLibre shades all horizontal tops identically and
concentric rings therefore render as a flat plane with stripes on it — see the
shading section below, which is the part that took the most attempts.

Whatever the slope encloses is always filled at the TOP of the slope. Leaving it
on the wall cap was a real bug: the band climbed 3 m while the middle stayed
down, so the steps floated over a flat plane exactly as the render showed.

Usage:  python scripts/bake_roofs.py [--report] [--remeasure]

  --remeasure   re-read the imagery instead of reusing data/roof_runs.json.
                Required after changing the imagery cache or the tile rule; the
                cache exists because probing 2,400 footprints takes minutes and
                the geometry takes seconds, and the geometry is what needs
                iterating against renders.
"""
import json
import math
import os
import sys
from collections import Counter

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP = os.path.join(ROOT, "data", "snapshots", "2026-07-30", "buildings.detailed.geojson")
TILES = os.path.join(ROOT, "data", "imagery_cache")
OUT = os.path.join(ROOT, "data", "roofs.geojson")
MEAS = os.path.join(ROOT, "data", "roof_runs.json")   # what the photograph said
Z = 19
M_LAT = 111320.0

# ── Taste / rule constants ────────────────────────────────────────────
RING_MIN      = 0.45    # fraction of an offset ring that must read tile
RING_STEP_M   = 0.9     # how far inward each probe walks
RING_MISSES   = 1       # rings a tree shadow may eat before the slope ends
EAVE_D        = 0.8     # the first ring, just inside the eave
MIN_RUN_M     = 2.0     # shorter than this is a parapet coping, not a slope
PITCH         = 0.42    # rise per metre of run (5:12, ~22.6 deg — Spanish tile)
RISE_MAX      = 8.0     # a campus hall's roof, not a spire
STEP_TARGET_M = 1.8     # aim for a step about this deep; more steps = smoother
STEPS_MIN     = 2
STEPS_MAX     = 6
EAVE_OUT_M    = 0.5     # roofs overhang their walls; so does this one
SIMPLIFY_M    = 1.1     # wall jogs smaller than this are not roof features
MAX_HEIGHT_M  = 34.0    # towers are flat-topped; the Tower's roof is its own thing


def tile_xy_f(lon, lat, z):
    n = 2.0 ** z
    return ((lon + 180.0) / 360.0 * n,
            (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)


_tiles = {}


def px_at(lon, lat):
    xf, yf = tile_xy_f(lon, lat, Z)
    xt, yt = int(xf), int(yf)
    k = (xt, yt)
    if k not in _tiles:
        p = os.path.join(TILES, "%d_%d_%d.jpg" % (Z, xt, yt))
        _tiles[k] = np.asarray(Image.open(p).convert("RGB")) if os.path.exists(p) else None
    a = _tiles[k]
    if a is None:
        return None
    return a[int((yf - yt) * 256), int((xf - xt) * 256)]


def is_tile(c):
    """Terracotta: red dominant, green above blue, decently saturated.

    Unchanged from `probe_roofs.py`, where it was calibrated against the OSM
    `roof:shape` tags. What changed in v2 is WHERE it gets sampled, not what it
    considers tile.
    """
    R, G, B = int(c[0]), int(c[1]), int(c[2])
    mx, mn = max(R, G, B), min(R, G, B)
    if mx == 0:
        return False
    return R == mx and (mx - mn) / mx > 0.28 and R > 70 and G >= B and (R - B) > 38


def point_in_ring(x, y, ring):
    inside = False
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        if (y0 > y) != (y1 > y):
            xi = x0 + (y - y0) / (y1 - y0) * (x1 - x0)
            if x < xi:
                inside = not inside
    return inside


def tile_frac_area(ring, grid=20):
    """Whole-footprint tile fraction. Reported only — v1's rule, kept so the
    `--report` table can show what the old question would have answered."""
    lons = [p[0] for p in ring]; lats = [p[1] for p in ring]
    w, e, s, n = min(lons), max(lons), min(lats), max(lats)
    hit = tot = 0
    for i in range(grid):
        for j in range(grid):
            lon = w + (e - w) * (i + 0.5) / grid
            lat = s + (n - s) * (j + 0.5) / grid
            if not point_in_ring(lon, lat, ring):
                continue
            c = px_at(lon, lat)
            if c is None:
                continue
            tot += 1
            hit += is_tile(c)
    return (hit / tot if tot else 0.0), tot


# ── geometry ──────────────────────────────────────────────────────────
def to_m(ring, lat0):
    k = math.cos(math.radians(lat0))
    return [(p[0] * M_LAT * k, p[1] * M_LAT) for p in ring]


def to_ll(pts, lat0):
    k = math.cos(math.radians(lat0))
    return [[round(x / (M_LAT * k), 6), round(y / M_LAT, 6)] for (x, y) in pts]


def signed_area(pts):
    a = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        a += x0 * y1 - x1 * y0
    return a * 0.5


# How far off the line between its neighbours a vertex may sit and still be
# called noise. A quarter-metre is under one pixel at every altitude this app
# flies and well under the 0.35 m eave thickness, so nothing that survives here
# could have been drawn anyway. Raise it and gentle real curves get flattened
# into straight walls; lower it and survey noise starts folding insets again.
COLLINEAR_SAGITTA_M = 0.25


def clean(pts):
    """Drop repeated and near-collinear vertices.

    v1 lost 21 buildings to `tiled_but_degenerate` — scored as tiled, then the
    very first inset returned None. The cause is duplicate or hair-width edges
    in the source footprints: a zero-length edge has no normal, and two almost
    parallel edges intersect somewhere out near infinity. Cleaning first is what
    turns those back into roofs instead of silently dropping them.

    THE ANGLE TEST ALONE IS SCALE-BLIND, and that is what put a diagonal roof on
    the Edgar A. Smith Building. Its footprint is a clean quadrilateral with one
    spurious vertex 2.1 m from its neighbour, and the two edges either side of it
    run at az 186.45 and 186.58 — 0.13 degrees apart. sin(0.13 deg) is 0.0023,
    which clears the 0.002 cross-product threshold by a hair, so the vertex
    survived. Then the 2.1 m edge is shorter than twice the first 4.48 m inset,
    so the offset crossed itself, valid_step correctly called it a fold, and the
    facet it dropped was the WHOLE 36.1 m north slope. Three sides of the hip got
    built and the fourth did not, which is the diagonal.

    The angle a vertex turns through is the wrong question. What matters is how
    far it actually sits off the line between its neighbours: 0.13 deg over a
    2 m edge is 5 mm of survey noise, and over a 200 m edge it is 45 cm of real
    building. So measure the sagitta in metres and drop anything under a
    quarter-metre, which is below what any roof detail at this scale can express.
    """
    p = pts[:-1] if pts and pts[0] == pts[-1] else pts[:]
    out = []
    for q in p:
        if not out or math.hypot(q[0] - out[-1][0], q[1] - out[-1][1]) > 0.05:
            out.append(q)
    if len(out) > 2 and math.hypot(out[0][0] - out[-1][0], out[0][1] - out[-1][1]) <= 0.05:
        out.pop()
    keep = []
    n = len(out)
    for i in range(n):
        ax, ay = out[i - 1]
        bx, by = out[i]
        cx, cy = out[(i + 1) % n]
        v1 = (bx - ax, by - ay)
        v2 = (cx - bx, cy - by)
        l1 = math.hypot(*v1); l2 = math.hypot(*v2)
        if l1 < 1e-6 or l2 < 1e-6:
            continue
        cross = (v1[0] * v2[1] - v1[1] * v2[0]) / (l1 * l2)
        if abs(cross) <= 0.002:          # dead straight
            continue
        # How far b actually sits off the chord a->c. |cross| is sin of the turn,
        # so the perpendicular distance is that times the SHORTER arm: a 2 m stub
        # kinking 0.13 deg moves the corner 5 mm and is noise, while the same
        # angle on a 200 m wall moves it 45 cm and is a building.
        if abs(cross) * min(l1, l2) < COLLINEAR_SAGITTA_M:
            continue
        keep.append((bx, by))
    return keep if len(keep) >= 3 else out


def ccw(pts):
    p = pts[:-1] if pts and pts[0] == pts[-1] else pts[:]
    return p if signed_area(p + [p[0]]) >= 0 else p[::-1]


def inset(pts, d):
    """Offset a closed CCW ring inward by d metres (edge offset + corner
    intersect). Vertex i of the result corresponds to vertex i of the input,
    which is what lets the facet builder pair two rings edge for edge.

    Returns None when the result degenerates — which is the correct answer for a
    roof step narrower than the building, and is what stops a thin wing from
    turning inside out. A negative d offsets outward, which is how the eave gets
    its overhang.
    """
    p = ccw(pts)
    n = len(p)
    if n < 3:
        return None
    lines = []
    for i in range(n):
        x0, y0 = p[i]
        x1, y1 = p[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy)
        if L < 1e-9:
            return None
        nx, ny = dy / L, -dx / L               # inward normal for CCW winding
        lines.append((x0 - nx * d, y0 - ny * d, dx, dy))
    out = []
    for i in range(n):
        ax, ay, adx, ady = lines[i - 1]
        bx, by, bdx, bdy = lines[i]
        den = adx * bdy - ady * bdx
        if abs(den) < 1e-9:
            return None
        t = ((bx - ax) * bdy - (by - ay) * bdx) / den
        out.append((ax + adx * t, ay + ady * t))
    ring = out + [out[0]]
    if signed_area(ring) <= 1.0:               # collapsed or inverted
        return None
    # An offset can also fold a concave corner past itself without changing the
    # sign of the area. A vertex that has travelled much further than d is the
    # signature; the ring is unusable when that happens.
    for (x, y), (x0, y0) in zip(out, p):
        if math.hypot(x - x0, y - y0) > abs(d) * 6 + 3:
            return None
    return ring


def simplify(pts, tol):
    """Douglas-Peucker on a closed ring, anchored at its two furthest vertices.

    WHY: the Union's east wing wall is a staircase of ~1 m jogs, and every jog
    faces a different compass direction. Once facets are shaded BY that
    direction, consecutive jogs alternate bright/dark and the roof reads as a
    field of dashes — geometry that is perfectly correct and looks like noise.
    A roof does not need to follow a 1 m jog in a wall; simplifying below the
    eave overhang costs nothing visible and removes the alternation at source.
    """
    p = pts[:-1] if pts and pts[0] == pts[-1] else pts[:]
    n = len(p)
    if n < 5:
        return p
    i0 = 0
    i1 = max(range(n), key=lambda i: math.hypot(p[i][0] - p[0][0], p[i][1] - p[0][1]))
    if i1 == i0:
        return p

    def dp(seq):
        if len(seq) < 3:
            return seq
        a, b = seq[0], seq[-1]
        k, dmax = 0, -1.0
        for i in range(1, len(seq) - 1):
            d = seg_dist(seq[i], a, b)
            if d > dmax:
                k, dmax = i, d
        if dmax <= tol:
            return [a, b]
        return dp(seq[:k + 1])[:-1] + dp(seq[k:])

    out = dp(p[i0:i1 + 1])[:-1] + dp(p[i1:] + [p[0]])[:-1]
    return out if len(out) >= 3 else p


def seg_dist(p, a, b):
    ax, ay = a; bx, by = b
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 < 1e-12 else max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2))
    return math.hypot(p[0] - (ax + dx * t), p[1] - (ay + dy * t))


def clearance(p, poly):
    """Distance from a point to the footprint boundary."""
    return min(seg_dist(p, a, b) for a, b in zip(poly, poly[1:] + poly[:1]))


def inside(p, poly):
    return point_in_ring(p[0], p[1], poly + [poly[0]])


def ring_ok(ring, d, poly):
    """Has this offset ring folded ENOUGH to be worth abandoning?

    A correctly offset vertex sits at exactly `d` from the two walls that made
    it and no closer to any other. Anything nearer has been pushed there by a
    wall on the far side of a narrow wing.

    The tolerance matters. A first cut demanded every vertex be clean and
    dropped 34 buildings — including Batts, Parlin and Rainey, whose one small
    light-well notch folds a couple of metres in while the other 40 m of hall is
    perfectly fine. One folded corner is a local defect that `valid_step`
    removes facet by facet; a tenth of the ring folding means the offset itself
    has stopped being meaningful, and that is when the slope has to stop.
    """
    n = len(ring) - 1
    bad = sum(1 for pt in ring[:n]
              if not inside(pt, poly) or clearance(pt, poly) < d * 0.9)
    return bad <= max(1, int(0.10 * n))


def fold_free_run(pm, poly, run):
    """The deepest slope this footprint can carry before the offset folds.

    The Union is a cross with two thin wings. At the 9.8 m the imagery measured,
    the offset rings collapsed inside those wings and rendered as steps floating
    over a flat plane — a defect you could see from the default camera. Capping
    the run at the last fold-free offset gives every edge a slope that is a real
    offset of the wall below it; the wide middle simply keeps its flat deck,
    which is what the photograph shows there anyway.
    """
    ok = 0.0
    for k in range(1, 25):
        d = run * k / 24.0
        r = inset(pm, d)
        if r is None or not ring_ok(r, d, poly):
            break
        ok = d
    return ok


def valid_step(quad, d_outer, d_inner, poly):
    """Has either edge of this facet folded through the far wall?

    A correctly offset vertex sits at exactly `d` from the two walls that made
    it, and no closer to any other. So anything nearer than ~0.9 d has been
    pushed there by a wall on the far side of a narrow wing — a fold. The first
    cut at this used 0.55 and let the Union's wings through: a fold only has to
    overshoot a little to still clear a loose threshold.
    """
    for pt, d in ((quad[0], d_outer), (quad[1], d_outer),
                  (quad[2], d_inner), (quad[3], d_inner)):
        if d <= 0.05:                       # the eave ring sits outside the wall
            continue
        if not inside(pt, poly) or clearance(pt, poly) < d * 0.9:
            return False
    return True


def half_span(pts):
    """Rough inradius: the largest inset that still survives."""
    lo, hi = 0.0, 40.0
    for _ in range(14):
        mid = (lo + hi) / 2
        if inset(pts, mid) is not None:
            lo = mid
        else:
            hi = mid
    return lo


# ── shading ───────────────────────────────────────────────────────────
# WHY THE FIRST ATTEMPT STILL READ FLAT. Concentric stepped rings put every
# horizontal tread at the same angle to the light, so MapLibre shades all of
# them identically and a hip roof comes out as one flat plane with stripes on
# it — which is exactly what the render showed. A real hip reads because its
# four slopes face four different directions and therefore catch four different
# amounts of light.
#
# So each step is emitted as one quad PER EDGE instead of one ring polygon, each
# quad carrying `az`, the compass direction that slope faces. The tread is still
# geometrically horizontal — `fill-extrusion` gives no choice — but it is
# COLOURED as though it were tilted, which is what the eye actually reads.
#
# THE SECOND ATTEMPT ALSO FAILED, and the reason is worth writing down. The tint
# was baked into the same rd/rg/rn keys everything else uses, at the sun position
# for each of those three hours. But `timeofday.js` LERPS those three, and the
# morning sun (az 98) and the golden-hour sun (az 256) are nearly opposite — so
# at p=0.25, halfway between them, every facet's tint averaged back to grey and
# the roofs went flat again. Shading baked at fixed hours cannot survive being
# interpolated across the day.
#
# So the bake ships the two ENDS of the range (`rd`/`rg` bright, `rdd`/`rgd`
# dark) and `timeofday.js` picks the point between them from the LIVE sun and
# this facet's `az`. Same sun as the shadows and the disc — see sky.js §1, which
# is the whole reason that file exists.
AMBIENT    = 0.35             # how much light arrives with no direction at all
SHADE_LO, SHADE_HI = 0.70, 1.28   # a roof, not a chrome ball
# Shade as though the slope were steeper than it is. The geometry has to stay at
# the real 5:12 or the halls grow spires, but at a 22.6 deg tilt under a 54 deg
# sun the four slopes of a hip differ by about 20% — too little to make the hip
# lines read, so the roof came back looking like a flat plane with rings drawn on
# it. Shading at 38 deg spreads them enough for the diagonals to appear. This is
# the one deliberately non-physical number in the file, and `timeofday.js` has
# to agree with it — ROOF_SHADE there carries the same three constants.
SHADE_TILT = 38.0


# ── the flat deck inside the tiled band ───────────────────────────────
# Once the slopes were right, the thing still reading as "flat generated box"
# was the DECK: Gregory Gym, the Blanton, Hogg Auditorium and the Union are a
# tiled hip around a large flat middle, and the app was painting that middle in
# the building's terracotta, so a 40 m grey membrane roof rendered as a 40 m
# sheet of orange. The photograph says otherwise, and it is the same photograph
# the slopes came from:
#
#   Gregory Gym  #958a79   Blanton  #817e77   Hogg Aud  #ced0ca   SSB  #8d8d82
#
# So the deck gets its own polygon in its own measured colour. Only where the
# imagery says the middle is NOT tile — a full hip like Sutton or Waggener has
# no deck and gets none.
DECK_TILE_MAX = 0.35    # above this the "deck" is just more roof tile
DECK_MIN_PX   = 25      # too few samples to trust a median
DECK_MAX_CH   = 150     # a nadir photo is brighter than this scene; pull it down
DECK_DESAT    = 0.30    # and a touch of the photo's colour cast comes out with it
DECK_TOWARD   = 0.18    # ...and a little of the building's own roof, so the deck
                        # reads as part of the roof rather than a pasted patch


def deck_colour(cols, parent):
    """Median of the sampled deck pixels, brought into the scene's exposure.

    Straight off the photograph, Hogg Auditorium's membrane deck is #ced0ca —
    correct, and far brighter than anything else in this scene, so it rendered as
    a pale slab dropped onto the campus. The three constants above are the
    tempering, and they are taste, not measurement.
    """
    a = np.array(cols, dtype=float)
    med = np.median(a, axis=0)
    g = float(med.mean())
    med = med + (g - med) * DECK_DESAT
    if parent and len(parent) == 7:
        pc = np.array([int(parent[i:i + 2], 16) for i in (1, 3, 5)], dtype=float)
        med = med * (1 - DECK_TOWARD) + pc * DECK_TOWARD
    mx = float(med.max())
    if mx > DECK_MAX_CH:
        med = med * (DECK_MAX_CH / mx)
    return "#" + "".join("%02x" % int(round(max(0, min(255, c)))) for c in med)


def like(hexcol, src, dst, lo=0.05, hi=1.8):
    """Move a colour the same way the building's own roof colour moves.

    The deck was measured in daylight, but it has to exist at golden hour and at
    night too. Rather than invent a second and third palette, it travels by the
    per-channel ratio between the parent's own baked day colour and that hour's —
    so a deck can never drift out of the palette the rest of the roof lives in.
    """
    if not (hexcol and src and dst) or len(hexcol) != 7 or len(src) != 7 or len(dst) != 7:
        return hexcol
    out = []
    for i in (1, 3, 5):
        c = int(hexcol[i:i + 2], 16)
        s = max(1, int(src[i:i + 2], 16))
        d = int(dst[i:i + 2], 16)
        out.append(max(0, min(255, int(round(c * max(lo, min(hi, d / s)))))))
    return "#" + "".join("%02x" % c for c in out)


def tint(hexcol, mul):
    if not hexcol or not hexcol.startswith("#") or len(hexcol) != 7:
        return hexcol
    v = [int(hexcol[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join("%02x" % max(0, min(255, int(round(c * mul)))) for c in v)


def facet_az(p0, p1):
    """Outward normal azimuth (degrees from north, clockwise) of a CCW edge."""
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    L = math.hypot(dx, dy)
    if L < 1e-9:
        return None
    nx, ny = -dy / L, dx / L                   # outward for CCW winding
    return (math.degrees(math.atan2(nx, ny)) + 360.0) % 360.0


def ring_tile_frac(ring_m, lat0):
    """Fraction of samples ALONG an offset ring that read terracotta.

    Sampling the ring rather than the area is the whole v2 idea: a hip roof with
    a flat central deck is tile at 3 m in and membrane at 12 m in, and only a
    ring probe can tell those apart.
    """
    ll = to_ll(ring_m, lat0)
    hit = tot = 0
    for (x0, y0), (x1, y1) in zip(ring_m, ring_m[1:]):
        L = math.hypot(x1 - x0, y1 - y0)
        n = max(1, int(L / 1.2))
        for i in range(n):
            t = (i + 0.5) / n
            xm, ym = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            k = math.cos(math.radians(lat0))
            c = px_at(xm / (M_LAT * k), ym / M_LAT)
            if c is None:
                continue
            tot += 1
            hit += is_tile(c)
    return (hit / tot if tot else 0.0), tot


def tile_run(pm, lat0, hs):
    """How far in from the eave the tile goes, in metres. 0 means flat roof.

    Walks inward until the imagery stops being tile — tolerating RING_MISSES
    rings, because a live oak overhanging an eave darkens a band of roof it does
    not own, and this campus is full of them.
    """
    run = 0.0
    misses = 0
    eave = 0.0
    d = EAVE_D
    while d < hs:
        r = inset(pm, d)
        if r is None:
            break
        fr, n = ring_tile_frac(r, lat0)
        if d == EAVE_D:
            eave = fr
            if n < 8:
                return 0.0, 0.0
        if fr >= RING_MIN:
            run = d
            misses = 0
        else:
            misses += 1
            if misses > RING_MISSES:
                break
        d += RING_STEP_M
    return run, eave


def main():
    report = "--report" in sys.argv
    # Probing 2,400 footprints against the imagery takes minutes; the geometry
    # takes seconds. Splitting the two means the shape can be iterated on — which
    # it needs to be, by looking at renders — without re-reading the photograph
    # every time. `--remeasure` forces the read.
    remeasure = "--remeasure" in sys.argv or not os.path.exists(MEAS)
    cache = {} if remeasure else json.load(open(MEAS, encoding="utf-8"))
    feats = json.load(open(SNAP, encoding="utf-8"))["features"]
    out = []
    stats = Counter()
    rows = []
    for f in feats:
        p = f["properties"]
        h = p.get("final_height") or 0
        if h < 4 or h > MAX_HEIGHT_M:
            continue
        g = f["geometry"]
        rings = [g["coordinates"][0]] if g["type"] == "Polygon" else [poly[0] for poly in g["coordinates"]]
        for ri, ring in enumerate(rings):
            if len(ring) < 4:
                continue
            lat0 = sum(q[1] for q in ring) / len(ring)
            pm = clean(simplify(clean(to_m(ring, lat0)), SIMPLIFY_M))
            if len(pm) < 3:
                stats["degenerate_footprint"] += 1
                continue
            hs = half_span(pm)
            if hs < 1.2:
                stats["too_narrow"] += 1
                continue
            key = "%s/%d" % (p.get("id"), ri)
            if key in cache:
                run, eave = cache[key]
            else:
                run, eave = tile_run(pm, lat0, hs)
                cache[key] = [round(run, 2), round(eave, 3)]
            if run < MIN_RUN_M:
                stats["flat" if eave < RING_MIN else "tile_edge_only"] += 1
                continue
            poly = ccw(pm)
            capped = fold_free_run(pm, poly, run)
            if capped < run - 0.05:
                stats["fold_capped"] += 1
            run = capped
            if run < MIN_RUN_M:
                stats["too_narrow_to_slope"] += 1
                continue

            rise = min(RISE_MAX, PITCH * run)
            steps = max(STEPS_MIN, min(STEPS_MAX, int(round(run / STEP_TARGET_M))))
            # The wall's cap already sits at h + lift (CAP_GEOM in app.js); start
            # the roof from there so nothing z-fights the parapet.
            base = h + max(1.0, 0.015 * h)
            before = len(out)
            # Ring 0 is the eave: outside the wall, and flat, so the roof reads
            # as sitting ON the building with an overhang instead of growing out
            # of it. It carries no rise, so it needs no per-facet tint.
            eave_ring = inset(pm, -EAVE_OUT_M)
            if eave_ring is not None:
                # The eave lip is flat, so both ends of its shade range are the
                # building's own baked colour and the sun term cannot move it.
                out.append({
                    "type": "Feature",
                    "geometry": {"type": "Polygon", "coordinates": [to_ll(eave_ring, lat0)]},
                    "properties": {"b": round(base, 2), "h": round(base + 0.35, 2), "az": 0,
                                   "rd": p.get("rd"), "rg": p.get("rg"), "rn": p.get("rn"),
                                   "rdd": p.get("rd"), "rgd": p.get("rg")},
                })
            start = eave_ring if eave_ring is not None else (ccw(pm) + [ccw(pm)[0]])
            rings = [(start, -EAVE_OUT_M, 0.0)]
            for s in range(1, steps + 1):
                d = run * s / (steps + 0.35)
                rings.append((inset(pm, d), d, rise * s / steps))
            made = 0
            for (r0, d0, t0), (r1, d1, t1) in zip(rings, rings[1:]):
                if r0 is None or r1 is None:
                    break
                b = round(base + 0.35 + t0, 2)
                ht = round(base + 0.35 + max(t1, t0 + 0.15), 2)
                n = min(len(r0), len(r1)) - 1
                for i in range(n):
                    az = facet_az(r0[i], r0[i + 1])
                    if az is None:
                        continue
                    quad = [r0[i], r0[i + 1], r1[i + 1], r1[i], r0[i]]
                    if abs(signed_area(quad)) < 0.35:      # a sliver, not a facet
                        continue
                    # A mitred offset FOLDS where the building is narrower than
                    # twice the offset — the Union's two thin wings turned into
                    # spikes that rendered as steps floating over a flat plane.
                    # A folded corner has crossed to the wrong side of the wall
                    # it came from, so it is either outside the footprint or too
                    # close to it. Dropping those facets leaves a narrow wing
                    # topping out lower than the main block, which is what a
                    # narrow wing at the same pitch actually does.
                    if not valid_step(quad, d0, d1, poly):
                        continue
                    out.append({
                        "type": "Feature",
                        "geometry": {"type": "Polygon", "coordinates": [to_ll(quad, lat0)]},
                        "properties": {
                            "b": b, "h": ht,
                            "az": round(az),        # which way this slope faces
                            # The two ends of this facet's shade range, from the
                            # parent's own baked roof colours so a facet can
                            # never drift from the cap it sits on. Which end it
                            # lands on is the live sun's call, in timeofday.js.
                            "rd": tint(p.get("rd"), SHADE_HI),
                            "rdd": tint(p.get("rd"), SHADE_LO),
                            "rg": tint(p.get("rg"), SHADE_HI),
                            "rgd": tint(p.get("rg"), SHADE_LO),
                            "rn": p.get("rn"),      # no sun at night, no tilt tint
                        },
                    })
                made += 1

            # THE TOP. Whatever the slope encloses has to be filled AT THE TOP OF
            # THE SLOPE, always. Leaving it out was the bug that made the Union
            # look broken: the tiled band climbed 2.9 m while the middle stayed
            # down on the wall cap, so the steps genuinely were floating over a
            # flat plane — the render was right and the geometry was wrong.
            #
            # Its COLOUR is the photograph's call. A membrane deck gets its own
            # measured grey; a middle that still reads as tile is the ridge of a
            # full hip and keeps the building's tile colour.
            deck = inset(pm, min(run + 1.6, hs * 0.95))
            if made >= 1 and deck is not None:
                cols, hits = [], 0
                dll = to_ll(deck, lat0)
                lons = [q[0] for q in dll]; lats = [q[1] for q in dll]
                for i in range(16):
                    for j in range(16):
                        lon = min(lons) + (max(lons) - min(lons)) * (i + 0.5) / 16
                        lat = min(lats) + (max(lats) - min(lats)) * (j + 0.5) / 16
                        if not point_in_ring(lon, lat, dll):
                            continue
                        c = px_at(lon, lat)
                        if c is None:
                            continue
                        cols.append([int(c[0]), int(c[1]), int(c[2])])
                        hits += is_tile(c)
                membrane = len(cols) >= DECK_MIN_PX and hits / len(cols) <= DECK_TILE_MAX
                if membrane:
                    dc = deck_colour(cols, p.get("rd"))
                    props = {"rd": dc, "rdd": dc,
                             "rg": like(dc, p.get("rd"), p.get("rg")),
                             "rgd": like(dc, p.get("rd"), p.get("rg")),
                             "rn": like(dc, p.get("rd"), p.get("rn"))}
                else:
                    props = {"rd": p.get("rd"), "rdd": p.get("rd"),
                             "rg": p.get("rg"), "rgd": p.get("rg"),
                             "rn": p.get("rn")}
                top = round(base + 0.35 + rise, 2)
                props.update({"b": round(top - 0.3, 2), "h": top, "az": 0})
                out.append({
                    "type": "Feature",
                    "geometry": {"type": "Polygon", "coordinates": [dll]},
                    "properties": props,
                })
                stats["decks" if membrane else "ridge_tops"] += 1

            if made < 1:
                stats["tiled_but_degenerate"] += 1
                del out[before:]
                continue
            stats["tiled"] += 1
            stats["steps"] += made
            if report:
                area_fr, _ = tile_frac_area(ring)
                rows.append((run, hs, eave, area_fr, rise, p.get("name") or "(unnamed)"))

    fc = {"type": "FeatureCollection", "features": out}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(fc, fh, separators=(",", ":"))
    with open(MEAS, "w", encoding="utf-8") as fh:
        json.dump(cache, fh, separators=(",", ":"), sort_keys=True)
    print(json.dumps({
        "roof_steps": len(out),
        "file_kb": round(os.path.getsize(OUT) / 1024, 1),
        "counts": dict(sorted(stats.items())),
        "rule": "tile still reads on an offset ring %.2f m in; slope runs to where it stops"
                % EAVE_D,
        "provenance": {"which buildings": "factual - terracotta tile read off the photograph",
                       "how far the slope runs": "factual - measured per building, eave to deck",
                       "roof shape": "GENERATIVE - stepped inset caps at a 5:12 pitch; "
                                     "fill-extrusion cannot slope a face"},
    }, indent=2))
    if report:
        rows.sort(key=lambda r: -r[0])
        print("\n  run    hs   eave  v1_area  rise  building")
        for run, hs, eave, area, rise, nm in rows:
            print("  %5.1f %5.1f  %.2f    %.2f  %4.1f  %s"
                  % (run, hs, eave, area, rise, nm[:44]))


if __name__ == "__main__":
    main()
