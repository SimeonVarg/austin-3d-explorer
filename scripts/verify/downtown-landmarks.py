"""Geometry, replacement ownership and failure checks; no browser required."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import re
import math

from shapely.geometry import Point, Polygon

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import bake_outer as bake
from downtown_landmarks import LANDMARKS, build_landmark, patch_landmarks, validate_landmark

# The filtered representation must retain the authored storey zones when a
# geometry recipe changes; otherwise its windows drift between floors.
lighting=(Path(__file__).resolve().parents[2]/'js/city-lighting.js').read_text(encoding='utf8')
for name,key,spans in [('Waterline','waterline',[(0,1),(1,2),(3,4)]),
                       ('Sixth and Guadalupe','sixth',[(0,1),(2,3)])]:
    cfg=LANDMARKS[name]
    zones=json.loads(re.search(key+r':\{[^\n]*zones:(\[\[.*?\]\]),band:',lighting).group(1))
    expected=[[cfg['levels'][a],cfg['levels'][b],cfg['floors'][i],cfg['bays'][i]] for i,(a,b) in enumerate(spans)]
    assert zones==expected, name+' filtered storeys disagree with massing'

legacy=[]
for name,cfg in LANDMARKS.items():
    raw=bake.to_metres(cfg["footprint"])
    ring=bake.simplify_ring(raw,bake.SIMPLIFY_TOWER)
    f={"type":"Feature","geometry":{"type":"Polygon","coordinates":[bake.to_degrees(ring)]},
       "properties":{"h":cfg["height"],"t":1,"wd":"#688090","d":0},
       "_m":ring,"_h":cfg["height"],"_area":bake.ring_area(raw),"_base":"#688090",
       "_name":name,"_fade":0,"_ovh":cfg["raw_height"],"_tower":True,"_dt":True}
    extras=bake.downtown_detail([f],{},use_landmarks=False)
    legacy.extend([{k:v for k,v in f.items() if not k.startswith("_")}]+extras)
    built=build_landmark(bake,name)
    assert max(p["properties"]["h"] for p in built)==cfg["height"]
    assert all(p["properties"].get("k")=="c" for p in built)
    assert not any("mast" in p["properties"]["part"] for p in built)

# An unrelated solid deliberately inside the target site must survive; a
# proximity/bounding-box replacement would wrongly remove it.
sentinel=copy.deepcopy(legacy[0])
sentinel["properties"]={"h":4.1,"b":1.1,"k":"c","wd":"#abcdef","custom":"preserve"}
with tempfile.TemporaryDirectory() as temp:
    path=Path(temp)/"outer.json"
    path.write_text(json.dumps({"type":"FeatureCollection","features":legacy+[sentinel]}),encoding="utf-8")
    report=patch_landmarks(bake,path)
    assert report["preserved_features"]==1
    result=json.loads(path.read_text(encoding="utf-8"))
    assert result["features"][0]==sentinel
    before=path.read_bytes()
    patch_landmarks(bake,path,check=True)
    assert path.read_bytes()==before
    patch_landmarks(bake,path)
    assert path.read_bytes()==before

    # A changed legacy target is not authority to delete its approximate area.
    broken=copy.deepcopy(legacy)
    broken[0]["properties"]["h"]+=.9
    path.write_text(json.dumps({"type":"FeatureCollection","features":broken+[sentinel]}),encoding="utf-8")
    before=path.read_bytes()
    try:
        patch_landmarks(bake,path)
        raise AssertionError("changed legacy target must be rejected")
    except ValueError as error:
        assert "matches" in str(error)
    assert path.read_bytes()==before

waterline=build_landmark(bake,"Waterline")

def verify_waterline_balconies(features):
    """Check emitted volumes, not only recipe parameters or role counts."""
    cfg=LANDMARKS['Waterline']
    origin=bake.to_metres([cfg['center']])[0]
    angle=math.radians(cfg['bearing'])
    cs,sn=math.cos(angle),math.sin(angle)
    def local_polygon(feature):
        points=bake.to_metres(feature['geometry']['coordinates'][0])
        return Polygon([((x-origin[0])*cs-(y-origin[1])*sn,
                         (x-origin[0])*sn+(y-origin[1])*cs) for x,y in points])
    volumes=[(f['properties'],local_polygon(f)) for f in features]
    detail_roles={'balcony-back-pane','balcony-deck','balcony-guard-pane',
                  'balcony-room-pane','balcony-jamb','residential-frame'}
    details=[p for p,q in volumes if p['part'] in detail_roles]
    assert {p['part'] for p in details}==detail_roles, 'missing Waterline balcony component'
    assert all(187<=p.get('b',0)<p['h']<=302 for p in details), 'balcony escapes residential zone'
    solids=[p for p in details if p['part'] in {'balcony-deck','balcony-jamb','residential-frame'}]
    assert all(not p.get('lmThin') and not p.get('lmGlass') and not p.get('lmEmit') for p in solids), 'balcony structure hidden by runtime material filters'
    x0,x1,y0,y1=cfg['residential']
    detail=cfg['residential_detail']
    probes=[]
    for start,end in detail['south']:
        probes.append(Point(x0+(start+end)*(x1-x0)/2,y0+detail['depth']/2))
    for start,end in detail['east']:
        probes.append(Point(x1-detail['depth']/2,y0+(start+end)*(y1-y0)/2))
    # Each storey's usable balcony volume must be physically empty, including
    # the backing mesh; a dark panel pasted onto an uncut box fails this.
    for row in range(cfg['floors'][2]):
        z=187+(row+.5)*(302-187)/cfg['floors'][2]
        active=[q for p,q in volumes if p.get('b',0)<z<p['h'] and not p.get('lmThin')]
        for probe in probes:
            assert not any(q.contains(probe) for q in active), 'filled Waterline balcony recess'
        assert any(q.contains(Point((x0+x1)/2,(y0+y1)/2)) for q in active), 'missing residential core'

verify_waterline_balconies(waterline)

def verify_sixth_balconies(features):
    """Every room has a matte daytime door, with open space before it."""
    cfg=LANDMARKS['Sixth and Guadalupe']
    origin=bake.to_metres([cfg['center']])[0]
    angle=math.radians(cfg['bearing'])
    cs,sn=math.cos(angle),math.sin(angle)
    volumes=[]
    for f in features:
        points=bake.to_metres(f['geometry']['coordinates'][0])
        shape=Polygon([((x-origin[0])*cs-(y-origin[1])*sn,
                        (x-origin[0])*sn+(y-origin[1])*cs) for x,y in points])
        volumes.append((f['properties'],shape))
    roles={'balcony-door','balcony-pier','balcony-recess-divider','balcony-spandrel-rail'}
    details=[p for p,q in volumes if p['part'] in roles]
    assert {p['part'] for p in details}==roles, 'missing Sixth balcony component'
    assert all(126<=p.get('b',0)<p['h']<=257 for p in details), 'Sixth detail escapes residential zone'
    assert all(not p.get('lmThin') and not p.get('lmGlass') and not p.get('lmEmit') for p in details), 'Sixth balcony material causes hidden or reflective blocks'
    doors=[p for p in details if p['part']=='balcony-door']
    assert all(p['wd']==cfg['balcony_door'] for p in doors), 'Sixth daytime doors are inconsistent'
    assert {p.get('wn') for p in doors}=={cfg['lit'][1],cfg['balcony_back']}, 'Sixth night rooms lose occupied/unoccupied tones'
    x0,x1,y0,y1=cfg['residential']
    left,right=x0+cfg['balcony_left'],x1-cfg['balcony_right']
    back=y1-cfg['balcony_depth']
    # Preserve compatibility with the independently owned shader until its
    # balcony mask and grid can be updated in the same change as the cheek.
    assert abs(left+20.6)<1e-8 and abs(right-10.4)<1e-8, 'Sixth cheek differs from shader balcony mask'
    for row in range(cfg['floors'][1]):
        z=126+(row+.5)*(257-126)/cfg['floors'][1]
        active=[(p,q) for p,q in volumes if p.get('b',0)<z<p['h'] and not p.get('lmThin')]
        room_doors=[q for p,q in active if p['part']=='balcony-door']
        assert len(room_doors)==9, 'Sixth floor lacks a complete nine-room door field'
        for col in range(9):
            x=left+(col+.5)*(right-left)/9
            assert sum(q.contains(Point(x,back)) for q in room_doors)==1, 'Sixth door does not cover its room'
            assert not any(q.contains(Point(x,back+cfg['balcony_depth']/2)) for p,q in active), 'filled Sixth balcony volume'

sixth=build_landmark(bake,'Sixth and Guadalupe')
verify_sixth_balconies(sixth)
missing_door=copy.deepcopy(sixth)
missing_door.remove(next(f for f in missing_door if f['properties']['part']=='balcony-door'))
try:
    verify_sixth_balconies(missing_door)
    raise RuntimeError('sparse door sabotage escaped verification')
except AssertionError as error:
    assert 'complete nine-room' in str(error)
reflective_door=copy.deepcopy(sixth)
next(f for f in reflective_door if f['properties']['part']=='balcony-door')['properties']['lmGlass']=1
try:
    verify_sixth_balconies(reflective_door)
    raise RuntimeError('reflective door sabotage escaped verification')
except AssertionError as error:
    assert 'reflective blocks' in str(error)

filled=copy.deepcopy(waterline)
for f in filled:
    if f['properties']['part']=='residential':
        f['geometry']['coordinates']=[list(Polygon(f['geometry']['coordinates'][0]).convex_hull.exterior.coords)]
try:
    verify_waterline_balconies(filled)
    raise RuntimeError('uncut backing sabotage escaped verification')
except AssertionError as error:
    assert 'filled Waterline balcony recess' in str(error)
overflow=copy.deepcopy(waterline)
next(f for f in overflow if f['properties']['part']=='residential-frame')['properties']['h']=303
try:
    verify_waterline_balconies(overflow)
    raise RuntimeError('out-of-zone frame sabotage escaped verification')
except AssertionError as error:
    assert 'escapes residential zone' in str(error)

orphan=[f for f in waterline if f["properties"]["part"] not in ("crown-glass","crown-column")]
try:
    validate_landmark(orphan,315)
    raise AssertionError("unsupported crown must be rejected")
except ValueError as error:
    assert "unsupported" in str(error)
print("PASS: valid exact-height geometry, empty balcony volumes, visible frame roles, balcony sabotage rejection, no masts, unrelated overlaps preserved, idempotence, changed-legacy rejection, unsupported-crown rejection")
