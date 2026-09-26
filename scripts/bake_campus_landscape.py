"""Compile campus tree envelopes and authored gardens into one compact input.

Owns only data/campus_landscape.json. Tree locations/species/envelopes come from
the existing surveyed/detected tree bake; this does not fetch or move trees.
"""
import json, math
from pathlib import Path
from collections import defaultdict, Counter
from shapely.geometry import shape, box, Point, LineString, mapping
from shapely.ops import transform, unary_union
from shapely import make_valid

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'data/campus_landscape.json'
BOUNDS=[-97.7424,30.2806,-97.7304,30.2919]
campus_region=box(*BOUNDS)
# Follow the recorded Guadalupe centreline, including its bend at 27th.
# This adds existing crowns beside the street, never synthetic tree positions.
guad=json.loads((ROOT/'data/guadalupe_profiles.json').read_text())['extent']
mx=111320*math.cos(math.radians(30.288));my=111320.
metric=lambda g:transform(lambda x,y:((x+97.742)*mx,(y-30.288)*my),g)
geographic=lambda g:transform(lambda x,y:(x/mx-97.742,y/my+30.288),g)
roads=json.loads((ROOT/'data/osm_cache/roads.json').read_text())['elements']
lines=[LineString([(p['lon'],p['lat'])for p in r['geometry']]) for r in roads if r.get('tags',{}).get('name')=='Guadalupe Street' and len(r.get('geometry',[]))>1]
centre=unary_union(lines).intersection(box(*guad['bounds']))
guad_region=geographic(metric(centre).buffer(guad['treeBufferMeters']))
region=campus_region.union(guad_region)
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
# Keep canopy envelopes clear of solid buildings. Retain the original retirement
# keys above, including rejected trees, so their old extrusion cannot reappear.
TREE_CLEARANCE = .35
TREE_ENVELOPE_GAIN = 1.22  # renderer's cluster offset + radius + surface lobes
TREE_MIN_RADIUS = .7
snapshot=json.loads((ROOT/'data/manifest.json').read_text())['latest']
from shapely import make_valid
walls=[]
for f in json.loads((ROOT/f'data/snapshots/{snapshot}/buildings.detailed.geojson').read_text())['features']:
 g=make_valid(metric(shape(f['geometry'])))
 if not g.is_empty and all(math.isfinite(v)for v in g.bounds):walls.append(g)
wall_index=STRtree(walls)
# The documented Union south vestibule approach is paved and unobstructed.
# Suppress only imagery detections inside this mapped doorway clearance. Keep
# the row slot: tree geometry seeds use array indices. Density 2 exceeds every
# supported preset/slider value (maximum 1), preserving all other tree shapes
# and all old retirement keys without changing the renderer.
UNION_APPROACH = dict(origin=[-97.74152403804212,30.28602088917869],
    ax=.9961946980917455,ay=-.08715574274765817,mx=96126.44678836058,my=111320,
    bounds=[23.,29.,-5.,0.])
def false_union_approach_tree(t):
 if t[8]!='imagery':return False
 f=UNION_APPROACH;dx=(t[0]-f['origin'][0])*f['mx'];dy=(t[1]-f['origin'][1])*f['my']
 u=dx*f['ax']+dy*f['ay'];v=-dx*f['ay']+dy*f['ax'];a,b,c,d=f['bounds']
 return a<=u<=b and c<=v<=d
clear_trees=[];retired_canopy_keys=[];tree_repairs={'insideBuildings':0,'canopiesClipped':0,'speedwayCanopies':0,'unionApproach':0}
speedway=metric(LineString([[-97.73772,30.28175],[-97.73704,30.2860],[-97.73686,30.2878]]))
SPEEDWAY_BUFFER=11
SPEEDWAY_MAX_RADIUS=2.7
for tree_index,t in enumerate(trees):
 pt=metric(Point(t[:2]));
 if pt.distance(speedway)<SPEEDWAY_BUFFER and t[2]>SPEEDWAY_MAX_RADIUS:t[2]=SPEEDWAY_MAX_RADIUS;tree_repairs['speedwayCanopies']+=1
 near=wall_index.query(pt.buffer(t[2]*TREE_ENVELOPE_GAIN+TREE_CLEARANCE))
 clearance=min((pt.distance(walls[int(i)])for i in near),default=t[2]*TREE_ENVELOPE_GAIN+TREE_CLEARANCE)
 radius=min(t[2],max(0,clearance-TREE_CLEARANCE)/TREE_ENVELOPE_GAIN)
 if radius<TREE_MIN_RADIUS:tree_repairs['insideBuildings']+=1;continue
 if radius<t[2]-.01:tree_repairs['canopiesClipped']+=1
 t[2]=round(radius,2)
 if false_union_approach_tree(t):
  t[6]=2;tree_repairs['unionApproach']+=1
  retired_canopy_keys.append(canopy_keys[tree_index])
 clear_trees.append(t)
trees=clear_trees

def compile_court_details(config, frame, court):
 """Small court solids share one material batch; all dimensions live in profiles."""
 from shapely.geometry import Polygon, box
 from shapely.ops import triangulate, unary_union
 batches={}
 def xyz(p):
  u,v,z=p
  return [round(frame['o'][0]+(u*frame['ax']-v*frame['ay'])/frame['mx'],9),
          round(frame['o'][1]+(u*frame['ay']+v*frame['ax'])/frame['my'],9),round(z,4)]
 def face(points,tone,double=False):
  batch=batches.setdefault(tone,dict(kind='detailMesh',colour=config['colours'][tone],vertices=[],triangles=[]))
  start=len(batch['vertices']);batch['vertices'].extend(xyz(p)for p in points)
  for i in range(1,len(points)-1):
   tri=[start,start+i,start+i+1];batch['triangles'].append(tri)
   if double:batch['triangles'].append(tri[::-1])
 def quad(a,b,c,d,tone):face([a,b,c,d],tone)
 def rotated_box(u,v,w,d,z0,z1,tone,angle=0):
  a=math.radians(angle);cs=math.cos(a);sn=math.sin(a)
  r=[(u+x*cs-y*sn,v+x*sn+y*cs)for x,y in [(-w/2,-d/2),(w/2,-d/2),(w/2,d/2),(-w/2,d/2)]]
  face([[x,y,z1]for x,y in r],tone)
  for i in range(4):
   x,y=r[i];x1,y1=r[(i+1)%4];quad([x,y,z0],[x1,y1,z0],[x1,y1,z1],[x,y,z1],tone)
 def cylinder(a,b,r,tone,n=9):
  axis=[b[i]-a[i]for i in range(3)];length=math.sqrt(sum(x*x for x in axis));axis=[x/length for x in axis]
  up=[1,0,0]if abs(axis[2])>.9 else [0,0,1]
  cross=lambda p,q:[p[1]*q[2]-p[2]*q[1],p[2]*q[0]-p[0]*q[2],p[0]*q[1]-p[1]*q[0]]
  side=cross(axis,up);norm=math.sqrt(sum(x*x for x in side));side=[x/norm for x in side];other=cross(axis,side)
  ring=lambda p:[[p[k]+r*(math.cos(i/n*math.tau)*side[k]+math.sin(i/n*math.tau)*other[k])for k in range(3)]for i in range(n)]
  ra,rb=ring(a),ring(b)
  for i in range(n):quad(ra[i],ra[(i+1)%n],rb[(i+1)%n],rb[i],tone)
 pool=config['pool'];u,v=pool['center'];outer=pool['outer']/2;inner=pool['inner']/2
 pool_polygon=box(u-outer,v-outer,u+outer,v+outer)
 paving=config['paving'];cross=unary_union([box(a,c,b,d)for a,b,c,d in paving['rects']]).intersection(court).difference(pool_polygon)
 # Individual irregular-course flags leave visible dark joints at walking height.
 pw,ph=paving['unit'];x0,y0,x1,y1=cross.bounds
 row=0;y=y0
 while y<y1:
  rowHeight=ph*paving['rowScales'][row%len(paving['rowScales'])]
  x=x0-(row%2)*pw/2;column=0
  while x<x1:
   flagWidth=pw*paving['widthScales'][(column+row)%len(paving['widthScales'])]
   g=box(x+paving['joint']/2,y+paving['joint']/2,x+flagWidth-paving['joint']/2,y+rowHeight-paving['joint']/2).intersection(cross)
   pieces=[g]if g.geom_type=='Polygon'else list(getattr(g,'geoms',[]))
   for piece in pieces:
    if piece.geom_type!='Polygon' or piece.area<paving['minFlagArea']:continue
    for tri in triangulate(piece):
     if not piece.covers(tri.representative_point()):continue
     face([[a,b,paving['height']]for a,b in list(tri.exterior.coords)[:-1]],'paving')
   x+=flagWidth;column+=1
  y+=rowHeight;row+=1
 for part in ([cross]if cross.geom_type=='Polygon'else cross.geoms):
  for tri in triangulate(part):
   if part.covers(tri.representative_point()):face([[a,b,paving['base']]for a,b in list(tri.exterior.coords)[:-1]],'joint')
 # Four concentric coping contours give a sloped shoulder and an inset basin.
 def square(r,z):return [[u-r,v-r,z],[u+r,v-r,z],[u+r,v+r,z],[u-r,v+r,z]]
 rings=[square(outer,paving['height']),square(outer-pool['shoulderInset'],pool['rimShoulder']),square(outer-pool['crestInset'],pool['rimHeight']),square(inner,pool['rimShoulder'])]
 for a,b in zip(rings,rings[1:]):
  for i in range(4):j=(i+1)%4;quad(a[i],a[j],b[j],b[i],'stone')
 floor=pool['floorHeight'];top=pool['rimShoulder'];tile=pool['tileWidth'];step=pool['tileRowHeight'];gap=pool['joint']
 # Exposed blue/ochre mosaic courses on all four inner basin walls.
 n=math.ceil(pool['inner']/tile);nr=math.ceil((top-floor)/step)
 for side in range(4):
  def wall(s,z):
   return ([u-inner+s,v-inner,z],[u+inner,v-inner+s,z],[u+inner-s,v+inner,z],[u-inner,v+inner-s,z])[side]
  for j in range(nr):
   for i in range(n):
    a=i*pool['inner']/n+gap/2;b=(i+1)*pool['inner']/n-gap/2;lo=floor+j*(top-floor)/nr+gap/2;hi=floor+(j+1)*(top-floor)/nr-gap/2
    quad(wall(b,lo),wall(a,lo),wall(a,hi),wall(b,hi),'tileGold'if j%pool['tileAccentEvery']==pool['tileAccentRow'] else 'tileBlue')
 face(square(inner,pool['waterHeight']),'water')
 # Separate carved-support stone seats sit on the lawn margins beside the pool.
 seats=config['stoneSeats']
 for x,y,angle in seats['positions']:
  rotated_box(x,y,seats['length'],seats['width'],seats['seat']-seats['slab'],seats['seat'],'stone',angle)
  for offset in [-seats['supportSpacing']/2,seats['supportSpacing']/2]:
   levels=[(z,seats['foot']*width)for z,width in seats['supportProfile']]
   for (za,wa),(zb,wb)in zip(levels,levels[1:]):
    a=[[x+offset-wa/2,y-seats['width']*seats['supportDepth']/2,za],[x+offset+wa/2,y-seats['width']*seats['supportDepth']/2,za],[x+offset+wa/2,y+seats['width']*seats['supportDepth']/2,za],[x+offset-wa/2,y+seats['width']*seats['supportDepth']/2,za]]
    b=[[x+offset-wb/2,y-seats['width']*seats['supportDepth']/2,zb],[x+offset+wb/2,y-seats['width']*seats['supportDepth']/2,zb],[x+offset+wb/2,y+seats['width']*seats['supportDepth']/2,zb],[x+offset-wb/2,y+seats['width']*seats['supportDepth']/2,zb]]
    for i in range(4):j=(i+1)%4;quad(a[i],a[j],b[j],b[i],'stoneShade')
 # Timber benches have actual vertical back slats, arm rails and open legs.
 seat=config['woodSeats']
 for x,y,angle in seat['positions']:
  a=math.radians(angle);cs=math.cos(a);sn=math.sin(a)
  def part(px,py,w,d,z0,z1,tone='wood'):
   rotated_box(x+px*cs-py*sn,y+px*sn+py*cs,w,d,z0,z1,tone,angle)
  for xx in [-seat['length']/2+seat['leg'],seat['length']/2-seat['leg']]:
   for yy in [-seat['width']/2+seat['leg']/2,seat['width']/2-seat['leg']/2]:part(xx,yy,seat['leg'],seat['leg'],seat['base'],seat['back']if yy<0 else seat['arm'],'woodEnd')
   part(xx,0,seat['rail'],seat['width']+seat['armOverhang'],seat['arm']-seat['slat'],seat['arm'])
  n=math.floor(seat['width']/(seat['slat']+seat['gap']))
  for i in range(n):part(0,(i-(n-1)/2)*(seat['slat']+seat['gap']),seat['length'],seat['slat'],seat['seat']-seat['slat'],seat['seat'])
  for z in [seat['seat']+seat['backBottomOffset'],seat['back']-seat['rail']]:part(0,-seat['width']/2,seat['length'],seat['rail'],z,z+seat['rail'])
  n=math.floor((seat['length']-2*seat['rail'])/(seat['slat']+seat['gap']))
  for i in range(n):part((i-(n-1)/2)*(seat['slat']+seat['gap']),-seat['width']/2,seat['slat'],seat['slat'],seat['seat']+seat['backBottomOffset'],seat['back'])
 # Four fan palms are court-specific photo interpretations, not inventory trees.
 palm=config['palms']
 for x,y,h in palm['positions']:
  cylinder([x,y,palm['base']],[x,y,h],palm['trunkRadius'],'palmTrunk',palm['trunkSides'])
  z=palm['ringStart']
  while z<h-palm['ringTopGap']:
   cylinder([x,y,z],[x,y,z+palm['ringDepth']],palm['trunkRadius']+palm['ringDepth'],'palmRings',palm['trunkSides']);z+=palm['ringPitch']
  # Staggered upright, spreading and drooping fans form a crown volume.
  # Split outer blades leave air between tips instead of one flat umbrella.
  for layer,level in enumerate(palm['fanLevels']):
   n=level['count']
   for i in range(n):
    angle=(i+level['offset'])/n*math.tau+x*palm['treePhase'];dx,dy=math.cos(angle),math.sin(angle);sx,sy=-dy,dx
    variation=math.sin(i*palm['variationPhase']+x+y)
    pitch=math.radians(level['pitch']+variation*palm['pitchVariation'])
    length=level['length']*(1+variation*palm['lengthVariation'])
    base=[x+dx*palm['fanBaseRadius'],y+dy*palm['fanBaseRadius'],h+level['base']]
    cylinder([x,y,h+palm['petioleBaseOffset']],base,palm['petioleRadius'],'palmLeaf',palm['petioleSides'])
    def blade(t,f):
     spread=t*palm['fanSpread'];distance=length*f
     forward=distance*math.cos(spread)
     return [base[0]+dx*forward*math.cos(pitch)+sx*distance*math.sin(spread),
             base[1]+dy*forward*math.cos(pitch)+sy*distance*math.sin(spread),
             min(h+palm['crownTop'],base[2]+forward*math.sin(pitch)-palm['tipDroop']*f*f-palm['fanEdgeDrop']*abs(t)*f)]
    for j in range(palm['fanRays']):
     ta=-1+2*j/palm['fanRays'];tb=-1+2*(j+1)/palm['fanRays']
     ma=blade(ta,palm['splitAt']);mb=blade(tb,palm['splitAt'])
     gap=palm['tipGap']/palm['fanRays'];tipa=blade(ta+gap,1);tipb=blade(tb-gap,1)
     # A raised centre crease keeps each narrow blade from being a flat sheet.
     mid=blade((ta+tb)/2,1);mid[2]=min(h+palm['crownTop'],mid[2]+palm['bladeFold'])
     tone='palmLeaf'if (j+i+layer)%3 else 'palmLeafLight'
     face([base,ma,mb],tone,True)
     face([ma,tipa,mid,mb],tone,True);face([mb,mid,tipb],tone,True)
  # Old fronds curve down around the trunk in two overlapping dry skirts.
  for layer in range(palm['skirtLayers']):
   for i in range(palm['skirtFronds']):
    angle=(i+layer*palm['skirtPhase'])/palm['skirtFronds']*math.tau;dx,dy=math.cos(angle),math.sin(angle);sx,sy=-dy,dx
    variation=math.sin(i*palm['variationPhase']+x);drop=palm['skirtDrop']*(1+variation*palm['skirtVariation'])
    points=[]
    for radial,zoff,width in palm['skirtProfile']:
     z=h+zoff*drop-layer*palm['skirtLayerDrop'];rad=radial*palm['skirtRadius']
     points.append(([x+dx*rad+sx*width,y+dy*rad+sy*width,z],[x+dx*rad-sx*width,y+dy*rad-sy*width,z]))
    for j in range(len(points)-1):face([points[j][0],points[j][1],points[j+1][1],points[j+1][0]],'palmDry',True)
 return list(batches.values())

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
 T=profiles['detail'];campus=local(campus_region)
 paths=[];lawns=[];water=[];walls=[]
 for f in ground:
  p=f['properties'];g=make_valid(local(shape(f['geometry'])))
  if not g.intersects(campus):continue
  if p.get('k') in ['pathslab','patharea','roadarea','cyclearea'] or p.get('u')=='parking':paths.append(g)
  if p.get('k')=='area' and p.get('u') in ['park','garden','grass'] and p.get('s') in ['gardenlawn','grass','lawn']:lawns.append((f,g))
  if p.get('u')=='water':water.append((f,g))
 for f in json.loads((ROOT/f'data/snapshots/{snapshot}/buildings.detailed.geojson').read_text(encoding='utf-8'))['features']:
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
    for hole in hall['footprint']['holes']:
     paving=local(Polygon(hole))
     if p.get('courtDetails'):
      pool=p['courtDetails']['pool'];u,v=pool['center'];r=pool['outer']/2
      paving=paving.difference(rect([u-r,u+r,v-r,v+r]))
     emit(paving,'pave',height=p['courtPaving'])
   if p.get('courtDetails'):
    def uv(ll):
     x=(ll[0]-F['o'][0])*F['mx'];y=(ll[1]-F['o'][1])*F['my']
     return [x*F['ax']+y*F['ay'],-x*F['ay']+y*F['ax']]
    court=unary_union([Polygon([uv(q)for q in hole])for hole in hall['footprint']['holes']])
    out['features'].extend(compile_court_details(p['courtDetails'],F,court))
   for b in p.get('beds',[]):
    g=rect(b).difference(blocked);emit(g,'bed',plants=True);emit(g.buffer(T['edgeWidth']).difference(g),'stone',height=T['bedEdgeHeight'])
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

def compile_ground_repairs():
 config=json.loads((ROOT/'data/campus_ground_repairs.json').read_text())
 result=[]
 for site in config['sites']:
  angle=math.radians(site['rotation']);cs=math.cos(angle);sn=math.sin(angle);ox,oy=site['origin'];mx=111320*math.cos(math.radians(oy))
  def ll(x,y):return [round(ox+(x*cs-y*sn)/mx,7),round(oy+(x*sn+y*cs)/111320,7)]
  def ring(rect):
   a,b,c,d=rect;return [ll(a,c),ll(b,c),ll(b,d),ll(a,d),ll(a,c)]
  features=[]
  for patch in site.get('patches',[]):features.append(dict(kind=patch['kind'],height=patch['height'],plants=patch.get('plants',False),rings=[ring(patch['rect'])]))
  for step in site.get('stairs',[]):
   a,b,c,d=step['rect'];n=step['steps']
   for i in range(n):features.append(dict(kind='pave',height=step.get('base',0)+step['rise']*(i+1)/n,rings=[ring([a+(b-a)*i/n,a+(b-a)*(i+1)/n,c,d])]))
  for b in site.get('beams',[]):features.append(dict(kind='beam',a=ll(*b['a'][:2])+[b['a'][2]],b=ll(*b['b'][:2])+[b['b'][2]],radius=b['radius'],colour=b['colour']))
  for pos in site.get('benches',[]):features.append(dict(kind='bench',at=ll(*pos),bearing=site['rotation'],base=site.get('benchBase',0)))
  for pos in site.get('tables',[]):features.append(dict(kind='umbrella',at=ll(*pos),radius=site['canopyRadius'],height=site['canopyHeight'],tableRadius=site['tableRadius'],tableHeight=site['tableHeight'],colours=site['canopyColours']))
  for rail in site.get('rails',[]):features.append(dict(kind='raisedRail',line=[ll(*p)for p in rail['line']],base=rail['base']))
  for ramp in site.get('ramps',[]):features.append(dict(kind='groundRamp',ring=ring(ramp['rect']),start=ramp['start'],end=ramp['end']))
  result.append(dict(name=site['name'],features=features))
 return result

rail_config=json.loads((ROOT/'data/guadalupe_profiles.json').read_text())['railings']
barriers=json.loads((ROOT/'data/osm_cache/furn_barrier.json').read_text())['elements']
railings=[{'id':e['id'],'line':[[p['lon'],p['lat']]for p in e['geometry']]}for e in barriers if e['id'] in rail_config['ids']]
rail_lines=unary_union([LineString(r['line'])for r in railings])
old_fences=[]
for f in json.loads((ROOT/'data/props.geojson').read_text())['features']:
 if f['properties'].get('u')!='fence' or rail_lines.is_empty:continue
 g=make_valid(shape(f['geometry']))
 if not g.is_empty and g.distance(rail_lines)<.000002:old_fences.append(g)
# Tile quantization can move a thin fence ribbon just outside its source
# polygon. Buffer the retirement mask, not the physical rails, in metres.
mask=geographic(unary_union([metric(g)for g in old_fences]).buffer(rail_config['filterMargin']))
mask_polys=[mask]if mask.geom_type=='Polygon'else list(mask.geoms)
output={'version':1,'source':'data/trees.geojson: existing tree inventory and detected crowns; no new positions. Crown/branch morphology is a species-inspired visual approximation.','bounds':list(region.bounds),'treeColumns':['lng','lat','radius','crownBase','top','species','density','hue','source'],'trees':trees,'canopyKeys':canopy_keys,'trunkKeys':sorted(set(trunk_keys)),'gardens':compile_gardens(),'railings':railings,'railingDetail':rail_config,'retiredFences':{'type':'MultiPolygon','coordinates':[mapping(g)['coordinates']for g in mask_polys]}}
# The ground bake remains the only owner of path geometry. This renderer
# consumes its pilot height tags, keeping metre-sized scoring at walking range.
output['walks']=[dict(rings=f['geometry']['coordinates'],z=f['properties']['walk_z'])
 for f in json.loads((ROOT/'data/ground.geojson').read_text())['features']
 if f['properties'].get('k')=='patharea' and 'walk_z' in f['properties']
 and f['properties'].get('s')!='brickpave' and f['properties'].get('u')!='steps'
 and f['geometry']['type']=='Polygon']
# Door leaves reuse the entrance register, including its source confidence.
output['doors']=[dict(ring=f['geometry']['coordinates'][0],base=f['properties']['base'],height=f['properties']['h'],source=f['properties'].get('src'),ref=f['properties']['ref'])
 for f in json.loads((ROOT/'data/entrances.geojson').read_text())['features']
 if f['properties'].get('k')=='door' and f['properties'].get('src')!='field' and f['properties'].get('ref') in ['UTC','PCL','WCP','RLP']]
from campus_ramps import compile_ramps
walk_config=json.loads((ROOT/'data/campus_walk_profiles.json').read_text())
output['ramps']=compile_ramps(json.loads((ROOT/'data/entrances.geojson').read_text())['features'],walk_config['rampIds'],walk_config['rampToe'])
output['gardens']['places'].extend(compile_ground_repairs())
from campus_gearing_ground import apply_gearing_ground
apply_gearing_ground(output,json.loads((ROOT/'data/campus_buildings.json').read_text())['buildings'])
from campus_union_ground import apply_union_ground
apply_union_ground(output,json.loads((ROOT/'data/apartments/texas-union.json').read_text(encoding='utf-8')))
output['treeRepairs']=tree_repairs
# Explicitly rejected detections stay rejected in the ordinary tree fallback.
# Other inventory trees keep the original filter and density behavior.
output['retiredCanopyKeys']=retired_canopy_keys
OUT.write_text(json.dumps(output,separators=(',',':'),ensure_ascii=False)+'\n',encoding='utf-8')
print('campus trees',len(trees),'species',dict(Counter(t[5]for t in trees)),'bytes',OUT.stat().st_size)
