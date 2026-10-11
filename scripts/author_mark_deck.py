#!/usr/bin/env python3
"""Rebuild only The Mark amenity deck. Original facade/roof bodies are retained.
Geographic dimensions/height are inherited; detailed layout metres are inferred
from overhead reference evidence and corroborating completed-building imagery.
"""
import copy
import hashlib
import json
import math
from pathlib import Path
from detail_mesh_dedup import deduplicate_detail_meshes
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'data/apartments/the-mark-austin.json'
PREFIX='mark-deck-'
Z=49.0
# All appearance and repeated feature dimensions are editable here.
COLORS={'blue':'#1769a7','slats':'#666c6b','chair':'#818887','seat':'#bfc5bd',
 'steel':'#414847','paver':'#b6aaa0','paverAlt':'#b9b2a6','rim':'#d3d0c3',
 'soil':'#655a46','foliage':'#687652','trunk':'#75634c','water':'#3e9ea6',
 'shelf':'#6eb6b5','tile':'#3c5f63','bar':'#9ba2a0','table':'#e0dfd5','wood':'#66503e','turf':'#516448'}
PERGOLAS=[(54,59,8.3,12.2,2.7,'small'),(63,68,8.3,12.2,2.7,'small'),
           (64,73,16,21.5,3.0,'large'),(79.3,82.6,7.6,11.1,2.8,'end')]
POST=.14
SLAT_W=.075
CHAIR_W=.67
# Curved molded shell side profile: toe, low seat, rising reclined back.
CHAISE=[(-1.04,.20),(-.76,.17),(-.42,.20),(-.15,.30),(.10,.44),(.36,.65),(.64,.87),(.84,.92),(1.03,.85)]
COUNTS={'bluePergolas':4,'smallSlattedCabanas':2,'largePergolaCrossBeams':17,
 'chaisesTotal':14,'chaisesDisplacedInWater':2,'barTables':4,'treePlanters':3,
 'lawnArmchairs':14,'roundTables':4,'sourceNote':'Pergola types, pool/spa relation and object families observed. Detailed metres and exact movable furniture counts inferred where partially occluded.'}
M={}
def mesh(tone):
    k=PREFIX+tone
    return M.setdefault(k,dict(id=k,tone=PREFIX+tone,vertices=[],triangles=[],_src='MD1/MD2: visible deck feature family; MD3: approximate placement and dimensions.'))
def poly(tone,ps):
    m=mesh(tone);n=len(m['vertices']);m['vertices'].extend([[round(x,4),round(y,4),round(z+Z,4)] for x,y,z in ps]);m['triangles'] += [[n,n+i,n+i+1] for i in range(1,len(ps)-1)]
def box(t,a,b,c,d,z,h):
    ps=[(a,c,z),(b,c,z),(b,d,z),(a,d,z),(a,c,z+h),(b,c,z+h),(b,d,z+h),(a,d,z+h)]
    for ids in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]:poly(t,[ps[i] for i in ids])
def cyl(t,u,v,z,r,h,n=12):
    a=[(u+r*math.cos(i*2*math.pi/n),v+r*math.sin(i*2*math.pi/n),z) for i in range(n)]
    b=[(x,y,z+h) for x,y,_ in a];poly(t,b)
    for i in range(n):j=(i+1)%n;poly(t,[a[i],a[j],b[j],b[i]])
def line(t,p,q,w):
    # Rectangular beam joining arbitrary endpoints; clean light structural rods.
    dx,dy,dz=[q[i]-p[i] for i in range(3)];L=math.sqrt(dx*dx+dy*dy+dz*dz)
    ax=(-dy,dx,0) if abs(dx)+abs(dy)>.001 else (1,0,0);n=math.sqrt(sum(x*x for x in ax));a=[x/n*w/2 for x in ax]
    b=[(dy*a[2]-dz*a[1])/L,(dz*a[0]-dx*a[2])/L,(dx*a[1]-dy*a[0])/L]
    vs=[[p[k]+sa*a[k]+sb*b[k] for k in range(3)] for sa,sb in [(-1,-1),(1,-1),(1,1),(-1,1)]]
    vs += [[vs[i][k]+q[k]-p[k] for k in range(3)] for i in range(4)]
    for ids in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]:poly(t,[vs[i] for i in ids])
def chaise(u,v,angle=0,z=.08):
    a=math.radians(angle)
    def point(x,y,h):return (u+x*math.cos(a)-y*math.sin(a),v+x*math.sin(a)+y*math.cos(a),z+h)
    for i in range(len(CHAISE)-1):
        y,h=CHAISE[i];yy,hh=CHAISE[i+1]
        poly('chair',[point(-CHAIR_W/2,y,h),point(CHAIR_W/2,y,h),point(CHAIR_W/2,yy,hh),point(-CHAIR_W/2,yy,hh)])
        for x in [-CHAIR_W/2,CHAIR_W/2]:poly('chair',[point(x,y,h),point(x,yy,hh),point(x,yy,hh-.13),point(x,y,h-.13)])
        poly('chair',[point(-CHAIR_W/2,y,h-.13),point(-CHAIR_W/2,yy,hh-.13),point(CHAIR_W/2,yy,hh-.13),point(CHAIR_W/2,y,h-.13)])
def armchair(u,v,angle=0,t='steel'):
    # Separate seat/back/arms on legs; no solid seating blocks.
    a=math.radians(angle)
    def pt(x,y,z):return(u+x*math.cos(a)-y*math.sin(a),v+x*math.sin(a)+y*math.cos(a),z)
    for x in [-.32,.32]:
        line(t,pt(x,-.32,.08),pt(x,-.28,.43),.055);line(t,pt(x,.30,.08),pt(x,.35,.66),.055)
        line(t,pt(x,-.25,.61),pt(x,.40,.64),.075)
    for x in [-.26,-.13,0,.13,.26]:
        line(t,pt(x,-.33,.43),pt(x,.31,.43),.105)
        line(t,pt(x,.30,.44),pt(x,.54,.94),.105)
def planter(a,b,c,d,tree=False):
    h=.7
    for aa,bb,cc,dd in [(a,b,c,c+.14),(a,b,d-.14,d),(a,a+.14,c,d),(b-.14,b,c,d)]:box('rim',aa,bb,cc,dd,.04,h)
    box('soil',a+.14,b-.14,c+.14,d-.14,.04,.52)
    if tree:
        u=(a+b)/2;v=(c+d)/2;cyl('trunk',u,v,.58,.065,2.1,7)
        # Sparse small-canopy deck trees; no full opaque cubic crowns.
        for dx,dy,h,r in [(0,0,2.8,.82),(.48,.20,2.35,.64),(-.40,-.18,2.4,.60)]:
            for j in range(4):
                lo=-math.pi/2+j*math.pi/4;hi=lo+math.pi/4
                for k in range(10):
                    p=[]
                    for lat,lon in [(lo,k*math.pi/5),(lo,(k+1)*math.pi/5),(hi,(k+1)*math.pi/5),(hi,k*math.pi/5)]:p.append((u+dx+r*math.cos(lat)*math.cos(lon),v+dy+r*math.cos(lat)*math.sin(lon),h+r*.75*math.sin(lat)))
                    poly('foliage',p)
    else:
        for u in [a+.7,(a+b)/2,b-.7]:cyl('foliage',u,(c+d)/2,.58,.25,.25,7)
def pergola(a,b,c,d,h,kind):
    for u in [a,b]:
        for v in [c,d]:box('blue',u-POST/2,u+POST/2,v-POST/2,v+POST/2,.05,h)
    for v in [c,d]:box('blue',a-.1,b+.1,v-.08,v+.08,h,.18)
    for u in [a,b]:box('blue',u-.08,u+.08,c-.1,d+.1,h,.18)
    if kind=='large':
        for i in range(17):u=a+(b-a)*i/16;box('blue',u-.075,u+.075,c-.20,d+.20,h+.18,.19)
        for v in [c+1.5,d-1.5]:box('blue',a,b,v-.08,v+.08,h-.05,.18)
    elif kind=='small':
        box('blue',(a+b)/2-.05,(a+b)/2+.05,c,d,h,.1)
        for i in range(29):v=c+.10+(d-c-.2)*i/28;box('slats',a+.08,b-.08,v-SLAT_W/2,v+SLAT_W/2,h+.13,.08)
        # Slatted privacy back and a cushioned two-place bench under each cabana.
        for i in range(15):z=.35+i*.115;box('slats',a+.1,b-.1,d-.1,d-.04,z,.055)
        box('steel',a+.4,b-.4,d-1.0,d-.35,.1,.12);box('seat',a+.4,b-.4,d-1.0,d-.35,.40,.15)
        box('seat',a+.4,b-.4,d-.45,d-.30,.55,.38)
        for u in [a+.65,b-.65]:line('steel',(u,d-.85,.06),(u,d-.85,.4),.07)
    # 'end' is explicitly an open frame in the latest source edge, not a solid roof.

def build():
    d=json.loads(OUT.read_text()); original_blocks=copy.deepcopy(d['blocks'])
    if '_deckHistory' not in d:
        d['_deckHistory']={'supersededSource':d['deck']['_src'],'note':'Retained historical claims; superseded for the amenity deck only by MD1/MD2.'}
    d['_deckHistory'].pop('supersededItems',None)
    d['sources'].update(MD1={'type':'site photograph','confidence':'high','supports':'Current open blue pergolas, basin relation, curved chaises, turf, paving, planters and furniture families; private evidence join retained separately.'},
      MD2={'type':'online photo / reference photograph','source':'Completed-building aerial reference; corroborating https://humphreys.com/project/the-mark-at-austin/; duplicate aerial copies count once','date':None,'confidence':'medium','supports':'East-end spa and fourth blue frame, pool shelf, clear guard and older furniture arrangement; overhead reference wins conflicts.'},
      MD3={'type':'inference','confidence':'low','supports':'Retained 49 m deck datum and mapped deck extent; dimensions/placements from perspective ratios, small feature counts where obscured, calm water colors (not measured optical physics).'})
    for k,col in COLORS.items():d['colours'][PREFIX+k]={'hex':col,'_src':'MD1 visible material family; albedo and lighting response inferred. MD2 secondary.'}
    d['deck'].update(z=Z,items=[],_src='MD1/MD2 supersede the original seven solid-box deck items. Authored deck geometry is in mark-deck-* detailMeshes; MD3 metric uncertainty.',_counts=COUNTS)
    # Deck paver grid, broad real slab spacing; no fine jittering texture lines.
    for i in range(34):
        for j in range(23):
            a=50.05+i*.98;b=min(a+.965,83.35);c=.05+j*.99;e=min(c+.975,22.95)
            poly('paverAlt' if (i+2*j)%5==0 else 'paver',[(a,c,.04),(b,c,.04),(b,e,.04),(a,e,.04)])
    # Main pool: dark rim, shallow shelf and wider swim-water lane.
    box('tile',52.7,77.3,1.7,6.65,.045,.10)
    box('water',53,77,2,6.35,.145,.008)
    box('shelf',53.15,72.9,4.15,6.32,.158,.006)
    for a,b,c,e in [(52.7,77.3,1.65,1.95),(52.7,53,1.95,6.65),(77,77.3,1.95,6.65),(53,77,6.35,6.65)]:box('rim',a,b,c,e,.06,.14)
    # Shallow-end submerged steps; solid broad treads instead of painted lines.
    for i in range(3):box('shelf',73.3+i*.8,74.1+i*.8,4.25,6.2,.15+i*.012,.015)
    # Spa is east of the main basin, not north of it as the old placeholder.
    box('tile',78.0,82.0,2,6.35,.04,.17);box('water',78.3,81.7,2.3,6.05,.215,.008)
    for a,b,c,e in [(78,82,2,2.28),(78,82,6.05,6.35),(78,78.3,2.28,6.05),(81.7,82,2.28,6.05)]:box('rim',a,b,c,e,.08,.20)
    # Twelve aligned shells plus two visibly displaced into water in the reference photographs.
    for u in [54.0,55.45,56.9,58.35,59.8,61.25,62.7,64.15,65.6,67.05,68.5,72.1]:chaise(u,6.2)
    chaise(68.6,4.0,-18,.17);chaise(70.5,4.3,12,.17)
    # Turf strips under cabanas and separate raised east lounge lawns.
    for a,b,c,e in [(53,69,7.5,12.8),(74,82.8,8.0,15.1)]:box('turf',a,b,c,e,.05,.04)
    for a,b,c,e in [(74.2,79.0,8.3,14.9),(79.2,80.5,8.3,14.9)]:
        for aa,bb,cc,dd in [(a,b,c,c+.1),(a,b,e-.1,e),(a,a+.1,c,e),(b-.1,b,c,e)]:box('rim',aa,bb,cc,dd,.05,.23)
    for p in PERGOLAS:pergola(*p)
    for p in [(51,53,8.2,11.1),(59.5,62,8.2,11.1),(69,71.5,8.2,11.1)]:planter(*p,True)
    planter(54,61,14.1,15.5);planter(75,82,16,17.0)
    for u in [76,78.6]:
        for v in [9,10.6,12.2,13.8]:armchair(u,v,90 if u==76 else -90)
    for u in [80.9]:
        for v in [8.6,9.7,10.8,11.9,13,14.1]:armchair(u,v,-90)
    # Four tall bar tables, not solid counters: slab top with slim end supports.
    for u,v in [(64,13.4),(68.4,13.4),(64,15),(68.4,15)]:
        box('bar',u,u+3.2,v,v+.75,1.0,.10)
        for x in [u+.12,u+3.0]:box('bar',x,x+.12,v,v+.75,.06,.94)
        for x in [u+.65,u+1.6,u+2.55]:
            box('steel',x-.2,x+.2,v-.47,v-.07,.67,.06)
            for dx in [-.14,.14]:line('steel',(x+dx,v-.36,.05),(x+dx,v-.36,.67),.04)
    # Four round white tables along south perimeter and four chairs below canopy.
    for u in [55,61,67,73]:cyl('steel',u,.75,.05,.045,.77,8);cyl('table',u,.75,.82,.53,.05,18)
    for u in [65.5,67.2,69,70.8]:armchair(u,19,0,'seat')
    # Stainless pool handrails and black perimeter guard: posts + open rails.
    for u in [53.4,75.7,78.7]:
        line('steel',(u,5.5,.18),(u,5.5,1.05),.045);line('steel',(u,5.5,1.05),(u,7.0,1.05),.045);line('steel',(u,7.0,1.05),(u,7.0,.06),.045)
    for u in [51+i*2 for i in range(17)]:box('steel',u-.025,u+.025,.3,.35,.24,1.02)
    box('steel',50.6,83.0,.3,.35,1.24,.045)
    for v in [1+i*2 for i in range(11)]:box('steel',83.0,83.05,v-.025,v+.025,.24,1.02)
    box('steel',83.0,83.05,.3,22.4,1.24,.045)
    # Deck lamp stems, bent necks and shallow dome heads.
    for u,v in [(54,.65),(60,.65),(66,.65),(72,.65),(78,.65),(53,7.8),(61,7.8),(69,7.8),(74,14.9),(80.7,14.9)]:
        cyl('steel',u,v,.06,.055,2.3,8);line('steel',(u,v,2.30),(u+.3,v,2.50),.065);cyl('steel',u+.3,v,2.38,.21,.11,12)
    for b in d['blocks']:
        if b['id']=='deckblock':
            d['_deckHistory'].setdefault('supersededParapet',{'height':b['parapet'],'source':b['_parapet_src']})
            b['parapet']=.22;b['_parapet_src']='MD1/MD2: low solid upstand beneath open metal/glass guard. Steel rails authored in deck mesh; clear glazing omitted rather than represented by an opaque wall.'
    d['detailMeshes']=[m for m in d.get('detailMeshes',[]) if not m.get('id','').startswith(PREFIX)]+list(M.values())
    for s in d['open'][:]:
        if "pergolas are bright blue" in s:d['open'].remove(s)
    msg='DECK PHOTO: MD1 overhead replaces block placeholders. Fixed 49m datum retained, not surveyed. Detailed plan ratios approximate. Water is a calm colored plane using existing mesh support, without new reflections/refraction/caustics. Clear guard glazing omitted; rail geometry retained. Movable furniture may change.'
    d['open']=[s for s in d['open'] if not s.startswith('DECK ')]+[msg]
    # Only deck parapet is an intentional change within existing roof blocks.
    for b,old in zip(d['blocks'],original_blocks):
        bb=copy.deepcopy(b);oo=copy.deepcopy(old)
        if b['id']=='deckblock':
            for k in ('parapet','_parapet_src'):bb.pop(k,None);oo.pop(k,None)
        assert bb==oo,'Unrelated facade/roof geometry changed'
    assert not d['deck']['items']
    for m in M.values():
        for p in m['vertices']:assert all(math.isfinite(x) for x in p) and 49<=p[2]<53 and 49.9<=p[0]<=83.4 and 0<=p[1]<=23
        for t in m['triangles']:assert all(0<=i<len(m['vertices']) for i in t)
    deduplicate_detail_meshes(d)
    text=json.dumps(d,separators=(',',':'),ensure_ascii=False);OUT.write_text(text)
    print('Mark deck',sum(len(m['triangles']) for m in M.values()),'authored triangles',len(text.encode()),'bytes',hashlib.sha256(text.encode()).hexdigest())
if __name__=='__main__':build()
