"""The aerial-confirmed through-road stays continuous, without unrelated edits."""
import json,sys,subprocess
from pathlib import Path
from collections import Counter
from shapely.geometry import shape,box
from shapely.ops import unary_union
from shapely import make_valid
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'scripts'))
from crossing_geometry import repair_crossings
from bake_ground import widen_roads
read=lambda f:json.loads((ROOT/f).read_text(encoding='utf8'))
mask=unary_union([box(*c['bounds'])for c in read('data/ground_crossings.json')['crossings']])
roads=read('data/roads.geojson')['features']
selected=[f for f in roads if f['properties'].get('k')=='road'and shape(f['geometry']).intersects(mask)]
expected=unary_union([make_valid(shape(f['geometry'])).intersection(mask)for f in widen_roads(selected,Counter(),[])if f['properties'].get('k')=='roadarea'])
current=read('data/ground.geojson')['features']
before=json.loads(subprocess.check_output(['git','show','14d2bc1:data/ground.geojson'],cwd=ROOT))['features']
def road_union(fs):
    return unary_union([make_valid(shape(f['geometry'])).intersection(mask)for f in fs if f['properties'].get('k')=='roadarea'and shape(f['geometry']).intersects(mask)])
assert expected.difference(road_union(before)).area*1.07e10>100,'baseline must reproduce the cut-off road'
assert expected.difference(road_union(current)).area*1.07e10<.05,'restored road matches cached centreline and width'
stats=Counter();again=repair_crossings(current,roads,stats)
assert not stats['vehicle_crossing_patches'] and len(again)==len(current),'repair must be idempotent'
print('PASS original road gap reproduced, complete vehicle crossing restored, repeated repair adds nothing')
