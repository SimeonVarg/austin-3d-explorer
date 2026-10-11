#!/usr/bin/env python3
"""Patch Union's upper amenity roof only; original lower deck and facades survive.
Observed furniture/forms use inferred positions within the inherited roof plan.
"""
import copy
import json
import math
from pathlib import Path
from detail_mesh_dedup import deduplicate_detail_meshes
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'data/apartments/union-on-24th.json'
PREFIX='upper-amenity-'
Z=94.38
GUARD_H=1.20
CEILING=98.38
LEAF_RADII=(.27,.23,.16)
LEAF_SEGMENTS=8
LEAF_RINGS=4
LEAF_IRREGULARITY=.07
COLORS={'concrete':'#b6b3a5','paver':'#b3afa3','wood':'#958776','woodAlt':'#a39784','joint':'#807c73',
 'rail':'#343d3d','steel':'#919b9b','steelDark':'#454e4e','terracotta':'#b98774','counter':'#d4cdc0',
 'mint':'#7eaaad','green':'#71825a','pink':'#bd9291','cream':'#d0cbbd','charcoal':'#555e5f',
 'screen':'#17232a','soil':'#67685a','bark':'#66644e','leaf':'#7a865f','leafLight':'#93946b','lamp':'#e5c47a'}
SRC='UROOF_PHOTO visible form; UROOF_INFER metric size and plan position'

def main():
 d=json.loads(OUT.read_text());before=copy.deepcopy(d);lower=copy.deepcopy(d['deck'])
 d['detailMeshes']=[x for x in d.get('detailMeshes',[]) if not x['id'].startswith(PREFIX)]
 d['blocks']=[x for x in d['blocks'] if not x['id'].startswith(PREFIX)]
 d['sources']['UROOF_PHOTO']={'type':'site photograph','confidence':'high','supports':'Upper open concrete lounge, terrazzo pavers, grill hoods and tiled islands, pastel stools, green modular seating, pink rounded TV lattice, concrete garden planters, open guards and wood-look pavers. Private originals retained outside repository.'}
 d['sources']['UROOF_INFER']={'type':'inference','derivedFrom':['S2','S8','UROOF_PHOTO'],'confidence':'low','supports':'Furniture layout, planter footprints, planting species, guard height1.20m, rear core depth and all small metric dimensions. Existing roof94.38m and pavilion98.93m retained; no phone altitude used.'}
 for k,v in COLORS.items():
  key=PREFIX+k;d['colours'][key]={'hex':v,'_src':SRC};d['skins'][key]={'kind':'flat','field':key}
 # Filtered surface joints, not dense geometry lines.
 mats=d.setdefault('materials',{})
 for key,scale,width in [('paver',[.6,.6],.012),('wood',[1.2,.2],.008),('terracotta',[.12,.3],.008),('concrete',[5,.24],.006)]:
  mats[PREFIX+key]={'scale':scale,'pattern':{'version':1,'tones':[[PREFIX+key,1]],'joint':{'tone':PREFIX+'joint','width':width},'seed':13,'filter':[.30,1.1]}}
 meshes={}
 def mesh(t):
  return meshes.setdefault(t,{'id':PREFIX+t,'tone':PREFIX+t,'vertices':[],'triangles':[],'_src':SRC})
 def tri(t,pts):
  m=mesh(t);i=len(m['vertices']);m['vertices'] += [[round(c,4) for c in p] for p in pts];m['triangles'].append([i,i+1,i+2])
 def quad(t,a,b,c,e):tri(t,[a,b,c]);tri(t,[a,c,e])
 def box(t,x0,x1,y0,y1,z0,z1):
  pts=[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]]
  for a,b,c,e in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]:quad(t,pts[a],pts[b],pts[c],pts[e])
 def beam(t,a,b,r,n=6):
  v=[b[i]-a[i] for i in range(3)];length=math.sqrt(sum(q*q for q in v));v=[q/length for q in v]
  ref=[0,0,1] if abs(v[2])<.9 else [1,0,0]
  u=[v[1]*ref[2]-v[2]*ref[1],v[2]*ref[0]-v[0]*ref[2],v[0]*ref[1]-v[1]*ref[0]];norm=math.sqrt(sum(q*q for q in u));u=[q/norm for q in u]
  w=[v[1]*u[2]-v[2]*u[1],v[2]*u[0]-v[0]*u[2],v[0]*u[1]-v[1]*u[0]]
  ends=[]
  for p in [a,b]:ends.append([[p[j]+r*(u[j]*math.cos(k*math.tau/n)+w[j]*math.sin(k*math.tau/n)) for j in range(3)] for k in range(n)])
  for k in range(n):q=(k+1)%n;quad(t,ends[0][k],ends[0][q],ends[1][q],ends[1][k]);tri(t,[a,ends[0][q],ends[0][k]]);tri(t,[b,ends[1][k],ends[1][q]])
 def cylinder(t,x,y,z,r,h,n=16):beam(t,[x,y,z],[x,y,z+h],r,n)
 def leaf_cluster(t,x,y,z,phase):
  # Same branch tip and cluster count, with closed gently irregular ellipsoids.
  # The former horizontal cylinders read as stacked flat plates up close.
  rx,ry,rz=LEAF_RADII;n=LEAF_SEGMENTS;rings=LEAF_RINGS
  def pt(j,k):
   lat=-math.pi/2+math.pi*j/rings;ang=math.tau*k/n+phase
   wobble=1+LEAF_IRREGULARITY*math.sin(3*ang+phase)*math.cos(lat)
   return [x+rx*math.cos(lat)*math.cos(ang)*wobble,y+ry*math.cos(lat)*math.sin(ang)*wobble,z+.06+rz*math.sin(lat)]
  for j in range(rings):
   for k in range(n):
    a,b,c,e=pt(j,k),pt(j,k+1),pt(j+1,k+1),pt(j+1,k)
    if j==0:tri(t,[a,c,e])
    elif j==rings-1:tri(t,[a,b,c])
    else:quad(t,a,b,c,e)
 def rounded(x,y,w,h,r):
  pts=[]
  for cx,cy,start in [(x+w-r,y+h-r,0),(x+r,y+h-r,90),(x+r,y+r,180),(x+w-r,y+r,270)]:
   for a in range(start,start+91,15):pts.append([cx+r*math.cos(math.radians(a)),cy+r*math.sin(math.radians(a))])
  return pts
 def extrude(t,ring,z,h):
  c=[sum(p[0] for p in ring)/len(ring),sum(p[1] for p in ring)/len(ring),z+h]
  for i,p in enumerate(ring):
   q=ring[(i+1)%len(ring)];quad(t,[*p,z],[*q,z],[*q,z+h],[*p,z+h]);tri(t,[c,[*p,z+h],[*q,z+h]])
 def slab(id,plan,z0,z1,t):
  d['blocks'].append({'id':PREFIX+id,'plan':plan,'z0':z0,'z1':z1,'bands':[{'z0':z0,'z1':z1,'skin':PREFIX+t}],'roofTone':PREFIX+t,'_src':SRC})
 # Crown height is a guard estimate, not a new tower-height measurement.
 d['levels']['crownTop']=Z+GUARD_H
 d['levels']['_heights_src']=d['levels']['_heights_src'].split(' UROOF correction:')[0]+' UROOF correction: former2m solid upper guard superseded by site photographs. Upper roof94.38 and pavilion98.93 stay unchanged;1.20m guard is inferred, not survey.'
 for b in d['blocks']:
  if b['id'] in ['west-wing','east-wing','bar']:
   b['parapet']=.12;b['parapetTone']=PREFIX+'concrete';b['_parapet_src']='UROOF_PHOTO open metal guard, formerly modeled as2m solid wall. Low curb .12m plus separate1.20m guard inferred; concealed segments unknown.'
  if b['id']=='west-wing':
   b['roofItems']=[it for it in b.get('roofItems',[]) if it['plan'][2]<30]
  if b['id']=='pavilion':
   # Retain mechanical roof and height, remove the false solid room below it.
   b['z0']=CEILING;b['bands']=[{'z0':CEILING,'z1':b['z1'],'skin':'pavWall'}];b.pop('faces',None)
   b['_src']='UROOF_PHOTO: true open-sided concrete lounge beneath retained mechanical slab. Former storefront pretending to be a void superseded. Inherited whole-span plan and roof equipment retained; exact rear-core extent inferred.'
 # Back core is separate from genuinely open south room.
 slab('rear-core',[2.1,77.95,15.1,21.3],Z,CEILING,'concrete')
 slab('lounge-floor',[2.1,77.95,21.3,30.15],Z,Z+.06,'paver')
 slab('garden-floor',[56.3,78,31.3,53],Z,Z+.08,'wood')
 for x in [3.0+i*5.7 for i in range(14)]:box('concrete',x-.3,x+.3,28.9,29.5,Z,CEILING)
 # Lower guard has no dense picket geometry: main posts, two rails and kinked inward top.
 def guard(a,b,lowwall=False):
  length=math.dist(a,b);steps=math.ceil(length/1.3)
  if lowwall:box('concrete',min(a[0],b[0])-.1,max(a[0],b[0])+.1,min(a[1],b[1])-.1,max(a[1],b[1])+.1,Z,Z+.90)
  for h in ([1.03,GUARD_H] if lowwall else [.18,.82,GUARD_H]):beam('rail',[*a,Z+h],[*b,Z+h],.035)
  for i in range(steps+1):
   x=a[0]+(b[0]-a[0])*i/steps;y=a[1]+(b[1]-a[1])*i/steps;beam('rail',[x,y,Z+(.90 if lowwall else .10)],[x,y,Z+GUARD_H],.035)
 for x0,x1 in [(1.5,24.32),(55.73,78.55)]:
  guard([x0,1.5],[x1,1.5],True);guard([x0,53.51],[x1,53.51])
  for x in [x0,x1]:
   guard([x,1.5],[x,15.1],True);guard([x,30.15],[x,53.51])
 for y in [14.5,30.75]:guard([24.32,y],[55.73,y],True)
 # Concrete planters have rounded corners and actual hollow soil pockets.
 PLANTERS=[(57.2,32.4,8.0,2.7),(68.3,33.8,7.7,2.8),(57.5,38.4,5.8,3.2),(66.5,40,9.8,2.9),(58,46.2,6.5,3.3),(68.4,48.3,8.4,3.0)]
 for i,(x,y,w,h) in enumerate(PLANTERS):
  ring=rounded(x,y,w,h,.75);inside=rounded(x+.23,y+.23,w-.46,h-.46,.52);top=Z+1.04
  for j,p in enumerate(ring):
   k=(j+1)%len(ring);q=ring[k];ip=inside[j];iq=inside[k]
   quad('concrete',[*p,Z+.08],[*q,Z+.08],[*q,top],[*p,top]);quad('concrete',[*p,top],[*q,top],[*iq,top],[*ip,top]);quad('concrete',[*ip,top],[*iq,top],[*iq,top-.17],[*ip,top-.17])
  extrude('soil',inside,top-.18,.02)
  # Round inset path lamp, and a coarse plant group with sparse branches.
  beam('rail',[x+w*.5,y-.014,Z+.51],[x+w*.5,y-.035,Z+.51],.13,16);beam('lamp',[x+w*.5,y-.038,Z+.51],[x+w*.5,y-.045,Z+.51],.087,16)
  tx,ty=x+w*.55,y+h*.5
  for stem in range(3):
   a=[tx+(stem-1)*.19,ty,Z+.94];b=[tx+(stem-1)*.65,ty+.16*(stem-1),Z+3.1+stem*.18];beam('bark',a,b,.065)
   for j in range(5):
    ang=j*math.tau/5+stem;end=[b[0]+1.2*math.cos(ang),b[1]+1.1*math.sin(ang),Z+3.8+.3*math.sin(j*2)]
    beam('bark',[b[0],b[1],b[2]-.6],end,.024)
    for k in range(3):
     q=[end[0]+.4*math.cos(k*2+stem),end[1]+.4*math.sin(k*2+stem),end[2]+.12*k]
     beam('bark',end,q,.012);leaf_cluster('leafLight' if k%2 else 'leaf',q[0],q[1],q[2],i*.9+stem*.7+j*.4+k)
 # Garden conversation seats preserve distinct seat/back construction.
 def chair(x,y,t='mint',high=False):
  h=.77 if high else .42;w=.46 if high else .65
  for dx in [-w*.38,w*.38]:
   for dy in [-.19,.19]:beam(t,[x+dx,y+dy,Z+.08],[x+dx*.86,y+dy*.85,Z+h],.025)
  box(t,x-w/2,x+w/2,y-.23,y+.23,Z+h,Z+h+.07);box(t,x-w/2,x+w/2,y+.18,y+.24,Z+h+.07,Z+h+.40)
  if high:beam(t,[x-w*.38,y-.19,Z+.33],[x+w*.38,y-.19,Z+.33],.023)
 def sofa(x,y,w=2.2,t='green'):
  extrude(t,rounded(x,y,w,.85,.13),Z+.16,.34);box(t,x,x+w,y+.65,y+.88,Z+.45,Z+.83)
  box(t,x,x+.16,y,y+.85,Z+.47,Z+.72);box(t,x+w-.16,x+w,y,y+.85,Z+.47,Z+.72)
 for x,y in [(60,43),(72,45.4),(64,49.9)]:
  sofa(x,y,1.6,'charcoal');cylinder('terracotta',x-.65,y+.1,Z+.08,.32,.48);cylinder('counter',x-.65,y+.1,Z+.56,.40,.045)
 # Bar stations: terracotta island, counter, sink, grill and suspended hood.
 for x in [9.5,21,61,70]:
  box('terracotta',x,x+3.6,24.5,25.65,Z+.08,Z+1.04);box('counter',x-.14,x+3.74,24.35,25.8,Z+1.04,Z+1.14)
  box('steelDark',x+2.35,x+3.30,24.55,25.50,Z+1.14,Z+1.30);box('steel',x+2.35,x+3.30,25.40,25.49,Z+1.3,Z+1.63)
  box('steelDark',x+.4,x+.95,24.66,25.19,Z+1.142,Z+1.16)
  # Gooseneck tap in a small curved arch.
  pts=[[x+.7+.13*math.cos(math.radians(a)),25.15,Z+1.32+.22*math.sin(math.radians(a))] for a in range(0,181,20)]
  for a,b in zip(pts,pts[1:]):beam('steel',a,b,.016)
  box('steel',x+.1,x+3.5,24.4,25.7,Z+2.35,CEILING-.05);box('steelDark',x+.18,x+3.42,24.46,25.64,Z+2.34,Z+2.36)
  for s in [x+.5,x+1.6,x+2.7]:chair(s,23.96,'mint',True)
 # Pale green lounge clusters, pink/cream cylindrical tables and stools.
 for x in [30.5,40,50]:
  sofa(x,24.2);sofa(x+2.7,26.4,1.8);sofa(x,27.2,2.2)
  cylinder('pink',x+3.0,24.65,Z+.08,.4,.63);cylinder('cream',x+4.2,25.4,Z+.08,.33,.44)
  cylinder('terracotta',x+1.35,25.9,Z+.08,.60,.48)
  for i in range(2):cylinder('pink' if i else 'cream',x-1,25+i*.85,Z+.08,.35,.52)
 # Rounded pink TV lattice at the open south edge: actual open bars, not a filled cube.
 for x in [36.6,46.2]:
  y=29.65
  for dx in [-1.55,-1.1,-.65,-.2,.25,.7,1.15,1.55]:
   rise=math.sqrt(max(0,1-(dx/1.6)**2))*.7;box('pink',x+dx-.035,x+dx+.035,y-.1,y+.05,Z+.3,Z+2.15+rise)
  for h in [.55,.95,1.35,1.75,2.15]:box('pink',x-1.6,x+1.6,y-.1,y+.05,Z+h,Z+h+.06)
  arc=[[x+1.6*math.cos(i*math.pi/16),y-.025,Z+2.15+.7*math.sin(i*math.pi/16)] for i in range(17)]
  for a,b in zip(arc,arc[1:]):beam('pink',a,b,.055)
  box('rail',x-1.05,x+1.05,y-.18,y-.11,Z+1.12,Z+2.25);box('screen',x-.98,x+.98,y-.192,y-.181,Z+1.19,Z+2.18)
 # Open-room overhead fixtures; coarse three-blade fans and continuous services.
 for x in [6+i*5.7 for i in range(13)]:
  cylinder('rail',x,26,CEILING-.50,.07,.50,8)
  for k in range(3):
   a=k*math.tau/3;tip=[x+1.0*math.cos(a),26+1.0*math.sin(a),CEILING-.48];beam('rail',[x,26,CEILING-.48],tip,.065,4)
  cylinder('rail',x,22.4,CEILING-.28,.09,.28,8)
 beam('cream',[2.4,27.8,CEILING-.17],[77.5,27.8,CEILING-.17],.035)
 # Reuse identical vertices within each material to keep the detailed roof compact.
 for m in meshes.values():
  vertices=[];lookup={};remap=[]
  for p in m['vertices']:
   key=tuple(p)
   if key not in lookup:lookup[key]=len(vertices);vertices.append(p)
   remap.append(lookup[key])
  m['vertices']=vertices;m['triangles']=[[remap[i] for i in t] for t in m['triangles']]
 d['detailMeshes']+=list(meshes.values())
 note='Upper roof photo pass: observed lounge/garden forms replace solid-room and rectangular planter placeholders. Furniture coordinates,1.20m guard and rear-core depth inferred; pool shape and north equipment retained provisionally from older evidence.'
 d['open']=[s for s in d.get('open',[]) if not (isinstance(s,str) and s.startswith('Upper roof photo pass:'))]+[note]
 d['_upperRoofAudit']={'floor':Z,'guardHeightInferred':GUARD_H,'pavilionTopRetained':98.93,'photoObserved':['open lounge','grill islands and hoods','green sofas and pastel stools','rounded TV lattice','rounded concrete planters','wood-look pavers','open guard'], 'inferred':['layout coordinates','small dimensions','plant species','hidden rear core'], 'pool':'Inherited provisional older-source geometry retained; not observed in reference views','_src':'UROOF_PHOTO; UROOF_INFER'}
 assert d['deck']==lower
 for key in ['footprint','frame','_frame_src','_massing_src','_podiumTopology']:assert d[key]==before[key],key
 for bid in ['podium','podium-ground']:
  assert next(b for b in d['blocks'] if b['id']==bid)==next(b for b in before['blocks'] if b['id']==bid)
 for bid in ['east-wing','west-wing','bar']:
  a=next(b for b in before['blocks'] if b['id']==bid);b=next(b for b in d['blocks'] if b['id']==bid)
  for k in ['plan','z0','z1','bands','faces','overrides']:
   assert a.get(k)==b.get(k),(bid,k)
 for m in meshes.values():
  assert m['vertices'] and all(all(math.isfinite(q) for q in p) for p in m['vertices'])
  assert all(0<=i<len(m['vertices']) for t in m['triangles'] for i in t)
  assert all(Z-.001<=p[2]<=98.94 for p in m['vertices']),m['id']
 assert len({b['id'] for b in d['blocks']})==len(d['blocks'])
 deduplicate_detail_meshes(d)
 OUT.write_text(json.dumps(d,separators=(',',':'),ensure_ascii=False))
 print(json.dumps({'bytes':OUT.stat().st_size,'addedMeshGroups':len(meshes),'addedTriangles':sum(len(m['triangles']) for m in meshes.values()),'lowerDeckPreserved':True,'facadesPreserved':True}))
if __name__=='__main__':main()
