"""Bake the classified ground near buildings for v2 (v2/ground-near.js): data/ground.geojson -> v2/data/ground/near.json.

data/ground.geojson is the repo's own surface inventory (scripts/bake_ground.py: OSM surfaces, landuse, plazas, campus lawns and
beds, the City's sidewalk slabs). This keeps the five surfaces the street-level ground draws and drops what other layers draw
(roads: street_near.js; canopy and creek banks: trees and the channel):

  1 pavers    brick / stone paving        (area|patharea|pathslab with s = paving, brick, paving_stones, limestone)
  2 grass     lawns                       (s = gardenlawn, turf, grass)
  3 bed       planting beds, scrub, soil  (s = bed, scrub, understorey, dirt, wood)
  4 concrete  walks, slabs, plazas        (pathslab, patharea / area / cyclearea with s = concrete, aggregate, roadconcrete, None)
  5 asphalt   parking and paved lots      (area / patharea / cyclearea with s = asphalt)

Output: { origin, classes, f: [[class, ring0, ring1...]...] } with rings as flat [x, z, x, z...] in decimetres of the v2 frame
(v2/geo.js toLocal: x east, z south), in painter's order (later draws over earlier: lawns first, sidewalk slabs last).

  python3 scripts/v2/ground_near.py
"""
import json, math, os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'data', 'ground.geojson')
OUT = os.path.join(ROOT, 'v2', 'data', 'ground', 'near.json')
ORIGIN = (30.28601, -97.73932)                 # v2/geo.js ORIGIN (lat, lon)
R = 6378137.0
KX = R * math.pi / 180 * math.cos(ORIGIN[0] * math.pi / 180)
KZ = R * math.pi / 180
BOX = (-2200, -1900, 1800, 4100)               # v2 metres kept (the aerial mask's box plus 400 m)
MIN_AREA_M2 = 0.5
HOLE_BED_MAX_M2 = 250                          # a hole this small in a paved area is a planting bed (tree pits, planters)
OVR = os.path.join(ROOT, 'data', 'ground_near_overrides.json')
NAMES = {'pavers': 1, 'grass': 2, 'bed': 3, 'concrete': 4, 'asphalt': 5}

PAVERS = {'paving', 'brick', 'paving_stones', 'limestone'}
GRASS = {'gardenlawn', 'turf', 'grass'}
BED = {'bed', 'scrub', 'understorey', 'dirt', 'wood'}
CONCRETE = {'concrete', 'aggregate', 'roadconcrete', None}
ASPHALT = {'asphalt'}


def classify(p):
    k, s = p.get('k'), p.get('s')
    if k in ('roadarea', 'cnp', 'bank'): return None
    if k not in ('area', 'patharea', 'pathslab', 'cyclearea'): return None
    if s in PAVERS: return 1
    if s in GRASS: return 2
    if s in BED: return 3
    if s in ASPHALT: return 5
    if s in CONCRETE: return 4
    return None


def rank(k, c, area):
    # painter's order: soft ground, then lots and plazas, then mapped paths, then the surveyed slabs; big before small in a rank
    base = {2: 0, 3: 1, 5: 2, 1: 3, 4: 4}[c] if k == 'area' else (5 if k in ('patharea', 'cyclearea') else 6)
    return (base, -area)


def main():
    d = json.load(open(SRC))
    out, counts = [], {}
    for f in d['features']:
        p, g = f['properties'], f['geometry']
        c = classify(p)
        if c is None: continue
        polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates'] if g['type'] == 'MultiPolygon' else []
        for poly in polys:
            rings = []
            for ring in poly:
                pts = [((lon - ORIGIN[1]) * KX, -(lat - ORIGIN[0]) * KZ) for lon, lat in ring]
                flat = []
                for x, z in pts: flat += [round(x * 10), round(z * 10)]
                rings.append(flat)
            if not rings or len(rings[0]) < 6: continue
            xs, zs = rings[0][0::2], rings[0][1::2]
            if max(xs) < BOX[0] * 10 or min(xs) > BOX[2] * 10 or max(zs) < BOX[1] * 10 or min(zs) > BOX[3] * 10: continue
            a = abs(sum(xs[i] * zs[i - 1] - xs[i - 1] * zs[i] for i in range(len(xs)))) / 200.0
            if a < MIN_AREA_M2: continue
            out.append((rank(p['k'], c, a), [c] + rings))
            counts[c] = counts.get(c, 0) + 1
            if c in (1, 4):                      # holes in a plaza or walk: the beds and planters it was mapped around
                for h in rings[1:]:
                    hx, hz = h[0::2], h[1::2]
                    ha = abs(sum(hx[i] * hz[i - 1] - hx[i - 1] * hz[i] for i in range(len(hx)))) / 200.0
                    if MIN_AREA_M2 <= ha <= HOLE_BED_MAX_M2:
                        r0 = rank(p['k'], c, a); out.append(((r0[0], r0[1] + 1e-3), [3, h])); counts['hole_beds'] = counts.get('hole_beds', 0) + 1
    for o in json.load(open(OVR))['features']:           # photo overrides: drawn last
        out.append(((9, 0), [NAMES[o['class']], [round(v * 10) for v in o['ring']]])); counts['override'] = counts.get('override', 0) + 1
    out.sort(key=lambda r: r[0])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    doc = {'about': 'Classified ground near buildings for v2/ground-near.js (scripts/v2/ground_near.py from data/ground.geojson: '
                    'OpenStreetMap ODbL + City of Austin open data). Rings in decimetres of the v2 frame, painter\'s order.',
           'classes': {'1': 'pavers', '2': 'grass', '3': 'bed', '4': 'concrete', '5': 'asphalt'},
           'unit_m': 0.1, 'f': [r[1] for r in out]}
    with open(OUT, 'w') as fh: json.dump(doc, fh, separators=(',', ':'))
    print('features', len(out), 'by class', counts, 'bytes', os.path.getsize(OUT))


if __name__ == '__main__':
    main()
