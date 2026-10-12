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
# ---- Hall, entrance, covered lounge, inner courtyard (2026-10-11 pass). Every taste or evidence-derived number is here. ----
# Plan frame is the deck frame above: x runs east to west along 23rd St, y runs north (street) to south, z is above the deck.
# Counts and sizes below are read off the site photographs; each group says what is PHOTO and what is INFERRED.
PERGOLA=(57.7,63.7,6.2,10.9)          # grill hall. PHOTO: abuts the tower wall at its south side and the east roof wall; ~6 m wide (about 6 pavers).
HALL=dict(postW=.42,postD=.28,postH=2.95,       # PHOTO: broad flat steel posts. 3 on the open front, 2 at the wall (count from two photographs).
  girderH=.30,girderW=.18,slatCount=25,slatR=.06,slatOverhang=.6,   # PHOTO: ~36 round slats across; 25 drawn so far views stay steady (rule 15).
  counterX=(60.0,62.95),counterD=.85,counterOverhang=.3,counterH=1.05,counterReturn=1.9,  # PHOTO: concrete counter along the wall with an end return; INFERRED lengths.
  stools=4,stoolH=.78,sofa=2.0)
BINS=[(63.95,10.55,.62,.62,.98,'binBlack'),(64.7,10.5,.74,.74,1.08,'binBlue')]   # PHOTO: a black and a blue bin at the hall's west end.
GATE=dict(x=(65.35,66.55),y=10.0)       # PHOTO: white panel gate + glass leaf + door in the tower wall, between the bins and the turf.
VESTIBULE=dict(x=(57.7,59.6),y=(8.9,10.9))  # PHOTO: glass-fenced doorway recess at the hall's east end. INFERRED which end.
WALL_H=3.6; WALL_PANELS=[(.5,3.1,2.4,2.8),(3.6,6.9,1.45,1.85),(6.2,8.7,2.9,3.3),(1.2,3.6,.6,1.0),(4.6,7.6,.3,.7)]   # PHOTO family: pale wall, dark panels; INFERRED layout
PLANTERS_X=[69.9,71.6,73.3]
TURF_W=(66.6,75.0)                    # the west turf begins after the gate (was 63 before the hall was widened to its photographed width)
HAMMOCK_X=[67.6,70.7,73.8]; SOFA_X=[67.8,71.0,74.0]
LOUNGE=dict(x=(80.1,86.0),y=(6.7,10.95),soffitZ=3.35,slabT=.32,cols=[(80.6,7.05),(85.5,7.05)],colR=.19,   # PHOTO: timber-soffit covered lounge beside the screen wall; position INFERRED from the screen/dining tables.
  sectional=dict(x=(81.1,85.0),y=8.0,ret=(84.2,85.0)),bench=(80.25,8.0,10.8),table=(83.4,10.15,2.8,1.0),chairs=5)
COURT=dict(x=(57.5,74.5),y=(17.2,33.6),                    # the light well south of the turf: INFERRED position (see _deckFeatureEvidence)
  pergola=(59.5,66.5,28.2,32.8),fire=(60.5,65.5,30.5,31.3),
  tables=[(66.2,21.6),(70.6,20.6),(70.2,24.6),(65.0,24.6),(61.0,21.0),(73.2,22.8)],tableR=.62,
  planters=[(60.0,20.0,3.4,.8),(66.5,18.2,3.2,.8),(71.8,29.0,.8,3.2)],
  turf=[(58.2,23.0),(62.5,23.0),(62.5,27.2),(58.2,27.2)])
PALETTE={'paver':'#c6c6b9','paverAlt':'#adb4b3','paverJoint':'#929a99',
 'coping':'#d0d0c0','water':'#409baa','lane':'#2d70a1','tile':'#497284',
 'tileLight':'#5d8995','tileDark':'#345968','metal':'#637b84',
 'frame':'#d2d1ba','cushion':'#7c9b92','sling':'#759389','table':'#c7c8b5',
 'grill':'#9aa7a6','grillInside':'#202b2e','turf':'#668844','soil':'#646356',
 'lime':'#91b943','palm':'#527e45','palmLight':'#6c914f','trunk':'#8c8065',
 'rope':'#c8cfbf','rail':'#323d42','bulb':'#cac5a6',
 # added 2026-10-11 from the hall, entrance, lounge and courtyard photographs (hex = median of the lit material, rounded)
 'steel':'#6d8498','steelDark':'#516272','slatShade':'#4a5d6a','counter':'#a7a9a3','wall':'#c8c9c2','wallDark':'#5d6265','gate':'#dcdcd6',
 'glassFrame':'#bfc3c1','binBlack':'#2b2e30','binBlue':'#2a559a','timber':'#52281b','slab':'#c9c8c0','wicker':'#a99882','cushionBlue':'#1f5f80',
 'courtTable':'#a5a49c','chairTeal':'#1f808a','courtPaver':'#bbbcb6','courtPaverEdge':'#9ea3a1','fire':'#2b3033','doorDark':'#2d3338','cone':'#d9602b'}


def main():
 d=json.loads(PATH.read_text()); blocks=copy.deepcopy(d['blocks'])
 d.pop('_deckBeforeOwnerPass',None)  # Superseded geometry belongs in version history.
 for b in d['blocks']:
  if b['id']=='podium':b['roofItems']=[x for x in b.get('roofItems',[]) if x.get('id') not in ('loungers','turfChairs','deckCondensers')]
 d['sources']['PHOTO_DECK']={'type':'site photograph','confidence':'high',
   'supports':'Pool-deck furniture counts, east grill hall and its entrance, covered lounge, inner courtyard furniture, two raised spas, three hammocks, pool island palms, paver/turf zones. Private source joins retained separately.'}
 d['sources']['PHOTO_DECK_INFER']={'type':'inference','derivedFrom':['PHOTO_DECK'],'confidence':'medium',
   'supports':'Precise furniture dimensions, spacing, hidden side geometry and subtle material albedos. Deck elevation21.5m retained, not re-surveyed.'}
 for k,v in PALETTE.items():d['colours'][PREFIX+k]={'hex':v,'_src':'PHOTO_DECK visible material family; albedo inferred'}
 meshes={}
 detail={'min':0}   # set to 1 for small furniture: the performance preset (0.5) then skips it; balanced and above draw it
 def mesh(t):
  k=t if not detail['min'] else t+'-d%d'%detail['min']
  if k not in meshes:
   meshes[k]={'id':PREFIX+k,'tone':PREFIX+t,'vertices':[],'triangles':[], '_src':'PHOTO_DECK appearance; geometry sizes inferred in retained metric frame'}
   if detail['min']:meshes[k]['minDetail']=detail['min']
  return meshes[k]
 def quad(t,p):
  m=mesh(t);i=len(m['vertices']);m['vertices'] += [[round(x,3),round(y,3),round(z+Z,3)] for x,y,z in p];m['triangles'] += [[i,i+1,i+2],[i,i+2,i+3]]
 def triangle(t,p):
  m=mesh(t);i=len(m['vertices']);m['vertices'] += [[round(x,3),round(y,3),round(z+Z,3)] for x,y,z in p];m['triangles'].append([i,i+1,i+2])
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
 def under(t,r,z):x0,x1,y0,y1=r;quad(t,[(x0,y0,z),(x0,y1,z),(x1,y1,z),(x1,y0,z)])   # a face that looks down (soffits)
 def rbox(t,cx,cy,w,dp,z0,z1,ang=0,top=True):
  co,si=math.cos(ang),math.sin(ang)
  P=[(cx+a*co-b*si,cy+a*si+b*co) for a,b in [(-w/2,-dp/2),(w/2,-dp/2),(w/2,dp/2),(-w/2,dp/2)]]
  if top:quad(t,[(p[0],p[1],z1) for p in P])
  for i in range(4):
   p,q=P[i],P[(i+1)%4];quad(t,[(p[0],p[1],z0),(q[0],q[1],z0),(q[0],q[1],z1),(p[0],p[1],z1)])
 def inrect(x,y,r):return r[0]<=x<=r[1] and r[2]<=y<=r[3]
 def loc(cx,cy,ang):
  co,si=math.cos(ang),math.sin(ang);return lambda a,b:(cx+a*co-b*si,cy+a*si+b*co)
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
 flat('turf',(TURF_W[0],TURF_W[1],6.2,10.95),.19);flat('turf',(86,94,6.7,10.7),.19)
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
 for x in SOFA_X:seat(x,6.95,1.9,.78,.53);table(x+1.3,6.85,.55,.55,.59)
 for y in [6.8,8.5,10.2]:
  table(78,y,1.55,.8)
  for x in [77.5,78.5]:seat(x,y-.78,angle=math.pi);seat(x,y+.78)
  seat(76.7,y,angle=-math.pi/2);seat(79.3,y,angle=math.pi/2)
 # Three sagging rope hammocks. Coarse open weave is enough at this scale;
 # no texture is substituted for missing posts or the curve.
 for x in HAMMOCK_X:
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
 # ---------------------------------------------------------------------------
 # Grill hall at the east end (PHOTO: steel pergola with round slats over a concrete counter, two grills, bar stools and two
 # sofas; against a panel wall). Structure is drawn with real gaps: 5 posts, 3 girders, slats with air between.
 # ---------------------------------------------------------------------------
 a,b,c,e=PERGOLA;H=HALL
 def dchair(x,y,ang,tone='sling',frame='frame'):
  q=loc(x,y,ang)   # local +y is the back of the chair
  rbox(tone,x,y,.46,.46,.42,.47,ang)
  rbox(tone,*q(0,.21),.46,.04,.47,.92,ang)
  for sx in [-.2,.2]:
   for sy in [-.2,.2]:tube(frame,(*q(sx,sy),.0),(*q(sx,sy),.42),.02,4)
 def sofa(x,y,length,ang=0,tone='cushion',frame='frame'):   # local +y is the back; seats face -y
  q=loc(x,y,ang)
  rbox(frame,x,y,length,.86,.12,.30,ang)                    # base frame
  rbox(tone,*q(0,-.08),length-.2,.62,.30,.46,ang)           # seat cushions
  rbox(tone,*q(0,.33),length-.14,.2,.46,.93,ang)            # back cushions
  for sx in [-length/2+.05,length/2-.05]:rbox(frame,*q(sx,0),.1,.86,.30,.62,ang)   # arms
 def stool(x,y,h):
  rbox('frame',x,y,.36,.36,h-.04,h,0)
  for sx in [-.15,.15]:
   for sy in [-.15,.15]:tube('frame',(x+sx,y+sy,0),(x+sx,y+sy,h-.04),.018,4)
  tube('frame',(x-.15,y-.15,h*.45),(x+.15,y-.15,h*.45),.016,4);tube('frame',(x-.15,y+.15,h*.45),(x+.15,y+.15,h*.45),.016,4)
 fy=c+.25;by=e-.18
 for x in [a+.3,(a+b)/2,b-.3]:box('steel',(x-H['postW']/2,x+H['postW']/2,fy-H['postD']/2,fy+H['postD']/2),0,H['postH'])
 for x in [a+.3,b-.3]:box('steel',(x-H['postW']/2,x+H['postW']/2,by-H['postD']/2,by+H['postD']/2),0,H['postH'])
 for y in [fy,(fy+by)/2,by]:box('steelDark',(a-.15,b+.15,y-H['girderW']/2,y+H['girderW']/2),H['postH'],H['postH']+H['girderH'])
 zs=H['postH']+H['girderH']+.02+H['slatR']
 for i in range(H['slatCount']):
  x=a+.1+i*(b-a-.2)/(H['slatCount']-1);tube('steel',(x,c-H['slatOverhang'],zs),(x,e-.04,zs),H['slatR'],5)
 flat('slatShade',(a-.1,b+.1,c-H['slatOverhang'],e-.04),H['postH']+H['girderH']+.04)   # up-facing only: from the deck the slats still show sky between them; from far the roof reads as one steady plate
 # Back wall of the hall: the pale panel face with dark panels, 3.6 m, and the door recess of the entrance.
 wx0,wx1=a-.1,GATE['x'][1]+.4
 wy=e+.1                                           # wall face on the deck's south edge (y=11)
 box('wall',(wx0,wx1,wy,wy+.12),0,WALL_H)
 for k,(u0,u1,z0,z1) in enumerate(WALL_PANELS):    # dark panels: flat quads 1 cm proud of the face
  quad('wallDark',[(wx0+u0,wy-.012,z0),(wx0+u1,wy-.012,z0),(wx0+u1,wy-.012,z1),(wx0+u0,wy-.012,z1)])
 # Counter along the wall with an end return, two grills on it, a hose reel is left out (sub-pixel).
 cx0,cx1=H['counterX'];cd=H['counterD'];ch=H['counterH'];ov=H['counterOverhang']   # PHOTO: a recessed concrete body under a thick top slab that overhangs the bar side
 ye=by+.18                                           # wall side of the counter
 box('counter',(cx0,cx1,ye-cd+ov,ye),0,ch-.1);box('wall',(cx0,cx1,ye-cd,ye),ch-.1,ch)
 rl=H['counterReturn'];box('counter',(cx0,cx0+cd-ov,ye-cd-rl,ye-cd+ov),0,ch-.1);box('wall',(cx0,cx0+cd,ye-cd-rl,ye-cd),ch-.1,ch)
 for gx in [cx0+1.45,cx0+2.35]:
  box('grill',(gx-.32,gx+.32,by-.45,by+.05),ch,ch+.28)
  quad('grillInside',[(gx-.3,by-.44,ch+.27),(gx+.3,by-.44,ch+.27),(gx+.3,by+.12,ch+.72),(gx-.3,by+.12,ch+.72)])
 detail['min']=1
 for sx,sy in [(cx0+1.35,by+.18-cd-.42),(cx0+2.05,by+.18-cd-.42),(cx0+2.65,by+.18-cd-.42),(cx0-.55,by+.18-cd-1.1)]:stool(sx,sy,H['stoolH'])
 sofa(61.0,7.0,H['sofa'],math.pi)                  # long sofa on the open side, seat toward the wall
 sofa(b-.9,8.2,H['sofa'],math.pi/2*3)              # second sofa on the west side, seat toward the table
 sofa(a+1.2,7.9,.95,math.pi/2)                     # armchair on the east side
 rbox('frame',59.9,7.95,1.0,.6,.0,.42,0)           # coffee table
 detail['min']=0
 # Two bins, then the entrance gate: white panel gate, a glass leaf (frame only), door recess in the wall.
 for bx,by2,bw,bd,bh,bt in BINS:rbox(bt,bx,by2,bw,bd,0,bh,0)
 gx0,gx1=GATE['x'];gy=GATE['y']
 quad('doorDark',[(gx0+.2,wy-.014,0),(gx1-.2,wy-.014,0),(gx1-.2,wy-.014,2.2),(gx0+.2,wy-.014,2.2)])
 box('gate',(gx0,gx0+.62,gy+.4,gy+.5),.08,1.2)
 tube('glassFrame',(gx0+.12,gy+.43,.8),(gx0+.55,gy+.43,.8),.018,4)
 for px in [gx0+.62,gx0+.95,gx1]:tube('glassFrame',(px,gy+.45,.08),(px,gy+.45,1.2),.025,4)
 tube('glassFrame',(gx0+.62,gy+.45,1.2),(gx1,gy+.45,1.2),.022,4);tube('glassFrame',(gx0+.62,gy+.45,.1),(gx1,gy+.45,.1),.022,4)
 box('lime',(gx1+.15,gx1+1.05,gy+.15,gy+.95),.08,.78);flat('soil',(gx1+.2,gx1+1.0,gy+.2,gy+.9),.8)
 # Entrance vestibule at the east end of the hall: L of glass fence + gate leaf, door recess behind.
 vx0,vx1=VESTIBULE['x'];vy0,vy1=VESTIBULE['y']
 quad('doorDark',[(vx0+.55,wy-.014,0),(vx1-.3,wy-.014,0),(vx1-.3,wy-.014,2.2),(vx0+.55,wy-.014,2.2)])
 box('fire',(vx0+.6,vx0+.95,wy-.05,wy),2.35,2.5)       # EXIT sign above the door
 for px,py in [(vx0,vy0),(vx0+.95,vy0),(vx1,vy0),(vx1,(vy0+vy1)/2),(vx1,vy1)]:tube('glassFrame',(px,py,.08),(px,py,1.15),.03,4)
 for z in [.1,1.15]:
  tube('glassFrame',(vx0,vy0,z),(vx1,vy0,z),.024,4);tube('glassFrame',(vx1,vy0,z),(vx1,vy1,z),.024,4)
 box('gate',(vx0,vx0+.95,vy0-.05,vy0+.05),.08,1.15)
 # ---------------------------------------------------------------------------
 # Covered lounge beside the screen wall (PHOTO: dark-timber soffit on two round columns, wicker sectional with blue
 # cushions, bench along the side wall, long dining table). POSITION INFERRED: it sits under the tower's overhang west of the screen.
 # ---------------------------------------------------------------------------
 L=LOUNGE;lx0,lx1=L['x'];ly0,ly1=L['y'];sz=L['soffitZ']
 box('slab',(lx0,lx1,ly0,ly1),sz,sz+L['slabT']);under('timber',(lx0+.02,lx1-.02,ly0+.02,ly1),sz-.002)
 for px,py in L['cols']:tube('slab',(px,py,0),(px,py,sz),L['colR'],8)
 detail['min']=1
 sx0,sx1=L['sectional']['x'];sy=L['sectional']['y'];rx0,rx1=L['sectional']['ret']
 box('wicker',(sx0,sx1,sy,sy+.95),.1,.5);box('wicker',(sx0,sx1,sy,sy+.3),.5,.95);box('cushionBlue',(sx0+.04,sx1-.04,sy+.3,sy+.91),.5,.64)
 box('wicker',(rx0,rx1,sy-1.15,sy),.1,.5);box('cushionBlue',(rx0+.04,rx1-.04,sy-1.11,sy),.5,.64)
 bx,by0,by1=L['bench'];box('wicker',(bx,bx+.55,by0,by1),.1,.46);box('cushionBlue',(bx+.1,bx+.51,by0+.04,by1-.04),.46,.58)
 tx,ty,tw,tl=L['table'];table(tx,ty,tw,tl,.76)
 for i in range(L['chairs']):
  cxs=[tx-1.0,tx,tx+1.0][i] if i<3 else tx+(-1 if i==3 else 1)*(tw/2+.35)
  cys=ty-tl/2-.3 if i<3 else ty
  dchair(cxs,cys,math.pi if i<3 else (math.pi/2 if i==3 else -math.pi/2))
 detail['min']=0
 # ---------------------------------------------------------------------------
 # Inner courtyard (PHOTO: a paved light well with a steel pergola over a long fire trough, round tables with four chairs,
 # lime planters with grasses, a turf patch with a curved paved edge). POSITION INFERRED: the light well south of the turf;
 # the furniture groups follow the photographed arrangement, their exact spacing is estimated.
 # ---------------------------------------------------------------------------
 C=COURT;cx0,cx1=C['x'];cy0,cy1=C['y']
 flat('courtPaver',(cx0+.1,cx1-.1,cy0+.1,cy1-.1),.14)
 for r in [(cx0+.1,cx1-.1,cy0+.1,cy0+.7),(cx0+.1,cx1-.1,cy1-.7,cy1-.1),(cx0+.1,cx0+.7,cy0+.7,cy1-.7),(cx1-.7,cx1-.1,cy0+.7,cy1-.7)]:flat('courtPaverEdge',r,.17)
 outer=[(58.0,22.6),(62.6,22.6),(63.5,24.0),(63.5,26.0),(62.6,27.6),(58.0,27.6)]
 inner=[(58.0,23.0),(62.3,23.0),(63.0,24.1),(63.0,25.9),(62.3,27.2),(58.0,27.2)]
 for poly,tn,zz in [(outer,'courtPaverEdge',.17),(inner,'turf',.20)]:
  for j in range(1,len(poly)-1):triangle(tn,[(*poly[0],zz),(*poly[j],zz),(*poly[j+1],zz)])
 flat('courtPaverEdge',(63.6,cx1-.7,26.3,27.6),.17)   # PHOTO: a darker band of pavers between the table area and the fire lounge
 # pergola over the fire lounge
 pa,pb,pc,pe=C['pergola']
 for x in [pa+.15,pb-.15]:
  for y in [pc+.15,pe-.15]:box('steel',(x-.15,x+.15,y-.15,y+.15),0,2.85)
 for y in [pc+.15,pe-.15]:box('steelDark',(pa-.1,pb+.1,y-.1,y+.1),2.85,3.1)
 for i in range(16):
  x=pa+.1+i*(pb-pa-.2)/15;tube('steel',(x,pc-.3,3.16),(x,pe+.3,3.16),.05,5)
 fa,fb,fc,fe=C['fire'];box('fire',(fa,fb,fc,fe),0,.5)
 detail['min']=1
 for x,y,ang in [(fa+.9,fc-.9,0),(fb-.9,fc-.9,0),(fa+.9,fe+.9,math.pi),(fb-.9,fe+.9,math.pi)]:seat(x,y,.8,.8,.55,False,ang)
 for tx2,ty2 in C['tables']:
  R=C['tableR']
  ring=[(tx2+R*math.cos(math.tau*k/10),ty2+R*math.sin(math.tau*k/10)) for k in range(10)]
  for k in range(10):
   p,q=ring[k],ring[(k+1)%10];triangle('courtTable',[(tx2,ty2,.76),(p[0],p[1],.76),(q[0],q[1],.76)]);quad('courtTable',[(p[0],p[1],.72),(q[0],q[1],.72),(q[0],q[1],.76),(p[0],p[1],.76)])
  tube('frame',(tx2,ty2,0),(tx2,ty2,.72),.04,5)
  for k in range(4):
   ang=k*math.pi/2+.4;dchair(tx2+(R+.28)*math.cos(ang),ty2+(R+.28)*math.sin(ang),ang-math.pi/2,'chairTeal')
 detail['min']=0
 # raised concrete beds with grasses along the east wall, and a timber bench (PHOTO family; positions INFERRED)
 box('counter',(cx0+.2,cx0+1.3,cy0+.6,cy0+6.4),.0,.55);flat('soil',(cx0+.28,cx0+1.22,cy0+.68,cy0+6.32),.57)
 box('frame',(cx0+1.5,cx0+2.1,cy0+1.0,cy0+4.4),.0,.45)
 for k in range(6):
  gy=cy0+1.0+k*.9
  for sg in [-1,1]:triangle('palm',[(cx0+.75,gy,.58),(cx0+.75+.05*sg,gy+.1,1.1),(cx0+.75+.2*sg,gy+.15,.8)])
 for px,py,pw,pd in C['planters']:
  box('lime',(px,px+pw,py,py+pd),0,.72);flat('soil',(px+.06,px+pw-.06,py+.06,py+pd-.06),.74)
  for k in range(7):
   t=(k+.5)/7;gx=px+.2+t*(pw-.4) if pw>pd else px+pw/2;gy=py+pd/2 if pw>pd else py+.2+t*(pd-.4)
   for sg in [-1,1]:triangle('palm',[(gx,gy,.74),(gx+.06*sg,gy+.1,1.12),(gx+.2*sg,gy+.15,.88)])
 # Open rail with posts and two horizontal rails; panels intentionally remain
 # clear/open, not the old opaque full-height box.
 for i in range(25):
  x=58+i*1.5;tube('rail',(x,.38,.18),(x,.38,1.34),.035,6)
 for z in [.35,1.30]:tube('rail',(58,.38,z),(94,.38,z),.038,6)
 # Narrow handrails descend into the shallow end.
 for x in [63.55,64.25]:
  tube('grill',(x,5.7,.19),(x,5.7,1.14),.025,6);tube('grill',(x,5.7,1.14),(x,4.5,.75),.025,6)
 for x in PLANTERS_X:    # PHOTO: three lime planter boxes at the back of the turf, beside the screen wall
  box('lime',(x,x+1.5,10.25,10.95),.0,.9);flat('soil',(x+.08,x+1.42,10.33,10.87),.92)
  for k in range(4):
   xx=x+.25+k*.34
   for sign in [-1,1]:triangle('palm',[(xx,10.6,.93),(xx+.12,10.6,1.28),(xx+sign*.3,10.72,1.05)])
 # Overhead reference supersedes the old giant freestanding screen wall. The
 # small screen is attached to the existing tower face above the planters.
 d['deck']={'z':Z,'items':[dict(id='screen',tone='screen',**SCREEN,
   _src='PHOTO_DECK small near-square display above planters. 1.8x1.55m size and exact wall placement inferred; supersedes old 11m screen and unsupported freestanding wall.')],
   '_src':'PHOTO_DECK replaces old deck objects including oversized screen/wall. Superseded recipe remains in version history.'}
 d['detailMeshes']=[m for m in d.get('detailMeshes',[]) if not m['id'].startswith(PREFIX)]+list(meshes.values())
 d['_deckFeatureEvidence']={'pool':'Two raised mosaic spas, inset water, one lane stripe and paved chaise peninsula; surface optics approximate.',
  'furniture':'Three hammocks, three turf sofas, three rectangular dining tables, four poolside plus five west-turf chaises; count from overhead reference.',
  'screen':'Small tower-mounted display; old giant freestanding wall superseded.',
  'shade':'PHOTO: east grill hall, a steel pergola about 6 m wide with 3 posts on the open front, 2 at the wall, 3 girders and round slats (about 36 seen, 25 drawn so that far views stay steady), pale panel wall behind. Concrete counter along the wall with an end return, two grills, bar stools, a long sofa, a second sofa, an armchair and a coffee table. INFERRED: exact lengths, which end each sofa stands at.',
  'entrance':'PHOTO: a white panel gate with a glass leaf and a door recess in the wall between the hall bins and the turf; a second glass-fenced doorway with an exit sign at the hall east end. INFERRED: the order of the two along the wall. The turf, hammocks and sofas moved west to make room for the hall at its photographed width.',
  'lounge':'PHOTO: covered lounge with a dark-timber soffit on two round columns, wicker sectional with blue cushions, bench along the side wall, long dining table with chairs. INFERRED: its place, west of the screen wall under the tower overhang, and all lengths.',
  'courtyard':'PHOTO: paved light well with a steel pergola over a long fire trough and four lounge chairs, five round tables with four chairs each, three lime planters, a turf patch with a curved paved edge. INFERRED: which light well and every position inside it. Walls around the well come from the tower blocks, which this script does not touch.',
  'landscape':'Two road-side pool-island palms with fronds; lime planters. Original third palm had no support in overhead reference and is superseded.',
  'unseen':'Not drawn: string lights and their masts (thinner than a pixel at flight distance), glass infill of the fences, the long terrace east of the hall, tower walls above the hall and around the courtyard.',
  '_src':'PHOTO_DECK; dimensions/hidden faces PHOTO_DECK_INFER'}
 assert sum(len(m['triangles']) for m in meshes.values())<18000
 assert all(math.isfinite(t) for m in meshes.values() for p in m['vertices'] for t in p)
 assert all(57<=p[0]<=95 and -.1<=p[1]<=34 and Z-.01<=p[2]<=Z+6 for m in meshes.values() for p in m['vertices'])
 for before,after in zip(blocks,d['blocks']):
  a=copy.deepcopy(before);b=copy.deepcopy(after)
  if a['id']=='podium':a.pop('roofItems',None);b.pop('roofItems',None)
  assert a==b,'Unrelated tower geometry changed'
 deduplicate_detail_meshes(d)
 PATH.write_text(json.dumps(d,ensure_ascii=False,separators=(',',':')))
 print('Standard deck:',len(meshes),'meshes,',sum(len(m['triangles']) for m in meshes.values()),'triangles; tower unchanged')


if __name__=='__main__':main()
