# -*- coding: utf-8 -*-
"""downtown_bodies.py -- downtown's buildings, from the measured massing.

Imported by scripts/bake_outer.py, which stays the one writer of
data/outer_ring.geojson. This module decides what every downtown building that
nobody has modelled by hand is MADE OF:

    data/outer/downtown_massing.json   one row per building: outline, measured
                                       levels, what the public tables claim
        -> a list of features in the outer ring's own schema (h, b, wd/wg/wn,
           t, fp, k, d ...), which replace the old guessed ones

WHAT CHANGED. The old pass drew a downtown building from one Overture outline
simplified to 1.2 m, one second-hand height, and for a tower a podium "of 2 to
5 floors by height" under a shaft "inset 15 % of the plan width" with a generic
crown box. This pass draws:

  * the OUTLINE from OpenStreetMap as mapped (0.25 m simplification, courtyards
    kept), or from the City's 2023 structures where OpenStreetMap has none;
  * the HEIGHT and the STEPS from the 2021 laser scan: each measured level is
    one extrusion standing on the one below it, so a tower sits where it really
    sits on its podium, a low wing is low, and a penthouse is the size the scan
    saw. No generic crown, mast or roof box is added to a measured building;
  * for a building the scan cannot speak for (built since early 2021), the
    height from the public tables and the old podium-and-shaft recipe, said so
    in the report.

The 25 towers modelled by hand (every feature carrying `lm`, plus Waterline's
and Sixth and Guadalupe's bodies) are not touched.

BYTES. A measured building is 1 to 6 polygons. The old generic tower was 3 to 5
(podium, shaft, crown, mast, retail band); the old mid-rise 2 to 3. The count
is printed by the bake and the tile sizes are in docs/downtown-accuracy.md.

Every number is a dial in B.
"""
import json
import math
import os

from shapely.geometry import Point, Polygon, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASSING = os.path.join(ROOT, "data", "outer", "downtown_massing.json")
DISTRICTS = os.path.join(ROOT, "data", "outer", "downtown_districts.json")
SEATS = os.path.join(ROOT, "scripts", "downtown_tower_seats.json")

B = {
    "outline_simplify_m": 0.25,    # drops doubled nodes; keeps every real corner
    "hole_min_m2": 60.0,           # a courtyard smaller than this is filled
    "no_scan_min_area_m2": 40.0,   # an outline the scan never saw, this small, is not drawn
    "dedup_share": 0.35,           # same rule as the ring: drawn by the core / Capitol already
    "authored_share": 0.40,        # this much under a hand-modelled tower = part of it
    "replace_share": 0.30,         # an old feature this far under a new building is replaced
    "authored_keepout_m": 1.0,     # upper levels keep this far from a hand-modelled tower
    "level_min_area_m2": 16.0,     # same floor as the massing bake's
    "wing_min_area_m2": 40.0,      # a measured wing beside a hand-modelled shaft
    "wing_min_rise_m": 2.5,
    "wing_shaft_min_m2": 30.0,     # hand-model pieces this big are "the shaft" a wing clears
    "wing_shaft_min_rise_m": 3.0,  # ...and this tall

    # hand-modelled towers: parts of two colours never end flush (decoplanar)
    # One round per entry; a chain of three flush parts needs two. The sum stays
    # under the 0.15 m by which a tower's top may differ from its public height
    # (scripts/verify/downtown-data.py); the coplanar check's own step is 0.01.
    "proud_m": (0.08, 0.04, 0.02),
    "proud_overlap": 0.25,         # the coplanar check's own share is 0.30

    # a level that is roof plant rather than a storey: small AND low
    "plant_share": 0.22,           # of the outline's area
    "plant_rise_m": 9.0,
    "plant_darken": -0.20,

    # heights where nothing was measured
    "m_per_level": 3.4,
    "tower_m_per_level": 3.6,

    # a building the scan did not see keeps the old tower recipe
    "generic_min_h_m": 40.0,
    "generic_crown": True,
}


def _load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _use(t):
    """One word for what the building is, from its OpenStreetMap tags."""
    b = (t.get("building") or "").lower()
    if t.get("amenity") == "parking" or b in ("parking", "garage", "garages", "carport") \
            or t.get("parking"):
        return "parking"
    if t.get("tourism") in ("hotel", "motel") or b == "hotel":
        return "hotel"
    if b in ("apartments", "residential", "dormitory", "condominium"):
        return "apartments"
    if b in ("house", "detached", "semidetached_house", "terrace", "bungalow"):
        return "house"
    if b in ("church", "cathedral", "chapel", "synagogue", "mosque") or t.get("religion"):
        return "church"
    if b in ("government", "civic", "public", "courthouse", "hospital", "university",
             "school", "college", "museum", "library", "fire_station"):
        return b
    if t.get("amenity") in ("restaurant", "bar", "pub", "cafe", "nightclub",
                            "fast_food", "theatre", "cinema") or t.get("shop") \
            or b in ("retail", "commercial", "supermarket"):
        return "retail" if b != "commercial" else "commercial"
    if t.get("office") or b == "office":
        return "office"
    if b in ("industrial", "warehouse", "service"):
        return b
    if b == "roof":
        return "roof"
    return "" if b in ("yes", "") else b


def _rings_m(bo, rings):
    ext = bo.to_metres(rings[0])
    holes = [bo.to_metres(h) for h in rings[1:]]
    p = Polygon(ext, holes).buffer(0)
    if p.geom_type == "MultiPolygon":
        p = max(p.geoms, key=lambda q: q.area)
    return p


def _coords(bo, poly):
    """A shapely polygon in bake metres -> GeoJSON coordinates, holes filtered."""
    out = [bo.to_degrees(list(poly.exterior.coords))]
    for h in poly.interiors:
        if Polygon(h).area >= B["hole_min_m2"]:
            out.append(bo.to_degrees(list(h.coords)))
    return out


def _feature(coords, props):
    return {"type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": coords},
            "properties": props}


def wings(bo, row, podium, solids, base_hex, fp, key):
    """What the scan saw of a hand-modelled tower's block ABOVE its podium and
    OUTSIDE its shaft: the low wing, the garage block, the stepped back half.

    The hand model is a shaft on a podium. Most real towers downtown are more
    than that, and the measured levels have the rest. Each level above the
    podium is cut back to clear the shaft (and whatever else the hand model
    puts up there) and drawn as a plain wall in the tower's own material.
    """
    lv = row.get("lv") or []
    if len(lv) < 2:
        return []
    keep = []
    for sld in solids:
        p = sld["properties"]
        # only real volumes count as "the shaft": a podium cap or a floor band
        # is a slab the size of the whole plan and would clear everything
        if p.get("b", 0) < podium - 0.5 or p.get("lmThin") \
                or p["h"] - p.get("b", 0) < B["wing_shaft_min_rise_m"]:
            continue
        q = Polygon(bo.to_metres(sld["geometry"]["coordinates"][0])).buffer(0)
        if q.area >= B["wing_shaft_min_m2"]:
            keep.append(q)
    keepout = unary_union(keep).buffer(B["authored_keepout_m"]) if keep else Polygon()
    j = (bo.stable01(key + ":j") - 0.5) * 0.12
    base = bo.lerp_hex(base_hex, "#ffffff" if j > 0 else "#000000", abs(j))
    wd, wg, wn = bo.tri(base, 0.0)
    rd, rg, rn = bo.make_roof_colors(bo.adjust_light(base, -0.16))
    out = []
    for k in range(1, len(lv)):
        top, plans = lv[k]
        b = max(podium, lv[k - 1][0])
        if top - b < B["wing_min_rise_m"]:
            continue
        for rings in plans:
            q = _rings_m(bo, rings).difference(keepout).buffer(0)
            for part in (q.geoms if q.geom_type == "MultiPolygon" else [q]):
                if part.geom_type != "Polygon" or part.area < B["wing_min_area_m2"]:
                    continue
                part = part.buffer(-0.6, join_style=2).buffer(0.6, join_style=2)   # no slivers
                if part.geom_type != "Polygon" or part.area < B["wing_min_area_m2"]:
                    continue
                out.append(_feature(_coords(bo, part), {
                    "h": round(top, 1), "b": round(b, 1), "wd": wd, "wg": wg, "wn": wn,
                    "fp": fp, "t": 1, "rd": rd, "rg": rg, "rn": rn, "d": 0}))
    return out


def build(bo, feats, rep):
    """Return (kept_old_features, new_features). `feats` is the ring as baked."""
    from downtown_facade_profiles import PROFILES, profile_for
    from downtown_tower_identities import TOWER_IDENTITIES, build_tower_identity
    from downtown_landmarks import LANDMARKS

    massing = _load(MASSING)
    downtown = unary_union([shape(r["g"]) for r in _load(DISTRICTS)["rows"]])
    dt_m = unary_union([_rings_m(bo, [list(q.exterior.coords)]) for q in
                        (downtown.geoms if downtown.geom_type == "MultiPolygon"
                         else [downtown])])

    # ── what is already drawn by the core and the Capitol bakes ───────
    # The core box belongs to the dated snapshot whole: nothing is added there.
    # (bo.CORE_SNAP names the date the ring was first baked against; any
    # snapshot will do for the overlap test, so the newest on disk is used.)
    core_snap = bo.CORE_SNAP
    if not os.path.exists(core_snap):
        latest = (bo.load(os.path.join(ROOT, "data", "manifest.json"), {}) or {}).get("latest")
        core_snap = os.path.join(ROOT, "data", "snapshots", str(latest),
                                 "buildings.detailed.geojson")
    existing = []
    for path in (core_snap, bo.CAPITOL):
        for f in (bo.load(path, {"features": []}) or {}).get("features", []):
            g = f.get("geometry") or {}
            polys = [g["coordinates"]] if g.get("type") == "Polygon" else \
                (g.get("coordinates") or []) if g.get("type") == "MultiPolygon" else []
            for pc in polys:
                try:
                    q = Polygon(bo.to_metres(pc[0])).buffer(0)
                except Exception:  # noqa: BLE001
                    continue
                if not q.is_empty:
                    existing.append(q)
    ex_tree = STRtree(existing) if existing else None

    # ── the old features, sorted into kept and replaceable ────────────
    old = []
    for f in feats:
        try:
            q = Polygon(bo.to_metres(f["geometry"]["coordinates"][0])).buffer(0)
        except Exception:  # noqa: BLE001
            q = Polygon()
        old.append(q)

    # the ring's own (score -> d) relation downtown, so new bodies thin with
    # the graphics menu the way their neighbours do
    # Read off the bodies OUTSIDE the districts, which this pass never touches,
    # with the bake's own score (height, size, distance from the two anchors):
    # so a second run gives the same answer as the first.
    rank = []
    for f, q in zip(feats, old):
        p = f["properties"]
        if p.get("k") or p.get("t") == 1 or p.get("lm") or q.is_empty or "d" not in p:
            continue
        c = q.representative_point()
        if dt_m.contains(c):
            continue
        lon = bo.OUTER["minlon"] + c.x / bo.M_LON
        lat = bo.OUTER["minlat"] + c.y / bo.M_LAT
        dist = min(bo.dist_outside_rect(lon, lat, bo.CORE),
                   bo.dist_outside_rect(lon, lat, bo.DOWNTOWN))
        rank.append((p["h"] * 3.0 + math.sqrt(q.area) - dist * 0.010, p["d"]))
    rank.sort()
    # d falls as the score rises; keep the relation monotone for the search
    for i in range(len(rank) - 2, -1, -1):
        if rank[i][1] < rank[i + 1][1]:
            rank[i] = (rank[i][0], rank[i + 1][1])

    def d_for(h, area):
        s = h * 3.0 + math.sqrt(area)
        if not rank:
            return 0.5
        lo, hi = 0, len(rank) - 1
        if s <= rank[0][0]:
            return rank[0][1]
        if s >= rank[-1][0]:
            return rank[-1][1]
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if rank[mid][0] <= s:
                lo = mid
            else:
                hi = mid
        return round(rank[lo][1], 3)

    # ── curated public heights, one outline each (the bake's own rule) ─
    entries = list((bo.load(bo.OVERRIDES, {"by_point": []}) or {}).get("by_point") or [])
    known = {e.get("name") for e in entries}
    entries += [dict(name=nm, lon=cfg["center"][0], lat=cfg["center"][1],
                     height=cfg["height"])
                for nm, cfg in TOWER_IDENTITIES.items() if nm not in known]

    units = []
    for r in massing["rows"]:
        if not r.get("dt"):
            continue
        P = _rings_m(bo, r["g"])
        if P.is_empty:
            continue
        units.append({"r": r, "P": P})
    u_tree = STRtree([u["P"] for u in units])
    for e in entries:
        x = (e["lon"] - bo.OUTER["minlon"]) * bo.M_LON
        y = (e["lat"] - bo.OUTER["minlat"]) * bo.M_LAT
        pt = Point(x, y)
        best = None
        for j in u_tree.query(pt.buffer(bo.HEIGHT_MATCH_M)):
            u = units[int(j)]
            inside = u["P"].contains(pt)
            key = (1 if inside else 0, u["P"].area if inside else -u["P"].distance(pt))
            if best is None or key > best[0]:
                best = (key, u)
        if best:
            best[1].setdefault("curated", []).append(e)

    # ── hand-modelled towers: re-seated on the scan where that measures better ──
    seats = (bo.load(SEATS, {}) or {}).get("towers") or {}
    by_id = {u["r"]["id"]: u for u in units}
    reseat = {}                    # lm key -> new features
    wing_feats = []                # measured wings beside re-seated shafts
    for nm, seat in seats.items():
        u = by_id.get(seat.get("outline"))
        if not (seat.get("used") and u and nm in TOWER_IDENTITIES):
            continue
        cfg = TOWER_IDENTITIES[nm]
        solids = build_tower_identity(bo, nm, cfg["height"], 0.0,
                                      footprint=list(u["P"].exterior.coords), seat=seat)
        for sld in solids:
            sld["properties"]["d"] = 0
        if seat.get("wings"):
            fp_w = profile_for(nm, "commercial", cfg["height"], u["P"].area)
            extra = wings(bo, u["r"], seat["podium"], solids, PROFILES[fp_w]["wd"],
                          fp_w, u["r"]["id"])
            wing_feats.extend(extra)
        reseat[cfg["key"]] = solids
    lm_polys = [q for f, q in zip(feats, old)
                if f["properties"].get("lm") and f["properties"]["lm"] not in reseat
                and not q.is_empty]
    for solids in reseat.values():
        for sld in solids:
            q = Polygon(bo.to_metres(sld["geometry"]["coordinates"][0])).buffer(0)
            if not q.is_empty:
                lm_polys.append(q)
    lm_union = unary_union(lm_polys) if lm_polys else Polygon()
    # The two landmarks of scripts/downtown_landmarks.py keep a body that
    # carries no `lm`; it is known only by lying under their pieces.
    landmark_keys = {cfg["key"] for cfg in LANDMARKS.values()}
    lmk = [q for f, q in zip(feats, old)
           if f["properties"].get("lm") in landmark_keys and not q.is_empty]
    landmark_union = unary_union(lmk) if lmk else Polygon()
    lm_keepout = lm_union.buffer(B["authored_keepout_m"]) if lm_polys else Polygon()

    n = {"units": len(units), "measured": 0, "generic": 0, "authored": 0,
         "other_file": 0, "not_drawn": 0, "levels": 0, "plant": 0, "retail": 0,
         "unmapped_today": 0}
    new, drawn_polys, names = [], [], []
    for u in units:
        r, P = u["r"], u["P"]
        t = r.get("t") or {}
        area = P.area
        # drawn by the core snapshot or the Capitol bake already?
        lon_c = bo.OUTER["minlon"] + P.centroid.x / bo.M_LON
        lat_c = bo.OUTER["minlat"] + P.centroid.y / bo.M_LAT
        if bo.in_rect(lon_c, lat_c, bo.CORE):
            n["other_file"] += 1
            u["state"] = "other_file"
            continue
        if ex_tree is not None:
            hit = False
            for j in ex_tree.query(P):
                g = existing[int(j)]
                if P.intersection(g).area > B["dedup_share"] * min(area, g.area):
                    hit = True
                    break
            if hit:
                n["other_file"] += 1
                u["state"] = "other_file"
                continue
        if r["src"] == "city":
            # In the City's 2023 survey but not on today's map. Downtown's map is
            # kept current and the survey is not (the Convention Center, pulled
            # down in 2025, is still in it), so the map decides: not drawn here.
            # If the old ring drew something on this spot it is left as it was.
            n["unmapped_today"] += 1
            u["state"] = "unmapped"
            continue
        if not lm_union.is_empty and P.intersection(lm_union).area > B["authored_share"] * area:
            n["authored"] += 1
            u["state"] = "authored"
            drawn_polys.append(P)
            continue

        lv = r.get("lv")
        cur = max((float(e["height"]) for e in u.get("curated", [])), default=None)
        name = t.get("name") or (u["curated"][0]["name"] if u.get("curated") else None)
        use = _use(t)
        levels_tag = r.get("osm_lv")
        if lv:
            tops = [l[0] for l in lv]
            state = "measured"
        else:
            if area < B["no_scan_min_area_m2"] and not (cur or r.get("osm_h")):
                n["not_drawn"] += 1
                u["state"] = "not_drawn"
                continue
            h = cur or r.get("osm_h") or r.get("city_h")
            if not h and levels_tag:
                h = levels_tag * (B["tower_m_per_level"] if levels_tag >= 12
                                  else B["m_per_level"])
            if not h and r.get("p90"):
                h = r["p90"]
            if not h:
                h = bo.CLASS_DEFAULT.get(t.get("building"), bo.FALLBACK_DEFAULT)
            tops = [round(float(h), 1)]
            state = "generic"
        h_top = max(tops)
        n[state] += 1
        u["state"] = state
        drawn_polys.append(P)

        lon = bo.OUTER["minlon"] + P.centroid.x / bo.M_LON
        lat = bo.OUTER["minlat"] + P.centroid.y / bo.M_LAT
        key = r["id"]
        is_tower = h_top >= bo.TOWER_H
        is_mid = (not is_tower and h_top >= bo.MIDRISE_H and area >= bo.MIDRISE_AREA)
        ring_m = list(P.exterior.coords)
        width = bo.plan_width(ring_m, area)
        fp = None
        if is_tower or is_mid:
            fp = profile_for(name, use or t.get("building"), h_top, area,
                             t.get("start_date"), levels_tag, width)
            base = PROFILES[fp]["wd"]
        else:
            base = bo.PALETTE[bo.material_for(use or t.get("building"), h_top, area,
                                              lon, lat, key, 1)]
        j = (bo.stable01(key + ":j") - 0.5) * 0.12
        base = bo.lerp_hex(base, "#ffffff" if j > 0 else "#000000", abs(j))
        wd, wg, wn = bo.tri(base, 0.0)
        wall = {"wd": wd, "wg": wg, "wn": wn}
        if fp:
            wall.update(fp=fp, use=use or "unknown", fa=round(area),
                        fw=round(width, 1))
            if levels_tag:
                wall["lv"] = int(levels_tag)
            rd, rg, rn = bo.make_roof_colors(bo.adjust_light(base, -0.16))
            wall.update(t=1 if is_tower else 2, rd=rd, rg=rg, rn=rn)
        d = 0.0 if is_tower else d_for(h_top, area)

        def wall_piece(poly, b, h, body=False):
            props = {"h": round(h, 1)}
            props.update(wall)
            props["d"] = d if body else 0
            if b > 0.05:
                props["b"] = round(b, 1)
            return _feature(_coords(bo, poly), props)

        def flat_piece(poly, b, h, colour, kind="c"):
            a, g, nn = bo.tri(colour, 0.0)
            props = {"h": round(h, 1), "wd": a, "wg": g, "wn": nn, "k": kind, "d": 0}
            if b > 0.05:
                props["b"] = round(b, 1)
            return _feature(_coords(bo, poly), props)

        outline = P.simplify(B["outline_simplify_m"]).buffer(0)
        if outline.is_empty or outline.geom_type != "Polygon":
            outline = P

        if state == "generic" and is_tower and area >= bo.DT["shaft_min_area_m2"]:
            # the old recipe, for a tower the scan never saw
            floors = next(nf for lim, nf in bo.DT["podium_floors"] if h_top < lim)
            pod = min(max(bo.DT["podium_min_m"], floors * bo.DT["podium_floor_m"]),
                      h_top * bo.DT["podium_max_frac"])
            sb = max(bo.DT["setback_min_m"],
                     min(bo.DT["setback_max_m"], bo.DT["setback_frac"] * width))
            shaft = outline.buffer(-sb, join_style=2)
            if shaft.geom_type == "MultiPolygon":
                shaft = max(shaft.geoms, key=lambda q: q.area)
            if shaft.is_empty or shaft.area < 0.34 * area or h_top - pod < 15.0:
                new.append(wall_piece(outline, 0.0, h_top, body=True))
                roof_poly, roof_z = outline, h_top
            else:
                new.append(wall_piece(outline, 0.0, pod, body=True))
                crown_h = max(bo.DT["crown_min_m"],
                              min(bo.DT["crown_max_m"], bo.DT["crown_frac"] * h_top))
                crown = shaft.buffer(-bo.DT["crown_inset_m"], join_style=2)
                if B["generic_crown"] and crown.geom_type == "Polygon" \
                        and crown.area >= bo.DT["crown_min_area_m2"]:
                    new.append(wall_piece(shaft, pod, h_top - crown_h))
                    new.append(flat_piece(crown, h_top - crown_h, h_top,
                                          bo.adjust_light(base, B["plant_darken"])))
                else:
                    new.append(wall_piece(shaft, pod, h_top))
        else:
            new.append(wall_piece(outline, 0.0, tops[0], body=True))
            below = tops[0]
            for k in range(1, len(tops)):
                top, plans = lv[k]
                polys = []
                for rings in plans:
                    q = _rings_m(bo, rings)
                    # nothing of this building is drawn inside a hand-modelled
                    # tower: that volume is the tower's
                    if not lm_keepout.is_empty:
                        q = q.difference(lm_keepout).buffer(0)
                    for part in (q.geoms if q.geom_type == "MultiPolygon" else [q]):
                        if part.geom_type == "Polygon" and part.area >= B["level_min_area_m2"]:
                            polys.append(part)
                if not polys:
                    continue
                lvl_area = sum(q.area for q in polys)
                is_plant = (k == len(tops) - 1
                            and lvl_area < B["plant_share"] * area
                            and top - below <= B["plant_rise_m"])
                for q in polys:
                    if is_plant:
                        new.append(flat_piece(q, below, top,
                                              bo.adjust_light(base, B["plant_darken"])))
                        n["plant"] += 1
                    else:
                        new.append(wall_piece(q, below, top))
                        n["levels"] += 1
                below = top

        # ── the ground-floor band: the ring's own rule, on the new outline ──
        if tops[0] >= bo.DT["retail_min_building_h_m"] \
                and area >= bo.DT["retail_min_area_m2"] and use != "parking":
            band = outline.buffer(bo.DT["retail_out_m"], join_style=2)
            rh = max(bo.DT["retail_min_h_m"],
                     min(bo.DT["retail_h_m"], tops[0] * bo.DT["retail_max_frac"]))
            if band.geom_type == "Polygon" and rh < tops[0] - 0.5:
                band = Polygon(band.exterior.coords)      # the band has no courtyard
                new.append(flat_piece(
                    band, 0.0, rh,
                    bo.lerp_hex(bo.adjust_light(base, -0.18), bo.STOREFRONT, 0.45),
                    kind="r"))
                n["retail"] += 1
        names.append((name, state, round(h_top, 1)))

    # ── which old features the new buildings replace ──────────────────
    new_union = unary_union(drawn_polys) if drawn_polys else Polygon()
    kept, removed = [], 0
    orphans = 0
    for f, q in zip(feats, old):
        p = f["properties"]
        if p.get("lm") in reseat:
            continue                  # replaced by the re-seated tower below
        if p.get("lm") or p.get("k") == "g" or q.is_empty:
            kept.append(f)
            continue
        if p.get("t") == 1 and not p.get("k") and not landmark_union.is_empty \
                and q.intersection(landmark_union).area > 0.5 * q.area:
            kept.append(f)            # Waterline's / Sixth and Guadalupe's own body
            continue
        # Under a building this pass draws: replaced, wherever its own middle
        # falls (a building on the district line has pieces on both sides).
        if q.intersection(new_union).area >= B["replace_share"] * q.area:
            removed += 1
        else:
            kept.append(f)
            # downtown, but no public outline under it: left as it was
            if not p.get("k") and dt_m.contains(q.representative_point()):
                orphans += 1
    for solids in reseat.values():
        new.extend(solids)
    new.extend(wing_feats)
    n["wings"] = len(wing_feats)
    n["reseated"] = len(reseat)
    n.update(old_removed=removed, old_kept_no_outline=orphans, new_features=len(new))
    # which reference outline was drawn how: read by scripts/verify/downtown-accuracy.py
    n["state"] = {u["r"]["id"]: u["state"][0] for u in units
                  if u.get("state") in ("measured", "generic")}
    rep["downtown_bodies"] = n
    return kept, new


def decoplanar(feats):
    """No two differently coloured parts of one hand-modelled tower end flush.

    The tower builders finish piers, rims, caps and bands at exactly the roof
    line of the glass they stand against. Two top faces at one height have no
    defined winner on screen: 1,400 such pairs of two colours were in the ring.
    A real pier, rim or cap stands a little proud of the glazing, so the smaller
    part of each pair is raised by a few centimetres (B["proud_m"], one round
    per entry, so a chain of three is settled in turn). Same-coloured pairs are left: either face paints the same pixel.
    Changes nothing on a second run (no flush pair is left to find).
    """
    groups = {}
    for f in feats:
        lm = f["properties"].get("lm")
        if lm:
            groups.setdefault(lm, []).append(f)
    raised = 0
    for lm, group in groups.items():
        polys = {}
        for step in B["proud_m"]:
            by_top = {}
            for f in group:
                by_top.setdefault(round(f["properties"]["h"], 2), []).append(f)
            lift = {}
            for top, same in by_top.items():
                if len(same) < 2:
                    continue
                for f in same:
                    if id(f) not in polys:
                        try:
                            polys[id(f)] = Polygon(f["geometry"]["coordinates"][0]).buffer(0)
                        except Exception:  # noqa: BLE001
                            polys[id(f)] = Polygon()
                tree = STRtree([polys[id(f)] for f in same])
                for a_i, a in enumerate(same):
                    qa = polys[id(a)]
                    if qa.is_empty:
                        continue
                    for b_i in tree.query(qa):
                        b_i = int(b_i)
                        if b_i <= a_i:
                            continue
                        b = same[b_i]
                        if a["properties"]["wd"] == b["properties"]["wd"]:
                            continue
                        qb = polys[id(b)]
                        small, big = (a, b) if qa.area <= qb.area else (b, a)
                        if qb.is_empty or qa.intersection(qb).area <= \
                                B["proud_overlap"] * min(qa.area, qb.area):
                            continue
                        lift[id(small)] = small
            if not lift:
                break
            for f in lift.values():
                f["properties"]["h"] = round(f["properties"]["h"] + step, 2)
                raised += 1
    return raised


def patch(bo, path, check=False):
    """Re-make downtown inside an already baked ring (no raw extract needed)."""
    fc = _load(path)
    rep = {}
    kept, new = build(bo, fc["features"], rep)
    out = kept + new
    rep["downtown_bodies"]["proud_parts"] = decoplanar(out)
    out, rep["downtown_bodies"]["pads_dropped"] = bo.settle_green(out)
    if not check:
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"type": "FeatureCollection", "features": out}, f,
                      separators=(",", ":"))
    rep["features"] = len(out)
    rep["file_kb"] = os.path.getsize(path) // 1024
    if not check:
        # the bake's report keeps this pass's counts beside the others
        full = bo.load(bo.REPORT, {}) or {}
        # Three counts depend on what the ring held before (a second run finds
        # its own features and already-settled pads), so they are printed, not
        # recorded: the report must not change when nothing else does.
        full.setdefault("downtown_detail", {})["downtown_bodies"] = {
            k: v for k, v in rep["downtown_bodies"].items()
            if k not in ("old_removed", "proud_parts", "pads_dropped")}
        with open(bo.REPORT, "w", encoding="utf-8") as f:
            json.dump(full, f, indent=2)
    short = dict(rep["downtown_bodies"])
    short["state"] = "%d outlines" % len(short.get("state", {}))
    return {"downtown_bodies": short, "features": rep["features"],
            "file_kb": rep["file_kb"]}
