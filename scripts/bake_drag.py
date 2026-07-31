# -*- coding: utf-8 -*-
"""The Drag: PCL, Gregory Gym, the Texas Union, the Co-op and the Guadalupe streetwall.

WHY THIS EXISTS
---------------
Five buildings that carry the student half of campus were all wearing a facade
chosen by HEIGHT alone (js/facades.js:familyFor). That gives:

  * PCL           15.8 m -> family `mh`, a punched-window grid at 20% glazing.
                  PCL is 1970s precast brutalism whose elevations are largely
                  BLIND, and the openings that exist are deep coffers reading
                  near-black. A regular window grid is the opposite of it.
  * Gregory Gym   20.0 m -> `mh` again, and a baked wall colour of #a05b45,
                  which is a dark red-brown. Sampled off a sunlit photograph the
                  brick is #c28e64 — a light buff/tan Acme brick. Wrong hue,
                  wrong value.
  * Texas Union   11.9 m -> `mr`, a walk-up grid. It is cream limestone ashlar
                  with round-arched ground-floor openings under a red tile roof.
  * The Co-op and the twenty small shops on Guadalupe, 5.1-13.7 m -> `mr`/`lo`,
                  i.e. RESIDENTIAL-looking punched windows on the ground floor
                  of a bookstore. A shopfront is one tall glass band with a
                  solid bulkhead under it and a sign band over it, and that is
                  not expressible as a wall pattern at all (below).

THE VERTICAL-ANCHOR PROBLEM, and the two rules that fall out of it
------------------------------------------------------------------
`fill-extrusion-pattern` is TILE-locked: a 64 px repeat covers ~30 m of wall at
tile zoom 17 and ~59 m at 16, and it has no idea where the top or the bottom of
the building is. So:

  RULE 1  Every vertical event is GEOMETRY. Shopfront, sign band, upper floors,
          parapet, cornice, coffer rows: each is its own feature with its own
          `base` and `h`. This is bake_stadium.py's BANDS list, applied per
          building type. It is most of this file.

  RULE 2  Every tile is STATIONARY IN Y — invariant under vertical translation.
          A band here is 1-9 m tall while the tile spans 30-59 m, so a band
          shows an arbitrary horizontal SLICE of its tile whose position moves
          with zoom. Anything with vertical structure (an arch head, a sill, a
          cornice) would therefore appear at a different height at every zoom
          and at a different height on every building. Piers, mullions, fins and
          reveals are vertical, so they survive; arch heads and window heads do
          not, and are not drawn. See the same argument in js/facades.js's
          header for why brick coursing is not drawable either.

The tiles themselves live in js/drag.js. This file only decides WHERE the bands
are and WHAT MATERIAL each one is.

THE SHARED DATUM
----------------
What sells Guadalupe is not any one shopfront, it is the CONTINUITY: a run of
twenty different small buildings whose shopfronts all top out at the same height
and whose parapets do not. So SHOP_DATUM is an absolute 4.3 m for every building
on the street, clamped to 0.72 of the building's own height for the three that
are too short to reach it — and the parapet comes off each building's own baked
height, which varies from 5.1 m to 16.4 m.

HEIGHTS: what is kept and what is overridden
--------------------------------------------
Kept, deliberately. `data/roofs.geojson` already lands Gregory's and the Union's
pitched tile roofs at 21.0 m and 12.9 m, which are exactly
`h + max(1.0, 0.015h)` — js/app.js's parapet-cap rule — on their baked heights
of 20.0 and 11.9. Changing either height would leave those 248 roof facets
floating or buried. So this file emits bands that sum to the baked height and a
cap that reproduces app.js's rule exactly.

Overridden, once. PCL is baked at 15.8 m over a 6,987 m2 footprint. The UT
Building Inventory gives it 7 floors and 491,578 gross sq ft; 491,578 sq ft over
that footprint is 6.5 floors, and 15.8 m over 7 floors would be 2.3 m of
floor-to-floor. The photographs (Wikimedia `University of Texas at Austin August
2019 28`) show six rows of coffers plus a blank parapet band above them. So PCL
is emitted at 27.5 m: six 3.2 m storeys on a 5.0 m base with a 3.3 m crown. The
30 rooftop mechanical units data/roofscape.detail.geojson places at 17.1 m end
up inside the mass and stop being visible. That is the accepted cost, and it is
recorded here rather than discovered later.

Usage:  python scripts/bake_drag.py
"""
import json
import math
import os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP = os.path.join(ROOT, "data", "snapshots", "2026-07-30", "buildings.detailed.geojson")
OUT = os.path.join(ROOT, "data", "drag.geojson")
M_LAT = 111320.0

# ── Taste block. Every value here is a one-line override. ─────────────

# The five named buildings, by the `id` they carry in the snapshot.
PCL_ID = "04ac46be-ba31-4ff5-ab58-e36988f6a5fb"
GYM_ID = "1bb698db-9765-47b4-8f32-a428eefce38a"
UNION_ID = "8a2648f5-9994-4d01-9b12-5c589b863c5a"
COOP_ID = "f1ef97ab-a5c5-4802-abed-826edcec874d"

PCL_HEIGHT = 27.5        # see the header. The baked 15.8 is rejected.
PCL_STOREYS = 6          # coffer rows counted off the photograph
PCL_BASE_H = 5.0         # plaza level, which the mass overhangs
PCL_CROWN_H = 3.3        # blank parapet band above the top coffer row
PCL_SPANDREL = 1.05      # of each 3.2 m storey; the rest is the coffer
PCL_COFFER_INSET = 0.7   # how far the glazed plane sits behind the outer wall

SHOP_DATUM = 4.3         # metres. The line the whole street shares.
SHOP_MAX_FRAC = 0.72     # ... unless the building is too short to carry it
SIGN_H = 1.05            # the fascia/sign band directly over the glass
SIGN_MAX_FRAC = 0.88
MIN_BAND = 0.5           # thinner than this and a band is merged away
PARAPET_MIN = 0.75
PARAPET_FRAC = 0.055

# Guadalupe Street's centreline, sampled from OSM (`way[highway][name=Guadalupe
# Street]`, queried 2026-07-31) and reduced to one (lat, lon) per 0.0005 deg.
# Embedded rather than fetched so the bake is deterministic and offline.
GUADALUPE = [
    (30.28200, -97.74210), (30.28300, -97.74202), (30.28400, -97.74192),
    (30.28500, -97.74182), (30.28600, -97.74173), (30.28700, -97.74165),
    (30.28800, -97.74156), (30.28900, -97.74147),
]
# The two cross streets that bound the run, measured where they meet the
# centreline above: W 21st at 30.28379, W 24th at 30.28769. Widened by half a
# lot each way so a corner building is not cut in half.
DRAG_LAT_MIN = 30.28360
DRAG_LAT_MAX = 30.28775
DRAG_WEST_MAX = 55.0     # m west of the centreline a centroid may sit
DRAG_FRONT_MAX = 22.0    # m: the nearest vertex must hold the building line
DRAG_AREA_MAX = 1500.0   # m2
DRAG_HEIGHT_MAX = 20.0   # m
# Classes that are physically on the streetwall but are not shops. Saint Austin
# Catholic School (2026 Guadalupe, 6 levels) and University Baptist Church
# (2130 Guadalupe) would both get a plate-glass shopfront under the rule above,
# which is worse than leaving them generic.
DRAG_SKIP_CLASSES = ("church", "school", "university", "parking", "roof",
                     "apartments", "residential", "dormitory", "hotel")

# ── Materials ─────────────────────────────────────────────────────────
# Day hexes, and where each came from. `S` = sampled off a photograph's pixels
# and corrected for that photograph's light; `A` = authored.
#
#   lime    PCL. Sampled #a8a19a from an OVERCAST photograph (pcl_b), so it is
#           lifted ~1.10 toward what direct sun gives, matching the convention
#           the city bake uses for its own `wd`.                            [S]
#   brick   Gregory Gym, sampled #c28e64 off a sunlit photograph (gre_d) and
#           taken down 5% the way the Union's sampled #f0e6de sits 6% above its
#           own baked #e4dabf. The baked #a05b45 it replaces is a dark
#           red-brown and is simply the wrong brick.                        [S]
#   cstone  Gregory's cast stone: coping, the corbel table, the base. Sampled
#           #afa899 in sun.                                                 [S]
#   ashlar  Texas Union limestone, sampled #f0e6de in sun (unb_b) against the
#           baked #e4dabf; split the difference.                            [S]
#   glass   shopfront glazing. Drawn, not filled — see js/drag.js.          [A]
#   sign    the fascia band over a shopfront. Dark, so lit signage reads.   [A]
#   r0..r3  the four upper-floor tones of the streetwall. GENERATIVE: the
#           night reference (Wikimedia `The drag, austin, texas`) fixes the
#           range — warm stucco, cream stucco, painted brick, grey paint — but
#           not any one building's hex.                                     [A]
#
# ENTERED COOL, ON PURPOSE, AND THIS IS MEASURED. The renderer's sun tint lands
# on every wall: the first cut of PCL used its sampled #b8b0a5 (R/B 1.11) and
# rendered at **R/B 1.75** — warmer than the tan brick building next door, which
# renders at 1.41. PCL is a grey precast box and should be the COOLEST large
# mass on that block, so `lime` is entered well cool of the sample to land near
# neutral. Same correction js/app.js documents for the stadium's seating decks
# ("an input of R/B 1.18 renders at 1.85"), for the same reason.
MATERIALS = {
    "lime":   "#adb0af",   # sampled #a8a19a; see the note above
    "limeD":  "#999c9c",   # PCL base, in the shadow of its own overhang
    "brick":  "#b98a62",
    "cstone": "#b3ab9c",
    "ashlar": "#e6ded0",
    "sign":   "#4a4038",
    "coop":   "#cbbda6",
    # The four streetwall tones. Spread by VALUE as well as hue: the first cut
    # was #c4b49c / #d8cfbc / #9a6a55 / #b0aaa2, and three of those four sit
    # within 0.1 of each other in luminance — so a run of twenty buildings that
    # is supposed to read as twenty different owners read as one long cream
    # wall. r3 is now a dark painted grey and r1 a paler cream.
    "r0":     "#c4b49c",   # warm tan stucco
    "r1":     "#ded5c2",   # pale cream stucco
    "r2":     "#9a6a55",   # red-brown brick
    "r3":     "#8f8c86",   # dark painted grey
}
RETAIL_TONES = ["r0", "r1", "r2", "r3"]

# Roof / parapet tones. An extrusion's TOP face picks up the sun tint (an input
# of R/B 1.18 rendered at 1.85 — see js/app.js's SEAT_COL note), so these are
# entered COOL of where they should land.
# MEASURED, not guessed: the first cut used #a9a6a2 for PCL's roof (R/B 1.04,
# luma 167) and it rendered at **#f2cea0 — R/B 1.51, luma 211**, the brightest
# and warmest large surface in the frame, against a comparable concrete roof
# next door at 1.19 / 173. So these are entered roughly 0.75x in value and
# distinctly cool, to land where a flat concrete or gravel roof belongs.
CAP_COL = {
    "pcl":   "#7f868c",
    "gym":   "#7a736a",
    "union": "#8c877c",
    "coop":  "#7f8084",
    "shop":  "#7a7c80",
}


def wall_ramp(hex_col):
    """day -> (golden, night), the same relationship bake_stadium.py uses.

    Carried per feature so js/drag.js can ride the day/golden/night ramp with
    the rest of the city instead of inventing a second dusk.
    """
    c = [int(hex_col[i:i + 2], 16) for i in (1, 3, 5)]
    mixc = lambda a, b, t: [a[i] + (b[i] - a[i]) * t for i in range(3)]
    golden = mixc(c, [255, 190, 130], 0.16)
    night = mixc([v * 0.19 for v in c], [18, 22, 40], 0.42)
    hexify = lambda v: "#" + "".join("%02x" % max(0, min(255, int(round(x)))) for x in v)
    return hexify(golden), hexify(night)


TRIO = {k: (v,) + wall_ramp(v) for k, v in MATERIALS.items()}
CAP_TRIO = {k: (v,) + wall_ramp(v) for k, v in CAP_COL.items()}


# ── geometry helpers (same primitives as bake_stadium.py) ─────────────
def signed_area(pts):
    a = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        a += x0 * y1 - x1 * y0
    return a * 0.5


def ccw(pts):
    p = pts[:-1] if pts[0] == pts[-1] else pts[:]
    if signed_area(p + [p[0]]) < 0:
        p = p[::-1]
    return p


def offset(pts, d):
    """Offset a closed ring by d metres; POSITIVE grows it. None if degenerate."""
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
        nx, ny = dy / L, -dx / L
        lines.append((x0 + nx * d, y0 + ny * d, dx, dy))
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
    if signed_area(ring) <= 1.0:
        return None
    return ring


def to_m(ring, lat0):
    k = math.cos(math.radians(lat0))
    return [(p[0] * M_LAT * k, p[1] * M_LAT) for p in ring]


def to_ll(pts, lat0):
    k = math.cos(math.radians(lat0))
    ring = list(pts)
    if ring[0] != ring[-1]:
        ring = ring + [ring[0]]
    return [[round(x / (M_LAT * k), 7), round(y / M_LAT, 7)] for (x, y) in ring]


def outer_ring(geom):
    return geom["coordinates"][0] if geom["type"] == "Polygon" else geom["coordinates"][0][0]


def ring_area_m2(ring):
    lat0 = sum(q[1] for q in ring) / len(ring)
    return abs(signed_area(to_m(ring, lat0) + [to_m(ring, lat0)[0]]))


def centroid_ll(ring):
    return (sum(q[0] for q in ring) / len(ring), sum(q[1] for q in ring) / len(ring))


def guad_lon(lat):
    """Guadalupe's centreline longitude at a latitude, linearly interpolated."""
    if lat <= GUADALUPE[0][0]:
        return GUADALUPE[0][1]
    if lat >= GUADALUPE[-1][0]:
        return GUADALUPE[-1][1]
    for (la0, lo0), (la1, lo1) in zip(GUADALUPE, GUADALUPE[1:]):
        if la0 <= lat <= la1:
            t = (lat - la0) / (la1 - la0)
            return lo0 + t * (lo1 - lo0)
    return GUADALUPE[-1][1]


def west_of_guadalupe_m(lon, lat):
    """Metres WEST of the centreline. Negative means the campus side."""
    k = math.cos(math.radians(lat)) * M_LAT
    return (guad_lon(lat) - lon) * k


# ── selection ─────────────────────────────────────────────────────────
def is_streetwall(props, ring):
    """The geometric rule for 'a small building holding the Guadalupe building
    line between 21st and 24th'. Written as a rule rather than a list of ids so
    a later snapshot cannot silently drop a shop out of the run."""
    cls = (props.get("building_class") or "").lower()
    if any(c in cls for c in DRAG_SKIP_CLASSES):
        return False
    h = props.get("final_height") or 0
    if h < 2.5 or h > DRAG_HEIGHT_MAX:
        return False
    cx, cy = centroid_ll(ring)
    if not (DRAG_LAT_MIN <= cy <= DRAG_LAT_MAX):
        return False
    w = west_of_guadalupe_m(cx, cy)
    if not (0 < w <= DRAG_WEST_MAX):
        return False
    front = min(west_of_guadalupe_m(q[0], q[1]) for q in ring)
    if front > DRAG_FRONT_MAX:
        return False
    if ring_area_m2(ring) > DRAG_AREA_MAX:
        return False
    return True


def tone_for(bid):
    """A stable per-building upper-floor tone. Hash of the id, so the run varies
    the way a real street does and does not reshuffle between bakes."""
    hv = 0
    for ch in bid:
        hv = (hv * 131 + ord(ch)) & 0xFFFFFFFF
    return RETAIL_TONES[hv % len(RETAIL_TONES)]


# ── emission ──────────────────────────────────────────────────────────
def cap_top(h):
    """js/app.js's parapet rule, reproduced exactly. data/roofs.geojson lands
    the Union's and Gregory's tile roofs on the value this returns."""
    return h + max(1.0, 0.015 * h)


def band(ring_ll, grp, name, fam, mat, base, top, extra=None):
    wd, wg, wn = TRIO[mat]
    pr = {"kind": "wall", "grp": grp, "band": name, "fam": fam, "mat": mat,
          "wd": wd, "wg": wg, "wn": wn,
          "base": round(base, 2), "h": round(top, 2)}
    if extra:
        pr.update(extra)
    return {"type": "Feature", "properties": pr,
            "geometry": {"type": "Polygon", "coordinates": [ring_ll]}}


def cap(ring_ll, grp, base, wall_top):
    """The parapet.

    `base` is where the coping starts and it must be >= the top of the wall band
    under it. It used to be `wall_top - 0.9`, which made the cap's side faces
    EXACTLY COPLANAR with the wall's over a 0.9 m strip — textbook z-fighting,
    decided by depth-buffer rounding, so it flips as the camera moves and shows
    up worst on a phone's 16-bit depth buffer. js/app.js hit exactly this and
    moved its cap to sit ON the wall rather than inside it; the same rule applies
    here. On the retail buildings the wall genuinely stops at `base` and the cap
    IS the parapet; on the four named buildings the cap is just the 1 m lip.
    """
    wd, wg, wn = CAP_TRIO[grp]
    return {"type": "Feature",
            "properties": {"kind": "cap", "grp": grp,
                           "wd": wd, "wg": wg, "wn": wn,
                           "base": round(base, 2),
                           "h": round(cap_top(wall_top), 2)},
            "geometry": {"type": "Polygon", "coordinates": [ring_ll]}}


def build_pcl(ring, lat0, stats):
    """PCL: a coffered precast box. Base, six storeys, crown.

    Each storey is TWO features: a full-footprint spandrel and a window band set
    PCL_COFFER_INSET behind it. That inset is the whole point — PCL's glass sits
    at the back of a deep rectangular coffer, and the only way a flat extrusion
    can say 'deep' is to actually move the plane back. It also means the coffer
    band's silhouette notches in at every corner, which is what reads from a
    flying camera.
    """
    m = ccw(to_m(ring, lat0))
    full = to_ll(m, lat0)
    inset = offset(m + [m[0]], -PCL_COFFER_INSET)
    coffer_ring = to_ll(ccw(inset), lat0) if inset else full
    if inset is None:
        stats["pcl_inset_failed"] += 1
    base_inset = offset(m + [m[0]], -1.0)
    base_ring = to_ll(ccw(base_inset), lat0) if base_inset else full

    H = PCL_HEIGHT
    shaft_top = H - PCL_CROWN_H
    storey = (shaft_top - PCL_BASE_H) / PCL_STOREYS
    out = [band(base_ring, "pcl", "base", "pclSolid", "limeD", 0.0, PCL_BASE_H)]
    y = PCL_BASE_H
    for i in range(PCL_STOREYS):
        out.append(band(full, "pcl", "spandrel", "pclSolid", "lime", y, y + PCL_SPANDREL))
        out.append(band(coffer_ring, "pcl", "coffer", "pclCoffer", "lime",
                        y + PCL_SPANDREL, y + storey))
        y += storey
    out.append(band(full, "pcl", "crown", "pclSolid", "lime", shaft_top, H))
    out.append(cap(full, "pcl", H, H))
    return out


def build_gym(ring, lat0, H):
    """Gregory Gym, 1930, Herbert M. Greene. Buff brick and cast stone.

    Four bands, and the middle one is the building: a run of very tall
    round-arched openings between broad brick piers. The arch HEADS are not
    drawn — see RULE 2 — but at 0.5 m per pixel an arcade reads as light piers
    against dark voids anyway, which is exactly what the tile does.
    """
    full = to_ll(ccw(to_m(ring, lat0)), lat0)
    f = lambda a, b: (H * a, H * b)
    b0, b1 = f(0.00, 0.18)
    a0, a1 = f(0.18, 0.63)
    r0, r1 = f(0.63, 0.84)
    g0, g1 = f(0.84, 1.00)
    return [
        band(full, "gym", "plinth", "gymSolid", "cstone", b0, b1),
        band(full, "gym", "arcade", "gymArcade", "brick", a0, a1),
        band(full, "gym", "frieze", "gymFrieze", "brick", r0, r1),
        band(full, "gym", "gable", "gymSolid", "cstone", g0, g1),
        cap(full, "gym", H, H),
    ]


def build_union(ring, lat0, H):
    """The Texas Union, 1933, Paul Cret. Cream limestone ashlar, NOT brick.

    Ground floor is a run of round-arched windows; the floors above are punched
    rectangles in plain ashlar; the top band is the deep frieze the tile roof's
    overhanging eave sits on. The tile roof itself is data/roofs.geojson's, and
    it lands on cap_top(11.9) = 12.9 — which is why this must not change H.
    """
    full = to_ll(ccw(to_m(ring, lat0)), lat0)
    f = lambda a, b: (H * a, H * b)
    return [
        band(full, "union", "arcade", "uniArcade", "ashlar", *f(0.00, 0.34)),
        band(full, "union", "mid", "uniWin", "ashlar", *f(0.34, 0.78)),
        band(full, "union", "cornice", "uniSolid", "ashlar", *f(0.78, 1.00)),
        cap(full, "union", H, H),
    ]


def retail_bands(ring, lat0, H, grp, upper_mat, stats):
    """The shopfront scheme: glass, sign band, upper, parapet.

    A three-storey building is almost entirely ground floor, so this is the band
    split that matters most in the whole pass. SHOP_DATUM is absolute so the
    run shares one line; the parapet comes off each building's own height so the
    skyline of the street does not.
    """
    full = to_ll(ccw(to_m(ring, lat0)), lat0)
    shop_top = min(SHOP_DATUM, SHOP_MAX_FRAC * H)
    sign_top = min(shop_top + SIGN_H, SIGN_MAX_FRAC * H)
    para_bot = max(sign_top, H - max(PARAPET_MIN, PARAPET_FRAC * H))
    out = [band(full, grp, "shop", "shopGlass", "sign", 0.0, shop_top)]
    if para_bot - sign_top < MIN_BAND:
        # No room for an upper floor: the sign band runs to the parapet. This is
        # the one-storey end of the street (Shoe Palace, Potbelly) and it is
        # correct — those buildings really are a shopfront and a fascia.
        out.append(band(full, grp, "sign", "signBand", "sign", shop_top, para_bot))
        stats["retail_no_upper"] += 1
    else:
        out.append(band(full, grp, "sign", "signBand", "sign", shop_top, sign_top))
        out.append(band(full, grp, "upper", "retUpper", upper_mat, sign_top, para_bot))
    out.append(cap(full, grp, para_bot, H))
    return out


def build_coop(ring, lat0, H, stats):
    """The University Co-op, 2246 Guadalupe. The anchor of the streetwall: same
    datum, same sign band, but three storeys of store above it rather than one,
    and its own warmer tone."""
    return retail_bands(ring, lat0, H, "coop", "coop", stats)


# ── the bake ──────────────────────────────────────────────────────────
def main():
    feats = json.load(open(SNAP, encoding="utf-8"))["features"]
    by_id = {}
    for f in feats:
        bid = (f.get("properties") or {}).get("id")
        if bid:
            by_id[bid] = f

    out, replaced, report = [], [], []
    stats = Counter()

    def emit(f, made, label):
        # `bid` is not a paint property. It is what lets drag-check.mjs group a
        # building's bands back together and assert that they tile its height
        # with no gap and no overlap — a gap is a stripe of sky through the
        # middle of a building, an overlap is z-fighting, and both look like
        # nothing at all in a still.
        bid = f["properties"]["id"]
        for m in made:
            m["properties"]["bid"] = bid
        out.extend(made)
        replaced.append(bid)
        report.append((label, f["properties"].get("final_height") or 0, len(made)))

    # 1. the four named buildings ---------------------------------------
    for bid, kind in ((PCL_ID, "pcl"), (GYM_ID, "gym"),
                      (UNION_ID, "union"), (COOP_ID, "coop")):
        f = by_id.get(bid)
        if f is None:
            stats["named_missing"] += 1
            print("  MISSING", kind, bid)
            continue
        ring = outer_ring(f["geometry"])
        lat0 = sum(q[1] for q in ring) / len(ring)
        H = f["properties"].get("final_height") or 0
        if kind == "pcl":
            made = build_pcl(ring, lat0, stats)
        elif kind == "gym":
            made = build_gym(ring, lat0, H)
        elif kind == "union":
            made = build_union(ring, lat0, H)
        else:
            made = build_coop(ring, lat0, H, stats)
        emit(f, made, "%s (%s)" % (f["properties"].get("name") or kind, kind))
        stats["named"] += 1

    named = {PCL_ID, GYM_ID, UNION_ID, COOP_ID}

    # 2. the streetwall --------------------------------------------------
    picked = []
    for f in feats:
        p = f["properties"]
        bid = p.get("id")
        if not bid or bid in named:
            continue
        g = f["geometry"]
        if g["type"] not in ("Polygon", "MultiPolygon"):
            continue
        ring = outer_ring(g)
        if not is_streetwall(p, ring):
            continue
        picked.append(f)
    picked.sort(key=lambda f: centroid_ll(outer_ring(f["geometry"]))[1])
    for f in picked:
        p = f["properties"]
        ring = outer_ring(f["geometry"])
        lat0 = sum(q[1] for q in ring) / len(ring)
        made = retail_bands(ring, lat0, p["final_height"], "shop",
                            tone_for(p["id"]), stats)
        emit(f, made, "  %-26s %5.1f m" % ((p.get("name") or "(unnamed)")[:26],
                                           p["final_height"]))
        stats["streetwall"] += 1

    # Nothing here may claim a building another pass has already replaced.
    clash = []
    for other in ("stadium", "tower", "westcampus", "arts", "moody"):
        path = os.path.join(ROOT, "data", other + ".geojson")
        if not os.path.exists(path):
            continue
        try:
            ids = set(json.load(open(path, encoding="utf-8")).get("replacedBuildingIds") or [])
        except Exception:
            continue
        hit = sorted(ids & set(replaced))
        if hit:
            clash.append({"file": other + ".geojson", "ids": hit})

    # PCL only. Every other building in this pass is redrawn at the height the
    # snapshot gives it and capped at h + the shared parapet lift, so the
    # generic deck and clutter bake_roofscape.py puts on it lands exactly on
    # that cap — which is correct and is most of the Drag's rooftop interest.
    # PCL is the exception: its baked 15.8 m is rejected in favour of a
    # photographed 27.5 m, so the roofscape's deck and 33 clutter features sit
    # 11.7 m down inside the library, invisible and paid for on every frame.
    # Declaring it here is what lets the roof bake skip it.
    fc = {"type": "FeatureCollection", "features": out,
          "replacedBuildingIds": replaced,
          "authoredRoofIds": [PCL_ID]}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(fc, fh, separators=(",", ":"))

    for label, h, n in report:
        print("  %-40s h=%5.1f -> %2d features" % (label[:40], h, n))
    print(json.dumps({
        "features": len(out),
        "replaced_building_ids": len(replaced),
        "file_kb": round(os.path.getsize(OUT) / 1024, 1),
        "counts": dict(sorted(stats.items())),
        "collisions_with_other_passes": clash,
        "materials": {k: list(v) for k, v in sorted(TRIO.items())},
        "provenance": {
            "footprints": "factual - the snapshot's own rings, offset inward only for PCL's coffer and base",
            "streetwall_selection": "factual - geometric, against Guadalupe's OSM centreline and the W21st/W24th crossings",
            "gregory_brick": "SOURCED - #c28e64 sampled off a sunlit photograph, replacing the baked #a05b45",
            "union_limestone": "SOURCED - #f0e6de sampled in sun, split with the baked #e4dabf",
            "pcl_limestone": "SOURCED - #a8a19a sampled under overcast, lifted to direct sun",
            "pcl_height": "DERIVED - 27.5 m from 6 photographed coffer rows; the baked 15.8 m is rejected",
            "gym_union_heights": "factual - kept at the baked values so data/roofs.geojson's tile roofs still land",
            "band_fractions": "GENERATIVE - proportions read off elevations, not measured drawings",
            "retail_upper_tones": "GENERATIVE - the range is from the street, the per-building pick is a hash",
        },
    }, indent=2))


if __name__ == "__main__":
    main()
