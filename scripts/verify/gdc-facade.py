import collections, hashlib, json, math, subprocess, sys
from pathlib import Path
from shapely.geometry import shape
from shapely.ops import unary_union
root=Path(__file__).resolve().parents[2]
a=json.loads(subprocess.check_output(['git','show',(sys.argv[1] if len(sys.argv)>1 else '3b28126')+':data/heroes.geojson'],cwd=root))
b=json.loads((root/'data/heroes.geojson').read_text())
pick=lambda doc:[f for f in doc['features'] if f['properties']['b']!='gdc']
assert pick(a)==pick(b)
assert {k:v for k,v in a.items() if k!='features'}=={k:v for k,v in b.items() if k!='features'}
g=[f for f in b['features'] if f['properties']['b']=='gdc']
assert all(shape(f['geometry']).is_valid and shape(f['geometry']).area>0 for f in g)
assert all(0<=f['properties']['base']<f['properties']['h']<=29.5 for f in g)
panes=[f for f in g if f['properties'].get('part')=='window']
faces={f['properties']['face'] for f in panes}
assert len(faces)==8
assert {f['properties']['row'] for f in panes}==set(range(5))
for face in faces:
    p=[f['properties'] for f in panes if f['properties']['face']==face]
    wide=next(x['openingWidth'] for x in p if x['opening']=='wide')
    narrow=next(x['openingWidth'] for x in p if x['opening']=='narrow')
    assert abs(wide/narrow-2)<.003
# The visible outward panes must not overlap opaque masonry at their midpoint.
clear=0
for row in range(5):
    batch=[f for f in panes if f['properties']['row']==row]
    z=sum(batch[0]['properties'][k] for k in ['base','h'])/2
    opaque=unary_union([shape(f['geometry']) for f in g if f['properties']['lyr']=='solid'
        and f['properties']['base']<z<f['properties']['h']])
    for f in batch:
        if f['properties']['face'] not in ['sbar_v0','nbar_v1','sbar_u0','nbar_u0','sbar_u1','nbar_u1']:
            continue
        area=shape(f['geometry']).intersection(opaque).area
        assert area / shape(f['geometry']).area < .025,(f['properties'],area / shape(f['geometry']).area)
        clear+=1
before=hashlib.sha256((root/'data/heroes.geojson').read_bytes()).hexdigest()
subprocess.run(['python','scripts/bake_heroes.py'],cwd=root,stdout=subprocess.DEVNULL,check=True)
after=hashlib.sha256((root/'data/heroes.geojson').read_bytes()).hexdigest()
assert before==after
print(json.dumps(dict(non_target_unchanged=len(pick(a)),metadata_unchanged=True,
    valid_gdc_polygons=len(g),opaque_overlap_free_panes=clear,facade_faces=len(faces),
    above_ground_rows=6,shade_parts=sum(f['properties'].get('part','').startswith('shade-') for f in g),
    sha256=after),indent=2))

