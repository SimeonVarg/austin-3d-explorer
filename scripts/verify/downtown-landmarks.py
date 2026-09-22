"""Geometry, replacement ownership and failure checks; no browser required."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import re

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
orphan=[f for f in waterline if f["properties"]["part"] not in ("crown-glass","crown-column")]
try:
    validate_landmark(orphan,315)
    raise AssertionError("unsupported crown must be rejected")
except ValueError as error:
    assert "unsupported" in str(error)
print("PASS: valid exact-height geometry, no masts, unrelated overlaps preserved, idempotence, changed-legacy rejection, unsupported-crown rejection")
