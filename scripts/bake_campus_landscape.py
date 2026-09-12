"""Compile campus tree envelopes and authored gardens into one compact input.

Owns only data/campus_landscape.json. Tree locations/species/envelopes come from
the existing surveyed/detected tree bake; this does not fetch or move trees.
"""
import json, math
from pathlib import Path
from collections import defaultdict, Counter
from shapely.geometry import shape, box, Point, mapping

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'data/campus_landscape.json'
BOUNDS=[-97.7424,30.2806,-97.7304,30.2919]
region=box(*BOUNDS)
features=json.loads((ROOT/'data/trees.geojson').read_text())['features']
groups=defaultdict(list)
number=lambda n:format(n,'.12g')
def key(p):return '|'.join([number(p.get('d',0)),str(p.get('sp','other')),number(p.get('r0',0)),number(p.get('j',0))])
for f in features:
 p=f['properties']
 if p['kind']=='canopy':groups[key(p)].append(f)
trees=[];canopy_keys=[]
for k,parts in groups.items():
 p=parts[0]['properties'];polys=[shape(f['geometry'])for f in parts]
 # Whole crowns cross the boundary as one tree; no individual tiers are lost.
 if not any(region.intersects(g)for g in polys):continue
 c=max(polys,key=lambda g:g.area).centroid
 r=p.get('r0')or math.sqrt(max(g.area for g in polys)/math.pi)*111320*math.sqrt(math.cos(math.radians(c.y)))
 bottom=min(f['properties']['base']for f in parts);top=max(f['properties']['h']for f in parts)
 trees.append([round(c.x,7),round(c.y,7),round(r,2),round(bottom,2),round(top,2),p.get('sp','other'),p.get('d',0),p.get('j',0),p.get('src','unknown')])
 canopy_keys.append(k)
# Retire trunks only when a replacement tree shares their position. Exclude a
# key if an unrelated trunk elsewhere has the same recorded density/height.
from shapely.strtree import STRtree
points=[Point(t[:2])for t in trees];index=STRtree(points)
trunk_keys=[];unreplaced_trunk_keys=set()
for f in features:
 p=f['properties']
 if p['kind']!='trunk':continue
 c=shape(f['geometry']).centroid
 k=number(p.get('d',0))+'|'+number(p.get('h',0))
 if len(index.query(c.buffer(.000015)))>0:trunk_keys.append(k)
 else:unreplaced_trunk_keys.add(k)
trunk_keys=sorted(set(trunk_keys)-unreplaced_trunk_keys)
def compile_gardens():
 from shapely.ops import transform, unary_union
 from shapely.geometry import Polygon, LineString
 from shapely import make_valid
 profiles=json.loads((ROOT/'data/campus_gardens.json').read_text())
 halls=json.loads((ROOT/'data/campus_buildings.json').read_text())['buildings']
 ground=json.loads((ROOT/'data/ground.geojson').read_text())['features']
 mx=111320*math.cos(math.radians(30.286));my=111320
 local=lambda g:transform(lambda x,y:((x+97.74)*mx,(y-30.286)*my),g)
 world=lambda g:transform(lambda x,y:(x/mx-97.74,y/my+30.286),g)
 T=profiles['detail'];campus=local(region)
 paths=[];lawns=[];water=[];walls=[]
 for f in ground:
  p=f['properties'];g=make_valid(local(shape(f['geometry'])))
  if not g.intersects(campus):continue
  if p.get('k') in ['pathslab','patharea','roadarea','cyclearea'] or p.get('u')=='parking':paths.append(g)
  if p.get('k')=='area' and p.get('u') in ['park','garden','grass'] and p.get('s') in ['gardenlawn','grass','lawn']:lawns.append((f,g))
  if p.get('u')=='water':water.append((f,g))
 for f in json.loads((ROOT/'data/snapshots/2026-09-12/buildings.detailed.geojson').read_text(encoding='utf-8'))['features']:
  g=make_valid(local(shape(f['geometry'])))
  if g.intersects(campus):walls.append(g)
 blocked=unary_union(paths).buffer(T['pathClearance']).union(unary_union(walls).buffer(T['buildingClearance']))
 result=[]
 for p in profiles['places']:
  out={'name':p['name'],'note':p['note'],'features':[]};result.append(out)
  def emit(g,kind,**kw):
   if g.is_empty:return
   geoms=[g]if g.geom_type=='Polygon' else list(getattr(g,'geoms',[]))
   for geom in geoms:
    if geom.geom_type!='Polygon' or geom.area<.05:continue
    coords=mapping(world(geom))['coordinates']
    out['features'].append(dict(kind=kind,rings=[[[round(x,7),round(y,7)]for x,y in r]for r in coords],**kw))
  def point(xy):return list(world(Point(xy)).coords)[0]
  if p.get('building'):
   hall=next(b for b in halls if b['code']==p['building']);F=hall['frame']['obb']
   def ll(u,v):return [F['o'][0]+(u*F['ax']-v*F['ay'])/F['mx'],F['o'][1]+(u*F['ay']+v*F['ax'])/F['my']]
   def rect(b):
    a,c,d,e=b;return local(Polygon([ll(a,d),ll(c,d),ll(c,e),ll(a,e)]))
   if p.get('courtPaving'):
    for hole in hall['footprint']['holes']:emit(local(Polygon(hole)),'pave',height=p['courtPaving'])
   for b in p.get('beds',[]):
    g=rect(b).difference(blocked);emit(g,'bed',plants=True);emit(g.buffer(T['edgeWidth']).difference(g),'stone',height=.24)
   for b in p.get('lawns',[]):emit(rect(b).difference(blocked),'lawn')
   for u,v,bearing in p.get('benches',[]):out['features'].append(dict(kind='bench',at=ll(u,v),bearing=bearing-5))
   if p.get('livingWall'):out['features'].append(dict(kind='livingWall',line=[ll(*q)for q in p['livingWall']],height=3.1))
   if p.get('fountain'):
    u,v,r=p['fountain'];c=local(Point(ll(u,v)));g=c.buffer(r,quad_segs=12)
    emit(g.buffer(.25).difference(g),'stone',height=.60);emit(g,'water',height=.46)
    out['features'].append(dict(kind='fountain',at=ll(u,v),radius=r))
  if p.get('lawnsFromMap'):
   bounds=local(box(*p['bounds']))
   selected=[g.intersection(bounds)for f,g in lawns if g.intersects(bounds) and (not p.get('mapped') or f['properties'].get('name')==p['mapped'])]
   g=unary_union(selected).difference(blocked).difference(unary_union([g for f,g in water]))
   emit(g,'lawn')
   if p.get('edgePlanting'):
    # Sparse, low border planting; never occlude a mapped path or water.
    pieces=[g]if g.geom_type=='Polygon'else list(getattr(g,'geoms',[]))
    for part in pieces:
     if part.geom_type!='Polygon' or part.area<15:continue
     edge=part.exterior
     for distance in range(0,int(edge.length),18):
      q=edge.interpolate(distance);patch=q.buffer(1.1).intersection(part)
      emit(patch,'bed',plants=True)
  if p.get('aerial'):
   a=p['aerial'];x0,y0,x1,y1=a['extent'];n=a['size']
   def trace(q):return [x0+q[0]/n*(x1-x0),y1-q[1]/n*(y1-y0)]
   if a.get('court'):
    court=local(Polygon([trace(q)for q in a['court']])).difference(unary_union(walls).buffer(T['buildingClearance']))
    walks=unary_union([local(LineString([trace(q)for q in w['points']])).buffer(w['width']/2,cap_style=2,join_style=1)for w in a['walks']]).intersection(court)
    # Cover the erroneous asphalt/curb with a contiguous base before laying
    # the concrete walks. Other service roads outside this court stay visible.
    emit(court,'lawn',height=.34)
    emit(walks,'pave',height=.37)
   for patch in a.get('patches',[]):
    g=local(Polygon([trace(q)for q in patch['points']])).difference(blocked)
    emit(g,patch['kind'],plants=patch.get('plants',False))
  if p.get('pond'):
   pond=unary_union([g for f,g in water if f['properties'].get('name')==p['pond']])
   emit(pond.buffer(T['pondRim']).difference(pond).difference(blocked),'stone',height=.27)
  for lng,lat,bearing in p.get('benchesLngLat',[]):out['features'].append(dict(kind='bench',at=[lng,lat],bearing=bearing))
 return dict(sources=profiles['sources'],accuracy=profiles['accuracy'],detail=T,places=result)

output={'version':1,'source':'data/trees.geojson: existing tree inventory and detected crowns; no new positions. Crown/branch morphology is a species-inspired visual approximation.','bounds':BOUNDS,'treeColumns':['lng','lat','radius','crownBase','top','species','density','hue','source'],'trees':trees,'canopyKeys':canopy_keys,'trunkKeys':sorted(set(trunk_keys)),'gardens':compile_gardens()}
OUT.write_text(json.dumps(output,separators=(',',':'),ensure_ascii=False)+'\n',encoding='utf-8')
print('campus trees',len(trees),'species',dict(Counter(t[5]for t in trees)),'bytes',OUT.stat().st_size)
