#!/usr/bin/env python3
"""v2 street level, near the camera: modelled roads, lane lines, curbs with gutters, sidewalk slabs, driveway cuts, lane arrows and
street signs, for v2/street_near.js. Within ~80 m of the camera these replace the aerial photograph on streets (owner, 2026-10-18:
"Can you get street level detail"); beyond, the photograph stays.

    V2_FOOTPRINTS=footprints.bin python3 scripts/v2/street_near.py CITY_CACHE Z19_TILE_CACHE
    (footprints.bin: node scripts/v2/street_footprints.mjs footprints.bin -1800 -1500 1401 3702 1.5, the Blender models' real footprints)

Writes v2/data/street/near.json (City of Austin data, roads from data/roads.geojson, measurements on the City's 2025 aerial). Frame:
v2/geo.js (x east, z south). Numbers rounded to 5 cm.

How each piece is placed (every one is checked against the photograph; counts and residuals are printed and stored in 'counts'):
  road surface  the centreline from data/roads.geojson, moved and sized by the City's crosswalks that cross it: a crosswalk line
                runs kerb to kerb, so its length is the road's width there and its middle is the road's middle. Roads no crosswalk
                crosses keep their data width.
  lane lines    found on the photograph, not invented: across each block the bake reads the aerial's brightness profile (median of
                many cuts), keeps thin bright peaks (paint), calls them yellow or white by colour and solid or dashed by how much of
                their length is bright, and draws them at that offset over the block.
  curbs         the road's two edges, with a 0.45 m concrete gutter inside; cut where another road crosses (intersections) and where
                a City driveway (vchz-d9ng DRIVEWAY) meets the kerb.
  sidewalks     the City's EXISTING_SIDEWALK lines give which side has a sidewalk, how wide (ft) and whether it meets the curb; the
                slab is drawn against the kerb (back_of_curb = Y) or past a verge as wide as the City line's distance says.
  arrows        the City's lane-use arrows (Markings_Specialty_Point, type 2), pointing along the road toward the block's nearer end.
  signs         the City's Roadway Sign Assets (ggnk-3ykn), one post per asset location, up to three panels by MUTCD code.
"""
import json, math, os, sys
from collections import defaultdict

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, 'v2', 'data', 'street', 'near.json')

# ── PARAMETERS ──────────────────────────────────────────────────────────
ORIGIN = {'lat': 30.28601, 'lon': -97.73932}
EARTH_R = 6378137.0
BOX = (-2100, 1500, -1600, 3100)          # v2 metres: campus, West Campus, the Drag, Speedway, downtown
ROAD_CLASSES = {'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'trunk', 'service'}
NO_CURB_CLASSES = {'service'}             # alleys and drives: asphalt, no kerb
XW_MATCH_ANGLE = math.radians(35)          # a crosswalk crosses a road within this of square
XW_WIDTH_RANGE = (5.0, 32.0)
GUTTER_M = 0.45
CLIP_PAD_M = 0.4                          # a curb stops this far inside another road's edge
DRIVEWAY_CUT_M = 4.5
SIDEWALK_SEARCH_M = 14.0
LINE = {'end_cut_m': 9.0, 'min_block_m': 26.0, 'step_m': 1.0, 'edge_keep_m': 0.7, 'peak_min': 0.045, 'peak_max_w_m': 0.45,
        'solid_min': 0.62, 'dash_min': 0.14, 'yellow_min': 0.025, 'dash': (3.0, 9.0)}
SIGN_FADE_NOTE = 'signs are drawn near the camera only (street_near.js)'
# The whole right-of-way, kerb to building face (owner's lane, 2026-10-18: "the strip between the curb and the buildings still
# drapes the aerial, so giant smeared, baked-in cars lie next to the clean road").
KERB = {'search_m': 3.0, 'min_step': 0.03, 'agree_m': 4.0, 'clamp': (-3.0, 4.5)}   # kerb offset vs the data edge, metres
KERB_BRIGHT, KERB_SAT, KERB_FRAC, KERB_RUN_M = 1.3, 0.12, 0.5, 1.0
ROW_MAX_M = 16.0              # beyond the kerb the modelled ground stops at a building face or here, whichever is nearer
FRONT_STEP_M = 3.0            # frontage samples along the street
FRONT_MIN_M = 0.6
GREEN_EXG = 0.035             # normalised excess green over the frontage band -> lawn
MULCH_RG = 0.035              # red over blue, darker than LAWN_LUM -> mulch / bare soil
MULCH_LUM = 0.32
ASPHALT_LUM = 0.36            # mean sRGB luminance below this and grey -> asphalt (parking lanes outside the measured kerb)
OCC_M = 0.5                   # building occupancy grid cell

D2R = math.pi / 180
KX = EARTH_R * D2R * math.cos(ORIGIN['lat'] * D2R)
KZ = EARTH_R * D2R
loc = lambda lon, lat: ((lon - ORIGIN['lon']) * KX, -(lat - ORIGIN['lat']) * KZ)
r5 = lambda v: round(v * 20) / 20
inbox = lambda x, z, m=0: BOX[0] - m <= x <= BOX[1] + m and BOX[2] - m <= z <= BOX[3] + m


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


def offset_line(pts, d):
    """The polyline moved d metres along its normal n = (-dz, dx) (mitred)."""
    out = []
    for i, p in enumerate(pts):
        a = pts[max(0, i - 1)]; b = pts[min(len(pts) - 1, i + 1)]
        L = seglen(a, b) or 1
        nx, nz = -(b[1] - a[1]) / L, (b[0] - a[0]) / L
        out.append((p[0] + nx * d, p[1] + nz * d))
    return out


def resample(pts, step):
    """[(x, z, s, nx, nz)] every `step` m."""
    out, s0 = [], 0.0
    for a, b in zip(pts[:-1], pts[1:]):
        L = seglen(a, b)
        if L < 1e-6:
            continue
        nx, nz = -(b[1] - a[1]) / L, (b[0] - a[0]) / L
        t = 0.0
        while t < L:
            out.append((a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L, s0 + t, nx, nz))
            t += step
        s0 += L
    if pts:
        a, b = pts[-2], pts[-1]
        L = seglen(a, b) or 1
        out.append((b[0], b[1], s0, -(b[1] - a[1]) / L, (b[0] - a[0]) / L))
    return out


def simplify(pts, tol=0.06):
    """Ramer-Douglas-Peucker: the bake samples every metre; straight runs need only their ends."""
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    L = seglen(a, b) or 1e-9
    dmax, imax = 0.0, 0
    for i in range(1, len(pts) - 1):
        p = pts[i]
        d = abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L
        if d > dmax:
            dmax, imax = d, i
    if dmax <= tol:
        return [a, b]
    return simplify(pts[:imax + 1], tol)[:-1] + simplify(pts[imax:], tol)


def thin_front(pts, tol=0.15, otol=0.4):
    """Drop frontage samples that lie on the line between their neighbours, in position and in depth (the bake samples every 3 m)."""
    if len(pts) < 3:
        return [[p[0], p[1], round(p[2], 1)] for p in pts]
    a, b = pts[0], pts[-1]
    L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1e-9
    worst, wi = 0.0, 0
    for i in range(1, len(pts) - 1):
        p = pts[i]
        t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (L * L)
        d = abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L / tol
        e = abs(p[2] - (a[2] + (b[2] - a[2]) * t)) / otol
        if max(d, e) > worst:
            worst, wi = max(d, e), i
    if worst <= 1.0:
        return [[a[0], a[1], round(a[2], 1)], [b[0], b[1], round(b[2], 1)]]
    return thin_front(pts[:wi + 1], tol, otol)[:-1] + thin_front(pts[wi:], tol, otol)


def seg_inter(p1, p2, p3, p4):
    d = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0])
    if abs(d) < 1e-9:
        return None
    t = ((p1[0] - p3[0]) * (p3[1] - p4[1]) - (p1[1] - p3[1]) * (p3[0] - p4[0])) / d
    u = -((p1[0] - p2[0]) * (p1[1] - p3[1]) - (p1[1] - p2[1]) * (p1[0] - p3[0])) / d
    if 0 <= t <= 1 and 0 <= u <= 1:
        return t, u
    return None


class Bands:
    """Road bands (centreline segments with half widths) in 40 m buckets: 'is this point on another road?'."""
    def __init__(self):
        self.g = defaultdict(list)

    def add(self, rid, pts, half):
        for a, b in zip(pts[:-1], pts[1:]):
            for i in range(int(min(a[0], b[0]) // 40) - 1, int(max(a[0], b[0]) // 40) + 2):
                for j in range(int(min(a[1], b[1]) // 40) - 1, int(max(a[1], b[1]) // 40) + 2):
                    self.g[(i, j)].append((rid, a, b, half))

    def inside(self, x, z, not_rid, pad=0.0):
        for rid, a, b, half in self.g.get((int(x // 40), int(z // 40)), []):
            if rid == not_rid:
                continue
            dx, dz = b[0] - a[0], b[1] - a[1]
            L2 = dx * dx + dz * dz or 1e-9
            t = max(0, min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2))
            if math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz)) < half - pad:
                return True
        return False


def runs(samples, keep):
    """Split resampled points into runs where keep(p) is true; returns lists of (x, z)."""
    out, cur = [], []
    for p in samples:
        if keep(p):
            cur.append((p[0], p[1]))
        else:
            if len(cur) >= 2:
                out.append(cur)
            cur = []
    if len(cur) >= 2:
        out.append(cur)
    return out


def main():
    city, tiles = sys.argv[1], sys.argv[2]
    import numpy as np
    from street_bake import OfflineAerial
    AE = OfflineAerial(tiles)
    J = lambda n: json.load(open(os.path.join(city, n + '.geojson')))['features']
    roads = []
    for f in json.load(open(os.path.join(REPO, 'data', 'roads.geojson')))['features']:
        p = f['properties']
        if p.get('k') != 'road' or p.get('c') not in ROAD_CLASSES:
            continue
        for l in lines(f['geometry']):
            if len(l) >= 2 and any(inbox(x, z) for x, z in l):
                roads.append({'pts': l, 'w': float(p.get('w') or 8), 'c': p.get('c'), 'ow': p.get('ow'), 'name': p.get('name'),
                              'xw_w': [], 'xw_off': []})
    print(len(roads), 'roads in the box')

    # ── widths and middles from the City's crosswalks ──
    xw = [l for f in J('markings') if f['properties'].get('short_line_type') == 'CROSSWALK' for l in lines(f['geometry'])]
    seg_grid = defaultdict(list)
    for ri, r in enumerate(roads):
        for a, b in zip(r['pts'][:-1], r['pts'][1:]):
            for i in range(int(min(a[0], b[0]) // 40), int(max(a[0], b[0]) // 40) + 1):
                for j in range(int(min(a[1], b[1]) // 40), int(max(a[1], b[1]) // 40) + 1):
                    seg_grid[(i, j)].append((ri, a, b))
    n_xw = 0
    for l in xw:
        a, b = l[0], l[-1]
        L = seglen(a, b)
        if not (XW_WIDTH_RANGE[0] <= L <= XW_WIDTH_RANGE[1]):
            continue
        cands = set()
        for i in range(int(min(a[0], b[0]) // 40), int(max(a[0], b[0]) // 40) + 1):
            for j in range(int(min(a[1], b[1]) // 40), int(max(a[1], b[1]) // 40) + 1):
                cands.update((ri, sa, sb) for ri, sa, sb in seg_grid.get((i, j), []))
        best = None
        for ri, sa, sb in cands:
            hit = seg_inter(a, b, sa, sb)
            if not hit:
                continue
            Ls = seglen(sa, sb) or 1
            ux, uz = (sb[0] - sa[0]) / Ls, (sb[1] - sa[1]) / Ls
            vx, vz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
            if abs(ux * vx + uz * vz) > math.sin(XW_MATCH_ANGLE):
                continue
            mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
            off = (mx - sa[0]) * -uz + (mz - sa[1]) * ux          # along n = (-dz, dx)
            if not best or abs(off) < abs(best[1]):
                best = (ri, off)
        if best and abs(best[1]) < 0.35 * L:
            roads[best[0]]['xw_w'].append(L * abs(math.cos(0)))
            roads[best[0]]['xw_off'].append(best[1])
            n_xw += 1
    dw, doff = [], []
    for r in roads:
        r['W'], r['off'] = r['w'], 0.0
        if r['xw_w']:
            W = float(np.median(r['xw_w'])); off = float(np.median(r['xw_off']))
            dw.append(W - r['w']); doff.append(off)
            r['W'], r['off'] = W, off
        r['mid'] = offset_line(r['pts'], r['off']) if abs(r['off']) > 0.05 else r['pts']
    print(f'crosswalks matched to roads: {n_xw}; roads sized by them: {len(dw)}; '
          f'width change median {np.median(dw) if dw else 0:.2f} m (|.| median {np.median(np.abs(dw)) if dw else 0:.2f}), '
          f'centre move |.| median {np.median(np.abs(doff)) if doff else 0:.2f} m, p90 {np.quantile(np.abs(doff), 0.9) if doff else 0:.2f} m')

    bands = Bands()
    for ri, r in enumerate(roads):
        bands.add(ri, r['mid'], r['W'] / 2)

    # ── kerbs per side: the data edge, the City sidewalk's inner edge and the photograph's asphalt-to-concrete step ──
    walks_src = []
    for f in J('sidewalks'):
        p = f['properties']
        if p.get('pedestrian_facility_type') != 'EXISTING_SIDEWALK':
            continue
        w = max(0.9, float(p.get('width') or 5) * 0.3048)
        for l in lines(f['geometry']):
            for q in resample(l, 3.0):
                walks_src.append((q[0], q[1], w, p.get('back_of_curb')))
    wgrid = defaultdict(list)
    for q in walks_src:
        wgrid[(int(q[0] // 20), int(q[1] // 20))].append(q)

    def side_walk(r, side):
        """City sidewalk on one side: (centre offset from mid, width, back_of_curb Y share) or None."""
        S = resample(r['mid'], 3.0)
        ds, ws, bcs = [], [], []
        for (x, z, s_, nx, nz) in S:
            for q in [q for i in (-1, 0, 1) for j in (-1, 0, 1) for q in wgrid.get((int(x // 20) + i, int(z // 20) + j), [])]:
                d = ((q[0] - x) * nx + (q[1] - z) * nz) * side
                along = abs((q[0] - x) * -nz + (q[1] - z) * nx)
                if r['W'] / 2 - 1.0 <= d <= r['W'] / 2 + SIDEWALK_SEARCH_M and along < 2.0:
                    ds.append(d); ws.append(q[2]); bcs.append(q[3])
        if len(ds) < 3:
            return None
        return float(np.median(ds)), float(np.median(ws)), bcs.count('Y') / max(1, bcs.count('Y') + bcs.count('N'))

    def photo_kerb(r, side, guess):
        """Where the street's surface turns to concrete on the photograph, going outward on one side (offset from mid), or None.
        Per cut across the street a pixel is 'concrete' when it is clearly brighter than the asphalt near the centre line and grey;
        over the whole block the kerb is the first offset where most cuts are concrete for KERB_RUN_M on end. Parked cars cover only
        part of a parking lane's length, so the lane stays 'not concrete' (a single step finder locked onto the cars' edge)."""
        S = resample(r['mid'], 1.0)
        if len(S) < 20:
            return None
        total = S[-1][2]
        core = [q for q in S if 8 <= q[2] <= total - 8]
        if len(core) < 10:
            return None
        P = np.array([[q[0], q[1]] for q in core]); N = np.array([[q[3], q[4]] for q in core]) * side
        t = np.arange(0.0, r['W'] / 2 + KERB['clamp'][1] + 2.0, 0.1)
        try:
            rgb = AE.A.sample(P[:, 0, None] + N[:, 0, None] * t, P[:, 1, None] + N[:, 1, None] * t)
        except KeyError:
            return None
        L = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        sat = rgb.max(-1) - rgb.min(-1)
        road = np.median(L[:, t < min(2.5, r['W'] / 4)])
        conc = (L > road * KERB_BRIGHT) & (sat < KERB_SAT)
        frac = conc.mean(0)
        run = int(KERB_RUN_M / 0.1)
        lo = r['W'] / 2 + KERB['clamp'][0]
        for k in range(len(t) - run):
            if t[k] >= lo and (frac[k:k + run] > KERB_FRAC).all():
                return float(t[k])
        return None

    kstat = {'data': 0, 'sidewalk': 0, 'photo': 0, 'photo+sidewalk': 0}
    for ri, r in enumerate(roads):
        r['k'] = {1: r['W'] / 2, -1: r['W'] / 2}
        r['walk'] = {}
        if r['c'] in NO_CURB_CLASSES:
            continue
        for side in (1, -1):
            sw = side_walk(r, side)
            r['walk'][side] = sw
            guess, src = r['W'] / 2, 'data'
            if sw and sw[2] >= 0.5:
                guess, src = sw[0] - sw[1] / 2, 'sidewalk'
            pk = photo_kerb(r, side, guess)
            if pk is not None and abs(pk - guess) <= KERB['agree_m']:
                guess = pk; src = 'photo+sidewalk' if src == 'sidewalk' else 'photo'
            lo, hi = r['W'] / 2 + KERB['clamp'][0], r['W'] / 2 + KERB['clamp'][1]
            r['k'][side] = float(min(hi, max(lo, max(1.5, guess))))
            kstat[src] += 1
    print('kerb sources (road sides):', kstat)

    # ── lane lines, found on the photograph ──
    lane = []   # [colour 0 white / 1 yellow, style 0 solid / 1 dashed, dash phase m, s at the first point m, x0, z0, x1, z1, ...]
    n_lane_blocks = 0
    for ri, r in enumerate(roads):
        if r['c'] == 'service':
            continue
        S = resample(r['mid'], LINE['step_m'])
        if not S or S[-1][2] < LINE['min_block_m']:
            continue
        total = S[-1][2]
        core = [p for p in S if LINE['end_cut_m'] <= p[2] <= total - LINE['end_cut_m']]
        if len(core) < 12:
            continue
        P = np.array([[p[0], p[1]] for p in core]); N = np.array([[p[3], p[4]] for p in core])
        lo_t, hi_t = -r['k'][-1] + LINE['edge_keep_m'], r['k'][1] - LINE['edge_keep_m']
        if hi_t - lo_t < 3.0:
            continue
        t = np.arange(lo_t, hi_t + 1e-9, 0.05)
        X = P[:, 0, None] + N[:, 0, None] * t; Z = P[:, 1, None] + N[:, 1, None] * t
        try:
            rgb = AE.A.sample(X, Z)
        except KeyError:
            continue
        n_lane_blocks += 1
        lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        yel = (rgb[..., 0] + rgb[..., 1]) / 2 - rgb[..., 2]
        prof = np.median(lum, axis=0)
        k = 31
        base = np.array([np.median(prof[max(0, i - k // 2):i + k // 2 + 1]) for i in range(len(prof))])
        hp = prof - base
        peaks = [i for i in range(2, len(t) - 2) if hp[i] > LINE['peak_min'] and hp[i] >= hp[i - 1] and hp[i] >= hp[i + 1]]
        for i in peaks:
            half_h = hp[i] / 2
            i0 = i
            while i0 > 0 and hp[i0 - 1] > half_h:
                i0 -= 1
            i1 = i
            while i1 < len(t) - 1 and hp[i1 + 1] > half_h:
                i1 += 1
            if (t[i1] - t[i0]) > LINE['peak_max_w_m']:
                continue
            along = lum[:, i] - np.array([np.median(lum[j, max(0, i - 14):i + 15]) for j in range(lum.shape[0])])
            frac = float((along > LINE['peak_min'] * 0.8).mean())
            if frac >= LINE['solid_min']:
                style, phase = 0, 0.0
            elif frac >= LINE['dash_min']:
                style = 1
                s = np.array([p[2] for p in core]); per = sum(LINE['dash'])
                best = max(((float(np.dot(along, np.where(((s - ph) % per) < LINE['dash'][0], 1.0, -0.3))), ph)
                            for ph in np.arange(0, per, 0.5)))
                phase = best[1]
            else:
                continue
            colour = 1 if float(np.median(yel[:, i]) - np.median(yel)) > LINE['yellow_min'] else 0
            ln = offset_line(r['mid'], float(t[i]))
            seg = [p for p in resample(ln, 1.0) if LINE['end_cut_m'] <= p[2] <= total - LINE['end_cut_m']]
            if len(seg) < 2:
                continue
            lane.append([colour, style, round(phase, 2), round(seg[0][2], 1)] + [r5(v) for p in simplify([q[:2] for q in seg]) for v in p])
            r['lanes_found'] = r.get('lanes_found', 0) + 1
    print(f'lane lines found: {len(lane)} on {n_lane_blocks} blocks read')

    # ── driveways (kerb cuts) ──
    drives = [l for f in J('sidewalks') if f['properties'].get('pedestrian_facility_type') == 'DRIVEWAY' for l in lines(f['geometry'])]
    dgrid = defaultdict(list)
    for l in drives:
        for a, b in zip(l[:-1], l[1:]):
            dgrid[(int((a[0] + b[0]) / 2 // 40), int((a[1] + b[1]) / 2 // 40))].append((a, b))

    # ── building occupancy (every extruded outline + the Blender models' real footprints), for the building face ──
    from PIL import Image, ImageDraw
    import street_mask as SM
    OW, OH = int((BOX[1] - BOX[0] + 80) / OCC_M), int((BOX[3] - BOX[2] + 80) / OCC_M)
    ox, oz = BOX[0] - 40, BOX[2] - 40
    occ_im = Image.new('L', (OW, OH), 0); od = ImageDraw.Draw(occ_im)
    for rings, h in SM.buildings():
        for ring in rings:
            od.polygon([((x - ox) / OCC_M, (z - oz) / OCC_M) for x, z in ring], fill=1)
    occ = np.asarray(occ_im, np.uint8).copy()
    fp = os.environ.get('V2_FOOTPRINTS')
    if fp and os.path.exists(fp):
        raw = open(fp, 'rb').read()
        cols, rows = np.frombuffer(raw[:8], np.int32); fx0, fz0, fcell = np.frombuffer(raw[8:20], np.float32)
        ids = np.frombuffer(raw[20:], np.uint16).reshape(rows, cols)
        jj, ii = np.nonzero(ids)
        X = ((fx0 + (ii + 0.5) * fcell - ox) / OCC_M).astype(int); Z = ((fz0 + (jj + 0.5) * fcell - oz) / OCC_M).astype(int)
        ok = (X >= 0) & (X < OW) & (Z >= 0) & (Z < OH)
        occ[Z[ok], X[ok]] = 1

    def face_dist(x, z, nx, nz, start, stop):
        """Distance from the mid point along (nx, nz) to the first building cell between start and stop, else stop."""
        for d in np.arange(start, stop, OCC_M / 2):
            i, j = int((x + nx * d - ox) / OCC_M), int((z + nz * d - oz) / OCC_M)
            if 0 <= i < OW and 0 <= j < OH and occ[j, i]:
                return float(d)
        return float(stop)

    def ground_class(x, z, nx, nz, d0, d1):
        t = np.arange(d0 + 0.2, max(d0 + 0.3, d1 - 0.2), 0.3)
        try:
            rgb = AE.A.sample(x + nx * t, z + nz * t)
        except KeyError:
            return 0
        R, G, B = rgb[:, 0].mean(), rgb[:, 1].mean(), rgb[:, 2].mean()
        exg = (2 * G - R - B) / (R + G + B + 1e-6); lum = 0.2126 * R + 0.7152 * G + 0.0722 * B
        sat = float(np.median(rgb.max(-1) - rgb.min(-1)))
        if exg > GREEN_EXG:
            return 1
        if R - B > MULCH_RG and lum < MULCH_LUM:
            return 2
        if lum < ASPHALT_LUM and sat < 0.08:
            return 3          # a parking lane, a driveway or a lot's edge: asphalt
        return 0

    curbs, walks, aprons, fronts = [], [], [], []
    n_cut_drive = 0
    for ri, r in enumerate(roads):
        if r['c'] in NO_CURB_CLASSES:
            continue
        for side in (1, -1):
            K = r['k'][side]
            edge = offset_line(r['mid'], side * K)
            S = resample(edge, 1.0)
            if len(S) < 3:
                continue
            # driveways crossing this edge: cut the kerb there
            cuts = []
            for a, b in zip(edge[:-1], edge[1:]):
                for (da, db) in dgrid.get((int((a[0] + b[0]) / 2 // 40), int((a[1] + b[1]) / 2 // 40)), []):
                    h = seg_inter(a, b, da, db)
                    if h:
                        cuts.append((a[0] + (b[0] - a[0]) * h[0], a[1] + (b[1] - a[1]) * h[0]))
            def keep(p):
                if bands.inside(p[0], p[1], ri, CLIP_PAD_M):
                    return False
                return not any(math.hypot(p[0] - c[0], p[1] - c[1]) < DRIVEWAY_CUT_M / 2 for c in cuts)
            for run in runs(S, keep):
                c = run if side == 1 else run[::-1]      # stored so the road lies toward (dz, -dx) of the direction (the +n edge already does)
                curbs.append([r5(v) for p in simplify(c) for v in p])
            n_cut_drive += len(cuts)
            for c in cuts:
                aprons.append([r5(c[0]), r5(c[1])])
            sw = r['walk'].get(side)
            w, gap = 0.0, 0.0
            if sw:
                w = sw[1]
                gap = 0.0 if sw[2] >= 0.5 else float(min(4.0, max(0.0, sw[0] - sw[1] / 2 - K)))
                mid = offset_line(r['mid'], side * (K + gap + w / 2))
                Sm = resample(mid, 1.0)
                for run in runs(Sm, lambda p: not bands.inside(p[0], p[1], ri, -w / 2 - gap)):
                    walks.append([round(w, 2)] + [r5(v) for p in simplify(run) for v in p])
            # the rest of the right-of-way: a planting strip between kerb and sidewalk, and the frontage from the sidewalk (or the
            # kerb) to the building face, each a run of samples with a class read off the photograph (0 paving, 1 lawn, 2 mulch)
            Sm = resample(r['mid'], FRONT_STEP_M)
            for (z0, z1, kind) in ((K, K + gap, 'strip'), (K + gap + w, None, 'front')):
                if kind == 'strip' and gap < FRONT_MIN_M:
                    continue
                cur, cls_prev = [], None
                def flush():
                    if len(cur) >= 2:
                        q = thin_front(cur)
                        fronts.append([cls_prev, round(side * z0, 1)] + [v for e in q for v in e])
                for (x, z, s_, nx, nz) in Sm:
                    ex, ez = x + nx * side * (z0 + 0.3), z + nz * side * (z0 + 0.3)
                    if bands.inside(ex, ez, ri, -0.2):
                        flush(); cur = []; cls_prev = None; continue
                    d1 = z1 if z1 is not None else face_dist(x, z, nx * side, nz * side, z0, K + ROW_MAX_M)
                    if d1 - z0 < FRONT_MIN_M:
                        flush(); cur = []; cls_prev = None; continue
                    c = ground_class(x, z, nx * side, nz * side, z0, d1)
                    if cls_prev is not None and c != cls_prev:
                        last = cur[-1]; flush(); cur = [last]
                    cls_prev = c
                    cur.append([r5(x), r5(z), round(side * d1, 2)])
                flush()

    # ── lane-use arrows ──
    arrows = []
    KIND = {1: 0, 2: 1, 3: 2, 6: 3, 7: 4, 4: 5, 5: 6, 8: 7}     # through, left, right, left+through, right+through, left+right, all, U
    for f in J('arrows'):
        p, g = f['properties'], f.get('geometry')
        if not g or p.get('SPECIALTY_POINT_TYPE') != 2 or p.get('SPECIALTY_POINT_SUB_TYPE') not in KIND:
            continue
        x, z = loc(*g['coordinates'][:2])
        if not inbox(x, z):
            continue
        best = None
        for ri, r in enumerate(roads):
            pass
        cands = [(ri, a, b) for i in (-1, 0, 1) for j in (-1, 0, 1) for (ri, a, b) in seg_grid.get((int(x // 40) + i, int(z // 40) + j), [])]
        for ri, a, b in cands:
            dx, dz = b[0] - a[0], b[1] - a[1]; L2 = dx * dx + dz * dz or 1e-9
            t = max(0, min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2))
            d = math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz))
            if not best or d < best[0]:
                best = (d, ri, a, b)
        if not best or best[0] > 20:
            continue
        _, ri, a, b = best
        ang = math.atan2(b[1] - a[1], b[0] - a[0])
        ends = roads[ri]['pts']
        # point toward the nearer end of the block (the stop line the arrow leads to); one-way roads run start -> end
        if roads[ri]['ow']:
            fwd = True
        else:
            fwd = math.hypot(x - ends[-1][0], z - ends[-1][1]) < math.hypot(x - ends[0][0], z - ends[0][1])
        if not fwd:
            ang += math.pi
        arrows.append([r5(x), r5(z), round(ang, 3), KIND[p['SPECIALTY_POINT_SUB_TYPE']]])

    # ── signs: one post per asset location ──
    posts = defaultdict(list)
    for f in J('signs'):
        p, g = f['properties'], f.get('geometry')
        if not g or p.get('asset_status') != '1':
            continue
        x, z = loc(*g['coordinates'][:2])
        if inbox(x, z):
            posts[p.get('asset_location_id') or (round(x, 1), round(z, 1))].append((x, z, p.get('mutcd_code') or '', p.get('direction_facing')))
    FACE = {'N': 0, 'NE': 45, 'E': 90, 'SE': 135, 'S': 180, 'SW': 225, 'W': 270, 'NW': 315}
    def kind(code):
        c = code.upper()
        if c.startswith('R1-1'): return 1            # stop
        if c.startswith('D3'): return 2              # street name blade
        if c.startswith('R1-2'): return 3            # yield
        if c.startswith('W') or c.startswith('S1'): return 4   # warning diamond (yellow)
        if c.startswith('R2'): return 5              # speed limit
        return 0                                     # other regulatory / parking: small white panel
    signs = []
    for key, lst in posts.items():
        x = sum(q[0] for q in lst) / len(lst); z = sum(q[1] for q in lst) / len(lst)
        panels = []
        for q in sorted(lst, key=lambda q: (kind(q[2]) != 2, kind(q[2]) != 1))[:3]:
            f = FACE.get(q[3])
            if f is None:   # no facing recorded: face the nearest road
                cands = [(ri, a, b) for i in (-1, 0, 1) for j in (-1, 0, 1) for (ri, a, b) in seg_grid.get((int(x // 40) + i, int(z // 40) + j), [])]
                best = None
                for ri, a, b in cands:
                    dx, dz = b[0] - a[0], b[1] - a[1]; L2 = dx * dx + dz * dz or 1e-9
                    t = max(0, min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2))
                    px, pz = a[0] + t * dx, a[1] + t * dz; d = math.hypot(x - px, z - pz)
                    if not best or d < best[0]:
                        best = (d, px, pz)
                ang = math.atan2(best[2] - z, best[1] - x) if best else 0.0
            else:
                # compass facing (0 = the sign's face looks north) -> angle of the face normal from +x toward +z
                ang = math.radians(f - 90)
            panels.append([kind(q[2]), round(ang, 2)])
        signs.append([r5(x), r5(z), len(panels)] + [v for pn in panels for v in pn])

    out = {
        'about': 'v2 near street detail (scripts/v2/street_near.py). City of Austin open data (markings 9hak-anfp, sidewalks vchz-d9ng, '
                 'specialty points, Roadway Sign Assets ggnk-3ykn) and lane lines read from the City of Austin 2025 aerial; road centrelines '
                 'from data/roads.geojson. Not endorsed by the City of Austin.',
        'frame': 'v2/geo.js: x metres east, z metres south of 30.28601, -97.73932',
        # [kerb offset on the -n side (as a negative number), kerb offset on the +n side, flags (1 no kerb, 2 one-way), x0, z0, ...]
        'roads': [[round(-r['k'][-1], 2), round(r['k'][1], 2), (1 if r['c'] in NO_CURB_CLASSES else 0) + (2 if r.get('ow') else 0)] + [r5(v) for p in simplify(r['mid'], 0.03) for v in p] for r in roads],
        # [class 0 paving / 1 lawn / 2 mulch / 3 asphalt, inner offset (signed), then x, z, outer offset (signed) per sample along the mid line]
        'fronts': fronts,
        'lanes': lane, 'curbs': curbs, 'walks': walks, 'aprons': aprons, 'arrows': arrows, 'signs': signs,
        'counts': {'roads': len(roads), 'roads_sized_by_crosswalks': len(dw),
                   'road_centre_move_median_abs_m': round(float(np.median(np.abs(doff))), 2) if doff else None,
                   'road_centre_move_p90_abs_m': round(float(np.quantile(np.abs(doff), 0.9)), 2) if doff else None,
                   'road_width_change_median_abs_m': round(float(np.median(np.abs(dw))), 2) if dw else None,
                   'kerb_sources': kstat, 'right_of_way_runs': len(fronts),
                   'lane_lines': len(lane), 'lane_blocks_read': n_lane_blocks, 'curb_runs': len(curbs), 'walk_runs': len(walks),
                   'driveway_cuts': n_cut_drive, 'arrows': len(arrows), 'sign_posts': len(signs)},
    }
    json.dump(out, open(OUT, 'w'), separators=(',', ':'))

    osm = json.load(open(os.path.join(REPO, 'data', 'osm_cache', 'roads.json')))
    ways = defaultdict(list)
    for e in osm['elements']:
        t = e.get('tags') or {}
        if t.get('name') and t.get('lanes') and e.get('geometry'):
            ways[t['name'].lower()].append((t, [loc(g['lon'], g['lat']) for g in e['geometry']]))
    olanes = []
    for r in roads:
        if r.get('lanes_found') or r['c'] in NO_CURB_CLASSES or not r.get('name'):
            continue
        S = resample(r['mid'], 2.0)
        if not S or S[-1][2] < LINE['min_block_m']:
            continue
        mx, mz = S[len(S) // 2][0], S[len(S) // 2][1]
        best = None
        for t, g in ways.get(r['name'].lower(), []):
            d = min(math.hypot(x - mx, z - mz) for x, z in g)
            if d < 15 and (not best or d < best[0]):
                best = (d, t)
        if not best:
            continue
        t = best[1]
        try:
            n = int(str(t['lanes']).split(';')[0])
        except ValueError:
            continue
        oneway = t.get('oneway') == 'yes'
        lo, hi = -r['k'][-1], r['k'][1]
        if n < 2 or hi - lo < 2.8 * n:
            continue
        total = S[-1][2]
        def put(off, colour, style):
            seg = [q for q in resample(offset_line(r['mid'], off), 1.0) if LINE['end_cut_m'] <= q[2] <= total - LINE['end_cut_m']]
            if len(seg) >= 2:
                olanes.append([colour, style, 0.0, round(seg[0][2], 1)] + [r5(v) for q in simplify([q[:2] for q in seg]) for v in q])
        lw = (hi - lo) / n
        for k in range(1, n):
            off = lo + k * lw
            if not oneway and k == n // 2 and n % 2 == 0:
                put(off - 0.1, 1, 0); put(off + 0.1, 1, 0)       # double yellow centre line
            else:
                put(off, 0, 1)
    OUT_OSM = OUT.replace('near.json', 'near_osm.json')
    json.dump({'_license': '© OpenStreetMap contributors, ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/). Lane lines placed from '
                           'OpenStreetMap lane counts (lanes=*) where the City aerial showed none; a derivative database offered under the ODbL.',
               'frame': out['frame'], 'lanes': olanes}, open(OUT_OSM, 'w'), separators=(',', ':'))
    print('OSM lane lines', len(olanes), OUT_OSM)
    print(json.dumps(out['counts']))
    print(OUT, os.path.getsize(OUT), 'bytes')


if __name__ == '__main__':
    main()
