#!/usr/bin/env python3
"""
bake_detail.py - merge every detail source into render-ready GeoJSON.

Inputs (repo-relative):
  data/snapshots/<date>/buildings.enriched.geojson  base buildings (id, name,
                                                    building_class, final_height)
  data/parts.geojson          OSM building:part volumes (height_m, min_height_m,
                              colour, roof_colour, material)     [optional]
  data/building_tags.geojson  OSM colour/material tags as centroid points [optional]
  data/hero_designs.json      curated per-landmark + per-class palettes
  data/signs.json             sign labels + coordinates (hero location matching)

Outputs:
  data/snapshots/<date>/buildings.detailed.geojson  buildings + baked colours:
      wd/wg/wn  wall colour at day/golden/night
      rd/rg/rn  roof-cap colour at day/golden/night
      has_parts 1 if OSM parts replace this volume (client filters it out)
  data/snapshots/<date>/parts.detailed.geojson      parts + h, base, same colours

Colour strategy: everything is baked here so the client only interpolates
between per-feature day/golden/night colours with the time-of-day slider.
Priority per building: hero design (name or sign location match) >
OSM building:colour tag > building_class palette variant (deterministic pick).
"""
import json
import math
import colorsys
import hashlib
import sys
import os

DATE = sys.argv[1] if len(sys.argv) > 1 else '2026-07-10'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAP = os.path.join(ROOT, 'data', 'snapshots', DATE)


def load(path, default=None):
    p = os.path.join(ROOT, path)
    if not os.path.exists(p):
        print(f'  [skip] {path} not found')
        return default
    with open(p, encoding='utf-8') as f:
        return json.load(f)


# ---------------------------------------------------------------- colour utils
def hex_to_rgb(h):
    h = h.lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgb_to_hex(r, g, b):
    return '#%02x%02x%02x' % (max(0, min(255, round(r))),
                              max(0, min(255, round(g))),
                              max(0, min(255, round(b))))


def lerp_hex(a, b, t):
    A, B = hex_to_rgb(a), hex_to_rgb(b)
    return rgb_to_hex(*(A[i] + (B[i] - A[i]) * t for i in range(3)))


def adjust_light(h, dl):
    """Shift lightness by dl (-1..1) in HLS space."""
    r, g, b = (v / 255 for v in hex_to_rgb(h))
    hh, ll, ss = colorsys.rgb_to_hls(r, g, b)
    ll = max(0.05, min(0.95, ll + dl))
    r, g, b = colorsys.hls_to_rgb(hh, ll, ss)
    return rgb_to_hex(r * 255, g * 255, b * 255)


def stable01(key):
    """Deterministic 0..1 from a string key."""
    return int(hashlib.md5(key.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


# Time-of-day transforms applied to a base (day) colour.
GOLDEN_TINT = '#ffb26a'


def night_wall(day_hex):
    """day -> night WALL colour: strongly darkened and shifted cool.

    This used to mix 30% of the warm `night_window` tint straight into the wall
    (`wn = lerp(dark, night_window, 0.30)`), on the theory that a flat prism had
    to imply its own lighting. The measured result was a city of mid olive-khaki
    walls after dark — #63615b, #7b6d53 — sitting BRIGHTER than the night sky
    behind them, so the skyline had no silhouette at all.

    The facade patterns now carry lit windows (js/facades.js), so the wall is
    free to go properly dark and give those windows something to read against.
    Keep this formula in sync with nothing — js/facades.js consumes `wn`
    directly, and this is the single definition.
    """
    r, g, b = hex_to_rgb(day_hex)
    dark = (r * 0.24, g * 0.24, b * 0.24)
    cool = (17, 22, 42)
    return rgb_to_hex(*(dark[i] + (cool[i] - dark[i]) * 0.5 for i in range(3)))


def make_tod_colors(day_hex, night_window_hex):
    """day -> (wd, wg, wn) wall colours for day / golden hour / night."""
    # Golden: warm cast but keep each building's identity readable.
    wg = lerp_hex(day_hex, GOLDEN_TINT, 0.16)
    return day_hex, wg, night_wall(day_hex)


def make_roof_colors(roof_hex):
    rg = lerp_hex(roof_hex, GOLDEN_TINT, 0.22)
    rn = lerp_hex(adjust_light(roof_hex, -0.38), '#10152a', 0.6)
    return roof_hex, rg, rn


# ---------------------------------------------------------------- geometry
def rings_of(geom):
    if geom['type'] == 'Polygon':
        return [geom['coordinates']]
    if geom['type'] == 'MultiPolygon':
        return geom['coordinates']
    return []


def outer_ring(geom):
    r = rings_of(geom)
    return r[0][0] if r else []


def centroid(geom):
    ring = outer_ring(geom)
    if not ring:
        return None
    x = sum(p[0] for p in ring) / len(ring)
    y = sum(p[1] for p in ring) / len(ring)
    return (x, y)


def bbox(geom):
    ring = outer_ring(geom)
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return (min(xs), min(ys), max(xs), max(ys))


def point_in_poly(pt, geom):
    """Ray-cast against the outer ring of each polygon."""
    x, y = pt
    for poly in rings_of(geom):
        ring = poly[0]
        inside = False
        j = len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i][0], ring[i][1]
            xj, yj = ring[j][0], ring[j][1]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
        if inside:
            return True
    return False


# ---------------------------------------------------------------- load inputs
print(f'Baking detail for snapshot {DATE}')
buildings = load(f'data/snapshots/{DATE}/buildings.enriched.geojson')
if not buildings:
    sys.exit('base buildings missing')
parts = load('data/parts.geojson', {'features': []})
btags = load('data/building_tags.geojson', {'features': []})
designs = load('data/hero_designs.json', {'buildings': {}, 'classes': {}})
signs = load('data/signs.json', {'features': []})

def norm_name(s):
    """Normalize for fuzzy matching: casefold, strip 'the ', ' austin', punct."""
    s = s.casefold().strip()
    for ch in '.,–—-':
        s = s.replace(ch, ' ')
    s = ' '.join(s.split())
    if s.startswith('the '):
        s = s[4:]
    if s.endswith(' austin'):
        s = s[:-7]
    return s


hero_by_name = {k.casefold(): v for k, v in designs.get('buildings', {}).items()}
hero_by_norm = {norm_name(k): v for k, v in designs.get('buildings', {}).items()}


def hero_for_name(name):
    """Exact, then normalized, then containment (≥5 chars) match."""
    if not name:
        return None
    d = hero_by_name.get(name.casefold())
    if d:
        return d
    n = norm_name(name)
    d = hero_by_norm.get(n)
    if d:
        return d
    for key, v in hero_by_norm.items():
        if len(key) >= 5 and (key in n or n in key):
            return v
    return None
classes = designs.get('classes', {})
default_class = classes.get('default') or {
    'palettes': [{'wall': '#d8c09a', 'trim': '#e8d8b8', 'roof': '#a08868'}],
    'night_window': '#ffd9a0',
}

# Sign label -> coordinates, to locate heroes whose OSM name differs.
sign_pts = []
for f in signs.get('features', []):
    lbl = (f.get('properties') or {}).get('label')
    if lbl and f.get('geometry', {}).get('type') == 'Point':
        sign_pts.append((lbl, f['geometry']['coordinates']))

# ---------------------------------------------------------------- index buildings
feats = buildings['features']
bboxes = [bbox(f['geometry']) for f in feats]


def find_building(pt, want_height=None):
    """All containing footprints; if want_height given, pick the closest in
    height (sign points can sit inside an overlapping garage/podium too)."""
    hits = []
    for i, f in enumerate(feats):
        bx = bboxes[i]
        if bx[0] <= pt[0] <= bx[2] and bx[1] <= pt[1] <= bx[3]:
            if point_in_poly(pt, f['geometry']):
                hits.append(i)
    if not hits:
        return None
    if want_height is None or len(hits) == 1:
        return hits[0]
    return min(hits, key=lambda i: abs((feats[i]['properties'].get('final_height') or 0) - want_height))


# heroes located by sign position (disambiguated by the sign's height)
sign_heights = {f['properties']['label']: f['properties'].get('height')
                for f in signs.get('features', [])}
hero_at = {}
for lbl, coords in sign_pts:
    d = hero_by_name.get(lbl.casefold())
    if not d:
        continue
    i = find_building(tuple(coords), want_height=sign_heights.get(lbl))
    if i is not None:
        hero_at[i] = (lbl, d)
        nm = feats[i]['properties'].get('name') or '(unnamed)'
        h = feats[i]['properties'].get('final_height')
        print(f'  sign "{lbl}" -> {nm} ({h} m)')

# OSM colour tags located by centroid
tag_at = {}
for f in btags.get('features', []):
    g = f.get('geometry') or {}
    if g.get('type') != 'Point':
        continue
    i = find_building(tuple(g['coordinates']))
    if i is not None:
        tag_at[i] = f.get('properties') or {}

# parts grouped under their parent building
part_parent = []
has_parts = set()
for pf in parts.get('features', []):
    c = centroid(pf['geometry'])
    i = find_building(c) if c else None
    part_parent.append(i)
    if i is not None:
        has_parts.add(i)

# ---------------------------------------------------------------- bake buildings
matched_heroes, tagged, class_hits = 0, 0, 0
for i, f in enumerate(feats):
    p = f['properties']
    name = (p.get('name') or '')
    cls = p.get('building_class')
    if not cls:
        # Unclassed + tall in this bbox ≈ West Campus apartment block; give it
        # the apartment variety instead of the (muted) default palette.
        cls = 'apartments' if (p.get('final_height') or 0) >= 16 else 'default'
    key = p.get('id') or name or str(i)
    jitter = (stable01(key) - 0.5) * 0.14          # +-7% lightness variety

    hero = hero_at[i][1] if i in hero_at else hero_for_name(name)

    if hero:
        wall = hero['wall']
        roof = hero.get('roof') or adjust_light(wall, -0.12)
        nightw = hero.get('night_window') or '#ffd9a0'
        matched_heroes += 1
    elif i in tag_at and tag_at[i].get('colour'):
        wall = tag_at[i]['colour']
        roof = tag_at[i].get('roof_colour') or adjust_light(wall, -0.12)
        nightw = (classes.get(cls) or default_class).get('night_window', '#ffd9a0')
        tagged += 1
    else:
        cd = classes.get(cls) or default_class
        pals = cd.get('palettes') or default_class['palettes']
        pal = pals[int(stable01(key + ':v') * len(pals)) % len(pals)]
        wall = adjust_light(pal['wall'], jitter)
        roof = adjust_light(pal.get('roof') or adjust_light(wall, -0.12), jitter * 0.6)
        nightw = cd.get('night_window', '#ffd9a0')
        class_hits += 1

    wd, wg, wn = make_tod_colors(wall, nightw)
    rd, rg, rn = make_roof_colors(roof)
    p.update(wd=wd, wg=wg, wn=wn, rd=rd, rg=rg, rn=rn)
    if i in has_parts:
        p['has_parts'] = 1
    # keep payload lean
    p.pop('overture_height', None)

# ---------------------------------------------------------------- bake parts
part_feats = []
for pf, parent in zip(parts.get('features', []), part_parent):
    pp = pf.get('properties') or {}
    h = pp.get('height_m')
    if h is None:
        continue
    base = pp.get('min_height_m') or 0
    if parent is not None:
        bp = feats[parent]['properties']
        wall_src = pp.get('colour')
        if wall_src:
            nightw = '#ffd9a0'
            wd, wg, wn = make_tod_colors(wall_src, nightw)
        else:
            wd, wg, wn = bp['wd'], bp['wg'], bp['wn']
        roof_src = pp.get('roof_colour')
        if roof_src:
            rd, rg, rn = make_roof_colors(roof_src)
        else:
            rd, rg, rn = bp['rd'], bp['rg'], bp['rn']
    else:
        wall = pp.get('colour') or '#d8c09a'
        wd, wg, wn = make_tod_colors(wall, '#ffd9a0')
        rd, rg, rn = make_roof_colors(pp.get('roof_colour') or adjust_light(wall, -0.12))
    part_feats.append({
        'type': 'Feature',
        'geometry': pf['geometry'],
        'properties': {'h': round(float(h), 1), 'base': round(float(base), 1),
                       'wd': wd, 'wg': wg, 'wn': wn,
                       'rd': rd, 'rg': rg, 'rn': rn},
    })

# ---------------------------------------------------------------- write
out_b = os.path.join(SNAP, 'buildings.detailed.geojson')
with open(out_b, 'w', encoding='utf-8') as f:
    json.dump(buildings, f, separators=(',', ':'))
out_p = os.path.join(SNAP, 'parts.detailed.geojson')
with open(out_p, 'w', encoding='utf-8') as f:
    json.dump({'type': 'FeatureCollection', 'features': part_feats}, f,
              separators=(',', ':'))

print(f'  buildings: {len(feats)}  heroes matched: {matched_heroes}  '
      f'osm-tagged: {tagged}  class-palette: {class_hits}')
print(f'  buildings with parts (hidden base): {len(has_parts)}')
print(f'  parts baked: {len(part_feats)}')
print(f'  wrote {out_b} ({os.path.getsize(out_b)//1024} KB)')
print(f'  wrote {out_p} ({os.path.getsize(out_p)//1024} KB)')
