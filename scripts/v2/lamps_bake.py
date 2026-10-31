#!/usr/bin/env python3
"""v2 street lamps: where each lamp stands and which model it is. Writes v2/data/lamps.json (this script owns that file).

    python3 scripts/v2/lamps_bake.py

Inputs (no network):
  data/osm_cache/street_lamps.json  Overpass extract of highway=street_lamp / man_made=street_lamp nodes over the v2 box (ODbL)
  data/osm_cache/ut_campus.json     the OSM University of Texas at Austin campus relation (ODbL)
  data/lamps_measured.json          campus lamps measured from site photographs where OSM has none
  data/osm_cache/roads.json         OSM roads (for which lamps are street lights on a mast)
  v2/data/street/surface.json       the v2 carriageway (no lamp may stand in the road)

Rules (a missing lamp is better than a wrong one): positions are OSM's as mapped. A lamp that falls on the carriageway is moved off it
only if the nearest kerb-side point is within MAX_NUDGE_M (mapping error); farther, it is dropped. Inside the campus every lamp is the
campus globe lamp unless OSM says it is on a mast; outside, a lamp on a mast or within ROAD_M of a drivable road is a cobra-head
street light, the rest are globe lamps (paths, plazas). Output rows [x, y, z, angle, type, variant]: v2 frame (x east, z south),
y = foot height, angle = radians from +x toward +z (a cobra's arm points at the road), type 0 globe / 1 cobra, variant 0 dark / 1 pale post.
"""
import json, math, os, collections
from shapely.geometry import Point, Polygon, LineString
from shapely.ops import unary_union, nearest_points, linemerge, polygonize
from shapely import STRtree, prepare

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
J = lambda *p: json.load(open(os.path.join(REPO, *p)))

# ── PARAMETERS ──────────────────────────────────────────────────────────
ORIGIN = {'lat': 30.28601, 'lon': -97.73932}
BOX = (-3200, 3200, -2700, 4900)
ROAD_M = 9.0                  # a non-campus lamp this close to a drivable road's centreline is a street light on a mast
DRIVABLE = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified',
            'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'}
MASTS = {'straight_mast', 'bent_mast', 'cast_steel_mast'}
ROAD_CLEAR_M = 0.45           # a lamp's foot keeps this far off the carriageway
MAX_NUDGE_M = 2.0             # farther than this from a legal spot: dropped, not moved
DEDUP_M = 2.0                 # two records closer than this are one lamp

D2R = math.pi / 180
KX = 6378137.0 * D2R * math.cos(ORIGIN['lat'] * D2R); KZ = 6378137.0 * D2R
loc = lambda lon, lat: ((lon - ORIGIN['lon']) * KX, -(lat - ORIGIN['lat']) * KZ)
r2 = lambda v: round(v, 2)


def campus():
    lines = []
    for e in J('data', 'osm_cache', 'ut_campus.json')['elements']:
        for m in e.get('members', []):
            if m.get('role') == 'outer' and m.get('geometry'):
                lines.append(LineString([loc(p['lon'], p['lat']) for p in m['geometry']]))
    return unary_union(list(polygonize(linemerge(lines))))


def main():
    cam = campus(); prepare(cam)
    surf = J('v2', 'data', 'street', 'surface.json')
    ring = lambda f: [(f[i], f[i + 1]) for i in range(0, len(f), 2)]
    road = unary_union([Polygon(ring(r[0]), [ring(h) for h in r[1:]]).buffer(0) for r in surf['asphalt']])   # (holes: medians, islands)
    clear = road.buffer(ROAD_CLEAR_M); prepare(clear)
    roads = [LineString([loc(p['lon'], p['lat']) for p in e['geometry']]) for e in J('data', 'osm_cache', 'roads.json')['elements']
             if e.get('geometry') and (e.get('tags') or {}).get('highway') in DRIVABLE]
    tree = STRtree(roads)
    osm = J('data', 'osm_cache', 'street_lamps.json')
    c = collections.Counter(); out = []
    for e in osm['elements']:
        t = e.get('tags') or {}
        if 'lat' not in e or not (t.get('highway') == 'street_lamp' or t.get('man_made') == 'street_lamp'): continue
        if t.get('lamp_mount') == 'high_mast' or t.get('man_made') == 'tower': c['high_mast_skipped'] += 1; continue
        x, z = loc(e['lon'], e['lat'])
        if not (BOX[0] <= x <= BOX[1] and BOX[2] <= z <= BOX[3]): c['outside_box'] += 1; continue
        p = Point(x, z)
        if clear.intersects(p):
            q = nearest_points(clear.boundary, p)[0]; d = p.distance(q)
            if d > MAX_NUDGE_M: c['dropped_in_road'] += 1; continue
            dx, dz = q.x - x, q.y - z; k = (d + 0.1) / max(d, 1e-6); x, z = x + dx * k, z + dz * k; p = Point(x, z); c['nudged_off_road'] += 1
        if any(math.hypot(x - o[0], z - o[2]) < DEDUP_M for o in out): c['duplicates'] += 1; continue
        i = tree.nearest(p); rd = roads[i].distance(p) if i is not None else 1e9
        on_campus = cam.covers(p)
        mast = t.get('lamp_mount') in MASTS or t.get('support') == 'pole' and t.get('lamp_mount') in MASTS
        kind = 1 if mast or (not on_campus and rd < ROAD_M) else 0
        ang = 0.0
        if kind == 1 and i is not None:
            q = nearest_points(p, roads[i])[1]; ang = math.atan2(q.y - z, q.x - x)
        c['campus' if on_campus else 'off_campus'] += 1; c['cobra' if kind else 'globe'] += 1
        out.append([r2(x), 0.0, r2(z), round(ang, 3), kind, 0])
    meas = J('data', 'lamps_measured.json')['lamps']
    for x, y, z, var in meas:
        if any(math.hypot(x - o[0], z - o[2]) < DEDUP_M for o in out): c['measured_duplicates'] += 1; continue
        out.append([r2(x), r2(y), r2(z), 0.0, 0, var]); c['measured'] += 1; c['globe'] += 1
    out.sort(key=lambda r: (r[0], r[2]))
    doc = {'_license': '© OpenStreetMap contributors, ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/). Street lamp positions '
                       'derived from OpenStreetMap, plus a few measured from site photographs; derivative database under the ODbL.',
           'source': 'OpenStreetMap street_lamp nodes, Overpass extract ' + osm.get('osm3s', {}).get('timestamp_osm_base', '') +
                     '; scripts/v2/lamps_bake.py', 'frame': 'v2 metres, x east, z south of %.5f, %.5f' % (ORIGIN['lat'], ORIGIN['lon']),
           'row': ['x', 'y', 'z', 'angle', 'type', 'variant'], 'stride': 6, 'counts': dict(c, total=len(out)),
           'lamps': [v for r in out for v in r]}
    json.dump(doc, open(os.path.join(REPO, 'v2', 'data', 'lamps.json'), 'w'), separators=(',', ':'))
    print(json.dumps(doc['counts']))


if __name__ == '__main__':
    main()
