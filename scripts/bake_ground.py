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
    "construction": "dirt", "playground": "sand",
    # A GARDEN IS NOT A LAWN, and until this line it was: `u:'garden'` fell
    # through to the same `grass` colour as every mown panel on campus, which is
    # the whole of why the Memorial Garden read as a flat green rectangle. Its
    # turf is watered, edged and shaded, so it is deeper and cooler than a mall
    # lawn -- see SURF.gardenlawn in js/ground.js.
    "garden": "gardenlawn",
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
    # THE WATER SHEEN. The channel had a water PRISM from the start and it was
    # still read as "a green stripe", and the reason is measurable rather than
    # aesthetic: `BANK_MAT.water` was #41604a (luma 88) against `bankshade`
    # #425c33 (luma 82) two metres away, both green-dominant. Six luma and no
    # hue difference is not a surface, it is the same surface. So the water gets
    # a cool colour in js/ground.js AND a rippled top face here.
    #
    # The sheen is its OWN 0.10 m slab standing on the water rather than a
    # pattern on the water prism itself, for two reasons. A `fill-extrusion`
    # takes a colour or a pattern and not both, so painting the ripple on the
    # water prism would cost the water its time-of-day colour; and two prisms
    # with tops at exactly the same z is the A2 defect this bake exists to
    # remove. 0.10 m is under a fifth of a pixel from any altitude this app
    # flies and it makes the depth order defined.
    "sheen_m": 0.10,
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


# ------------------------------------------------- crossings over the creek --
#
# "the creek near DKR completely slices through 21st and DKR, but sidewalks
# still go over them (added to the ducktape analogy) same thing happened with
# this creek and other roads too"
#
# He is describing both halves of one omission. cut_creek_channels digs a
# trench along the whole reach and was never told that anything crosses it, so:
# the carriageway is interrupted by a 2 m gorge, and the footway -- which IS
# drawn across, because a patharea is a flat slab that knows nothing about what
# is under it -- appears to hang over the water on nothing.
#
# Where a street meets a creek there is a culvert or a bridge, and the ground
# over it belongs to the STRUCTURE, not to the channel. That is exactly what the
# A2 rank ladder is for: `RANK[('bank','deck')]` sits above the channel, so the
# trench, the banks and the planting all give the crossing back its footprint
# and the road runs over the top. One square metre, one surface -- QUEUE A4.
#
# Measured on merged main before any of this: 30 road centrelines cross the
# creek's own water polygons, of which 11 carry an OSM `bridge` tag and 19 do
# not. The tag is not the test and must not be: a culverted crossing is not
# tagged as a bridge and is still a crossing. Geometry is the test.
DECK = {
    "enable": True,
    # A crossing is decked where the way meets the WATER, not where it meets the
    # planted corridor. The corridor runs 30-60 m wide at its zones and a street
    # running parallel 20 m away is not a bridge -- testing against the corridor
    # decked half of San Jacinto Boulevard on the first run.
    # THE DECK IS DERIVED FROM WHAT IS DRAWN ON IT, plus a parapet. It is not a
    # re-buffered centreline, and the difference is the whole look of the thing.
    #
    # First cut buffered the centreline by half-width + 3.5 m of shoulder. On a
    # 9.5 m street that is a 16.5 m deck, of which 7 m has nothing drawn over it
    # -- photographed at Aug 3, it read as a large pale slab dropped beside the
    # road rather than as the road crossing the water. Halving the shoulder
    # barely moved it, because the number was never the problem: a deck derived
    # from the centreline cannot know where the carriageway's edge actually is.
    #
    # `widen_roads` draws the carriageway at exactly w/2 with flat caps, so the
    # deck takes THAT band and the walk polygons as they will really be drawn,
    # and adds only a parapet. What shows from above is then a rim, which is
    # what a bridge looks like from above.
    "parapet_m": 0.7,
    # A road and its sidewalk are separate polygons a couple of metres apart, and
    # a deck that is only their union has a slot of open trench running between
    # them. A morphological closing at this radius seals any gap up to twice it
    # without growing the outline -- a real deck is continuous under both.
    "close_gap_m": 3.0,
    # How far past the cut the deck reaches onto solid ground at each end.
    # Without an abutment the deck stops exactly on the trench edge and leaves a
    # sliver of bank standing proud of the carriageway it was meant to carry.
    "abutment_m": 2.5,
    # The slab's thickness. Only its EDGE is ever seen -- the road on top is
    # drawn by ground-road and the walks by ground-paths -- so this is the depth
    # of the soffit that reads from a low oblique, not a structural number.
    "soffit_m": 1.1,
    # The top sits just BELOW grade. `ground-road` is a flat fill at z=0, so a
    # deck topping out at exactly 0.0 is two coplanar surfaces with no defined
    # winner, which is the A2 defect this bake exists to remove. 40 mm is under
    # a tenth of a pixel from any altitude here and it makes the order defined.
    "top_below_grade_m": 0.04,
    # Slivers where a way clips the very corner of the corridor are not
    # crossings; they are noise, and each one would be a floating grey chip.
    "min_m2": 6.0,
    "simplify_m": 0.4,
}


# ------------------------------------------------------- the creek canopy --
#
# "Waller Creek is still a green stripe ... there is NO WATER SURFACE and no
# canopy from flying altitude -- the src:'creek_canopy' hook added in an earlier
# pass was never consumed."
#
# The hook is real: 33 features carry `src:'creek_canopy'` and 34 carry
# `creek_under`, and they were written for `shape_trees.py` to read and densify
# `data/trees.geojson` over. Nothing has read them, so the corridor is still a
# FLAT green ribbon: three tones of paint at exactly the height of the lawn
# beside it. From 200 m a flat tone is a flat tone whatever colour it is, which
# is why every previous colour change to this corridor failed to fix it.
#
# WHAT ACTUALLY MAKES A CANOPY READ FROM THE AIR is not the colour, it is that
# the top of it is TEN METRES ABOVE THE GROUND. A raised, lumpy, self-shadowing
# mass reads as trees from any altitude; a green polygon on the ground never
# will. So the canopy is geometry, baked here, and it does not wait on the trees
# file.
#
# WHY NOT JUST EXTRUDE THE ZONE POLYGON. A single flat-topped slab over the
# whole 125,383 m2 canopy band is a 12 m green wall following the creek -- the
# giant-hedge failure this repo has already shipped once. A canopy has to have a
# broken silhouette and a varying top, so it is built from overlapping crowns.
#
# AND NOT AS TIERED DISCS. HANDOFF §35 item 7 is that every tree in the scene is
# "a stack of flat octagonal discs ... wedding cakes". Stacking is what produces
# that, so a crown here is ONE prism and the variety comes from three species
# with different radius, height and colour, plus a per-crown wobble on the ring.
# Overlapping single prisms merge into a mass; stacked ones read as furniture.
CANOPY = {
    "on": True,
    # Grid spacing in metres, staggered every other row (a hexagonal lattice, so
    # the density is 1 / (spacing^2 * sin60)). This is the ONE knob that trades
    # canopy density against file size, and the file is not tiled, so it is the
    # expensive knob. Measured on this data: 20 m gives ~0.82 crown coverage at
    # about 150 KB, 14 m gives full closure at about 300 KB on a 1.3 MB file.
    "spacing_m": 20.0,
    # How far a crown centre may wander off its lattice point, as a fraction of
    # the spacing. A lattice you can SEE is worse than no canopy at all -- and
    # this is jittered off the point's own coordinates, not off a running RNG,
    # so adding one reach cannot move every crown in the file.
    "jitter": 0.40,
    # Which planted zones get crowns. The scrub band next to the water does NOT:
    # it is the one place the channel is visible from above, and roofing it over
    # would hide the water this same pass just gave the creek. Real corridors are
    # open at the water's edge for the same reason -- that is where the light is.
    "zones": ("under", "canopy"),
    # Per species: (radius m, crown top m, share). The top is where the foliage
    # ENDS; the base is `base_frac` of it, so a crown is a thick mass rather than
    # a floating plate, and neighbours close the gaps between them. Waller Creek
    # through campus is bald cypress at the water, pecan and cedar elm above it,
    # live oak on the terrace -- three is enough to stop it reading as one green.
    "species": {
        "cypress": (6.5, 19.0, 0.28),   # tall, narrow, blue-green
        "pecan":   (10.5, 16.0, 0.40),  # broad, light, yellow-green
        "liveoak": (9.5, 11.5, 0.32),   # wide and low, dark
    },
    # Each crown's own radius and height are drawn from +/- this fraction of its
    # species' figures, so no two are identical and the top surface is lumpy.
    # SIZE VARIANCE IS THE ANTI-BLOCK KNOB and it is worth more than vertices.
    # At 0.30 a species renders as one repeated slab: 261 pecans within +/-30%
    # of each other, tops within a metre, and a cluster of them is a plateau.
    # At 0.45 the same 261 span 5.8 to 15.2 m of radius and the canopy line is
    # broken by neighbours that are half the height of each other. Costs zero
    # bytes, which is the whole reason it is the first thing to reach for.
    "size_var": 0.45,
    # A LONE PRISM IS A BLOCK; A CLUSTER OF THEM IS A CANOPY. This is the fix
    # for the thing the first render got wrong and it is worth stating plainly:
    # eight sides, a wobbled ring and 45% size variance do NOT stop a single
    # isolated crown from reading as a flat-topped green box
    # (shots/creek/crop-corridor.png, the dark one standing alone over San
    # Jacinto). What stops it is a NEIGHBOUR — two crowns that overlap merge
    # into one silhouette with a stepped top, and three merge into foliage.
    #
    # So a crown must have at least `min_neighbours` others whose centres are
    # within `touch` x (r_i + r_j), or it is not emitted. It costs nothing; it
    # SAVES bytes, because the crowns it deletes are the ones stranded in the
    # narrow reaches where the planted band is a few metres wide.
    #
    # AND `touch` IS 1.3, NOT THE 0.85 THAT WOULD MEAN "ACTUALLY OVERLAPPING",
    # because 0.85 measured at 27 crowns out of 604. That is arithmetic, not a
    # tuning accident: at spacing 20 m and mean radius 8.8 m, two lattice
    # neighbours are ~20 m apart and 0.85 x (r_i + r_j) is 15 m, so almost
    # nothing qualifies. Requiring literal overlap requires spacing under the
    # crown DIAMETER, which is 1,206 crowns and 374 KB on an untiled file, and
    # that is not a trade worth making for a defect only visible at 3x
    # magnification of a z17.4 frame -- at the altitudes this camera flies
    # (shots/creek/air.png, z16.2) the corridor already reads as a mass. 1.3
    # keeps a crown that has company within ~24 m and drops the ones stranded
    # alone in a narrow reach, which is where the block read actually happens.
    #
    # AND `min_neighbours` IS 1, WHICH IS THE HONEST ANSWER TO A MEASUREMENT.
    # Requiring two neighbours kept 132 of 604, because the planted band is a
    # 10-30 m ribbon and a 20 m lattice puts roughly ONE crown across it: there
    # is no cluster to belong to. The band's own geometry, not the rule, is why
    # this corridor is a line of trees rather than a wood, and the only way to
    # change that is to halve the spacing -- 1,206 crowns, 374 KB, on a file
    # that is not tiled. `spacing_m` is that knob and this is the number to
    # quote when turning it.
    "min_neighbours": 1,
    "touch": 1.5,
    "base_frac": 0.34,          # underside of the foliage, as a fraction of top
    # SIDES 8, AND IT WAS 6, AND THE PICTURE IS THE ARGUMENT. Six sides at this
    # radius renders a flat-topped block -- shots/creek-after/recctr.png at
    # spacing 19 has crowns that read as green CUBES beside the existing trees,
    # not as foliage. Two more vertices is ~50 bytes a crown, paid for by taking
    # the spacing from 19 m back to 20 m. Below about 8 the silhouette is the
    # polygon; above it, it is the wobble.
    "sides": 8,                 # ring vertices; every extra one is ~25 bytes x N
    "wobble": 0.34,             # per-vertex radius variation, kills the polygon
    # Crowns are POSITIONS, not surfaces: 5 decimal places is 1.1 m here, which
    # is a fiftieth of a crown and a fifth of a pixel from flying altitude. 6 dp
    # everywhere else in this file costs 12 bytes per crown for nothing.
    "coord_dp": 5,
    "min_h_m": 5.0,             # never emit a crown shorter than this
}


def _h01(*ints):
    """Deterministic hash of integers -> [0,1). Positional, never sequential.

    A running RNG would be reproducible too, but only for an unchanged input:
    add one creek reach and every crown downstream of it moves. Hashing the
    lattice cell means a crown depends on WHERE it is and nothing else, so a
    re-bake after an OSM refresh moves only the trees near what changed.
    """
    s = 0x9E3779B9
    for v in ints:
        s = (s ^ (int(v) & 0xFFFFFFFF)) * 0x85EBCA6B & 0xFFFFFFFF
        s ^= s >> 13
    s = (s * 0xC2B2AE35) & 0xFFFFFFFF
    return ((s ^ (s >> 16)) & 0xFFFFFF) / 0x1000000


def plant_creek_canopy(feats, stats, warnings):
    """Overlapping crown prisms over the creek's understorey and canopy zones."""
    if not CANOPY["on"]:
        return feats
    try:
        from shapely.ops import unary_union
        from shapely.geometry import Point
    except ImportError:
        warnings.append("shapely not installed: the creek gets no canopy")
        return feats

    want = {"creek_" + z for z in CANOPY["zones"]}
    band = [f for f in feats if f["properties"].get("src") in want
            and f["geometry"]["type"] == "Polygon"]
    if not band:
        warnings.append("no creek_%s zones to plant: did cut_creek_channels run?"
                        % "/".join(CANOPY["zones"]))
        return feats

    polys = [g for g in (_poly_m(f["geometry"]) for f in band) if g and not g.is_empty]
    area = unary_union(polys)
    stats["canopy_band_m2"] = int(area.area)

    # Cumulative species shares, so one hash draw picks the species.
    names = sorted(CANOPY["species"])
    acc, cuts = 0.0, []
    for n in names:
        acc += CANOPY["species"][n][2]
        cuts.append((acc, n))
    if abs(acc - 1.0) > 1e-6:
        warnings.append("CANOPY.species shares sum to %.3f, not 1.0" % acc)

    S = CANOPY["spacing_m"]
    row_h = S * math.sin(math.radians(60))
    x0, y0, x1, y1 = area.bounds
    dp, sides, var = CANOPY["coord_dp"], CANOPY["sides"], CANOPY["size_var"]
    made = 0

    # ---- candidates on a staggered lattice ------------------------------
    cand = []
    j = 0
    y = y0
    while y <= y1 + row_h:
        # Stagger every other row: a square lattice is visible as rows and
        # columns the moment the crowns are regular in size, and they are.
        x = x0 + (S / 2.0 if j % 2 else 0.0)
        i = 0
        while x <= x1 + S:
            cx = x + (_h01(i, j, 1) - 0.5) * 2 * CANOPY["jitter"] * S
            cy = y + (_h01(i, j, 2) - 0.5) * 2 * CANOPY["jitter"] * row_h
            if area.contains(Point(cx, cy)):
                t = _h01(i, j, 3)
                sp = next(n for c, n in cuts if t <= c)
                r0, h0, _ = CANOPY["species"][sp]
                r = r0 * (1.0 + (_h01(i, j, 4) - 0.5) * 2 * var)
                h = h0 * (1.0 + (_h01(i, j, 5) - 0.5) * 2 * var)
                if h >= CANOPY["min_h_m"]:
                    cand.append((cx, cy, r, h, sp, i, j))
            x += S
            i += 1
        y += row_h
        j += 1
    stats["canopy_candidates"] = len(cand)

    # ---- drop the loners ------------------------------------------------
    # O(n^2) over ~700 points is nothing, and an index here would be one more
    # thing that can be wrong about a number nobody re-derives.
    touch, need = CANOPY["touch"], CANOPY["min_neighbours"]
    keep = []
    for a in cand:
        n = 0
        for b in cand:
            if b is a:
                continue
            if math.hypot(a[0] - b[0], a[1] - b[1]) <= touch * (a[2] + b[2]):
                n += 1
                if n >= need:
                    break
        if n >= need:
            keep.append(a)
    stats["canopy_dropped_isolated"] = len(cand) - len(keep)

    # ---- emit -----------------------------------------------------------
    covered = 0.0
    for cx, cy, r, h, sp, i, j in keep:
        a0 = _h01(i, j, 6) * math.tau
        ring = []
        for k in range(sides):
            a = a0 + math.tau * k / sides
            rk = r * (1.0 + (_h01(i, j, 10 + k) - 0.5) * 2 * CANOPY["wobble"])
            ring.append([round((cx + rk * math.cos(a)) / _KX, dp),
                         round((cy + rk * math.sin(a)) / M_LAT, dp)])
        ring.append(ring[0])
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [ring]},
            # `b` is NOT baked: js/ground.js derives it as base_frac * h, which
            # is 12 bytes x N saved on a file that ships whole.
            #
            # TWO decimal places on `h`, not one, and it is not fussiness:
            # crowns OVERLAP by design, and two overlapping prisms with tops at
            # exactly the same z is the A2 z-fight. At 0.1 m a species has ~80
            # distinct heights across 261 crowns and ties are common; at 0.01 m
            # they are ~1 in 800 and would have to overlap as well. 3 bytes a
            # crown, 1.8 KB in the file.
            "properties": {"k": "cnp", "m": sp, "h": round(h, 2)},
        })
        stats["canopy_" + sp] += 1
        covered += math.pi * r * r
        made += 1

    stats["canopy_crowns"] = made
    # Crown area over band area. It is an UPPER bound -- crowns overlap, which
    # is the point -- so read it as "how much foliage per square metre of band",
    # not as closure. Under about 0.8 the corridor has holes you can see through.
    stats["canopy_cover_ratio"] = round(covered / max(1.0, area.area), 2)
    return feats


def _mean_width(poly):
    """Area / (half the perimeter) -- the width of the equivalent ribbon.

    For a long thin polygon the perimeter is very nearly twice the length, so
    this is the honest mean width and it needs no centreline. Measured against
    the seven reaches in this file it gives 4.7 to 10.3 m, which is what Waller
    Creek is.
    """
    per = poly.length
    return (poly.area / (per / 2.0)) if per > 1e-6 else 0.0


def _emit(feats, gm, props, stats, key, min_m2, simplify_m=None):
    """Emit a metric shapely geometry as lon/lat Polygon feature(s).

    `simplify_m` defaults to the creek's 0.5 m, which is about a pixel at flying
    altitude and right for a 3.9 km bank line. It is WRONG for a small round
    thing: a 5.5 m specimen bed simplified at 0.5 m collapses to an octagon, and
    it looked like one. Anything under ~10 m across passes its own tolerance.
    """
    tol = CHANNEL["simplify_m"] if simplify_m is None else simplify_m
    if tol:
        gm = gm.simplify(tol)
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
        # The rippled top face. Same footprint, standing CHANNEL.sheen_m on the
        # water, so `ground-creek-sheen` can carry the water pattern while the
        # prism under it keeps its time-of-day colour. See CHANNEL.sheen_m.
        # Simplified four times harder than the bank lines and pulled 0.4 m
        # inside the water's edge: it is a lid whose only job is to modulate the
        # colour under it, so an edge good to a couple of metres is good enough,
        # and it must never poke out over the chalk toe. 24 KB of duplicated
        # 343-vertex creek outline down to 7.
        _emit(feats, water.buffer(-0.4), {"k": "bank", "u": "channel", "m": "sheen",
                             "b": round(-depth, 2),
                             "h": round(-depth + CHANNEL["sheen_m"], 2)},
              stats, "creek_water_sheen", 1.0, simplify_m=2.0)

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
        # `scrub` is its OWN surface now, not `grass`. It was sharing the lawn's
        # colour AND the lawn's texture tile, so the outermost, widest and
        # nearest-the-camera zone of the corridor was literally mown grass --
        # three "zones" of which one was indistinguishable from the field beside
        # it. That is most of what "still a green stripe" is describing.
        zones = [
            ("scrub", "scrub", "scrub",
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


def deck_creek_crossings(feats, road_feats, stats, warnings):
    """Every road and walk that crosses the creek gets a deck to cross it ON.

    Runs AFTER cut_creek_channels (it needs the trench) and BEFORE
    resolve_ground_conflicts (the ladder is what actually takes the ground back
    off the channel). It emits ONE unioned set of decks rather than one per way:
    two decks overlapping at the same height would be the very A2 tie this file
    exists to remove, and at a junction beside a creek several ways overlap.
    """
    if not DECK["enable"]:
        return feats
    try:
        from shapely.geometry import LineString
        from shapely.ops import unary_union
    except ImportError:
        warnings.append("shapely not installed: creek crossings NOT decked -- "
                        "the channel will cut straight through every street")
        return feats

    water = [q for q in (_poly_m(f["geometry"]) for f in feats
                         if f["properties"].get("s") == "creek"
                         and f["geometry"]["type"] == "Polygon")
             if q is not None and not q.is_empty]
    cut = [q for q in (_poly_m(f["geometry"]) for f in feats
                       if f["properties"].get("k") == "bank"
                       and f["properties"].get("u") == "channel"
                       and f["geometry"]["type"] == "Polygon")
           if q is not None and not q.is_empty]
    if not water or not cut:
        warnings.append("no creek water or no cut channel: crossings NOT decked")
        return feats
    water_u = unary_union(water)
    # The span to bridge is the TRENCH, not the water: a deck that only covered
    # the water would leave the two bank courses either side of it standing as a
    # pair of gorges with a road hanging between them.
    span = unary_union(cut).buffer(DECK["abutment_m"])

    carried, n_road, n_walk = [], 0, 0
    for f in road_feats:
        p = f["properties"]
        if p.get("k") != "road":
            continue
        gm = f["geometry"]
        lines = ([gm["coordinates"]] if gm["type"] == "LineString"
                 else gm["coordinates"] if gm["type"] == "MultiLineString" else [])
        for cs in lines:
            try:
                L = LineString(_line_m(cs))
            except Exception:
                continue
            if not L.intersects(water_u):
                continue
            # EXACTLY the band widen_roads will draw -- same half width, same
            # flat caps, same mitre. A deck sized off anything else is a deck
            # whose edge does not agree with the kerb standing on it.
            half = float(p.get("w") or 9.0) / 2.0
            carried.append(L.buffer(half, cap_style=2, join_style=2, mitre_limit=2.0))
            n_road += 1

    # The walks are carried too, and they are the half of the report that says
    # "sidewalks still go over them". A footbridge over Waller Creek is a real
    # thing on this campus; what was wrong was that the walk was drawn across
    # with NOTHING under it.
    for f in feats:
        p = f["properties"]
        if p.get("k") != "patharea" or f["geometry"]["type"] != "Polygon":
            continue
        q = _poly_m(f["geometry"])
        if q is None or q.is_empty or not q.intersects(water_u):
            continue
        carried.append(q)
        n_walk += 1

    if not carried:
        stats["creek_deck"] = 0
        return feats

    # parapet, then close the slots between a road and the walk beside it, then
    # keep only what is over the cut. Closing BEFORE the intersection matters:
    # do it after and the closing radius reaches across the abutment edge and
    # squares off the deck's ends against the bank.
    core = unary_union(carried).buffer(DECK["parapet_m"], join_style=2, mitre_limit=2.0)
    g = DECK["close_gap_m"]
    core = core.buffer(g, join_style=2, mitre_limit=2.0).buffer(-g, join_style=2, mitre_limit=2.0)
    decks = core.intersection(span)
    if decks.is_empty:
        stats["creek_deck"] = 0
        return feats

    top = -DECK["top_below_grade_m"]
    merged = decks
    parts = list(merged.geoms) if merged.geom_type == "MultiPolygon" else [merged]
    kept = 0
    for gm in parts:
        kept += _emit(feats, gm,
                      {"k": "bank", "u": "deck", "m": "deck",
                       "b": round(top - DECK["soffit_m"], 2), "h": round(top, 2)},
                      stats, "creek_deck", DECK["min_m2"],
                      simplify_m=DECK["simplify_m"])
    stats["creek_deck_road_ways"] = n_road
    stats["creek_deck_walk_ways"] = n_walk
    print("  creek crossings: %d road ways + %d walk ways -> %d decks"
          % (n_road, n_walk, kept))
    return feats


# -------------------------------------------------------------- gardens --
#
# "turtle pond too many turtiles, fix this lawn in general its really bland"
#
# The Memorial Garden is a 2,190 m2 polygon OSM tags `leisure=garden` and names,
# and everything downstream treated it as a lawn: AREA_USE maps it to
# `u:'garden'`, DEFAULT_SURFACE gives `u:'garden'` the colour `grass`, and that
# is the entire difference between a garden and a lawn in this file. So it
# renders as a flat green rectangle with a 218 m2 blue disc in it, which is
# exactly what he is looking at.
#
# NOTHING HERE IS DRAWN FREEHAND, and that matters because the truth rule at the
# top of this file says every position comes from OSM. A garden's structure IS
# its circulation -- the beds are what is left between the walks -- and this
# campus's walks are all mapped. So:
#
#   * a BED is the band of ground a fixed distance back from a real walk, set
#     inside a real garden polygon, minus a mown verge. The bed follows the path
#     network because in life it does;
#   * a SPECIMEN bed sits at the pole of inaccessibility of each remaining lawn
#     panel -- the centre of the largest circle that fits in it. That is a
#     derived point, not a chosen one, and it is exactly where a garden puts the
#     one tree it wants you to look at;
#   * the POND COPING is a ring buffered off the real pond, and it is applied
#     only to a pond that sits in a built setting (a garden or a plaza), because
#     a stone rim on a farm pond would be a lie. Turtle Pond has one in life --
#     the low limestone edge people sit on to watch the turtles.
#
# The coping goes UP, unlike the creek. A raised rim is what is actually there,
# and it costs none of the machinery the sunken channel needed.
GARDEN = {
    "bed_w": 3.0,          # depth of a planting border, out from the verge
    "verge_w": 1.0,        # mown strip between the walk and the bed
    "bed_min_m2": 5.0,
    # A panel has to be big enough to earn a specimen, and the specimen is a
    # fraction of the panel's own inscribed circle so a narrow strip never gets
    # a bed wider than itself.
    "specimen_min_panel_m2": 90.0,
    "specimen_frac": 0.42,
    "specimen_min_r": 1.6,
    "specimen_max_r": 5.5,
    "pond_coping_w": 1.2,      # width of the built rim
    "pond_coping_h": 0.38,     # how far it stands proud -- a sitting height kerb
    "pond_coping_touch_m": 6.0,  # how close a pond must be to a garden or plaza
                                 # to count as being IN one
    # Garden features are 2-12 m across, an order of magnitude smaller than a
    # creek reach, so they carry their own simplify tolerance. At the creek's
    # 0.5 m a specimen bed came out an octagon.
    "simplify_m": 0.12,
}


def plant_gardens(feats, stats, warnings):
    """Give every OSM `leisure=garden` the structure a garden actually has."""
    try:
        from shapely.ops import unary_union, polylabel
    except ImportError:
        warnings.append("shapely not installed: gardens left as flat lawn")
        return feats

    gardens, walks, ponds, built = [], [], [], []
    for f in feats:
        p = f["properties"]
        if f["geometry"]["type"] != "Polygon":
            continue
        q = _poly_m(f["geometry"])
        if q is None or q.is_empty:
            continue
        if p.get("k") == "area" and p.get("u") == "garden":
            gardens.append((f, q))
            built.append(q)
        elif p.get("k") == "patharea":
            walks.append(q)
        elif p.get("k") == "area" and p.get("s") == "pond":
            ponds.append((f, q))
        elif p.get("k") == "area" and p.get("u") == "plaza":
            built.append(q)
    if not gardens:
        warnings.append("no u:'garden' areas found -- gardens NOT planted")
        return feats

    walk_u = unary_union(walks) if walks else None
    pond_u = unary_union([q for _, q in ponds]) if ponds else None

    for gf, g in gardens:
        name = gf["properties"].get("name") or "unnamed"
        # ---- the planting borders ------------------------------------
        inner = g
        if pond_u is not None:
            inner = inner.difference(pond_u)
        beds = None
        if walk_u is not None:
            near = walk_u.buffer(GARDEN["verge_w"] + GARDEN["bed_w"], join_style=2)
            verge = walk_u.buffer(GARDEN["verge_w"], join_style=2)
            beds = inner.intersection(near).difference(verge)
        if beds is not None and not beds.is_empty:
            n = _emit(feats, beds,
                      {"k": "area", "u": "bed", "s": "bed", "src": "garden_bed"},
                      stats, "garden_bed", GARDEN["bed_min_m2"],
                      simplify_m=GARDEN["simplify_m"])
            if n:
                inner = inner.difference(beds)

        # ---- a specimen at the centre of each remaining panel --------
        panels = list(inner.geoms) if inner.geom_type == "MultiPolygon" else [inner]
        for panel in panels:
            if panel.is_empty or panel.area < GARDEN["specimen_min_panel_m2"]:
                continue
            try:
                pt = polylabel(panel, tolerance=0.4)
            except Exception:
                continue
            r_in = panel.exterior.distance(pt)
            r = max(GARDEN["specimen_min_r"],
                    min(GARDEN["specimen_max_r"], r_in * GARDEN["specimen_frac"]))
            _emit(feats, pt.buffer(r, quad_segs=6),
                  {"k": "area", "u": "bed", "s": "bed", "src": "garden_specimen"},
                  stats, "garden_specimen", GARDEN["bed_min_m2"],
                  simplify_m=GARDEN["simplify_m"])
        stats["garden_planted_" + name.replace(" ", "_")] += 1

    # ---- the built pond edge -----------------------------------------
    built_u = unary_union(built) if built else None
    for pf, q in ponds:
        if built_u is None or q.distance(built_u) > GARDEN["pond_coping_touch_m"]:
            stats["pond_no_coping"] += 1
            continue
        ring = q.buffer(GARDEN["pond_coping_w"], join_style=1, quad_segs=4).difference(q)
        if ring.is_empty:
            continue
        _emit(feats, ring,
              {"k": "bank", "u": "coping", "m": "coping",
               "b": 0.0, "h": GARDEN["pond_coping_h"]},
              stats, "pond_coping", 1.0, simplify_m=GARDEN["simplify_m"])
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
#
# ---------------------------------------------------------------------------
# AND THE SENTENCE ABOVE WAS HALF FALSE UNTIL THIS PASS. "the walks, and the
# buildings. Both are already in the data" -- the walks were; the buildings
# were not. `feats` at this point in the bake contains ground only, so the
# blocker list could never have held a footprint, and the grown lawn ran
# straight under the buildings it was supposed to stop at. Measured on the one
# precinct that existed: 745 m2 of 6,025 m2, 12.4% of it, was under a building.
# Invisible (the extrusion covers it) and wrong, and on a file that is not
# tiled it is 12% of the bytes spent on ground nobody can see.
#
# The footprints come from the SAME file shape_trees.py uses for the same
# question, `data/snapshots/<latest>/buildings.detailed.geojson`, rather than
# from a second query -- two copies of "where are the buildings" drift.
#
# ---------------------------------------------------------------------------
# WHERE THE PRECINCTS COME FROM, since a table of nine points is exactly the
# kind of thing that gets guessed. The campus core was rasterised at 6 m and
# every cell not covered by a ground polygon, a buffered carriageway or a
# building footprint counted as base ground showing through:
#
#     51.8% of the UT campus core is bare, 821,016 m2
#     biggest connected bare blobs: 22,932 / 15,048 / 14,220 / 12,564 /
#                                   12,276 / 10,944 / 10,188 / 9,936 m2
#
# Each entry below is the mapped lawn NEAREST one of those blobs, with `grow`
# set to reach across it. The blob is the evidence that the block is bare; the
# seed lawn is the evidence that the block is landscaped. Neither on its own
# would justify painting a block green.
#
# WEST CAMPUS IS NOT IN THIS TABLE AND CANNOT BE. The mechanism needs a mapped
# lawn to grow from and West Campus has none -- the nearest mapped green to
# -97.7470, 30.2890 is 409 m away and is a 1 m2 sliver. Growing a lawn there
# would be drawing one freehand, which is the thing this whole pass is written
# not to do. It needs its own source, not a bigger `grow`.
PRECINCTS = [
    # (label, lon, lat, how far to grow in metres)
    ("Ellsworth Kelly / Austin",   -97.737838, 30.281665, 26.0),
    # The Blanton block. 9,756 m2 bare between the museum, the art building and
    # Speedway; the mapped green is the strip on the museum's south side.
    ("Blanton block",              -97.738244, 30.280400, 34.0),
    # The East Mall. 10,944 + 10,188 + 9,936 m2 of bare ground in three blobs
    # either side of the axis; one 131 m2 lawn is mapped near San Jacinto.
    ("East Mall",                  -97.735013, 30.285364, 44.0),
    # The Drama / art precinct behind Winship. 12,564 m2 bare, and there is a
    # 1,681 m2 lawn 87 m away -- the biggest seed on this side of campus.
    ("Drama and art precinct",     -97.732150, 30.286172, 36.0),
    # The power-plant yard. 12,276 m2, seed 603 m2.
    ("Power plant yard",           -97.730377, 30.286638, 38.0),
    # Speedway north of Dean Keeton, 1,001 m2 seed.
    #
    # THIS ENTRY REPLACED A "Dean Keeton north" ONE AND THE REASON IS WORTH
    # KEEPING. The first table was written from polygon CENTROIDS, and the
    # centroid of a concave lawn -- an L round a building, a ring round a
    # court -- is not in the lawn. That entry's point measured 106 m from its
    # own seed at bake time and was dropped with a warning. Every point here is
    # a shapely `representative_point()`, which is guaranteed inside.
    ("Speedway north",             -97.737383, 30.290330, 36.0),
    # Whitis. 5,796 m2 bare and the seed lawn TOUCHES it (0 m).
    ("Whitis",                     -97.739739, 30.288738, 32.0),
    # LBJ and east campus. 14,220 m2, seed is the 2,760 m2 park by the library.
    ("LBJ east campus",            -97.731331, 30.281432, 40.0),
    # San Jacinto south, between the Erwin Center site and the mall.
    ("San Jacinto south",          -97.735545, 30.281172, 34.0),
]
PRECINCT_KEEP_M2 = 60.0     # drop slivers the subtraction leaves behind
PRECINCT_SEED_MAX_M = 40.0  # a point further than this from a lawn is a typo
# A grown panel much bigger than this is not a courtyard any more, it is a
# freehand green field -- reported loudly rather than silently shipped.
PRECINCT_WARN_M2 = 26000.0
# Snapshot to read footprints from. `None` = the newest on disk, which is what
# shape_trees.py does; pin it if a bake has to be reproducible against an old
# snapshot.
PRECINCT_SNAPSHOT = None
# How far short of a wall a lawn stops. Every building on this campus has a mow
# strip, a drip line or a paved apron; a lawn butted against the wall face reads
# as the building growing out of the grass.
BUILDING_STANDOFF_M = 0.3


def _building_blockers(to_m, warnings):
    """Footprints, from the snapshot shape_trees.py uses for the same question."""
    from shapely.geometry import Polygon
    root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "data", "snapshots")
    try:
        snap = PRECINCT_SNAPSHOT or sorted(
            d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d)))[-1]
        gj = json.load(open(os.path.join(root, snap, "buildings.detailed.geojson"),
                            encoding="utf-8"))
    except Exception as e:
        # LOUD. Without this the lawn runs under every building on the block and
        # nothing on screen says so, which is exactly how it shipped before.
        warnings.append("precinct lawns: NO BUILDING FOOTPRINTS (%s) -- "
                        "lawns will run under buildings" % e)
        return [], "none"
    out = []
    for f in gj["features"]:
        g = f["geometry"]
        rings = ([g["coordinates"]] if g["type"] == "Polygon"
                 else g["coordinates"] if g["type"] == "MultiPolygon" else [])
        for rr in rings:
            try:
                q = Polygon(to_m(rr[0]))
                if not q.is_valid:
                    q = q.buffer(0)
                if q.is_valid and not q.is_empty:
                    out.append(q)
            except Exception:
                pass
    return out, snap


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

    from shapely.geometry import LineString

    # What a lawn may NOT grow over: every walk, every plaza, every other
    # surface, and every building footprint.
    #
    # BUILT ONCE, not once per precinct. The single-entry version appended the
    # path blockers INSIDE the precinct loop and re-unioned the whole list every
    # time round, which is invisible at one precinct and quadratic at nine.
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
    # PATHS ARE NOT BLOCKERS YET at this point in the bake -- they are still
    # LineStrings and become polygons in widen_paths, which runs after this.
    # So buffer the path lines by their own width here rather than skipping
    # them, or the lawn would swallow every walk on the block.
    for f in feats:
        p = f["properties"]
        if p.get("k") != "path" or f["geometry"]["type"] != "LineString":
            continue
        w = float(p.get("w") or 2.0)
        try:
            blockers.append(LineString(to_m(f["geometry"]["coordinates"]))
                            .buffer(w / 2 + 0.6, cap_style=2, join_style=2))
        except Exception:
            pass
    builds, snap = _building_blockers(to_m, warnings)
    stats["precinct_building_blockers"] = len(builds)

    cutter = unary_union(blockers) if blockers else None
    # THE BUILDINGS ARE SUBTRACTED SEPARATELY, and that is not tidiness.
    # Unioned into the same ~12,000-polygon cutter they under-removed: the
    # emitted lawn still had 1,354 m2 inside a footprint, and 55% of it was
    # more than 2 m from the nearest wall -- too deep to be edge residue, so
    # the big union was losing them, not nicking them. Two smaller differences,
    # the second applied to an already-clipped polygon, drive it to zero.
    #
    # WITH A 0.3 m OUTWARD BUFFER, because a lawn does not run to the wall
    # face; there is a mow strip or a drip line at every building on campus.
    bldu = unary_union(builds).buffer(BUILDING_STANDOFF_M) if builds else None

    # Seed candidates, built ONCE. A park is as good a seed as a lawn -- both
    # are mown grass in this palette -- but a garden is not: it has its own
    # surface and its own structure (see plant_gardens) and growing it would
    # spread planting beds across a block.
    seeds = []
    for f in feats:
        p = f["properties"]
        if p.get("k") != "area" or p.get("u") not in ("lawn", "park"):
            continue
        if f["geometry"]["type"] != "Polygon":
            continue
        try:
            q = Polygon(to_m(f["geometry"]["coordinates"][0]))
            if not q.is_valid:
                q = q.buffer(0)
            if q.is_valid and not q.is_empty:
                seeds.append(q)
        except Exception:
            pass

    total_made, total_m2 = 0, 0.0
    for label, lon, lat, grow in PRECINCTS:
        seed_pt = Point(lon * kx, lat * M_LAT)
        best, bestd = None, 1e18
        for q in seeds:
            d = q.distance(seed_pt)
            if d < bestd:
                best, bestd = q, d
        if best is None or bestd > PRECINCT_SEED_MAX_M:
            stats["precinct_no_seed_lawn"] += 1
            warnings.append("precinct %r: no seed lawn within %.0f m (nearest %.0f m)"
                            % (label, PRECINCT_SEED_MAX_M, bestd))
            continue
        grown = best.buffer(grow, join_style=1)
        cut = grown.difference(cutter) if cutter is not None else grown
        if bldu is not None:
            cut = cut.difference(bldu)
        parts = cut.geoms if cut.geom_type == "MultiPolygon" else [cut]
        made, m2 = 0, 0.0
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
            m2 += gm.area
        # MEASURED, not intended. §36's lesson: a counter incremented at emit
        # time reported seven sheens shipped on a run where all seven had been
        # deleted. This is the area of the polygons actually appended.
        print("  precinct %-24s seed %6.0f m2 at %3.0f m -> %2d parts, %7.0f m2"
              % (label, best.area, bestd, made, m2))
        if m2 > PRECINCT_WARN_M2:
            warnings.append("precinct %r grew %.0f m2, over the %.0f m2 sanity "
                            "limit -- that is a green field, not a courtyard"
                            % (label, m2, PRECINCT_WARN_M2))
        total_made += made
        total_m2 += m2
        stats["precinct_lawn_" + label.split("/")[0].strip().replace(" ", "_")] += made
    # RE-MEASURE THE RESULT, which is the check the docstring's old claim needed
    # and did not have: how much of what was just emitted is under a building?
    # It was 12.4% before the footprints went in and it has to be ~0 now.
    # WITH THE INTERIOR RINGS, and that is the whole point of the check.
    # The first version of this re-measure read `coordinates[0]` only -- the
    # exterior -- so every building-shaped HOLE the subtraction had just cut was
    # counted back in as lawn, and it reported 2.0% under a building on a file
    # that measures 0.0%. The instrument had the same bug as the thing it was
    # instrumenting, which is the §35 lesson about a script that cannot see the
    # defect it was written for.
    if builds:
        made_u = unary_union([Polygon(to_m(f["geometry"]["coordinates"][0]),
                                      [to_m(h) for h in f["geometry"]["coordinates"][1:]])
                              for f in feats
                              if f["properties"].get("src") == "precinct"
                              and f["geometry"]["type"] == "Polygon"])
        under = made_u.intersection(unary_union(builds)).area if not made_u.is_empty else 0.0
        print("  precinct lawns: %d parts, %.0f m2 total, %.0f m2 under a building "
              "(%.1f%%)  [footprints from snapshot %s]"
              % (total_made, total_m2, under, 100.0 * under / max(1.0, total_m2), snap))
        stats["precinct_m2_under_building"] = int(under)
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


# --------------------------------------------------------- road  polygons --
#
# "when im all the way down vertically and look at an angle towards the roads
#  and start facing upright, the roads get bigger. some roads dont do this."
#
# "some roads dont" was the whole clue and it is not about roads at all: the
# ones that DON'T swell are the sidewalks, because PR #70 moved their width out
# of `line-width` and into the geometry. The carriageways were left behind, so
# they still fan. Measured on merged main by scripts/verify/road-fan.mjs
# (camera on Speedway's south end, `ground-road`):
#
#     pitch 20   1.10x at the only sample still on screen
#     pitch 60   1.26x near  ->  3.33x far
#     pitch 86   1.30x near  ->  3.69x far   (over 900 m of road; it keeps going)
#
# A `line-width` is a number of SCREEN PIXELS and it is the same number for the
# whole line, while 12 m of ground under the camera is many pixels and 12 m of
# it by the horizon is a fraction of one. MapLibre has no per-vertex line width
# and no metres unit on `line-width`, so no expression can fix this -- which is
# why the fix is the same one the paths got: buffer the centreline by half its
# real width at bake time and draw a POLYGON, which gets the true perspective
# for free at every pitch and every distance.
#
# WHAT IT COSTS, MEASURED, and it is the reason the far-field armature is
# excluded below. These polygons ship in data/ground.geojson, which is NOT
# tiled -- it downloads whole. The near network (everything inside the flyable
# area) is +1.7 MB raw / +373 KB gzipped on a 1.58 MB / 293 KB file. The
# far-field arterials are another +727 KB raw for roads five to thirty km out
# that no camera in this app can approach, and drawn at their true width they
# would be a third of a pixel across and effectively erased -- which would undo
# the establishing-shot armature they exist for. So `far` stays a line, and
# js/ground.js keeps one line layer for it and one only.
ROADAREA = {
    "on": True,
    "include_far": False,       # see the note above; `far:1` stays a line
    "simplify_m": 0.15,         # same tolerance as the paths: under a pixel
    "min_area_m2": 2.0,         # drop slivers the union leaves behind
    # SIX decimal places, deliberately, even though five would save 81 KB
    # gzipped. Five is 1.1 m here, and a kerb quantised to 1.1 m is a visibly
    # ragged edge from street level -- the altitude this whole pass is about.
    "coord_dp": 6,
}


# ------------------------------------------------ a mall is not a road ------
#
# "some asphalt roads bleed into speedway"
#
# PHOTOGRAPHED before it was changed (shots/speedway/swB_zoom.png, nadir over
# Speedway at 26th): E 26th is severed by the mall, so OSM carries it as two
# stubs whose centrelines run PAST the kerb and end on the brick. Buffered with
# a flat cap, each stub becomes a grey rectangle lying on the herringbone with a
# square blunt end -- one from the east, one from the west, at slightly
# different latitudes so they do not even meet. Two more sit at 23rd. Measured
# on the shipped file: 3 carriageway polygons overlapping the mall, 23 m2.
#
# WHY THE LADDER MISSED IT. `_band` deliberately keeps `roadarea` out of the
# resolver -- the carriageway is the ladder's top rung, "because a sidewalk does
# not lie on a road" -- and the ONE cross-band cut runs the other way: the
# carriageway cuts the walk. That rule is right for a sidewalk and wrong for a
# mall. `highway=pedestrian` is OSM for a street CLOSED TO TRAFFIC. A car does
# not drive on Speedway, so the square metre is the mall's, and a road that
# merely ends on it has no claim at all.
#
# So the rule is one sentence, applied in both directions:
#   A PEDESTRIAN MALL OUTRANKS A CARRIAGEWAY. It is not cut by one, and one is
#   cut by it.
# Both halves are needed. Without the first the mall keeps the notch the
# resolver already took out of it and removing the asphalt just uncovers a hole;
# without the second the asphalt stays on top of the brick.
#
# EIGHT features carry `u:'pedestrian'` in the whole city and Speedway is one of
# them, so the blast radius is small and countable -- the stats below print it.
def is_pedestrian_mall(p):
    return p.get("k") == "patharea" and p.get("u") == "pedestrian"


def pedestrian_mall_union(feats, stats):
    """Every pedestrian mall in the scene, as ONE metric geometry, or None."""
    try:
        from shapely.ops import unary_union
    except ImportError:
        return None
    polys = []
    for f in feats:
        if f["geometry"]["type"] != "Polygon" or not is_pedestrian_mall(f["properties"]):
            continue
        q = _poly_m(f["geometry"])
        if q is not None and not q.is_empty:
            polys.append(q)
    stats["pedestrian_malls"] = len(polys)
    if not polys:
        return None
    m = unary_union(polys)
    stats["pedestrian_mall_m2"] = round(m.area)
    return m


def widen_roads(road_feats, stats, warnings, keep_out=None):
    """k:'road'/'cycle' LineStrings -> k:'roadarea'/'cyclearea' Polygons.

    Returns NEW features to append to data/ground.geojson. The LineStrings stay
    in data/roads.geojson exactly as they were: the lane markings, the stop bars
    and the bike lanes are drawn off the centreline and still need it, and
    keeping that file byte-identical means the PMTiles archive does not have to
    be rebuilt for this pass.
    """
    if not ROADAREA["on"]:
        return []
    try:
        from shapely.geometry import LineString
        from shapely.ops import unary_union
    except ImportError:
        warnings.append("shapely not installed: roads left as LineStrings, which "
                        "means they fan out with pitch (see road-fan.mjs)")
        return []

    dp = ROADAREA["coord_dp"]
    groups = {}
    for f in road_feats:
        p = f["properties"]
        kind = p.get("k")
        if kind not in ("road", "cycle"):
            continue
        if kind == "road" and p.get("far") and not ROADAREA["include_far"]:
            stats["roadarea_far_left_as_line"] += 1
            continue
        coords = f["geometry"]["coordinates"]
        if len(coords) < 2:
            continue
        w = float(p.get("w") or (9.0 if kind == "road" else 2.5))
        if w <= 0.2:
            continue
        # Mitre joins and flat caps, same as widen_paths: a round join spends a
        # dozen vertices per corner drawing a curve nobody can see at 200 m.
        try:
            poly = LineString(_line_m(coords)).buffer(
                w / 2.0, cap_style=2, join_style=2, mitre_limit=2.0)
        except Exception:
            stats["roadarea_buffer_failed"] += 1
            continue
        if poly.is_empty:
            continue
        # Grouped by everything that changes how it is DRAWN and nothing else.
        # `c` survives because js/ground.js fades service roads in by zoom and
        # `s` because the carriageway's colour is its surface. Name, lanes,
        # oneway and the bike tags are all centreline business and are dropped.
        key = ("roadarea", p.get("c") if kind == "road" else None, p.get("s"))
        groups.setdefault(key if kind == "road" else ("cyclearea", None, p.get("s")),
                          []).append(poly)
        stats["roadarea_widened_" + kind] += 1

    out = []
    for (k, cls, surf), polys in sorted(groups.items(), key=lambda kv: str(kv[0])):
        merged = unary_union(polys)
        # The mall takes its ground back. Done on the MERGED carriageway rather
        # than per-centreline so the subtraction runs once per drawn class, and
        # BEFORE simplify so the new edge is simplified with the same tolerance
        # as every other edge in the polygon -- a cut made afterwards would be
        # the one part of the road held to a different accuracy.
        if keep_out is not None and merged.intersects(keep_out):
            a0 = merged.area
            try:
                merged = merged.difference(keep_out)
            except Exception:
                warnings.append("mall difference failed on %s/%s; left uncut"
                                % (k, surf))
            else:
                stats["roadarea_mall_m2_returned"] += round(a0 - merged.area)
        if ROADAREA["simplify_m"]:
            merged = merged.simplify(ROADAREA["simplify_m"])
        parts = merged.geoms if merged.geom_type == "MultiPolygon" else [merged]
        for gm in parts:
            if gm.is_empty or gm.area < ROADAREA["min_area_m2"]:
                stats["roadarea_sliver_dropped"] += 1
                continue
            rings = [[[round(x / _KX, dp), round(y / M_LAT, dp)]
                      for x, y in gm.exterior.coords]]
            rings += [[[round(x / _KX, dp), round(y / M_LAT, dp)] for x, y in r.coords]
                      for r in gm.interiors]
            props = {"k": k, "s": surf}
            if cls:
                props["c"] = cls
            out.append({"type": "Feature",
                        "geometry": {"type": "Polygon", "coordinates": rings},
                        "properties": props})
            stats["roadarea_out_" + k + "_" + str(cls or surf)] += 1
    return out


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
    # A CROSSING OUTRANKS THE CHANNEL IT CROSSES, and this is the top of the
    # ladder. Where a street meets the creek there is a culvert or a bridge, and
    # the square metre belongs to the structure -- so the trench, both banks and
    # all three planting zones give their footprint back and the road runs over
    # the top. Without this the channel is cut straight through the carriageway
    # and the walk beside it floats over the water on nothing, which is exactly
    # what was reported. See deck_creek_crossings.
    ("bank", "deck"):           95,
    # The cut channel outranks everything else flat. That is not a preference,
    # it is the mechanism: a `fill` drawn over the trench would paint straight
    # into it (PR #62's finding), so the trench only exists BECAUSE every lawn,
    # wood and park polygon gives up its footprint here. See cut_creek_channels.
    ("bank", "channel"):        90,
    # Same argument for the pond coping: it is a built rim standing 0.38 m
    # proud, so the lawn under it has to give way or the fill paints over the
    # kerb. It sits below the channel only because nothing ever asks them to
    # compete -- keeping the two adjacent makes the ladder readable.
    ("bank", "coping"):         88,
    # A planting bed and a specimen roundel are the most specific thing in a
    # garden, so they beat the garden turf they are cut out of. They are DERIVED
    # from the walks, so they must not beat the walks -- and they do not: those
    # are in the `path` band and this is the flat one.
    ("area", "bed"):            50,
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
    # A crown is not ground. It stands 4-17 m in the air, so it neither takes a
    # square metre from the lawn under it nor gives one up -- and letting it into
    # the ladder would be actively wrong: `k:'cnp'` is unranked, so every lawn
    # and path in the corridor would cut a tree-shaped hole out of itself and
    # RANK_DEFAULT would then delete the crown that caused it.
    if p.get("k") == "cnp":
        return None
    # A carriageway polygon is not IN the ladder, it IS the ladder's top rung.
    # The resolver already cuts every path and lawn against the buffered
    # centrelines (carriageway_polys, below), so the drawn pavement is the one
    # surface that takes ground without ever giving any up. Letting it in would
    # have it cut against itself: RANK has no entry for `roadarea`, so
    # RANK_DEFAULT would hand every square metre to whatever else was there.
    if p.get("k") in ("roadarea", "cyclearea"):
        return None
    # THE WATER SHEEN IS NOT GROUND EITHER, and the first cut of it proved that
    # the hard way: it is the SAME footprint as the water prism at the SAME rank
    # in the SAME band, so the resolver handed the ground to whichever sorted
    # first and trimmed the other to nothing. All seven were emitted, all seven
    # were deleted, and the bake's own report still said `creek_water_sheen: 7`
    # because that count is taken at emit time. A stat that counts intent rather
    # than outcome is worse than no stat. It is a lid standing 0.10 m on the
    # water two metres below grade; it competes with nothing.
    if p.get("k") == "bank" and p.get("m") == "sheen":
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
    # Pedestrian malls are excluded: they are exempt from the carriageway cut on
    # purpose now (see widen_roads), so counting them here would report a defect
    # the bake deliberately does not have.
    paths = [q for p, q in items
             if p.get("k") == "patharea" and not is_pedestrian_mall(p)]
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
        # The ONE cross-band cut, and only this one -- and a pedestrian mall is
        # exempt from it, because a mall is not a sidewalk lying on a road. See
        # the note above widen_roads: this is the half of that rule that stops
        # the resolver notching the brick, and widen_roads' `keep_out` is the
        # half that stops the asphalt being painted over the notch.
        if w["band"] == "path" and road_tree is not None \
                and not is_pedestrian_mall(w["f"]["properties"]):
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
    # AFTER widen_paths on purpose: a garden's beds are derived from the
    # walks around them and paths are still LineStrings until then. The
    # precinct-lawn pass learned the same lesson the hard way (see its
    # note about buffering the path lines by hand).
    feats = plant_gardens(feats, stats, warnings)

    # The roads are baked BEFORE the ground is resolved now, because the
    # carriageway is one of the surfaces competing for the ground and the
    # resolver needs its geometry. bake_roads() itself is unchanged and still
    # writes data/roads.geojson byte for byte as it did.
    road_feats = bake_roads(stats, warnings)
    roads_m = carriageway_polys(road_feats)
    stats["carriageways_as_cutters"] = len(roads_m)

    # AFTER the roads are baked, because a crossing is defined by the way that
    # crosses; BEFORE the resolver, because the resolver is what actually takes
    # the ground back off the channel. Both halves matter -- run this after the
    # resolver and the decks are emitted into ground the trench still owns.
    feats = deck_creek_crossings(feats, road_feats, stats, warnings)

    before = count_conflicts(feats, roads_m)
    feats = resolve_ground_conflicts(feats, roads_m, stats, warnings)
    after = count_conflicts(feats, roads_m)

    # AFTER the resolver, deliberately. The planted zones are still the raw
    # buffered rings until it runs, and they overlap the carriageways and walks
    # that cross the corridor -- plant first and a crown ends up centred over
    # the middle of San Jacinto with no trunk under it. §32's rule is that the
    # TRUNK is the test, and a crown baked here has no trunk to test, so the
    # honest equivalent is to plant only in ground the corridor actually kept.
    feats = plant_creek_canopy(feats, stats, warnings)

    # AFTER the resolver, and that is the whole point: the carriageway is the
    # top rung of the ladder, so it must not be a candidate for being cut. It
    # goes in as drawn geometry only, at its full tagged width -- the same width
    # the `line` layer used to paint -- while the resolver's own copy of it is
    # inset by half a kerb (CARRIAGEWAY_INSET_M) so the gutter stays with the
    # pavement it belongs to. Two uses, two widths, on purpose.
    # ...and the malls take theirs back off the carriageway on the way in. The
    # union is taken from the RESOLVED features, so it is the ground the malls
    # actually kept rather than the raw buffered corridor.
    feats += widen_roads(road_feats, stats, warnings,
                         keep_out=pedestrian_mall_union(feats, stats))

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
    # COUNTED OFF THE FILE THAT WAS JUST WRITTEN, not off the emit counters.
    # `creek_water_sheen: 7` was printed by a run in which all seven had been
    # deleted by the resolver forty lines later. Everything derived here is
    # measured on the output, so the report cannot describe a file that does
    # not exist -- the same argument bake_art.py's re-measure makes.
    shipped = Counter()
    for f in feats:
        p = f["properties"]
        shipped["shipped_" + str(p.get("k")) + "_" +
                str(p.get("m") or p.get("s") or p.get("u"))] += 1
    report = {
        "features": len(feats),
        "file_kb": round(size_kb, 1),
        "shipped": {k: v for k, v in sorted(shipped.items())
                    if k.startswith(("shipped_bank", "shipped_cnp",
                                     "shipped_roadarea", "shipped_cyclearea"))},
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
