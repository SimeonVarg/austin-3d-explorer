#!/usr/bin/env python3
"""26 West parking garage: one separate map polygon, one owned output."""
import json,math,hashlib
from pathlib import Path
from detail_mesh_dedup import deduplicate_detail_meshes
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'data/apartments/26-west-garage.json'
ID='23994eaf-1258-43d1-9648-fdff8c14acc1'
F={'o':[-97.7437997,30.2915092],'mx':96121.51471923945,'my':110540,'ax':.9968762472249457,'ay':-.07897941325882837,'L':82.29678763074139,'W':55.95720969503772}
L,W=82.30,55.96;ROOF=19.70
COLORS={'concrete':'#bbb6ac','deck':'#b3aea1','void':'#282c2d','line':'#d9d2b9','fence':'#495152','court':'#738786','key':'#8e7e72','garden':'#9f9676','walk':'#c5b19b','rim':'#cfcbc0','leaf':'#657253','carWhite':'#c8cac5','carGray':'#697473','carRed':'#754b46','glass':'#364448','tire':'#292d2c'}
M={}
def poly(t,ps):
 m=M.setdefault(t,{'id':'26w-garage-'+t,'tone':t,'vertices':[],'triangles':[],'_src':'PHOTO/ORTHO visible feature family; exact layout metres inferred except SCAN deck/cage heights.'});n=len(m['vertices']);m['vertices'] += [[round(x,4) for x in p] for p in ps];m['triangles'] += [[n,n+i,n+i+1] for i in range(1,len(ps)-1)]
def box(t,a,b,c,d,z,h):
 vs=[(a,c,z),(b,c,z),(b,d,z),(a,d,z),(a,c,z+h),(b,c,z+h),(b,d,z+h),(a,d,z+h)]
 for q in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]:poly(t,[vs[i] for i in q])
def line(t,p,q,w):
 d=[q[i]-p[i] for i in range(3)];le=math.sqrt(sum(x*x for x in d));a=[-d[1],d[0],0] if abs(d[0])+abs(d[1])>.001 else [1,0,0];n=math.sqrt(sum(x*x for x in a));a=[x/n*w/2 for x in a];b=[(d[1]*a[2]-d[2]*a[1])/le,(d[2]*a[0]-d[0]*a[2])/le,(d[0]*a[1]-d[1]*a[0])/le];vs=[[p[k]+sa*a[k]+sb*b[k] for k in range(3)] for sa,sb in [(-1,-1),(1,-1),(1,1),(-1,1)]];vs += [[vs[i][k]+d[k] for k in range(3)] for i in range(4)]
 for ids in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]:poly(t,[vs[i] for i in ids])
def plane(t,a,b,c,d,z):poly(t,[(a,c,z),(b,c,z),(b,d,z),(a,d,z)])
def car(u,v,t):
 box(t,u-.84,u+.84,v-2.05,v+2.05,ROOF+.08,.62)
 # Sloped windshield/roof profile; distinct wheels, not monolithic cubes.
 ys=[(-1.25,.62),(-.65,1.18),(.65,1.18),(1.20,.62)]
 for i in range(3):a,h=ys[i];b,hh=ys[i+1];poly('glass' if i!=1 else t,[(u-.75,v+a,ROOF+.08+h),(u+.75,v+a,ROOF+.08+h),(u+.75,v+b,ROOF+.08+hh),(u-.75,v+b,ROOF+.08+hh)])
 for x in [-.78,.78]:
  for y in [-1.25,1.25]:box('tire',u+x-.10,u+x+.10,v+y-.3,v+y+.3,ROOF+.04,.4)
def build():
 feature=next(f for f in json.loads((ROOT/'data/snapshots/2026-08-27/buildings.detailed.geojson').read_text())['features'] if f['properties']['id']==ID)
 d={'id':ID,'name':'26 West Garage','address':'26 West complex, 600 W 26th Street, Austin, TX','footprint':{'ring':feature['geometry']['coordinates'][0],'_src':'MAP exact existing separate garage polygon, OSM187381182 member of26West relation2635670.'},'frame':{'obb':F},'sources':{
 'MAP':{'type':'map','source':'Existing snapshot2026-08-27 building id and OSM relation2635670/way187381182','supports':'Independent garage footprint and identity; does not occupy residentialL'},
 'PHOTO':{'type':'site photograph','confidence':'high','supports':'Visible open parking decks, roof parked cars/striping, tall arched basketball cage, low garden and stairheads; private join separate'},
 'ORTHO':{'type':'online image','source':'Existing26West reference pack aerial topdown, original capture/date not independently confirmed','confidence':'medium','supports':'Parking rows, court southwest, winding garden southeast; layout prior corroborated by site photographs'},
 'SCAN':{'type':'survey/LiDAR','source':'TxGIO2021 0.5m building-class height-above-ground raster','date':'2021','confidence':'high','supports':'North parking inset1855cells p10/50/90=19.63/19.69/19.78m; cage sampled769cells median25.30m; garden1158cells median20.14m'},
 'INFER':{'type':'inference','confidence':'low','supports':'Concealed parking levels, column rhythm, individual parked cars/stripe count, ramp and garden microgeometry. Not a surveyed inventory'}},
 'levels':{'floors':[0,3.28,6.56,9.84,13.12,16.40],'roof':ROOF,'_src':'SCAN roof19.7m. Six deck levels inferred from overallheight/open structural rhythm; only upper bays clearly visible.'},
 'colours':{k:{'hex':v,'_src':'PHOTO visible material families; albedo inferred.'} for k,v in COLORS.items()},'skins':{'concrete':{'kind':'flat','field':'concrete'}},'blocks':[],
 '_open':['Individual parking-space/car counts approximate; layout is not an operating parking map.','Roof middle ramp surface falls below flat north deck in scan; lower lane represented as a sloped inset surface but concealed structure remains simplified.','Basketball cage is open rails/arches; fine chain-link omitted to avoid an invented dense moire grid.','No claim that source-camera fit or 2021 small objects equal current conditions.']}
 for z in [0,3.28,6.56,9.84,13.12,16.40]:box('concrete',0,L,0,W,z,.30)
 # Visible void behind structural piers; darkness is inside garage, not glass windows.
 for z in [3.28,6.56,9.84,13.12]:
  box('void',2,L-2,2,W-2,z+.30,2.65)
 for u in [i*L/10 for i in range(11)]:
  for v in [.15,W-.15]:box('concrete',u-.20,u+.20,v-.25,v+.25,.3,ROOF-.3)
 for v in [i*W/7 for i in range(1,7)]:
  for u in [.15,L-.15]:box('concrete',u-.25,u+.25,v-.20,v+.20,.3,ROOF-.3)
 # Roof plate and low opaque edge parapet.
 for a,b,c,e in [(0,L,0,26),(0,L,29,W),(0,7,26,29),(77,L,26,29)]:box('deck',a,b,c,e,ROOF-.30,.30)
 for a,b,c,e in [(0,L,0,.22),(0,L,W-.22,W),(0,.22,0,W),(L-.22,L,0,W)]:box('concrete',a,b,c,e,ROOF,1.03)
 # Parking stripes: four long rows with access aisles between.
 for c,e in [(20,25),(30,35),(36,41),(50,55)]:
  for i in range(25):u=11+i*2.73;box('line',u,u+.10,c,e,ROOF+.012,.008)
 for v in [22+i*2.8 for i in range(12)]:box('line',.7,6,v,v+.10,ROOF+.012,.008)
 for i in range(26):
  row=i%4;u=13+((i*7)%23)*2.73;v=[22.5,32.5,38.5,52.5][row];car(u,v,['carWhite','carGray','carGray','carRed'][i%4])
 # Lower/ascending central ramp evidenced by intermediate HAG elevations.
 poly('deck',[(7,26,ROOF),(77,26,ROOF),(77,29,16.9),(7,29,16.9)])
 # Southwest basketball court and cage.
 plane('court',15,35,1.5,18.0,ROOF+.045)
 for a,b in [(16,20),(30,34)]:plane('key',a,b,6,13.5,ROOF+.055)
 zz=ROOF+.066
 for p,q in [((16,2.4),(34,2.4)),((16,17.1),(34,17.1)),((16,2.4),(16,17.1)),((34,2.4),(34,17.1)),((25,2.4),(25,17.1))]:line('line',(*p,zz),(*q,zz),.11)
 for i in range(40):
  a=i*math.pi/20;b=(i+1)*math.pi/20;line('line',(25+1.8*math.cos(a),9.75+1.8*math.sin(a),zz),(25+1.8*math.cos(b),9.75+1.8*math.sin(b),zz),.10)
 for u in [15,20,25,30,35]:
  for v in [1.5,18]:line('fence',(u,v,ROOF),(u,v,ROOF+4.45),.10)
  pts=[(u,1.5+16.5*i/12,ROOF+4.45+1.15*math.sin(math.pi*i/12)) for i in range(13)]
  for a,b in zip(pts,pts[1:]):line('fence',a,b,.075)
 for v in [1.5,18]:
  for h in [1.5,3.0,4.45]:line('fence',(15,v,ROOF+h),(35,v,ROOF+h),.065)
 for u in [15,35]:
  for h in [1.5,3,4.45]:line('fence',(u,1.5,ROOF+h),(u,18,ROOF+h),.065)
 for u,sgn in [(16.3,1),(33.7,-1)]:
  line('fence',(u,9.75,ROOF),(u,9.75,ROOF+3.4),.10);box('rim',u-.04,u+.04,9.0,10.5,ROOF+3,.85)
  for i in range(16):a=i*math.pi/8;b=(i+1)*math.pi/8;line('fence',(u+sgn*.45+.22*math.cos(a),9.75+.22*math.sin(a),ROOF+3.03),(u+sgn*.45+.22*math.cos(b),9.75+.22*math.sin(b),ROOF+3.03),.035)
 # Southeast roof garden: broad winding walk and low shrub islands.
 plane('garden',37,79,1.5,18,ROOF+.40)
 path=[(39+38*i/35,9.2+4.0*math.sin(i/35*math.pi*2-.5),ROOF+.43) for i in range(36)]
 for a,b in zip(path,path[1:]):
  dx=b[0]-a[0];dy=b[1]-a[1];le=math.hypot(dx,dy);nx=-dy/le*.85;ny=dx/le*.85;poly('walk',[(a[0]+nx,a[1]+ny,a[2]),(b[0]+nx,b[1]+ny,b[2]),(b[0]-nx,b[1]-ny,b[2]),(a[0]-nx,a[1]-ny,a[2])])
 for u,v in [(40,3),(45,15),(52,3),(59,15),(66,3),(73,15),(77,4)]:box('leaf',u,u+1.2,v,v+1.0,ROOF+.4,.45)
 # Two source-visible stair/utility heads, separated from cage.
 for name,plan,top in [('west-head',[.3,5.5,.3,7],23.7),('east-head',[77.6,81.7,49,55.5],22.2)]:d['blocks'].append({'id':name,'plan':plan,'z0':0,'z1':top,'bands':[{'z0':0,'z1':top,'skin':'concrete'}],'roofTone':'concrete','_src':'PHOTO/ORTHO stairhead location; topheight inferred from source silhouette.'})
 d['detailMeshes']=list(M.values());d['_counts']={'parkingRowSpaces':96,'westSideSpaces':11,'parkedVehicles':26,'basketballCourt':1,'cageArchRibs':5,'_src':'Parking and cars are inferred approximate counts; court identity observed.'}
 for m in M.values():
  assert all(all(math.isfinite(x) for x in p) and -.5<=p[0]<=L+.5 and -.5<=p[1]<=W+.5 and 0<=p[2]<=25.7 for p in m['vertices'])
 deduplicate_detail_meshes(d)
 text=json.dumps(d,separators=(',',':'));OUT.write_text(text);print(OUT.name,len(text),sum(len(m['triangles']) for m in M.values()),hashlib.sha256(text.encode()).hexdigest())
if __name__=='__main__':build()
