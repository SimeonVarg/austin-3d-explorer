#!/usr/bin/env python3
"""v2 tiles, step 1: which .blend is the current best model of each building, and where it stands.

    python3 scripts/v2/sources.py OUT.json

Reads the private build records (BUILDS.json rows with status "best"), finds each build's .blend, hashes it, and places it:
  the model's own origin is the mean of its CITY MAP outline's points (the packages' rule: footprint.json / footprint.map.json name the
  outlines by map_id; the map is data/snapshots/<latest>/buildings.detailed.geojson). That origin goes into the v2 frame (manifest.json).
Writes one row per best build: blend path + sha256, model, name, map ids, origin lng/lat, frame x/z, tile id, the map outline rings in the
model's own metres (for the placement check), or `skip` with the reason. Paths in OUT stay on this machine (it is a cache file).
"""
import json, os, glob, sys, math, hashlib, re

H = os.path.expanduser('~')
PRIV = os.environ.get('V2_PRIVATE', H + '/flyover-private/blender-2026-10-11')
B = PRIV + '/batch1'
TASKS = os.environ.get('V2_TASKS', H + '/Projects/astra-pipe/tasks')
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ── PARAMETERS ──────────────────────────────────────────────────────────
ORIGIN = {'lat': 30.28601, 'lon': -97.73932}   # the v2 frame's origin (manifest.json)
M_PER_DEG = 111320.0                            # the packages' own number (footprint.json metres were made with it)
TILE_M = 250.0                                  # tiles are squares of this side on the origin's grid
MODEL_KEY = {'claude-opus-5-5': 'opus', 'gpt-6.1-sol': 'sol', 'claude-sonnet-5-5': 'sonnet'}
# where each builder's output lives inside a package folder (the newest qualifying .blend wins)
OUT_DIRS = {'opus': ('out-opus', 'out-opus-*'), 'sonnet': ('out-sonnet', 'out-sonnet-*', 'out-opus-glass', 'detail-sonnet'), 'sol': ('out-sol', 'out-sol-*')}
NOT_A_MODEL = re.compile(r'(_before_|\.before-|^work\.blend$|\.blend\d+$)')
# the ledger's slug and the package folder's name differ for these (checked by hand, 2026-10-17)
ALIASES = {'the-venue': 'the-venue-on-guadalupe', 'villas-at-san-gabriel': 'villas-san-gabriel', 'texas-hillel': 'texas-hillel-foundation',
           'regents-west-at-24th': 'regents-west-24th', 'texan-26': 'texan26', 'austin-by-ellsworth-kelly': 'austin-ellsworth-kelly',
           'william-p-clements-jr-state-office-building': 'william-p-clements-jr-building',
           'william-b-travis-state-office-building': 'william-b-travis-building'}
# best builds that are not one building on the map (said why)
NOT_BUILDINGS = {'speedway': 'a stretch of road (Speedway), not a building: it has no map outline to place it by',
                 'belo': 'name never confirmed and not placed on the map (its ledger row says so)'}


def to_frame(lon, lat):
    x = (lon - ORIGIN['lon']) * M_PER_DEG * math.cos(math.radians(ORIGIN['lat']))
    z = -(lat - ORIGIN['lat']) * M_PER_DEG
    return x, z


def tile_of(x, z):
    i, j = math.floor(x / TILE_M), math.floor(z / TILE_M)
    return 't_%d_%d' % (i, j)


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''): h.update(b)
    return h.hexdigest()


def blends_in(d):
    out = []
    for p in glob.glob(d + '/*.blend'):
        if not NOT_A_MODEL.search(os.path.basename(p)): out.append(p)
    return out


def find_blend(folder, slug, model):
    cands = []
    for pat in OUT_DIRS[model]:
        for d in glob.glob(folder + '/' + pat):
            if os.path.isdir(d): cands += blends_in(d)
    if model == 'sol' and not cands:        # a paid builder's task folder: tasks/<n>-<name>-...sol/out/
        for name in {os.path.basename(folder), slug}:
            for d in glob.glob(TASKS + '/*-' + name + '-*sol*/out'):
                cands += blends_in(d)
    if not cands: return None
    return max(cands, key=os.path.getmtime)


def main(out_path):
    rows = json.load(open(B + '/BUILDS.json'))['builds']
    best = [r for r in rows if r.get('status') == 'best']
    geo = sorted(glob.glob(REPO + '/data/snapshots/*/buildings.detailed.geojson'))[-1]
    feats = json.load(open(geo))['features']
    by_id = {}
    for f in feats:
        fid = str(f['properties'].get('id', ''))
        if fid: by_id[fid] = f
    # downtown and Capitol packages name OpenStreetMap outlines ('osm<way id>'): the repo's OSM caches hold them
    for f in ('data/osm_cache/downtown_buildings.json',):
        for row in json.load(open(REPO + '/' + f))['rows']:
            if row.get('g'):
                by_id.setdefault('osm' + row['id'][1:], {'geometry': {'type': 'Polygon', 'coordinates': [row['g'][0]]}})
    for f in ('data/osm_cache/capitol_area.json',):
        for el in json.load(open(REPO + '/' + f))['elements']:
            if el.get('type') == 'way' and el.get('geometry') and 'building' in (el.get('tags') or {}):
                by_id.setdefault('osm%d' % el['id'], {'geometry': {'type': 'Polygon', 'coordinates': [[[p['lon'], p['lat']] for p in el['geometry']]]}})
    res = {}
    for r in best:
        slug = r['slug']; model = MODEL_KEY.get(r['model'], r['model'])
        row = {'slug': slug, 'name': r.get('building') or slug, 'model': model, 'kind': r.get('kind'), 'score': r.get('score'), 'camera': r.get('camera')}
        res[slug] = row
        if slug in NOT_BUILDINGS: row['skip'] = NOT_BUILDINGS[slug]; continue
        folder = B + '/' + ALIASES.get(slug, slug)
        if not os.path.isdir(folder): row['skip'] = 'no package folder found for this slug'; continue
        row['package'] = os.path.basename(folder)
        blend = find_blend(folder, slug, model)
        if not blend: row['skip'] = 'no .blend found in the %s output folders' % model; continue
        row['blend'] = blend; row['blend_sha256'] = sha(blend); row['blend_mtime'] = os.path.getmtime(blend)
        fpp = folder + '/footprint.map.json' if os.path.exists(folder + '/footprint.map.json') else folder + '/footprint.json'
        if not os.path.exists(fpp): row['skip'] = 'no footprint.json (no surveyed outline to place it by)'; continue
        fp = json.load(open(fpp))
        pref = []
        for o in fp.get('outlines', []):
            if o.get('map_id') and o['map_id'] not in pref: pref.append(o['map_id'])
        ids, pts, rings = [], [], []
        for want in pref:
            hit = [k for k in by_id if k.startswith(want)]
            for k in hit[:1]:
                g = by_id[k]['geometry']; rr = [g['coordinates'][0]] if g['type'] == 'Polygon' else [p[0] for p in g['coordinates']]
                for ring in rr: pts += ring; rings.append(ring)
                ids.append(k)
        if not ids: row['skip'] = 'its map outline (%s) is not in the map file' % ','.join(pref); continue
        lon0 = sum(p[0] for p in pts) / len(pts); lat0 = sum(p[1] for p in pts) / len(pts)
        mx = M_PER_DEG * math.cos(math.radians(lat0))
        # proof that this is the origin the package used: the first outline, re-derived, equals the footprint file's ring
        back = [[round((p[0] - lon0) * mx, 2), round((p[1] - lat0) * M_PER_DEG, 2)] for p in rings[0]]
        fr = fp['outlines'][0]['ring']
        # (order-free: the farthest footprint point from its nearest re-derived point; OSM rings may start at another corner)
        row['origin_err_m'] = round(max(min(math.hypot(a[0] - b[0], a[1] - b[1]) for b in back) for a in fr), 3)
        x, z = to_frame(lon0, lat0)
        row.update({'map_ids': ids, 'lng': round(lon0, 7), 'lat': round(lat0, 7), 'x': round(x, 3), 'z': round(z, 3), 'tile': tile_of(x, z),
                    'rings_local': [[[round((p[0] - lon0) * mx, 3), round((p[1] - lat0) * M_PER_DEG, 3)] for p in ring] for ring in rings]})
        # the outline the builder was told to follow (footprint.json: the map's, or the laser-scan trace where the map's was found off)
        own = json.load(open(folder + '/footprint.json')) if os.path.exists(folder + '/footprint.json') else fp
        row['rings_package'] = [o['ring'] for o in own.get('outlines', []) if o.get('ring')]
        row['package_outline'] = 'scan trace' if 'laser scan' in str(own.get('source', '')).lower() else 'map'
        if fp['outlines'][0].get('map_name') and not r.get('building'): row['name'] = fp['outlines'][0]['map_name']
    tmp = out_path + '.tmp'
    json.dump(res, open(tmp, 'w'), indent=1); os.replace(tmp, out_path)
    n_ok = sum(1 for v in res.values() if 'skip' not in v)
    print('SOURCES', len(res), 'best builds,', n_ok, 'placeable ->', out_path)
    for s, v in res.items():
        if 'skip' in v: print('  SKIP', s, '-', v['skip'])
        elif v.get('origin_err_m') is None or v['origin_err_m'] > 0.05: print('  ORIGIN?', s, v.get('origin_err_m'))


if __name__ == '__main__':
    main(sys.argv[1])
