# -*- coding: utf-8 -*-
"""Turn the stadium footprint into an open BOWL instead of a flat-topped mesa.

THE PROBLEM, measured. DKR's footprint in Overture is one polygon: a 236 x 232 m
outer ring with a 78 x 128 m hole for the field. Extruded to its 63 m height that
is a solid mesa covering **82% of the footprint area**, with a small pit in it.
The nadir render against `data/dkr_aerial.png` makes the error obvious: in the
photograph almost that entire 82% is open seating deck — bright silver-grey, the
LIGHTEST large surface anywhere in the frame (sampled luma 152-178, against 133
for street asphalt and 45 for a campus roof). We were drawing it as a dark brown
lid. From the air the stadium read as a parking garage.

The first version of this script did put tiers in, but it sized them with a
single uniform offset of the hole, binary-searched to fit inside the outer ring.
That search is limited by the TIGHTEST side — the south gap is 31.8 m while the
west gap is 85.2 m — so every tier stopped 30 m from the field and the remaining
55 m of the west side stayed mesa. Uniform offsets cannot describe this shape.

WHAT THIS DOES NOW.

  1. WALL — the outer ring with an inset inner ring, so the building's own
     extrusion becomes a thin perimeter wall instead of a solid lid. Emitted in
     SEGMENTS (north / south / east / west) so each elevation can carry its own
     facade: the west side is Bellmont Hall, a real academic block with real
     windows under the 1972 fan-shaped upper deck; the north is the 2008 Red
     McCombs Red Zone, brick veneer over block with circulation towers.
  2. SEATING — bands that span the WHOLE ring, built by interpolating radially
     between the field hole and the wall's inner face, so each band is as wide as
     that side of the stadium actually is. Two decks with a concourse break
     between them, which is what makes a bowl read as a bowl and not a funnel.

  POSITION   — factual. Every ring is the real footprint or a radial blend of the
               real footprint's own two rings. Side assignment comes from the
               field's own long axis, not from compass north.
  HEIGHTS    — GENERATIVE. No public source gives per-deck elevations; the
               fractions below descend from the height the data already carries.
  BAND COUNT — generative (a stepped approximation of a rake; fill-extrusion has
               no sloped faces).

Usage:  python scripts/bake_stadium.py
"""
import json
import math
import os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP = os.path.join(ROOT, "data", "snapshots", "2026-07-30", "buildings.detailed.geojson")
OUT = os.path.join(ROOT, "data", "stadium.geojson")
M_LAT = 111320.0

# ── Taste block. Every value here is a one-line override. ─────────────
WALL_THICK_M = 7.0       # depth of the perimeter wall band
DECK_TOP_FRAC = 0.93     # top of the upper deck, as a fraction of wall height
UPPER_FOOT_FRAC = 0.50   # where the upper deck starts, ditto
LOWER_TOP_FRAC = 0.40    # top of the lower bowl
FIELD_EDGE_M = 3.0       # deck height right at the field wall, metres
LOWER_T = 0.52           # radial fraction where the lower bowl ends
CONCOURSE_T = 0.60       # ... and where the upper deck begins. Between the two
                         #     is the concourse: flat, and a touch darker.
LOWER_TIERS = 6          # steps approximating the lower rake
UPPER_TIERS = 6          # ... and the upper
RAKE_GAMMA = 1.35        # >1 = steeper near the top, which is how a bowl rakes
STADIUM_CLASSES = ("stadium", "arena", "grandstand")

# Which side of the bowl each wall segment belongs to. Sectors are measured from
# the FIELD's long axis, so a stadium that does not sit square to north still
# gets its end zones called ends. Half-width in degrees for the two end sectors.
END_SECTOR_DEG = 52.0

# ── The elevations, and why they differ ───────────────────────────────
# A stadium wall is not one material from grade to rim, and DKR's four sides
# are four different buildings from four different decades. The facade tile
# repeats every ~20 m VERTICALLY (fill-extrusion-pattern tiles in world space),
# so a single wall feature can never express that — one 63 m extrusion wearing
# one tile is exactly the "big repetitive window pattern" this is fixing. Each
# side is therefore emitted as STACKED BANDS, each its own feature with its own
# base, height, pattern family and colour.
#
#   plinth  the concourse arcade you walk past: massive piers, deep dark
#           portals. Present on all four sides.
#   mid     the building proper — this is where the sides diverge.
#   fascia  the back of the upper deck: a big blank raking concrete wall. It is
#           the single most important band, because it is what stops the
#           window grid from marching all the way to the roofline.
#
# WEST is Bellmont Hall — an eleven-level building constructed in 1972 INSIDE
#      the support structure of the west upper deck, housing athletics offices,
#      lecture halls and Kinesiology. It genuinely has windows; the office-block
#      look was not wrong here, it was wrong everywhere else and wrong above it.
# NORTH is the 2008 Red McCombs Red Zone: brick veneer over reinforced block,
#      with towers marking the vertical circulation.
# EAST  is grandstand back — cast-in-place concrete, repainted/sealed after the
#      2012-13 waterproofing project. Very little glazing.
# SOUTH is the 2021 south end zone addition (Populous / Hensel Phelps), the
#      project that first fully enclosed the bowl: club and suite levels, so
#      modern horizontal glazing rather than concrete.
#
# The MATERIAL of each side is sourced. The exact hex is authored — nadir
# imagery cannot see a facade, so there was nothing to sample.
# The mid band ends at 0.66 of the wall — 41.6 m, which is eleven levels at a
# 3.8 m academic floor-to-floor. That is not a chosen number: Bellmont Hall IS
# eleven levels, and the upper deck sits on its roof.
BANDS = [
    # name,     from,  to     (fractions of the wall height)
    ("plinth",  0.00, 0.15),
    ("mid",     0.15, 0.66),
    ("fascia",  0.66, 1.00),
]
PLINTH_FAM, PLINTH_COL = "sp", "#b3ada1"
FASCIA_FAM, FASCIA_COL = "sd", "#bab5a9"
SIDE_MID = {
    "W": ("sb", "#c0bab0"),   # Bellmont Hall, painted concrete
    "N": ("sn", "#8f6b58"),   # 2008 brick veneer
    "E": ("sf", "#b9b3a7"),   # painted cast-in-place concrete
    "S": ("sg", "#adb0b2"),   # 2021 club/suite glazing
}


def wall_ramp(hex_col):
    """day -> (golden, night) using the same relationship the city bake uses.

    Checked against DKR's own baked trio: #b7b1a6 -> #c3b19c / #1e2029. These
    colours must NOT be snapped to the city's shared palette — the 2008 north
    end zone is brick, and nearest-RGB against fourteen mostly-tan buckets
    quietly turned it back into tan. facades.js gives the stadium its own
    palette entries, which is why the trio has to be carried here.
    """
    c = [int(hex_col[i:i + 2], 16) for i in (1, 3, 5)]
    mixc = lambda a, b, t: [a[i] + (b[i] - a[i]) * t for i in range(3)]
    golden = mixc(c, [255, 190, 130], 0.16)
    night = mixc([v * 0.19 for v in c], [18, 22, 40], 0.42)
    hexify = lambda v: "#" + "".join("%02x" % max(0, min(255, int(round(x)))) for x in v)
    return hexify(golden), hexify(night)


# ── geometry helpers ──────────────────────────────────────────────────
def signed_area(pts):
    a = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        a += x0 * y1 - x1 * y0
    return a * 0.5


def ccw(pts):
    """Closed ring, counter-clockwise, without the repeated last point."""
    p = pts[:-1] if pts[0] == pts[-1] else pts[:]
    if signed_area(p + [p[0]]) < 0:
        p = p[::-1]
    return p


def offset(pts, d):
    """Offset a closed ring by d metres. POSITIVE d grows the ring outward.

    Edge offset plus consecutive-line intersection. Returns None if the result
    degenerates, which is the right answer for an offset larger than the shape.
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
        nx, ny = dy / L, -dx / L          # outward normal for a CCW ring
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


def centroid(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def ray_hit(c, ang, ring):
    """Where a ray from c at angle `ang` leaves `ring`. Both are in metres.

    The seating bands need a point on the field hole that CORRESPONDS to each
    vertex of the wall, so a band can be a blend of the two. A ray from the
    centre gives that correspondence for any two rings that are star-shaped
    about it, which both of these are — and unlike a uniform offset it keeps the
    real per-side widths (85 m west, 32 m south).
    """
    dx, dy = math.cos(ang), math.sin(ang)
    best = None
    n = len(ring)
    for i in range(n):
        x0, y0 = ring[i]
        x1, y1 = ring[(i + 1) % n]
        ex, ey = x1 - x0, y1 - y0
        den = dx * ey - dy * ex
        if abs(den) < 1e-12:
            continue
        # c + t*d = p0 + u*e
        t = ((x0 - c[0]) * ey - (y0 - c[1]) * ex) / den
        u = ((x0 - c[0]) * dy - (y0 - c[1]) * dx) / den
        if t > 0 and -1e-9 <= u <= 1 + 1e-9:
            if best is None or t < best:
                best = t
    if best is None:
        return None
    return (c[0] + dx * best, c[1] + dy * best)


def long_axis(ring):
    """Angle of the ring's longest diameter. For a football hole that is the
    axis the field runs along, which is what 'end zone' means."""
    best, bang = -1.0, 0.0
    n = len(ring)
    for i in range(n):
        for j in range(i + 1, n):
            dx = ring[j][0] - ring[i][0]
            dy = ring[j][1] - ring[i][1]
            d = dx * dx + dy * dy
            if d > best:
                best, bang = d, math.atan2(dy, dx)
    # The longest diameter is found between an arbitrary PAIR, so its direction
    # is arbitrary too — and the first run labelled the south end "N" for
    # exactly that reason. Point it north so the side names mean what they say.
    if math.sin(bang) < 0:
        bang += math.pi
    return bang


def deck_height(t, h):
    """Height of the deck at radial fraction t (0 = field, 1 = wall).

    Piecewise so the bowl has the two-deck-plus-concourse profile a real one
    has. A single smooth ramp reads as a funnel; the flat concourse and the
    riser above it are what make it read as a stadium.
    """
    lo_top = LOWER_TOP_FRAC * h
    up_foot = UPPER_FOOT_FRAC * h
    up_top = DECK_TOP_FRAC * h
    if t <= LOWER_T:
        f = (t / LOWER_T) ** RAKE_GAMMA
        return FIELD_EDGE_M + (lo_top - FIELD_EDGE_M) * f
    if t <= CONCOURSE_T:
        return lo_top
    f = ((t - CONCOURSE_T) / (1.0 - CONCOURSE_T)) ** RAKE_GAMMA
    return up_foot + (up_top - up_foot) * f


def band_fractions():
    """Radial cut points: lower rake, concourse, upper rake."""
    ts = [0.0]
    for i in range(1, LOWER_TIERS + 1):
        ts.append(LOWER_T * i / LOWER_TIERS)
    ts.append(CONCOURSE_T)
    for i in range(1, UPPER_TIERS + 1):
        ts.append(CONCOURSE_T + (1.0 - CONCOURSE_T) * i / UPPER_TIERS)
    return ts


def surface_for(t_outer):
    if t_outer <= LOWER_T + 1e-9:
        return "lower"
    if t_outer <= CONCOURSE_T + 1e-9:
        return "concourse"
    return "upper"


def side_for(ang, axis):
    """N / S / E / W relative to the field's own long axis."""
    d = math.degrees((ang - axis + math.pi) % (2 * math.pi) - math.pi)
    if abs(d) <= END_SECTOR_DEG:
        return "N"
    if abs(d) >= 180 - END_SECTOR_DEG:
        return "S"
    return "E" if d < 0 else "W"


# ── the bake ──────────────────────────────────────────────────────────
def build(feature, stats):
    p = feature["properties"]
    g = feature["geometry"]
    name = p.get("name") or "(unnamed)"
    h = p.get("final_height") or 0
    outer_ll, hole_ll = g["coordinates"][0], g["coordinates"][1]
    lat0 = sum(q[1] for q in outer_ll) / len(outer_ll)
    outer = ccw(to_m(outer_ll, lat0))
    hole = ccw(to_m(hole_ll, lat0))

    inner_ring = offset(outer + [outer[0]], -WALL_THICK_M)
    if inner_ring is None:
        stats["wall_offset_failed"] += 1
        return []
    inner = ccw(inner_ring)
    c = centroid(hole)
    axis = long_axis(hole)

    out = []
    # Colours ride along so the wall segments can be facade-patterned by the
    # same runtime quantiser that handles every other building.
    base_props = {k: p.get(k) for k in ("wd", "wg", "wn", "rd", "rg", "rn")}

    # 1. the perimeter wall, in per-side segments -----------------------
    runs, cur, cur_side = [], [], None
    n = len(inner)
    for i in range(n):
        a, b = inner[i], inner[(i + 1) % n]
        mid = ((a[0] + b[0]) / 2 - c[0], (a[1] + b[1]) / 2 - c[1])
        s = side_for(math.atan2(mid[1], mid[0]), axis)
        if s != cur_side and cur:
            runs.append((cur_side, cur))
            cur = [i]
        else:
            cur.append(i)
        cur_side = s
    if cur:
        runs.append((cur_side, cur))
    # A run can wrap the seam; merge first into last when they match.
    if len(runs) > 1 and runs[0][0] == runs[-1][0]:
        runs[-1] = (runs[-1][0], runs[-1][1] + runs[0][1])
        runs = runs[1:]

    for side, idxs in runs:
        if len(idxs) < 2:
            continue
        pts = [idxs[0]] + idxs[1:] + [(idxs[-1] + 1) % n]
        outer_seg = [outer[i] for i in pts]
        inner_seg = [inner[i] for i in pts]
        poly = outer_seg + inner_seg[::-1]
        if abs(signed_area(poly + [poly[0]])) < 5:
            continue
        ring = to_ll(poly, lat0)
        for bname, f0, f1 in BANDS:
            if bname == "plinth":
                fam, col = PLINTH_FAM, PLINTH_COL
            elif bname == "fascia":
                fam, col = FASCIA_FAM, FASCIA_COL
            else:
                fam, col = SIDE_MID.get(side, (PLINTH_FAM, PLINTH_COL))
            wg, wn = wall_ramp(col)
            pr = dict(base_props)
            pr.update({"kind": "wall", "side": side, "band": bname, "fam": fam,
                       "wd": col, "wg": wg, "wn": wn,
                       "h": round(h * f1, 2), "base": round(h * f0, 2),
                       "name": name, "building_class": "stadium", "final_height": h})
            out.append({"type": "Feature", "properties": pr,
                        "geometry": {"type": "Polygon", "coordinates": [ring]}})
            stats["wall_bands"] += 1
        stats["wall_segments"] += 1

    # 2. the seating bowl ----------------------------------------------
    # One ray per wall vertex, so the bands inherit the footprint's real shape.
    angs = [math.atan2(q[1] - c[1], q[0] - c[0]) for q in inner]
    pairs = []
    for a, q in zip(angs, inner):
        hp = ray_hit(c, a, hole)
        if hp is None:
            stats["ray_miss"] += 1
            hp = c
        pairs.append((hp, q))
    ring_at = lambda t: [(hp[0] + (wp[0] - hp[0]) * t, hp[1] + (wp[1] - hp[1]) * t)
                         for hp, wp in pairs]

    ts = band_fractions()
    for lo, hi in zip(ts, ts[1:]):
        if hi - lo < 1e-4:
            continue
        outer_b, inner_b = ring_at(hi), ring_at(lo)
        # ALWAYS punch the inner ring, including for the first band where it is
        # the field hole itself. Omitting it there makes band 0 a solid slab
        # over the turf — the field vanishes under the lowest row of seats, and
        # the bowl reads as a filled dish. (v1 of this script had the same bug.)
        coords = [to_ll(outer_b, lat0), to_ll(inner_b, lat0)]
        out.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": coords},
            "properties": {"kind": "seat", "s": surface_for(hi),
                           "h": round(deck_height(hi, h), 2), "name": name},
        })
        stats["seat_bands"] += 1
    return out


def main():
    feats = json.load(open(SNAP, encoding="utf-8"))["features"]
    out, replaced = [], []
    stats = Counter()
    for f in feats:
        p = f["properties"]
        cls = p.get("building_class") or ""
        if not any(k in cls for k in STADIUM_CLASSES):
            continue
        g = f["geometry"]
        if g["type"] != "Polygon" or len(g["coordinates"]) < 2:
            stats["skipped_no_hole"] += 1
            continue
        if (p.get("final_height") or 0) < 12:
            stats["skipped_low"] += 1
            continue
        made = build(f, stats)
        if not made:
            continue
        out.extend(made)
        # The building's own extrusion has to STOP being drawn, or its 63 m lid
        # buries every band underneath it. app.js filters these ids out.
        replaced.append(p.get("id"))
        stats["stadiums"] += 1
        print("  %-30s h=%5.1f  ->  %d features" % ((p.get("name") or "?")[:30],
                                                    p.get("final_height") or 0, len(made)))

    fc = {"type": "FeatureCollection", "features": out, "replacedBuildingIds": replaced}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(fc, fh, separators=(",", ":"))
    print(json.dumps({
        "features": len(out),
        "replaced_building_ids": replaced,
        "file_kb": round(os.path.getsize(OUT) / 1024, 1),
        "counts": dict(sorted(stats.items())),
        "provenance": {
            "rings": "factual - the footprint's own outer and inner rings, blended radially",
            "sides": "factual - sectors measured from the field hole's own long axis",
            "heights": "GENERATIVE - fractions of the height already in the data",
        },
    }, indent=2))


if __name__ == "__main__":
    main()
