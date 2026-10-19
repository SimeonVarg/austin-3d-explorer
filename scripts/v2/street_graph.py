#!/usr/bin/env python3
"""v2 street level from ONE road surface: carriageways, junctions, kerbs, sidewalks, frontage and paint all derived from it.

    python3 scripts/v2/street_graph.py CITY_CACHE Z19_TILE_CACHE [--overlay DIR]

Why (owner 10-18: "i see angled crosswalks and weird intersecting lines"; an independent review found the cause): kerbs, sidewalks and
crossings were built separately, each with its own rule, so they disagreed at every junction. Here they come from one model:

  1. edges      the road centrelines with each side's measured kerb offset (v2/data/street/near.json 'roads', street_near.py)
  2. surface    each edge buffered side by side to its kerbs and UNIONED (GEOS): the carriageway. Junctions = where two different
                edges' carriageways overlap. Corner fillets = the morphological closing of the surface (radius CORNER_R_M), kept only
                round junctions, so a median or a gap between parallel streets is never filled.
  3. derived    kerbs = the surface's boundary (never inside it, never across a junction); sidewalks = the City sidewalks plus a ring
                round each junction, minus the surface; frontage = the classed runs of near.json to the building face, minus both;
                lane lines = near.json's lines minus every junction (+LANE_STOP_M); crossings = each City crosswalk record (its middle
                line, as observed, skew kept) clipped kerb to kerb by the surface, bars parallel to the road there; stop bars = across the
                approach lanes at the City stop record, pushed behind the crossing; ramp pads at the crossing's two ends.
     City records and aerial reads only place and style; they never add paint off the surface.
  4. checks     over ALL junctions: a kerb inside the carriageway, duplicate crossings, paint outside the road, lines inside a junction.

Writes v2/data/street/surface.json (polygons with holes, cut to 125 m squares, and kerb lines; street_near.js uses it instead of
near.json's roads/curbs/walks/fronts/lanes) and v2/data/street/marks.json (bars and pads; street.js uses it instead of city.json's).
Grade separation: the area's grade-separated roads (I-35's decks) are motorway class and are not in the surface.
"""
import argparse, functools, json, math, os, random, sys, time
print = functools.partial(print, flush=True)
T0 = time.time()
def stage(msg):
    print(f'[{time.time() - T0:6.1f} s] {msg}')
import numpy as np
from shapely.geometry import LineString, Polygon, MultiPolygon, Point, box, mapping
from shapely.ops import unary_union
from shapely import STRtree, set_precision, prepare, normalize
from collections import defaultdict

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, 'v2', 'data', 'street')

# ── PARAMETERS ──────────────────────────────────────────────────────────
CORNER_R_M = 4.5              # corner kerb radius (closing radius round junctions)
JUNCTION_MIN_M2 = 6.0         # two edges' carriageways overlapping by more than this make a junction
LANE_STOP_M = 5.5             # lane lines stop this far from a junction's open area
WALK_RING_M = 1.8             # a junction's corner sidewalk, where the approaches have sidewalks
FRONT_DEPTH_M = 16.0
XW = {'width': 3.0, 'bar': 0.6, 'gap': 0.6, 'kerb_keep': 0.3}
STOP = {'w': 0.6, 'behind_m': 1.2, 'kerb_keep': 0.2}
TILE_M = 125.0
SIMPLIFY_M = 0.05
ISLAND_MAX_M2 = 400.0       # flag small enclosed gaps; no invented plaza inside a road/parking-aisle loop
NAMED = {'Guadalupe/21st': (-252, 246), 'Guadalupe/24th': (-217, -187), 'Speedway/21st': (241, 255), 'Congress/6th': (-335, 1997),
         'Rio Grande/24th': (-515, -213), 'Lavaca/15th': (-252, 940)}

ORIGIN = {'lat': 30.28601, 'lon': -97.73932}
D2R = math.pi / 180
KX = 6378137.0 * D2R * math.cos(ORIGIN['lat'] * D2R); KZ = 6378137.0 * D2R
loc = lambda lon, lat: ((lon - ORIGIN['lon']) * KX, -(lat - ORIGIN['lat']) * KZ)
r5 = lambda v: round(v * 20) / 20


def pairs(a, f):
    return [(a[i], a[i + 1]) for i in range(f, len(a) - 1, 2)]


def offset(pts, d):
    out = []
    for i, p in enumerate(pts):
        a = pts[max(0, i - 1)]; b = pts[min(len(pts) - 1, i + 1)]
        L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
        out.append((p[0] - (b[1] - a[1]) / L * d, p[1] + (b[0] - a[0]) / L * d))
    return out


def polys(g):
    if g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, MultiPolygon):
        return list(g.geoms)
    return [q for q in getattr(g, 'geoms', []) if isinstance(q, Polygon)]


def lines_of(g):
    if g.is_empty:
        return []
    if g.geom_type == 'LineString':
        return [g]
    return [q for q in getattr(g, 'geoms', []) if q.geom_type == 'LineString']


def finalize_quantized(out, marks):
    """Check the geometry the client actually reads, after clipping, simplification and coordinate rounding."""
    def read(r):
        return Polygon(pairs(r[0], 0), [pairs(h, 0) for h in r[1:]])
    road = unary_union([read(r) for r in out['asphalt']])
    holes = [Polygon(h) for p in polys(road) for h in p.interiors if Polygon(h).area < ISLAND_MAX_M2]
    ht = STRtree(holes)
    for kind in ('paving', 'lawn', 'mulch'):
        cropped = []
        for r in out[kind]:
            p = read(r); hit = ht.query(p)
            if len(hit):
                p = p.difference(unary_union([holes[i] for i in hit]))
            for q in polys(normalize(set_precision(p, 0.05))):
                if q.area < 0.2: continue
                cropped.append([[r5(v) for xy in list(rr.coords)[:-1] for v in xy] for rr in [q.exterior] + list(q.interiors)])
        out[kind] = cropped
    allowed = road.buffer(0.05); prepare(allowed)
    kept = []; dropped = 0
    for i in range(0, len(marks['bars']), 5):
        x, z, a, L, w = marks['bars'][i:i + 5]
        u = np.array([math.cos(a), math.sin(a)]); n = np.array([-u[1], u[0]]); c = np.array([x, z])
        pg = Polygon([c + u * L * s / 2 + n * w * t / 2 for s,t in ((-1,-1),(-1,1),(1,1),(1,-1))])
        if allowed.covers(pg): kept.extend([x,z,a,L,w])
        else: dropped += 1
    marks['bars'] = kept
    out['checks']['bars_total'] = len(kept) // 5
    out['checks']['bars_dropped_after_quantization'] = out['checks'].get('bars_dropped_after_quantization', 0) + dropped
    out['checks']['enclosed_small_spaces_after_quantization'] = len(holes)
    return out, marks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('city'); ap.add_argument('tiles'); ap.add_argument('--overlay', default=None)
    a = ap.parse_args()
    near = json.load(open(os.path.join(DATA, 'near.json')))
    J = lambda n: json.load(open(os.path.join(a.city, n + '.geojson')))['features']

    # ── 1. edges ──
    edges = []
    for r in near['roads']:
        kn, kp, nokerb, oneway = -r[0], r[1], r[2] & 1, bool(r[2] & 2)
        pts = pairs(r, 3)
        if len(pts) < 2 or kn + kp < 2:
            continue
        L, R = offset(pts, kp), offset(pts, -kn)
        # Tight service-aisle bends can fold an averaged-offset strip back over its own centreline. GEOS's actual
        # line buffer preserves coverage there (the service widths are symmetric; they have no measured kerb offsets).
        poly = LineString(pts).buffer((kn + kp) / 2, cap_style=2) if nokerb else Polygon(L + R[::-1]).buffer(0)
        if poly.is_empty:
            continue
        edges.append({'mid': LineString(pts), 'poly': poly, 'kn': kn, 'kp': kp, 'nokerb': nokerb, 'oneway': oneway})
    stage(f'{len(edges)} edges')

    # ── 2. surface, junctions, fillets ──
    carriage = unary_union([e['poly'] for e in edges])
    tree = STRtree([e['poly'] for e in edges])
    jparts = []
    for i, e in enumerate(edges):
        if e['nokerb']:
            continue                      # a drive or an alley meets a street at a kerb cut, not at a junction with corners
        for j in tree.query(e['poly']):
            if j <= i or edges[j]['nokerb']:
                continue
            ov = e['poly'].intersection(edges[j]['poly'])
            if ov.area > JUNCTION_MIN_M2:
                # same street continuing (nearly parallel) is not a junction
                u1 = np.diff(np.array(e['mid'].coords), axis=0); u2 = np.diff(np.array(edges[j]['mid'].coords), axis=0)
                d1 = u1.sum(0) / (np.linalg.norm(u1.sum(0)) + 1e-9); d2 = u2.sum(0) / (np.linalg.norm(u2.sum(0)) + 1e-9)
                if abs(float(d1 @ d2)) > math.cos(math.radians(25)) and ov.area < 60:
                    continue
                jparts.append(ov)
    junctions = polys(unary_union(jparts).buffer(0.5))
    stage(f'{len(junctions)} junctions')
    jzone = unary_union([j.buffer(CORNER_R_M * 2.5) for j in junctions])
    fillet = carriage.buffer(CORNER_R_M, join_style=1).buffer(-CORNER_R_M, join_style=1).difference(carriage).intersection(jzone)
    surface = unary_union([carriage, fillet]).buffer(0)
    junction_area = unary_union(junctions)
    stage('surface and fillets')

    # ── 3. derived ──
    # kerbs: the boundary, except along kerb-less (service) edges
    nokerb_zone = unary_union([e['poly'].buffer(0.6) for e in edges if e['nokerb']]) if any(e['nokerb'] for e in edges) else Polygon()
    kerb_lines = [l for l in lines_of(surface.boundary.difference(nokerb_zone)) if l.length > 0.5]
    # sidewalks: the City-surveyed walks (near.json, already placed against the measured kerbs) + a ring round each junction
    walk_polys = [LineString(pairs(w, 1)).buffer(w[0] / 2, cap_style=2) for w in near['walks'] if len(w) >= 5]
    walks_u = unary_union(walk_polys)
    ring = surface.buffer(WALK_RING_M, join_style=1).difference(surface).intersection(jzone)
    ring = ring.intersection(walks_u.buffer(6.0))          # only where the approaches have sidewalks
    # A parking aisle is not a kerbed street. Wrapping its boundary produced a raised, round island at Nueces/MLK.
    # Keep surveyed sidewalk, but never invent a sidewalk round a service-road loop.
    service_margin = unary_union([e['poly'].buffer(WALK_RING_M + 0.2) for e in edges if e['nokerb']])
    ring = ring.difference(service_margin)
    sidewalk = unary_union([walks_u, ring]).difference(surface).buffer(0)
    # frontage: near.json's classed runs, minus the surface and the sidewalks
    fclass = defaultdict(list)
    for f in near['fronts']:
        pts = [(f[i], f[i + 1], f[i + 2]) for i in range(2, len(f) - 2, 3)]
        if len(pts) < 2:
            continue
        mid = [(p[0], p[1]) for p in pts]
        inner = offset(mid, f[1])
        outer = []
        for k, p in enumerate(pts):
            q = offset(mid, p[2])[k]; outer.append(q)
        pg = Polygon(inner + outer[::-1]).buffer(0)
        if not pg.is_empty:
            fclass[f[0]].append(pg)
    taken = unary_union([surface, sidewalk])
    # A small hole in the road union is not evidence of a plaza. These enclosed spaces include parking spaces between a
    # street and a service aisle. Leave their unobserved ground to the aerial, instead of filling them with raised paving.
    islands = [Polygon(h) for p in polys(surface) for h in p.interiors if Polygon(h).area < ISLAND_MAX_M2]
    island_mask = unary_union(islands)
    fronts = {c: unary_union(v).difference(taken).difference(island_mask).buffer(0) for c, v in fclass.items()}
    # Asphalt frontage (parking/drive aprons) can itself enclose a space. Audit the COMPLETE asphalt union too.
    complete_asphalt = unary_union([surface, fronts.get(3, Polygon())])
    islands = [Polygon(h) for p in polys(complete_asphalt) for h in p.interiors if Polygon(h).area < ISLAND_MAX_M2]
    island_mask = unary_union(islands)
    fronts = {c: g.difference(island_mask).buffer(0) for c, g in fronts.items()}
    stage('sidewalks and frontage')

    # lane lines: near.json's (photograph) + near_osm.json's (OSM lane counts), minus every junction and its approach zone
    lane_cut = junction_area.buffer(LANE_STOP_M)
    lane_keep = surface.buffer(-0.3)
    def clip_lanes(src):
        out = []
        for l in src:
            g = LineString(pairs(l, 4))
            if g.length < 1:
                continue
            for piece in lines_of(g.difference(lane_cut).intersection(lane_keep)):
                if piece.length >= 3:
                    out.append([l[0], l[1], l[2], l[3]] + [r5(v) for q in piece.coords for v in q])
        return out
    lanes = clip_lanes(near['lanes'])
    try:
        lanes_osm = clip_lanes(json.load(open(os.path.join(DATA, 'near_osm.json')))['lanes'])
    except FileNotFoundError:
        lanes_osm = []

    # crossings: each City crosswalk middle line (observed direction kept), clipped by the surface; bars parallel to the road there
    etree = STRtree([e['mid'] for e in edges])
    def road_dir(pt):
        best = None
        for i in etree.query(pt.buffer(25)):
            d = edges[i]['mid'].distance(pt)
            if best is None or d < best[0]:
                best = (d, i)
        if best is None:
            return None, None
        m = edges[best[1]]['mid']; s = m.project(pt)
        p0 = m.interpolate(max(0, s - 1)); p1 = m.interpolate(min(m.length, s + 1))
        u = np.array([p1.x - p0.x, p1.y - p0.y]); n = np.linalg.norm(u)
        return (u / n if n > 0 else None), best[1]
    bars, pads, crossings = [], [], []
    pad_dropped = 0
    prepare(sidewalk)
    xgrid = defaultdict(list); n_crossed = 0
    jtree = STRtree(junctions)
    def jdist(pt):
        idx = jtree.query(pt.buffer(40))
        return min((junctions[i].distance(pt) for i in idx), default=1e9)
    for f in J('markings'):
        t = f['properties'].get('short_line_type')
        if t != 'CROSSWALK':
            continue
        g = f['geometry']
        ls = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']
        for l in ls:
            pts = [loc(*p[:2]) for p in l]
            if len(pts) < 2:
                continue
            a_, b_ = np.array(pts[0]), np.array(pts[-1]); v = b_ - a_; Lr = np.linalg.norm(v)
            if Lr < 1:
                continue
            v /= Lr
            longline = LineString([tuple(a_ - v * 12), tuple(b_ + v * 12)])
            piece = longline.intersection(surface)
            segs = [s for s in lines_of(piece) if s.distance(LineString(pts)) < 1.0]
            if not segs:
                continue
            seg = max(segs, key=lambda s: s.length)
            mid_pt = seg.interpolate(0.5, normalized=True)
            u, ei = road_dir(mid_pt)
            if u is None:
                continue
            # duplicate check: an earlier crossing on the same line
            key = (int(mid_pt.x // 10), int(mid_pt.y // 10))
            near_x = [c for i in (-3, -2, -1, 0, 1, 2, 3) for j in (-3, -2, -1, 0, 1, 2, 3) for c in xgrid.get((key[0] + i, key[1] + j), [])]
            if any(c.hausdorff_distance(seg) < 2.0 for c in near_x):
                continue
            # two crossings never cross each other (a fork's records can overlap): the first, squarer one stays
            def crosses(c):
                x = c.intersection(seg)
                if x.is_empty or x.geom_type != 'Point':
                    return False
                ends = [Point(q) for q in (c.coords[0], c.coords[-1], seg.coords[0], seg.coords[-1])]
                return min(e.distance(x) for e in ends) > 1.5     # meeting at a corner ramp is fine; crossing mid-road is not
            if any(crosses(c) for c in near_x):
                n_crossed += 1
                continue
            crossings.append(seg); xgrid[key].append(seg)
            p0, p1 = np.array(seg.coords[0]), np.array(seg.coords[-1]); dv = p1 - p0; Ls = np.linalg.norm(dv); dv /= Ls
            # bars every bar+gap across the crossing, parallel to the road; the bar's length along the road = XW width (on a skewed
            # crossing the ladder's band follows the record's line)
            per = XW['bar'] + XW['gap']; usable = Ls - 2 * XW['kerb_keep']
            nb = int((usable + XW['gap']) // per)
            if nb < 1:
                continue
            ang = math.atan2(u[1], u[0])
            sin_sk = abs(dv[0] * u[1] - dv[1] * u[0]) or 1
            start = XW['kerb_keep'] + (usable - (nb * per - XW['gap'])) / 2
            for k in range(nb):
                c = p0 + dv * (start + k * per + XW['bar'] / 2)
                bars.append([c[0], c[1], ang, XW['width'], XW['bar'] * sin_sk])
            # Warning tiles belong BEHIND the kerb, on a supported sidewalk, not 0.6 m into traffic.
            for c in (p0 - dv * 0.9, p1 + dv * 0.9):
                across = np.array([-dv[1], dv[0]])
                pg = Polygon([c + dv * 0.6 * i + across * 0.3 * j for i, j in ((-1,-1),(-1,1),(1,1),(1,-1))])
                if sidewalk.covers(pg):
                    pads.append([c[0], c[1], math.atan2(dv[1], dv[0])])
                else:
                    pad_dropped += 1
    xband = unary_union([c.buffer(XW['width'] / 2, cap_style=2) for c in crossings])
    nstop = 0
    for f in J('markings'):
        if f['properties'].get('short_line_type') != 'STOP_LINE':
            continue
        g = f['geometry']
        ls = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']
        for l in ls:
            pts = [loc(*p[:2]) for p in l]
            if len(pts) < 2:
                continue
            m = Point((pts[0][0] + pts[-1][0]) / 2, (pts[0][1] + pts[-1][1]) / 2)
            u, ei = road_dir(m)
            if u is None:
                continue
            e = edges[ei]; n = np.array([-u[1], u[0]])
            s = e['mid'].project(m); c0 = e['mid'].interpolate(s); c = np.array([c0.x, c0.y])
            side = 1 if float((np.array([m.x, m.y]) - c) @ n) >= 0 else -1
            # push it behind a crossing it overlaps (away from the junction)
            for k in range(8):
                bar_line = LineString([tuple(c + n * -e['kn']), tuple(c + n * e['kp'])])
                if not bar_line.buffer(STOP['w'] / 2 + STOP['behind_m'], cap_style=2).intersects(xband):
                    break
                away = 1 if jdist(e['mid'].interpolate(min(e['mid'].length, s + 2))) > jdist(e['mid'].interpolate(max(0, s - 2))) else -1
                s += away * 1.0; c0 = e['mid'].interpolate(s); c = np.array([c0.x, c0.y])
            lo, hi = (-e['kn'] + STOP['kerb_keep'], e['kp'] - STOP['kerb_keep'])
            if not near_oneway(e):
                lo, hi = (0.15, hi) if side > 0 else (lo, -0.15)
            if hi - lo < 1.5:
                continue
            o = (lo + hi) / 2; p = c + n * o
            if junction_area.contains(Point(p)):
                continue
            bars.append([p[0], p[1], math.atan2(n[1], n[0]), hi - lo, STOP['w']]); nstop += 1
    print(f'crossings {len(crossings)}, stop bars {nstop}, lane lines {len(lanes)} + OSM {len(lanes_osm)}')

    # ── 4. checks over all junctions ──
    def rect(b):
        x, z, ang, L, w = b; ux, uz = math.cos(ang), math.sin(ang); vx, vz = -uz, ux
        return Polygon([(x + ux * L / 2 * s + vx * w / 2 * t, z + uz * L / 2 * s + vz * w / 2 * t) for s, t in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    # every check per 125 m square (the area's surface is one large polygon: whole-area overlays are too slow)
    stage('checks')
    x0, z0, x1, z1 = surface.bounds
    kerb_inside = paint_out = lane_in_j = 0; walk_on_road = 0.0; bad_bars = set()
    ktree = STRtree(kerb_lines); btree_geoms = [rect(b) for b in bars]; btree = STRtree(btree_geoms) if btree_geoms else None
    lgeoms = [LineString(pairs(l, 4)) for l in lanes + lanes_osm]; ltree = STRtree(lgeoms)
    for gx in np.arange(math.floor(x0 / TILE_M) * TILE_M, x1, TILE_M):
        for gz in np.arange(math.floor(z0 / TILE_M) * TILE_M, z1, TILE_M):
            bx = box(gx, gz, gx + TILE_M, gz + TILE_M)
            surf = surface.intersection(bx.buffer(4))
            if surf.is_empty:
                continue
            inner = surf.buffer(-0.5)
            for i in ktree.query(bx):
                piece = kerb_lines[i].intersection(bx)
                if not piece.is_empty and piece.intersection(inner).length > 0.05:
                    kerb_inside += 1
            if btree is not None:
                sb = surf.buffer(0.05)
                for i in btree.query(bx):
                    g = btree_geoms[i]
                    if bx.contains(g.centroid) and g.difference(sb).area > 0.02 * g.area:
                        bad_bars.add(i)
            ja = junction_area.intersection(bx)
            for i in ltree.query(bx):
                if lgeoms[i].intersection(bx).intersection(ja).length > 0.05:
                    lane_in_j += 1
            walk_on_road += sidewalk.intersection(bx).intersection(surf.buffer(-0.05)).area
    # paint never leaves the road: a bar that would (an end bar on a corner fillet, a skewed bar at a kerb) is not drawn
    n_bars_dropped = len(bad_bars)
    bars = [b for i, b in enumerate(bars) if i not in bad_bars]
    paint_out = 0
    ctree = STRtree(crossings)
    dup_x = sum(1 for i, c in enumerate(crossings) for j in ctree.query(c.buffer(2.0)) if j > i and c.hausdorff_distance(crossings[j]) < 2.0)
    checks = {'junctions': len(junctions), 'kerb_lines_inside_carriageway': kerb_inside, 'paint_bars_outside_road': paint_out,
              'lane_lines_in_junction_open_area': lane_in_j, 'duplicate_crossings': dup_x, 'sidewalk_on_carriageway_m2': round(walk_on_road, 2),
              'crossings_dropped_for_crossing_another': n_crossed, 'bars_total': len(bars), 'bars_dropped_for_leaving_the_road': n_bars_dropped}
    checks['enclosed_small_spaces_flagged'] = len(islands)
    checks['invented_frontage_in_small_enclosed_spaces_m2'] = round(sum(g.intersection(island_mask).area for g in fronts.values()), 2)
    checks['invented_sidewalk_near_service_edges_m2'] = round(ring.intersection(service_margin).area, 2)
    checks['unsupported_warning_pads_dropped'] = pad_dropped
    stage('CHECKS ' + json.dumps(checks))

    # ── outputs: polygons cut to squares ──
    x0, z0, x1, z1 = surface.bounds
    out = {'asphalt': [], 'walk': [], 'paving': [], 'lawn': [], 'mulch': [], 'kerbs': []}
    names = {0: 'paving', 1: 'lawn', 2: 'mulch', 3: 'asphalt'}
    def emit(kind, g):
        # Rounding vertices individually made 138 asphalt polygons self-intersect. Snap with topology preservation.
        for p in polys(set_precision(g.simplify(SIMPLIFY_M), 0.05)):
            if p.area < 0.2:
                continue
            rings = [p.exterior] + list(p.interiors)
            out[kind].append([[r5(v) for q in list(r.coords)[:-1] for v in q] for r in rings])
    for gx in np.arange(math.floor(x0 / TILE_M) * TILE_M, x1, TILE_M):
        for gz in np.arange(math.floor(z0 / TILE_M) * TILE_M, z1, TILE_M):
            b = box(gx, gz, gx + TILE_M, gz + TILE_M)
            emit('asphalt', surface.intersection(b))
            emit('walk', sidewalk.intersection(b))
            for c, g in fronts.items():
                emit(names.get(c, 'paving'), g.intersection(b))
    # kerbs oriented so the road lies toward (dz, -dx) of the direction
    for l in kerb_lines:
        cs = list(l.simplify(SIMPLIFY_M).coords)
        if len(cs) < 2:
            continue
        (ax, az), (bx, bz) = cs[0], cs[1]; L = math.hypot(bx - ax, bz - az) or 1
        probe = Point((ax + bx) / 2 + (bz - az) / L * 0.3, (az + bz) / 2 - (bx - ax) / L * 0.3)
        if not surface.contains(probe):
            cs = cs[::-1]
        out['kerbs'].append([r5(v) for q in cs for v in q])
    out['lanes'] = lanes
    out['about'] = ('v2 road surface (scripts/v2/street_graph.py): one carriageway union with junction fillets, and everything derived from it. '
                    'City of Austin data (Not endorsed by the City of Austin) and the City 2025 aerial; road centrelines from data/roads.geojson.')
    out['frame'] = 'v2/geo.js: x metres east, z metres south of 30.28601, -97.73932'
    out['checks'] = checks
    # OSM-derived lane lines stay in the ODbL file (near_osm.json) but clipped: written as surface_osm.json
    json.dump({'_license': '© OpenStreetMap contributors, ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/). Lane lines from OSM lane '
                           'counts, clipped to the v2 road surface; a derivative database offered under the ODbL.', 'lanes': lanes_osm},
              open(os.path.join(DATA, 'surface_osm.json'), 'w'), separators=(',', ':'))
    R5 = lambda rows: [v for row in rows for v in ([r5(row[0]), r5(row[1])] + [round(q, 3) for q in row[2:]])]
    mark_out = {'about': 'v2 crossings, stop bars and ramp pads derived from the road surface (scripts/v2/street_graph.py), placed by City of '
                        'Austin markings (9hak-anfp). Not endorsed by the City of Austin.', 'frame': out['frame'],
               'bars': R5(bars), 'pads': R5(pads)}
    finalize_quantized(out, mark_out)
    bars = [mark_out['bars'][i:i + 5] for i in range(0, len(mark_out['bars']), 5)]
    json.dump(out, open(os.path.join(DATA, 'surface.json'), 'w'), separators=(',', ':'))
    json.dump(mark_out, open(os.path.join(DATA, 'marks.json'), 'w'), separators=(',', ':'))
    for n in ('surface.json', 'surface_osm.json', 'marks.json'):
        print(n, os.path.getsize(os.path.join(DATA, n)))

    # ── diagnostic overlay on the aerial: the 6 named junctions and 10 random ones ──
    if a.overlay:
        from PIL import Image, ImageDraw
        import street_align as SA
        A = SA.Aerial(a.tiles)
        os.makedirs(a.overlay, exist_ok=True)
        rnd = random.Random(18)
        picks = dict(NAMED)
        cents = [j.centroid for j in junctions if -1500 < j.centroid.x < 1200 and -1300 < j.centroid.y < 3300]
        for k, c in enumerate(rnd.sample(cents, min(10, len(cents)))):
            picks[f'random{k + 1}'] = (c.x, c.y)
        json.dump({k: [round(v[0], 1), round(v[1], 1)] for k, v in picks.items()}, open(os.path.join(a.overlay, 'picks.json'), 'w'))
        for name, (cx, cz) in picks.items():
            H, R = 32.0, 0.08; n = int(2 * H / R)
            xs = cx - H + (np.arange(n) + 0.5) * R; zs = cz - H + (np.arange(n) + 0.5) * R
            X, Z = np.meshgrid(xs, zs)
            try:
                img = Image.fromarray((np.clip(A.sample(X, Z), 0, 1) * 255).astype(np.uint8)).convert('RGB')
            except Exception:
                continue
            d = ImageDraw.Draw(img)
            P = lambda q: ((q[0] - (cx - H)) / R, (q[1] - (cz - H)) / R)
            win = box(cx - H, cz - H, cx + H, cz + H)
            for g, col in ((surface, (255, 60, 60)), (sidewalk, (60, 255, 60)), (junction_area, (255, 255, 0))):
                for p in polys(g.intersection(win)):
                    for rr in [p.exterior] + list(p.interiors):
                        d.line([P(q) for q in rr.coords], fill=col, width=2)
            for e in edges:
                if e['mid'].intersects(win):
                    d.line([P(q) for q in e['mid'].intersection(win).coords] if e['mid'].intersection(win).geom_type == 'LineString' else [], fill=(0, 200, 255), width=1)
            for b in bars:
                if abs(b[0] - cx) < H and abs(b[1] - cz) < H:
                    d.polygon([P(q) for q in rect(b).exterior.coords], outline=(255, 0, 255))
            for l in lanes + lanes_osm:
                q = pairs(l, 4)
                if any(abs(x - cx) < H and abs(z - cz) < H for x, z in q):
                    d.line([P(p) for p in q], fill=(255, 160, 0) if l[0] else (255, 255, 255), width=2)
            for f in J('markings'):
                if f['properties'].get('short_line_type') not in ('CROSSWALK', 'STOP_LINE'):
                    continue
                g = f['geometry']
                for l in ([g['coordinates']] if g['type'] == 'LineString' else g['coordinates']):
                    q = [loc(*p[:2]) for p in l]
                    if any(abs(x - cx) < H and abs(z - cz) < H for x, z in q):
                        d.line([P(p) for p in q], fill=(0, 0, 255), width=1)
            for k in range(5):
                d.line([(10 + k * 12.5, n - 12), (10 + (k + 1) * 12.5, n - 12)], fill=(255, 255, 255) if k % 2 else (0, 0, 0), width=5)
            img.save(os.path.join(a.overlay, 'graph-' + name.replace('/', '-').replace(' ', '') + '.png'))
        print('overlays in', a.overlay)


def near_oneway(e):
    return e['oneway']


if __name__ == '__main__':
    main()
