# -*- coding: utf-8 -*-
"""Join what the renderer draws to the building footprints.

Reads the dump that scripts/verify/drawn-heights.mjs writes (every fill-extrusion
feature that can be a building, the authored meshes' tops, the hide list of the
plain prisms) and says, per footprint in the latest snapshot:

    drawn_h     the highest thing drawn on it (m above the ground)
    path        which way it is drawn
    prism_h     the plain prism's own height (`final_height`), drawn or not
    paths       every path that puts something on the footprint

THE RULE for drawn_h: an authored mesh (js/slopes-apartments.js) replaces the
prism and every band, so its own top is the answer. Otherwise it is the maximum
over the prism (unless the prism is on the hide list or the building is drawn
from parts) and every extrusion feature that lies mostly inside the footprint:
West Campus bands, hero designs, parts, pitched roofs, the Tower. Roof clutter
(`roofscape-*`) and the parapet cap do not count: they sit on the roof, they are
not the roof.

Output: one JSON, id -> {drawn_h, path, prism_h, paths, mesh}. It is an input to
scripts/bake_lidar_heights.py (--drawn). Nothing in the repo is written.

    python scripts/lidar_drawn.py <drawn-dump.json> <out.json>
"""
import json
import os
import re
import sys

from shapely.geometry import Polygon, shape
from shapely.strtree import STRtree

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# layer id pattern -> the name of the way it is drawn
PATHS = [
    (r'^wc-', 'West Campus bands'),
    (r'^heroes-', 'hero design'),
    (r'^campus-storeys', 'campus storeys'),
    (r'^moody-', 'Moody precinct'),
    (r'^drag-', 'Drag buildings'),
    (r'^arts-', 'arts buildings'),
    (r'^stadium|^dkr', 'stadium'),
    (r'^tower', 'UT Tower parts'),
    (r'^parts-', 'OSM parts'),
    (r'^roofs-', 'pitched roof'),
    (r'^capitol|^cap-', 'Capitol'),
    (r'^places', 'places'),
    (r'^outer', 'outer ring'),
]
NOT_THE_ROOF = re.compile(r'^(roofscape-|buildings-roof$|buildings-ao$)')
PRISM = 'plain prism'


def path_of(layer_id):
    for pat, name in PATHS:
        if re.search(pat, layer_id):
            return name
    return layer_id


def mesh_kinds():
    """id -> which family an authored mesh belongs to. Every mesh is loaded by
    js/slopes-apartments.js; the campus halls (data/campus_buildings.json) are
    the hand-built campus models, everything else is an apartment or street
    building."""
    out = {}
    p = os.path.join(ROOT, 'data', 'campus_buildings.json')
    if os.path.exists(p):
        for b in (json.load(open(p, encoding='utf-8')).get('buildings') or []):
            if isinstance(b, dict) and b.get('id'):
                out[b['id']] = 'campus hand model'
    return out


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    dump = json.load(open(sys.argv[1], encoding='utf-8'))
    sys.path.insert(0, HERE)
    import bake_lidar_heights as B
    snap_dir, snap = B.latest_snapshot()
    foot = B.load_app_buildings(snap_dir)
    polys, ids = [], []
    for f in foot:
        try:
            polys.append(shape(f['geometry']).buffer(0))
            ids.append(f['properties']['id'])
        except Exception:
            polys.append(Polygon())
            ids.append(f['properties']['id'])
    tree = STRtree(polys)
    layers = dump['layers']
    skip_layer = [bool(NOT_THE_ROOF.match(l['id'])) or l['id'] == 'buildings-3d' for l in layers]
    hidden = set()
    for fl in dump.get('filters', {}).values():
        hidden |= set(re.findall(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', fl or ''))
    meshes = {b['id']: b for b in dump.get('built', []) if b.get('id')}
    kinds = mesh_kinds()
    prism = {p['id']: p for p in dump.get('prisms', [])}

    contrib = {i: [] for i in ids}           # id -> [(top, path)]
    for li, cx, cy, base, top, ring, idp in dump['feats']:
        if skip_layer[li]:
            continue
        try:
            fp = Polygon(ring).buffer(0)
        except Exception:
            continue
        if fp.is_empty or fp.area <= 0:
            continue
        best, best_a = None, 0.0
        for j in tree.query(fp, predicate='intersects'):
            a = fp.intersection(polys[j]).area
            if a > best_a:
                best, best_a = j, a
        if best is not None and best_a / fp.area >= 0.5:
            contrib[ids[best]].append((top, path_of(layers[li]['id'])))

    out = {}
    for f in foot:
        p = f['properties']
        i = p['id']
        pr = prism.get(i, {})
        prism_h = pr.get('final_height', p.get('final_height'))
        parts_drawn = bool(p.get('has_parts'))
        cands = list(contrib[i])
        prism_drawn = (i not in hidden) and not parts_drawn and prism_h is not None
        if prism_drawn:
            cands.append((float(prism_h), PRISM))
        if i in meshes and meshes[i].get('top') is not None:
            top = float(meshes[i]['top'])
            kind = kinds.get(i, 'apartment mesh')
            out[i] = {'drawn_h': round(top, 2), 'path': kind, 'prism_h': prism_h,
                      'paths': sorted({c[1] for c in cands} | {kind}),
                      'mesh': meshes[i].get('name')}
            continue
        if not cands:
            why = 'hidden, drawn by something this join cannot see' if (i in hidden or parts_drawn) else 'nothing drawn'
            out[i] = {'drawn_h': None, 'path': why, 'prism_h': prism_h, 'paths': []}
            continue
        top, path = max(cands, key=lambda c: c[0])
        out[i] = {'drawn_h': round(float(top), 2), 'path': path, 'prism_h': prism_h,
                  'paths': sorted({c[1] for c in cands}), 'mesh': None}
    json.dump({'snapshot': snap, 'knob': dump.get('lidar'), 'buildings': out}, open(sys.argv[2], 'w'))
    import collections
    c = collections.Counter(v['path'] for v in out.values())
    print('footprints', len(out), 'hidden prism ids', len(hidden), 'authored meshes', len(meshes))
    for k, v in c.most_common():
        print('  %-24s %d' % (k, v))


if __name__ == '__main__':
    main()
