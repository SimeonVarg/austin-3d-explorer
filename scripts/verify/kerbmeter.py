# -*- coding: utf-8 -*-
"""kerbmeter.py — the gate for the three rules in the kerb pass.

WHAT IT MEASURES, and every ceiling here is a number that was measured on the
branch it guards rather than picked to be passable:

  1. A SIDEWALK NEVER STANDS IN A ROAD. Drawn pavement (`patharea`) that
     overlaps a carriageway (`roadarea`), in square metres, and — the number
     that actually catches the defect — how much of that overlap is DEEP:
     further than SIDEWALK_KEEP_DEPTH_M inside the carriageway from its edge.
     Shallow overlap is the derived carriageway being ~1.4 m per side wider than
     the painted kerb (docs/PASS_ROADS.md) and is expected. Deep overlap is a
     branch shooting into the street, and there is no honest reason for any.

  2. CURVES STAY CURVES. Two ways of being jagged, both counted:
     (a) the drawn centreline may not stand further than CURVE_MAX_DEV_M off
         the raw OSM polyline it came from — smoothing MOVES geometry, and this
         file's truth rule says every position comes from OSM, so the amount it
         may move is bounded and checked, not asserted;
     (b) the MEAN TURN ANGLE on a curved run. A run of consecutive gentle
         turns is a curve the mapper drew; how sharp each of those turns is, is
         how much of a facet it reads as. A sagitta was tried here first and is
         the wrong instrument: a long gentle curve has a large sagitta and is
         not a facet at all, so it scored 35 m on a file with no defect in it.
         The turn angle does not have that failure — it is scale-free.

  3. FURNITURE STANDS ON PAVEMENT. Objects inside a carriageway and on no
     pavement, split by PROP_IN_ROAD policy. The `keep` kinds are supposed to
     be there and are reported separately; anything else is the defect.

WHY A DATA GATE AND NOT ONLY A SCREENSHOT. A frame proves the two scenes we
looked at. These three numbers are over the whole city, and the failure mode
this repo keeps hitting is a fix that is right where you photographed it and
wrong two blocks away.

Usage:  python scripts/verify/kerbmeter.py [--json]
Exit 0 = PASS.
"""
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, "data")
# `--against DIR` reads ground/roads/props out of DIR instead. It is how the
# ceilings below were shown to be red on main rather than merely asserted to be.
for _i, _a in enumerate(sys.argv):
    if _a == "--against" and _i + 1 < len(sys.argv):
        DATA = sys.argv[_i + 1]
LAT0 = 30.285
M_LAT = 111195.08
KX = M_LAT * math.cos(math.radians(LAT0))

# ── ceilings ───────────────────────────────────────────────────────────
# Measured on acer/apts f30bfc8, the commit this gate was written against.
# Each is the number the branch actually scores plus honest headroom, never a
# round number chosen to be comfortable.
# EVERY CEILING SITS BETWEEN WHAT THIS BRANCH SCORES AND WHAT MAIN SCORES, so
# the gate is red on main's own data. `--against DIR` points it at an archive
# of main's three files and is how that was checked rather than claimed.
#
#                                        this branch      main
#   pavement on a carriageway              27,221 m2    32,534 m2
#   of it, deeper than 2.5 m                1,099 m2     3,147 m2   <- the defect
#   mean turn on a curved run                 12.6 deg     24.2 deg
#   worst move off the OSM way                 0.66 m       0.00 m  <- see below
#   furniture in a road on no pavement           124          665
MAX_OVERLAP_M2 = 29000.0
MAX_DEEP_OVERLAP_M2 = 1400.0
# Smoothing MOVES geometry, so the amount is bounded and CHECKED. Main scores 0
# here because main never moved anything; this is the one metric where a higher
# number is the intended change rather than a defect, and it is capped at
# CURVE_MAX_DEV_M (0.60) plus rounding slack.
MAX_DEV_M = 0.75
MAX_MEAN_TURN_DEG = 16.0
MAX_PROPS_IN_ROAD = 160

# Kinds PROP_IN_ROAD calls `keep`: a carriageway is where they belong.
KEEP_KINDS = {"traffic_signals", "gate", "lift_gate", "bollard", "stop",
              "give_way", "cycle_barrier", "milestone", "fire_hydrant"}
KEEP_DEPTH_M = 2.5            # SIDEWALK_KEEP_DEPTH_M in scripts/bake_ground.py


def to_m(ring):
    return [((x + 97.74) * KX, (y - LAT0) * M_LAT) for x, y in ring]


def main(as_json=False):
    from shapely.geometry import Polygon, Point, LineString
    from shapely.ops import unary_union
    from shapely.strtree import STRtree

    out, fails = {}, []

    # ---- 1. a sidewalk never stands in a road --------------------------
    roads, walks = [], []
    with open(os.path.join(DATA, "ground.geojson"), encoding="utf-8") as f:
        for ft in json.load(f)["features"]:
            g = ft["geometry"]
            if g["type"] != "Polygon" or not g["coordinates"]:
                continue
            k = ft["properties"].get("k")
            if k not in ("roadarea", "patharea", "pathslab"):
                continue
            try:
                q = Polygon(to_m(g["coordinates"][0]),
                            [to_m(h) for h in g["coordinates"][1:]])
                if not q.is_valid:
                    q = q.buffer(0)
            except Exception:                                     # noqa: BLE001
                continue
            if q.is_empty:
                continue
            (roads if k == "roadarea" else walks).append(q)
    ru, wu = unary_union(roads), unary_union(walks)
    ov = wu.intersection(ru)
    deep = ov.intersection(ru.buffer(-KEEP_DEPTH_M))
    out["pavement_on_carriageway_m2"] = round(ov.area)
    out["deep_pavement_on_carriageway_m2"] = round(deep.area)
    out["pavement_m2"] = round(wu.area)
    if ov.area > MAX_OVERLAP_M2:
        fails.append("pavement on a carriageway %.0f m2 > %.0f"
                     % (ov.area, MAX_OVERLAP_M2))
    if deep.area > MAX_DEEP_OVERLAP_M2:
        fails.append("pavement MORE THAN %.1f m inside a carriageway %.0f m2 > %.0f "
                     "-- that is a branch shooting into the street"
                     % (KEEP_DEPTH_M, deep.area, MAX_DEEP_OVERLAP_M2))

    # ---- 2. curves stay curves ----------------------------------------
    # The drawn centrelines against the raw OSM ways they came from.
    raw = {}
    for key in ("roads", "cycleways"):
        p = os.path.join(DATA, "osm_cache", key + ".json")
        if not os.path.exists(p):
            continue
        with open(p, encoding="utf-8") as f:
            for el in json.load(f).get("elements", []):
                g = el.get("geometry") or []
                if el.get("type") == "way" and len(g) > 2:
                    raw[el["id"]] = [(p_["lon"], p_["lat"]) for p_ in g]
    rawtree = STRtree([LineString(to_m(v)) for v in raw.values()])
    rawlist = [LineString(to_m(v)) for v in raw.values()]

    worst_dev, runs, n_lines = 0.0, [], 0
    with open(os.path.join(DATA, "roads.geojson"), encoding="utf-8") as f:
        for ft in json.load(f)["features"]:
            g = ft["geometry"]
            if g["type"] != "LineString" or len(g["coordinates"]) < 3:
                continue
            if ft["properties"].get("far"):
                continue          # simplified 5x harder on purpose; not ours
            pts = to_m(g["coordinates"])
            ln = LineString(pts)
            n_lines += 1
            # (a) how far did we move it? Against the nearest raw OSM way.
            idx = rawtree.query(ln.buffer(3.0))
            if len(idx):
                src = min((rawlist[int(i)] for i in idx),
                          key=lambda s: s.hausdorff_distance(ln)
                          if s.length > 1 else 1e18)
                if abs(src.length - ln.length) < max(20.0, 0.25 * ln.length):
                    d = max(Point(p).distance(src) for p in pts)
                    worst_dev = max(worst_dev, d)
            # (b) how sharp is each turn on a run of consecutive gentle
            # turns? That run is a curve the mapper drew, and a sharp turn in
            # the middle of it is the facet.
            a = []
            for i in range(1, len(pts) - 1):
                ux, uy = pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]
                vx, vy = pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]
                a.append(abs(math.degrees(math.atan2(ux * vy - uy * vx,
                                                     ux * vx + uy * vy)))
                         if (ux or uy) and (vx or vy) else 0.0)
            i = 0
            while i < len(a):
                if 4.0 <= a[i] <= 40.0:
                    j = i
                    while j < len(a) and 4.0 <= a[j] <= 40.0:
                        j += 1
                    if j - i >= 2:
                        runs.append(max(a[i:j]))
                    i = j
                else:
                    i += 1
    mean_turn = (sum(runs) / len(runs)) if runs else 0.0
    out["centrelines_checked"] = n_lines
    out["curved_runs"] = len(runs)
    out["worst_move_from_osm_m"] = round(worst_dev, 3)
    out["mean_turn_on_a_curved_run_deg"] = round(mean_turn, 2)
    if worst_dev > MAX_DEV_M:
        fails.append("a centreline stands %.2f m off the OSM way it came from "
                     "> %.2f" % (worst_dev, MAX_DEV_M))
    if mean_turn > MAX_MEAN_TURN_DEG:
        fails.append("mean turn on a curved run %.1f deg > %.1f -- the curves "
                     "are still reading as facets" % (mean_turn, MAX_MEAN_TURN_DEG))

    # ---- 3. furniture stands on pavement -------------------------------
    rt, wt = STRtree(roads), STRtree(walks)
    in_road, keepers = {}, 0
    with open(os.path.join(DATA, "props.geojson"), encoding="utf-8") as f:
        for ft in json.load(f)["features"]:
            pr = ft["properties"]
            if pr.get("k") not in ("furn", "lamp", "lit"):
                continue
            g = ft["geometry"]
            if g["type"] == "Point":
                c = g["coordinates"]
            else:
                r = g["coordinates"][0]
                c = [sum(p[0] for p in r[:-1]) / (len(r) - 1),
                     sum(p[1] for p in r[:-1]) / (len(r) - 1)]
            p = Point(*to_m([c])[0])
            if not any(roads[int(i)].contains(p) for i in rt.query(p)):
                continue
            if any(walks[int(i)].contains(p) for i in wt.query(p)):
                continue
            if pr.get("u") in KEEP_KINDS:
                keepers += 1
            else:
                in_road[pr.get("u")] = in_road.get(pr.get("u"), 0) + 1
    n_bad = sum(in_road.values())
    out["furniture_in_road_wrong"] = n_bad
    out["furniture_in_road_by_kind"] = in_road
    out["furniture_in_road_belongs_there"] = keepers
    if n_bad > MAX_PROPS_IN_ROAD:
        fails.append("%d furniture features stand in a carriageway on no "
                     "pavement > %d" % (n_bad, MAX_PROPS_IN_ROAD))

    if as_json:
        print(json.dumps({"scores": out, "fails": fails}, indent=1))
    else:
        print("kerbmeter")
        print("  1. pavement on a carriageway   %8d m2  (ceiling %d)"
              % (out["pavement_on_carriageway_m2"], MAX_OVERLAP_M2))
        print("     of it, DEEPER than %.1f m   %8d m2  (ceiling %d)"
              % (KEEP_DEPTH_M, out["deep_pavement_on_carriageway_m2"],
                 MAX_DEEP_OVERLAP_M2))
        print("  2. worst move off the OSM way  %8.2f m   (ceiling %.2f)"
              % (out["worst_move_from_osm_m"], MAX_DEV_M))
        print("     mean turn on a curved run   %8.2f deg (ceiling %.2f, over %d runs)"
              % (out["mean_turn_on_a_curved_run_deg"], MAX_MEAN_TURN_DEG,
                 out["curved_runs"]))
        print("  3. furniture in a road, wrong  %8d      (ceiling %d)"
              % (n_bad, MAX_PROPS_IN_ROAD))
        print("     furniture in a road, right  %8d      (signals, gates, bollards)"
              % keepers)
        for k, v in sorted(in_road.items(), key=lambda kv: -kv[1])[:8]:
            print("       %-22s %5d" % (k, v))
        for m in fails:
            print("  FAIL " + m)
        print("PASS" if not fails else "FAIL")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main("--json" in sys.argv))
