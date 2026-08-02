# -*- coding: utf-8 -*-
"""Bake the cached OSM ground data (data/osm_cache/*.json) into render-ready
data/ground.geojson AND data/roads.geojson.

TRUTH RULE, which governs this whole file: every POSITION here comes from OSM.
Nothing is scattered, invented or nudged for looks. What is generative is FORM —
the drawn width of a path whose width OSM does not record, and the colour we
choose for a named surface. Those two are called out in the report this prints.

Emits per feature:
  k  kind      path | area
  s  surface   limestone | concrete | brick | asphalt | paving | gravel |
               grass | wood | water | track | sand | dirt
  u  use       what the thing IS (footway, steps, plaza, lawn, pitch, parking…)
  w  width_m   paths only; measured where tagged, else a default by use (form)
  wt tagged    1 if the width came from OSM, 0 if it is our default

Usage:  python scripts/bake_ground.py
"""
import json
import math
import os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data", "osm_cache")
OUT = os.path.join(ROOT, "data", "ground.geojson")
OUT_ROADS = os.path.join(ROOT, "data", "roads.geojson")

# The detailed bbox. Inside it we keep every driveway and parking aisle; outside
# it those are 4,000 hairlines the camera never resolves, and they double the
# file for nothing.
DETAIL_BB = (-97.752, 30.276, -97.726, 30.296)

# Speedway Mall: 30 ft, from PWP Landscape Architecture's own project record for
# the Speedway Corridor -- "narrowed to a pedestrian-friendly 30 feet wide".
# SOURCED. The brick, the herringbone and the extent all come from the same
# record; see docs/PASS_ROADS.md.
SPEEDWAY_W = 9.1

# ---------------------------------------------------------------- surfaces --
# OSM surface value -> our surface class. Anything unmapped is reported, never
# silently guessed.
SURFACE_MAP = {
    "concrete": "concrete", "concrete:plates": "concrete", "concrete:lanes": "concrete",
    "paved": "paving", "paving_stones": "paving", "sett": "paving",
    "cobblestone": "paving", "unhewn_cobblestone": "paving",
    "brick": "brick", "bricks": "brick", "paving_stones:brick": "brick",
    "asphalt": "asphalt", "chipseal": "asphalt", "tartan": "track",
    "grass": "grass", "grass_paver": "grass", "ground": "dirt", "dirt": "dirt",
    "earth": "dirt", "mud": "dirt", "unpaved": "gravel", "compacted": "gravel",
    "gravel": "gravel", "fine_gravel": "gravel", "pebblestone": "gravel",
    "sand": "sand", "wood": "wood", "metal": "concrete", "rubber": "track",
    "limestone": "limestone", "stone": "limestone", "rock": "limestone",
    "artificial_turf": "turf", "synthetic": "turf",
}
# The burnt-orange end zones of a Texas football field. Not an OSM surface —
# a derived class, see the end-zone pass in main().

# What a thing IS, when its surface is not tagged. This is a GENERATIVE default:
# an untagged campus footway is overwhelmingly concrete here (of the corridor's
# tagged paths, concrete outnumbers everything else better than 2:1), and the
# malls are limestone-paved. Reported as a default, not as sourced fact.
DEFAULT_SURFACE = {
    "footway": "concrete", "steps": "concrete", "cycleway": "asphalt",
    "path": "gravel", "pedestrian": "paving", "plaza": "paving",
    "lawn": "grass", "park": "grass", "wood": "wood", "scrub": "grass",
    "pitch": "grass", "track": "track", "parking": "asphalt",
    "water": "water", "fountain": "water", "sand": "sand",
    "construction": "dirt", "playground": "sand", "garden": "grass",
}

# Drawn width in metres for paths OSM does not measure. GENERATIVE.
DEFAULT_WIDTH = {
    "footway": 2.4, "steps": 3.0, "cycleway": 2.2, "path": 1.5, "pedestrian": 6.0,
}

# landuse/natural/leisure value -> our `use`, for area features.
AREA_USE = {
    "grass": "lawn", "meadow": "lawn", "village_green": "lawn", "greenfield": "lawn",
    "recreation_ground": "lawn", "grassland": "lawn",
    "forest": "wood", "wood": "wood", "scrub": "scrub",
    "park": "park", "garden": "garden", "pitch": "pitch", "track": "track",
    "playground": "playground", "common": "lawn",
    "water": "water", "reservoir": "water", "basin": "water", "fountain": "fountain",
    "parking": "parking", "construction": "construction", "brownfield": "construction",
    "sand": "sand",
}

# Values that are a BUILDING or an enclosure, not a ground surface. Without
# this, `leisure=stadium` on DKR became a 235x231 m rust-red "track" slab laid
# over the entire bowl, burying the actual field inside it.
NOT_GROUND = {"stadium", "sports_centre", "grandstand", "pavilion", "building"}

M_LAT = 111320.0
unmapped_surface = Counter()
warnings = []


def load(key):
    p = os.path.join(CACHE, key + ".json")
    if not os.path.exists(p):
        warnings.append("cache miss: %s.json not fetched yet; its features are ABSENT" % key)
        return []
    with open(p, encoding="utf-8") as f:
        return json.load(f).get("elements", [])


def parse_width(val):
    if val is None:
        return None
    s = str(val).strip().lower().replace("m", "").replace(" ", "").replace(",", ".")
    try:
        f = float(s)
        return f if 0.3 < f < 60 else None
    except ValueError:
        return None


def surface_of(tags, use):
    raw = tags.get("surface")
    if raw:
        s = SURFACE_MAP.get(raw.strip().lower())
        if s:
            return s, True
        unmapped_surface[raw] += 1
    return DEFAULT_SURFACE.get(use, "concrete"), False


def ring_of(geom):
    if not geom or len(geom) < 3:
        return None
    r = [[round(p["lon"], 6), round(p["lat"], 6)] for p in geom]
    if r[0] != r[-1]:
        r.append(list(r[0]))
    return r if len(r) >= 4 else None


def rings_from_relation(el):
    """Stitch outer members of a multipolygon relation into closed rings."""
    segs = []
    for m in el.get("members", []):
        if m.get("type") == "way" and m.get("role") in ("outer", "") and m.get("geometry"):
            segs.append([[p["lon"], p["lat"]] for p in m["geometry"]])
    rings = []
    while segs:
        ring = segs.pop(0)
        moved = True
        while moved and ring[0] != ring[-1]:
            moved = False
            for i, s in enumerate(segs):
                if s[0] == ring[-1]:      ring += s[1:]
                elif s[-1] == ring[-1]:   ring += s[-2::-1]
                elif s[-1] == ring[0]:    ring = s[:-1] + ring
                elif s[0] == ring[0]:     ring = s[::-1][:-1] + ring
                else:                     continue
                segs.pop(i); moved = True; break
        if ring[0] != ring[-1]:
            ring.append(list(ring[0]))
        if len(ring) >= 4:
            rings.append([[round(x, 7) for x in p] for p in ring])
    return rings


def area_m2(ring):
    """Rough planar area of a lon/lat ring, in m^2."""
    if not ring:
        return 0.0
    lat0 = sum(p[1] for p in ring) / len(ring)
    k = math.cos(math.radians(lat0))
    a = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        a += (x0 * k) * y1 - (x1 * k) * y0
    return abs(a) * 0.5 * M_LAT * M_LAT


# ============================================================== the roads ==
#
# Roads used to come from the Liberty basemap's OpenMapTiles `transportation`
# source-layer, which carries `class`, `subclass`, `oneway`, `ramp` and
# `brunnel` and nothing else. No lane count, so every width was a guess per
# class; no name, so Speedway could not be told from San Jacinto; and no
# cycleway tags at all, so a bike lane could not exist even in principle.
#
# This reads OSM directly (scripts/fetch_roads.py) over the outer-ring bbox --
# the area the camera can actually see from 900 m -- and emits every road with
# what it really is.

# Metres of one US urban travel lane, and the kerb/gutter allowance either side.
# These two are the only GENERATIVE numbers in the width model; everything they
# multiply is OSM's own lane count.
LANE_M = 3.4
KERB_M = 1.6
BIKE_M = 1.8      # a 6 ft bike lane
BUFF_M = 0.9      # a 3 ft painted buffer, where cycleway:*:buffer=yes

# Fallback pavement width by highway class, for the 78% of ways OSM does not
# give a lane count. GENERATIVE: an honest typical section, not a survey.
CLASS_W = {
    "motorway": 30.0, "trunk": 24.0, "primary": 18.0, "secondary": 15.0,
    "tertiary": 12.0, "unclassified": 9.5, "residential": 9.5,
    "living_street": 8.0, "busway": 8.0, "road": 9.0, "service": 5.5,
}
LINKS = {"motorway_link": "motorway", "trunk_link": "trunk", "primary_link": "primary",
         "secondary_link": "secondary", "tertiary_link": "tertiary"}
LINK_W = 7.5      # a ramp is one lane plus shoulders

# What each OSM cycleway value MEANS, and therefore whether a lane may be drawn
# for it. This table IS the "render a lane only where the data says one exists"
# rule. Anything not in it draws nothing -- in particular `shared_lane` (a
# sharrow stencilled on a shared travel lane), `share_busway`, and `separate`
# (which is mapped as its own way and would otherwise be drawn twice).
CYCLE_KIND = {
    "lane": 1, "opposite_lane": 1, "shoulder": 1,
    "track": 2, "opposite_track": 2,
}
CYCLE_IGNORED = ("shared_lane", "share_busway", "separate", "no", "shared",
                 "shared_parking_lane", "crossing", "sidepath", "planned", "link",
                 "traffic_island")

# The surface of a road, when OSM bothers to say. Concrete carriageways are real
# here -- East MLK is tagged concrete for most of its length.
ROAD_SURF = {"asphalt": "asphalt", "chipseal": "asphalt", "paved": "asphalt",
             "concrete": "roadconcrete", "concrete:plates": "roadconcrete",
             "concrete:lanes": "roadconcrete",
             "paving_stones": "paving", "sett": "paving", "bricks": "brick",
             "gravel": "gravel", "compacted": "gravel", "unpaved": "gravel",
             "fine_gravel": "gravel", "dirt": "dirt", "ground": "dirt",
             "grass_paver": "gravel"}


def lane_count(t):
    """OSM `lanes`, defensively. Values like '2;3' and '4' both occur."""
    raw = t.get("lanes")
    if raw is None:
        return 0
    try:
        n = int(str(raw).split(";")[0].strip())
    except ValueError:
        return 0
    return n if 1 <= n <= 12 else 0


def cycle_sides(t):
    """-> (left, right) each 0 none / 1 painted lane / 2 protected track.

    OSM's scheme is a fallback chain: `cycleway:left` beats `cycleway:both`
    beats plain `cycleway`. Reading only `cycleway` would miss 663 of the 883
    tagged ways in this extract, and reading `cycleway:both` as if it were
    one-sided would draw half the lanes that exist.
    """
    both = t.get("cycleway:both") or t.get("cycleway")
    out = []
    for side in ("left", "right"):
        raw = t.get("cycleway:" + side) or both
        out.append(CYCLE_KIND.get((raw or "").strip(), 0))
    # `bicycle=designated` on a road with no cycleway tag is a bike ROUTE, not a
    # lane. It gets nothing, deliberately.
    return out[0], out[1]


def cycle_buffer(t, side):
    both = t.get("cycleway:both:buffer")
    v = t.get("cycleway:%s:buffer" % side) or both
    return 1 if (v or "").strip() == "yes" else 0


def road_width(t, bl, br):
    """Pavement width in metres, and whether the lane count was OSM's.

    lanes x 3.4 + 1.6 is the whole model. It is checkable: MLK is tagged 5 or 6
    lanes and comes out 18.6-22.0 m, Guadalupe 4-5 lanes gives 15.2-18.6 m, and
    San Jacinto's 2-3 lanes gives 8.4-11.8 m. Those are three visibly different
    roads, which is the entire complaint.
    """
    hw = t.get("highway")
    n = lane_count(t)
    if n:
        w, tagged = n * LANE_M + KERB_M, 1
    elif hw in LINKS:
        w, tagged = LINK_W, 0
    else:
        w, tagged = CLASS_W.get(hw, 9.0), 0
    # A bike lane is pavement too, and it is why a "2 lane" street measures
    # wider than 8.4 m on the ground.
    for side, kind in (("left", bl), ("right", br)):
        if kind:
            w += BIKE_M + (BUFF_M if cycle_buffer(t, side) else 0.0)
    return round(w, 1), tagged


def simplify(pts, eps_m):
    """Ramer-Douglas-Peucker on lon/lat, tolerance in metres.

    Purely a file-size measure: at the tolerance used (1.2 m) nothing moves by
    more than a quarter of a rendered pixel at the zoom the camera flies at.
    """
    if len(pts) < 3:
        return pts
    lat0 = pts[0][1]
    kx = math.cos(math.radians(lat0)) * M_LAT
    ky = M_LAT
    eps = eps_m

    def rdp(seq):
        if len(seq) < 3:
            return seq
        (x0, y0), (x1, y1) = seq[0], seq[-1]
        ax, ay = (x1 - x0) * kx, (y1 - y0) * ky
        L = math.hypot(ax, ay)
        worst, wi = -1.0, 0
        for i in range(1, len(seq) - 1):
            px_, py = (seq[i][0] - x0) * kx, (seq[i][1] - y0) * ky
            d = abs(px_ * ay - py * ax) / L if L > 1e-9 else math.hypot(px_, py)
            if d > worst:
                worst, wi = d, i
        if worst <= eps:
            return [seq[0], seq[-1]]
        return rdp(seq[:wi + 1])[:-1] + rdp(seq[wi:])

    import sys as _sys
    _sys.setrecursionlimit(10000)
    return rdp(pts)


def bake_roads(stats, warnings):
    """data/roads.geojson: carriageways, bike lanes, cycle paths, stop bars."""
    green_ids = set()
    gp = os.path.join(CACHE, "_green_lanes.json")
    if os.path.exists(gp):
        with open(gp, encoding="utf-8") as f:
            green_ids = set(json.load(f).get("green_way_ids", []))
    else:
        warnings.append("_green_lanes.json missing; no green paint will be drawn "
                        "(run scripts/sample_bike_lane_paint.py)")

    feats = []
    ways_by_node = {}          # node id -> [(way tags, geometry, index)]
    unknown_surface = Counter()
    emitted_ids = set()        # OSM way ids already drawn, so the far-field
                               # query cannot draw the same arterial twice

    def in_detail(g):
        return any(DETAIL_BB[0] <= p["lon"] <= DETAIL_BB[2]
                   and DETAIL_BB[1] <= p["lat"] <= DETAIL_BB[3] for p in g)

    # ---- carriageways ---------------------------------------------------
    for el in load("roads"):
        if el.get("type") != "way":
            continue
        t = el.get("tags", {}) or {}
        g = el.get("geometry") or []
        if len(g) < 2:
            continue
        hw = t.get("highway")
        # Underground is not ground. A tunnel drawn on the surface puts I-35's
        # lower deck through the middle of a city block.
        if t.get("tunnel") in ("yes", "building_passage") or _layer(t) < 0:
            stats["road_skipped_tunnel"] += 1
            continue
        svc = t.get("service")
        detail = in_detail(g)
        if not detail and (hw == "service" and svc in ("parking_aisle", "driveway",
                                                       "drive-through")):
            stats["road_skipped_far_service"] += 1
            continue

        bl, br = cycle_sides(t)
        w, wt = road_width(t, bl, br)
        cls = LINKS.get(hw, hw)
        surf_raw = (t.get("surface") or "").strip().lower()
        surf = ROAD_SURF.get(surf_raw, "asphalt")
        if surf_raw and surf_raw not in ROAD_SURF:
            unknown_surface[surf_raw] += 1
        pts = simplify([[round(p["lon"], 6), round(p["lat"], 6)] for p in g], 1.2)
        n_lanes = lane_count(t)
        props = {
            "k": "road", "c": cls, "w": w, "wt": wt, "s": surf,
        }
        if hw in LINKS:
            props["lk"] = 1
        if n_lanes:
            props["ln"] = n_lanes
        if (t.get("oneway") or "") in ("yes", "1", "true"):
            props["ow"] = 1
        elif (t.get("oneway") or "") == "-1":
            props["ow"] = -1
        if t.get("bridge"):
            props["bg"] = 1
        if svc:
            props["sv"] = svc
        if bl:
            props["bl"] = bl
        if br:
            props["br"] = br
        if (bl or br) and el.get("id") in green_ids:
            props["gp"] = 1
            stats["road_green_painted"] += 1
        if t.get("name"):
            props["name"] = t["name"]
        feats.append({"type": "Feature",
                      "geometry": {"type": "LineString", "coordinates": pts},
                      "properties": props})
        emitted_ids.add(el.get("id"))
        stats["road_" + cls] += 1
        if wt:
            stats["road_width_FROM_LANES"] += 1
        else:
            stats["road_width_from_class_default"] += 1
        if bl or br:
            stats["road_with_bike_lane"] += 1
        # Remember the way against its nodes, for the stop bars.
        if cls in ("motorway", "trunk", "primary", "secondary", "tertiary") and detail:
            for i, nid in enumerate(el.get("nodes") or []):
                ways_by_node.setdefault(nid, []).append((props, g, i))

    # ---- the far-field arterial armature ---------------------------------
    # Taking the roads off the basemap took them off the WHOLE WORLD, and the
    # basemap had global coverage. A wide establishing shot came back with the
    # far third of the frame blank tan and the city reading as a plate -- see
    # shots/before-wide-day.png against shots/roads-wide-day.png.
    #
    # So motorways, trunks, primaries and secondaries are pulled over a box about
    # four times the outer ring and appended. Nothing smaller: at 5 km out a
    # residential street is sub-pixel. Geometry is simplified five times harder,
    # because at that distance 6 m is well under a pixel, and the cycleway and
    # bike-lane properties are dropped -- a bike lane 6 km away is not a thing.
    for el in load("roads_far"):
        if el.get("type") != "way" or el.get("id") in emitted_ids:
            continue
        t = el.get("tags", {}) or {}
        g = el.get("geometry") or []
        if len(g) < 2:
            continue
        if t.get("tunnel") or _layer(t) < 0:
            continue
        hw = t.get("highway")
        cls = LINKS.get(hw, hw)
        n = lane_count(t)
        w = round(n * LANE_M + KERB_M, 1) if n else (
            LINK_W if hw in LINKS else CLASS_W.get(hw, 12.0))
        pts = simplify([[round(p["lon"], 5), round(p["lat"], 5)] for p in g], 6.0)
        props = {"k": "road", "c": cls, "w": w, "wt": 1 if n else 0,
                 "s": "asphalt", "far": 1}
        if hw in LINKS:
            props["lk"] = 1
        if (t.get("oneway") or "") in ("yes", "1", "true"):
            props["ow"] = 1
        feats.append({"type": "Feature",
                      "geometry": {"type": "LineString", "coordinates": pts},
                      "properties": props})
        stats["road_far_" + cls] += 1

    # ---- separate cycle ways --------------------------------------------
    for el in load("cycleways"):
        if el.get("type") != "way":
            continue
        t = el.get("tags", {}) or {}
        g = el.get("geometry") or []
        if len(g) < 2:
            continue
        if t.get("tunnel") or _layer(t) < 0:
            continue
        # A `cycleway=crossing` is a road marking across a junction, not a path.
        # Drawing them lays a hatch across every intersection -- the same trap
        # the footway bake already hits with footway=crossing.
        if t.get("cycleway") == "crossing" or t.get("footway") == "crossing":
            stats["cycle_skipped_crossing"] += 1
            continue
        hw = t.get("highway")
        if hw != "cycleway" and (t.get("bicycle") or "") not in ("designated",):
            # A footway merely signed bicycle=yes is a footpath; the footway
            # bake already draws it, and drawing it again doubles it.
            stats["cycle_skipped_shared_footway"] += 1
            continue
        w = parse_width(t.get("width")) or 0
        pts = simplify([[round(p["lon"], 6), round(p["lat"], 6)] for p in g], 1.2)
        surf_raw = (t.get("surface") or "").strip().lower()
        feats.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": pts},
            "properties": {
                "k": "cycle", "w": round(w or 2.5, 1), "wt": 1 if w else 0,
                "s": ROAD_SURF.get(surf_raw, "asphalt"),
                **({"sg": 1} if t.get("segregated") == "yes" else {}),
                **({"name": t["name"]} if t.get("name") else {}),
            },
        })
        stats["cycle_path"] += 1

    # ---- stop bars at signalised approaches ------------------------------
    # A real stop bar is 12-24 in deep and spans one direction of travel. At the
    # altitude the camera flies at one pixel is ~0.5 m, so the DEPTH is drawn
    # over-scale (js/ground.js, GROUND.stopBarDepth) and the LENGTH is true.
    # That is declared, not hidden -- see docs/PASS_ROADS.md.
    signals = [el for el in load("furn_vertical")
               if el.get("type") == "node"
               and (el.get("tags") or {}).get("highway") == "traffic_signals"]
    SETBACK = 5.5          # metres back from the junction node
    for nd in signals:
        for props, g, i in ways_by_node.get(nd["id"], []):
            half = props["w"] / 2.0
            for direction in (-1, 1):
                p = _walk(g, i, SETBACK * direction)
                if p is None:
                    continue
                (lon, lat), (ux, uy) = p
                # Approaching WITH the way's direction, the driver's right is
                # the way's right; approaching against it, the driver's right is
                # the way's left. So the two bars sit on opposite sides, which
                # is exactly how a two-way junction looks from the air.
                if direction > 0 and props.get("ow"):
                    continue                     # no opposing approach on a oneway
                sgn = 1.0 if direction < 0 else -1.0
                nx, ny = -uy * sgn, ux * sgn
                kx = math.cos(math.radians(lat)) * M_LAT
                a = [lon, lat]
                b = [lon + nx * half / kx, lat + ny * half / M_LAT]
                feats.append({
                    "type": "Feature",
                    "geometry": {"type": "LineString",
                                 "coordinates": [[round(a[0], 6), round(a[1], 6)],
                                                 [round(b[0], 6), round(b[1], 6)]]},
                    "properties": {"k": "stopbar", "c": props["c"]},
                })
                stats["stopbar"] += 1

    fc = {"type": "FeatureCollection", "features": feats}
    with open(OUT_ROADS, "w", encoding="utf-8") as f:
        json.dump(fc, f, separators=(",", ":"))
    stats["road_unknown_surface_values"] = dict(unknown_surface)
    stats["roads_file_kb"] = round(os.path.getsize(OUT_ROADS) / 1024, 1)
    stats["roads_features"] = len(feats)
    stats["signals_seen"] = len(signals)
    return feats


def _layer(t):
    try:
        return int(str(t.get("layer", 0)).strip())
    except ValueError:
        return 0


def _walk(g, i, dist_m):
    """Walk `dist_m` along a way from vertex i. -> ((lon,lat), unit tangent)."""
    if not (0 <= i < len(g)):
        return None
    step = 1 if dist_m > 0 else -1
    need = abs(dist_m)
    j = i
    while 0 <= j + step < len(g):
        a, b = g[j], g[j + step]
        kx = math.cos(math.radians(a["lat"])) * M_LAT
        dx = (b["lon"] - a["lon"]) * kx
        dy = (b["lat"] - a["lat"]) * M_LAT
        L = math.hypot(dx, dy)
        if L < 1e-9:
            j += step
            continue
        if L >= need:
            t = need / L
            lon = a["lon"] + (b["lon"] - a["lon"]) * t
            lat = a["lat"] + (b["lat"] - a["lat"]) * t
            # Tangent points along the way's own direction, always.
            return ([lon, lat], (dx / L * step, dy / L * step))
        need -= L
        j += step
    return None


# ---------------------------------------------------------- water shape --
#
# WHY THIS EXISTS AT ALL: js/ground.js has carried a `creek` and a `pond` colour
# in all three palettes, plus a whole `ground-creek-bank` layer with its own
# taste knobs and a paragraph explaining why a wooded channel must not be
# painted the same pale blue as Lady Bird Lake -- and NOTHING HAS EVER SET
# `s` TO EITHER. Every water area in the file is `s: "water"`, so the bank layer
# has never drawn a pixel and both palette entries have never been read. The
# rule the code was written against was simply missing.
#
# THE RULE. A watercourse is long and thin; a pond is compact. The isoperimetric
# quotient Q = 4*pi*A / P^2 is 1.0 for a circle and tends to 0 for a ribbon, so
# it says exactly that and needs no threshold on size. Measured over the twelve
# water areas in this file:
#
#     Q  0.008 0.011 0.012 0.016 0.017 0.031 0.036  | 0.183 0.199 0.310 0.767 0.991
#            seven creeks, up to 40,745 m2          |     five ponds, from 19 m2
#
# The gap between 0.036 and 0.183 is five-fold, so the cut is not delicate. 0.15
# sits in the middle of it.
WATER_Q_CREEK = 0.15


def _shape_q(ring_m):
    """4*pi*A/P^2 — 1.0 for a circle, near 0 for a long thin ribbon."""
    a = abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(ring_m, ring_m[1:]))) / 2.0
    per = sum(math.hypot(x1 - x0, y1 - y0) for (x0, y0), (x1, y1) in zip(ring_m, ring_m[1:]))
    return (4 * math.pi * a / (per * per)) if per > 0 else 0.0


def classify_water(feats, stats):
    """u:'water' areas become s:'creek' or s:'pond' by their own shape."""
    for f in feats:
        p = f["properties"]
        if p.get("u") != "water" or f["geometry"]["type"] != "Polygon":
            continue
        ring = f["geometry"]["coordinates"][0]
        if len(ring) < 4:
            continue
        lat0 = sum(q[1] for q in ring) / len(ring)
        kx = math.cos(math.radians(lat0)) * M_LAT
        q = _shape_q([(x * kx, y * M_LAT) for x, y in ring])
        p["s"] = "creek" if q < WATER_Q_CREEK else "pond"
        p["q"] = round(q, 4)
        stats["water_" + p["s"]] += 1
    return feats


# ------------------------------------------------------------ Waller Creek --
#
# "you added a bit of green around the creeky water when i asked for more than
# just that ... the creek behind patton and alumni is a very vibrant in depth
# creek, samd with the area behind san jacinto and the rec center and the track
# that area also very lush. Hope you will add more detail there and not the bare
# minimum"
#
# What was here was a 9 m ring of `u:'wood'` around each creek and nothing else:
# a flat green ribbon at the same height as the lawn beside it, with a blurred
# dark line along its edge standing in for a bank. He is right that it is the
# bare minimum, and the picture is `shots/creek2/before/patton.png`.
#
# THE CHANNEL IS CUT NOW, and the thing that unblocked it is one measurement.
# PR #62's docstring says a basin must build UP from z=0 because "a `fill` does
# not depth-test against a `fill-extrusion`, so a basin sunk below z=0 is painted
# straight over by the flat ground fill above it." That is true of a fill drawn
# over the same ground -- and the answer is therefore not to build upward, it is
# to STOP DRAWING THE FLAT FILL THERE. The resolver added for A2 already does
# exactly that for a living: give the channel the top rank and every lawn, wood
# and park polygon gives up its footprint. With no flat fill over the hole,
# `fill-extrusion-base` may go negative, and the creek can be a trench.
#
# So the profile is real geometry:
#
#   grade 0.0 ---\                                            /--- 0.0
#                 \___ terrace   -0.6                  -0.6 __/
#                     \___ bench -1.3                -1.3 __/
#                         \__ toe -2.0            -2.0 __/
#                            [====== water -2.4 ======]
#                             bed -3.0
#
# Every number is a taste knob (CHANNEL below) and every one of them is drawn
# from the same place: Waller Creek through campus runs 2-4 m below the walks
# either side, which is why it needs bridges at 21st, 23rd and 24th rather than
# a kerb. The depth is scaled by the reach's OWN width so the 4.7 m reach north
# of Dean Keeton is not given the same trench as the 10.3 m reach downstream.
#
# THE PLANTING IS THREE ZONES, NOT ONE COLOUR. A Central Texas riparian corridor
# is legible from the air precisely because it is layered: bare or gravelly bank
# at the water, scrub and understorey above the toe, then closed canopy that is
# noticeably darker than any lawn. One `u:'wood'` band cannot say that. Widths
# scale with the reach, so the wide reaches behind the Alumni Center and behind
# the Rec Center get the deep corridor he is describing and a 4.7 m headwater
# ditch does not pretend to be one.
CHANNEL = {
    # Depth of the water surface below grade, as a MULTIPLE of the reach's own
    # mean width, then clamped. 0.30 x a 7 m channel is 2.1 m, which is what the
    # bridge soffits on campus imply.
    "depth_per_width": 0.30,
    "depth_min_m": 1.4,
    "depth_max_m": 3.2,
    # The bed sits this far below the water surface. It is only ever seen
    # through the water colour, so it is shallow on purpose.
    "bed_below_water_m": 0.6,
    # Bank courses between grade and the water, and how far back the top of bank
    # is from the water's edge, as a multiple of the reach's mean width.
    "courses": 3,
    "bank_per_width": 0.75,
    "bank_min_m": 2.5,
    "bank_max_m": 9.0,
    # A bank is not a staircase of equal treads, and the horizontal run and the
    # vertical drop are NOT the same distribution -- that is the difference
    # between a cut section and a ramp. Both are fractions, outermost course
    # first, and both must sum to 1.0; it is asserted below rather than trusted.
    #
    # First cut used one list for both and gave the outermost course half the
    # run at zero drop. That is a 2.6 m flat shelf at grade wearing the chalk
    # colour, and from the air it read as a dirt TRACK running beside the water
    # rather than as the top of a bank (shots/creek2/after/patton-n.png, first
    # version). Steeper at the top, flatter at the toe, is the real section.
    "course_run":  [0.34, 0.34, 0.32],
    "course_drop": [0.42, 0.33, 0.25],
    # And the bank is GREEN except at the water. Waller Creek through campus is
    # a vegetated cut with Austin Chalk showing at the toe and under the
    # bridges, not an earthwork -- the pale ledge belongs at the water line and
    # nowhere else. Outermost course first.
    "course_mat": ["bankveg", "bankshade", "bank"],
    # Planting, as multiples of the reach's mean width, measured OUT from the
    # top of bank. scrub -> understorey -> canopy.
    "scrub_per_width": 0.45,
    "under_per_width": 0.90,
    "canopy_per_width": 1.60,
    "scrub_min_m": 2.0, "scrub_max_m": 6.0,
    "under_min_m": 4.0, "under_max_m": 12.0,
    "canopy_min_m": 7.0, "canopy_max_m": 24.0,
    # Drop the slivers a difference leaves behind.
    "min_m2": 3.0,
    # A 3.9 km creek buffered seven times with round joins is 1 MB of vertices
    # on its own -- the first cut DOUBLED data/ground.geojson, from 1,067 to
    # 2,081 KB, and this file is not tiled. 0.5 m is about one pixel at the
    # altitude the camera flies at, and 3 segments per quarter-turn is plenty
    # for a bank line that is never straight in the first place.
    "simplify_m": 0.5,
    "quad_segs": 3,
}


def _mean_width(poly):
    """Area / (half the perimeter) -- the width of the equivalent ribbon.

    For a long thin polygon the perimeter is very nearly twice the length, so
    this is the honest mean width and it needs no centreline. Measured against
    the seven reaches in this file it gives 4.7 to 10.3 m, which is what Waller
    Creek is.
    """
    per = poly.length
    return (poly.area / (per / 2.0)) if per > 1e-6 else 0.0


def _emit(feats, gm, props, stats, key, min_m2):
    if CHANNEL["simplify_m"]:
        gm = gm.simplify(CHANNEL["simplify_m"])
    parts = list(gm.geoms) if gm.geom_type == "MultiPolygon" else [gm]
    n = 0
    for g in parts:
        if g.geom_type != "Polygon" or g.is_empty or g.area < min_m2:
            continue
        rings = [[[round(x / _KX, 6), round(y / M_LAT, 6)] for x, y in g.exterior.coords]]
        rings += [[[round(x / _KX, 6), round(y / M_LAT, 6)] for x, y in r.coords]
                  for r in g.interiors]
        feats.append({"type": "Feature",
                      "geometry": {"type": "Polygon", "coordinates": rings},
                      "properties": dict(props)})
        n += 1
    stats[key] += n
    return n


def cut_creek_channels(feats, stats, warnings):
    """Waller Creek as a cut channel with a layered riparian corridor."""
    try:
        from shapely.geometry import Polygon
    except ImportError:
        warnings.append("shapely not installed: the creek stays a flat ribbon")
        return feats

    run, drop = CHANNEL["course_run"], CHANNEL["course_drop"]
    mats = CHANNEL["course_mat"]
    for name, lst in (("course_run", run), ("course_drop", drop)):
        if len(lst) != CHANNEL["courses"] or abs(sum(lst) - 1.0) > 1e-6:
            warnings.append("CHANNEL.%s must have `courses` entries summing to "
                            "1.0; got %s -- channel NOT cut" % (name, lst))
            return feats
    if len(mats) != CHANNEL["courses"]:
        warnings.append("CHANNEL.course_mat must have `courses` entries -- "
                        "channel NOT cut")
        return feats

    creeks = [f for f in feats
              if f["properties"].get("s") == "creek"
              and f["geometry"]["type"] == "Polygon"]
    if not creeks:
        warnings.append("no s:'creek' features: classify_water ran before this?")
        return feats

    clamp = lambda v, lo, hi: max(lo, min(hi, v))
    for f in creeks:
        water = _poly_m(f["geometry"])
        if water is None or water.is_empty:
            continue
        w = _mean_width(water)
        if w <= 0.5:
            continue
        depth = clamp(CHANNEL["depth_per_width"] * w,
                      CHANNEL["depth_min_m"], CHANNEL["depth_max_m"])
        bank = clamp(CHANNEL["bank_per_width"] * w,
                     CHANNEL["bank_min_m"], CHANNEL["bank_max_m"])
        f["properties"]["dep"] = round(depth, 2)     # so the report can be read
        f["properties"]["bw"] = round(w, 1)

        # ---- the bed and the water surface -------------------------------
        #
        # EVERY PRISM STANDS ON THE SAME BED and only its TOP differs. That is
        # not a shortcut: courses that each started at the tread below them
        # would put a downward-facing wall at the OUTER edge of the outermost
        # course, i.e. a wall visible from outside the channel with nothing
        # behind it. Standing them all on the bed leaves exactly one visible
        # vertical face per course -- the riser looking INTO the trench, which
        # is the whole read -- and the rings do not overlap in plan, so nothing
        # here can re-introduce the A2 defect.
        bed = -(depth + CHANNEL["bed_below_water_m"])
        _emit(feats, water, {"k": "bank", "u": "channel", "m": "water",
                             "b": round(bed, 2), "h": round(-depth, 2)},
              stats, "creek_water_prism", 1.0)

        # ---- the bank courses, outermost first ---------------------------
        # Outermost course tops out AT grade, innermost at the water line, so
        # the profile closes at both ends without a step that has to be tuned.
        acc_r = acc_d = 0.0
        for i in range(CHANNEL["courses"]):
            r_out = bank * (1.0 - acc_r)
            top = -depth * acc_d
            acc_r += run[i]
            acc_d += drop[i]
            r_in = bank * (1.0 - acc_r)
            outer = water.buffer(r_out, join_style=1, quad_segs=CHANNEL['quad_segs']) if r_out > 0.01 else water
            innerp = water.buffer(r_in, join_style=1, quad_segs=CHANNEL['quad_segs']) if r_in > 0.01 else water
            ring = outer.difference(innerp)
            if ring.is_empty:
                continue
            _emit(feats, ring,
                  {"k": "bank", "u": "channel", "m": mats[i],
                   "b": round(bed, 2), "h": round(top, 2)},
                  stats, "creek_bank_course", CHANNEL["min_m2"])

        # ---- the planting, three zones out from the top of bank ----------
        top_of_bank = water.buffer(bank, join_style=1, quad_segs=CHANNEL['quad_segs'])
        zones = [
            ("scrub", "scrub", "grass",
             clamp(CHANNEL["scrub_per_width"] * w, CHANNEL["scrub_min_m"], CHANNEL["scrub_max_m"])),
            ("under", "wood", "understorey",
             clamp(CHANNEL["under_per_width"] * w, CHANNEL["under_min_m"], CHANNEL["under_max_m"])),
            ("canopy", "wood", "wood",
             clamp(CHANNEL["canopy_per_width"] * w, CHANNEL["canopy_min_m"], CHANNEL["canopy_max_m"])),
        ]
        prev = top_of_bank
        for label, use, surf, reach in zones:
            outer = top_of_bank.buffer(reach, join_style=1, quad_segs=CHANNEL['quad_segs'])
            ring = outer.difference(prev)
            prev = outer
            if ring.is_empty:
                continue
            _emit(feats, ring,
                  {"k": "area", "u": use, "s": surf, "src": "creek_" + label},
                  stats, "creek_zone_" + label, CHANNEL["min_m2"])
    return feats


# ---------------------------------------------------------- precinct lawns --
#
# "austin building by ellsworth has chromatic circle of glass can you add that
# with the colors. also that whole area is supposed to be green can you make it
# look nicer (not just add green lol)"
#
# The colour went on in PR #58. The green is this. Photographed, Ellsworth
# Kelly's chapel sits on a 38 x 54 m lawn in the middle of an enormous expanse
# of bare tan base ground -- OSM maps the lawn immediately under the building
# and nothing at all for the block around it, so the base colour shows through
# and reads as dirt.
#
# NOT ONE BIG GREEN POLYGON, which is what he asked it not to be. The lawn is
# grown outward from the lawn that IS mapped until it meets the things that
# really bound it: the walks, and the buildings. Both are already in the data,
# so the resulting panel is derived from the site rather than drawn freehand --
# the space between a chapel and the paths around it is lawn, and that is a
# fact about the place, not a guess.
#
# Keyed by a point rather than a name because the lawn polygons here are
# unnamed; the entry says which precinct it is and where to start.
PRECINCTS = [
    # (label, lon, lat, how far to grow in metres)
    ("Ellsworth Kelly / Austin", -97.737838, 30.281665, 26.0),
]
PRECINCT_KEEP_M2 = 60.0     # drop slivers the subtraction leaves behind


def grow_precinct_lawns(feats, stats, warnings):
    try:
        from shapely.geometry import Polygon, Point
        from shapely.ops import unary_union
    except ImportError:
        warnings.append("shapely not installed: precinct lawns not grown")
        return feats

    lat0 = 30.283
    kx = math.cos(math.radians(lat0)) * M_LAT
    to_m = lambda r: [(x * kx, y * M_LAT) for x, y in r]
    to_ll = lambda r: [[round(x / kx, 7), round(y / M_LAT, 7)] for x, y in r]

    # What a lawn may NOT grow over: every walk, every plaza, every other
    # surface, and every building footprint.
    blockers = []
    for f in feats:
        p = f["properties"]
        if f["geometry"]["type"] != "Polygon":
            continue
        if p.get("k") == "path" or (p.get("k") == "area" and p.get("u") != "lawn"):
            try:
                q = Polygon(to_m(f["geometry"]["coordinates"][0]))
                blockers.append(q if q.is_valid else q.buffer(0))
            except Exception:
                pass

    for label, lon, lat, grow in PRECINCTS:
        seed_pt = Point(lon * kx, lat * M_LAT)
        best, bestd = None, 1e18
        for f in feats:
            p = f["properties"]
            if p.get("k") != "area" or p.get("u") != "lawn":
                continue
            if f["geometry"]["type"] != "Polygon":
                continue
            q = Polygon(to_m(f["geometry"]["coordinates"][0]))
            if not q.is_valid:
                q = q.buffer(0)
            d = q.distance(seed_pt)
            if d < bestd:
                best, bestd = q, d
        if best is None or bestd > 40:
            stats["precinct_no_seed_lawn"] += 1
            continue
        grown = best.buffer(grow, join_style=1)
        # PATHS ARE NOT BLOCKERS YET at this point in the bake -- they are still
        # LineStrings and become polygons in widen_paths, which runs after this.
        # So buffer the path lines by their own width here rather than skipping
        # them, or the lawn would swallow every walk on the block.
        for f in feats:
            p = f["properties"]
            if p.get("k") != "path" or f["geometry"]["type"] != "LineString":
                continue
            from shapely.geometry import LineString
            w = float(p.get("w") or 2.0)
            try:
                blockers.append(LineString(to_m(f["geometry"]["coordinates"]))
                                .buffer(w / 2 + 0.6, cap_style=2, join_style=2))
            except Exception:
                pass
        cut = grown.difference(unary_union(blockers)) if blockers else grown
        parts = cut.geoms if cut.geom_type == "MultiPolygon" else [cut]
        made = 0
        for gm in parts:
            if gm.is_empty or gm.area < PRECINCT_KEEP_M2:
                continue
            rings = [to_ll(list(gm.exterior.coords))]
            rings += [to_ll(list(r.coords)) for r in gm.interiors]
            feats.append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": rings},
                "properties": {"k": "area", "u": "lawn", "s": "grass",
                               "src": "precinct"},
            })
            made += 1
        stats["precinct_lawn_" + label.split("/")[0].strip().replace(" ", "_")] += made
    return feats


# ------------------------------------------------------------ path widening --
#
# WHY PATHS ARE POLYGONS AND NOT LINES.
#
# "i look closer to horizontal (low) and speedway gets super wide and right
# after monochrome is a seperate layer thats a bit narrower that also grows
# wider as i approach 90 degrees."
#
# A MapLibre `line-width` is a number of SCREEN PIXELS, and it is the same
# number for the whole line. The ground is not: under perspective, 9.1 m of
# Speedway near the camera is a lot of pixels and 9.1 m of it up by Dean Keeton
# is a few. So one constant pixel width cannot be right everywhere, and the
# error is not small. Measured with scripts/verify/road-fan.mjs, camera on the
# south end of the promenade looking north:
#
#     pitch 20   1.10x at the only point still on screen
#     pitch 60   1.26x near  ->  3.33x at the far end
#     pitch 86   1.30x near  ->  3.69x at the far end
#
# 3.69x on a 9.1 m mall is a 34 m motorway, which is exactly what he saw. And it
# gets worse as the camera lies down not because the ratio changes much past 60
# -- it barely does -- but because pitching over drags the far, wrong end of the
# road INTO the frame. At pitch 20 everything past 30.2845 is off screen.
#
# The old expression was not sloppy; it is exactly right at the map centre,
# which is where it was derived. There is no per-vertex line width in MapLibre,
# so no expression can fix this. The width has to live in the geometry.
#
# So: buffer each centreline by half its real width and emit a polygon. A fill
# is ground geometry and gets the true perspective for free, at every pitch,
# everywhere in the frame.
#
# UNIONED PER (use, surface) GROUP, which is not an optimisation. Fills draw at
# `pathOpacity` 0.92, and two overlapping translucent polygons in one layer
# composite twice -- every junction where two footways meet would show as a
# darker patch. Union dissolves the overlap. It also drops the interior
# boundaries, so 2,512 lines become ~1,000 polygons.
#
# The kerb is NOT a second buffered ring. It is a bevel, and a bevel is a
# screen-space effect: ground.js strokes the polygon boundary at a constant few
# pixels, which is what a highlight along an edge should do at any pitch, and it
# saves the 0.55 MB a second polygon set would have cost.
LAT0 = 30.285                       # metric anchor for the buffer, mid-campus
PATH_SIMPLIFY_M = 0.15              # post-union tolerance; well under a pixel
PATH_MIN_AREA_M2 = 1.0              # drop slivers the union leaves behind


def widen_paths(feats, stats, warnings):
    """k:'path' LineStrings -> unioned k:'patharea' Polygons, width in metres."""
    try:
        from shapely.geometry import LineString
        from shapely.ops import unary_union
    except ImportError:
        warnings.append("shapely not installed: paths left as LineStrings, which "
                        "means they fan out with pitch (see road-fan.mjs)")
        return feats

    mlat = 111195.08
    mlon = mlat * math.cos(math.radians(LAT0))
    to_m = lambda c: [((x + 97.74) * mlon, (y - LAT0) * mlat) for x, y in c]
    to_ll = lambda c: [[round(x / mlon - 97.74, 6), round(y / mlat + LAT0, 6)] for x, y in c]

    kept, groups = [], {}
    for f in feats:
        p = f["properties"]
        if p.get("k") != "path" or f["geometry"]["type"] != "LineString":
            kept.append(f)
            continue
        coords = f["geometry"]["coordinates"]
        if len(coords) < 2:
            continue
        w = float(p.get("w") or 2.0)
        # Mitre joins and flat caps: a round join on a 2 m footpath adds a dozen
        # vertices per corner to draw a curve nobody can see at 200 m.
        poly = LineString(to_m(coords)).buffer(
            w / 2.0, cap_style=2, join_style=2, mitre_limit=2.0)
        if poly.is_empty:
            continue
        groups.setdefault((p.get("u"), p.get("s")), []).append(poly)
        stats["path_widened"] += 1

    for (use, surf), polys in sorted(groups.items(), key=lambda kv: str(kv[0])):
        merged = unary_union(polys)
        if PATH_SIMPLIFY_M:
            merged = merged.simplify(PATH_SIMPLIFY_M)
        parts = merged.geoms if merged.geom_type == "MultiPolygon" else [merged]
        for gm in parts:
            if gm.is_empty or gm.area < PATH_MIN_AREA_M2:
                stats["path_sliver_dropped"] += 1
                continue
            rings = [to_ll(list(gm.exterior.coords))]
            rings += [to_ll(list(r.coords)) for r in gm.interiors]
            kept.append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": rings},
                "properties": {"k": "patharea", "u": use, "s": surf},
            })
            stats["patharea_" + str(use)] += 1
    return kept


# ----------------------------------------------------- coincident surfaces --
#
# "speedway and 24th keep glitching on motion and combine on still, find out
# other areas like this and fix"
#
# THE CAUSE, MEASURED. Two surfaces drawn at the same height over the same
# ground have no defined winner. Where the winner is decided per pixel by
# floating-point depth, it flips as the camera moves -- the "glitching" -- and
# when the camera stops it settles on whichever won that frame, which is the
# "combine". Speedway and 24th are two instances of it and there were 1,697:
#
#     337  patharea x patharea      1,791 m2   ALL at exactly 0.22 m in ONE
#                                              fill-extrusion layer -> a true
#                                              depth tie
#     184  area x area             90,433 m2   two flat fills in one layer:
#                                              no depth tie, but the loser is
#                                              composited THROUGH the winner at
#                                              fill-opacity 0.95
#   1,176  road x patharea         38,713 m2   a 2.4 m sidewalk polygon standing
#                                              0.22 m proud in the middle of a
#                                              15 m carriageway
#
# At 24th and Speedway specifically: a 55.3 m2 pedestrian/asphalt patch and a
# 51.4 m2 footway/concrete patch both sit on the brick mall at the same 0.22 m,
# and East 24th's carriageway runs under both. Three surfaces, one plane.
#
# THE RULE, and it is one rule: ONE SQUARE METRE OF GROUND BELONGS TO EXACTLY
# ONE DRAWN SURFACE. Every ground class has a rank; where two overlap, the
# higher rank keeps the ground and the lower one gives it up. Nothing is moved
# in z and no layer order changes -- the ambiguity is removed from the DATA, so
# it cannot come back at a camera angle nobody photographed.
#
# The ranks below are the whole taste surface of this pass: reorder two lines
# and the ground changes hands. They read as "the more specific, more built,
# more identifying thing wins" -- a flight of steps beats the walk it lands on,
# the brick mall beats the generic footway laid over it, water beats the wood
# band planted along it, and the carriageway beats everything, because a
# sidewalk does not lie on a road.
RANK = {
    # --- the 0.22 m band: k='patharea', one fill-extrusion layer -----------
    ("patharea", "steps"):      64,
    ("patharea", "pedestrian"): 60,
    ("patharea", "path"):       56,
    ("patharea", "footway"):    52,
    # --- the flat band: k='area', one fill layer --------------------------
    #
    # The cut channel outranks everything flat. That is not a preference, it is
    # the mechanism: a `fill` drawn over the trench would paint straight into
    # it (PR #62's finding), so the trench only exists BECAUSE every lawn, wood
    # and park polygon gives up its footprint here. See cut_creek_channels.
    ("bank", "channel"):        90,
    ("area", "fountain"):       46,
    ("area", "water"):          44,
    ("area", "endzone"):        40,   # derived; must stay on top of its pitch
    # Small and specific beats large and generic, which is why the sand sits
    # ABOVE the pitch: the five sand areas here are long-jump pits INSIDE a
    # pitch polygon, and the first cut of this ladder deleted all five.
    ("area", "sand"):           38,
    ("area", "playground"):     37,
    ("area", "pitch"):          36,
    ("area", "track"):          35,
    ("area", "plaza"):          30,
    ("area", "parking"):        28,
    ("area", "construction"):   26,
    ("area", "garden"):         24,
    ("area", "wood"):           20,
    ("area", "scrub"):          18,
    ("area", "lawn"):           12,
    ("area", "park"):           10,   # the biggest, most generic container
}
RANK_DEFAULT = 1                      # anything unranked loses to everything

# Within one class, the bigger polygon keeps its ground; a tie after that falls
# back to the feature's own index, so the result cannot depend on dict order.
#
# 0.5 m2 rather than widen_paths' 1.0: a subtraction leaves genuine narrow
# strips (the pavement either side of a driveway crossing) that a union never
# does, and 1.0 was eating them.
RESOLVE_MIN_M2 = 0.5

# How far inside the pavement edge the carriageway starts. bake_ground.py builds
# `w` as lanes*LANE_M + KERB_M and the 1.6 is the kerb-and-gutter allowance for
# BOTH sides, so half of it per side lands the cut on the travelled way. Same
# number and same argument as the road test in shape_trees.py.
CARRIAGEWAY_INSET_M = KERB_M / 2.0

# CROSSING THE BANDS, one direction only. Areas are flat and paths stand 0.22 m
# proud, so they cannot tie -- and cutting every lawn to the shape of the walks
# over it would put a few hundred path-shaped holes in the ground for a defect
# that does not exist. The ONE cross-band cut that earns itself is the
# carriageway against the paths, because that one is visible: a pale concrete
# slab standing across the middle of every junction.


def _rank(p):
    return RANK.get((p.get("k"), p.get("u")), RANK_DEFAULT)


def _band(p):
    """Which render band a feature is drawn in. Only same-band pairs can tie.

    `None` means the feature is not drawn as a surface at all, so it neither
    takes ground nor gives any up. Exactly one thing is in that state and it is
    deliberate: since the creek became a cut channel the `s:'creek'` polygon is
    no longer painted by `ground-areas` (js/ground.js filters it out) -- the
    extruded bed carries the water now. It stays in the file because it is the
    only record that this ground IS water, and shape_trees.py and bake_props.py
    both read it to keep a trunk or a bench out of the creek.
    """
    if p.get("k") == "area" and p.get("s") == "creek":
        return None
    return "path" if p.get("k") == "patharea" else "flat"


# ONE metric frame for this whole pass. HANDOFF §32 records the trap: 1e-6 deg
# is 0.096 m east-west and 0.111 m north-south here, and every margin in this
# file is smaller than that difference, so nothing may be buffered, inset or
# area-tested in degrees.
_KX = math.cos(math.radians(LAT0)) * M_LAT


def _poly_m(geom):
    """A GeoJSON Polygon -> a shapely polygon in METRES, repaired if need be."""
    from shapely.geometry import Polygon
    rings = geom["coordinates"]
    try:
        q = Polygon([(x * _KX, y * M_LAT) for x, y in rings[0]],
                    [[(x * _KX, y * M_LAT) for x, y in r] for r in rings[1:]])
    except Exception:
        return None
    if not q.is_valid:
        q = q.buffer(0)
    return q


def _line_m(coords):
    return [(x * _KX, y * M_LAT) for x, y in coords]


def _rings_ll(gm):
    out = [[[round(x / _KX, 6), round(y / M_LAT, 6)] for x, y in gm.exterior.coords]]
    out += [[[round(x / _KX, 6), round(y / M_LAT, 6)] for x, y in r.coords]
            for r in gm.interiors]
    return out


def count_conflicts(feats, road_polys):
    """Every pair of ground polygons that share ground at the same height.

    THE PROBE LIVES IN THE BAKE on purpose. Four scripts write this file and
    each has silently broken another at least once; a number printed by the run
    that produced the data cannot go stale the way a separate script can.
    """
    try:
        from shapely.strtree import STRtree
    except ImportError:
        return None
    items = []
    for f in feats:
        if f["geometry"]["type"] != "Polygon":
            continue
        q = _poly_m(f["geometry"])
        if q is None or q.is_empty:
            continue
        items.append((f["properties"], q))
    n, a = 0, 0.0
    by_class = Counter()
    if items:
        tree = STRtree([q for _, q in items])
        for i, (p, q) in enumerate(items):
            for bi in tree.query(q):
                bi = int(bi)
                if bi <= i:
                    continue
                p2, q2 = items[bi]
                b1 = _band(p)
                if b1 is None or b1 != _band(p2):
                    continue
                inter = q.intersection(q2)
                if inter.area >= RESOLVE_MIN_M2:
                    n += 1
                    a += inter.area
                    by_class["/".join(sorted([str(p.get("u")), str(p2.get("u"))]))] += 1
    rn, ra = 0, 0.0
    paths = [q for p, q in items if p.get("k") == "patharea"]
    if road_polys and paths:
        ptree = STRtree(paths)
        for rq in road_polys:
            for bi in ptree.query(rq):
                inter = rq.intersection(paths[int(bi)])
                if inter.area >= RESOLVE_MIN_M2:
                    rn += 1
                    ra += inter.area
    return {"same_height_pairs": n, "same_height_m2": round(a),
            "carriageway_x_path_pairs": rn, "carriageway_x_path_m2": round(ra),
            "worst_same_height": dict(by_class.most_common(8))}


def carriageway_polys(road_feats):
    """Every travelled way in the detail area, as a metric polygon.

    `far` ways are excluded and the reason is measurable: their centrelines are
    simplified five times harder (6.0 m against 1.2 m), so cutting a 2.4 m
    campus sidewalk with one would remove pavement that is really there.
    """
    try:
        from shapely.geometry import LineString
    except ImportError:
        return []
    out = []
    for f in road_feats:
        p = f["properties"]
        if p.get("k") != "road" or p.get("far"):
            continue
        half = float(p.get("w") or 9.0) / 2.0 - CARRIAGEWAY_INSET_M
        if half <= 0.2:
            continue
        try:
            q = LineString(_line_m(f["geometry"]["coordinates"])).buffer(
                half, cap_style=2, join_style=2, mitre_limit=2.0)
        except Exception:
            continue
        if not q.is_empty:
            out.append(q)
    return out


def resolve_ground_conflicts(feats, road_polys, stats, warnings):
    """Give every square metre of ground to exactly one surface."""
    try:
        from shapely.strtree import STRtree
        from shapely.ops import unary_union
    except ImportError:
        warnings.append("shapely not installed: coincident surfaces NOT resolved "
                        "-- Speedway/24th and 1,697 other pairs will z-fight")
        return feats

    kept, work = [], []
    for i, f in enumerate(feats):
        if f["geometry"]["type"] != "Polygon":
            kept.append(f)
            continue
        band = _band(f["properties"])
        if band is None:
            kept.append(f)
            stats["resolve_not_a_surface"] += 1
            continue
        q = _poly_m(f["geometry"])
        if q is None or q.is_empty:
            stats["resolve_dropped_degenerate"] += 1
            continue
        work.append({"f": f, "q": q, "a0": q.area, "i": i,
                     "rank": _rank(f["properties"]), "band": band})

    # Highest rank first, then largest, then original order. Every term is
    # deterministic, so two runs of this bake hand the same ground to the same
    # feature -- which is what makes the file reproducible byte for byte.
    work.sort(key=lambda w: (-w["rank"], -w["a0"], w["i"]))

    road_tree = STRtree(road_polys) if road_polys else None
    settled = []          # metric geometries already given their ground
    s_band = []
    s_tree = None
    REBUILD_EVERY = 64    # STRtree is immutable; rebuilding in blocks is the
                          # cheapest way to keep a growing index queryable
    pending = []

    out = []
    for w in work:
        cutters = []
        # Same band, higher rank: they have already taken their ground.
        if s_tree is not None:
            for bi in s_tree.query(w["q"]):
                bi = int(bi)
                if s_band[bi] == w["band"]:
                    cutters.append(settled[bi])
        for j, g in pending:
            if s_band[j] == w["band"] and g.intersects(w["q"]):
                cutters.append(g)
        # The ONE cross-band cut, and only this one.
        if w["band"] == "path" and road_tree is not None:
            for bi in road_tree.query(w["q"]):
                cutters.append(road_polys[int(bi)])
        g = w["q"]
        if cutters:
            try:
                g = g.difference(unary_union(cutters))
            except Exception:
                warnings.append("difference failed on a %s/%s; left uncut"
                                % (w["f"]["properties"].get("k"),
                                   w["f"]["properties"].get("u")))
                g = w["q"]
        # A feature claims the ground it ORIGINALLY covered, not the trimmed
        # remainder: otherwise two lower-ranked features could both take the
        # same square metre out of the middle of a third.
        settled.append(w["q"])
        s_band.append(w["band"])
        pending.append((len(settled) - 1, w["q"]))
        if len(pending) >= REBUILD_EVERY:
            s_tree = STRtree(settled)
            pending = []
        w["q"] = g
        if g.is_empty:
            stats["resolve_covered_" + str(w["f"]["properties"].get("u"))] += 1
            continue
        out.append(w)

    # Back to lon/lat. A subtraction can split one polygon into several, so a
    # MultiPolygon result becomes several Polygon features -- the schema in this
    # file is Polygon-only and three other bakes read it expecting that.
    #
    # A feature nothing touched is passed through UNCHANGED rather than
    # re-emitted through the transform: a round trip through metres and back
    # moves the last digit of a coordinate, and 1,100 features' worth of that
    # is noise in every future diff of this file.
    for w in out:
        if w["q"].area >= w["a0"] - 1e-6:
            kept.append(w["f"])
            continue
        stats["resolve_trimmed"] += 1
        g = w["q"]
        parts = list(g.geoms) if g.geom_type == "MultiPolygon" else [g]
        made = 0
        for gm in parts:
            if gm.geom_type != "Polygon" or gm.is_empty or gm.area < RESOLVE_MIN_M2:
                stats["resolve_sliver_dropped"] += 1
                continue
            kept.append({"type": "Feature",
                         "geometry": {"type": "Polygon", "coordinates": _rings_ll(gm)},
                         "properties": dict(w["f"]["properties"])})
            made += 1
        if made > 1:
            stats["resolve_split_into_parts"] += made - 1
        if made == 0:
            stats["resolve_trimmed_to_nothing"] += 1
    return kept


def main():
    feats = []
    stats = Counter()

    # ---- paths (lines) -------------------------------------------------
    for el in load("footways"):
        if el.get("type") != "way" or not el.get("geometry"):
            continue
        t = el.get("tags", {}) or {}
        hw = t.get("highway")
        # `cycleway` used to be drawn here as a pale footpath. It now belongs to
        # roads.geojson, which knows it is bike infrastructure and draws it as
        # such. Leaving it in both files drew the same 50 ways twice, at two
        # different widths, in two different colours.
        if hw not in ("footway", "steps", "path", "pedestrian"):
            continue
        # A pedestrian AREA is a plaza, not a line — handled with the areas.
        if t.get("area") == "yes":
            continue
        # Skip crossings: they are road markings, and drawing them as paths
        # lays pale ribbons across every street.
        if t.get("footway") == "crossing" or t.get("crossing"):
            stats["skipped_crossing"] += 1
            continue
        coords = [[round(p["lon"], 6), round(p["lat"], 6)] for p in el["geometry"]]
        if len(coords) < 2:
            continue
        use = "steps" if hw == "steps" else hw
        surf, tagged = surface_of(t, use)
        w = parse_width(t.get("width")) or parse_width(t.get("est_width"))
        extra = {}

        # ---- Speedway Mall -------------------------------------------------
        # OSM tags the corridor in two halves: surface=paving_stones north of
        # ~23rd and surface=asphalt south of it. The asphalt half is a STALE tag.
        # PWP's project record says the whole corridor from Jester Circle to
        # Dean Keeton was reconstructed as a 30 ft brick mall, and the nadir
        # imagery agrees flatly -- the "asphalt" half samples rgb(200,176,142),
        # a warm tan, while a real asphalt control 100 m away samples
        # rgb(161,155,137). See scripts/sample_speedway_colour.py. The photo
        # beats the derived tag.
        if (t.get("name") or "") == "Speedway" and hw == "pedestrian":
            surf, tagged = "brickpave", False
            w = SPEEDWAY_W          # 30 ft, PWP; sourced, not measured by us
            extra["src"] = "pwp30ft"
            stats["speedway_mall_segments"] += 1
            if (t.get("surface") or "") == "asphalt":
                stats["speedway_stale_asphalt_overridden"] += 1

        feats.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {
                "k": "path", "u": use, "s": surf,
                "w": round(w or DEFAULT_WIDTH.get(use, 2.0), 1),
                "wt": 1 if w else 0,
                **extra,
                **({"name": t["name"]} if t.get("name") else {}),
            },
        })
        stats["path_" + use] += 1

    # ---- plazas / pedestrian areas -------------------------------------
    for el in load("plazas"):
        t = el.get("tags", {}) or {}
        rings = []
        if el.get("type") == "way":
            r = ring_of(el.get("geometry"))
            if r:
                rings = [r]
        else:
            rings = rings_from_relation(el)
        if not rings:
            continue
        surf, _ = surface_of(t, "plaza")
        for r in rings:
            feats.append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [r]},
                "properties": {"k": "area", "u": "plaza", "s": surf,
                               **({"name": t["name"]} if t.get("name") else {})},
            })
            stats["plaza"] += 1

    # ---- landuse / natural / leisure areas ------------------------------
    for el in load("landuse"):
        t = el.get("tags", {}) or {}
        val = t.get("landuse") or t.get("natural") or t.get("leisure")
        if val in NOT_GROUND:
            stats["skipped_not_ground"] += 1
            continue
        use = AREA_USE.get(val)
        if not use:
            continue
        rings = [ring_of(el.get("geometry"))] if el.get("type") == "way" else rings_from_relation(el)
        rings = [r for r in rings if r]
        if not rings:
            continue
        surf, _ = surface_of(t, use)
        for r in rings:
            # Drop enormous polygons: a campus-wide landuse=education blanket
            # would repaint the entire ground plane one flat colour, which is
            # the exact defect this pass exists to remove.
            if area_m2(r) > 400000:
                stats["skipped_huge_area"] += 1
                continue
            feats.append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [r]},
                "properties": {"k": "area", "u": use, "s": surf,
                               **({"sport": t["sport"]} if t.get("sport") else {}),
                               **({"name": t["name"]} if t.get("name") else {})},
            })
            stats["area_" + use] += 1

    # ---- water, sport surfaces, parking ---------------------------------
    for key, default_use in (("water", "water"), ("sport", "track"), ("parking", "parking")):
        for el in load(key):
            t = el.get("tags", {}) or {}
            val = (t.get("natural") or t.get("amenity") or t.get("leisure")
                   or t.get("water") or t.get("sport"))
            if val in NOT_GROUND:
                stats["skipped_not_ground"] += 1
                continue
            use = AREA_USE.get(val, default_use)
            if el.get("type") == "way" and t.get("service") == "parking_aisle":
                continue                       # aisles are lines; the lot covers it
            rings = [ring_of(el.get("geometry"))] if el.get("type") == "way" else rings_from_relation(el)
            rings = [r for r in rings if r]
            surf, _ = surface_of(t, use)
            for r in rings:
                if area_m2(r) > 400000:
                    stats["skipped_huge_area"] += 1
                    continue
                feats.append({
                    "type": "Feature",
                    "geometry": {"type": "Polygon", "coordinates": [r]},
                    "properties": {"k": "area", "u": use, "s": surf,
                                   **({"sport": t["sport"]} if t.get("sport") else {}),
                                   **({"name": t["name"]} if t.get("name") else {})},
                })
                stats["area_" + use] += 1

    # ---- American football fields get their end zones ---------------------
    # A gridiron read from the air IS the identity of a stadium, and the end
    # zones are what make it read as one rather than as a green rectangle.
    # POSITION is factual: the pitch polygon is OSM's. The SPLIT is derived —
    # a regulation field is 120 yd long including two 10 yd end zones, so the
    # end zones are the outer 9.144/109.73 = 8.33% of the long axis at each
    # end. Applied to the polygon's own long axis, not to a guessed rectangle.
    END_ZONE_FRAC = 9.144 / 109.728
    extra = []
    for f in feats:
        pr = f["properties"]
        if pr.get("u") != "pitch" or pr.get("sport") != "american_football":
            continue
        ring = f["geometry"]["coordinates"][0]
        lat0 = sum(q[1] for q in ring) / len(ring)
        kx = math.cos(math.radians(lat0))
        xs = [q[0] * kx for q in ring]
        ys = [q[1] for q in ring]
        # Long axis of the bounding box decides which pair of ends to cut.
        w_m = (max(xs) - min(xs)) * M_LAT
        h_m = (max(ys) - min(ys)) * M_LAT
        along_x = w_m >= h_m
        lo, hi = (min(xs), max(xs)) if along_x else (min(ys), max(ys))
        cut = (hi - lo) * END_ZONE_FRAC
        for a, b in ((lo, lo + cut), (hi - cut, hi)):
            if along_x:
                box = [[a / kx, min(ys)], [b / kx, min(ys)],
                       [b / kx, max(ys)], [a / kx, max(ys)]]
            else:
                box = [[min(xs) / kx, a], [max(xs) / kx, a],
                       [max(xs) / kx, b], [min(xs) / kx, b]]
            box.append(list(box[0]))
            extra.append({
                "type": "Feature",
                "geometry": {"type": "Polygon",
                             "coordinates": [[[round(x, 6), round(y, 6)] for x, y in box]]},
                "properties": {"k": "area", "u": "endzone", "s": "endzone",
                               "name": pr.get("name", "")},
            })
        stats["endzones"] += 2
    feats.extend(extra)

    # The same polygon can arrive from several caches (a pitch is in landuse AND
    # sport AND surfaces), which stacked four copies of the DKR field. Key on
    # geometry + use and keep one.
    seen, deduped = set(), []
    for f in feats:
        if f["properties"]["k"] == "area":
            r = f["geometry"]["coordinates"][0]
            key = (f["properties"]["u"], round(sum(q[0] for q in r) / len(r), 6),
                   round(sum(q[1] for q in r) / len(r), 6), len(r))
            if key in seen:
                stats["deduped_area"] += 1
                continue
            seen.add(key)
        deduped.append(f)
    feats = deduped

    # Counted BEFORE widening, because after it there are no k:'path' features
    # left to count and the report would silently read zero.
    paths_tagged_w = sum(1 for f in feats if f["properties"].get("wt") == 1)
    paths_default_w = sum(1 for f in feats if f["properties"]["k"] == "path"
                          and f["properties"].get("wt") == 0)

    feats = classify_water(feats, stats)
    feats = cut_creek_channels(feats, stats, warnings)
    feats = grow_precinct_lawns(feats, stats, warnings)
    feats = widen_paths(feats, stats, warnings)

    # The roads are baked BEFORE the ground is resolved now, because the
    # carriageway is one of the surfaces competing for the ground and the
    # resolver needs its geometry. bake_roads() itself is unchanged and still
    # writes data/roads.geojson byte for byte as it did.
    road_feats = bake_roads(stats, warnings)
    roads_m = carriageway_polys(road_feats)
    stats["carriageways_as_cutters"] = len(roads_m)

    before = count_conflicts(feats, roads_m)
    feats = resolve_ground_conflicts(feats, roads_m, stats, warnings)
    after = count_conflicts(feats, roads_m)

    # Draw order: big areas first, then small areas on top of them, then paths
    # over everything. Without the size term a 30,000 m2 lawn painted over the
    # field it contains.
    def order(f):
        if f["properties"]["k"] != "area":
            return (2, 0)
        r = f["geometry"]["coordinates"][0]
        return (0 if f["properties"]["u"] != "endzone" else 1, -area_m2(r))
    feats.sort(key=order)

    fc = {"type": "FeatureCollection", "features": feats}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fc, f, separators=(",", ":"))

    size_kb = os.path.getsize(OUT) / 1024
    report = {
        "features": len(feats),
        "file_kb": round(size_kb, 1),
        "counts": dict(sorted(stats.items(), key=lambda kv: kv[0])),
        "paths_with_TAGGED_width": paths_tagged_w,
        "paths_with_DEFAULT_width": paths_default_w,
        "unmapped_surface_values": dict(unmapped_surface),
        "coincident_surfaces_BEFORE": before,
        "coincident_surfaces_AFTER": after,
        "warnings": warnings,
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
