"""Pilot paths keep their area and asphalt clearance; models remain reproducible."""
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path
from shapely import make_valid, set_precision
from shapely.geometry import shape, box
from shapely.ops import unary_union

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts'))
from pedestrian_geometry import pedestrian_levels,local
from bake_speedway_buildings import build

read=lambda f:json.loads((ROOT/f).read_text(encoding='utf-8'))
old=json.loads(subprocess.check_output(['git','show','f919494:data/ground.geojson'],cwd=ROOT))['features']
new=read('data/ground.geojson')['features']
pilot=[f for f in new if 'walk_z' in f['properties']]
assert len(pilot)>150
assert {f['properties']['walk_z']for f in pilot}=={.025,.14}
assert all(f['properties']['k'] in ['patharea','pathslab'] and f['properties'].get('u')!='steps' for f in pilot)
regions=read('data/campus_walk_profiles.json')['regions']
region=unary_union([local(box(*r))for r in regions]).buffer(1)
def selected(features,kind):
    result=[]
    for f in features:
        if f['properties'].get('k')!=kind:continue
        g=shape(f['geometry'])
        if not any(box(*r).intersects(g) for r in regions):continue
        # A tenth of a millimetre grid avoids GEOS roundoff at coincident
        # clipped edges. It is much smaller than the source precision.
        g=set_precision(make_valid(local(g)),.0001).intersection(region)
        result.append(g)
    return unary_union(result)
for kind in ['patharea','pathslab']:
    # Compare the union, not the number of split pieces. The road-side strip
    # can change height without losing a gap, junction or courtyard opening.
    a=selected(old,kind)
    b=selected(new,kind)
    assert a.symmetric_difference(b).area<.3, (kind,a.symmetric_difference(b).area)
again=pedestrian_levels(new,Counter())
for height in [.025,.14]:
    a=unary_union([set_precision(make_valid(local(shape(f['geometry']))),.0001)for f in new if f['properties'].get('walk_z')==height])
    b=unary_union([set_precision(make_valid(local(shape(f['geometry']))),.0001)for f in again if f['properties'].get('walk_z')==height])
    assert a.symmetric_difference(b).area<.02,'Repeated level pass moves pavement'
assert json.loads(json.dumps(build()))==read('data/speedway_buildings.json')
models=read('data/speedway_buildings.json')['buildings']
assert [b['code']for b in models]==['WCP','RLP']
bridge=next(b for b in models[0]['blocks']if b['id']=='patton-bridge')
assert bridge['z0']>10 and bridge['z1']>bridge['z0']
assert all('plan' in part for b in models for part in b['blocks'])
landscape=read('data/campus_landscape.json')
ramp=landscape['ramps'][0]
assert ramp['eid']==239 and abs(min(v[2]for v in ramp['vertices'])-.035)<1e-6
assert max(v[2]for v in ramp['vertices'])>1.5
assert len(landscape['walks'])>100 and len(landscape['doors'])>10
print('PASS path coverage, repeated levels, current Powers/Patton models, open elevated bridge, registered door leaves')
