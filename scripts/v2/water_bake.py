#!/usr/bin/env python3
"""v2 water layer, data: OpenStreetMap water areas around the v2 city -> v2/data/water/osm_water.json (its own ODbL file).

    python3 scripts/v2/water_bake.py [CACHE_DIR]

Source: OpenStreetMap (natural=water areas and the older waterway=riverbank areas) through the public Overpass API, anonymous and
read-only. The output is a Derivative Database of OpenStreetMap and stays under the ODbL 1.0 in ITS OWN FILE (credit:
"(c) OpenStreetMap contributors"); nothing else in the repo is mixed into it. The app (v2/water.js) only reads it.

What is kept: every water area that reaches BOX and is at least MIN_AREA_M2 (ponds smaller than that are left to the aerial),
clipped to BOX, simplified by SIMPLIFY_M (a tenth of a metre-scale aerial pixel: below anything the shore can show), lon/lat to 6
decimals (~0.1 m). Each body gets a `level` (the water surface in the app's metres above its flat ground, 0 today: v2's ground is
flat, so every body is the same plane; LEVELS holds the real normal pools for when terrain arrives) and a `kind`.
"""
import json, os, sys, time, urllib.parse, urllib.request

from shapely.geometry import LineString, MultiPolygon, Polygon, box, mapping
from shapely.ops import linemerge, polygonize, transform, unary_union

# ── PARAMETERS ──────────────────────────────────────────────────────────
# Lady Bird Lake by downtown, Waller/Shoal Creek mouths, and Lake Austin up to Mount Bonnell (outside the camera's reach today,
# kept so the lake is in the data when the city grows there; see docs/v2-water.md)
BOX = {'s': 30.236, 'w': -97.800, 'n': 30.335, 'e': -97.690}
MIN_AREA_M2 = 1500
CELL_M = 500          # each body is cut into squares this size, so the app can cull the water it cannot see (one lake as one mesh is always "in view")
SIMPLIFY_M = 0.4
OVERPASS = 'https://overpass-api.de/api/interpreter'
UA = 'flyover-v2-bake/1 (OpenStreetMap water areas; github.com/SimeonVarg/austin-3d-explorer)'
# The normal pool of each named lake (metres above sea level), for when v2's ground gets terrain. Not used while the ground is flat.
LEVELS = {'Lady Bird Lake': 130.6, 'Lake Austin': 150.2}
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'v2', 'data', 'water', 'osm_water.json')

LAT0 = (BOX['s'] + BOX['n']) / 2
KX = 6378137 * 3.141592653589793 / 180 * __import__('math').cos(LAT0 * 3.141592653589793 / 180)
KZ = 6378137 * 3.141592653589793 / 180
to_m = lambda x, y, z=None: (x * KX, y * KZ)
to_ll = lambda x, y, z=None: (x / KX, y / KZ)


def fetch(cache):
    path = os.path.join(cache, 'osm_water_raw.json') if cache else None
    if path and os.path.exists(path):
        return json.load(open(path))
    b = f"({BOX['s']},{BOX['w']},{BOX['n']},{BOX['e']})"
    q = (f'[out:json][timeout:120];(way["natural"="water"]{b};relation["natural"="water"]{b};'
         f'way["waterway"="riverbank"]{b};relation["waterway"="riverbank"]{b};);out geom;')
    for a in range(4):
        try:
            req = urllib.request.Request(OVERPASS, data=urllib.parse.urlencode({'data': q}).encode(), headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=180) as r:
                d = json.load(r)
            if path:
                os.makedirs(cache, exist_ok=True)
                json.dump(d, open(path, 'w'))
            return d
        except Exception as e:
            print('  retry', e, file=sys.stderr)
            time.sleep(5 * (a + 1))
    raise SystemExit('overpass failed')


def ring(geom):
    return [(p['lon'], p['lat']) for p in geom]


def polygons(el):
    if el['type'] == 'way':
        pts = ring(el.get('geometry', []))
        if len(pts) >= 4 and pts[0] == pts[-1]:
            return [Polygon(pts)]
        return []
    outers, inners = [], []
    for m in el.get('members', []):
        if m.get('type') != 'way' or not m.get('geometry'):
            continue
        (inners if m.get('role') == 'inner' else outers).append(LineString(ring(m['geometry'])))
    outer = unary_union(list(polygonize(linemerge(outers)))) if outers else None
    if outer is None or outer.is_empty:
        return []
    if inners:
        hole = unary_union(list(polygonize(linemerge(inners))))
        outer = outer.difference(hole)
    return list(outer.geoms) if hasattr(outer, 'geoms') else [outer]


def main():
    d = fetch(sys.argv[1] if len(sys.argv) > 1 else None)
    clip = box(BOX['w'], BOX['s'], BOX['e'], BOX['n'])
    feats = []
    for el in d['elements']:
        t = el.get('tags', {})
        for p in polygons(el):
            p = p.buffer(0).intersection(clip)
            if p.is_empty:
                continue
            pm = transform(to_m, p).simplify(SIMPLIFY_M, preserve_topology=True)
            if pm.area < MIN_AREA_M2:
                continue
            name = t.get('name', '')
            kind = t.get('water') or ('river' if t.get('waterway') == 'riverbank' else 'water')
            x0, y0, x1, y1 = pm.bounds
            for i in range(int(x0 // CELL_M), int(x1 // CELL_M) + 1):
                for j in range(int(y0 // CELL_M), int(y1 // CELL_M) + 1):
                    piece = pm.intersection(box(i * CELL_M, j * CELL_M, (i + 1) * CELL_M, (j + 1) * CELL_M))
                    if piece.geom_type == 'GeometryCollection':
                        piece = unary_union([g for g in piece.geoms if g.geom_type in ('Polygon', 'MultiPolygon')])
                    if piece.is_empty or piece.area < 1 or piece.geom_type not in ('Polygon', 'MultiPolygon'):
                        continue
                    gj = json.loads(json.dumps(mapping(transform(to_ll, piece))), parse_float=lambda s: round(float(s), 6))
                    feats.append({'type': 'Feature', 'properties': {'osm': f"{el['type']}/{el['id']}", 'name': name, 'kind': kind,
                                                                    'level': 0, 'pool_m': LEVELS.get(name), 'area_m2': round(piece.area),
                                                                    'body_m2': round(pm.area)},
                                  'geometry': gj})
    feats.sort(key=lambda f: (-f['properties']['body_m2'], -f['properties']['area_m2']))
    out = {'type': 'FeatureCollection',
           'about': 'Water areas for the v2 water layer (scripts/v2/water_bake.py). level = water surface in the app frame (m).',
           'source': 'OpenStreetMap (natural=water, waterway=riverbank) via the Overpass API',
           'licence': 'Open Database License (ODbL) 1.0; (c) OpenStreetMap contributors; https://www.openstreetmap.org/copyright',
           'box': BOX, 'features': feats}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f'{len(feats)} water areas, {os.path.getsize(OUT) / 1024:.0f} KB ->', os.path.relpath(OUT))
    seen = {}
    for ft in feats:
        p = ft['properties']
        seen.setdefault(p['osm'], [p['body_m2'], p['kind'], p['name'], 0])[3] += 1
    for k, (a, kind, name, n) in sorted(seen.items(), key=lambda kv: -kv[1][0])[:10]:
        print(f"  {a:>9} m2  {kind:<10} {name}  {k}  ({n} pieces)")


if __name__ == '__main__':
    main()
