"""Physical clearance and authored-ground continuity, using the shipped data."""
import json, math
from pathlib import Path
from shapely.geometry import shape, Point
from shapely.strtree import STRtree
from shapely.ops import transform
from shapely import make_valid
ROOT=Path(__file__).resolve().parents[2]
read=lambda f:json.loads((ROOT/f).read_text(encoding='utf8'))
land=read('data/campus_landscape.json')
snapshot=read('data/manifest.json')['latest']
mx=111320*math.cos(math.radians(30.288))
metric=lambda g:transform(lambda x,y:((x+97.742)*mx,(y-30.288)*111320),g)
walls=[make_valid(metric(shape(f['geometry'])))for f in read(f'data/snapshots/{snapshot}/buildings.detailed.geojson')['features']]
walls=[g for g in walls if not g.is_empty];tree=STRtree(walls)
for t in land['trees']:
    assert all(math.isfinite(v)for v in t[:5]) and t[2]>=.7
    p=metric(Point(t[:2]));g=walls[int(tree.nearest(p))]
    assert p.distance(g)>=t[2]*1.22+.33, ('Crown enters a building',t,p.distance(g))
assert land['treeRepairs']['insideBuildings']>0 and land['treeRepairs']['canopiesClipped']>0
places={p['name']:p['features']for p in land['gardens']['places']}
eer=places['EER west garden and raised walk']
stairs=[f['height']for f in eer if f.get('rings')and .38<f.get('height',0)<1.2 and f['kind']=='pave']
assert len(stairs)>=7
ramps=[f for f in eer if f['kind']=='groundRamp']
assert len(ramps)==1 and ramps[0]['start']==1.2 and ramps[0]['end']==.38
assert all(f['base']==1.2 for f in eer if f['kind']=='raisedRail')
tables=[f for f in places['PCL umbrella seating']if f['kind']=='umbrella']
assert len(tables)==4
for i,a in enumerate(tables):
    for b in tables[i+1:]:
        assert metric(Point(a['at'])).distance(metric(Point(b['at'])))>a['radius']+b['radius']
for place in places.values():
    for f in place:
        if 'rings'in f:assert shape({'type':'Polygon','coordinates':f['rings']}).is_valid
welch=read('data/apartments/welch-hall.json')
assert welch['replaceFrontage']
pcl=read('data/apartments/pcl.json')
assert any('slots' in json.dumps(b.get('faces',{}))for b in pcl['blocks'])
halls={b['code']:b for b in read('data/campus_buildings.json')['buildings']}
assert len(halls['SEA']['levels']['floors'])==5
assert halls['JES']['replaceFrontage'] and not halls['JES']['preserveRoof']
assert abs(read('data/art3d/the-west.json')['radius']*2-1.524)<1e-8
assert len(read('data/art3d/mustangs.json')['horses'])==7
print('PASS tree/building clearances, raised-walk connections, umbrella spacing, ground polygons, PCL slots, Sarah/Jester levels and sculpture dimensions')
