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
# The runtime supplies downward caps from these exact existing roof rings.
# A facade edit must not silently move the roof or add a fourth underside.
roof=lambda doc:[f for f in doc['features'] if f['properties']['b']=='gdc' and f['properties'].get('cap')==1]
assert roof(a)==roof(b)
assert {(f['properties']['band'],f['properties']['base'],f['properties']['h']) for f in roof(b)}=={
    ('sbar_roof',28.7,29.5),('nbar_roof',28.7,29.5),('atrium_roof',24.6,25.4)}
glass=[f['properties'] for f in g if f['properties']['lyr']=='gdc-glass']
def luma(color):
    return sum(int(color[i:i+2],16)*weight/255 for i,weight in zip((1,3,5),(.2126,.7152,.0722)))
# cityEmission identifies occupied glass above its upper .48 threshold. Off
# panes must remain below the lower .26 threshold, without altering day glass.
for p in glass:
    assert p['nightOccupied'] in (0,1)
    assert p['wd']=='#42566d'
    assert (luma(p['wn'])>.48 if p['nightOccupied'] else luma(p['wn'])<.26)
for part in ('window','ground-window','atrium-glass'):
    group=[p for p in glass if p['part']==part]
    assert {p['nightOccupied'] for p in group}=={0,1}
    rate=sum(p['nightOccupied'] for p in group)/len(group)
    assert .35<rate<.96,(part,rate)
# The entrance screen returns span the photographed tier height; thin black
# floor lines cannot accidentally replace these projecting rust grilles again.
returns=[f['properties'] for f in g if f['properties'].get('part')=='atrium-screen-return']
assert len({p['base'] for p in returns})==5
assert all(abs(p['h']-p['base']-1.5)<.001 and p['wd']=='#965a3d' for p in returns)
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
subprocess.run([sys.executable,'scripts/bake_heroes.py'],cwd=root,stdout=subprocess.DEVNULL,check=True)
after=hashlib.sha256((root/'data/heroes.geojson').read_bytes()).hexdigest()
assert before==after
print(json.dumps(dict(non_target_unchanged=len(pick(a)),metadata_unchanged=True,
    valid_gdc_polygons=len(g),opaque_overlap_free_panes=clear,facade_faces=len(faces),
    above_ground_rows=6,shade_parts=sum(f['properties'].get('part','').startswith('shade-') for f in g),
    roofs=len(roof(b)),occupied_panes=sum(p['nightOccupied'] for p in glass),
    unoccupied_panes=sum(not p['nightOccupied'] for p in glass),sha256=after),indent=2))

