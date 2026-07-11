# Fetch UT Austin / West Campus tree + landscape data from Overpass and emit
# ready-to-render low-poly GeoJSON (trees.geojson, landscape.geojson).
# stdlib only, deterministic (no random).

import hashlib
import json
import math
import os
import sys
import time
import urllib.request
import urllib.parse
import urllib.error

PRIMARY = "https://overpass-api.de/api/interpreter"
FALLBACK = "https://overpass.kumi.systems/api/interpreter"
BBOX = "30.276,-97.752,30.296,-97.726"  # south,west,north,east

DATA_DIR = r"C:/Users/simip/Projects/austin-3d-explorer/data"
TREES_PATH = os.path.join(DATA_DIR, "trees.geojson")
LANDSCAPE_PATH = os.path.join(DATA_DIR, "landscape.geojson")

M_PER_DEG_LAT = 111320.0

warnings = []


def overpass(query):
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    attempts = [PRIMARY, PRIMARY, FALLBACK]  # primary, retry once, then fallback
    last_err = None
    for i, url in enumerate(attempts):
        try:
            req = urllib.request.Request(url, data=body, headers={
                "User-Agent": "austin-3d-explorer/1.0 (educational low-poly map)"
            })
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            last_err = e
            code = getattr(e, "code", None)
            sys.stderr.write("attempt %d on %s failed: %s (code=%s)\n" % (i + 1, url, e, code))
            if i < len(attempts) - 1:
                time.sleep(5)
    raise RuntimeError("all Overpass attempts failed: %s" % last_err)


def det_jitter(lon, lat, salt, scale):
    """Deterministic jitter in [0, scale] from hashed rounded coordinates."""
    key = "%s:%s:%s" % (round(lon, 6), round(lat, 6), salt)
    h = hashlib.md5(key.encode("utf-8")).digest()
    return (int.from_bytes(h[:4], "big") / 0xFFFFFFFF) * scale


def m_to_deg(meters, lat):
    dlat = meters / M_PER_DEG_LAT
    dlon = meters / (M_PER_DEG_LAT * math.cos(math.radians(lat)))
    return dlon, dlat


def square(lon, lat, half_m):
    dlon, dlat = m_to_deg(half_m, lat)
    ring = [
        [lon - dlon, lat - dlat],
        [lon + dlon, lat - dlat],
        [lon + dlon, lat + dlat],
        [lon - dlon, lat + dlat],
    ]
    ring.append(list(ring[0]))
    return [[round(x, 7) for x in pt] for pt in ring]


def octagon(lon, lat, radius_m):
    dlon1, dlat1 = m_to_deg(radius_m, lat)
    ring = []
    for i in range(8):
        a = math.radians(22.5 + i * 45.0)  # offset so octagon has flat bottom
        ring.append([lon + dlon1 * math.cos(a), lat + dlat1 * math.sin(a)])
    ring.append(list(ring[0]))
    return [[round(x, 7) for x in pt] for pt in ring]


def parse_meters(val):
    """Parse OSM length tags like '12', '12 m', '12.5m'. Returns float or None."""
    if val is None:
        return None
    s = str(val).strip().lower().replace("m", "").replace(" ", "").replace(",", ".")
    try:
        f = float(s)
        return f if f > 0 else None
    except ValueError:
        return None


def tree_features(lon, lat, tags):
    tags = tags or {}
    feats = []
    # trunk: square, half-width 0.6 m
    feats.append({
        "type": "Feature",
        "properties": {"kind": "trunk", "h": 2.5, "base": 0},
        "geometry": {"type": "Polygon", "coordinates": [square(lon, lat, 0.6)]},
    })
    # canopy: octagon
    dc = parse_meters(tags.get("diameter_crown"))
    if dc:
        radius = dc / 2.0
    else:
        radius = 3.0 + det_jitter(lon, lat, "radius", 1.5)
    ht = parse_meters(tags.get("height"))
    if ht:
        h = ht
    else:
        h = 7.0 + det_jitter(lon, lat, "height", 3.0)
    leaf = tags.get("leaf_type") or "broadleaved"
    feats.append({
        "type": "Feature",
        "properties": {
            "kind": "canopy",
            "h": round(h, 2),
            "base": 2.2,
            "leaf": leaf,
        },
        "geometry": {"type": "Polygon", "coordinates": [octagon(lon, lat, radius)]},
    })
    return feats


def interpolate_line(points, spacing_m):
    """points: list of (lon, lat). Returns points every ~spacing_m including both ends."""
    if len(points) < 2:
        return list(points)
    # cumulative distances (equirectangular, fine at this scale)
    dists = [0.0]
    for (lon0, lat0), (lon1, lat1) in zip(points, points[1:]):
        latm = math.radians((lat0 + lat1) / 2.0)
        dx = (lon1 - lon0) * M_PER_DEG_LAT * math.cos(latm)
        dy = (lat1 - lat0) * M_PER_DEG_LAT
        dists.append(dists[-1] + math.hypot(dx, dy))
    total = dists[-1]
    if total <= 0:
        return [points[0]]
    n = max(2, int(round(total / spacing_m)) + 1)
    out = []
    seg = 0
    for k in range(n):
        target = total * k / (n - 1)
        while seg < len(dists) - 2 and dists[seg + 1] < target:
            seg += 1
        d0, d1 = dists[seg], dists[seg + 1]
        t = 0.0 if d1 == d0 else (target - d0) / (d1 - d0)
        lon = points[seg][0] + t * (points[seg + 1][0] - points[seg][0])
        lat = points[seg][1] + t * (points[seg + 1][1] - points[seg][1])
        out.append((lon, lat))
    return out


def ring_from_geometry(geom):
    """Overpass 'geometry' list -> closed [lon,lat] ring, or None."""
    if not geom or len(geom) < 3:
        return None
    ring = [[g["lon"], g["lat"]] for g in geom]
    if ring[0] != ring[-1]:
        ring.append(list(ring[0]))
    if len(ring) < 4:
        return None
    return ring


def polygons_from_element(el):
    """Return list of polygon coordinate arrays (each = list of rings) for a
    way or (multipolygon) relation element with geometry."""
    polys = []
    if el["type"] == "way":
        ring = ring_from_geometry(el.get("geometry"))
        if ring:
            polys.append([ring])
    elif el["type"] == "relation":
        # Take outer members; stitch open ways naively by matching endpoints.
        outers = []
        opens = []
        for m in el.get("members", []):
            if m.get("type") != "way" or m.get("role") not in ("outer", ""):
                continue
            g = m.get("geometry")
            if not g:
                continue
            pts = [[p["lon"], p["lat"]] for p in g]
            if len(pts) >= 3 and pts[0] == pts[-1]:
                outers.append(pts)
            else:
                opens.append(pts)
        # naive stitching of open segments
        while opens:
            chain = opens.pop(0)
            progressed = True
            while progressed and chain[0] != chain[-1]:
                progressed = False
                for i, seg in enumerate(opens):
                    if seg[0] == chain[-1]:
                        chain += seg[1:]
                    elif seg[-1] == chain[-1]:
                        chain += list(reversed(seg))[1:]
                    elif seg[-1] == chain[0]:
                        chain = seg + chain[1:]
                    elif seg[0] == chain[0]:
                        chain = list(reversed(seg)) + chain[1:]
                    else:
                        continue
                    opens.pop(i)
                    progressed = True
                    break
            if chain[0] == chain[-1] and len(chain) >= 4:
                outers.append(chain)
            else:
                warnings.append("relation %s: could not close an outer ring; skipped that ring" % el.get("id"))
        for ring in outers:
            polys.append([ring])
    return polys


def main():
    os.makedirs(DATA_DIR, exist_ok=True)

    # ---- trees ----
    q_trees = """
[out:json][timeout:90];
(
  node["natural"="tree"](%s);
  way["natural"="tree_row"](%s);
);
out geom;
""" % (BBOX, BBOX)
    tree_data = overpass(q_trees)

    tree_points = 0
    feats = []
    n_nodes = 0
    n_rows = 0
    for el in tree_data.get("elements", []):
        if el["type"] == "node":
            n_nodes += 1
            feats.extend(tree_features(el["lon"], el["lat"], el.get("tags")))
            tree_points += 1
        elif el["type"] == "way":
            n_rows += 1
            geom = el.get("geometry")
            if not geom or len(geom) < 2:
                warnings.append("tree_row way %s had no usable geometry" % el.get("id"))
                continue
            pts = [(g["lon"], g["lat"]) for g in geom]
            for lon, lat in interpolate_line(pts, 8.0):
                feats.extend(tree_features(lon, lat, el.get("tags")))
                tree_points += 1

    trees_fc = {"type": "FeatureCollection", "features": feats}
    with open(TREES_PATH, "w", encoding="utf-8") as f:
        json.dump(trees_fc, f, separators=(",", ":"))

    # ---- landscape: pitches + fountains ----
    q_land = """
[out:json][timeout:90];
(
  way["leisure"="pitch"](%s);
  relation["leisure"="pitch"](%s);
  way["amenity"="fountain"](%s);
  relation["amenity"="fountain"](%s);
);
out geom;
""" % (BBOX, BBOX, BBOX, BBOX)
    land_data = overpass(q_land)

    land_feats = []
    n_pitch = 0
    n_fountain = 0
    for el in land_data.get("elements", []):
        tags = el.get("tags", {}) or {}
        if tags.get("leisure") == "pitch":
            kind = "pitch"
        elif tags.get("amenity") == "fountain":
            kind = "fountain"
        else:
            continue
        polys = polygons_from_element(el)
        if not polys:
            warnings.append("%s %s (%s) had no closed polygon geometry; skipped" % (el["type"], el.get("id"), kind))
            continue
        for coords in polys:
            land_feats.append({
                "type": "Feature",
                "properties": {"kind": kind},
                "geometry": {"type": "Polygon", "coordinates": coords},
            })
            if kind == "pitch":
                n_pitch += 1
            else:
                n_fountain += 1

    land_fc = {"type": "FeatureCollection", "features": land_feats}
    with open(LANDSCAPE_PATH, "w", encoding="utf-8") as f:
        json.dump(land_fc, f, separators=(",", ":"))

    # ---- validate by reloading ----
    with open(TREES_PATH, "r", encoding="utf-8") as f:
        t = json.load(f)
    with open(LANDSCAPE_PATH, "r", encoding="utf-8") as f:
        l = json.load(f)

    trunks = sum(1 for ft in t["features"] if ft["properties"]["kind"] == "trunk")
    canopies = sum(1 for ft in t["features"] if ft["properties"]["kind"] == "canopy")

    # sanity: rings closed
    def rings_closed(fc):
        for ft in fc["features"]:
            for ring in ft["geometry"]["coordinates"]:
                if ring[0] != ring[-1]:
                    return False
        return True

    report = {
        "tree_nodes": n_nodes,
        "tree_row_ways": n_rows,
        "tree_points": tree_points,
        "trunks": trunks,
        "canopies": canopies,
        "pitches": n_pitch,
        "fountains": n_fountain,
        "trees_features_total": len(t["features"]),
        "landscape_features_total": len(l["features"]),
        "trees_rings_closed": rings_closed(t),
        "landscape_rings_closed": rings_closed(l),
        "warnings": warnings,
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
