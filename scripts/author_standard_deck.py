#!/usr/bin/env python3
"""Replace only The Standard's amenity-deck placeholders with observed geometry.
The tower and unrelated roof plant are untouched. Version history retains the superseded layout; repeat runs are deterministic.
"""
import copy
import json
import math
from pathlib import Path
from detail_mesh_dedup import deduplicate_detail_meshes

ROOT=Path(__file__).resolve().parents[1]
PATH=ROOT/'data/apartments/the-standard.json'
Z=21.5
PREFIX='owner-deck-'
# Existing map-frame dimensions are the starting scale. Item dimensions
# and precise placement are inferred from the overhead and eye-level reference views.
POOL=(63,90,1.2,5.2)
SPAS=[(60.3,62.8,1.25,4.55),(90.4,93.4,1.2,4.4)]
PAD=(81.5,88.8,4.0,6.4)
SCREEN={"plan":[75.05,76.85,10.84,10.99],"z0":1.35,"h":1.55}
PALM_ISLAND=(74.4,82.7,.6,2.9)
PALMS=[(75.2,1.9),(81.9,1.9)]
PERGOLA=(57.8,63.0,6.3,10.8)
PALETTE={'paver':'#c6c6b9','paverAlt':'#adb4b3','paverJoint':'#929a99',
 'coping':'#d0d0c0','water':'#409baa','lane':'#2d70a1','tile':'#497284',
 'tileLight':'#5d8995','tileDark':'#345968','metal':'#637b84',
 'frame':'#d2d1ba','cushion':'#7c9b92','sling':'#759389','table':'#c7c8b5',
 'grill':'#9aa7a6','grillInside':'#202b2e','turf':'#668844','soil':'#646356',
 'lime':'#91b943','palm':'#527e45','palmLight':'#6c914f','trunk':'#8c8065',
 'rope':'#c8cfbf','rail':'#323d42','bulb':'#cac5a6'}


def main():
 d=json.loads(PATH.read_text()); blocks=copy.deepcopy(d['blocks'])
 d.pop('_deckBeforeOwnerPass',None)  # Superseded geometry belongs in version history.
 for b in d['blocks']:
  if b['id']=='podium':b['roofItems']=[x for x in b.get('roofItems',[]) if x.get('id') not in ('loungers','turfChairs','deckCondensers')]
 d['sources']['PHOTO_DECK']={'type':'site photograph','confidence':'high',
   'supports':'Pool-deck furniture counts, east grill pergola, two raised spas, three hammocks, pool island palms, paver/turf zones. Private source joins retained separately.'}
 d['sources']['PHOTO_DECK_INFER']={'type':'inference','derivedFrom':['PHOTO_DECK'],'confidence':'medium',
   'supports':'Precise furniture dimensions, spacing, hidden side geometry and subtle material albedos. Deck elevation21.5m retained, not re-surveyed.'}
 for k,v in PALETTE.items():d['colours'][PREFIX+k]={'hex':v,'_src':'PHOTO_DECK visible material family; albedo inferred'}
 meshes={}
 def mesh(t):
  if t not in meshes:meshes[t]={'id':PREFIX+t,'tone':PREFIX+t,'vertices':[],'triangles':[], '_src':'PHOTO_DECK appearance; geometry sizes inferred in retained metric frame'}
  return meshes[t]
 def quad(t,p):
  m=mesh(t);i=len(m['vertices']);m['vertices'] += [[round(x,4),round(y,4),round(z+Z,4)] for x,y,z in p];m['triangles'] += [[i,i+1,i+2],[i,i+2,i+3]]
 def triangle(t,p):
  m=mesh(t);i=len(m['vertices']);m['vertices'] += [[round(x,4),round(y,4),round(z+Z,4)] for x,y,z in p];m['triangles'].append([i,i+1,i+2])
 def box(t,r,a,b):
  x0,x1,y0,y1=r
  quad(t,[(x0,y0,b),(x1,y0,b),(x1,y1,b),(x0,y1,b)])
  for p,q in [((x0,y0),(x1,y0)),((x1,y0),(x1,y1)),((x1,y1),(x0,y1)),((x0,y1),(x0,y0))]:quad(t,[(p[0],p[1],a),(q[0],q[1],a),(q[0],q[1],b),(p[0],p[1],b)])
 def tube(t,p,q,r=.035,n=6):
  vec=[q[i]-p[i] for i in range(3)];length=math.sqrt(sum(v*v for v in vec));axis=[v/length for v in vec]
  cross=lambda a,b:[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
  side=cross(axis,[0,0,1] if abs(axis[2])<.9 else [0,1,0]);norm=math.sqrt(sum(v*v for v in side));side=[v/norm for v in side];up=cross(axis,side)
  at=lambda c,a:[c[i]+r*(side[i]*math.cos(a)+up[i]*math.sin(a)) for i in range(3)]
  for j in range(n):quad(t,[at(p,2*math.pi*j/n),at(p,2*math.pi*(j+1)/n),at(q,2*math.pi*(j+1)/n),at(q,2*math.pi*j/n)])
 def rim(t,r,w,a,b):
  x0,x1,y0,y1=r
  for rr in [(x0,x1,y0,y0+w),(x0,x1,y1-w,y1),(x0,x0+w,y0+w,y1-w),(x1-w,x1,y0+w,y1-w)]:box(t,rr,a,b)
 def flat(t,r,z):x0,x1,y0,y1=r;quad(t,[(x0,y0,z),(x1,y0,z),(x1,y1,z),(x0,y1,z)])
 def inrect(x,y,r):return r[0]<=x<=r[1] and r[2]<=y<=r[3]
 # Pavers are full size, with thin joints; split at water edges to keep the
 # basin visible below the raised paving. No roof or tower cap is removed.
 cutsX=sorted(set([57.5,94.5]+[57.5+i*1.2 for i in range(32) if 57.5+i*1.2<94.5]+[r[i] for r in [POOL,PAD]+SPAS for i in [0,1]]))
 cutsY=sorted(set([.2,11.0]+[.2+i*1.2 for i in range(10) if .2+i*1.2<11]+[r[i] for r in [POOL,PAD]+SPAS for i in [2,3]]))
 for i in range(len(cutsX)-1):
  for j in range(len(cutsY)-1):
   a,b=cutsX[i:i+2];c,e=cutsY[j:j+2];x,y=(a+b)/2,(c+e)/2
   wet=inrect(x,y,POOL) and not inrect(x,y,PAD)
   if wet or any(inrect(x,y,r) for r in SPAS):continue
   if b-a>.03 and e-c>.03:flat('paverAlt' if (i+3*j)%11 in [0,1] else 'paver',(a+.012,b-.012,c+.012,e-.012),.16)
 # Main water and central deck peninsula, plus the single blue lane visible
 # through it. Surface optics remain the existing renderer's approximation.
 for r in [(63,90,1.2,4),(63,81.5,4,5.2),(88.8,90,4,5.2)]:flat('water',r,.06)
 flat('lane',(63.1,89.9,2.7,3.12),.065)
 rim('coping',POOL,.18,.075,.20)
 box('paver',PAD,.075,.16)
 # Raised hot tubs: outer shell, open inset basin, water below the coping.
 for r in SPAS:
  rim('tile',r,.34,.10,.74);x0,x1,y0,y1=r;flat('water',(x0+.34,x1-.34,y0+.34,y1-.34),.59)
  # Tone patches carry the blue mosaic's variation without tiny aliased joints.
  for i in range(12):
   a=x0+(x1-x0)*i/12;b=x0+(x1-x0)*(i+1)/12
   for j in range(3):
    lo=.12+j*.19;hi=lo+.18
    quad('tileLight' if (i+j)%3==0 else 'tileDark',[(a,y0-.006,lo),(b,y0-.006,lo),(b,y0-.006,hi),(a,y0-.006,hi)])
 # Patches and island positions established by the overhead site photograph.
 flat('turf',(63,75,6.2,10.95),.19);flat('turf',(86,94,6.7,10.7),.19)
 box('paver',PALM_ISLAND,.06,.18)
 for x,y in PALMS:
  box('coping',(x-.75,x+.75,.6,3),.05,.42);flat('soil',(x-.58,x+.58,.78,2.82),.44)
  tube('trunk',(x,y,.44),(x+.1,y,3.55),.12,9)
  # Long arching fronds with separate leaflets, rather than the old green cube.
  for f in range(10):
   a=f*math.tau/10;dx,dy=math.cos(a),math.sin(a);last=(x+.1,y,3.55)
   for k in range(1,6):
    t=k/5;cur=(x+.1+dx*1.65*t,y+dy*1.65*t,3.55+.55*math.sin(math.pi*t)-.55*t)
    tube('palm',last,cur,.016,4)
    span=.38*(1-t)+.04
    for side in [-1,1]:
     tip=(cur[0]-dy*span*side-dx*.18,cur[1]+dx*span*side-dy*.18,cur[2]-.18)
     triangle('palmLight' if f%3==0 else 'palm',[last,cur,tip])
    last=cur
 # Actual furniture has air under seats, tilted backs, legs and open armrests.
 def seat(x,y,w=.64,length=.58,back=.48,chaise=False,angle=0):
  co,si=math.cos(angle),math.sin(angle)
  pt=lambda a,b,c:(x+a*co-b*si,y+a*si+b*co,c)
  # local long direction +y, head at +y
  z=.53
  quad('sling' if chaise else 'cushion',[pt(-w/2,-length/2,z),pt(w/2,-length/2,z),pt(w/2,length*.22,z),pt(-w/2,length*.22,z)])
  quad('sling' if chaise else 'cushion',[pt(-w/2,length*.22,z),pt(w/2,length*.22,z),pt(w/2,length/2,z+back),pt(-w/2,length/2,z+back)])
  for s in [-1,1]:
   tube('frame',pt(s*w/2,-length/2,z),pt(s*w/2,length/2,z+back),.028)
   for b in [-length*.38,length*.25]:tube('frame',pt(s*w*.45,b,.18),pt(s*w*.45,b,z),.027)
   if not chaise:
    tube('frame',pt(s*w/2,-.23,.73),pt(s*w/2,.28,.73),.026)
    tube('frame',pt(s*w/2,-.23,.53),pt(s*w/2,-.23,.73),.023)
  tube('frame',pt(-w/2,length/2,z+back),pt(w/2,length/2,z+back),.027)
 def table(x,y,w=1.4,l=.82,h=.84):
  for i in range(8):box('table',(x-w/2+i*w/8+.012,x-w/2+(i+1)*w/8-.012,y-l/2,y+l/2),h,h+.055)
  for a in [-w*.4,w*.4]:
   for b in [-l*.36,l*.36]:tube('frame',(x+a,y+b,.18),(x+a,y+b,h),.035)
 for x in [83,84.6,86.2,87.8]:seat(x,5.13,.65,1.8,.55,True)
 for x in [87,88.4,89.8,91.2,92.6]:seat(x,8.7,.65,1.8,.55,True)
 for x in [65,69,73]:seat(x,6.95,1.9,.78,.53);table(x+1.3,6.85,.55,.55,.59)
 for y in [6.8,8.5,10.2]:
  table(78,y,1.55,.8)
  for x in [77.5,78.5]:seat(x,y-.78,angle=math.pi);seat(x,y+.78)
  seat(76.7,y,angle=-math.pi/2);seat(79.3,y,angle=math.pi/2)
 # Three sagging rope hammocks. Coarse open weave is enough at this scale;
 # no texture is substituted for missing posts or the curve.
 for x in [65,68.3,71.6]:
  for y in [7.8,10.3]:tube('metal',(x,y,.18),(x,y,1.55),.055,8)
  for strand in range(7):
   off=(strand-3)*.08;last=None
   for j in range(13):
    t=j/12;p=(x+off*math.sin(math.pi*t),7.8+2.5*t,1.45-.75*math.sin(math.pi*t))
    if last:tube('rope',last,p,.014,4)
    last=p
  for j in range(2,11):
   t=j/12;w=.24*math.sin(math.pi*t);z=1.45-.75*math.sin(math.pi*t)
   tube('rope',(x-w,7.8+2.5*t,z),(x+w,7.8+2.5*t,z),.012,4)
 # The grill shade is at the east end, not the old arbitrary west cabana.
 a,b,c,e=PERGOLA
 for x in [a+.13,b-.13]:
  for y in [c+.13,e-.13]:box('metal',(x-.09,x+.09,y-.09,y+.09),.16,2.85)
 for y in [c+.12,e-.12]:box('metal',(a-.12,b+.12,y-.09,y+.09),2.72,2.92)
 for i in range(20):
  x=a+i*(b-a)/19;tube('metal',(x,c-.16,2.92),(x,e+.16,2.92),.057,6)
 box('grill',(a+.35,b-.35,e-.70,e-.18),.16,1.06)
 for x in [a+1.6,a+3.0]:
  box('grill',(x-.52,x+.52,e-.95,e-.21),1.05,1.32)
  quad('grillInside',[(x-.49,e-.22,1.29),(x+.49,e-.22,1.29),(x+.49,e+.05,1.88),(x-.49,e+.05,1.88)])
 table((a+b)/2,c+1.75,3.2,.72,1.12)
 for x in [a+1,a+2,a+3,a+4]:
  y=c+1.0
  for xx in [x-.22,x+.22]:
   for yy in [y-.22,y+.22]:tube('frame',(xx,yy,.18),(xx,yy,.87),.024)
  for k in range(5):
   xx=x-.20+k*.10;box('frame',(xx-.02,xx+.02,y-.25,y+.25),.86,.90)
   tube('frame',(xx,y+.25,.9),(xx,y+.32,1.32),.021)
  tube('frame',(x-.24,y+.32,1.32),(x+.24,y+.32,1.32),.023)
  tube('frame',(x-.23,y-.2,.44),(x+.23,y-.2,.44),.022)
 seat(a+1.25,c+.0,1.75,.72,.49);seat(a+4,c+.0,1.25,.72,.49);table(a+2.8,c-.25,.6,.7,.58)
 # Open rail with posts and two horizontal rails; panels intentionally remain
 # clear/open, not the old opaque full-height box.
 for i in range(25):
  x=58+i*1.5;tube('rail',(x,.38,.18),(x,.38,1.34),.035,6)
 for z in [.35,1.30]:tube('rail',(58,.38,z),(94,.38,z),.038,6)
 # Narrow handrails descend into the shallow end.
 for x in [63.55,64.25]:
  tube('grill',(x,5.7,.19),(x,5.7,1.14),.025,6);tube('grill',(x,5.7,1.14),(x,4.5,.75),.025,6)
 for x in [63.5,66.5,69.5,72.5]:
  box('lime',(x,x+2.6,10.8,11.3),.17,.9);flat('soil',(x+.1,x+2.5,10.9,11.2),.92)
  for k in range(5):
   xx=x+.25+k*.48
   for sign in [-1,1]:triangle('palm',[(xx,11,.93),(xx+.18,11,1.4),(xx+sign*.38,11.12,1.12)])
 # Overhead reference supersedes the old giant freestanding screen wall. The
 # small screen is attached to the existing tower face above the planters.
 d['deck']={'z':Z,'items':[dict(id='screen',tone='screen',**SCREEN,
   _src='PHOTO_DECK small near-square display above planters. 1.8x1.55m size and exact wall placement inferred; supersedes old 11m screen and unsupported freestanding wall.')],
   '_src':'PHOTO_DECK replaces old deck objects including oversized screen/wall. Superseded recipe remains in version history.'}
 d['detailMeshes']=[m for m in d.get('detailMeshes',[]) if not m['id'].startswith(PREFIX)]+list(meshes.values())
 d['_deckFeatureEvidence']={'pool':'Two raised mosaic spas, inset water, one lane stripe and paved chaise peninsula; surface optics approximate.',
  'furniture':'Three hammocks, three turf sofas, three rectangular dining tables, four poolside plus five west-turf chaises; count from overhead reference.',
  'screen':'Small tower-mounted display; old giant freestanding wall superseded.',
  'shade':'East grill pergola with20 visible-family slats, four posts, two grills and counter; exact slat count inferred.',
  'landscape':'Two road-side pool-island palms with fronds; lime planters. Original third palm had no support in overhead reference and is superseded.',
  'unseen':'Inner courtyard furniture and covered lounge were photographed but not yet spatially placed by this main-deck pass.',
  '_src':'PHOTO_DECK; dimensions/hidden faces PHOTO_DECK_INFER'}
 assert sum(len(m['triangles']) for m in meshes.values())<18000
 assert all(math.isfinite(t) for m in meshes.values() for p in m['vertices'] for t in p)
 assert all(57<=p[0]<=95 and -.1<=p[1]<=12 and Z-.01<=p[2]<=Z+6 for m in meshes.values() for p in m['vertices'])
 for before,after in zip(blocks,d['blocks']):
  a=copy.deepcopy(before);b=copy.deepcopy(after)
  if a['id']=='podium':a.pop('roofItems',None);b.pop('roofItems',None)
  assert a==b,'Unrelated tower geometry changed'
 deduplicate_detail_meshes(d)
 PATH.write_text(json.dumps(d,ensure_ascii=False,separators=(',',':')))
 print('Standard deck:',len(meshes),'meshes,',sum(len(m['triangles']) for m in meshes.values()),'triangles; tower unchanged')


if __name__=='__main__':main()
