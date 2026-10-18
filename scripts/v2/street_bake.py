#!/usr/bin/env python3
"""v2 street layers, step 2: bake the street furniture into two compact files for v2/street.js.

    python3 scripts/v2/street_bake.py CITY_CACHE

CITY_CACHE is street_fetch.py's folder. Writes:
  v2/data/street/city.json  City of Austin open data only (Open Data Terms: free and without restriction; credit requested):
      bars     crosswalk bars (continental ladders round the City's crosswalk middle line), stop lines, yield teeth
               as [x, z, angle, length, width] (metres, v2 frame; angle = radians of the bar's long axis from +x toward +z)
      curbs    the street-side edge of every existing sidewalk that meets the curb (back_of_curb = Y), as polylines with the
               road on the right of travel
      ramps    curb ramps [x, z, angle-to-street, warning pad 0/1]
      signals  traffic-signal poles at the intersection's corners [x, z, angle of the mast arm, arm length (0 = pedestal pole)]
      (no bike-lane posts: the City's bike-facility lines follow the street centreline, not the lane; posts drawn from them stood
       in the middle of Congress Avenue)
  v2/data/street/osm.json   OpenStreetMap only (ODbL 1.0; kept in its own file, never mixed with the City's records):
      lamps    street lamps [x, z, kind] (kind 0 = post-top lantern on paths, 1 = a cobra head on a mast beside a road)

Frame: v2/geo.js (x metres east, z metres SOUTH of the origin). Numbers are rounded to 5 cm.
"""
import json, math, os, sys
from collections import defaultdict

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(REPO, 'v2', 'data', 'street')

# ── PARAMETERS ──────────────────────────────────────────────────────────
ORIGIN = {'lat': 30.28601, 'lon': -97.73932}
EARTH_R = 6378137.0
BOX = (-3200, 3200, -2700, 4900)        # v2 metres kept (the camera target's reach plus a margin)
BAR_W = 0.6                             # continental crosswalk bar (24 in) ...
BAR_GAP = 0.6                           # ... and gap
XW_WIDTH = 3.0                          # a crosswalk's width (10 ft; the City's records carry only its middle line)
XW_LINE_W = 0.3                         # the two lines of a transverse crosswalk
STOP_W = 0.6
YIELD_TOOTH = (0.6, 0.9, 0.3)           # width, length, gap of a yield tooth
SIDEWALK_ROAD_MAX = 32.0                # a sidewalk farther than this from every road is a path, not a street sidewalk: no curb
POST_STEP = 6.0                         # flexible posts along protected bike lanes
LAMP_ROAD_M = 9.0                       # a lamp this close to a primary..tertiary road is a cobra head on a mast

D2R = math.pi / 180
KX = EARTH_R * D2R * math.cos(ORIGIN['lat'] * D2R)
KZ = EARTH_R * D2R
loc = lambda lon, lat: ((lon - ORIGIN['lon']) * KX, -(lat - ORIGIN['lat']) * KZ)
r5 = lambda v: round(v * 20) / 20
inbox = lambda x, z: BOX[0] <= x <= BOX[1] and BOX[2] <= z <= BOX[3]


def lines(g):
    if not g:
        return []
    if g['type'] == 'LineString':
        return [[loc(*p[:2]) for p in g['coordinates']]]
    if g['type'] == 'MultiLineString':
        return [[loc(*p[:2]) for p in l] for l in g['coordinates']]
    return []


def seglen(a, b):
    return math.hypot(b[0] - a[0], b[1] - a[1])


def chord(l):
    """A short marking line as one straight piece: (start, end)."""
    return l[0], l[-1]


class Grid:
    """Road segments in 50 m buckets, for 'nearest road' questions."""
    def __init__(self, segs, cell=50.0):
        self.c = cell; self.g = defaultdict(list)
        for s in segs:
            (x0, z0), (x1, z1) = s[0], s[1]
            for i in range(int(min(x0, x1) // cell), int(max(x0, x1) // cell) + 1):
                for j in range(int(min(z0, z1) // cell), int(max(z0, z1) // cell) + 1):
                    self.g[(i, j)].append(s)

    def nearest(self, x, z, r=1):
        i, j = int(x // self.c), int(z // self.c); best = None
        for di in range(-r, r + 1):
            for dj in range(-r, r + 1):
                for s in self.g.get((i + di, j + dj), []):
                    (x0, z0), (x1, z1) = s[0], s[1]
                    dx, dz = x1 - x0, z1 - z0; L2 = dx * dx + dz * dz or 1e-9
                    t = max(0, min(1, ((x - x0) * dx + (z - z0) * dz) / L2))
                    px, pz = x0 + t * dx, z0 + t * dz
                    d = math.hypot(x - px, z - pz)
                    if not best or d < best[0]:
                        best = (d, px, pz, s)
        return best


def main():
    city = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)
    J = lambda n: json.load(open(os.path.join(city, n + '.geojson')))['features']
    roads = json.load(open(os.path.join(REPO, 'data', 'roads.geojson')))['features']
    road_segs = []
    for f in roads:
        p = f['properties']
        if p.get('k') != 'road':
            continue
        for l in lines(f['geometry']):
            for a, b in zip(l[:-1], l[1:]):
                road_segs.append((a, b, p.get('c'), float(p.get('w') or 8)))
    RG = Grid(road_segs)

    # ── markings ──
    bars = []
    xw, n_pair, n_single, n_stop, n_yield = [], 0, 0, 0, 0   # n_pair = continental crosswalks, n_single = transverse
    for f in J('markings'):
        t = f['properties'].get('short_line_type')
        for l in lines(f['geometry']):
            a, b = chord(l)
            if seglen(a, b) < 0.5 or not inbox(*a):
                continue
            if t == 'CROSSWALK':
                xw.append((a, b, f['properties'].get('subtype')))
            elif t == 'STOP_LINE':
                mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
                bars.append([mx, mz, math.atan2(b[1] - a[1], b[0] - a[0]), seglen(a, b), STOP_W]); n_stop += 1
            elif t == 'YIELD_LINE':
                L = seglen(a, b); ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
                k = 0.0
                while k + YIELD_TOOTH[0] <= L:
                    c = k + YIELD_TOOTH[0] / 2
                    bars.append([a[0] + ux * c, a[1] + uz * c, math.atan2(uz, ux) + math.pi / 2, YIELD_TOOTH[1], YIELD_TOOTH[0]]); n_yield += 1
                    k += YIELD_TOOTH[0] + YIELD_TOOTH[2]
    # a crosswalk record is ONE line along the middle of the crossing (checked on the close sheets: Congress at 6th has one per leg,
    # the second magenta line there is the stop line). Continental: bars XW_WIDTH long, along the traffic, every BAR_W + BAR_GAP.
    # Transverse: two lines along the crossing, XW_WIDTH apart.
    for a, b, sub in xw:
        L = seglen(a, b); ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L; nx, nz = -uz, ux
        if sub == 'TRANSVERSE':
            for sd in (-1, 1):
                bars.append([(a[0] + b[0]) / 2 + nx * sd * XW_WIDTH / 2, (a[1] + b[1]) / 2 + nz * sd * XW_WIDTH / 2, math.atan2(uz, ux), L, XW_LINE_W])
            n_single += 1
            continue
        nb = max(1, int((L + BAR_GAP) // (BAR_W + BAR_GAP)))
        start = (L - (nb * BAR_W + (nb - 1) * BAR_GAP)) / 2
        for k in range(nb):
            c = start + k * (BAR_W + BAR_GAP) + BAR_W / 2
            bars.append([a[0] + ux * c, a[1] + uz * c, math.atan2(nz, nx), XW_WIDTH, BAR_W])
        n_pair += 1
    # ── curbs: the street-side edge of sidewalks that meet the curb ──
    curbs = []
    n_curb = 0
    for f in J('sidewalks'):
        p = f['properties']
        if p.get('pedestrian_facility_type') != 'EXISTING_SIDEWALK' or p.get('back_of_curb') != 'Y':
            continue
        w = max(0.9, float(p.get('width') or 5) * 0.3048)
        for l in lines(f['geometry']):
            if len(l) < 2 or not inbox(*l[0]):
                continue
            out, sides = [], 0
            for k, (x, z) in enumerate(l):
                a = l[max(0, k - 1)]; b = l[min(len(l) - 1, k + 1)]
                L = seglen(a, b)
                if L < 1e-6:
                    continue
                nx, nz = -(b[1] - a[1]) / L, (b[0] - a[0]) / L
                hit = RG.nearest(x, z)
                if not hit or hit[0] > SIDEWALK_ROAD_MAX:
                    out = None; break
                side = 1 if (hit[1] - x) * nx + (hit[2] - z) * nz > 0 else -1
                out.append((x + nx * side * w / 2, z + nz * side * w / 2)); sides += side
            if out and len(out) >= 2:
                # stored with the road on the RIGHT of travel (street.js puts the curb's top on the left, the sidewalk side)
                curbs.append(out[::-1] if sides > 0 else out); n_curb += 1

    # ── curb ramps ──
    ramps = []
    for f in J('ramps'):
        g = f.get('geometry')
        if not g or f['properties'].get('STATUS') not in (None, 'ACTIVE'):
            continue
        x, z = loc(*g['coordinates'][:2])
        if not inbox(x, z):
            continue
        hit = RG.nearest(x, z)
        if not hit or hit[0] > 25:
            continue
        ang = math.atan2(hit[2] - z, hit[1] - x)
        warn = 1 if f['properties'].get('DETECTABLE_WARNING') in ('BRICK', 'METAL_PLATE') else 0
        ramps.append([x, z, ang, warn])

    # ── traffic signals: a pole at each corner where the curb ramps gather; mast arms on two diagonal corners ──
    signals = []
    RAMPG = defaultdict(list)
    for r in ramps:
        RAMPG[(int(r[0] // 40), int(r[1] // 40))].append(r)
    n_sig = 0
    for f in J('signals'):
        p, g = f['properties'], f.get('geometry')
        if not g or p.get('signal_status') != 'TURNED_ON':
            continue
        cx, cz = loc(*g['coordinates'][:2])
        if not inbox(cx, cz):
            continue
        hit = RG.nearest(cx, cz)
        axis = math.atan2(hit[3][1][1] - hit[3][0][1], hit[3][1][0] - hit[3][0][0]) if hit else 0.0
        near = [r for i in (-1, 0, 1) for j in (-1, 0, 1) for r in RAMPG.get((int(cx // 40) + i, int(cz // 40) + j), [])
                if 3 < math.hypot(r[0] - cx, r[1] - cz) < 26]
        quads = defaultdict(list)
        for r in near:
            a = (math.atan2(r[1] - cz, r[0] - cx) - axis) % (2 * math.pi)
            quads[int(a // (math.pi / 2))].append(r)
        if p.get('signal_type') == 'PHB':      # a pedestrian hybrid beacon: two poles, no corner arms
            pass
        for q, rs in quads.items():
            mx = sum(r[0] for r in rs) / len(rs); mz = sum(r[1] for r in rs) / len(rs)
            d = math.hypot(mx - cx, mz - cz) or 1
            px, pz = mx + (mx - cx) / d * 1.0, mz + (mz - cz) / d * 1.0
            arm = 0.0
            if p.get('signal_type') == 'TRAFFIC' and q in (0, 2):
                arm = min(12.0, max(4.0, 0.75 * d))
            # the arm reaches across the approach: along the street axis toward the crossing's centre line
            ang = math.atan2(cz - pz, cx - px)
            signals.append([px, pz, ang, arm]); n_sig += 1

    # ── protected bike lanes: flexible posts ──
    posts = []
    for f in J('bike'):
        if 'Protected' not in (f['properties'].get('bicycle_facility') or ''):
            continue
        for l in lines(f['geometry']):
            acc = 0.0
            for a, b in zip(l[:-1], l[1:]):
                L = seglen(a, b)
                while acc <= L:
                    t = acc / L if L else 0
                    x, z = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                    if inbox(x, z):
                        posts.append([x, z])
                    acc += POST_STEP
                acc -= L

    R = lambda rows: [[r5(v) if k < 2 else (round(v, 3) if isinstance(v, float) else v) for k, v in enumerate(row)] for row in rows]
    flat = lambda rows: [v for row in R(rows) for v in row]
    city_out = {
        'about': 'v2 street furniture from City of Austin open data (scripts/v2/street_bake.py). Data retrieved from Data.AustinTexas.gov and the City of Austin GIS; not endorsed by the City of Austin.',
        'licence': 'City of Austin Open Data Terms of Use: free and without restriction; credit requested. Signals: Public Domain.',
        'sources': {'markings': '9hak-anfp', 'sidewalks': 'vchz-d9ng', 'bike': '23hw-a95n', 'signals': 'p53x-x73x', 'ramps': 'AGOL TRANSPORTATION_curb_ramps'},
        'frame': 'v2/geo.js: x metres east, z metres south of 30.28601, -97.73932',
        'bars': flat([[b[0], b[1], b[2], round(b[3], 2), b[4]] for b in bars]),
        'curbs': [[r5(v) for p in c for v in p] for c in curbs],
        'ramps': flat(ramps),
        'signals': flat([[s[0], s[1], s[2], round(s[3], 1)] for s in signals]),
        'counts': {'crosswalks_continental': n_pair, 'crosswalks_transverse': n_single, 'stop_lines': n_stop, 'yield_teeth': n_yield,
                   'bars': len(bars), 'curbs': n_curb, 'ramps': len(ramps), 'signal_poles': n_sig, 'posts': len(posts)},
    }
    json.dump(city_out, open(os.path.join(OUT, 'city.json'), 'w'), separators=(',', ':'))
    print(json.dumps(city_out['counts']))

    # ── OSM lamps (ODbL, its own file) ──
    d = json.load(open(os.path.join(REPO, 'data', 'osm_cache', 'furn_vertical.json')))
    lamps = []
    for e in d['elements']:
        if (e.get('tags') or {}).get('highway') != 'street_lamp' or 'lat' not in e:
            continue
        x, z = loc(e['lon'], e['lat'])
        hit = RG.nearest(x, z)
        kind = 1 if hit and hit[0] < LAMP_ROAD_M and hit[3][2] in ('primary', 'secondary', 'tertiary', 'trunk') else 0
        lamps.append([x, z, kind])
    osm_out = {
        '_license': '© OpenStreetMap contributors, ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/). This file is a derivative database of OpenStreetMap and is offered under the ODbL.',
        'source': 'OpenStreetMap highway=street_lamp nodes, Overpass extract ' + d.get('osm3s', {}).get('timestamp_osm_base', ''),
        'frame': city_out['frame'],
        'lamps': flat(lamps),
    }
    json.dump(osm_out, open(os.path.join(OUT, 'osm.json'), 'w'), separators=(',', ':'))
    print('lamps', len(lamps), 'cobra', sum(l[2] for l in lamps))
    for n in ('city.json', 'osm.json'):
        print(n, os.path.getsize(os.path.join(OUT, n)), 'bytes')


if __name__ == '__main__':
    main()
