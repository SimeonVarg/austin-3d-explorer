#!/usr/bin/env python3
"""Texan Tower: lower mixed roof and photographed Tuscan east elevation.
Writes this recipe only. Source-image joins/camera fitting remain private.
"""
import json,math,os
from pathlib import Path
from detail_mesh_dedup import deduplicate_detail_meshes
from compact_models import compact
ROOT=Path(os.environ.get('FLYOVER_AUTHOR_ROOT',Path(__file__).resolve().parents[1]))
ID='f142fa08-fece-4a8d-8aae-efe0b88b38cf'
OUT=Path(os.environ.get('FLYOVER_AUTHOR_OUT',ROOT/'data/apartments/texan-tower.json'))
# Five full rows above the stone base, then a shallow attic under the hips.
BASE=4.2; ROW=3.45; FLOORS=[round(BASE+i*ROW,4) for i in range(6)]
EAVE=23.0; FLAT=23.57; RIDGE=25.65; CROWN=28.19
AX=.073
SPLIT=36.5; SOUTH_EAVE=20.4; SOUTH_FLAT=21.65; SOUTH_CAP=24.3
SOUTH_FLOORS=[4.15+i*3.25 for i in range(5)]
COLOURS={'stucco':'#d4c8ab','stone':'#b7aa8c','trim':'#ded5bf','roof':'#746d60',
 'silver':'#89949c','brick':'#895d4c','siding':'#b39d79','metalRoof':'#a3aaa8','flatRoof':'#c4c3b7','pane':'#354342','frame':'#827d6c','rail':'#6b5545',
 'dark':'#36382f','unit':'#8b9592','unitTop':'#b8c1bd','fan':'#414945','water':'#3f929b'}
# East-face arrangement; southern two stacks are occluded and inferred.
BALCONIES=[(38.5,3.0),(49,6.8),(65.0,7.0),(80.0,3.2)]
WINDOWS=[(43.1,1.8),(56.2,2.0),(73.3,2.0),(84.0,1.6)]
BANKS=[(64,19,7,3),(63,29,6,1)]
# Broad roof planes, not standing-seam line geometry. Slopes stay below the
# surveyed southern cap24.3m. Private measured image ratios retain the joins.
SOUTH_ROOF={'apronDepth':3.6,'eave':20.45,'crest':21.70,
 'frontSegments':[(.2,10.35),(13.15,27.85),(30.7,42.0)],
 'eastSegments':[(.2,12.8),(23.2,36.3)],
 'clerestories':[(4.0,31.5,4.1,10.8),(4.0,31.5,31.5,38.2)],
 'stoneCaps':[(10.2,13.3),(27.8,30.9)],'stoneCapTop':22.2,
 'balconyCaps':[(14.9,20.1),(27.7,31.3)],'balconyCapTop':22.05}



def main():
 fs=json.loads((ROOT/'data/snapshots/2026-08-04/buildings.detailed.geojson').read_text())['features']
 feature=next(f for f in fs if f['properties']['id']==ID)
 rings=feature['geometry']['coordinates'];ring=rings[0];mx=111320*math.cos(math.radians(sum(p[1] for p in ring)/len(ring)));my=110540.
 ax=AX;ay=math.sqrt(1-ax*ax);p0=ring[0]
 uv0=[((p[0]-p0[0])*mx*ax+(p[1]-p0[1])*my*ay,-(p[0]-p0[0])*mx*ay+(p[1]-p0[1])*my*ax) for p in ring]
 u0=min(p[0] for p in uv0);v0=min(p[1] for p in uv0)
 fr={'o':[p0[0]+(u0*ax-v0*ay)/mx,p0[1]+(u0*ay+v0*ax)/my],'ax':ax,'ay':ay,'mx':mx,'my':my,'L':max(p[0] for p in uv0)-u0,'W':max(p[1] for p in uv0)-v0}
 def uv(r):return [[round((p[0]-fr['o'][0])*mx*ax+(p[1]-fr['o'][1])*my*ay,4),round(-(p[0]-fr['o'][0])*mx*ay+(p[1]-fr['o'][1])*my*ax,4)] for p in r]
 holes=[uv(r) for r in rings[1:]];L=fr['L'];W=fr['W']
 d={'id':ID,'name':'Texan Tower','footprint':{'ring':ring,'holes':rings[1:]},'frame':{'obb':fr},
 'sources':{'MAP':{'type':'map','date':'2026-08-04','source':'Existing Overture snapshot and massing target identity','confidence':'high','supports':'Mapped footprint, courtyard hole, plan scale and existing Texan Tower identity'},
 'SCAN':{'type':'survey/LiDAR','date':'2017-02-16 / 2017-03-14','source':'USGS_LPC_TX_Central_B1_2017_LAS_2019; data/massing.json','confidence':'high','supports':'Roof median23.57m, p9928.19m, mixed roof classification, slope median18 degrees'},
 'SCAN2021':{'type':'survey/LiDAR','date':'2021-01-26 to2021-03-07','source':'Existing2021 class6 height-above-ground raster,0.5m cells','confidence':'high','supports':'Distinct north/south roof domains, seam near36.5m from south; south median20.7–22.5m,p9924.0–24.4m; north median24.1–24.7m,p9925.3–28.4m'},
 'PHOTO':{'type':'site photograph','confidence':'high','supports':'Visible eastern facade five full balcony rows, cream stucco and stone base, hipped roof hierarchy, raised arched courtyard wall, small hipped caps and condenser banks; private source joins'},
 'INFER':{'type':'inference','derivedFrom':['MAP','SCAN','PHOTO'],'confidence':'medium','supports':'Roof segmentation depths, individual elevations within surveyed distribution, equipment counts, hidden southern/western faces and exact balcony dimensions'}},
 'colours':{k:{'hex':v,'_src':'PHOTO material family; daylight albedo inferred'} for k,v in COLOURS.items()},
 'materials':{'stone':{'type':'stone','strength':.18},'stucco':{'type':'concrete','strength':.08},'pane':{'type':'glass','strength':.18}},
 'skins':{k:{'kind':'flat','field':k} for k in COLOURS},
 'levels':{'floors':[0]+FLOORS,'ground':BASE,'roof':FLAT,'crown':CROWN,'_src':'PHOTO five full residential rows above stone base. SCAN overall metric height distribution; row heights inferred.'},
 'preserveRoof':False,'preserveRoofscape':False,'blocks':[],
 '_open':['Mapped outline contains two observed architectural sections. Texan Tower is the inherited feature label; the separate name/ownership of the southern section is unverified.',
 'South silver/brick section and north cream/stone section are separated by the mapped and scanned roof seam. Unseen western elevations remain inferred.',
 'Legacy rooftop cyan pool prop had no established provenance and is not copied; inner court water was occluded in the supplied views.',
 'Exact shingle pattern, weathering and all apartment-level details are not reconstructed.'],
 '_review':'Photo-led candidate; parent actual application comparison pending.'}
 def band(z0,z1,skin,**kw):return dict(z0=z0,z1=z1,skin=skin,**kw)
 def block(name,plan,a,b,skin='stucco',**kw):
  ob=dict(id=name,plan=plan,z0=a,z1=b,bands=[band(a,b,skin)],roofTone='flatRoof',**kw);d['blocks'].append(ob);return ob
 def opening(s,w,z,h=2.15,depth=.18,tone='pane'):
  return dict(s0=round(s-w/2,4),s1=round(s+w/2,4),z0=round(z,4),z1=round(z+h,4),d=depth,glass=tone,tone='trim',mullion={'cols':[.5],'rows':[.45],'w':.05,'tone':'frame'})
 # Keep the mapped court open; a simplified wall line fits within its map envelope.
 outer=[[L-.45,.45],[SPLIT,.45],[SPLIT,W-.45],[L-.45,W-.45]]
 body=block('north-residence',{'ring':outer,'holes':holes},0,EAVE,
  _src='MAP bounded plan/court. PHOTO east face. SCAN/INFER roof height; small outline notches simplified.')
 # Polygon edge0 is the east wall, directed north to south.
 east=[];wins=[];recess=[]
 for z in FLOORS[:-1]:
  for u,w in WINDOWS:
   if u<L-.6:wins.append(opening(L-.45-u,w,z+.62))
  for u,w in BALCONIES:recess.append(opening(L-.45-u,w,z+.25,2.92,1.15,'pane'))
 attic=[opening(L-.45-u,1.15,FLOORS[-1]+.35,.80,.12) for u in [38,43,50,58,64,71,78,82]]
 east=[band(0,BASE,'stone',openings=[dict(opening(L-.45-u,1.8,.25,2.9,.22,'dark'),arch={'rise':.90,'segments':16,'tone':'stone'}) for u in [38.5,49,65,80]]),
 band(BASE,BASE+2*ROW,'stone',openings=wins+recess),band(BASE+2*ROW,FLOORS[-1],'stucco',openings=wins+recess),band(FLOORS[-1],EAVE,'stucco',openings=attic)]
 d['skins']['hidden']={'kind':'bays','field':'stucco','windowRule':'all','bay':4.2,'window':{'w':1.65,'h':2.05,'sill':.65},'glass':'pane','frame':'trim','reveal':.15,'_src':'INFER hidden elevations, not counted from reference view'}
 body['faces']={'0':{'bands':east}}
 for face in ['1','2','3']:body['faces'][face]={'bands':[band(0,BASE,'stone'),band(BASE,FLOORS[-1],'hidden'),band(FLOORS[-1],EAVE,'stucco')]}
 meshes={}
 def mesh(t):
  if t not in meshes:meshes[t]={'id':'texan-'+t,'tone':t,'vertices':[],'triangles':[],'_src':'PHOTO feature type; geometry dimensions/occluded placement INFER'}
  return meshes[t]
 def quad(t,pts):
  m=mesh(t);n=len(m['vertices']);m['vertices'] += [[round(x,4) for x in p] for p in pts];m['triangles'] += [[n,n+1,n+2],[n,n+2,n+3]]
 def tri(t,pts):
  m=mesh(t);n=len(m['vertices']);m['vertices'] += [[round(x,4) for x in p] for p in pts];m['triangles'].append([n,n+1,n+2])
 def box(t,r,a,b):
  x0,x1,y0,y1=r
  quad(t,[(x0,y0,b),(x1,y0,b),(x1,y1,b),(x0,y1,b)])
  for p,q in [((x0,y0),(x1,y0)),((x1,y0),(x1,y1)),((x1,y1),(x0,y1)),((x0,y1),(x0,y0))]:quad(t,[(p[0],p[1],a),(q[0],q[1],a),(q[0],q[1],b),(p[0],p[1],b)])
 def hip(r,eave,top,tone='roof'):
  x0,x1,y0,y1=r;dx=x1-x0;dy=y1-y0
  if dx>=dy:
   a=(x0+dy/2,(y0+y1)/2,top);b=(x1-dy/2,(y0+y1)/2,top)
   quad(tone,[(x0,y0,eave),(x1,y0,eave),b,a]);quad(tone,[(x1,y1,eave),(x0,y1,eave),a,b]);tri(tone,[(x0,y1,eave),(x0,y0,eave),a]);tri(tone,[(x1,y0,eave),(x1,y1,eave),b])
  else:
   a=((x0+x1)/2,y0+dx/2,top);b=((x0+x1)/2,y1-dx/2,top)
   quad(tone,[(x0,y1,eave),(x0,y0,eave),a,b]);quad(tone,[(x1,y0,eave),(x1,y1,eave),b,a]);tri(tone,[(x0,y0,eave),(x1,y0,eave),a]);tri(tone,[(x1,y1,eave),(x0,y1,eave),b])
 # White equipment terraces are interrupted by the real mapped court.
 for n,r in enumerate([(SPLIT,L-1,30,W-1),(SPLIT,46,12,30),(59,L-1,12,30)]):block('flat-roof-'+str(n),r,EAVE,FLAT,'stucco',_src='SCAN median plane23.57m. PHOTO pale flat plant strips; depths inferred.')
 for r in [(SPLIT,46,0,13),(59,L,0,13),(SPLIT,L,31,W),(SPLIT,SPLIT+6.5,0,W),(L-13,L,0,W)]:hip(r,EAVE+.02,RIDGE)
 # SCAN2021 has a sharp roof break at u36m. PHOTO silver/redbrick southern
 # section is a separate architecture inside the same mapped outline.
 south=block('south-residence',[.45,SPLIT-.15,.45,W-.45],0,SOUTH_EAVE,'silver',
  _src='PHOTO silver standing-seam cladding over redbrick with pale stone piers; SCAN2021 roof median21–22m; separate property name unknown.')
 def southwall(length,positions,upper='silver'):
  op=[opening(c,w,z+.65,1.72,.14) for z in SOUTH_FLOORS for c,w in positions]
  return [band(0,4.15,'stone'),band(4.15,10.65,'brick',openings=op),band(10.65,SOUTH_EAVE,upper,openings=op)]
 south['faces']={'u0':{'bands':southwall(W-.9,[(3.4,2.2),(8.0,2.0),(14.0,2.2),(20.0,2.2),(26.5,2.2),(33,2.0),(38,2.2)])},
 'v0':{'bands':southwall(SPLIT-.6,[(3,2.2),(8,2.0),(15,2.0),(21,2.0),(28,2.0),(33,2.0)])}}
 for b in south['faces']['v0']['bands']:
  if b['z1']>4.15:
   b['openings'] += [opening(SPLIT-.15-u,w,z+.25,2.75,1.05,'pane') for z in SOUTH_FLOORS for u,w in [(4,4.0),(17.5,4.0),(29.5,3.2)]]
 # A tan siding bay and a pale stone pier break the south/east metal field.
 south['overrides']=[{'region':[.44,.46,10.5,13.0],'bands':[band(0,SOUTH_EAVE,'stone')]},
 {'region':[.44,.46,28.0,30.6],'bands':[band(0,SOUTH_EAVE,'stone')]},
 {'region':[13,23,.44,.46],'bands':southwall(10,[(2.2,2.0),(7.3,2.0)],'siding')}]
 block('south-flat-roof',[SOUTH_ROOF['apronDepth'],SPLIT-1,SOUTH_ROOF['apronDepth'],W-1],SOUTH_EAVE,SOUTH_FLAT,'silver',_src='SCAN2021 flat southern roof21.65m. PHOTO dense plant between raised metal-roof ranges.')
 # Two long raised clerestory ranges, each with a shallow metal hip; flat
 # equipment court remains between them, unlike the old single floating cap.
 for n,r in enumerate(SOUTH_ROOF['clerestories']):
  ob=block('south-clerestory-'+str(n),r,SOUTH_FLAT,23.8,'siding',_src='PHOTO two long pale upper ranges with small clerestory windows and silver caps; SCAN2021 p9924.3m.')
  length=r[1]-r[0];ops=[opening(2.0+3.5*k,1.15,22.35,.95,.1) for k in range(8)]
  ob['faces']={'v0':{'bands':[band(SOUTH_FLAT,23.8,'siding',openings=ops)]},'v1':{'bands':[band(SOUTH_FLAT,23.8,'siding',openings=ops)]}}
  hip((r[0]-.25,r[1]+.25,r[2]-.25,r[3]+.25),23.8,SOUTH_CAP,'metalRoof')
 # Source shows a broad descending apron outside the raised clerestories,
 # interrupted by stone-pier caps and projecting balcony hoods. The old flat
 # slab covered the slope; inset it so these planes remain exposed.
 depth=SOUTH_ROOF['apronDepth'];za=SOUTH_ROOF['eave'];zb=SOUTH_ROOF['crest']
 for a,b in SOUTH_ROOF['frontSegments']:
  if a<depth:a=depth
  b=min(b,W-.2)
  quad('metalRoof',[(.0,a,za),(depth,a,zb),(depth,b,zb),(.0,b,za)])
  box('trim',(0,.09,a,b),za-.12,za)
 for a,b in SOUTH_ROOF['eastSegments']:
  if a<depth:a=depth
  quad('metalRoof',[(a,0,za),(b,0,za),(b,depth,zb),(a,depth,zb)])
  box('trim',(a,b,0,.09),za-.12,za)
 tri('metalRoof',[(0,0,za),(depth,0,za),(depth,depth,zb)])
 tri('metalRoof',[(0,0,za),(depth,depth,zb),(0,depth,za)])
 # The shared corner uses one diagonal hip, avoiding two intersecting sheets.
 # Apron segment endpoints already leave room for the observed proud piers.
 for n,(a,b) in enumerate(SOUTH_ROOF['stoneCaps']):
  cap=block('south-stone-roof-pier-'+str(n),[.15,3.4,a+.2,b-.2],SOUTH_EAVE,SOUTH_ROOF['stoneCapTop'],'stone',
   _src='PHOTO two stone piers interrupt front silver skirt and carry shallow wider metal caps. Width/height inferred within SCAN2021 range.')
  hip((0,4.0,a,b),SOUTH_ROOF['stoneCapTop'],SOUTH_ROOF['stoneCapTop']+.25,'metalRoof')
 for a,b in SOUTH_ROOF['balconyCaps']:
  quad('metalRoof',[(a,0,20.8),(b,0,20.8),(b,4.1,SOUTH_ROOF['balconyCapTop']),(a,4.1,SOUTH_ROOF['balconyCapTop'])])
  box('trim',(a,b,0,.1),20.68,20.8)
 mesh('metalRoof')['_src']={'feature':'PHOTO broad sloped southern silver apron, two raised clerestories, two proud pier caps and interrupted balcony hoods',
  'imageRatios':'Manually measured projected central apron perpendicular depth/long edge approximately0.284, with about8px edge uncertainty. Oblique image ratio constrains silhouette, not surveyed metric dimensions; pier-cap widths are inferred.',
  'dimensions':'INFER apron3.6m plan depth and1.25m rise, pier caps3.1m wide; retained SCAN2021 south top24.3m, equipment21.65m and outer wall20.4m. Hidden west slope not certified.'}

 # Recessed balcony stacks at the south eastern corner and two tan east bays.
 for z in SOUTH_FLOORS:
  for u,w in [(4,4.0),(17.5,4.0),(29.5,3.2)]:
   box('trim',(u-w/2,u+w/2,.05,1.4),z+.07,z+.22)
   box('rail',(u-w/2,u+w/2,.03,.09),z+.91,z+.98)
   for k in range(9):
    x=u-w/2+k*w/8;box('rail',(x-.023,x+.023,.035,.095),z+.22,z+.96)
 # East balcony slabs and open rust-brown rails. Five true stacked rows.
 for z in FLOORS[:-1]:
  for u,w in BALCONIES:
   box('trim',(u-w/2,u+w/2,.06,1.55),z+.06,z+.24)
   box('rail',(u-w/2,u+w/2,.04,.11),z+.94,z+1.0)
   for k in range(max(3,round(w/.43))+1):
    x=u-w/2+k*w/max(3,round(w/.43));box('rail',(x-.024,x+.024,.045,.105),z+.24,z+.98)
 # Piers alternate a pale upper field with the stone lower two floors.
 for u,w in WINDOWS:
  if u+w/2>=L:continue
  box('trim',(u-w/2-.12,u+w/2+.12,.30,.44),BASE+2*ROW-.12,BASE+2*ROW+.08)
 # Four genuinely open arches atop the east side of the roof court, not dark
 # painted rectangles. Last arch is taller, as the visible roof view shows.
 y=5.9;aa=47;bb=59;za=24.0;zt=28.0
 for i in range(4):
  c=48.5+3*i;w=2.15;rise=1.075;head=27.45 if i<3 else 27.80;spring=head-rise
  box('stucco',(c-1.5,c-w/2,y,y+.4),za,zt)
  for k in range(18):
   a=math.pi*k/18;b=math.pi*(k+1)/18;x0=c-w/2*math.cos(a);x1=c-w/2*math.cos(b);h0=spring+rise*math.sin(a);h1=spring+rise*math.sin(b)
   quad('stucco',[(x0,y,h0),(x1,y,h1),(x1,y,zt),(x0,y,zt)])
   quad('stucco',[(x1,y+.4,h1),(x0,y+.4,h0),(x0,y+.4,zt),(x1,y+.4,zt)])
   quad('stucco',[(x0,y,h0),(x0,y+.4,h0),(x1,y+.4,h1),(x1,y,h1)])
  box('rail',(c-w/2,c+w/2,y-.03,y+.03),za+.85,za+.92)
 box('stucco',(bb-.425,bb,y,y+.4),za,zt);box('trim',(aa-.1,bb+.1,y-.15,y+.55),zt,28.19)
 for n,r in enumerate([(46.4,47,6,28.6),(58.9,59.5,6,28.6),(47,59,28.1,28.7)]):block('court-wall-'+str(n),r,FLAT,26.65,_src='PHOTO pale inner court walls, exact depths inferred.')
 for n,(x,y0,w,l,h) in enumerate([(46.5,23.8,4.3,4.3,27.15),(56,23,5.5,5.2,27.1),(61,4.8,3.5,4.4,25.9)]):
  block('hip-cupola-'+str(n),[x,x+w,y0,y0+l],FLAT,h,'stucco',_src='PHOTO separate cream hipped roof caps; metric placement inferred.')
  hip((x-.3,x+w+.3,y0-.3,y0+l+.3),h,h+.95)
 # Four visible equipment groups. Coherent gray cylinders with dark fan tops.
 count=0
 for u,v,cols,rows,zroof in [(u,v,c,r,FLAT) for u,v,c,r in BANKS]+[(10,14,7,3,SOUTH_FLAT),(24,24,6,2,SOUTH_FLAT)]:
  for i in range(cols):
   for j in range(rows):
    x=u+i*1.18;y0=v+j*1.18;z=zroof+.08;r=.39;h=.88;n=8
    if zroof==FLAT:
     assert 13+r<x<L-13-r and 13+r<y0<31-r and x-r>59
    else: assert 5+r<x<SPLIT-1-r and 9.3+r<y0<31-r
    for k in range(n):
     a=math.tau*k/n;b=math.tau*(k+1)/n
     quad('unit',[(x+r*math.cos(a),y0+r*math.sin(a),z),(x+r*math.cos(b),y0+r*math.sin(b),z),(x+r*math.cos(b),y0+r*math.sin(b),z+h),(x+r*math.cos(a),y0+r*math.sin(a),z+h)])
     tri('unitTop',[(x,y0,z+h),(x+r*math.cos(a),y0+r*math.sin(a),z+h),(x+r*math.cos(b),y0+r*math.sin(b),z+h)])
     tri('fan',[(x,y0,z+h+.01),(x+.23*math.cos(a),y0+.23*math.sin(a),z+h+.01),(x+.23*math.cos(b),y0+.23*math.sin(b),z+h+.01)])
    count+=1
 d['detailMeshes']=list(meshes.values());d['_counts']={'residentialRows':5,'northBalconyStacks':4,'southBalconyStacks':3,'northRows':5,'southRows':5,'courtyardArches':4,'smallHipCaps':3,'condenserBanks':4,'condensersInferred':count,'architecturalSplitU':SPLIT,'southRoof':SOUTH_FLAT,'broadSouthApronSegments':3,'broadEastApronSegments':2,'southPierRoofCaps':2,'eastBalconyRoofCaps':2}
 assert len(holes)==1 and FLAT<28 and CROWN<29
 assert max(p[2] for m in meshes.values() for p in m['vertices'])<29
 assert all(math.isfinite(x) for m in meshes.values() for p in m['vertices'] for x in p)
 assert all(max(t)<len(m['vertices']) for m in meshes.values() for t in m['triangles'])
 deduplicate_detail_meshes(d)
 OUT.write_text(compact(json.dumps(d,ensure_ascii=False,separators=(',',':'))))
 print('Texan Tower:',len(d['blocks']),'blocks;',sum(len(m['triangles']) for m in meshes.values()),'mesh triangles;',count,'condensers; mapped court retained')
if __name__=='__main__':main()
