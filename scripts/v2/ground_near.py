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
from PIL import Image

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

# Surfaces the inventory GUESSED rather than observed are not drawn as that surface: the ground there is left unnamed, so the
# shader takes it from the City aerial's own colour (green = lawn, dark = asphalt, else concrete; v2/ground-near.js, HINT_*).
# Checked against the owner's photos (2026-10-29): the 'canopy-ground' garden extents (a lawn assumed under a tree canopy
# outline) covered Moffett's parking lot and sidewalk edge, and the City planimetric 'Courtyard' / 'Paved Patio' / 'Paving'
# polygons, whose surface the bake defaults to brick paving, covered the Anna Hiss courtyard lawn and Hogg's concrete walk.
# Key: the feature's _src.s; value: the defaulted surfaces it applies to (None = any).
AERIAL_DECIDES = {'canopy-ground': None, 'surface-default': PAVERS}
# The aerial decides ONCE PER POLYGON, not per pixel (owner live look 2026-10-30: per-pixel decisions drew camouflage lawn blobs on the
# Jester plaza and torn blue-grey / green islands at Moffett): the polygon's pixels of the baked z16 aerial (~2 m) are classified and
# the majority names the whole polygon, so its edges are the mapped outline. A class needs AERIAL_MAJORITY of the pixels, else concrete.
AERIAL_DIR = os.path.join(ROOT, 'v2', 'data', 'aerial', '16')
AERIAL_Z = 16
AERIAL_GREEN = 0.10                            # (g - max(r, b)) / luminance, linear: a lawn pixel
AERIAL_DARK = 0.16                             # linear luminance of the photograph: an asphalt pixel (concrete reads 0.3-0.6)
AERIAL_MAJORITY = 0.5
AERIAL_CHOICES = {'canopy-ground': (2,), 'surface-default': (2,)}   # what a guess may become by majority (a courtyard is never asphalt)
# ...and what it becomes without one. A canopy guess is a tree-crown outline: the aerial sees dark crowns there, which is no evidence
# of asphalt or concrete, so without a lawn majority it is not drawn (what is mapped under it, e.g. a parking lot, shows; else the hint).
AERIAL_FALLBACK = {'canopy-ground': None, 'surface-default': 4}
# Parking lots and service aisles the OSM road areas record (k = roadarea): the big carriageway unions are the street layer's, but a
# lot or aisle smaller than this is drawn here as asphalt (Moffett's lot drew as beige concrete from the aerial hint).
LOT_MAX_M2 = 0                                 # OFF: 20000 painted asphalt over Hogg's sidewalk (OSM road areas run to the building line)
# ...except under a mapped tree crown, where the aerial sees the crown and not the ground (Hogg's planted bed under the West Mall
# oaks read as concrete without this): there a guessed lawn stays lawn, drawn as the crown's disc inside the guessed extent.
TREES = [os.path.join(ROOT, 'v2', 'data', 'trees', n) for n in ('city.json', 'osm.json')]
CROWN_SCALE = 0.85                             # x the mapped crown radius (crowns are measured to the leaf tips)
CROWN_SIDES = 16


def guessed(p):
    src = (p.get('_src') or {}).get('s')
    if src not in AERIAL_DECIDES: return False
    only = AERIAL_DECIDES[src]
    return only is None or p.get('s') in only


_tiles = {}
def _tile(x, y):
    if (x, y) not in _tiles:
        f = os.path.join(AERIAL_DIR, str(y), str(x) + '.jpg')    # stored z/y/x
        _tiles[(x, y)] = Image.open(f).convert('RGB').load() if os.path.exists(f) else None
    return _tiles[(x, y)]


def aerial_class(poly, choices, fallback=4):
    # poly: [[lon, lat]...] outer ring. Returns (class, share, pixels) by majority of the z16 aerial pixels whose centres fall inside.
    n = 2 ** AERIAL_Z * 256
    gx = lambda lon: (lon + 180) / 360 * n
    gy = lambda lat: (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    ring = [(gx(lo), gy(la)) for lo, la in poly]
    xs, ys = [q[0] for q in ring], [q[1] for q in ring]
    votes = {2: 0, 4: 0, 5: 0}; tot = 0
    for py in range(int(min(ys)), int(max(ys)) + 1):
        for px in range(int(min(xs)), int(max(xs)) + 1):
            if not inside(px + 0.5, py + 0.5, ring): continue
            t = _tile(px // 256, py // 256)
            if t is None: continue
            r, g, b = [(v / 255) ** 2.2 for v in t[px % 256, py % 256]]
            l = 0.2126 * r + 0.7152 * g + 0.0722 * b; tot += 1
            if (g - max(r, b)) / max(l, 1e-3) > AERIAL_GREEN: votes[2] += 1
            elif l < AERIAL_DARK: votes[5] += 1
            else: votes[4] += 1
    if tot == 0: return None, 0, 0
    best = max(choices, key=lambda c: votes[c])
    if votes[best] / tot >= AERIAL_MAJORITY: return best, votes[best] / tot, tot
    return fallback, votes[4] / tot, tot


def classify(p, g=None):
    k, s = p.get('k'), p.get('s')
    if k == 'roadarea' and s == 'asphalt' and g is not None and g['type'] == 'Polygon':
        ring = [((lon - ORIGIN[1]) * KX, -(lat - ORIGIN[0]) * KZ) for lon, lat in g['coordinates'][0]]
        a = abs(sum(ring[i][0] * ring[i - 1][1] - ring[i - 1][0] * ring[i][1] for i in range(len(ring)))) / 2
        return 5 if a <= LOT_MAX_M2 else None
    if k in ('roadarea', 'cnp', 'bank'): return None
    if guessed(p): return None
    if k not in ('area', 'patharea', 'pathslab', 'cyclearea'): return None
    if s in PAVERS: return 1
    if s in GRASS: return 2
    if s in BED: return 3
    if s in ASPHALT: return 5
    if s in CONCRETE: return 4
    return None


def rank(k, c, area):
    if k == 'roadarea': return (-1, -area)       # lots under everything mapped on them
    # painter's order: soft ground, then lots and plazas, then mapped paths, then the surveyed slabs; big before small in a rank
    base = {2: 0, 3: 1, 5: 2, 1: 3, 4: 4}[c] if k == 'area' else (5 if k in ('patharea', 'cyclearea') else 6)
    return (base, -area)


def crowns():
    pts = []
    for t in TREES:
        if not os.path.exists(t): continue
        a = json.load(open(t)).get('trees', [])
        pts += [(a[i], a[i + 1], a[i + 2]) for i in range(0, len(a), 6)]
    return pts


def inside(x, z, ring):                        # ring: [(x, z)...] in metres
    c, j = False, len(ring) - 1
    for i in range(len(ring)):
        xi, zi = ring[i]; xj, zj = ring[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi: c = not c
        j = i
    return c


def main():
    d = json.load(open(SRC))
    out, counts = [], {}
    trees = crowns()
    for f in d['features']:
        p, g = f['properties'], f['geometry']
        c = classify(p, g)
        if c is None and guessed(p) and g['type'] in ('Polygon', 'MultiPolygon'):
            choices = AERIAL_CHOICES[(p.get('_src') or {}).get('s')]
            for poly in ([g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']):
                pts = [((lon - ORIGIN[1]) * KX, -(lat - ORIGIN[0]) * KZ) for lon, lat in poly[0]]
                xs, zs = [q[0] for q in pts], [q[1] for q in pts]
                if max(xs) < BOX[0] or min(xs) > BOX[2] or max(zs) < BOX[1] or min(zs) > BOX[3]: continue
                ac, share, npx = aerial_class(poly[0], choices, AERIAL_FALLBACK[(p.get('_src') or {}).get('s')])
                if ac is None: continue
                flat = [v for x, z in pts for v in (round(x * 10), round(z * 10))]
                a = abs(sum(xs[i] * zs[i - 1] - xs[i - 1] * zs[i] for i in range(len(xs)))) / 2
                if a < MIN_AREA_M2: continue
                out.append((rank('area', ac, a), [ac, flat])); counts['aerial_%d' % ac] = counts.get('aerial_%d' % ac, 0) + 1
        if c is None and guessed(p) and p.get('s') in GRASS and g['type'] in ('Polygon', 'MultiPolygon'):
            for poly in ([g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']):
                ring = [((lon - ORIGIN[1]) * KX, -(lat - ORIGIN[0]) * KZ) for lon, lat in poly[0]]
                xs, zs = [q[0] for q in ring], [q[1] for q in ring]
                for tx, tz, tr in trees:
                    if not (min(xs) <= tx <= max(xs) and min(zs) <= tz <= max(zs)) or not inside(tx, tz, ring): continue
                    r = tr * CROWN_SCALE
                    disc = [v for k in range(CROWN_SIDES) for v in (round((tx + r * math.cos(2 * math.pi * k / CROWN_SIDES)) * 10),
                                                                   round((tz + r * math.sin(2 * math.pi * k / CROWN_SIDES)) * 10))]
                    out.append(((0, -math.pi * r * r), [2, disc])); counts['crown_lawn'] = counts.get('crown_lawn', 0) + 1
            continue
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
