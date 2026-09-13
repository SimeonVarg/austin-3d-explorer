"""Geometry regression: actual rendered pavement must not cover asphalt.

--before checks the original shipped geometry and must fail on its road strips.
"""
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path
from shapely.geometry import shape, box
from shapely.strtree import STRtree
from shapely.ops import unary_union, clip_by_rect

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'scripts'))
from bake_roof_anchors import build as anchors_build
from bake_south_campus import build as campus_build
from pavement_geometry import is_pavement

def read(file):
    return json.loads((ROOT/file).read_text(encoding='utf-8'))

old = json.loads(subprocess.check_output(['git','show','9b9aacb:data/ground.geojson'], cwd=ROOT))
current = old if '--before' in sys.argv else read('data/ground.geojson')
roads = [shape(f['geometry']).buffer(0) for f in current['features'] if f['properties']['k']=='roadarea']
tree = STRtree(roads)
region = box(-97.75,30.275,-97.723,30.298)
maximum = 0
for f in current['features']:
    if not is_pavement(f['properties']):
        continue
    g = shape(f['geometry']).buffer(0)
    if not g.intersects(region):
        continue
    x0,y0,x1,y1 = g.bounds
    nearby = [clip_by_rect(roads[int(i)],x0-1e-7,y0-1e-7,x1+1e-7,y1+1e-7).buffer(0) for i in tree.query(g)]
    if nearby:
        maximum = max(maximum, g.intersection(unary_union(nearby)).area*111320*96129)
assert maximum < .02, 'Pavement crosses asphalt: %.2f m2 in one feature' % maximum
print('PASS campus and West Campus pavement/texture overlap below geometric tolerance')

def other_ground(fc):
    return Counter(json.dumps(f, sort_keys=True) for f in fc['features']
                   if not is_pavement(f['properties']))
assert other_ground(old) == other_ground(current), 'Unrelated ground changed'
assert json.loads(json.dumps(anchors_build())) == read('data/roof_anchors.json'), 'Roof anchors stale'
assert campus_build() == read('data/south_campus.json'), 'Campus models stale'
anchors = read('data/roof_anchors.json')['anchors']
assert {a['name'] for a in anchors} >= {'University Christian Church','University Catholic Center'}
assert all(a['tierCounts'][1]>0 for a in anchors), 'Minor roof equipment is covered'
models = read('data/south_campus.json')['buildings']
utc = next(b for b in models if b['code']=='UTC')
assert len(utc['levels']['floors']) == 3, 'UTC photo has two upper opening rows and recessed base'
assert any(b['id']=='21st-pedestrian-bridge' and b['z0']>5 for b in utc['blocks'])
assert all(s.get('windowRule')!='checker' for b in models for s in b['skins'].values())
print('PASS other ground unchanged, reproducible campus models and roof anchors, both roof tiers')
