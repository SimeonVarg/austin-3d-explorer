#!/usr/bin/env python3
"""26 West Rio Grande bar, independent mapped residential polygon."""
import json,math,hashlib
from pathlib import Path
from detail_mesh_dedup import deduplicate_detail_meshes
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'data/apartments/26-west-rio-grande.json';ID='529724dc-ce98-4052-a23c-ca3c8e776217'
F={'o':[-97.744052,30.2909725],'mx':96122.04068015402,'my':110540,'ax':.09522540369076615,'ay':.995455736078672,'L':126.47981767244607,'W':21.134970217399758}
L,W=126.48,21.135;ROOF=17.0;FLOORS=[0,4.4,7.55,10.70,13.85]
COLORS={'cream':'#d8d6c9','terra':'#b28260','blue':'#8a9da6','brick':'#847467','brickJoint':'#75695e','stone':'#c3bbaa','trim':'#dadbd3','glass':'#4d6267','frame':'#c5ccc8','dark':'#3a4445','roof':'#c5c5ba','cap':'#737d7d','plant':'#787f7c','fan':'#3d4848','rail':'#6d7979'}
# Long elevation material fields are explicit; no random pixel-color grid.
FIELDS=[(0,17.8,'blue'),(17.8,34.6,'cream'),(34.6,50.8,'terra'),(50.8,68.4,'blue'),(68.4,84.4,'cream'),(84.4,101.8,'terra'),(101.8,126.48,'blue')]
M={}
def poly(t,ps):
 m=M.setdefault(t,{'id':'26w-rio-'+t,'tone':t,'vertices':[],'triangles':[],'_src':'PHOTO visible rooftop/elevation family; exact repeated detail counts and positions inferred.'});n=len(m['vertices']);m['vertices'] += [[round(x,4) for x in p] for p in ps];m['triangles'] += [[n,n+i,n+i+1] for i in range(1,len(ps)-1)]
def box(t,a,b,c,d,z,h):
 vs=[(a,c,z),(b,c,z),(b,d,z),(a,d,z),(a,c,z+h),(b,c,z+h),(b,d,z+h),(a,d,z+h)]
 for ids in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]:poly(t,[vs[i] for i in ids])
def opening(c,w,z):return {'s0':round(c-w/2,4),'s1':round(c+w/2,4),'z0':z+.65,'z1':z+2.46,'d':.16,'glass':'glass','tone':'frame','mullion':{'cols':[.5],'rows':[.32],'w':.06,'tone':'frame'}}
def bands(length,skin,balcony=False):
 cols=[(length*f,1.5 if i%2 else 2.35) for i,f in enumerate([.13,.36,.64,.87])]
 base={'z0':0,'z1':7.55,'skin':'brick','openings':[opening(c,w,z) for z in FLOORS[:2] for c,w in cols]}
 upper={'z0':7.55,'z1':16.56,'skin':skin,'openings':[opening(c,w,z) for z in FLOORS[2:] for c,w in cols]}
 if balcony:
  upper['balconies']=[{'s0':length*.36-1.3,'s1':length*.36+1.3,'inset':.30,'insetTone':skin,'railTone':'rail','lift':0}]
  upper['floors']=FLOORS[2:]
 return [base,upper,{'z0':16.56,'z1':ROOF,'skin':'trim'}]
def build():
 f=next(f for f in json.loads((ROOT/'data/snapshots/2026-08-27/buildings.detailed.geojson').read_text())['features'] if f['properties']['id']==ID)
 d={'id':ID,'name':'26 West Rio Grande Bar','address':'26 West complex, Rio Grande Street frontage, Austin, TX','footprint':{'ring':f['geometry']['coordinates'][0],'_src':'MAP verbatim separate western residential bar, not courtyard or perimeterL.'},'frame':{'obb':F},'sources':{
 'MAP':{'type':'map','source':'Existing snapshot2026-08-27 id529724dc-ce98-4052-a23c-ca3c8e776217, OSM way187381195 member of26West relation2635670','confidence':'high','supports':'126.48m ×21.13m western residential bar and identity'},
 'PHOTO':{'type':'site photograph','confidence':'high','supports':'Five storeys, two-storey brick base, three upper cream/terracotta/blue rows, white cornice, rooftop condenser banks and mid-street hipped accent; private evidence joins separate'},
 'PUBLIC':{'type':'online photo','source':'Existing26West reference pack street/west-wing views, including americancampus.com/student-apartments/tx/austin/26-west; original third-party view dates uncertain','confidence':'medium','supports':'Paired/single white-framed windows, shallow inset balcony stacks, white arch motif and brick/stone material family'},
 'SCAN':{'type':'survey/LiDAR','source':'TxGIO2021 0.5m building-class HAG raster, three inset roof strips','date':'2021','confidence':'high','supports':'South/middle/north membrane medians17.109/17.000/16.875m; sample counts1445/2162/1397; excludes edge/trees'},
 'INFER':{'type':'inference','confidence':'low','supports':'Five floor pitches closing at17m, long-wall material-boundary positions, exact window columns, occluded courtyard elevations, condenser count and individual metre locations'}},
 'levels':{'floors':FLOORS,'roof':ROOF,'_src':'SCAN roof17m; five floors PHOTO/snapshot. Individual pitch split inferred.'},
 'colours':{k:{'hex':v,'_src':'PHOTO material appearance, inferred albedo; daylight differs from archival imagery.'} for k,v in COLORS.items()},
 'skins':{k:{'kind':'flat','field':k} for k in COLORS},'materials':{'brick':{'scale':[.65,.28],'pattern':{'version':1,'tones':[['brick',1]],'joint':{'width':.014,'tone':'brickJoint'},'phase':[0,0],'axis':[1,0],'seed':31,'filter':[1,3]},'_src':'PUBLIC masonry family; inferred module dimensions with existing derivative filtering.'}},
 'balcony':{'proj':.35,'slabT':.15,'railH':1.0,'railT':.04},'blocks':[],
 '_open':['Long west wall is partly obscured by trees; exact opening/color-boundary counts remain inferred. No claim that every face is photo-built.','Rooftop equipment banks are observed;88 authored condensers are an approximate arrangement, not a surveyed count.','North/south end treatment and inward-facing elevation are conservative family matches, not directly verified every window.','Source five-floor roof height differs from older15.8m recipes for other26West polygons; this independentbar uses its own17m scan measurement.']}
 b={'id':'rio-grande-bar','plan':[0,L,0,W],'z0':0,'z1':ROOF,'bands':bands(L,'cream'),'roofTone':'roof','parapet':.63,'parapetTone':'trim','faces':{},'overrides':[], '_src':'MAP independent footprint; SCAN17m main membrane; PHOTO/PUBLIC facade family. Exact repeated layout inferred.'}
 for a,e,t in FIELDS:
  for v in [0,W]:b['overrides'].append({'region':[a,e,v-.01,v+.01],'bands':bands(e-a,t,balcony=t=='blue')})
 for face in ['u0','u1']:b['faces'][face]={'bands':bands(W,'cream')}
 d['blocks'].append(b)
 # Cornice has two broad ledges and a modest dentil rhythm, not continuous micro-relief.
 for v in [-.10,W-.02]:
  box('trim',0,L,v,v+.12,16.25,.11);box('trim',0,L,v-.10,v+.22,16.62,.16)
  for i in range(90):u=.8+i*1.4;box('trim',u,u+.19,v-.10,v+.10,16.48,.13)
 # One prominent west-face cap is independently visible in the overhead.
 d['blocks'].append({'id':'mid-west-hip-accent','plan':[70.5,75.0,W-.15,W+.75],'z0':0,'z1':17.0,
  'bands':bands(4.5,'terra'),'roofTone':'roof','roofItems':[{'id':'hip','plan':[69.9,75.6,W-4.7,W+1.0],'h':.08,'tone':'cap','roof':{'type':'hip','pitch':38}}],
  '_src':'PHOTO/ORTHO single prominent hipped west accent near middle; extent and cap pitch inferred, no repeated every-bay turret rule.'})
 # Roof bank rows follow long axis. Sixteen-metre clear runs remain around each group.
 for j in range(11):
  u=5.0+j*11.1
  for r in range(2):
   for c in range(4):
    x=u+c*1.08;y=6.0+r*1.12;box('plant',x,x+.78,y,y+.82,ROOF+.04,.86)
    n=12;poly('fan',[(x+.39+.27*math.cos(i*2*math.pi/n),y+.41+.27*math.sin(i*2*math.pi/n),ROOF+.904) for i in range(n)])
 # Broad hatch/duct boxes visible among plant clusters, with deliberately few repeats.
 for u in [19,53,91,119]:box('trim',u,u+2.5,14,16,ROOF+.04,.36)
 # White arch above the orange accent, a curved trim strip rather than a painted rectangle.
 for i in range(20):
  a=i*math.pi/20;e=(i+1)*math.pi/20;c=72.75;r=1.0;v=W+.761
  poly('trim',[(c+r*math.cos(a),v,15.48+r*math.sin(a)),(c+r*math.cos(e),v,15.48+r*math.sin(e)),(c+(r+.12)*math.cos(e),v,15.48+(r+.12)*math.sin(e)),(c+(r+.12)*math.cos(a),v,15.48+(r+.12)*math.sin(a))])
 d['detailMeshes']=list(M.values());d['_counts']={'floors':5,'masonryRows':2,'upperStuccoRows':3,'longFaceMaterialFields':7,'roofCondenserUnits':88,'prominentWestHip':1,'_src':'Floor rows/hipfamily observed. Longface field positions/windows/equipment counts approximate.'}
 for m in M.values():assert all(all(math.isfinite(x) for x in p) and -.5<=p[0]<=L+.5 and -.5<=p[1]<=W+1.1 and 0<=p[2]<21 for p in m['vertices'])
 deduplicate_detail_meshes(d)
 text=json.dumps(d,separators=(',',':'));OUT.write_text(text);print(OUT.name,len(text),sum(len(m['triangles']) for m in M.values()),hashlib.sha256(text.encode()).hexdigest())
if __name__=='__main__':build()
