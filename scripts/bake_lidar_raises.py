# -*- coding: utf-8 -*-
"""The short list of buildings the 2021 laser scan makes TALLER.

OWNS ONE OUTPUT FILE: data/lidar_raises.json. Nothing else writes it, and this
script writes nothing else in the repo.

WHY
    data/lidar_heights.json is the whole measurement: 2,315 buildings, with
    the steps, the flags and the review notes, 288 KB. The app's default only
    RAISES buildings (the scan is from early 2021, so a lower reading may only
    be old; see the guard in scripts/bake_lidar_heights.py), and that is about
    a hundred buildings. Every visitor would download the whole table to use 4%
    of it. This script cuts the table down to what the default needs: one
    number per building, the height to raise it to.

THE RULE (one place, here, so the app has no second copy to drift)
    A building is on the list when all of these hold:
      - it is drawn as the plain prism (no `x` in the table) and is not in the
        review list (no `rv`);
      - the scan reading is not one the measuring bake distrusts (SKIP_FLAGS);
      - its footprint is at least MIN_AREA_M2 and at least 4 m wide (not
        flagged `small`). A smaller one holds a handful
        of scan cells, and they belong as much to what stands beside it: a
        2 m x 4 m sliver next to a tower read 24 m and would have been drawn
        as a 24 m pole;
      - the target height is more than MIN_RAISE_M above the height the app
        drew when the table was baked (`d`).

    The target height is NOT always the table's `h`. `h` is the 90th percentile
    of the roof, which on a tower that stands on a wide podium is the tower. A
    prism has one height for the whole footprint, so `h` would draw the podium
    as tall as the tower: a block twice as fat as the real one. So:

      - if the top step covers at least MIN_TOP_SHARE of the footprint, or the
        roof has one step, the target is `h`;
      - else the target is the HALF-ROOF height: walk the steps from the top
        down and stop at the first one where the area so far reaches
        MIN_TOP_SHARE. At least that share of the roof is this tall or taller.

    The county courts building (drawn 7.3 m) has steps 67.8 m (30%), 63.1 m
    (20%) and 4.6 m (50%). `h` is 70.5 m; the half-roof height is 63.1 m.
    A building whose half-roof height is not above the drawn height is left
    alone: its tall part is under half of it, and one prism cannot show that.

THE APP
    js/app.js reads this file on every load unless the URL carries
    ?lidarheights=0, and raises `final_height` to the number here when it is
    still above the building's height in the snapshot it loaded. See
    LIDAR_HEIGHTS in js/app.js.

USAGE
    python scripts/bake_lidar_raises.py            # writes data/lidar_raises.json
    python scripts/bake_lidar_raises.py --table    # also prints every raise
"""
import argparse
import json
import math
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC = os.path.join(ROOT, 'data', 'lidar_heights.json')
OUT = os.path.join(ROOT, 'data', 'lidar_raises.json')

# Scan readings the measuring bake distrusts.
SKIP_FLAGS = {'sparse', 'low_class6', 'few_cells', 'off_raster'}
# The share of the footprint that must reach the target height.
MIN_TOP_SHARE = 0.5
# A raise smaller than this is noise, not a correction.
MIN_RAISE_M = 0.5
# No raise for a footprint smaller than this (a garden shed is about 10 m2, a
# small house about 80), nor for one the measuring bake flagged `small` (under
# 4 m wide).
MIN_AREA_M2 = 60.0


def target_height(m):
    """The height to raise this building to, from its steps (see THE RULE)."""
    steps = m.get('steps') or []
    if len(steps) <= 1 or steps[0][1] >= MIN_TOP_SHARE:
        return m['h']
    covered = 0.0
    for height, share in steps:          # the bake writes them highest first
        covered += share
        if covered >= MIN_TOP_SHARE:
            return height
    return steps[-1][0]


def ring_area_m2(ring):
    """Area of a lon/lat ring in square metres (flat-earth, fine at this size)."""
    lat0 = math.radians(sum(c[1] for c in ring) / len(ring))
    kx, ky = 111320.0 * math.cos(lat0), 110860.0
    a = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        a += (x1 * kx) * (y2 * ky) - (x2 * kx) * (y1 * ky)
    return abs(a) / 2.0


def footprint_areas(snapshot):
    path = os.path.join(ROOT, 'data', 'snapshots', snapshot, 'buildings.detailed.geojson')
    areas = {}
    for f in json.load(open(path, encoding='utf-8'))['features']:
        g = f.get('geometry') or {}
        polys = [g['coordinates']] if g.get('type') == 'Polygon' else (g.get('coordinates') or [])
        total = 0.0
        for poly in polys:
            total += ring_area_m2([c[:2] for c in poly[0]])
            for hole in poly[1:]:
                total -= ring_area_m2([c[:2] for c in hole])
        areas[(f.get('properties') or {}).get('id')] = total
    return areas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--table', action='store_true', help='print every raise')
    a = ap.parse_args()
    src = json.load(open(SRC, encoding='utf-8'))
    areas = footprint_areas(src['_snapshot'])
    raises, rows = {}, []
    stepped = left_alone = too_small = 0
    for bid, m in src['buildings'].items():
        if m.get('x') or m.get('rv') or not isinstance(m.get('h'), (int, float)):
            continue
        drawn = m.get('d')
        if not isinstance(drawn, (int, float)) or m['h'] - drawn < MIN_RAISE_M:
            continue                     # the scan does not read it taller
        flags = set(str(m.get('q') or '').split(','))
        if SKIP_FLAGS & flags:
            continue
        if 'small' in flags or areas.get(bid, 0.0) < MIN_AREA_M2:
            too_small += 1
            continue
        t = round(float(target_height(m)), 1)
        if t - drawn < MIN_RAISE_M:
            left_alone += 1              # only the tall part is taller, and it is under half
            continue
        if t != m['h']:
            stepped += 1
        raises[bid] = t
        rows.append((t - drawn, drawn, t, m['h'], bid))
    doc = {
        '_what': 'Buildings the 2021 airborne laser scan raises: id -> height in metres above ground. '
                 'Read on every load unless the page URL carries ?lidarheights=0.',
        '_source': src.get('_source'),
        '_method': 'Cut from data/lidar_heights.json by scripts/bake_lidar_raises.py: plain prisms of '
                   '%d m2 or more, no distrusted reading, and the height at least %d%% of the roof reaches.'
                   % (MIN_AREA_M2, round(MIN_TOP_SHARE * 100)),
        '_snapshot': src.get('_snapshot'),
        'year': src.get('year'),
        'min_top_share': MIN_TOP_SHARE,
        'min_area_m2': MIN_AREA_M2,
        'buildings': dict(sorted(raises.items())),
    }
    with open(OUT, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(doc, fh, separators=(',', ':'))
        fh.write('\n')
    rows.sort(reverse=True)
    if a.table:
        for delta, drawn, t, h, bid in rows:
            print('%6.1f  %5.1f -> %5.1f  (p90 %5.1f)  %s' % (delta, drawn, t, h, bid))
    print(json.dumps({
        'raises': len(raises),
        'of_those_at_the_half_roof_height': stepped,
        'left_alone_tall_part_under_half': left_alone,
        'left_alone_footprint_too_small': too_small,
        'over_10_m': sum(1 for r in rows if r[0] > 10),
        'over_5_m': sum(1 for r in rows if r[0] > 5),
        'over_2_m': sum(1 for r in rows if r[0] > 2),
        'bytes': os.path.getsize(OUT),
    }, indent=1))


if __name__ == '__main__':
    main()
