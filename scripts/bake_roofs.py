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

Usage:  python scripts/bake_roofs.py [--rebake] [--report] [--remeasure] [--audit]

  (no flag)     AUGMENT. Generate everything, write only what data/roofs.geojson
                does not already carry — the `f` tags and the `rig` member —
                and stop dead if a generated feature disagrees with a shipped
                one. See the AUGMENT block below for the pixels this cost.

  --rebake      write the features this bake generated. The city changes.

  --remeasure   re-read the imagery instead of reusing data/roof_runs.json.
                Required after changing the imagery cache or the tile rule; the
                cache exists because probing 2,400 footprints takes minutes and
                the geometry takes seconds, and the geometry is what needs
                iterating against renders.

  --audit       do not hunt diagonal roofs by eye. Name them. See AUDIT below.
"""
import colorsys
import json
import math
import os
import re
import sys
from collections import Counter

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake_facades  # noqa: E402

# THE SNAPSHOT THE ROOFS SIT ON IS THE ONE THE APP DRAWS. This was pinned to
# 2026-07-30 until 2026-09-02, nineteen snapshots behind `manifest.latest`,
# which is what js/app.js loads the walls from. Measured across that gap:
# every footprint identical, but two buildings' heights moved (University
# Catholic Center 7.4 -> 12.8 m, University Christian Church 37.0 -> 16.5 m)
# and one wall colour — and a roof's `base` is the wall's `final_height`, so
# a pinned bake puts a roof either inside the walls the renderer draws or
# floating over them, and the height gate (MAX_HEIGHT_M) judges a building
# by a height the app no longer uses. bake_entrances.py made the same call
# for the same reason. `SNAP_DATE=2026-07-30 python scripts/bake_roofs.py`
# pins a named snapshot for a rebake that must not roll the city under it.
# ── THE SHIPPED FEATURES ARE THE CITY. THIS BAKE AUGMENTS THEM. ──────
#
# WHAT WENT WRONG, MEASURED. The slopes pass (HANDOFF §204) needed two new
# things in this file — the `rig` foreign member and the `f` tags — and got
# them by re-running the bake. The re-bake also, silently, rebuilt the city:
# against `main` at `?slopes=0`, with the three.js layer switched OFF and
# therefore drawing nothing at all, 174,547 of 1,296,000 mall-cruise pixels
# differed (13.5%, max channel delta 140), 91,519 at gregory, 204,516 at
# battle-street. Copying only this file into a clean `main` checkout
# reproduced every one of them. Three inputs had moved under the bake:
#
#   1. THE WING SURVEY (`tiled_part`, --no-tiled-part below). It needs
#      shapely; this machine has 2.0.7 and the Aug 22 bake's machine did not
#      run it. It added 101 features — a whole tiled roof on Calhoun Hall's
#      north wing where the shipped city has a flat grey deck.
#   2. THE SNAPSHOT. `manifest.latest` is the right answer for a real bake
#      (see the block below) and it is a DIFFERENT answer from the one the
#      shipped file was baked with. Different building order in, different
#      feature order out — and coplanar roof steps whose draw-order ties then
#      resolve the other way, which is a delta-1 dither along every step edge
#      across the whole campus.
#   3. THE IMAGERY. `data/imagery_cache/` is GITIGNORED — 2,335 tiles that
#      are not in the repo and are not the same on two machines. The deck
#      vote (`membrane`, DECK_MIN_PX) is read live from it on every bake, and
#      it flipped on 12 roofs here: twelve deck tops that ship terracotta came
#      out grey, up to 96 channel units apart. No pin can fix this one. The
#      measurements ARE cached (data/roof_runs.json); this vote is not.
#
# SO: BY DEFAULT THIS SCRIPT NO LONGER WRITES THE FEATURES IT GENERATES.
# It generates them, checks them against the ones already in
# `data/roofs.geojson`, and writes the SHIPPED array back with only the `f`
# tags added, plus `rig` computed from the pass that would have written them.
# The generated features are the proof, not the product: if a single one
# disagrees with the shipped file on geometry or on any property but colour,
# the run stops (exit 2) and names the index. Zero pixels move, by
# construction rather than by hope.
#
# `--rebake` is the opt-out and is what a real roof change runs: latest
# snapshot, wing survey on, features written as generated. It WILL move
# pixels — that is what it is for — and it is the roofs lane's call, not a
# side effect of a pass that only wanted to add a member.
AUGMENT            = "--rebake" not in sys.argv
AUGMENT_SNAP       = "2026-07-30"   # the snapshot data/roofs.geojson was baked from
AUGMENT_TILED_PART = False          # ...and without the wing survey

SNAP_DATE = (os.environ.get("SNAP_DATE")
             or (AUGMENT_SNAP if AUGMENT else bake_facades.snapshot_date()))
SNAP = os.path.join(ROOT, "data", "snapshots", SNAP_DATE, "buildings.detailed.geojson")
TILES = os.path.join(ROOT, "data", "imagery_cache")
OUT = os.path.join(ROOT, "data", "roofs.geojson")
MEAS = os.path.join(ROOT, "data", "roof_runs.json")   # what the photograph said
# Read, never written: bake_roofscape.py owns it. See the ROOF_CAPS block below.
ROOFSCAPE = os.path.join(ROOT, "data", "roofscape.geojson")
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

# ── the parapet cap over a membrane deck ──────────────────────────────
#
# THE DEFECT. Every flat roof on campus was ringed in a hard burnt orange.
# Measured with the magenta-mask trick at tour.mjs's `day-tower-close`
# (scripts/verify/roof-ring.mjs): `buildings-roof` — the parapet cap app.js
# draws over every building's top face, painted from the building's own
# terracotta `rd` — owns 9,543 px at rgb(173,88,51), sitting round the outside
# of `roofscape-deck`'s 81,414 px at rgb(151,138,114). bake_roofscape.py insets
# its deck 1.1 m so the cap "reads as a rim around it", and on a building whose
# roof is grey membrane that rim is a burnt-orange outline. It reads as a
# selection highlight, not as architecture. Calhoun Hall, the Peter Flawn
# Academic Center, the O'Donnell Building and McCombs all measure run = 0.0
# here — none of them has a tiled roof at all, and all four were outlined in
# roof tile.
#
# THE RULE, and it is a rule rather than a per-building patch: A BUILDING WHOSE
# ROOF IS A MEMBRANE DECK DOES NOT HAVE A TERRACOTTA PARAPET CAP. Its cap takes
# the deck's own measured colour. A building whose roof is tile keeps the tile
# colour, because on those the cap is under the eave of a real tiled hip.
#
# WHY THE COLOUR IS READ OUT OF `roofscape.geojson` RATHER THAN MEASURED AGAIN
# HERE. This file has its own imagery and its own `deck_colour()`, and using it
# would give the cap a colour close to the deck's but not equal to it — which is
# a fainter ring, not no ring. The whole point is that the two surfaces stop
# disagreeing, so the cap is given the DECK'S OWN VALUE, byte for byte. That
# makes the dependency explicit: if bake_roofscape.py re-measures, re-run this.
#
# WHY A TABLE RATHER THAN GEOMETRY. The other way to cover a terracotta rim is
# to draw a coping polygon over it. Measured on the real footprints, one
# full-footprint coping per decked building is +783 KB on a 1,044 KB file that
# is not tiled — every visitor downloads it — for a colour correction. The table
# is +115 KB in the same file, and adds no polygons to a scene that is already
# fill-rate bound.
ROOF_CAPS      = True    # False = leave every parapet cap terracotta
CAP_DECK_TINT  = 1.0     # 1.0 = exactly the membrane. >1 lightens the coping.
CAP_BASE_TOL_M = 0.75    # a deck must sit on the cap it is claimed to belong to


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
    # NEITHER OF THOSE TWO GUARDS CATCHES AN INSIDE-OUT RING, and that is worth
    # a sentence because it stayed hidden for a long time behind them. On a
    # 23 x 22 m building `inset(pm, 40)` returns a 3,746 m^2 ring whose seven
    # vertices are ALL outside the footprint: the area came back positive because
    # the whole polygon turned over, and no vertex travelled the 243 m the second
    # guard was watching for. So `half_span` — a binary search on "did inset
    # succeed" — reported a half-span of 40 m, the deck cap `hs * 0.95` stopped
    # capping anything, and that building got no deck at all.
    #
    # An inward offset by d has one definition and it is worth testing directly:
    # every vertex lies inside the footprint. Anything else is not an offset.
    if d > 0:
        for q in out:
            if not inside(q, p):
                return None
    return ring


# How much nearer than its own offset a vertex may sit before it has stopped
# being an inward offset at all. Metres, and small: this is a numerical slack on
# an exact geometric condition, not a taste value and not a tolerance to tune.
OFFSET_SLACK_M = 0.05


def mitre_rays(poly):
    """Per-vertex direction the mitred inward offset travels, per metre of offset.

    Both offset lines translate linearly with d, so their intersection does too:
    vertex j sits at `poly[j] + d * u[j]` for EVERY d. Solving the ray once is
    what makes a per-vertex cap cheap — capping one vertex is then clamping a
    scalar along a fixed line, with no re-solve and no loss of the index
    correspondence the facet builder depends on.
    """
    n = len(poly)
    lines = []
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy)
        if L < 1e-9:
            return None
        nx, ny = dy / L, -dx / L
        lines.append((x0 - nx, y0 - ny, dx, dy))      # the offset lines at d = 1
    u = []
    for i in range(n):
        ax, ay, adx, ady = lines[i - 1]
        bx, by, bdx, bdy = lines[i]
        den = adx * bdy - ady * bdx
        if abs(den) < 1e-9:
            return None
        t = ((bx - ax) * bdy - (by - ay) * bdx) / den
        u.append((ax + adx * t - poly[i][0], ay + ady * t - poly[i][1]))
    return u


def cap_along(p, u, poly, dmax=60.0):
    """The furthest p can travel along ray u and still BE an inward offset.

    A correctly offset point is inside the footprint and no nearer to any wall
    than the offset itself. Both stop being true at the same moment — when the
    point reaches the medial axis, i.e. when the slope it belongs to has run
    into the slope coming the other way. That moment is this roof's RIDGE, and
    past it the offset keeps going and starts lying.

    The condition is monotone in d (`clearance` along the ray grows at most as
    fast as d, so once it falls behind it never catches up), which is what makes
    a bisection sound here.
    """
    px, py = p
    ux, uy = u
    lo, hi = 0.0, dmax
    for _ in range(18):
        mid = (lo + hi) * 0.5
        q = (px + ux * mid, py + uy * mid)
        if inside(q, poly) and clearance(q, poly) >= mid - OFFSET_SLACK_M:
            lo = mid
        else:
            hi = mid
    return lo


def vertex_caps(poly, u, dmax=60.0):
    """`cap_along` at every footprint vertex, along its mitre ray."""
    return [cap_along(poly[j], u[j], poly, dmax) for j in range(len(poly))]


# ── A MITRE SLIDES ALONG THE WALL AS FAST AS IT GOES INTO IT ──────────
#
# QUEUE H5: *"Jester roofs have some weird extrusions with the diagonals.
# specifically above where it says J2. other buildings with alot of corners next
# to each other with cornered roofs have this weird intersecting as well."*
#
# THE MEASUREMENT THAT NAMES IT. On the Beauford H. Jester Center, whose
# override runs the tile 11.0 m in from a footprint of 24 walls, several of them
# under 7 m long:
#
#     step 6, edge  1:  wall  6.1 m,  facet runs 10.72 m PAST the end of it
#     step 6, edge  8:  wall  6.7 m,  facet runs 10.38 m past, ring not simple
#     step 6, edge 20:  wall  5.7 m,  facet runs 10.29 m past, ring not simple
#     74 of its 129 facets run more than 2 m past their own wall; 48 over 5 m.
#
# WHY, and it is one sentence: `cap_along` caps how DEEP a mitre goes and there
# was never anything capping how far SIDEWAYS it goes. At a right-angled corner
# the bisector moves one metre along the wall for every metre it moves into it,
# so at an 11 m step depth a 6 m wall's two corners have each slid 11 m along a
# wall 6 m long — they have swapped ends. The facet between them is then a long
# diagonal wedge lying across its neighbours' slopes, and where they swap it is
# a bow tie. That IS the "weird extrusion with the diagonals", and "buildings
# with a lot of corners next to each other" is the exact condition: closely
# spaced corners mean short walls, and a short wall is one the step depth
# outruns.
#
# NONE OF THE EXISTING GUARDS CAN SEE IT, which is why it survived four passes:
#   * `valid_step` asks whether each corner is inside the footprint and no
#     nearer to it than it has travelled. Both corners pass — they are legally
#     offset points. It never asks whether they are still in ORDER.
#   * `cap_along` measures clearance, which is perpendicular. A point sliding
#     along the middle of a wide building keeps its clearance the whole way.
#   * `resolve_surfaces` de-overlaps within one height group, and these facets
#     are at six different steps, so it never compares them. Measured: with the
#     authored elevations excluded, the whole campus has 6 same-height facet
#     overlaps totalling 96.5 m2. The stabbing is not an overlap at all.
#
# THE RULE, and it is the straight skeleton's own answer rather than a
# heuristic: A WALL EXISTS ONLY UNTIL ITS TWO MITRES MEET. That moment is an
# EDGE EVENT — past it the wall has zero length, so every square metre of facet
# drawn past it was drawn over a wall that is not there. Both corners are capped
# at it. Nothing is traded away, because there was nothing there to trade.
#
# It is closed form. Vertex i's offset slides along the wall's own direction by
# `min(d, cap_i) * (u_i . t)` and vertex j's sits at `L + min(d, cap_j) *
# (u_j . t)`; the gap between them is piecewise linear in d with breakpoints at
# the two existing caps, so the first depth at which it closes is read straight
# off the pieces. No bisection, no tolerance, no iteration.
#
# AND IT COSTS NOTHING ON A NORMAL ROOF. On a rectangle the two mitres of the
# short wall meet at exactly half its length, which is the half-span — the same
# number `cap_along` already returns, because the ridge of a hip roof IS an edge
# event. The cap only bites where a wall is shorter than the roof is deep, which
# is the defect and nowhere else.
EDGE_EVENTS = "--no-edge-events" not in sys.argv


def _first_gap_close(L, ai, aj, ci, cj, dmax):
    """Smallest d > 0 at which the two capped mitres of one wall meet.

    `ai`/`aj` are the along-wall components of the two mitre rays, `ci`/`cj`
    their existing caps. Returns `dmax` if they never meet inside it.
    """
    def gap(d):
        return L + min(d, cj) * aj - min(d, ci) * ai

    lo = 0.0
    for hi in sorted({min(ci, cj), max(ci, cj), dmax}):
        if hi <= lo:
            continue
        g0, g1 = gap(lo), gap(hi)
        if g1 > 1e-9:
            lo = hi
            continue
        if g0 <= 1e-9:                      # already closed at the piece start
            return lo
        return lo + (hi - lo) * g0 / (g0 - g1)
    return dmax


def edge_event_caps(poly, u, caps, dmax=60.0):
    """`caps`, further limited so no wall's two mitres can cross each other."""
    if not EDGE_EVENTS:
        return list(caps), 0
    n = len(poly)
    out = list(caps)
    bit = 0
    for i in range(n):
        j = (i + 1) % n
        x0, y0 = poly[i]
        x1, y1 = poly[j]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy)
        if L < 1e-9:
            continue
        tx, ty = dx / L, dy / L
        d_ev = _first_gap_close(L, u[i][0] * tx + u[i][1] * ty,
                                u[j][0] * tx + u[j][1] * ty,
                                caps[i], caps[j], dmax)
        if d_ev < min(caps[i], caps[j]) - 1e-6:
            bit += 1
        out[i] = min(out[i], d_ev)
        out[j] = min(out[j], d_ev)
    return out, bit


# ── a wall is not its two corners ─────────────────────────────────────
#
# THE SECOND CAUSE OF THE DIAGONAL ROOFS, and it is the same mistake as the two
# before it, one scale further in.
#
# PR #57 replaced a scale-blind ANGLE with a sagitta in metres. PR #74 replaced a
# GLOBAL run cut-back (`fold_free_run`, which let one notch shorten every slope on
# the building) with a PER-VERTEX cap. Both were right. Both stopped one step
# short of the actual unit of the problem, because a cap is still shared by the
# two facets that meet at the vertex — so a wall's slope is clamped to whatever
# its WORST CORNER can reach, however far away that corner is.
#
# Measured, on the roof this was traced on: the Moncrief-Neuhaus Athletic Center
# has a 55.4 m north wall between two reflex corners, both pinched by the recess
# behind them and both capped at 5.06 m. The roof's step depth is 12.66 m. So the
# slope stopped 5.1 m in along the WHOLE 55.4 m wall, the deck — which sits at the
# top of the entire rise — spread over the remaining 7.5 m, and what you see from
# the air is a flat plate at full height running out to within 5 m of that eave
# while the walls either side of it slope properly. The line between them runs
# diagonally across both corners. `audit_coverage` scores it zero because every
# square metre IS covered; it is covered by the wrong thing.
#
# THE RULE. A mitre at a corner is a hip line and is correct — corners are where
# a hip roof genuinely does converge early. What is not correct is applying a
# corner's limit to the 50 m of wall between two corners. So a wall whose MIDDLE
# can outrun its own corners gets sample points of its own along it, each offset
# along the wall's normal and each capped on its own merits. The facet stops
# being a quad and becomes a strip with a straight eave and an inner edge that
# dips only where the roof actually pinches.
#
# ONLY WHERE IT IS NEEDED, and that is not thrift, it is the same argument as
# HANDOFF §37: this file is downloaded whole by every visitor. Densifying every
# wall would add a point per metre to 377 facets for no visible gain. The test is
# exact — offset the wall's midpoint and ask whether it beats its corners — so
# the walls that get the extra points are the walls that were being lied about.
DENSIFY_GAIN_M = 0.75   # the middle must beat its corners by this to be worth it
DENSIFY_MAX_PTS = 8     # most sample points one wall's slope may gain
DENSIFY_MARGIN_M = 0.25 # clear of each corner's own mitre face, in metres


def wall_profile(poly, mrays, caps, d_final):
    """Every point this roof offsets inward, in ring order, with its own cap.

    Returns `(pts, rays, pcaps, spans)`. Entry `spans[i] = (a, b)` says that
    profile entries a..b inclusive are the outer boundary of edge i's slope,
    running from the mitre at `poly[i]` to the mitre at `poly[i + 1]`. Offsetting
    is then `pts[k] + rays[k] * min(d, pcaps[k])` for every ring, so the rings
    still nest and still pair index for index — which is what the facet builder
    and the deck both depend on.
    """
    n = len(poly)
    pts, rays, pcaps, spans = [], [], [], []
    for i in range(n):
        a = len(pts)
        pts.append(poly[i]); rays.append(mrays[i]); pcaps.append(caps[i])
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy)
        if L > 1e-9:
            u = (-dy / L, dx / L)          # inward normal, matching inset()
            mid = (x0 + dx * 0.5, y0 + dy * 0.5)
            # WHAT THE QUAD ACTUALLY REACHES, not what its better corner does.
            # A mitre ray is built so that `poly[j] + u[j] * t` is exactly t from
            # both of its own walls, so a corner capped at c contributes depth c
            # to this wall and the straight inner edge between them reaches their
            # MEAN at the midpoint. Comparing against the max was the first
            # version of this test and it let Gregory Gym through: one corner sat
            # at 12.41 m, past the 9.16 m step depth, so the test said the corners
            # were not limiting — while the other corner, at 5.05 m, was dragging
            # the whole 8.4 m wall back with it.
            got = 0.5 * (min(d_final, caps[i]) + min(d_final, caps[(i + 1) % n]))
            gain = min(d_final, cap_along(mid, u, poly)) - got
            if gain > DENSIFY_GAIN_M:
                # SAMPLES GO BETWEEN THE TWO CORNER FACES, NOT ACROSS THEM, and
                # this is not tidiness — without it the facet is a polygon that
                # crosses itself. A mitre at a convex corner travels ALONG the
                # wall as well as into it: at a right angle it moves 1 m sideways
                # per metre of depth, so at a 9 m step the corner's inner point
                # sits 9 m down an 8.4 m wall. The samples sit on the SAME corner
                # bisector nearer the corner, so the inner boundary ran out to
                # the mitre and then marched back over itself — 78 self-crossing
                # facets, which earcut turns into folded slivers.
                #
                # The corner's own mitre triangle already covers that end of the
                # wall. So a sample is only placed where the mitres have not
                # reached, which makes the inner chain monotone along the wall by
                # construction and the strip simple. `roofs_with_a_hole` is the
                # check that this leaves nothing bare, and it stays at 0.
                jn = (i + 1) % n
                di = min(d_final, caps[i])
                dj = min(d_final, caps[jn])
                tx, ty = dx / L, dy / L
                s_lo = mrays[i][0] * di * tx + mrays[i][1] * di * ty
                s_hi = L + mrays[jn][0] * dj * tx + mrays[jn][1] * dj * ty
                s_lo = max(0.0, s_lo) + DENSIFY_MARGIN_M
                s_hi = min(L, s_hi) - DENSIFY_MARGIN_M
                span = s_hi - s_lo
                if span > DENSIFY_MARGIN_M:
                    k = max(1, min(DENSIFY_MAX_PTS, int(span / 2.0)))
                    for s in range(1, k + 1):
                        t = (s_lo + span * s / (k + 1.0)) / L
                        q = (x0 + dx * t, y0 + dy * t)
                        pts.append(q); rays.append(u)
                        pcaps.append(cap_along(q, u, poly))
        spans.append((a, len(pts)))        # b is the NEXT mitre, taken modulo
    return pts, rays, pcaps, spans


def profile_ring(pts, rays, pcaps, d):
    """The inward offset by d of a whole profile, closed."""
    out = [(p[0] + u[0] * min(d, c), p[1] + u[1] * min(d, c))
           for p, u, c in zip(pts, rays, pcaps)]
    return out + [out[0]]


def _inset_capped_history():
    """`inset_capped` USED TO LIVE HERE. `profile_ring` does its job and more —
    it offsets the same way and reaches the same numbers on every wall whose
    corners were not lying about it — so it is gone rather than kept beside its
    replacement. Its reasoning is not, because it is still the reasoning:

    THE FIX FOR THE DIAGONAL ROOFS, and the whole of it is: a vertex
    that cannot travel d does not get deleted, it stops.

    The old code offset every vertex the full d and then threw away any FACET
    whose corners had over-travelled (`valid_step`, at 0.9 of d). Throwing the
    facet away leaves a HOLE in the roof — the eave sits at the bottom of the
    rise, the deck sits at the top, and between them on that wall there is
    nothing. Seen from the air the boundary between the slopes that were built
    and the flat that was not runs diagonally across the corner. That is the
    diagonal, on every one of the four buildings it has been traced on: it was
    never a diagonal that got drawn, it was a slope that did not.

    Capping instead gives the wing a slope that stops climbing at its own
    half-width — a narrow wing topping out below the main block, which is what a
    narrow wing at a fixed pitch actually does, and which is what the old comment
    said it wanted — with no hole, because the facet is still there, just
    shorter. Where two capped vertices meet, the quad has no area and the sliver
    test drops it; that is a ridge line, and a ridge is not a hole.

    0.9 is gone with it. It was a scale-blind fudge standing in for an exact
    condition, in the same way the pre-PR-#57 angle threshold stood in for the
    sagitta.

    AND IT STOPPED ONE STEP SHORT, which is what `wall_profile` above is for: a
    vertex that stops takes the whole of both its walls down with it, because a
    quad has only its two corners to be built from.
    """


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


# `ring_ok` and `fold_free_run` USED TO LIVE HERE and both are deleted, because
# what they did is now impossible rather than tolerated.
#
# The pair implemented one idea: an offset ring may fold in up to a tenth of its
# vertices, and the run gets cut back globally to the last depth where that held.
# It was a compromise between two bad options — a strict rule dropped 34
# buildings for one light-well notch, and a loose one let the Union's wings
# through — and it is the compromise that produced the diagonals, because the
# facets it tolerated were then deleted one at a time by `valid_step`.
#
# A per-vertex cap has no compromise to make. The notch stops, the 40 m of hall
# beside it does not, and one building's worst corner no longer shortens the
# slope on every other wall it has. `fold_capped` fired on 45 buildings; there is
# nothing left for it to fire on.


def valid_step(quad, travels, poly):
    """Is every corner of this facet still a real offset of the wall below it?

    `travels` is how far each corner ACTUALLY moved, which after `inset_capped`
    is not the nominal step depth — a vertex at its cap has stopped short on
    purpose. Testing against the nominal depth is what the old 0.9 factor was
    papering over, and it is why this used to delete whole slopes.

    So it is now an exact statement with a numerical slack rather than a
    threshold: a corner that has travelled t must be inside the footprint and no
    nearer than t to it. By construction of the caps nothing should ever fail
    here; it is kept as a guard and its firings are counted, so if some future
    change makes a ring lie again the bake says so instead of quietly leaving a
    hole in a roof.
    """
    for pt, t in zip(quad, travels):
        if t <= 0.05:                       # the eave ring sits outside the wall
            continue
        if not inside(pt, poly) or clearance(pt, poly) < t - OFFSET_SLACK_M:
            return False
    return True


# ── AUDIT: find the diagonal roofs mechanically ───────────────────────
#
# "there are at least 3 diagonal roofs that shouldnt be there."
#
# A diagonal roof is never a diagonal somebody drew. It is a slope that was NOT
# drawn: the eave lip covers the whole footprint at the BOTTOM of the rise, the
# deck covers the middle at the TOP of it, and where the facets between them are
# missing on one wall you are looking straight down at the eave. The boundary
# between the slopes that got built and the flat that did not runs diagonally
# across the corner, and that wedge is what he keeps pointing at. Edgar A. Smith
# had three of its four slopes; the fourth was the 36.1 m north wall.
#
# THE FIRST VERSION OF THIS AUDIT COUNTED FACETS PER EDGE and it was the wrong
# question — it found the three, then reported nine after the fix, all of them
# false. A facet that collapses because its two corners have met is a RIDGE, and
# a ridge is a roof feature, not a hole. Counting cannot tell those apart.
#
# So measure the thing itself: rasterise the roof in plan at 0.25 m and ask what
# fraction of the footprint no facet and no deck covers. A ridge has no area and
# scores zero. A missing slope is a band metres wide and scores immediately. It
# also cannot be fooled by a fix that trades one hole for another somewhere else,
# which counting per edge very much can.
AUDIT_PX_M       = 0.25    # raster resolution, metres per pixel
AUDIT_HOLE_FR    = 0.04    # uncovered share of the footprint worth reporting
AUDIT_HOLE_M2    = 12.0    # ...and it has to be this big in absolute terms too

# ── AUDIT 2: a slope can also be MISSING WITHOUT LEAVING A HOLE ────────
#
# The coverage audit above closed one cause and reports 0 of 105 today. It is
# still not the whole question, and the reason is that it asks only "is this
# square metre covered by SOMETHING". A wall whose slope facets pinch to nothing
# is not left bare — the DECK, which sits at the top of the whole rise, spreads
# over that wall instead. Every pixel is covered, the audit scores zero, and what
# you see from the air is a flat plate at full height running out to the eave on
# one wall while the walls either side of it slope. The edge between the plate
# and the slopes that DID get built is a straight line across the corner. That is
# the diagonal, and coverage is blind to it by construction.
#
# So this asks the second question, the one QUEUE A1 named: DOES EVERY FOOTPRINT
# EDGE GET ITS OWN SLOPE AS DEEP AS THE ROOF ALLOWS? Per edge, walk along the
# wall and at each sample compare TWO numbers:
#
#   possible(t) = cap_along(t) clamped to the step depth. This is the exact
#                 geometric limit — the furthest that point of the wall can be
#                 offset inward and still be an inward offset — and it is not
#                 computed from the profile, the caps or anything the fix
#                 touches. Near a convex corner it falls away to nothing, which
#                 IS the hip line; past a ridge it stops, which IS the ridge.
#   achieved(t) = the perpendicular depth of the INNERMOST FACET THIS BAKE
#                 ACTUALLY EMITTED for that wall, read back off the polygon.
#
# The shortfall integrated along the wall is square metres of slope this roof
# should have had and does not. A ridge scores zero because `possible` stops at
# the ridge too. A hip line scores zero for the same reason.
#
# TWO RASTER VERSIONS OF THIS WERE WRITTEN FIRST AND BOTH WERE WRONG, which is
# worth the paragraph because both looked convincing:
#
#   Assigning each pixel to its nearest footprint SEGMENT reported Gregory Gym
#   as a missing slope on a roof with nothing wrong with it. Around a reflex
#   corner both walls that meet there are exactly equidistant from every point
#   in the fan beyond it — the nearest point is the shared corner for both — so
#   `argmin` gave one wall a 9 m quarter-disc it has no business covering.
#
#   Assigning by nearest edge LINE instead fixed that corner and broke
#   everything else: an edge's line runs on past the end of the edge, and on a
#   concave plan a wall 40 m away is often the nearest LINE to a pixel it has no
#   relationship with. That version reported 212 walls on 51 of 105 roofs.
#
# There is no cell here at all, which is why neither failure can come back.
DIAG_SAMPLE_M = 2.0     # walk the wall at about this spacing
DIAG_MIN_LEN  = 6.0     # a 3 m return is a corner detail, not a roof plane
DIAG_MIN_M2   = 25.0    # missing slope worth reporting, in square metres
DIAG_MIN_FR   = 0.20    # ...and this share of what the wall could have had


# ── AUDIT 3: ONE SQUARE METRE, ONE SURFACE ────────────────────────────
#
# BOTH AUDITS ABOVE ASK ONLY WHETHER A ROOF IS MISSING SOMETHING. Neither ever
# asks whether it has drawn something EXTRA, and that is the hole the Anna Hiss
# Gymnasium fell through — a building named in four separate reports, on a bake
# whose own audits printed `0 of 105` both times.
#
# What is wrong there: the deck ring SELF-INTERSECTS. Anna Hiss is a U round a
# courtyard whose west wing is about 15 m wide, so at a step depth of 7.36 m the
# inward offset of that wing has pinched off — the two opposing walls' offsets
# have passed through each other — and the mitred ring, which has one vertex per
# footprint vertex and no way to express "this arm is gone", comes back as a
# BOWTIE. `signed_area` is positive (475 m^2) so the emitted-file checks pass;
# every vertex is inside the footprint so `valid_step` passes; every square metre
# of the footprint is covered so `audit_coverage` passes; every wall got its full
# slope so `audit_slope_depth` passes. And what the GPU draws for a non-simple
# ring is not defined at all: earcut fills a big triangle straight across the
# open courtyard. That triangle IS the diagonal he has been pointing at.
#
# So the third question, and it is the one that catches both A5 and A6:
#
#   1. IS EVERY RING SIMPLE? A ring that crosses itself has no area — asking what
#      it covers is already the wrong question, so this is tested directly rather
#      than through a raster. THIS is the check that names Anna Hiss.
#   2. IS ANYTHING DRAWN OUTSIDE THE ROOF'S OWN OUTLINE? The eave ring is the
#      roof's outline by construction, so anything beyond it is roof over open
#      air. (A raster, so it also catches spills a simplicity test cannot see.)
#   3. ARE TWO SURFACES AT THE SAME HEIGHT OVER THE SAME GROUND? That is
#      z-fighting by definition — two coplanar faces have no defined winner, the
#      winner changes with the camera, and what the eye sees is a flicker along
#      the boundary. It is the same statement PR #78 made about the ground
#      ("one square metre, one surface"), asked of roof surfaces.
#
# QUESTIONS 2 AND 3 ARE A RASTER, DELIBERATELY, EVEN THOUGH THE RESOLVER BELOW
# USES SHAPELY. The resolver's answer and the audit's answer have to be able to
# disagree: if both were `Polygon.difference` then a bug in the library, or in
# how this file drives it, would produce a clean report on a broken file. So the
# fix is polygon arithmetic and the check is a 0.25 m raster of the same
# polygons, which is also what `audit_coverage` already does.
SURF_TOP_EPS   = 0.03   # tops within this are the same height, in metres
SURF_OVER_M2   = 2.0    # overlapping same-height area worth reporting
SURF_OUT_M2    = 2.0    # ...and area drawn outside the roof's own outline


def close_ring(r):
    return r if r and r[0] == r[-1] else (r + [r[0]] if r else r)


def ring_crossings(ring, tol=1e-7):
    """Every pair of non-adjacent edges of a closed ring that cross.

    O(n^2) over rings of at most a few dozen points, on 105 roofs. Adjacent
    edges are skipped because they share an endpoint by construction; anything
    else that touches is a fold.
    """
    p = ring[:-1] if ring and ring[0] == ring[-1] else ring[:]
    n = len(p)
    out = []
    if n < 4:
        return out

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    for i in range(n):
        a, b = p[i], p[(i + 1) % n]
        for j in range(i + 1, n):
            if j == i or (j + 1) % n == i or (i + 1) % n == j:
                continue
            c, d = p[j], p[(j + 1) % n]
            d1, d2 = cross(c, d, a), cross(c, d, b)
            d3, d4 = cross(a, b, c), cross(a, b, d)
            if abs(d1) < tol and abs(d2) < tol:
                continue                       # collinear overlap: not a fold
            if ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0)):
                out.append((i, j))
    return out


def ring_is_simple(ring, tol=1e-7):
    return not ring_crossings(ring, tol)


# ── THE OUTPUT GRID IS 0.1 m AND SOME FACETS ARE THINNER THAN THAT ────
#
# `to_ll` rounds to six decimal places, which at this latitude is 0.096 m of
# longitude and 0.111 m of latitude. A facet only a decimetre or two thick is
# therefore not a shape this file can write down: rounding moves its two long
# sides onto the same grid line, they swap over, and what lands in the GeoJSON
# is a bow tie. Sixteen rings in the shipped file are invalid for exactly this
# reason and no other — every one of them under 5 m2, every one produced by
# geometry that was simple in metres and destroyed by the write.
#
# It is worth being precise about the blame, because the obvious reading is
# wrong: the resolver is not leaking folds. Everything it emits comes back out
# of shapely valid. The invalidity is created AFTER all the arithmetic, by the
# rounding, which is why `audit_surfaces` reports `folded_rings: 0` on a file
# that has sixteen of them.
#
# So the check belongs where the damage happens — on the rounded coordinates,
# not on the metres. A ring that does not survive the write is dropped rather
# than shipped, and `audit_coverage` is the guard that says whether dropping it
# left a hole. (It does not: these are slivers in the joint between two facets
# that already meet.) Raising the precision to seven places would also work and
# costs about 6% of the file, which every visitor downloads, for geometry
# thinner than a roof tile.
def survives_rounding(ll_rings):
    """Is this polygon still valid after `to_ll` has rounded its coordinates?

    SHAPELY IS THE AUTHORITY HERE AND `ring_crossings` IS NOT, which cost a
    round: `ring_crossings` counts strict crossings only and deliberately
    ignores collinear touches, so it passed four rings that rounding had folded
    into a figure of eight touching at a point rather than crossing through it.
    The test that matters is the one the consumer applies, and `is_valid` is it.
    """
    rings = []
    for r in ll_rings:
        p = [tuple(q) for q in close_ring([list(q) for q in r])][:-1]
        p = [q for k, q in enumerate(p) if k == 0 or q != p[k - 1]]
        if len(p) < 3:
            return False
        rings.append(p)
    from shapely.geometry import Polygon
    try:
        return Polygon(rings[0], rings[1:]).is_valid
    except Exception:                                        # noqa: BLE001
        return False


def audit_surfaces(eave_ring, pieces, name, key, centre=None):
    """Non-simple rings, roof drawn past the eave, and two surfaces at one height.

    `pieces` is every polygon this roof emitted, as `(ring, top_height)` in local
    metres. `eave_ring` is the roof's own outline.
    """
    bad_rings = sum(0 if ring_is_simple(r) else 1 for r, _ in pieces)
    xs = [q[0] for q in eave_ring]; ys = [q[1] for q in eave_ring]
    x0, y0 = min(xs), min(ys)
    W = max(2, int((max(xs) - x0) / AUDIT_PX_M) + 3)
    H = max(2, int((max(ys) - y0) / AUDIT_PX_M) + 3)
    over_m2 = out_m2 = 0.0
    if W * H <= 4_000_000:
        T = lambda q: (1 + (q[0] - x0) / AUDIT_PX_M, 1 + (q[1] - y0) / AUDIT_PX_M)

        def raster(ring, grow=0):
            """`grow` -1 shaves the boundary off, +1 draws it on.

            THE FIRST VERSION OF THIS TOOK THE DEFAULT AND MEASURED SEAMS. Two
            facets that share an edge both claim the pixels ALONG that edge under
            a scanline fill, so a roof whose facets tile it perfectly came back
            reporting 99.1 m^2 drawn twice — one 0.25 m pixel wide, times every
            metre of shared boundary on the roof. Every roof in the file 'failed'
            and not one of them had anything wrong with it. Shaving the boundary
            off both sides is what makes the answer AREA rather than PERIMETER;
            the cost is that an overlap thinner than about 0.4 m is not seen,
            which is well under the 2 m^2 this reports at.
            """
            pts = [T(q) for q in ring]
            im = Image.new("1", (W, H), 0)
            d = ImageDraw.Draw(im)
            d.polygon(pts, fill=1, outline=1 if grow >= 0 else None)
            if grow < 0:
                d.line(pts + [pts[0]], fill=0, width=3)
            return np.asarray(im, dtype=bool)

        px = AUDIT_PX_M * AUDIT_PX_M
        # 2. anything beyond the eave. The eave is grown by its own boundary so a
        #    piece that merely shares that edge does not read as a spill.
        inside_eave = raster(eave_ring, grow=1)
        any_piece = np.zeros((H, W), dtype=bool)
        for r, _ in pieces:
            any_piece |= raster(r, grow=-1)
        out_m2 = float((any_piece & ~inside_eave).sum()) * px
        # 3. two surfaces at one height. Group by top, count double cover.
        groups = {}
        for r, t in pieces:
            groups.setdefault(round(t / SURF_TOP_EPS), []).append(r)
        for g in groups.values():
            if len(g) < 2:
                continue
            acc = np.zeros((H, W), dtype=np.uint8)
            for r in g:
                acc += raster(r, grow=-1).astype(np.uint8)
            over_m2 += float((acc >= 2).sum()) * px
    if bad_rings == 0 and over_m2 < SURF_OVER_M2 and out_m2 < SURF_OUT_M2:
        return None
    return {"name": name or "(unnamed)", "id": key, "at": centre,
            "folded_rings": bad_rings, "over_m2": round(over_m2, 1),
            "outside_m2": round(out_m2, 1)}


# ── A FACET THAT CROSSES ITSELF IS THE DIAGONAL ───────────────────────
#
# QUEUE H5: *"Jester roofs have some weird extrusions with the diagonals.
# specifically above where it says J2. other buildings with alot of corners next
# to each other with cornered roofs have this weird intersecting as well."*
#
# MEASURED, campus-wide, on the geometry this bake emits: **183 facets on 36 of
# 108 pitched roofs are self-crossing polygons.** Jester Center alone has 22.
# Rendered in plan they are unmistakable — long thin shards fanning out of every
# narrow wing and crossing each other, which is the picture he is describing.
#
# TWO THINGS THAT LOOKED LIKE THE CAUSE AND WERE NOT, both measured, because
# each would have sent the fix somewhere useless:
#
#   1. NOT OVERLAPPING SURFACES. The obvious reading of "stab through each
#      other" is two facets in the same place. With the authored elevations
#      excluded — and they must be, because a stone stair and its archivolts
#      share ground BY DESIGN and account for 329 of the 335 pairs a naive
#      count returns — the entire campus has **6** pairs of roof facets that
#      overlap in plan and in height, totalling 96.5 m2. It is not an overlap.
#   2. NOT A FACET RUNNING PAST THE END OF ITS WALL EITHER. That was the second
#      theory and it flags correct geometry: at a REFLEX corner the mitre
#      travels `cot(theta/2)` along the wall per metre of depth, which for a
#      right-angled notch is one metre per metre, outward. Every inside corner
#      on every building does it, and it is the valley — the straight
#      skeleton's own answer. 66 of 108 roofs "fail" that test and most of them
#      look right.
#
# WHAT IS ACTUALLY WRONG is narrower and is not a matter of degree: a ring that
# crosses itself HAS NO INTERIOR. earcut fills it as two lobes of opposite
# winding, one of which is a spike hanging in space, and `fill-extrusion` gives
# that spike the facet's full height. `valid_step` cannot see it because it
# tests the four CORNERS — and all four corners of a bow tie are legal offset
# points, inside the footprint, at their proper clearance. The polygon they
# describe is not.
#
# THE RULE: A FACET IS THE SLOPE OF ONE WALL, SO THE PART OF IT THAT IS NOT
# ATTACHED TO THAT WALL IS NOT A SLOPE. Where the ring crosses itself it is
# split, and the lobes that touch the wall are kept. That is exact rather than a
# threshold: the eave-side chain of the quad IS the wall, and a lobe sharing no
# boundary with it is hanging off the far end of a mitre. Nothing that was ever
# drawn on the building is removed, so this cannot trade a fold for a missing
# slope — the failure mode PR #74 and PR #78 both hit and documented.
FACET_LOBE_TOUCH_M = 0.10   # boundary a lobe must share with its own wall


def untangle_facet(face, n_outer):
    """One facet as a list of SIMPLE rings — the lobes that touch the wall.

    `face[:n_outer]` is the eave-side chain, which is the wall itself. Returns
    the ring unchanged when it is already simple, so the common path costs one
    `ring_is_simple` and no shapely at all.
    """
    if ring_is_simple(face + [face[0]]):
        return [face]
    from shapely.geometry import LineString, Polygon
    g = Polygon(face).buffer(0)
    if g.is_empty:
        return []
    parts = [g] if g.geom_type == "Polygon" else [q for q in getattr(g, "geoms", [])
                                                  if q.geom_type == "Polygon"]
    wall = LineString(face[:n_outer]) if n_outer >= 2 else None
    out = []
    for q in parts:
        if q.area < RESOLVE_MIN_M2:
            continue
        if wall is not None:
            shared = q.exterior.intersection(wall.buffer(0.01)).length
            if shared < FACET_LOBE_TOUCH_M:
                continue
        out.append([(x, y) for x, y in list(q.exterior.coords)[:-1]])
    return out


def audit_facet_rings(facet_by_edge, name, key, centre=None):
    """Facets that are not simple polygons. Zero is the only acceptable value."""
    bad = sum(0 if ring_is_simple(f + [f[0]]) else 1
              for faces in facet_by_edge.values() for f in faces)
    if not bad:
        return None
    return {"name": name or "(unnamed)", "id": key, "at": centre,
            "facets_that_cross_themselves": bad}


# ── ...AND THE FIX THE THIRD AUDIT ASKS FOR ───────────────────────────
#
# `cap_along` caps each VERTEX at the moment its own ray reaches the medial
# axis, and that is exactly right for a vertex — but two vertices that are each
# a legal inward offset can still have swapped places along the RING, because a
# mitre travels sideways as well as inward. When an arm is narrower than twice
# the step depth, the offsets of its two opposing walls pass through each other,
# and the mitred construction — one vertex per footprint vertex, with no way to
# lose one — has no way to say "this arm is gone". It turns over instead.
#
# THE FIX IS PR #78's RANK LADDER, APPLIED TO ROOF SURFACES. That is what QUEUE
# A5 asked for in as many words, and it is right for a reason worth stating: the
# mitred ring is a good approximation of a straight skeleton right up until an
# arm pinches off, and there is no way to keep the approximation AND express the
# pinch. So stop trying to. Emit the same rings, and then RESOLVE them: repair
# each polygon, clip it to the roof's own outline, and subtract everything a
# higher-ranked surface at the same height has already claimed. One square
# metre, one surface, by construction rather than by argument.
#
# TWO EARLIER FIXES WERE MEASURED AND THROWN AWAY, and both are worth recording
# because both looked right:
#
#   1. WALK THE WHOLE ROOF'S STEP DEPTH BACK until nothing folds. Folded rings
#      154 -> 1 — and it cost the Biomedical Engineering Building 9.50 m of an
#      11.81 m step depth and the Moncrief-Neuhaus 7.70 m of 12.66, because ONE
#      narrow wing dragged a whole building's slope down with it. That is
#      exactly `fold_free_run`'s mistake, which this file deleted in PR #74 and
#      documents two hundred lines above. It also made `audit_slope_depth` look
#      perfect, because that audit was being handed the REDUCED depth as its
#      target and so could only ever report success.
#   2. PULL BACK THE INDIVIDUAL POINTS involved in each crossing. Folded 154 ->
#      0, and it took 42% of the slope off four of Gregory Gym's walls — 86 m,
#      62 m, 51 m and 50 m long — to resolve a fold at a notch tens of metres
#      away. Preferring to pull back the SHARPEST corner rather than the deepest
#      point made it worse (108 walls short, against 89), because it could no
#      longer resolve most roofs at all and they fell through to (1).
#
# Both were trades of a visible fold for a visible missing slope. The resolver
# is not a trade: no point moves, no wall loses depth, and the only geometry
# that disappears is geometry that was drawn twice or drawn over open air.
RESOLVE_SURFACES = "--fold-ok" not in sys.argv
RESOLVE_MIN_M2   = 0.25   # a leftover part smaller than this is not a surface
CROSS_TRIM_M2    = 0.05   # ...and the smallest cross-roof overlap worth cutting


def _shp():
    """shapely, or a clear failure. It is already a build dependency
    (.github/workflows/build-data.yml installs it), and a resolver that silently
    does not run would leave the exact defect it exists to remove."""
    from shapely.geometry import Polygon
    return Polygon


def resolve_surfaces(emitted, eave_ring):
    """Repair, clip and de-overlap every polygon one roof emits.

    `emitted` is `[(ring_in_local_m, top, props)]` in draw order. Returns the
    same list with rings replaced by `[exterior, *holes]` lists, one entry per
    resulting part, plus a count of what was removed.

    RANK, and it is the one taste call here: within a height group the LARGEST
    surface is drawn first and keeps everything it covers. A fold always leaves
    one big correct facet and one small inverted one, so ranking by area gives
    the square metre to the surface that was right about it. Ties break on the
    original emit order, so the output does not depend on set iteration.
    """
    Polygon = _shp()
    limit = Polygon(eave_ring).buffer(0)
    if limit.is_empty:
        return emitted, 0, 0.0
    groups = {}
    for n, (ring, top, props) in enumerate(emitted):
        groups.setdefault(round(top / SURF_TOP_EPS), []).append(n)
    keep = {}
    dropped, lost_m2 = 0, 0.0
    for members in groups.values():
        order = sorted(members, key=lambda n: (-Polygon(emitted[n][0]).buffer(0).area, n))
        claimed = None
        for n in order:
            g = Polygon(emitted[n][0]).buffer(0)
            if not g.is_empty:
                g = g.intersection(limit)
            if claimed is not None and not g.is_empty:
                g = g.difference(claimed)
            parts = []
            if not g.is_empty:
                gs = [g] if g.geom_type == "Polygon" else list(getattr(g, "geoms", []))
                for q in gs:
                    if q.geom_type != "Polygon" or q.area < RESOLVE_MIN_M2:
                        continue
                    parts.append([list(q.exterior.coords)] +
                                 [list(r.coords) for r in q.interiors])
            was = Polygon(emitted[n][0]).buffer(0).area
            now = sum(Polygon(p[0], p[1:]).area for p in parts)
            if now < was - 1e-6:
                lost_m2 += was - now
            if not parts:
                dropped += 1
            keep[n] = parts
            claimed = g if claimed is None else claimed.union(g)
    out = []
    for n, (_, top, props) in enumerate(emitted):
        for rings in keep.get(n, []):
            out.append((rings, top, props))
    return out, dropped, lost_m2


def resolve_across_roofs(feats, lat0):
    """The same rule again, between roofs instead of inside one.

    `resolve_surfaces` runs per footprint ring, so it cannot see two DIFFERENT
    buildings whose roofs are at the same height and whose 0.5 m eaves overhang
    into each other. Batts Hall and Mezes Hall are both 20.5 m and share the
    South Mall arcade between them; `scripts/verify/coplanar.mjs` — an
    instrument outside this file, which is the point — measured 79 m^2 of their
    two roofs at exactly 22.60 m, 45% of the smaller. That is a flicker between
    two of the most-looked-at buildings on campus, and no per-building pass can
    reach it.

    Only pairs whose bounding boxes actually meet are compared, and a feature
    that loses nothing keeps its coordinates byte for byte, so this cannot
    perturb the 99% of the file it has no business touching.
    """
    Polygon = _shp()
    k = math.cos(math.radians(lat0)) * M_LAT
    fwd = lambda q: (q[0] * k, q[1] * M_LAT)
    inv = lambda q: [round(q[0] / k, 6), round(q[1] / M_LAT, 6)]
    groups = {}
    for n, f in enumerate(feats):
        groups.setdefault(round(f["properties"]["h"] / SURF_TOP_EPS), []).append(n)
    changed, dropped, lost = 0, 0, 0.0
    for members in groups.values():
        if len(members) < 2:
            continue
        geo, box = {}, {}
        for n in members:
            g = Polygon([fwd(q) for q in feats[n]["geometry"]["coordinates"][0]],
                        [[fwd(q) for q in r]
                         for r in feats[n]["geometry"]["coordinates"][1:]]).buffer(0)
            geo[n] = g
            box[n] = g.bounds if not g.is_empty else None
        order = sorted(members, key=lambda n: (-geo[n].area, n))
        done = []
        for n in order:
            g = geo[n]
            if g.is_empty:
                continue
            b = box[n]
            hit = [m for m in done
                   if box[m] and not (b[2] < box[m][0] or box[m][2] < b[0]
                                      or b[3] < box[m][1] or box[m][3] < b[1])]
            if hit:
                was = g.area
                for m in hit:
                    g = g.difference(geo[m])
                    if g.is_empty:
                        break
                # Only a loss worth having is written back. Two roofs that
                # merely touch differ by a numerical hair, and rewriting 242
                # features' coordinates through a projection round-trip to
                # remove 0.001 m^2 is drift for nothing.
                if g.area < was - CROSS_TRIM_M2:
                    lost += was - g.area
                    parts = ([g] if g.geom_type == "Polygon"
                             else [q for q in getattr(g, "geoms", [])
                                   if q.geom_type == "Polygon"])
                    parts = [q for q in parts if q.area >= RESOLVE_MIN_M2]
                    if not parts:
                        feats[n]["properties"]["_drop"] = 1
                        dropped += 1
                        geo[n] = Polygon()
                        continue
                    big = max(parts, key=lambda q: q.area)
                    feats[n]["geometry"]["coordinates"] = (
                        [[inv(q) for q in big.exterior.coords]] +
                        [[inv(q) for q in r.coords] for r in big.interiors])
                    # Extra parts are dropped rather than emitted: a subtraction
                    # that splits one facet into several is a sliver event, and
                    # the sliver is what was being drawn twice in the first place.
                    geo[n] = big
                    changed += 1
            done.append(n)
    return changed, dropped, lost


# CHECK WHAT IS EMITTED, NOT WHAT IT IS BUILT FROM. A facet is not a ring: it is
# one wall's slice of two rings, `[outer points] + [inner points reversed]`, and
# that strip can cross itself while both rings it came from are perfectly
# simple — 91 of the folds in this file are of that kind, and an earlier version
# of the audit that tested only the rings reported them all as clean. This file
# already records 78 self-crossing facets from the densifier for the same
# reason. So `audit_surfaces` is handed the polygons that go to disk.


def audit_slope_depth(poly, facet_by_edge, d_final, name, key, centre=None):
    """Square metres of slope each wall of this roof should have had and has not.

    `facet_by_edge` maps a footprint edge index to the quads emitted for it, in
    step order, so `[-1]` is the innermost. Everything is in local metres.
    """
    if d_final <= 0.2:
        return []
    n = len(poly)
    bad = []
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy)
        if L < DIAG_MIN_LEN:
            continue
        tx, ty = dx / L, dy / L
        u = (-dy / L, dx / L)
        # The inner edge of the deepest facet, as (distance along wall, depth).
        # A face is [outer points in wall order] + [inner points reversed], so
        # the second half reversed is the inner boundary in wall order.
        inner = []
        faces = facet_by_edge.get(i) or []
        if faces:
            f = faces[-1]
            for q in reversed(f[len(f) // 2:]):
                inner.append(((q[0] - x0) * tx + (q[1] - y0) * ty,
                              (q[0] - x0) * u[0] + (q[1] - y0) * u[1]))
            inner.sort()

        def achieved(s):
            if not inner:
                return 0.0
            if s <= inner[0][0]:
                return inner[0][1]
            if s >= inner[-1][0]:
                return inner[-1][1]
            for (sa, da), (sb, db) in zip(inner, inner[1:]):
                if sa <= s <= sb:
                    if sb - sa < 1e-9:
                        return max(da, db)
                    return da + (db - da) * (s - sa) / (sb - sa)
            return inner[-1][1]

        K = max(3, min(24, int(L / DIAG_SAMPLE_M)))
        w = L / K
        short = could = 0.0
        for k in range(K):
            s = (k + 0.5) * w
            t = s / L
            poss = min(d_final, cap_along((x0 + dx * t, y0 + dy * t), u, poly))
            could += poss * w
            short += max(0.0, poss - achieved(s)) * w
        if could <= 0.5:
            continue
        fr = short / could
        if short < DIAG_MIN_M2 or fr < DIAG_MIN_FR:
            continue
        az = facet_az(poly[i], poly[(i + 1) % n])
        bad.append({"name": name or "(unnamed)", "id": key, "at": centre,
                    "wall": i, "wall_len_m": round(L, 1),
                    "wall_az": None if az is None else round(az),
                    "could_m2": round(could, 1), "short_fr": round(fr, 3),
                    "bare_m2": round(short, 1)})
    return bad


def audit_coverage(eave_ring, covers, poly, name, key, centre=None):
    """Uncovered area of this roof, in plan, in square metres.

    `covers` is every polygon the bake emitted for this building above the eave
    lip — each facet quad and the deck. Everything is in local metres.

    Drawn WITH an outline as well as a fill, because two polygons that share an
    edge exactly still leave a one-pixel seam between them under a scanline fill,
    and 105 buildings' worth of seams would drown the signal this is looking for.
    """
    xs = [q[0] for q in eave_ring]; ys = [q[1] for q in eave_ring]
    x0, y0 = min(xs), min(ys)
    W = max(2, int((max(xs) - x0) / AUDIT_PX_M) + 3)
    H = max(2, int((max(ys) - y0) / AUDIT_PX_M) + 3)
    if W * H > 4_000_000:
        return None
    T = lambda q: (1 + (q[0] - x0) / AUDIT_PX_M, 1 + (q[1] - y0) / AUDIT_PX_M)
    foot = Image.new("1", (W, H), 0)
    ImageDraw.Draw(foot).polygon([T(q) for q in eave_ring], fill=1)
    cov = Image.new("1", (W, H), 0)
    dc = ImageDraw.Draw(cov)
    for c in covers:
        if len(c) >= 3:
            dc.polygon([T(q) for q in c], fill=1, outline=1)
    fa = np.asarray(foot, dtype=bool)
    ca = np.asarray(cov, dtype=bool)
    hole = fa & ~ca
    px = AUDIT_PX_M * AUDIT_PX_M
    hole_m2 = float(hole.sum()) * px
    foot_m2 = float(fa.sum()) * px
    if foot_m2 <= 0:
        return None
    fr = hole_m2 / foot_m2
    if hole_m2 < AUDIT_HOLE_M2 or fr < AUDIT_HOLE_FR:
        return None
    # Which wall the hole is on: the footprint edge nearest the uncovered
    # centroid. That is the name of the missing slope, and its azimuth is the
    # gap in this roof's set of slope directions.
    ij = np.argwhere(hole)
    cy = float(ij[:, 0].mean()) * AUDIT_PX_M + y0
    cx = float(ij[:, 1].mean()) * AUDIT_PX_M + x0
    n = len(poly)
    best, bd = 0, 1e18
    for i in range(n):
        d = seg_dist((cx, cy), poly[i], poly[(i + 1) % n])
        if d < bd:
            best, bd = i, d
    az = facet_az(poly[best], poly[(best + 1) % n])
    return {"name": name or "(unnamed)", "id": key, "at": centre,
            "hole_m2": round(hole_m2, 1), "roof_m2": round(foot_m2, 1),
            "hole_fr": round(fr, 3), "wall": best,
            "wall_az": None if az is None else round(az),
            "wall_len_m": round(math.hypot(poly[(best + 1) % n][0] - poly[best][0],
                                           poly[(best + 1) % n][1] - poly[best][1]), 1)}


# `half_span` USED TO LIVE HERE and is deleted with the other two. It bisected on
# "did `inset` return something", which is unsound twice over: `inset` is not
# monotone in d (None at 8 m and a ring at 12 m on the SAME footprint), so a
# bisection had no right to converge at all; and it accepted inside-out rings, so
# it converged on its own search bound — 40.0 m for a building 23 m across. The
# half-span is now `max(vertex_caps(...))`, which is the same quantity asked for
# directly, correct by construction, and free because the caps are needed anyway.
#
# It reported 40 for 26 more buildings than it should have, which is why
# `too_narrow` moved 14 -> 40 and `flat` 2,130 -> 2,104: those 26 were being
# measured against a half-span that was not theirs. None of them was drawing a
# roof either way.


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

# ── Real roof colour ──────────────────────────────────────────────────
#
# "some of the roofs on campus are not all burnt orange some of them are more
# red can we add a bit of variety corresponding to real color? i like the burnt
# orange but add a tiny bit of red to some."
#
# CORRESPONDING TO THE REAL COLOUR, which is the whole of the ask and the reason
# this is not a random jitter. The imagery is already being read here to decide
# WHICH roofs are tiled and how far the slope runs; reading what colour those
# tiles are costs nothing extra, and it is the difference between "some variety"
# and "the roofs that are redder in life are redder here".
#
# The measurement is the mean of the pixels along the eave ring that PASS
# is_tile. Averaging the whole ring instead would fold in every overhanging live
# oak and hand back a muddy brown that is nobody's roof.
#
# RELATIVE, NOT ABSOLUTE, and the first attempt got this wrong in a way the
# numbers caught. Blending each authored colour a third of the way toward its
# measured RGB dropped the median red/blue ratio of the campus roofs from 2.81
# to 2.34 and the 10th percentile from 2.12 to 1.53 -- i.e. it made the roofs
# LESS red on average, which is the opposite of the request. Nadir imagery of
# Austin is hazy and sun-washed; its absolute values are not trustworthy.
#
# What IS trustworthy is the DIFFERENCE between two roofs in the same
# photograph. So each roof is compared with the MEDIAN measured roof and moved
# by that much: a roof that photographs redder than its neighbours is rendered
# redder than its neighbours, against the authored burnt orange rather than
# against the imagery. The campus median is unmoved by construction, which is
# what "i like the burnt orange" requires.
# AND IT IS AMPLIFIED, WHICH IS A DECLARED EXAGGERATION. Measured across 2,681
# roof facets, the red/blue ratio runs 1.51 at the 10th percentile to 1.70 at
# the 90th around a median of 1.603 -- a spread of about +/-6%. At gain 1.0 that
# renders as a colour difference nobody can see, so the honest report would be
# "the photograph says these roofs are all the same colour" -- and yet standing
# on campus they are visibly not, because haze and a sun-washed nadir view
# compress exactly this kind of difference.
#
# So the ORDERING is factual and the MAGNITUDE is not: gain 3.5 turns that +/-6%
# into roughly +/-22%, which is a roof you can tell apart from its neighbour.
# Same class of decision as the lane markings being drawn 5x over-scale, and
# stated for the same reason. Set it to 1.0 for the literal measurement, or 0
# for one colour everywhere.
COLOUR_GAIN = 3.5
COLOUR_CLAMP = (0.80, 1.30)   # hardest shove allowed, as a ratio on red/blue
COLOUR_MIN_SAMPLES = 14   # ring samples needed before the mean means anything
# Guard rails, in case a roof was measured under a cloud or through a tree. A
# measurement outside these is thrown away rather than blended, because a grey
# or a green roof here is a failed read, not a finding.
COLOUR_MIN_LUMA, COLOUR_MAX_LUMA = 45.0, 235.0
COLOUR_MIN_RB = 1.15      # red must beat blue by this much to be tile at all


def measured_rb(meas):
    """A roof's measured red/blue ratio, or None if the read is not usable."""
    if not meas:
        return None
    r, g, b = meas
    luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    if not (COLOUR_MIN_LUMA <= luma <= COLOUR_MAX_LUMA):
        return None
    rb = r / max(b, 1.0)
    # A grey or a green here is a failed read -- a cloud, a tree, a deck the
    # ring clipped -- not a finding about the roof.
    return rb if rb >= COLOUR_MIN_RB else None


def shift_to_measured(hexcol, rb, median_rb):
    """Move an authored roof's red/blue toward how it compares with its peers.

    Luma is held: the authored value carries the tonal level the whole palette
    is built around, and letting hazy imagery move THAT is how a campus goes
    muddy. Only the balance between the red and blue channels changes.
    """
    if not hexcol or rb is None or not median_rb or COLOUR_GAIN <= 0:
        return hexcol
    k = (rb / median_rb) ** COLOUR_GAIN
    k = max(COLOUR_CLAMP[0], min(COLOUR_CLAMP[1], k))
    if abs(k - 1.0) < 0.01:
        return hexcol
    src = [float(int(hexcol[i:i + 2], 16)) for i in (1, 3, 5)]
    sl = 0.2126 * src[0] + 0.7152 * src[1] + 0.0722 * src[2]
    # Push red up and blue down by the square root of k each, so their RATIO
    # moves by k while their product -- and so roughly the luma -- does not.
    m = math.sqrt(k)
    out = [src[0] * m, src[1], src[2] / m]
    nl = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2]
    if nl > 1:
        out = [v * sl / nl for v in out]
    return "#" + "".join("%02x" % max(0, min(255, int(round(v)))) for v in out)
# Shade as though the slope were steeper than it is. The geometry has to stay at
# the real 5:12 or the halls grow spires, but at a 22.6 deg tilt under a 54 deg
# sun the four slopes of a hip differ by about 20% — too little to make the hip
# lines read, so the roof came back looking like a flat plane with rings drawn on
# it. Shading at 38 deg spreads them enough for the diagonals to appear. This is
# the one deliberately non-physical number in the file, and `timeofday.js` has
# to agree with it — ROOF_SHADE there carries the same three constants.
SHADE_TILT = 38.0


# ── A TILED ROOF IS PAINTED A TILE COLOUR ─────────────────────────────
#
# Simeon: *"littlefeild dorm should have a red roof"*. It does not. Its
# neighbours Carothers and Blanton do, and they are the same kind of building
# with the same kind of roof, which is what makes it look like a mistake rather
# than variety.
#
# THE DEFECT IS NOT IN THE SURVEY. Littlefield Dormitory reads
# `run 7.1 m, eave 0.766` in `roof_runs.json`, and its offset rings run
# 0.77 / 0.99 / 1.00 / 0.99 straight out to its own half-span — the most
# unambiguous full hip on this campus, more certain than Carothers' 0.88. The
# geometry it gets is right. **The COLOUR never asks the photograph at all.**
#
# Every facet takes `rd` off the parent building, and `rd` is set in
# `bake_detail.py` from the OSM `roof:colour` tag when there is one and
# otherwise from THE BUILDING'S OWN WALL, 12% darker — a rule that has nothing
# to do with what is on the roof. Littlefield's wall is limestone, so its
# terracotta hip renders `#928776`, a pale tan. `shift_to_measured` below cannot
# rescue it: that moves the red/blue RATIO by at most ±30% and holds luma, which
# is a nudge within a colour family, not a change of family.
#
# MEASURED ACROSS THE CAMPUS, and this is why it is a rule and not a one-line
# data fix: of the 105 footprints the survey gives a real tiled slope to,
# **65 are painted from an `rd` whose red/blue is under 1.55** — greys, olives
# and blue-greys, median 1.47 against 2.80 for the ones that came out right.
#
# THE RULE. A roof the photograph is SURE is tile is painted a tile colour.
# "Sure" is deliberately two independent readings, the same discipline the
# parapet-cap join uses (HANDOFF §37): the eave ring has to read tile, AND the
# whole footprint has to read tile. Cross-checked, they agree strongly — at
# `eave >= 0.55` the median whole-footprint tile fraction is 0.80 — and the
# second test exists for the one candidate where they do not, a roof at eave
# 0.72 whose footprint is only 0.31 tile.
#
# WHAT COLOUR. Not an invented one: the MEDIAN `rd` of the pitched roofs that
# already have a tile colour, re-derived from the campus on every bake and only
# falling back to the constant when there is nothing to derive it from. The
# authored burnt orange therefore stays exactly where it is — a retinted roof
# lands on the median of its own peers — and `shift_to_measured` then spreads it
# again by its own measured red/blue, so the roofs that photograph redder still
# render redder. `--no-tile-colour` is the negative control.
TILE_COLOUR_RULE = "--no-tile-colour" not in sys.argv
TILE_RB_MIN      = 1.55   # an `rd` below this red/blue is not a tile colour
TILE_EAVE_MIN    = 0.55   # ...and the eave ring has to be sure
TILE_AREA_MIN    = 0.45   # ...and so does the whole footprint, independently
# Fallback only. `campus_tile_base()` re-derives this from the buildings that
# already have a tile-coloured roof; if that ever drifts far from this number,
# something upstream changed the palette and the `--report` line will say so.
TILE_BASE        = "#944a32"


def rb_of(hexcol):
    """A colour's red/blue ratio, the one number that says 'this is tile'."""
    if not hexcol or len(hexcol) != 7:
        return None
    r = int(hexcol[1:3], 16)
    b = int(hexcol[5:7], 16)
    return r / max(b, 1)


# THESE THREE ARE COPIED FROM `bake_detail.py`, NOT IMPORTED, and the reason is
# worth one line: that module does its whole bake at import time — it reads the
# snapshot and writes two files — so importing it here to borrow a nine-line
# colour function would re-run it as a side effect of baking roofs. The copy is
# the lesser evil; the risk it carries is drift, so if `make_roof_colors` ever
# changes there, this has to change with it. GOLDEN_TINT and both magic numbers
# are reproduced exactly.
GOLDEN_TINT = "#ffb26a"


def _hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _rgb2hex(r, g, b):
    return "#%02x%02x%02x" % (max(0, min(255, round(r))),
                              max(0, min(255, round(g))),
                              max(0, min(255, round(b))))


def _lerp_hex(a, b, t):
    A, B = _hex2rgb(a), _hex2rgb(b)
    return _rgb2hex(*(A[i] + (B[i] - A[i]) * t for i in range(3)))


def _adjust_light(h, dl):
    r, g, b = (v / 255.0 for v in _hex2rgb(h))
    hh, ll, ss = colorsys.rgb_to_hls(r, g, b)
    ll = max(0.05, min(0.95, ll + dl))
    r, g, b = colorsys.hls_to_rgb(hh, ll, ss)
    return _rgb2hex(r * 255, g * 255, b * 255)


def make_roof_colors(roof_hex):
    """day / golden / night from one roof colour — bake_detail.py's own rule."""
    rg = _lerp_hex(roof_hex, GOLDEN_TINT, 0.22)
    rn = _lerp_hex(_adjust_light(roof_hex, -0.38), "#10152a", 0.6)
    return roof_hex, rg, rn


def campus_tile_base(feats, cache):
    """The median `rd` of the pitched roofs that already have a tile colour.

    Read off the cached survey rather than re-measured, so it costs nothing and
    is the same number on a cached bake and a `--remeasure` one (as long as the
    cache exists; with no cache at all the constant stands in and says so).
    """
    reds = []
    for f in feats:
        p = f["properties"]
        h = p.get("final_height") or 0
        if h < 4:
            continue
        v = cache.get("%s/0" % p.get("id"))
        if not v or v[0] < MIN_RUN_M:
            continue
        rd = p.get("rd")
        r = rb_of(rd)
        if r is not None and r >= TILE_RB_MIN:
            reds.append(_hex2rgb(rd))
    if len(reds) < 12:
        return TILE_BASE, 0
    med = [sorted(c[i] for c in reds)[len(reds) // 2] for i in range(3)]
    return _rgb2hex(*med), len(reds)


# ── PER-BUILDING CORRECTIONS ──────────────────────────────────────────
#
# `data/building_overrides.json`. A survey rule that is right 105 times out of
# 105 does not exist, and the wrong answer to that is to edit the generated
# snapshot — which the next bake silently wipes. So corrections live in their
# own small tracked file, are applied HERE, and every one of them carries the
# observation it answers in its own `why`.
#
# It holds four kinds of thing, and only the first two are corrections to a
# measurement; the rest are geometry the imagery cannot supply:
#   roof_run_m            the ring survey under-read a roof the photo shows
#   roof_over_max_height  the height gate excluded a building it should not
#   roof_colour/deck_colour   the two colours the roof is built out of
#   gable_front           an authored gable elevation (see GABLE FRONT below)
#   facade_bands          precast courses, a base and piers (see FACADE BANDS)
OVERRIDES = os.path.join(ROOT, "data", "building_overrides.json")


def load_overrides():
    if not os.path.exists(OVERRIDES):
        return {}
    try:
        b = json.load(open(OVERRIDES, encoding="utf-8")).get("buildings") or {}
    except Exception as e:                                   # noqa: BLE001
        print("  building_overrides.json unreadable, ignoring:", e)
        return {}
    # EVERY `*_colour` MUST BE A REAL HEX, and the bake dies if one is not.
    # `make_roof_colors` on a typo returns the typo, and MapLibre draws an
    # unparseable colour as nothing at all — so a slipped keystroke in a hand
    # written data file deletes a wall silently. This is four lines and it is
    # the only reason a whole authored elevation cannot vanish unnoticed.
    bad = []
    def _walk(node, path):
        if isinstance(node, dict):
            for k, v in node.items():
                if k.endswith("colour") or k.endswith("color"):
                    if not (isinstance(v, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", v)):
                        bad.append("%s.%s = %r" % (path, k, v))
                else:
                    _walk(v, path + "." + k)
        elif isinstance(node, list):
            for i, v in enumerate(node):
                _walk(v, "%s[%d]" % (path, i))
    for bid, ov in b.items():
        _walk(ov, ov.get("name") or bid)
    if bad:
        raise SystemExit("bake_roofs: building_overrides.json has colours that "
                         "are not #rrggbb:\n  " + "\n  ".join(bad))
    return b


# ── GABLE FRONT: the one thing on a facade a prism cannot say ─────────
#
# Simeon: *"greg gym is split into two sections (one building) one should
# replicate the famous entrance with the three hall things and the roof."*
# Then, after PR #106 shipped a loggia: *"we need accurate detail and color"*.
#
# THIS SUPERSEDES `loggia_parts`, AND IT IS WORTH SAYING WHY, because the
# previous version was not lazy — it was a wrong reading of the building.
# It built a PROJECTING PORCH: 21 m wide, 12.6 m to the top of its own little
# gable, standing in front of a 135 m building. Four photographs say the real
# thing is nothing like that:
#
#   commons: "Gregory Gymnasium, May 2013.jpg", "University of Texas at Austin
#   August 2019 24", "Gregory Gym.jpg", "Gregory Gym - UT Austin (54984752541)"
#
# What they show is a GABLE-FRONTED HALL. The whole west end is one triangular
# brick pediment the full width of the elevation; the three arches are enormous
# recessed openings cut into it, not a porch stuck on it; and a second, smaller
# gable projects in front of the first, its raking edge carrying a run of small
# blind corbel arches — the ornament that makes the face unmistakably Gregory.
# A 21 m porch on a 53 m gable wall is "the canvas the right size".
#
# WHICH WALL — SETTLED FROM THE PHOTOGRAPH'S OWN GPS, not from memory and not
# from the aerial. "Gregory Gymnasium, May 2013.jpg" carries EXIF GPS
# 30.284266, -97.737473. Put in the footprint's own metre frame (origin at the
# SW of its bbox) the camera stands at (-46.7, 82.9) — 47 m due west of the
# building, dead level with the mid-point of the 24.9 m west-facing edge that
# runs y 68.6 -> 93.4. It is a square-on shot of that edge. PR #106's `at`
# point was on the same edge, so the wall was already right; everything else
# about the composition was not. (The OSM `entrance=main` node 1427259422 lands
# on a 3.5 m stub 27 m further south and is NOT what the photograph looks at.)
#
# EVERY DIMENSION BELOW IS MEASURED OFF THAT PHOTOGRAPH, and the working is
# written out because a number nobody can re-derive is a number nobody can
# correct. The scale comes from ONE assumption — that the modelled 20.0 m is the
# eave — and then everything else is a pixel ratio against it:
#
#   pitch:  apex (960,69) to (1600,330) => 261/640 = 0.408 rise/run
#           apex (960,69) to ( 400,287) => 218/560 = 0.389   -> use 0.40
#   width:  the footprint's west elevation runs y 50.8..103.7 = 52.9 m.
#           At 0.40 pitch that puts the apex 10.6 m over the eave, so
#           (30.6-20.0)/(327-69 px) = 0.0411 m/px.
#           CHECK: 52.9 m at 0.0411 => 1287 px, apex at x=960, so the eave
#           corners land at x = 317 and 1603. The traced silhouette reaches
#           (1600, 330) and the raking line predicts y=327 there. 3 px.
#   arches: openings 97 px = 4.0 m, pitch 162 px = 6.66 m, three of them,
#           symmetric about the same x=960 the gable apex is on.
#   heights (h = 20.0 - (y-327)*0.0411): stair head 714 -> 3.9 m,
#           door head 650 -> 6.7 m, lintel band top 590 -> 9.2 m,
#           springing 503 -> 12.7 m, opening crown 455 -> 14.7 m,
#           archivolt crown 430 -> 15.7 m.
#
# THE INNER GABLE IS THE FOOTPRINT'S OWN PROJECTION. That 24.9 m edge stands
# 2.9-4.5 m proud of the wall either side of it — which is exactly the second
# pediment in the photograph. So the inner gable is built on that edge at v=0
# and the outer gable is built BEHIND it, deep enough to stand on solid
# building for its whole 52.9 m (the deepest flank is 4.5 m back, so 4.9 m).
#
# THE ARCH IS NOT A STACK OF SQUARES, which is the fair complaint in QUEUE D3
# about the sculptures. `fill-extrusion` cannot tilt a face, so a round arch has
# to be a row of prisms — but the row is cut ACROSS the opening and each prism's
# BASE is the arch's own curve, `spring + sqrt(r^2 - x^2)`. That is the real
# soffit sampled at 13 points, not a shape approximated by axis-aligned boxes.
#
# AND NOTHING HERE CUTS A HOLE, because nothing can: this bake does not own the
# building extrusion, so an "opening" is a dark panel with a brick archivolt
# ring standing proud of it. That is why the arch reads — the ring casts the
# recess, the way it does on the building.
#
# Everything below is in the override so any of it is a one-line change.
GABLE_VOUSSOIRS   = 13    # prisms across each arch head
GABLE_COURSES     = 22    # steps in each raking gable. Nine read as a
                          # ziggurat: over 10.6 m of rise that is a 1.2 m step,
                          # which at 200 m is four pixels of staircase where the
                          # photograph has a straight line. Twenty-two puts the
                          # step under half a metre and the rake reads as a rake.
GABLE_STAIR_STEPS = 7     # flights in the stone stair below
GABLE_RECESS_M    = 0.05  # how far off the wall the dark back of an opening sits


def _seg_nearest(pm, q):
    """Index of the polygon edge nearest q, and the foot of the perpendicular."""
    best = None
    for i in range(len(pm)):
        a, b = pm[i], pm[(i + 1) % len(pm)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L2 = dx * dx + dy * dy
        if L2 < 1e-9:
            continue
        t = max(0.0, min(1.0, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2))
        fx, fy = a[0] + dx * t, a[1] + dy * t
        d = math.hypot(q[0] - fx, q[1] - fy)
        if best is None or d < best[0]:
            best = (d, i, (fx, fy), math.sqrt(L2))
    return best


def _wall_frame(pm, at, lat0):
    """The (origin, along, outward) frame of the footprint edge nearest `at`.

    Kept from the loggia version unchanged, because it is the part that was
    right: the override gives a POINT and the code finds the wall, so the
    composition cannot float off the building or bury itself in it if the
    footprint is ever re-surveyed. The outward normal is TESTED, not assumed
    from a winding — step a metre along the candidate and ask whether you are
    still inside.
    """
    k = math.cos(math.radians(lat0))
    q = (at[0] * M_LAT * k, at[1] * M_LAT)
    got = _seg_nearest(pm, q)
    if got is None:
        return None
    _d, i, foot, wall_len = got
    a, b = pm[i], pm[(i + 1) % len(pm)]
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    tx, ty = (b[0] - a[0]) / L, (b[1] - a[1]) / L
    nx, ny = -ty, tx
    if inside((foot[0] + nx, foot[1] + ny), pm):
        nx, ny = -nx, -ny
    return foot, (tx, ty), (nx, ny), wall_len


def _parallel_edges(pm, foot, tvec, nvec, half_span, tol_deg=34.0):
    """Every footprint edge that faces the same way as the anchor wall.

    Returned in the anchor's own frame as `(u0, u1, v)`: where the edge starts
    and stops along the wall, and how far it sits in front of (v > 0) or behind
    (v < 0) the anchor plane.

    THIS IS WHAT STOPS THE PEDIMENT FLOATING. Gregory Gym's west elevation is
    not one plane — it is a 24.9 m bay standing 2.9 and 4.5 m proud of the
    walls either side of it. A 52 m gable built on the bay's plane hangs over
    4.5 m of air for a third of its length; built deep enough to clear the
    worst of them it sits 4.9 m back and reads as a different building behind
    the roof, which is what the first cut of this did. Built PER EDGE it
    follows the building's own jogs, which is what a real parapet gable does.
    """
    tx, ty = tvec
    nx, ny = nvec
    cos_tol = math.cos(math.radians(tol_deg))
    out = []
    for i in range(len(pm)):
        a, b = pm[i], pm[(i + 1) % len(pm)]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 0.8:
            continue
        ex, ey = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        mx, my = -ey, ex
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        if inside((mid[0] + mx * 0.5, mid[1] + my * 0.5), pm):
            mx, my = -mx, -my
        if mx * nx + my * ny < cos_tol:
            continue
        ua = (a[0] - foot[0]) * tx + (a[1] - foot[1]) * ty
        ub = (b[0] - foot[0]) * tx + (b[1] - foot[1]) * ty
        v = (mid[0] - foot[0]) * nx + (mid[1] - foot[1]) * ny
        u0, u1 = (ua, ub) if ua <= ub else (ub, ua)
        u0, u1 = max(u0, -half_span), min(u1, half_span)
        if u1 - u0 > 0.6:
            out.append((u0, u1, v))
    return sorted(out)


# ── THE HALL BEHIND THE PEDIMENT ──────────────────────────────────────
#
# A gable front is the end of a gabled HALL, and until 2026-09-03 the roof
# behind it was the same 5:12 hip ring and flat deck every tiled roof gets: from
# the gregory pose the 46 x 60 m of it read as one flat orange plate with a
# pediment glued on the front, and the critics said so. The z19 nadir tile
# (data/imagery_cache 19/119804/215829) says what is really there: two slopes
# falling from a ridge that runs from the pediment's apex straight back to where
# the hall ends, a light clerestory monitor along that ridge, and the annex to
# the south under a separate roof of its own.
#
# NOTHING HERE IS TYPED FOR ONE BUILDING. The hall is read off the footprint, in
# the gable's own (u along the wall, v out of it) frame:
#   - its two FLANK walls are the footprint edges that run straight back from
#     the front (along -n), nearest on each side to where the pediment's own
#     eave corners are (+-outer_w/2). Gregory Gym: the 62 m north wall at
#     u=-23.1, and at u=+23.1 the 2.3 m stub beside the pediment -- the rest of
#     that flank is interior, the annex being built against it.
#   - its BACK is the far end of the LONGER flank: an attached block can
#     shorten one flank, it cannot shorten both. Gregory: v=-65.0, and the tile
#     agrees -- along the ridge the dark hall roof turns into the pool block's
#     lighter deck at exactly the north wall's jog.
#   - its FRONT is the rear plane of the pediment prisms, per elevation
#     segment, so the roof begins where the pediment stops and steps with it.
#   - its RIDGE is the pediment's apex (apex_out). That is the whole point: the
#     pediment is the end of this roof, and the critics' first complaint was a
#     pediment with no ridge behind it.
# The monitor's plan is transcribed into the override from the tile with its
# working (`_monitor_note` there); js/slopes-roofs.js draws all of it, and
# hides the hip rig inside the rectangle while it does. The shipped slabs are
# untouched: this is the `rig` member, which the augment rewrites every run.
HALL_FLANK_ALONG = 0.95    # |edge direction . n| above this: the edge runs along the hall
HALL_FLANK_MIN_FRAC = 0.5  # a flank sits at least this fraction of outer_w/2 off the ridge
HALL_FLANK_FRONT_M = 0.5   # ...and starts within this of the elevation's deepest plane
HALL_MIN_DEPTH_M = 5.0     # shallower than this behind the pediment is not a hall


def _hall_rig(pm, foot, tvec, nvec, W_out, west, spec, gable_d, apex_out,
              bay_back, bay_v):
    """The gabled hall behind a gable front, or None if the footprint has none.

    Returned in the gable frame js/slopes-roofs.js already draws the pediment
    in: `uL`/`uR` the flank walls, `front` the pediment prisms' rear plane per
    elevation segment as [u0, u1, v], `v1` the back, `ridge` the apex, and
    `monitor` the override's clerestory plan when it carries one.
    """
    tx, ty = tvec
    nx, ny = nvec
    uv = [((x - foot[0]) * tx + (y - foot[1]) * ty,
           (x - foot[0]) * nx + (y - foot[1]) * ny) for (x, y) in pm]
    v_front = min(v for (_u0, _u1, v) in west)
    half = W_out * 0.5
    best = {-1: None, 1: None}
    n = len(pm)
    for i in range(n):
        (ua, va), (ub, vb) = uv[i], uv[(i + 1) % n]
        L = math.hypot(ub - ua, vb - va)
        if L < 0.8 or abs((vb - va) / L) < HALL_FLANK_ALONG:
            continue                        # not a wall running along the hall
        if max(va, vb) < v_front - HALL_FLANK_FRONT_M:
            continue                        # does not start at the front
        u = 0.5 * (ua + ub)
        if abs(u) < half * HALL_FLANK_MIN_FRAC:
            continue
        side = 1 if u > 0 else -1
        score = abs(abs(u) - half)
        if best[side] is None or score < best[side][0]:
            best[side] = (score, u, min(va, vb))
    if best[-1] is None or best[1] is None:
        return None
    v1 = min(best[-1][2], best[1][2])
    front = []
    for (u0, u1, v) in west:
        vu = v - bay_back if abs(v) < bay_v else v
        front.append([round(u0, 3), round(u1, 3), round(vu - gable_d, 3)])
    v0 = max(f[2] for f in front)
    if v0 - v1 < HALL_MIN_DEPTH_M:
        return None
    hall = {"uL": round(best[-1][1], 3), "uR": round(best[1][1], 3),
            "front": front, "v1": round(v1, 3), "ridge": round(apex_out, 3)}
    if spec.get("monitor_w_m"):
        hall["monitor"] = {"w": float(spec["monitor_w_m"]),
                           "h": float(spec.get("monitor_h_m", 1.8)),
                           "v0": -float(spec.get("monitor_from_m", 0.0)),
                           "v1": -float(spec.get("monitor_to_m", 0.0))}
    return hall


def gable_front_parts(ring, spec, height_m):
    """Every prism of one gable-fronted elevation, ready to append.

    Returns GeoJSON features. `height_m` is the building's own extrusion
    height: everything at or above it is FREE — there is no prism up there to
    bury it — and everything below it has to stand proud of the wall, because
    this bake cannot cut a hole in a fill-extrusion.
    """
    lat0 = sum(q[1] for q in ring) / len(ring)
    pm = ccw(clean(to_m(ring, lat0)))
    if len(pm) < 3:
        return []
    fr = _wall_frame(pm, spec.get("at"), lat0)
    if fr is None:
        return []
    foot, (tx, ty), (nx, ny), wall_len = fr
    az = (math.degrees(math.atan2(nx, ny)) + 360.0) % 360.0

    def rect(u0, u1, v0, v1):
        pts = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
        return [[foot[0] + tx * u + nx * v, foot[1] + ty * u + ny * v] for u, v in pts]

    # ── the numbers, all from the override ───────────────────────────────
    eave    = float(spec.get("eave_m", height_m))
    W_out   = float(spec.get("outer_w_m", 52.0))     # the whole west elevation
    W_in    = min(float(spec.get("inner_w_m", 24.0)), wall_len - 0.6)
    pitch   = float(spec.get("pitch", 0.40))         # rise per run, measured
    n_ar    = int(spec.get("arches", 3))
    op      = float(spec.get("arch_opening_m", 4.0))
    ar_p    = float(spec.get("arch_pitch_m", 6.66))
    spring  = float(spec.get("spring_m", 12.7))
    ring_m  = float(spec.get("archivolt_m", 1.0))    # thickness of the brick ring
    podium  = float(spec.get("podium_m", 3.9))
    door_h  = float(spec.get("door_head_m", 6.7))
    lint_h  = float(spec.get("lintel_head_m", 9.2))
    ven     = float(spec.get("veneer_proud_m", 0.16))
    proud_a = ven + float(spec.get("archivolt_proud_m", 0.34))
    proud_g = ven + float(spec.get("gable_proud_m", 0.30))
    gable_d = float(spec.get("gable_depth_m", 2.2))  # how far it reaches back
                                                     # over the roof behind it
    stair_w = float(spec.get("stair_w_m", 17.0))
    stair_run = float(spec.get("stair_run_m", 9.0))
    brick   = spec.get("brick_colour")
    stone   = spec.get("stone_colour")
    dark    = spec.get("shadow_colour")
    conc    = spec.get("stair_colour") or stone

    r = op * 0.5
    apex_out = eave + W_out * 0.5 * pitch
    apex_in  = eave + W_in * 0.5 * pitch
    west = _parallel_edges(pm, foot, (tx, ty), (nx, ny), W_out * 0.5)
    if not west:
        return []

    parts = []          # (ring, base, top, day_hex, may_be_inside)

    # ── 1. THE BRICK VENEER on this elevation ────────────────────────────
    # `wd` on this building is #a05b45 and the walls render at red/blue 3.18.
    # Four photographs put the brick at 1.58 (overcast) to 2.05 (low sun) — it
    # is a warm sand, not the red-brown it is painted, and the difference is
    # the whole of "we need accurate detail and color" on this building.
    # `wd` belongs to the buildings bake, which this lane does not own, so the
    # face is re-clad instead: a 0.16 m skin in the measured colour, on the
    # west elevation only. It stops at the building's own corners, which is
    # where a material change reads as normal rather than as a seam, and it
    # leaves every other elevation its window pattern and its lit night.
    arch_zones = [((j - (n_ar - 1) / 2.0) * ar_p - r - ring_m,
                   (j - (n_ar - 1) / 2.0) * ar_p + r + ring_m) for j in range(n_ar)]
    for (u0, u1, v) in west:
        # on the anchored bay the veneer steps around the three openings, so
        # the arch is a hole in the brick rather than a panel on top of it
        cuts = arch_zones if abs(v) < 0.4 else []
        spans, cur = [], u0
        for (c0, c1) in cuts:
            if c1 <= cur or c0 >= u1:
                continue
            if c0 > cur:
                spans.append((cur, c0))
            cur = max(cur, c1)
        if cur < u1:
            spans.append((cur, u1))
        for (s0, s1) in spans:
            if s1 - s0 < 0.25:
                continue
            parts.append((rect(s0, s1, v + 0.02, v + ven), 0.0, eave, brick, False))
        # ...and the head of brick above the arches, which the cuts removed
        for (c0, c1) in cuts:
            c0, c1 = max(c0, u0), min(c1, u1)
            if c1 - c0 > 0.25:
                parts.append((rect(c0, c1, v + 0.02, v + ven),
                              spring + r + ring_m, eave, brick, False))

    # ── 2. THE OUTER PEDIMENT, following the elevation's own jogs ────────
    #
    # THE CORNICE IS ONLY ON THE RAKE, and this is the correction that turned
    # the first render from a striped pyramid back into a pediment. Emitting a
    # stone step the FULL width of every course stacks 22 pale horizontal lines
    # up the face of the gable, so from anywhere above the eave it reads as a
    # tiled roof rather than as a brick wall with a stone edge. On the real
    # building the stone is a moulding that runs up the two sloping edges and
    # nowhere else. A 1.5 m block at each end of each course is that line.
    G = GABLE_COURSES
    for s in range(G):
        f0, f1 = s / float(G), (s + 1) / float(G)
        hw = (W_out * 0.5) * (1.0 - f0) + 0.7 * f0
        h0 = eave + (apex_out - eave) * f0
        h1 = eave + (apex_out - eave) * f1
        for (u0, u1, v) in west:
            # On the anchored bay the outer pediment steps BACK, so the inner
            # one in front of it is not swallowed by a bigger triangle drawn on
            # the same plane — which is exactly what happened when both were
            # anchored at v=0 and the corbel arcade simply vanished.
            vu = v - 0.9 if abs(v) < 0.4 else v
            a0, a1 = max(u0, -hw), min(u1, hw)
            if a1 - a0 < 0.4:
                continue
            parts.append((rect(a0, a1, vu - gable_d, vu + proud_g), h0, h1, brick, True,
                          "course"))
            # QUEUE H5: a flat 1.5 m block measured in from EACH end assumed
            # the course was wide enough to hold both. Near the apex, and on
            # the narrower side wings of a many-cornered elevation (Gregory
            # Gym's own west face steps in three times), `hw` shrinks below
            # 3 m and the two blocks reach past each other -- the same course,
            # the same segment, two "ends" that are now the same middle.
            # coplanar.mjs caught the pair six times. Capping each block's
            # half-width at what its OWN course can hold keeps them from ever
            # crossing; the moulding just tapers to a point at the apex
            # instead of stabbing through itself, which is what a real rake
            # does anyway.
            hwid = min(1.5, (a1 - a0) * 0.5 - 0.02)
            for (e0, e1) in ((a0, a0 + hwid), (a1 - hwid, a1)):
                if abs(abs(e0) - hw) > 1.6 and abs(abs(e1) - hw) > 1.6:
                    continue          # an interior join, not the rake
                if e1 - e0 < 0.3:
                    continue
                parts.append((rect(e0, e1, vu - gable_d, vu + proud_g + 0.26),
                              h0 - 0.36, h0 + 0.06, stone, True, "rake"))

    # ── 3. THE INNER PEDIMENT, on the bay's own plane ────────────────────
    # The footprint's 24.9 m projection IS the second pediment in the
    # photograph, and its rake carries the corbel arcade — the ornament that
    # makes this face Gregory rather than any brick gable in Texas.
    #
    # QUEUE H5: this used to reach back to a flat -1.2 m regardless of where
    # item 2's own anchored face sits. That face is deliberately pulled back
    # 0.9 m "so the inner one in front of it is not swallowed" (above) — but
    # its own face still runs out to -0.9+proud_g, 0.76 m closer than -1.2, so
    # at whichever course the two pediments' independent height ladders land
    # on the same absolute height, the inner pediment's rear edge sat inside
    # the outer one's own slab. Clearing that face by a hand's width is what
    # the comment already promised and the number never did.
    inner_rear = -0.9 + proud_g + 0.05
    for s in range(G):
        f0, f1 = s / float(G), (s + 1) / float(G)
        hw = (W_in * 0.5) * (1.0 - f0) + 0.6 * f0
        parts.append((rect(-hw, hw, inner_rear, proud_g),
                      eave + (apex_in - eave) * f0,
                      eave + (apex_in - eave) * f1, brick, True, "course"))
    n_c = int(spec.get("corbels", 13))
    for side in (-1, 1):
        for c in range(n_c):
            f = (c + 0.5) / n_c                       # 0 at apex, 1 at eave
            u = side * (W_in * 0.5) * f
            h0 = eave + (apex_in - eave) * (1.0 - f)
            parts.append((rect(u - 0.44, u + 0.44, -0.9, proud_g + 0.26),
                          h0 - 0.64, h0 - 0.05, stone, True))

    # ── 4. THE THREE ARCHES ──────────────────────────────────────────────
    # Below the eave, so every piece has to stand PROUD of the wall: the ring
    # of the archivolt is what makes the opening read, exactly as it does on
    # the building, and the dark panel inside it is the recess.
    for j in range(n_ar):
        u_c = (j - (n_ar - 1) / 2.0) * ar_p
        parts.append((rect(u_c - r, u_c + r, GABLE_RECESS_M, ven - 0.02),
                      podium, spring + r, dark, False))
        parts.append((rect(u_c - r, u_c + r, GABLE_RECESS_M, proud_a - 0.14),
                      door_h, lint_h, stone, False))
        parts.append((rect(u_c - r + 0.2, u_c + r - 0.2, GABLE_RECESS_M, ven + 0.06),
                      podium, door_h, dark, False))
        for c in range(GABLE_VOUSSOIRS):
            ua = u_c - r - ring_m + (op + 2 * ring_m) * c / GABLE_VOUSSOIRS
            ub = u_c - r - ring_m + (op + 2 * ring_m) * (c + 1) / GABLE_VOUSSOIRS
            xm = (ua + ub) * 0.5 - u_c
            R = r + ring_m
            inner = spring + math.sqrt(max(0.0, r * r - xm * xm)) if abs(xm) < r else spring
            outer = spring + math.sqrt(max(0.0, R * R - xm * xm)) if abs(xm) < R else spring
            if outer - inner < 0.05:
                continue
            parts.append((rect(ua, ub, 0.0, proud_a), inner, outer, brick, False, "ring"))
        for sx in (-1, 1):
            parts.append((rect(u_c + sx * r, u_c + sx * (r + ring_m), 0.0, proud_a),
                          podium, spring, brick, False))

    # ── 5. THE STONE PLAQUE over the middle arch ─────────────────────────
    parts.append((rect(-3.1, 3.1, 0.0, proud_g + 0.2),
                  float(spec.get("plaque_m", 17.2)),
                  float(spec.get("plaque_m", 17.2)) + 1.15, stone, False))

    # ── 6. THE MONUMENTAL STAIR ──────────────────────────────────────────
    # Stacked with the top flight innermost and shortest, so each nose is the
    # only thing that shows. The check below is what caught this built at
    # NEGATIVE v once — buried inside the prism, and invisible rather than
    # obviously wrong.
    if spec.get("stair"):
        S = GABLE_STAIR_STEPS
        for s in range(S):
            parts.append((rect(-stair_w / 2, stair_w / 2,
                               ven, ven + stair_run * (s + 1) / S),
                          0.0, podium * (S - s) / S, conc, False))
        for sx in (-1, 1):
            parts.append((rect(sx * stair_w / 2, sx * (stair_w / 2 + 1.6),
                               ven, ven + stair_run),
                          0.0, podium * 0.55, conc, False))

    out, buried = [], 0
    for part in parts:
        rg_m, b0, h0, day, free = part[:5]
        kind = part[5] if len(part) > 5 else "gable"
        if h0 - b0 < 0.02 or not day:
            continue
        # ANYTHING BELOW THE BUILDING'S OWN HEIGHT MUST STAND OUTSIDE IT.
        # A slab inside a solid prism is not an error on screen, it is simply
        # nothing — which is how the stair once shipped backwards and looked
        # like a portico with no steps. Above `height_m` the test is switched
        # off, because up there the prism has ended and the gable is supposed
        # to sit on the roof.
        if not free:
            cx = sum(x for x, _ in rg_m) / len(rg_m)
            cy = sum(y for _, y in rg_m) / len(rg_m)
            if inside((cx, cy), pm):
                buried += 1
                continue
        out.append(_band_feature(rg_m, lat0, b0, h0, day, az, kind))
    if buried:
        print("  GABLE FRONT: %d parts below the eave were inside the building "
              "and were dropped — check the wall this front is anchored to" % buried)
    # THE SAME ELEVATION, AS THE NUMBERS THE PRISMS WERE CUT FROM. Everything
    # js/slopes-roofs.js needs to draw the two pediments as real triangular
    # prisms with a raking cornice and the archivolts as real half-rings —
    # the frame of the anchor wall, the segments of the elevation in that
    # frame, and the spec's own metres — so the mesh and the prisms above are
    # two readings of one spec and cannot disagree about where the wall is.
    k = math.cos(math.radians(lat0))
    grig = {
        "dpm": [1.0 / (M_LAT * k), 1.0 / M_LAT],
        "foot": [round(foot[0], 3), round(foot[1], 3)],
        "t": [round(tx, 6), round(ty, 6)], "n": [round(nx, 6), round(ny, 6)],
        "az": round(az, 1),
        "eave": eave, "apex_out": round(apex_out, 3), "apex_in": round(apex_in, 3),
        "w_out": W_out, "w_in": round(W_in, 3),
        "apex_hw_out": 0.7, "apex_hw_in": 0.6,      # the flat crown, as above
        "gable_d": gable_d, "proud_g": round(proud_g, 3),
        "bay_back": 0.9, "bay_v": 0.4,              # the anchored bay steps back
        "inner_rear": round(inner_rear, 3),
        "rake": {"up": 0.06, "down": 0.36, "proud": 0.26, "reach": 1.6},
        "west": [[round(u0, 3), round(u1, 3), round(v, 3)] for (u0, u1, v) in west],
        "arches": {"n": n_ar, "pitch": ar_p, "r": r, "ring": ring_m,
                   "spring": spring, "proud": round(proud_a, 3)},
        "brick": list(make_roof_colors(brick)),
        "stone": list(make_roof_colors(stone)),
    }
    grig["hall"] = _hall_rig(pm, foot, (tx, ty), (nx, ny), W_out, west, spec,
                             gable_d, apex_out, 0.9, 0.4)
    return out, grig


# ── FACADE BANDS: what a 1960s dorm is actually made of ───────────────
#
# Simeon: *"make jester look alot nicer if freshman r gonna see this then their
# dorm shouldnt look like a prison ... the color is not accurate"*, and then
# *"we need accurate detail and color"*.
#
# WHY THIS IS NOT A HEIGHT PROBLEM. Jester renders as a 118 m unbroken tan slab
# with a uniform grid of identical windows on it, because `quantiseFacades`
# elects fourteen tones for the whole city and stamps one per building plus a
# repeating window tile. That is the entire vocabulary the building has, so no
# amount of massing can make it read as Jester. What it is missing is a
# HORIZONTAL rhythm and a base, and both are geometry.
#
# WHAT THE PHOTOGRAPHS SAY, and they say two different things about two parts:
#
#   commons: "Jester Dormitory ... (19 03 2003).jpg" (a golden-hour shot of the
#   whole complex from the south-west) and "University of Texas at Austin
#   August 2019 27 (Beauford H. Jester Center).jpg" (the north entrance, flat
#   overcast light — which is the one worth sampling colour off).
#
#   THE LOW WINGS carry a continuous light precast spandrel course at every
#   floor line, running the full width of the elevation and interrupted by
#   nothing. Measured off the 2003 frame: the courses repeat every 116 px and
#   are 28 px deep, so the band is 0.24 of a floor. At a 3.05 m floor that is
#   0.73 m of precast over 2.32 m of brick.
#
#   THE TOWERS have NO banding at all. They are plain brick with small punched
#   windows, articulated instead by BLANK VERTICAL PIERS running the full
#   height between bays of four window columns, and their parapets step.
#
# So the treatment is two zones and they do not overlap: courses BELOW the low
# wings' own height, piers only ABOVE it. The first cut ran both over the whole
# elevation and the render came back as a plaid — vertical piers crossing
# horizontal courses crossing the facade tile's own vertical grain. The
# photograph never does both on the same piece of wall, and neither does this.
#
# The split height is not invented either: Beauford H. Jester Center IS the low
# wing block and the survey models it at 19.0 m.
#
# THE COLOUR, MEASURED RATHER THAN REMEMBERED. Sampled off the 2019 frame with
# green-dominant pixels rejected so foliage cannot vote:
#
#   brick field   rgb(166,145,120)  #a69178   R/B 1.38
#   precast band  rgb(188,176,156)  #bcb09c   R/B 1.21
#
# The building's own baked wall is #c2b6a0 — which is (194,182,160), i.e. the
# TRIM colour, not the brick. That is "the color is not accurate" exactly: the
# whole complex is currently painted the colour of its own spandrels. This bake
# cannot reach `wd`, so it does the other half — it puts the real precast in
# front of the wall, where the contrast between the two is what the eye reads.
#
# AND EVERY BAND STANDS PROUD, because it has to. A precast spandrel really
# does project past the brick; more to the point, this bake does not own the
# building extrusion, so a band flush with the wall would be a coplanar surface
# and would z-fight down the whole elevation. The inner face sits BAND_GAP_M
# clear of the wall so there is no shared plane anywhere.
BAND_GAP_M   = 0.06    # clear air between a band's back and the wall
BAND_MIN_EDGE_M = 4.5  # skip footprint jogs shorter than this — a 3 m stub
                       # gets a band that reads as a lump, not as a course
BAND_PIER_MIN_M = 14.0 # an elevation shorter than this gets no pier; two piers
                       # 4 m apart is a colonnade, not an articulated slab
BAND_SHADE     = 0.82  # how dark a band's own shaded end is. Roof facets use
                       # SHADE_LO/SHADE_HI (0.55); a wall band is nearly
                       # vertical and 0.55 turns the shaded side of a building
                       # into a black stripe.


def _band_feature(ring_m, lat0, b0, h0, day, az, kind="band"):
    """One authored elevation prism, with its own shade range and azimuth.

    `kind` is the `f` tag js/slopes-roofs.js filters on when the three.js
    layer is drawing the real shapes: an authored part that is ALREADY the
    right shape (a stair, a veneer, a precast course — "gable" / "band") stays
    on screen; one that is a stair-step stand-in for a slope or a curve
    ("course", "rake", "ring") is hidden while the mesh draws it properly, and
    comes back untouched when the layer is off. The roof slabs themselves
    carry no `f` at all, so the filter is one `match` on one key.

    `az` IS THE WALL'S OWN OUTWARD NORMAL, not 0. Every authored part in the
    first cut of this carried az=0, so `roofFacetColor` gave all four sides of
    a building the identical tone and the courses stayed the same colour right
    round a corner — which is the "flat plane with stripes on it" failure the
    az field was added to fix in the first place, arrived at from the other
    direction.
    """
    rd, rg, rn = make_roof_colors(day)
    return {
        "type": "Feature",
        "geometry": {"type": "Polygon",
                     "coordinates": [close_ring(to_ll([(x, y) for x, y in ring_m], lat0))]},
        "properties": {"b": round(b0, 2), "h": round(h0, 2), "az": round(az, 1),
                       "rd": rd, "rdd": tint(rd, BAND_SHADE),
                       "rg": rg, "rgd": tint(rg, BAND_SHADE), "rn": rn,
                       "f": kind},
    }


def facade_band_parts(rings, spec, height_m):
    """Precast spandrel courses, a base, and blank piers, for one building."""
    flat = [q for r in rings for q in r]
    lat0 = sum(q[1] for q in flat) / len(flat)
    floor  = float(spec.get("floor_m", 3.05))
    band   = float(spec.get("band_m", 0.73))
    proud  = float(spec.get("band_proud_m", 0.24))
    base_h = float(spec.get("base_m", 1.35))
    base_p = float(spec.get("base_proud_m", 0.34))
    band_to = min(float(spec.get("band_top_m", 19.0)), height_m - 0.8)
    pier_w = float(spec.get("pier_w_m", 1.35))
    pier_p = float(spec.get("pier_proud_m", 0.40))
    pier_at = float(spec.get("pier_spacing_m", 9.5))
    band_c = spec.get("band_colour")
    base_c = spec.get("base_colour") or band_c
    pier_c = spec.get("pier_colour")
    top_c  = spec.get("cornice_colour") or band_c

    parts = []          # (ring, base, top, day_hex, az)
    for ring in rings:
        pm = ccw(clean(to_m(ring, lat0)))
        if len(pm) < 3:
            continue
        for i in range(len(pm)):
            a, b = pm[i], pm[(i + 1) % len(pm)]
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            if L < BAND_MIN_EDGE_M:
                continue
            tx, ty = (b[0] - a[0]) / L, (b[1] - a[1]) / L
            nx, ny = -ty, tx
            mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            if inside((mid[0] + nx, mid[1] + ny), pm):
                nx, ny = -nx, -ny
            az = (math.degrees(math.atan2(nx, ny)) + 360.0) % 360.0

            def rect(u0, u1, v0, v1, a=a, tx=tx, ty=ty, nx=nx, ny=ny):
                return [[a[0] + tx * u + nx * v, a[1] + ty * u + ny * v]
                        for u, v in ((u0, v0), (u1, v0), (u1, v1), (u0, v1))]

            # THE BANDS STOP SHORT OF EACH CORNER by a hand's width, so two
            # adjacent elevations' courses meet at a mitre instead of each
            # running past the other and leaving a 0.24 m tooth sticking out
            # of the corner. It is 12 cm; it is also the difference between a
            # cornice and a row of pegs.
            u0, u1 = 0.12, L - 0.12
            parts.append((rect(u0, u1, BAND_GAP_M, BAND_GAP_M + base_p),
                          0.0, base_h, base_c, az))
            n = 1
            while True:
                h0 = base_h + n * floor - band
                if h0 + band > band_to:
                    break
                parts.append((rect(u0, u1, BAND_GAP_M, BAND_GAP_M + proud),
                              h0, h0 + band, band_c, az))
                n += 1
            # the frieze that closes the banded zone off — the low wings' own
            # eave, and on the towers the line the banding stops at
            if band_to > base_h + floor:
                parts.append((rect(u0, u1, BAND_GAP_M, BAND_GAP_M + base_p),
                              band_to - 0.95, band_to, top_c, az))
            # the parapet frieze, just under the building's own cap. Below
            # `height_m` on purpose: the buildings bake already puts a roof
            # cap AT that height and two lips at one level is a seam.
            parts.append((rect(u0, u1, BAND_GAP_M, BAND_GAP_M + base_p),
                          height_m - 1.05, height_m - 0.08, top_c, az))
            # the blank piers — the TOWER's articulation, and only the tower's.
            # They start where the courses stop, so no wall carries both.
            #
            # QUEUE H5: they used to also STOP at `height_m - 0.08` — the exact
            # same number the parapet frieze above them caps at. That is not a
            # near miss, it is the same float twice, so every pier's own top
            # face and the full-width parapet's top face were two different
            # extrusions occupying the identical plane: coplanar.mjs found this
            # 72 times, one for each (wall, pier) pair on Jester's three
            # buildings, which is 85% of everything it flagged in this file.
            # Not a corner defect — a pier meeting the frieze above it should
            # stop AT the frieze's own underside and let the frieze cap it, the
            # same way the piers already stop where the courses below them do.
            if L >= BAND_PIER_MIN_M and pier_w > 0.1 and height_m > band_to + 3.0:
                n_p = max(1, int(round(L / pier_at)) - 1)
                for j in range(n_p):
                    uc = L * (j + 1) / (n_p + 1)
                    parts.append((rect(uc - pier_w / 2, uc + pier_w / 2,
                                       BAND_GAP_M, BAND_GAP_M + pier_p),
                                  band_to, height_m - 1.05, pier_c, az))

    out = []
    for rg_m, b0, h0, day, az in parts:
        if h0 - b0 < 0.05 or not day:
            continue
        out.append(_band_feature(rg_m, lat0, b0, h0, day, az))
    return out


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
# How far the deck's own wall drops below its top. See the emit site: at 0.30 it
# is exactly coincident with the innermost facet's inner wall and flickers.
# `--fold-ok` restores it with the rest of the pre-fix behaviour, so the
# negative control is the whole old bake and not half of it.
DECK_SKIRT_M  = 0.30 if not RESOLVE_SURFACES else 0.02
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


def _outer_rings(geom):
    if not geom:
        return []
    if geom["type"] == "Polygon":
        return [geom["coordinates"][0]]
    if geom["type"] == "MultiPolygon":
        return [part[0] for part in geom["coordinates"]]
    return []


def _pip(x, y, ring):
    """Ray cast. Rings here come straight out of the two bakes and are closed."""
    inside = False
    for i in range(len(ring) - 1):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[i + 1][0], ring[i + 1][1]
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
    return inside


def deck_caps(feats, pitched, path):
    """Which buildings' parapet caps should stop being terracotta, and what colour.

    Joins every `k=deck` polygon in `data/roofscape.geojson` to the building it
    sits on, and hands back {building id: [rd, rg, rn]} — the deck's own colours.

    TWO INDEPENDENT CHECKS, because a wrong join is a wrong-coloured building and
    nothing on screen would say so. The first is geometric: the deck's
    representative point has to be inside the footprint (the deck is that
    footprint inset 1.1 m, so it always is — but a concave plan puts the CENTROID
    outside, which is why vertices are tried after it). The second is the deck's
    own height: bake_roofscape.py stands it on CAP_GEOM, so `b` must equal
    `final_height + max(1.0, 0.015 * final_height)`. A match that fails the
    height check is thrown away rather than trusted, and counted.

    Pitched buildings are excluded. Their cap is under the eave of a real tiled
    hip and terracotta is right there — and it is the reason this cannot be a
    blanket "make every cap grey".
    """
    if not os.path.exists(path):
        return {}, {"roofscape_missing": 1}
    decks = [f for f in json.load(open(path, encoding="utf-8"))["features"]
             if f.get("properties", {}).get("k") == "deck"]

    cell = 0.002                       # ~190 m; a footprint spans a few cells
    grid, info = {}, []
    for idx, f in enumerate(feats):
        rings = _outer_rings(f.get("geometry"))
        if not rings:
            continue
        xs = [q[0] for r in rings for q in r]
        ys = [q[1] for r in rings for q in r]
        bb = (min(xs), min(ys), max(xs), max(ys))
        info.append((rings, bb, f["properties"]))
        i = len(info) - 1
        for gx in range(int(bb[0] // cell), int(bb[2] // cell) + 1):
            for gy in range(int(bb[1] // cell), int(bb[3] // cell) + 1):
                grid.setdefault((gx, gy), []).append(i)

    def hits(x, y):
        out = []
        for i in grid.get((int(x // cell), int(y // cell)), []):
            rings, bb, _ = info[i]
            if not (bb[0] <= x <= bb[2] and bb[1] <= y <= bb[3]):
                continue
            if any(_pip(x, y, r) for r in rings):
                out.append(i)
        # Smallest footprint wins, so a deck inside a courtyard building's wing
        # is not claimed by the block it happens to sit within.
        out.sort(key=lambda i: (info[i][1][2] - info[i][1][0]) * (info[i][1][3] - info[i][1][1]))
        return out

    caps, st = {}, Counter()
    for d in decks:
        rings = _outer_rings(d["geometry"])
        if not rings:
            continue
        pts = [q for r in rings for q in r]
        cx = sum(q[0] for q in pts) / len(pts)
        cy = sum(q[1] for q in pts) / len(pts)
        found = hits(cx, cy)
        if not found:
            # Concave plan — a cross, an L, a courtyard. Walk the deck's own
            # vertices, each nudged a little toward the centroid so a shared
            # edge cannot land the test on the wrong side.
            for q in pts[::max(1, len(pts) // 12)]:
                found = hits(q[0] + (cx - q[0]) * 0.08, q[1] + (cy - q[1]) * 0.08)
                if found:
                    st["matched_by_vertex"] += 1
                    break
        if not found:
            st["deck_matched_no_building"] += 1
            continue
        p = info[found[0]][2]
        h = p.get("final_height") or 0.0
        cap_top = h + max(1.0, 0.015 * h)
        if abs((d["properties"].get("b") or 0.0) - cap_top) > CAP_BASE_TOL_M:
            st["deck_not_on_its_cap"] += 1
            continue
        bid = p.get("id")
        if not bid:
            st["building_has_no_id"] += 1
            continue
        if bid in pitched:
            st["skipped_pitched_roof"] += 1
            continue
        if bid in caps:
            st["building_with_two_decks"] += 1
            continue
        dp = d["properties"]
        caps[bid] = [tint(dp.get("rd"), CAP_DECK_TINT),
                     tint(dp.get("rg"), CAP_DECK_TINT),
                     dp.get("rn")]
        st["cap_recoloured"] += 1
    st["decks_read"] = len(decks)
    return caps, st


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
    hit = tot = 0
    # Sum the pixels that PASS is_tile, not all of them. Averaging the whole ring
    # would fold in every overhanging live oak and every metre of deck the ring
    # clipped, and hand back a muddy brown that is nobody's roof.
    acc = [0.0, 0.0, 0.0]
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
            if is_tile(c):
                hit += 1
                for j in range(3):
                    acc[j] += float(c[j])
    mean = [round(v / hit, 1) for v in acc] if hit else None
    return (hit / tot if tot else 0.0), tot, mean


def tile_run(pm, lat0, hs):
    """How far in from the eave the tile goes, in metres. 0 means flat roof.

    Walks inward until the imagery stops being tile — tolerating RING_MISSES
    rings, because a live oak overhanging an eave darkens a band of roof it does
    not own, and this campus is full of them.
    """
    run = 0.0
    misses = 0
    eave = 0.0
    eave_col = None
    eave_n = 0
    d = EAVE_D
    while d < hs:
        r = inset(pm, d)
        if r is None:
            break
        fr, n, mean = ring_tile_frac(r, lat0)
        if d == EAVE_D:
            eave = fr
            eave_col = mean
            eave_n = n
            if n < 8:
                return 0.0, 0.0, None
        if fr >= RING_MIN:
            run = d
            misses = 0
        else:
            misses += 1
            if misses > RING_MISSES:
                break
        d += RING_STEP_M
    # The EAVE ring's colour, not an average down the slope: the eave is the one
    # ring that is all tile on every roof this rule accepts, and it is also the
    # part a flying camera actually sees.
    return run, eave, (eave_col if eave_n >= COLOUR_MIN_SAMPLES else None)


# ── A FOOTPRINT IS NOT ALWAYS ONE ROOF ────────────────────────────────
#
# QUEUE J1: *"for calhoun u were right to not red roof the middle part - however
# the horizontal prism in the middle should be roofed. So there should be 3
# horizontal roofed prisms, rn the top and bottom r roofed, the middle should be
# roofed, and the areas between should stay as they are (not roofed)."*
#
# HE IS RIGHT, AND THE PHOTOGRAPH SAYS SO BEFORE HE DOES. Calhoun Hall is a
# cross: two north-south stems and one east-west cross bar. On the z19 nadir
# tile the cross bar is unmistakable terracotta tile with dormers in it — the
# same roof Parlin Hall has above it and Homer Rainey Hall below it, which are
# the "top and bottom" already roofed — and both stems are pale grey
# standing-seam deck. Three horizontal tiled prisms in a row, and the bake was
# drawing the middle one flat.
#
# THE MISTAKE IS THE FILE'S OWN, ONE LEVEL FURTHER IN. The docstring at the top
# records that v1 asked "what fraction of the WHOLE FOOTPRINT is terracotta?"
# and threw away every hall with a membrane deck in the middle, and that v2
# fixed it by asking the question of an offset RING instead. The ring is still
# a single average over the whole perimeter — so a footprint whose perimeter is
# part tile and part membrane averages the two and is thrown away exactly as
# before. Calhoun reads 0.38 at the eave against a RING_MIN of 0.45, because its
# two grey stems own more perimeter than its tiled cross bar does.
#
# THE RULE: ASK THE PHOTOGRAPH WHICH PART OF THE ROOF IS TILE, AND ROOF THAT
# PART. Classify the roof on a 1.2 m grid, take the largest connected patch of
# tile, and — this is the whole of the safety — REQUIRE IT TO BE A RECTANGULAR
# BLOCK, by testing that it fills at least `TILED_PART_FILL` of its own minimum
# rotated rectangle. A wing of a building is a block. A speckle of warm gravel
# across a membrane deck is not, and neither is a ring of tile round a courtyard
# or a stray sunlit patch. Then the ordinary ring probe is run on that block: if
# the eave of the block does not read tile by the SAME rule every other roof on
# this campus is measured by, it gets no roof. Nothing here invents a roof; it
# only moves where the existing question is asked.
#
# IT CAN ONLY ADD, NEVER CHANGE. It is reached only when the whole-footprint
# probe has already returned run 0, so no roof that exists today can be altered
# by it, and the 108 that exist are bit-identical with it on and off.
TILED_PART        = (AUGMENT_TILED_PART if AUGMENT
                     else "--no-tiled-part" not in sys.argv)
TILED_PART_CELL   = 1.2     # classification grid, metres
TILED_PART_MIN_M2 = 220.0   # a wing worth roofing; below this it is a chimney
TILED_PART_AREA   = 0.25    # whole-footprint tile fraction before we even look
TILED_PART_FILL   = 0.72    # of its own minimum rotated rectangle it must fill
TILED_PART_MIN_H  = 6.0     # a two-storey wing at least


def _largest_tile_patch(poly, lat0):
    """The largest connected run of tile inside a footprint, as a cell mask."""
    xs = [q[0] for q in poly]; ys = [q[1] for q in poly]
    x0, y0 = min(xs), min(ys)
    W = int((max(xs) - x0) / TILED_PART_CELL) + 1
    H = int((max(ys) - y0) / TILED_PART_CELL) + 1
    if W < 3 or H < 3 or W * H > 200_000:
        return None, None, None
    ring = poly + [poly[0]]
    m = np.zeros((H, W), dtype=bool)
    inside_n = 0
    for j in range(H):
        for i in range(W):
            x = x0 + (i + 0.5) * TILED_PART_CELL
            y = y0 + (j + 0.5) * TILED_PART_CELL
            if not point_in_ring(x, y, ring):
                continue
            inside_n += 1
            lon, lat = to_ll([(x, y)], lat0)[0]
            c = px_at(lon, lat)
            if c is not None and is_tile(c):
                m[j, i] = True
    if inside_n < 12 or not m.any():
        return None, None, None

    # Open then close, one cell. A dormer ridge and a tree shadow both punch
    # single-cell holes in a real tiled wing, and a single warm cell on a
    # membrane deck is not a wing. Both are noise at this grid and both are
    # removed by the same pair of operations.
    def _dilate(a):
        r = np.zeros_like(a)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                r |= np.roll(np.roll(a, dy, 0), dx, 1)
        return r
    def _erode(a):
        return ~_dilate(~a)
    m = _dilate(_erode(m))          # open: kill speckle
    m = _erode(_dilate(m))          # close: fill pinholes
    if not m.any():
        return None, None, None
    # Largest 4-connected component, iterative so a long wing cannot blow the
    # recursion limit.
    lab = np.zeros((H, W), dtype=np.int32)
    best, best_n = 0, 0
    tag = 0
    for j in range(H):
        for i in range(W):
            if not m[j, i] or lab[j, i]:
                continue
            tag += 1
            stack = [(j, i)]
            lab[j, i] = tag
            n = 0
            while stack:
                cj, ci = stack.pop()
                n += 1
                for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nj, ni = cj + dj, ci + di
                    if 0 <= nj < H and 0 <= ni < W and m[nj, ni] and not lab[nj, ni]:
                        lab[nj, ni] = tag
                        stack.append((nj, ni))
            if n > best_n:
                best, best_n = tag, n
    return (lab == best), (x0, y0), best_n


def tiled_part(poly, lat0):
    """The sub-footprint of a mixed roof that the photograph says is tile.

    Returns a cleaned CCW ring in metres, or None. `poly` is the whole
    footprint, already cleaned and CCW.
    """
    if not TILED_PART:
        return None
    from shapely.geometry import Polygon, box
    from shapely.ops import unary_union
    mask, org, n = _largest_tile_patch(poly, lat0)
    if mask is None:
        return None
    cell = TILED_PART_CELL
    patch_m2 = n * cell * cell
    if patch_m2 < TILED_PART_MIN_M2:
        return None
    x0, y0 = org
    js, iss = np.nonzero(mask)
    cells = unary_union([box(x0 + i * cell, y0 + j * cell,
                             x0 + (i + 1) * cell, y0 + (j + 1) * cell)
                         for j, i in zip(js, iss)])
    if cells.is_empty:
        return None
    # THE BLOCK TEST, and it is the only thing standing between this rule and a
    # campus full of invented roofs. A wing fills its own bounding rectangle; a
    # scatter of warm pixels does not.
    rect = cells.minimum_rotated_rectangle
    if rect.is_empty or rect.area <= 0 or cells.area / rect.area < TILED_PART_FILL:
        return None
    g = rect.intersection(Polygon(poly).buffer(0))
    if g.is_empty:
        return None
    if g.geom_type != "Polygon":
        gs = [q for q in getattr(g, "geoms", []) if q.geom_type == "Polygon"]
        if not gs:
            return None
        g = max(gs, key=lambda q: q.area)
    if g.area < TILED_PART_MIN_M2:
        return None
    sub = ccw(clean(simplify(clean([(x, y) for x, y in list(g.exterior.coords)[:-1]]),
                             SIMPLIFY_M)))
    if len(sub) < 3 or abs(signed_area(sub + [sub[0]])) < TILED_PART_MIN_M2:
        return None
    return sub



# ── THE AUGMENT: THE SHIPPED FEATURES, PLUS `f`, PLUS `rig` ───────────
# Everything below runs on a bake that has already finished. `out` is what
# this machine would have written; `ship` is what the app draws today. The
# only thing that leaves here is `ship` — the generated array is the PROOF
# that the rig belongs to these features, and nothing else.
AUG_COLOUR_KEYS = ("rd", "rdd", "rg", "rgd", "rn")


def _aug_key(f):
    """A feature as everything about it that is not a colour and not `f`."""
    props = {k: v for k, v in f["properties"].items()
             if k not in AUG_COLOUR_KEYS and k != "f"}
    return json.dumps([f["geometry"], props], sort_keys=True, separators=(",", ":"))


def _aug_stop(msg):
    """Exit 2 — "could not run" — never 1. See scripts/verify/README.md."""
    sys.stderr.write(msg + chr(10))
    sys.exit(2)


def augment_shipped(out, rig, gables, caps, meta):
    """Put `f` and `rig` on the shipped features. Never anything else.

    Exits 2 rather than writing if the generated features are not the shipped
    ones: a mismatch means the inputs moved (a new snapshot, the wing survey,
    a rule change) and the answer is `--rebake` and a look at the render, not
    a quiet overwrite of the city.
    """
    if not os.path.exists(OUT):
        _aug_stop("AUGMENT: %s does not exist, so there is nothing to augment. "
                 "Run with --rebake to write a new one." % OUT)
    with open(OUT, encoding="utf-8") as fh:
        ship = json.load(fh)
    sf = ship["features"]
    if len(sf) != len(out):
        _aug_stop("AUGMENT: this bake made %d features, the shipped file holds "
                 "%d. The inputs moved. See AUGMENT at the top of this file; "
                 "use --rebake if the city is meant to change." % (len(out), len(sf)))
    for i, (g, t) in enumerate(zip(out, sf)):
        if _aug_key(g) != _aug_key(t):
            _aug_stop("AUGMENT: feature %d differs from the shipped file." % i
                     + chr(10) + "  baked:   " + _aug_key(g)[:400]
                     + chr(10) + "  shipped: " + _aug_key(t)[:400])
    # THE COLOURS ARE ALLOWED TO DISAGREE AND THE SHIPPED ONE WINS — but the
    # disagreement is counted and printed, because it is the only signal that
    # the imagery under this bake is not the imagery the city was baked from.
    drift = sum(1 for g, t in zip(out, sf) for k in AUG_COLOUR_KEYS
                if g["properties"].get(k) != t["properties"].get(k))
    tagged = 0
    for g, t in zip(out, sf):
        f = g["properties"].get("f")
        if f is not None:
            t["properties"]["f"] = f
            tagged += 1
        else:
            t["properties"].pop("f", None)
    # The deck at the top of a rise is the one surface whose colour is that
    # live vote, so the rig takes it from the feature the mesh replaces.
    decks_taken = 0
    for ent in rig.values():
        di = ent.pop("_deck_i", None)
        if di is None or ent.get("deck") is None:
            continue
        sp = sf[di]["properties"]
        took = [sp.get("rd"), sp.get("rg"), sp.get("rn")]
        if took != ent["deck"]:
            decks_taken += 1
        ent["deck"] = took
    caps_moved = sum(1 for k, v in caps.items() if ship["caps"].get(k) != v)
    caps_new = len([k for k in caps if k not in ship["caps"]])
    ship["rig"] = {"meta": meta, "roofs": rig, "gables": gables}
    print(json.dumps({"augment": {
        "shipped_features_kept": len(sf),
        "f_tags_written": tagged,
        "colour_slots_this_bake_disagreed_on": drift,
        "rig_decks_taken_from_the_shipped_feature": decks_taken,
        "caps_this_bake_disagreed_on": caps_moved,
        "caps_this_bake_would_have_added": caps_new,
        "snapshot": os.path.basename(os.path.dirname(SNAP)),
        "wing_survey": TILED_PART,
    }}, indent=2))
    return ship

def main():
    report = "--report" in sys.argv
    # Probing 2,400 footprints against the imagery takes minutes; the geometry
    # takes seconds. Splitting the two means the shape can be iterated on — which
    # it needs to be, by looking at renders — without re-reading the photograph
    # every time. `--remeasure` forces the read.
    remeasure = "--remeasure" in sys.argv or not os.path.exists(MEAS)
    cache = {} if remeasure else json.load(open(MEAS, encoding="utf-8"))
    feats = json.load(open(SNAP, encoding="utf-8"))["features"]
    overrides = load_overrides()
    tile_base, tile_base_n = campus_tile_base(feats, cache)
    retinted = {}            # building id -> the tile triple its cap must take
    # THE RIG. Everything below is computed per roof and was thrown away once
    # the slabs were written; js/slopes-roofs.js reads it back to draw the
    # continuous surface the slabs are a staircase of. See `rig` at the write.
    rig = {}
    gables = {}
    out = []
    stats = Counter()
    # Pinned so it prints even at zero. A count that only appears when it is
    # non-zero is a count nobody notices coming back.
    stats["roofs_with_a_hole"] = 0
    stats["roofs_with_a_missing_slope"] = 0
    stats["walls_with_no_slope"] = 0
    stats["roofs_drawn_twice_or_over_air"] = 0
    stats["folded_rings"] = 0
    stats["roofs_with_a_crossed_facet"] = 0
    stats["facets_that_cross_themselves"] = 0
    stats["facets_untangled"] = 0
    stats["facet_lobes_dropped"] = 0
    stats["roofs_from_a_tiled_wing"] = 0
    stats["tiled_wing_eave_said_no"] = 0
    stats["walls_capped_at_an_edge_event"] = 0
    stats["rings_lost_to_rounding"] = 0
    stats["surfaces_dropped_by_resolver"] = 0
    stats["resolver_removed_m2"] = 0
    stats["parts_added_by_resolver"] = 0
    stats["resolver_parts_with_a_hole"] = 0
    stats["gable_fronts"] = 0
    stats["gable_front_parts"] = 0
    stats["facade_band_buildings"] = 0
    stats["facade_band_parts"] = 0
    rows = []
    audit = []
    diag = []
    surfaces = []
    spills = []
    pitched = set()          # buildings this bake gives a real tiled roof to
    for f in feats:
        p = f["properties"]
        h = p.get("final_height") or 0
        ov = overrides.get(p.get("id")) or {}
        # THE HEIGHT GATE IS ABOUT SHAPE, NOT SIZE. It is here because a tower
        # is flat-topped, and it is right almost everywhere — but Jester West is
        # one footprint 51.6 m tall whose PERIMETER is two-storey tile-roofed
        # wings, and excluding it is what leaves the loudest dorm on campus as a
        # bare brown lid. An override is allowed past it, one building at a time,
        # with the photograph quoted in the file.
        if h < 4 or (h > MAX_HEIGHT_M and not ov.get("roof_over_max_height")):
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
            poly = ccw(pm)
            mrays = mitre_rays(poly)
            if mrays is None:
                stats["degenerate_footprint"] += 1
                continue
            # One bisection per vertex, reused by the half-span, every step ring
            # and the deck. `max(caps)` IS the half-span — see the note where
            # `half_span()` used to be.
            caps = vertex_caps(poly, mrays)
            # THE HALF-SPAN IS READ BEFORE THE EDGE-EVENT CAP, deliberately.
            # `hs` is how wide the BUILDING is, and it feeds the imagery probe
            # (`tile_run` walks in until d >= hs) and the deck's colour sample.
            # An edge event is a statement about one wall's length, not about
            # the building's width, and letting it shorten `hs` would make the
            # photograph be read over a smaller ring on exactly the jagged
            # footprints this fix exists for.
            hs = max(caps)
            caps, capped_walls = edge_event_caps(poly, mrays, caps)
            stats["walls_capped_at_an_edge_event"] += capped_walls
            if hs < 1.2:
                stats["too_narrow"] += 1
                continue
            key = "%s/%d" % (p.get("id"), ri)
            if key in cache and len(cache[key]) >= 3:
                run, eave, meas = cache[key][:3]
            elif key in cache:
                # A cache written before roofs carried a measured colour. Keep
                # its run/eave — those cost the minutes — and simply go without
                # the colour rather than forcing a full --remeasure.
                run, eave = cache[key][:2]
                meas = None
            else:
                run, eave, meas = tile_run(pm, lat0, hs)
                cache[key] = [round(run, 2), round(eave, 3), meas]
            # THE WHOLE-FOOTPRINT TILE FRACTION, cached beside the run because
            # it is the second, independent reading the colour rule needs and
            # re-reading it costs a 20x20 probe per candidate. Old three-element
            # entries simply grow a fourth the first time they are asked.
            if len(cache.get(key, ())) >= 4:
                area_fr = cache[key][3]
            else:
                area_fr, _n = tile_frac_area(ring)
                area_fr = round(area_fr, 3)
                cache.setdefault(key, [round(run, 2), round(eave, 3), meas])
                cache[key] = list(cache[key][:3]) + [area_fr]
            if ri == 0 and ov.get("roof_run_m"):
                # An override does not get to invent a roof — it corrects a run
                # the ring probe under-read. `eave` keeps the measured value so
                # the report still shows what the imagery actually said.
                run = float(ov["roof_run_m"])
                stats["run_from_override"] += 1
            sub_of = None
            if run < MIN_RUN_M and TILED_PART and h >= TILED_PART_MIN_H \
                    and area_fr >= TILED_PART_AREA and not ov.get("roof_run_m"):
                # J1. The whole footprint says flat. Ask the photograph whether
                # a rectangular WING of it is tile, and if so put the same
                # question to that wing — same probe, same thresholds, smaller
                # ring. Anything this cannot justify falls straight through to
                # the flat path below, which is where it is today.
                sub = tiled_part(poly, lat0)
                if sub is not None:
                    s_mrays = mitre_rays(sub)
                    if s_mrays is not None:
                        s_caps = vertex_caps(sub, s_mrays)
                        s_hs = max(s_caps)
                        if s_hs >= 1.2:
                            s_run, s_eave, s_meas = tile_run(sub, lat0, s_hs)
                            if s_run >= MIN_RUN_M:
                                sub_of = poly
                                poly = sub
                                mrays = s_mrays
                                caps, capped = edge_event_caps(sub, s_mrays, s_caps)
                                stats["walls_capped_at_an_edge_event"] += capped
                                hs = s_hs
                                run, eave, meas = s_run, s_eave, s_meas
                                stats["roofs_from_a_tiled_wing"] += 1
                            else:
                                stats["tiled_wing_eave_said_no"] += 1
            if run < MIN_RUN_M:
                stats["flat" if eave < RING_MIN else "tile_edge_only"] += 1
                continue
            # `fold_free_run` used to cut the run back to the last offset that
            # did not fold anywhere — 45 buildings lost slope depth to one notch
            # somewhere else on the footprint. Nothing folds now: a vertex that
            # cannot travel stops at its cap and its neighbours carry on. So the
            # measured run stands, and the cap that used to be global is local.
            if run < MIN_RUN_M:
                stats["too_narrow_to_slope"] += 1
                continue

            # The colour cannot be resolved yet: it is a comparison against the
            # campus median and the campus is not measured until the loop ends.
            # Stash the ratio on each facet and settle it in one pass below.
            rb_here = measured_rb(meas)
            rd_real, rg_real, rn_real = p.get("rd"), p.get("rg"), p.get("rn")

            # ── the roof's own colour, if the building's is not one ──────
            # An explicit override first (it is the same thing an OSM
            # `roof:colour` tag would be), then the campus rule. Both go through
            # bake_detail.py's own make_roof_colors so the day/golden/night
            # triple can never be a different shape from every other roof's.
            tile_col = ov.get("roof_colour")
            if not tile_col and TILE_COLOUR_RULE:
                own = rb_of(rd_real)
                if (own is not None and own < TILE_RB_MIN
                        and eave >= TILE_EAVE_MIN and area_fr >= TILE_AREA_MIN):
                    tile_col = tile_base
                elif own is not None and own < TILE_RB_MIN and eave >= TILE_EAVE_MIN:
                    # The eave said tile and the footprint disagreed. That is
                    # the case the second reading exists for; count it, do not
                    # act on it.
                    stats["tile_colour_rejected_by_area"] += 1
            if tile_col:
                rd_real, rg_real, rn_real = make_roof_colors(tile_col)
                retinted[p.get("id")] = [rd_real, rg_real, rn_real]
                stats["roofs_given_a_tile_colour"] += 1

            steps = max(STEPS_MIN, min(STEPS_MAX, int(round(run / STEP_TARGET_M))))
            # The wall's cap already sits at h + lift (CAP_GEOM in app.js); start
            # the roof from there so nothing z-fights the parapet.
            base = h + max(1.0, 0.015 * h)
            # Ring 0 is the eave: outside the wall, and flat, so the roof reads
            # as sitting ON the building with an overhang instead of growing out
            # of it. It carries no rise, so it needs no per-facet tint.
            # The profile is solved once per building and every ring below is a
            # multiply-add on it. Walls whose middle can outrun their corners
            # gain sample points here and nowhere else.
            d_use = run * steps / (steps + 0.35)
            d_want = d_use
            npoly = len(poly)
            ppts, prays, pcaps, spans = wall_profile(poly, mrays, caps, d_use)
            if len(ppts) > len(poly):
                stats["walls_densified"] += len(ppts) - len(poly)
                stats["roofs_densified"] += 1
            rise = min(RISE_MAX, PITCH * run)
            # Every polygon this building emits, in draw order, in LOCAL METRES,
            # so `resolve_surfaces` can do arithmetic on it before any of it is
            # converted back to degrees. Nothing is appended to `out` until the
            # whole roof has been resolved.
            emitted = []
            eave_ring = profile_ring(ppts, prays, pcaps, -EAVE_OUT_M)
            if abs(signed_area(eave_ring)) < 1.0:
                eave_ring = None
            if eave_ring is not None:
                # The eave lip is flat, so both ends of its shade range are the
                # building's own baked colour and the sun term cannot move it.
                emitted.append((eave_ring[:-1], round(base + 0.35, 2),
                                {"b": round(base, 2), "h": round(base + 0.35, 2), "az": 0,
                                 "rd": rd_real, "rg": rg_real, "rn": rn_real,
                                 "rdd": rd_real, "rgd": rg_real}))
            start = eave_ring if eave_ring is not None else profile_ring(
                ppts, prays, pcaps, 0.0)
            # Every step ring is the SAME rays clamped at the SAME per-point
            # caps, so the rings nest, the indices stay paired, and a point that
            # has reached its ridge simply stops instead of taking its facet with
            # it.
            rings = [(start, [-EAVE_OUT_M] * len(ppts), 0.0)]
            for s in range(1, steps + 1):
                d = d_use * s / steps
                rings.append((profile_ring(ppts, prays, pcaps, d),
                              [min(d, c) for c in pcaps], rise * s / steps))
            made = 0
            edge_steps = Counter()
            covers = []            # every polygon this roof puts above the eave
            pieces = []            # ...with its top height, for audit_surfaces
            # ...and the same quads filed under the footprint edge each one is
            # the slope of, which is what audit_slope_depth needs.
            facet_by_edge = {}
            M = len(ppts)
            npoly = len(poly)
            # One facet per FOOTPRINT EDGE per step, not one per profile segment:
            # a wall's slope is a single plane whichever way its inner edge dips,
            # and splitting it would put a shading seam down the middle of it.
            edge_idx = [[k % M for k in range(a, b + 1)] for (a, b) in spans]
            for (r0, dd0, t0), (r1, dd1, t1) in zip(rings, rings[1:]):
                if r0 is None or r1 is None:
                    break
                b = round(base + 0.35 + t0, 2)
                ht = round(base + 0.35 + max(t1, t0 + 0.15), 2)
                for i in range(npoly):
                    az = facet_az(poly[i], poly[(i + 1) % npoly])
                    if az is None:
                        continue
                    idx = edge_idx[i]
                    face = [r0[k] for k in idx] + [r1[k] for k in reversed(idx)]
                    quad = face + [face[0]]
                    if abs(signed_area(quad)) < 0.35:      # a sliver, not a facet
                        continue
                    travels = ([dd0[k] for k in idx]
                               + [dd1[k] for k in reversed(idx)])
                    if not valid_step(quad, travels, poly):
                        stats["facet_guard_fired"] += 1
                        continue
                    # H5. A crossed quad is not a shape; keep the lobes that are
                    # attached to this facet's own wall and drop the spike.
                    lobes = untangle_facet(face, len(idx))
                    if len(lobes) != 1 or lobes[0] is not face:
                        stats["facets_untangled"] += 1
                        stats["facet_lobes_dropped"] += max(0, 1 - len(lobes))
                    if not lobes:
                        continue
                    edge_steps[i] += 1
                    for face in lobes:
                        facet_by_edge.setdefault(i, []).append(face)
                        emitted.append((face, ht, {
                            "b": b, "h": ht,
                                "az": round(az),
                            # The two ends of this facet's shade range, from the
                            # parent's own baked roof colours so a facet can
                            # never drift from the cap it sits on. Which end it
                            # lands on is the live sun's call, in timeofday.js.
                            "rd": tint(rd_real, SHADE_HI),
                            "rdd": tint(rd_real, SHADE_LO),
                            "rg": tint(rg_real, SHADE_HI),
                            "rgd": tint(rg_real, SHADE_LO),
                            "rn": rn_real,      # no sun at night, no tilt tint
                            "_rb": rb_here,
                        }))
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
            # THE DECK IS THE RING THE SLOPE ACTUALLY STOPS AT — it was not, and
            # that cost every roof on campus a hole. It used to be offset
            # `run + 1.6`, while the innermost slope facet stops at
            # `run * steps/(steps+0.35)`, about 0.9 run. The 2 m annulus between
            # them was covered by nothing: 1,008 m^2 on Welch Hall, 10.4% of its
            # roof, on 75 of 99 pitched roofs, and it is why the audit's first
            # numbers were so large. Reusing `rings[-1]` makes the file's own
            # sentence — "whatever the slope encloses is filled at the top of the
            # slope" — true rather than nearly true, and it cannot drift again
            # because there is no second expression to keep in step.
            #
            # It also fixes the second half of the diagonals. `inset` accepted a
            # deck ring that had folded inside a wing (positive area, no vertex
            # travelling far), so the church at 22nd got a cross-shaped plate at
            # the top of its rise with two arms running 25 m down a wing only
            # 13 m wide. A capped ring cannot leave the building.
            rig_deck, rig_deck_props, rig_deck_i = None, None, None
            deck = rings[-1][0]
            if deck is None or abs(signed_area(deck)) < 1.0:
                deck = None
            if made >= 1 and deck is not None:
                cols, hits = [], 0
                dll = to_ll(deck, lat0)
                # SAMPLE deeper than we DRAW. The colour question is "is the
                # middle of this roof membrane or is it more tile", and the ring
                # the slope stops at still has the slope's own tile in it. So the
                # probe keeps the old, deeper ring and only the geometry moved.
                sample = profile_ring(ppts, prays, pcaps,
                                      min(run + 1.6, hs * 0.95))
                sll = to_ll(sample, lat0) if abs(signed_area(sample)) >= 1.0 else dll
                lons = [q[0] for q in sll]; lats = [q[1] for q in sll]
                for i in range(16):
                    for j in range(16):
                        lon = min(lons) + (max(lons) - min(lons)) * (i + 0.5) / 16
                        lat = min(lats) + (max(lats) - min(lats)) * (j + 0.5) / 16
                        if not point_in_ring(lon, lat, sll):
                            continue
                        c = px_at(lon, lat)
                        if c is None:
                            continue
                        cols.append([int(c[0]), int(c[1]), int(c[2])])
                        hits += is_tile(c)
                membrane = len(cols) >= DECK_MIN_PX and hits / len(cols) <= DECK_TILE_MAX
                # AN OVERRIDDEN DECK COLOUR SKIPS THE VOTE, not just the value.
                # On Jester the probe's own sample ring is half tile and half
                # concrete, so `membrane` is a coin flip on a roof whose middle
                # is plainly a concrete deck in the photograph. The override
                # names the answer AND the colour, because naming only the
                # colour would leave it unused half the time.
                if ov.get("deck_colour"):
                    membrane = True
                    dc = ov["deck_colour"]
                elif membrane:
                    dc = deck_colour(cols, rd_real)
                if membrane:
                    props = {"rd": dc, "rdd": dc,
                             "rg": like(dc, rd_real, rg_real),
                             "rgd": like(dc, rd_real, rg_real),
                             "rn": like(dc, rd_real, rn_real)}
                else:
                    props = {"rd": rd_real, "rdd": rd_real,
                             "rg": rg_real, "rgd": rg_real,
                             "rn": rn_real}
                top = round(base + 0.35 + rise, 2)
                # THE DECK'S SKIRT IS 2 cm, NOT 30, and that is half of A5. It
                # used to be `top - 0.3`, and the deck's outer wall is the
                # innermost facet's inner wall — the same vertical plane, in the
                # same place, over the same 30 cm. Two coincident faces have no
                # defined winner and the winner changes as the camera moves,
                # which is a flicker in exactly the place he described it: "a bit
                # of movement glitching between the slightly grayer roof and the
                # brown slope". The skirt was never visible — it is buried in the
                # joint between two surfaces that already meet — so the whole of
                # it can go. 2 cm is kept rather than 0 so a zero-height
                # extrusion never has to be reasoned about.
                props.update({"b": round(top - DECK_SKIRT_M, 2), "h": top, "az": 0})
                emitted.append((deck[:-1], top, props))
                rig_deck, rig_deck_props = [props["rd"], props["rg"], props["rn"]], props
                stats["decks" if membrane else "ridge_tops"] += 1

            if made < 1:
                stats["tiled_but_degenerate"] += 1
                continue
            # ── ONE SQUARE METRE, ONE SURFACE ────────────────────────────
            resolved, dropped, lost_m2 = (
                resolve_surfaces(emitted, start[:-1]) if RESOLVE_SURFACES
                else ([( [r], t, pr) for r, t, pr in emitted], 0, 0.0))
            stats["surfaces_dropped_by_resolver"] += dropped
            stats["resolver_removed_m2"] += int(round(lost_m2))
            stats["parts_added_by_resolver"] += max(0, len(resolved) - len(emitted))
            stats["resolver_parts_with_a_hole"] += sum(1 for r, _, _ in resolved
                                                       if len(r) > 1)
            covers = [rings[0] for rings, t, _ in resolved
                      if t > round(base + 0.35, 2) + 1e-6]
            pieces = [(rings[0], t) for rings, t, _ in resolved]
            for rings, _t, props in resolved:
                # CLOSE THE RING HERE, once, rather than trusting each producer
                # to. `face`, `deck[:-1]` and shapely's `exterior.coords` do not
                # agree about it, and an unclosed GeoJSON ring is invalid — the
                # `--fold-ok` control emitted 3,403 of them before this line and
                # so could not be compared against the file it is a control for.
                ll = [close_ring(to_ll(r, lat0)) for r in rings]
                # ...AND CHECK THE ROUNDED RING, not the one in metres. See
                # `ring_survives_rounding`: the write is where the folds are
                # made, so it is the only place they can be caught.
                if not survives_rounding(ll):
                    stats["rings_lost_to_rounding"] += 1
                    continue
                # WHERE THE DECK LANDED in the feature array. The augment
                # pass takes the deck's colour off the SHIPPED feature rather
                # than off this run, because that one colour is a live vote on
                # gitignored imagery (see AUGMENT at the top) and is the only
                # value in this file that two machines disagree about.
                if rig_deck_i is None and props is rig_deck_props:
                    rig_deck_i = len(out)
                out.append({
                    "type": "Feature",
                    "geometry": {"type": "Polygon", "coordinates": ll},
                    "properties": dict(props),
                })
            stats["tiled"] += 1
            # The rig: the profile, its rays and caps, the depth the slope runs
            # to and the heights it runs between — the numbers every ring above
            # was a multiply-add on. Metres in this file's own frame; `dpm`
            # (degrees per metre, x then y) is the way back to lng/lat, so the
            # reader carries no projection constant of its own.
            kk = math.cos(math.radians(lat0))
            rig[key] = {
                "name": p.get("name"),
                "dpm": [1.0 / (M_LAT * kk), 1.0 / M_LAT],
                "pts": [[round(x, 2), round(y, 2)] for (x, y) in ppts],
                "rays": [[round(ux, 4), round(uy, 4)] for (ux, uy) in prays],
                "caps": [round(c, 2) for c in pcaps],
                "spans": [[a, b] for (a, b) in spans],
                "d": round(d_use, 3), "run": round(run, 2), "rise": round(rise, 3),
                "base": round(base, 2), "steps": steps,
                "col": [rd_real, rg_real, rn_real],   # settled below, with the facets
                "lip": ([rd_real, rg_real, rn_real] if eave_ring is not None else None),
                "deck": rig_deck, "_deck_i": rig_deck_i,
                "_rb": rb_here,
            }
            # A WING IS NOT THE BUILDING. `pitched` tells the parapet-cap rule
            # below to leave a building's cap terracotta because it has a real
            # tiled hip. Calhoun's cross bar does — and the two stems either
            # side of it are membrane deck, which is exactly the case that rule
            # exists to stop outlining in burnt orange. So a sub-roof does not
            # claim the whole building's cap.
            if sub_of is None:
                pitched.add(p.get("id"))
            cen_poly = sub_of if sub_of is not None else poly
            stats["steps"] += made
            cen = [round(sum(q[0] for q in ring[:-1]) / (len(ring) - 1), 5),
                   round(sum(q[1] for q in ring[:-1]) / (len(ring) - 1), 5)]
            # Always measured, printed only with --audit: the number belongs in
            # every bake's output so a regression cannot land quietly.
            #
            # RUN ON THE RESOLVED GEOMETRY, not on what the bake intended, so a
            # square metre the resolver takes away shows up here as a hole.
            bad = audit_coverage(start[:-1], covers, poly, p.get("name"), key, cen)
            if bad is not None:
                audit.append(bad)
                stats["roofs_with_a_hole"] += 1
            # MEASURED AGAINST WHAT THE ROOF WANTED, NOT AGAINST WHAT IT SETTLED
            # FOR. Passing `d_use` here makes the test self-fulfilling — a fix
            # that cuts the whole roof's depth back then reports every wall as
            # reaching its target, which is how the first version of the
            # simplicity fix looked clean while taking 9.5 m of 11.8 off the
            # Biomedical Engineering Building.
            walls = audit_slope_depth(poly, facet_by_edge, d_want,
                                      p.get("name"), key, cen)
            if walls:
                diag.extend(walls)
                stats["roofs_with_a_missing_slope"] += 1
                stats["walls_with_no_slope"] += len(walls)
            # The eave lip is this roof's own outline, so it is the reference
            # rather than one of the pieces being judged.
            surf = audit_surfaces(start[:-1], pieces, p.get("name"), key, cen)
            if surf is not None:
                surfaces.append(surf)
                stats["roofs_drawn_twice_or_over_air"] += 1
                stats["folded_rings"] += surf["folded_rings"]
            # H5. Measured on the facets as they go out, so this reports the
            # repaired geometry rather than the intention.
            cross = audit_facet_rings(facet_by_edge, p.get("name"), key, cen)
            if cross is not None:
                spills.append(cross)
                stats["roofs_with_a_crossed_facet"] += 1
                stats["facets_that_cross_themselves"] += cross["facets_that_cross_themselves"]
            if report:
                area_fr, _ = tile_frac_area(ring)
                rows.append((run, hs, eave, area_fr, rise, p.get("name") or "(unnamed)"))

    # ── ...and the same rule between roofs ───────────────────────────────
    if RESOLVE_SURFACES:
        ch, dr, ls = resolve_across_roofs(out, 30.285)
        out = [f for f in out if not f["properties"].pop("_drop", None)]
        stats["cross_roof_trimmed"] = ch
        stats["cross_roof_dropped"] = dr
        stats["cross_roof_removed_m2"] = int(round(ls))

    # ── the authored elevations ──────────────────────────────────────────
    #
    # APPENDED AFTER BOTH RESOLVERS, DELIBERATELY. "One square metre, one
    # surface" is the right law for a roof — a roof is a single skin and two
    # pieces of it at the same place is a defect. An elevation is the opposite:
    # a jamb, the archivolt over it, the pediment over that and the corbel on
    # its rake all share the same square metre of ground by design, at four
    # different heights. Running any of this through `resolve_surfaces` would
    # keep the tallest and delete the building's face.
    #
    # NO HEIGHT GATE HERE EITHER. The loop above skips anything over
    # MAX_HEIGHT_M unless the override lets it past, because that gate is about
    # ROOF SHAPE. A facade has nothing to do with roof shape, and Jester West is
    # 51.6 m: gating its bands on a roof rule is how the last pass ended up
    # reporting massing again.
    for f in feats:
        p = f["properties"]
        ov = overrides.get(p.get("id")) or {}
        rings = _outer_rings(f["geometry"])
        if not rings:
            continue
        h = float(p.get("final_height") or 0)
        spec = ov.get("gable_front")
        if spec and h > 4:
            made, grig = gable_front_parts(rings[0], spec, h)
            out.extend(made)
            stats["gable_front_parts"] += len(made)
            if made:
                stats["gable_fronts"] += 1
                gables[p.get("id")] = dict(grig, name=p.get("name"))
        spec = ov.get("facade_bands")
        if spec and h > 6:
            # EVERY ring, not just the outer one: Jester West's courtyard is a
            # real elevation students look at, and banding the street front
            # while leaving the court blank is the seam you notice.
            g = f["geometry"]
            allr = ([g["coordinates"]] if g["type"] == "Polygon"
                    else g["coordinates"])
            made = facade_band_parts([r for poly in allr for r in poly], spec, h)
            out.extend(made)
            stats["facade_band_parts"] += len(made)
            if made:
                stats["facade_band_buildings"] += 1

    # ── Settle the roof colours, now that the whole campus has been measured ──
    #
    # Each roof is moved by how its own measured red/blue compares with the
    # MEDIAN measured roof, not by its absolute value. The median is unmoved by
    # construction, so the authored burnt orange stays exactly where it was and
    # only the spread around it is real.
    rbs = sorted(f["properties"]["_rb"] for f in out
                 if f["properties"].get("_rb") is not None)
    median_rb = rbs[len(rbs) // 2] if rbs else None
    if median_rb:
        stats["colour_measured"] = len(rbs)
        stats["colour_median_rb"] = round(median_rb, 3)
        stats["colour_rb_p10_p90"] = [round(rbs[len(rbs) // 10], 2),
                                      round(rbs[9 * len(rbs) // 10], 2)]
    moved = 0
    for f in out:
        pr = f["properties"]
        rb = pr.pop("_rb", None)
        if rb is None or not median_rb:
            continue
        for hi, lo, src in (("rd", "rdd", "rd"), ("rg", "rgd", "rg")):
            pass
        rd0, rg0 = pr.get("rd"), pr.get("rg")
        # rd/rdd and rg/rgd are the two ends of the same colour's shade range,
        # so both ends have to move together or a facet's lit and shaded sides
        # would come from different roofs.
        base_d = shift_to_measured(tint(rd0, 1.0), rb, median_rb)
        base_g = shift_to_measured(tint(rg0, 1.0), rb, median_rb)
        if base_d != tint(rd0, 1.0):
            moved += 1
        pr["rd"] = tint(base_d, 1.0)
        pr["rdd"] = tint(base_d, SHADE_LO / SHADE_HI)
        pr["rg"] = tint(base_g, 1.0)
        pr["rgd"] = tint(base_g, SHADE_LO / SHADE_HI)
    stats["colour_from_imagery"] = moved
    # ...and the rig's facet colour moves with its facets: the same shift, on
    # the unshaded roof colour, so a mesh roof lit by the real sun starts from
    # the tone its own slabs are shaded around.
    for ent in rig.values():
        rb = ent.pop("_rb", None)
        if rb is None or not median_rb:
            continue
        ent["col"] = [shift_to_measured(ent["col"][0], rb, median_rb),
                      shift_to_measured(ent["col"][1], rb, median_rb),
                      ent["col"][2]]

    # ── The parapet caps over membrane decks ─────────────────────────────
    #
    # A FOREIGN MEMBER ON THE FEATURECOLLECTION, deliberately. GeoJSON allows it
    # and MapLibre reads only `type` and `features`, so `austin-roofs` is
    # unchanged by this; `js/app.js` picks the table off the same parsed object
    # it hands to `addSource`, which is why this costs no extra request. It is
    # NOT a feature, because a cap colour is not a shape — inventing geometry to
    # carry a colour is what makes a 1,044 KB file into a 1,827 KB one.
    caps, cap_stats = ({}, Counter())
    if ROOF_CAPS:
        caps, cap_stats = deck_caps(feats, pitched, ROOFSCAPE)
    # ...AND THE SAME TABLE CARRIES THE RETINTED ROOFS. `buildings-roof` — the
    # parapet cap app.js draws over every top face — is painted from the
    # BUILDING's `rd`, which is the colour this pass has just decided was not a
    # roof colour. Leaving it alone would ring every corrected roof in the tan
    # it was corrected out of, which is HANDOFF §37's defect with the colours
    # swapped. `deck_caps` never touches a pitched building (it counts them as
    # `skipped_pitched_roof`), so there is nothing to overwrite.
    for bid, triple in retinted.items():
        if bid:
            caps[bid] = triple
            cap_stats["cap_took_the_tile_colour"] += 1
    # THE RIG IS A SECOND FOREIGN MEMBER, beside `caps` and for the same
    # reasons: MapLibre ignores it, the app already holds this parsed object,
    # and a shape is not a feature. `roofs` is keyed like `caps` plus the ring
    # index (`id/ri`), `gables` by building id; `meta` carries the constants
    # the slabs were built with so the reader never restates one.
    rig_meta = {"lip": 0.35, "over": EAVE_OUT_M, "skirt": DECK_SKIRT_M,
                "pitch": PITCH, "snapshot": os.path.basename(os.path.dirname(SNAP))}
    if AUGMENT:
        fc = augment_shipped(out, rig, gables, caps, rig_meta)
    else:
        for ent in rig.values():
            ent.pop("_deck_i", None)
        fc = {"type": "FeatureCollection", "features": out, "caps": caps,
              "rig": {"meta": rig_meta, "roofs": rig, "gables": gables}}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(fc, fh, separators=(",", ":"))
    with open(MEAS, "w", encoding="utf-8") as fh:
        json.dump(cache, fh, separators=(",", ":"), sort_keys=True)
    print(json.dumps({
        "wrote": "the shipped features + f + rig" if AUGMENT else "a fresh bake",
        "roof_steps": len(fc["features"]),
        "roof_steps_this_bake_made": len(out),
        "file_kb": round(os.path.getsize(OUT) / 1024, 1),
        "counts": dict(sorted(stats.items())),
        "parapet_caps": dict(sorted(cap_stats.items())),
        "caps_kb": round(len(json.dumps(fc["caps"], separators=(",", ":"))) / 1024, 1),
        "rig_kb": round(len(json.dumps(fc["rig"], separators=(",", ":"))) / 1024, 1),
        "rig_roofs": len(rig),
        "rig_gables": len(gables),
        "tile_colour": {
            "campus base": tile_base,
            "derived from": tile_base_n or "nothing — the constant %s stood in" % TILE_BASE,
            "rule": "eave >= %.2f AND whole footprint >= %.2f AND the building's "
                    "own rd is below %.2f red/blue" % (TILE_EAVE_MIN, TILE_AREA_MIN,
                                                       TILE_RB_MIN),
            "overrides applied": len(overrides),
        },
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
    if "--audit" in sys.argv:
        audit.sort(key=lambda a: -a["hole_m2"])
        print("\n  ROOFS WITH AN UNCOVERED HOLE - %d of %d pitched roofs" % (len(audit), stats["tiled"]))
        print("   hole_m2   of_roof  wall_az  wall_m  building")
        for a in audit:
            print("   %7.1f    %5.1f%%   %5s   %5.1f  %s   %s  at %s"
                  % (a["hole_m2"], a["hole_fr"] * 100, a["wall_az"], a["wall_len_m"],
                     (a["name"] or "")[:38], a["id"], a["at"]))
        diag.sort(key=lambda a: -a["bare_m2"])
        seen = {}
        for a in diag:
            seen.setdefault(a["id"], a)
        print("\n  WALLS THAT GOT NO SLOPE OF THEIR OWN - %d walls on %d of %d pitched roofs"
              % (len(diag), len(seen), stats["tiled"]))
        print("   bare_m2   could_m2   missing  wall_az  wall_m  building")
        for a in diag:
            print("   %7.1f   %8.1f    %5.1f%%   %5s   %5.1f  %s   %s  at %s"
                  % (a["bare_m2"], a["could_m2"], a["short_fr"] * 100, a["wall_az"],
                     a["wall_len_m"], (a["name"] or "")[:38], a["id"], a["at"]))
        surfaces.sort(key=lambda a: -(a["folded_rings"] * 1e6 + a["outside_m2"] * 1e3
                                      + a["over_m2"]))
        print("\n  ROOFS THAT DRAW A SQUARE METRE TWICE, OR DRAW OVER OPEN AIR - "
              "%d of %d pitched roofs" % (len(surfaces), stats["tiled"]))
        print("   folded  outside_m2  twice_m2  building")
        for a in surfaces:
            print("   %6d   %9.1f  %8.1f  %s   %s  at %s"
                  % (a["folded_rings"], a["outside_m2"], a["over_m2"],
                     (a["name"] or "")[:38], a["id"], a["at"]))
        spills.sort(key=lambda a: -a["worst_m"])
        print("\n  ROOFS WITH A FACET PAST THE END OF ITS OWN WALL - "
              "%d of %d pitched roofs" % (len(spills), stats["tiled"]))
        print("   facets  worst_m  building")
        for a in spills:
            print("   %6d   %6.2f  %s   %s  at %s"
                  % (a["facets_past_their_wall"], a["worst_m"],
                     (a["name"] or "")[:38], a["id"], a["at"]))


if __name__ == "__main__":
    main()
