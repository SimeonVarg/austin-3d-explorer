"""Author Welch's court in its existing local metre frame; no private references.

The surveyed footprint fixes the court edges. The stepped historic projection,
terrace, steel shade roofs and facade rhythm are approximate exterior-derived
dimensions, not survey measurements. Re-running replaces only this author's
generated details in welch-hall.json; it does not rebuild another bake.
"""
from pathlib import Path
import copy
import json
import math

PATH = Path(__file__).resolve().parents[1] / 'data/apartments/welch-hall.json'
# All appearance and dimension choices are editable here.
T = dict(terrace=3.1, slab=.32, parapet=.84, railRadius=.032,
         projectionTop=12.7, balustradeTop=13.65, bay=3.3,
         windowWidth=1.5, windowSill=.65, windowHeight=3.8,
         canopyWest=52.0, canopyEast=70.1, canopyLow=6.65,
         canopyHigh=8.75, canopyThickness=.09, roofPitch=22,
         archSegments=20, archJoint=.012, archBand=.18,
         archProjection=.075, roundSegments=8,
         historicWidth=1.72, historicHeight=3.5, historicSill=.65,
         historicReveal=.34, historicFrame=.075, historicMullion=.038,
         sillProject=.17, sillHeight=.14, labBay=5.8, labWidth=1.35,
         labHeight=2.55, labSill=.7, labReveal=.38,
         entranceWidth=5.6, entranceHeight=3.1, entranceDepth=.62,
         shrubSegments=7, shrubRings=5, historicGlassStrength=.22, labGlassStrength=.16)
COLOURS = dict(courtBrick='#b99b80', courtStone='#b69c80',
               courtTrim='#dfded3', courtGlass='#394a4e',
               courtConcrete='#aaa697', courtPave='#9b9789',
               courtSteel='#353c3c', courtRoof='#424b4b',
               courtLeaf='#536147', courtSoil='#615b49',
               courtFurniture='#58625b', courtRoofTile='#945e47',
               courtArchBrick='#aa8a70', courtArchBrickLight='#b3987b',
               historicSill='#9e8065', labBrick='#c1a68c',
               labGlass='#2b3635', courtLeafLight='#66704b',
               courtLeafShade='#38492f', courtDoor='#37413e')
M = {}


def mesh(tone):
    return M.setdefault(tone, dict(id='welch-court-'+tone, tone=tone,
                                   vertices=[], triangles=[]))


def polyhedron(tone, pts, faces):
    out = mesh(tone)
    off = len(out['vertices'])
    out['vertices'].extend([[round(v, 5) for v in p] for p in pts])
    for face in faces:
        for j in range(1, len(face)-1):
            out['triangles'].append([off+face[0], off+face[j], off+face[j+1]])


def box(tone, x0, x1, y0, y1, z0, z1):
    polyhedron(tone, [(x0,y0,z0),(x1,y0,z0),(x1,y1,z0),(x0,y1,z0),
                      (x0,y0,z1),(x1,y0,z1),(x1,y1,z1),(x0,y1,z1)],
               [(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])


def sub(a,b): return [a[i]-b[i] for i in range(3)]
def cross(a,b): return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
def unit(a):
    n=math.sqrt(sum(x*x for x in a));return [x/n for x in a]


def beam(tone,a,b,width,depth=None):
    """Closed rectangular section, including genuinely sloping members."""
    depth=width if depth is None else depth
    axis=unit(sub(b,a)); ref=[0,0,1] if abs(axis[2])<.9 else [1,0,0]
    u=unit(cross(axis,ref));v=unit(cross(axis,u));pts=[]
    for end in [a,b]:
        for i,j in [(-1,-1),(1,-1),(1,1),(-1,1)]:
            pts.append([end[k]+i*u[k]*width/2+j*v[k]*depth/2 for k in range(3)])
    polyhedron(tone,pts,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])


def rod(tone,a,b,r,segments=None):
    n=segments or T['roundSegments'];axis=unit(sub(b,a))
    u=unit(cross(axis,[0,0,1] if abs(axis[2])<.9 else [1,0,0]));v=unit(cross(axis,u))
    pts=[]
    for end in [a,b]:
        for j in range(n):
            th=j*2*math.pi/n
            pts.append([end[k]+r*(u[k]*math.cos(th)+v[k]*math.sin(th)) for k in range(3)])
    faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]
    faces.extend((j,(j+1)%n,(j+1)%n+n,j+n) for j in range(n))
    polyhedron(tone,pts,faces)


def turned(tone,x,y,z,profile,n=8):
    pts=[(x+r*math.cos(j*2*math.pi/n),y+r*math.sin(j*2*math.pi/n),z+h)
         for h,r in profile for j in range(n)]
    faces=[tuple(reversed(range(n))),tuple(range((len(profile)-1)*n,len(profile)*n))]
    for k in range(len(profile)-1):
        faces.extend((k*n+j,k*n+(j+1)%n,(k+1)*n+(j+1)%n,(k+1)*n+j) for j in range(n))
    polyhedron(tone,pts,faces)


def rail(a,b):
    r=T['railRadius'];rod('courtSteel',a,b,r)
    length=math.dist(a,b);n=max(1,math.ceil(length/1.7))
    for i in range(n+1):
        p=[a[k]+(b[k]-a[k])*i/n for k in range(3)]
        rod('courtSteel',[p[0],p[1],p[2]-.85],p,r)


def shade(y0,y1):
    x0,x1=T['canopyWest'],T['canopyEast'];z0,z1=T['canopyLow'],T['canopyHigh'];th=T['canopyThickness']
    # The photograph shows thin corrugated planes, not solid roof wedges.
    pts=[(x0,y0,z0-th),(x1,y0,z1-th),(x1,y1,z1-th),(x0,y1,z0-th),
         (x0,y0,z0),(x1,y0,z1),(x1,y1,z1),(x0,y1,z0)]
    polyhedron('courtRoof',pts,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
    height=lambda x:z0+(z1-z0)*(x-x0)/(x1-x0)
    for y in [y0+.28,y1-.28]:
        # A web and two flanges keep the open steel-section silhouette.
        for dz,w,h in [(-.19,.1,.32),(-.34,.26,.05),(-.04,.26,.05)]:
            beam('courtSteel',[x0,y,height(x0)+dz],[x1,y,height(x1)+dz],w,h)
        for x in [56.0,66.5]:
            rod('courtSteel',[x,y,T['terrace']],[x,y,height(x)-.18],.105,10)
            beam('courtSteel',[x,y,height(x)-1.1],[x+1.0,y,height(x+1)-.27],.095)
    for x in [53.2,55.6,58,60.4,62.8,65.2,67.6,69.8]:
        beam('courtSteel',[x,y0,height(x)-.12],[x,y1,height(x)-.12],.095,.12)
    # Corrugation: shallow continuous strips, bounded instead of tessellated waves.
    for i in range(math.ceil((y1-y0)/.28)):
        y=y0+i*.28
        beam('courtRoof',[x0,y,height(x0)+.025],[x1,y,height(x1)+.025],.045,.035)


def soldier_arch(a,b,centre,spring,radius):
    """Radial brick heads are distinguishable from the infilled blind arch."""
    length=math.dist(a,b);tx,ty=(b[0]-a[0])/length,(b[1]-a[1])/length
    nx,ny=ty,-tx
    def at(s,z,depth):return (a[0]+tx*s+nx*depth,a[1]+ty*s+ny*depth,z)
    n=T['archSegments'];gap=T['archJoint']/radius
    for j in range(n):
        p=j*math.pi/n+gap/2;q=(j+1)*math.pi/n-gap/2
        ring=[(centre-radius*math.cos(p),spring+radius*math.sin(p)),
              (centre-radius*math.cos(q),spring+radius*math.sin(q)),
              (centre-(radius+T['archBand'])*math.cos(q),spring+(radius+T['archBand'])*math.sin(q)),
              (centre-(radius+T['archBand'])*math.cos(p),spring+(radius+T['archBand'])*math.sin(p))]
        pts=[at(s,z,depth) for depth in [.045,T['archProjection']] for s,z in ring]
        tone='courtArchBrickLight' if j%3==1 else 'courtArchBrick'
        polyhedron(tone,pts,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])


def plant(x,y,z,scale=1):
    # Low planted clumps, not building-size cones. Individual tapered leaves.
    for j in range(9):
        th=j*2*math.pi/9; dx,dy=math.cos(th)*scale,math.sin(th)*scale
        pts=[(x-.08*dy,y+.08*dx,z),(x+.08*dy,y-.08*dx,z),
             (x+dx*.62,y+dy*.62,z+.72*scale),(x+dx*.95,y+dy*.95,z+.8*scale),
             (x+dx*.59-.05*dy,y+dy*.59+.05*dx,z+.75*scale)]
        # Two-sided leaf surfaces have finite thickness at their shared stem.
        polyhedron('courtLeaf',pts,[(0,1,2,3,4),(4,3,2,1,0)])


def wall_box(tone,a,b,s0,s1,d0,d1,z0,z1):
    """Closed local-wall box, positive depth toward the courtyard/outside."""
    length=math.dist(a,b);tx,ty=(b[0]-a[0])/length,(b[1]-a[1])/length
    def at(s,d,z):return (a[0]+tx*s+ty*d,a[1]+ty*s-tx*d,z)
    pts=[at(s,d,z) for z in [z0,z1] for s,d in [(s0,d0),(s1,d0),(s1,d1),(s0,d1)]]
    # The (along,out,height) coordinate frame has negative determinant.
    faces=[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
    polyhedron(tone,pts,[tuple(reversed(f)) for f in faces])


def shrub(x,y,z,sx,sy,sz,seed):
    """Bounded overlapping leafy masses with deterministic irregular outline."""
    n,rings=T['shrubSegments'],T['shrubRings']
    for clump in range(3):
        dx=math.cos(clump*2.4+seed)*sx*.27;dy=math.sin(clump*2.4+seed)*sy*.27
        pts=[(x+dx,y+dy,z)]
        for k in range(1,rings):
            p=-math.pi/2+math.pi*k/rings
            for j in range(n):
                th=j*2*math.pi/n
                r=1+.11*math.sin(j*2.7+k*3.1+seed+clump)
                pts.append((x+dx+sx*.72*r*math.cos(p)*math.cos(th),
                            y+dy+sy*.72*r*math.cos(p)*math.sin(th),z+sz*(1+math.sin(p))*.5))
        pts.append((x+dx,y+dy,z+sz));top=len(pts)-1
        faces=[(0,1+(j+1)%n,1+j) for j in range(n)]
        for k in range(rings-2):
            faces.extend((1+k*n+j,1+k*n+(j+1)%n,1+(k+1)*n+(j+1)%n,1+(k+1)*n+j) for j in range(n))
        faces.extend((top,1+(rings-2)*n+j,1+(rings-2)*n+(j+1)%n) for j in range(n))
        polyhedron(['courtLeaf','courtLeafLight','courtLeafShade'][clump],pts,faces)


def deepen_court(d,base,upper,h):
    """Complete visible historic wings, modern lab and terrace entrance."""
    historic=dict(kind='bays',field='courtBrick',bay=T['bay'],glass='courtGlass',
        frame='courtBrick',reveal=T['historicReveal'],window=dict(
        w=T['historicWidth'],h=T['historicHeight'],sill=T['historicSill'],
        frame=dict(w=T['historicFrame'],tone='courtTrim'),
        mullion=dict(cols=[1/3,2/3],rows=[.2,.4,.6,.82],w=T['historicMullion'],tone='courtTrim')))
    d['skins']['welch']=copy.deepcopy(historic)
    d['skins']['courtWindow']['reveal']=T['historicReveal']
    d['skins']['courtWindow']['frame']='courtBrick'
    d['skins']['courtWindow']['window']['frame']['w']=T['historicFrame']
    d['skins']['courtWindow']['window']['mullion']['w']=T['historicMullion']
    d['skins']['basement'].update(glass='courtGlass',reveal=T['historicReveal'],frame='stone')
    d['skins']['courtLab']=dict(kind='bays',field='labBrick',bay=T['labBay'],
        glass='labGlass',frame='labBrick',reveal=T['labReveal'],window=dict(
        w=T['labWidth'],h=T['labHeight'],sill=T['labSill'],
        frame=dict(w=.065,tone='courtDoor'),head=dict(h=.58,tone='stone'),
        mullion=dict(rows=[.18,.82],w=.04,tone='courtDoor')))
    for i in [6,7,8,9]:
        upper['faces']['h0.'+str(i-2)]=dict(bands=[dict(z0=T['projectionTop'],z1=18.2,skin='courtLab')])
    # The visible historic court elevations have deep brick jambs and separate
    # projecting sill blocks, not a bright frame pasted onto a uniform plane.
    for i in [0,1,2,3,4,5,10,11,12,13,14,15,16]:
        a,b=h[i],h[(i+1)%len(h)];length=math.dist(a,b)
        central=i in [0,1,16];n=max(1,round(length/T['bay']));mod=length/n
        width=T['windowWidth'] if central else T['historicWidth']
        height=T['windowHeight'] if central else T['historicHeight']
        for floor in ([7.8] if central else [3.1,7.8,12.5]):
            for j in range(n):
                c=(j+.5)*mod
                if c-width/2<.05 or c+width/2>length-.05:continue
                z=floor+T['historicSill']
                wall_box('historicSill',a,b,c-width/2-.09,c+width/2+.09,-.035,T['sillProject'],z-T['sillHeight'],z)
                # A shallow soldier-course lintel keeps material/scale distinct
                # from the modern wing's large pale precast heads.
                wall_box('courtArchBrick',a,b,c-width/2-.06,c+width/2+.06,.005,.06,z+height,z+height+.17)
        if not central and length>3:
            for z in [12.35,17.65]:
                wall_box('historicSill',a,b,.02,length-.02,.01,.2,z,z+.18)
    # Recessed, full-height glazed entry seen under the far shade roof.
    # Width stays inside the surveyed east court wall; no extra building mass.
    i=8;a,b=h[i],h[i+1];length=math.dist(a,b);c=length*.53
    s0,s1=c-T['entranceWidth']/2,c+T['entranceWidth']/2;z0=T['terrace'];z1=z0+T['entranceHeight']
    door=dict(s0=s0,s1=s1,z0=z0,z1=z1,d=T['entranceDepth'],glass='labGlass',tone='courtDoor',lit=False,
              mullion=dict(cols=[.2,.4,.6,.8],rows=[.78],w=.065,tone='courtDoor'))
    d['skins']['courtLabEntry']={**copy.deepcopy(d['skins']['courtLab']),'windowSkip':[[s0,s1]]}
    base['faces']['h0.8']=dict(bands=[dict(z0=0,z1=7.8,skin='courtLabEntry',openings=[door]),
                                             dict(z0=7.8,z1=T['projectionTop'],skin='courtLab')])
    wall_box('courtDoor',a,b,s0-.1,s1+.1,-.05,.09,z1,z1+.13)
    wall_box('courtConcrete',a,b,s0-.25,s1+.25,.01,2.7,z0-.13,z0)
    for s in [c-.12,c+.12]:
        wall_box('courtTrim',a,b,s-.022,s+.022,-T['entranceDepth']+.08,-T['entranceDepth']+.13,z0+.8,z0+1.45)
    # The under-terrace historic wall is occupied by dark recessed doors and
    # windows. They remain behind the slab and columns rather than filling it.
    a,b=h[0],h[1];length=math.dist(a,b);lower=[]
    for j in range(4):
        c=(j+.5)*length/4
        lower.append(dict(s0=c-1.22,s1=c+1.22,z0=.25,z1=2.8,d=.45,glass='labGlass',tone='courtBrick',lit=False,
                          mullion=dict(cols=[.5],rows=[.78],w=.065,tone='courtDoor')))
    base['faces']['h0.0']['bands'][0]['openings']=lower
    # Bushes soften the photographed terrace edge and planted lower court.
    # Keep the walking route and stair clear; existing spiky plants survive.
    for x,y,z,sx,sy,sz,seed in [(29,121,.16,1.7,1.5,3.4,1),(30.5,120,.16,1.25,1.1,2.7,4),
        (35.3,122.8,3.66,.82,.58,1.25,2),(68.4,123.4,3.66,.78,.55,1.15,6),
        (35.7,118,3.66,.68,.5,1.1,8)]:shrub(x,y,z,sx,sy,sz,seed)


def main():
    d=json.loads(PATH.read_text(encoding='utf-8'));base=d['blocks'][0]
    base['z1']=T['projectionTop']
    base['bands']=[dict(z0=0,z1=3.1,skin='basement'),dict(z0=3.1,z1=T['projectionTop'],skin='welch')]
    base['faces']={k:v for k,v in base.get('faces',{}).items() if not k.startswith('h')}
    for face in base['faces'].values():
        face['bands']=[{**b,'z1':min(b['z1'],T['projectionTop'])} for b in face['bands'] if b['z0']<T['projectionTop']]
    d['colours'].update({k:{'hex':v} for k,v in COLOURS.items()})
    d.setdefault('materials',{}).update(dict(courtBrick='brick',courtStone='stone',courtConcrete='agedConcrete',courtPave='concrete',courtGlass='glass',
        labBrick='brick',labGlass='glass',historicSill='brick'))
    d['materials']['courtGlass']=dict(type='glass',strength=T['historicGlassStrength'])
    d['materials']['labGlass']=dict(type='glass',strength=T['labGlassStrength'])
    d['skins'].update(courtBrick=dict(kind='flat',field='courtBrick'),
       courtWindow=dict(kind='bays',field='courtBrick',bay=T['bay'],glass='courtGlass',frame='courtTrim',reveal=.22,
        window=dict(w=T['windowWidth'],h=T['windowHeight'],sill=T['windowSill'],frame=dict(w=.085,tone='courtTrim'),
        mullion=dict(cols=[1/3,2/3],rows=[.2,.4,.6,.8],w=.045,tone='courtTrim'))),
       courtLab=dict(kind='bays',field='courtBrick',bay=5.8,glass='dark',frame='dark',reveal=.15,
        window=dict(w=1.25,h=1.95,sill=1.25,head=dict(h=.52,tone='stone'))))
    h=base['plan']['holes'][0]
    # The central low projection keeps its actual footprint but stops below
    # the adjacent historic wings. Only the upper-storey hole is widened.
    upper=copy.deepcopy(base);upper['id']='welch-upper-wings';upper['z0']=T['projectionTop'];upper['z1']=18.2
    upper['bands']=[dict(z0=T['projectionTop'],z1=17.55,skin='welch'),dict(z0=17.55,z1=18.2,skin='trim')]
    upper['faces']={}
    upper['plan']['holes'][0]=h[2:16]
    upper['plan']['holes'][0][-1]=[24.924,133.008]
    for i in [0,1,16]:
        a,b=h[i],h[(i+1)%len(h)];length=math.dist(a,b);n=max(1,round(length/T['bay']));mod=length/n
        openings=[]
        for j in range(n):
            c=(j+.5)*mod
            openings.append(dict(s0=c-.74,s1=c+.74,z0=3.65,z1=7.0,tone='courtBrick',lit=False,d=.1,
                arch=dict(rise=.74,trim=.18,tone='courtBrick',proud=.045)))
            soldier_arch(a,b,c,6.26,.74)
        base['faces']['h0.'+str(i)]=dict(bands=[dict(z0=0,z1=3.1,skin='courtBrick'),
          dict(z0=3.1,z1=7.8,skin='courtBrick',openings=openings),dict(z0=7.8,z1=T['projectionTop'],skin='courtWindow')])
    for i in [6,7,8,9]:
        base['faces']['h0.'+str(i)]=dict(bands=[dict(z0=0,z1=T['projectionTop'],skin='courtLab')])
    d['blocks']=[base,upper]
    # A correctly bounded northern hip replaces only the old rectangle which
    # bridged the courtyard. Southern roof and rooftop detail remain legacy.
    d['excludeRoofIds']=['ca0207d3-bbf8-408d-a319-9407d7bd0dd2/0/p0']
    d['blocks'].append(dict(id='welch-north-hip',plan=[.85,94.15,134.05,156.65],z0=18.15,z1=18.2,
       bands=[dict(z0=18.15,z1=18.2,skin='trim')],roofTone='courtRoofTile',
       roof=dict(kind='hip',pitch=T['roofPitch'],over=.45,lipH=.18,tone='courtRoofTile')))
    # Lower sunken court and elevated terrace, following the footprint hole.
    box('courtPave',24,72,102.1,124.9,.08,.16)
    box('courtConcrete',34.0,70.0,112.0,124.95,T['terrace']-T['slab'],T['terrace'])
    for x in [35.3,43.0,50.7,58.4,66.1]:
        rod('courtConcrete',[x,112.65,.16],[x,112.65,T['terrace']-T['slab']],.24,10)
    # Stepped/tapered terrace edge, upper handrail and lower horizontal reveal.
    box('courtConcrete',34,70,111.72,112.03,T['terrace']-.6,T['terrace']+T['parapet'])
    box('courtStone',33.93,70.08,111.64,112.10,T['terrace']+T['parapet'],T['terrace']+T['parapet']+.1)
    rail([34.3,111.87,4.56],[69.6,111.87,4.56])
    box('courtConcrete',69.7,70,112,124.9,3.1,3.94)
    rail([69.85,112.1,4.56],[69.85,124.65,4.56])
    # Stair at the eastern terrace end. Individual treads, open underside not
    # an invented full-height wall, connect court and terrace.
    for j in range(18):
        y=104.8+j*.4;z=.16+(j+1)*(T['terrace']-.16)/18
        box('courtConcrete',66.5,69.5,y,y+.42,z-.19,z)
    for x in [66.55,69.45]:rail([x,104.85,1.06],[x,111.85,4.0])
    # Shade structure: two separate offset thin sloping roofs on circular posts.
    shade(114.0,118.25);shade(120.0,124.3)
    # Low historic cornice and real turned balusters on the three exposed sides.
    for a,b in [([39.36,125.15],[56.16,125.2]),([39.36,125.15],[39.44,132.95]),([56.16,125.2],[56.15,133.0])]:
        for dz,width,height in [(-.35,.44,.14),(-.17,.6,.16),(.02,.72,.13),(.88,.56,.16)]:
            beam('courtStone',[*a,T['projectionTop']+dz],[*b,T['projectionTop']+dz],width,height)
        n=math.floor(math.dist(a,b)/.44)
        for j in range(n+1):
            f=j/n;x=a[0]+(b[0]-a[0])*f;y=a[1]+(b[1]-a[1])*f
            turned('courtStone',x,y,T['projectionTop']+.1,[(0,.075),(.08,.08),(.19,.125),(.32,.115),(.48,.06),(.58,.07),(.68,.1)],6)
        # Stone piers/finials divide the balustrade rather than a solid slab.
        n=max(1,round(math.dist(a,b)/3.35))
        for j in range(n+1):
            f=j/n;x=a[0]+(b[0]-a[0])*f;y=a[1]+(b[1]-a[1])*f
            box('courtStone',x-.2,x+.2,y-.2,y+.2,12.75,13.65)
            turned('courtStone',x,y,13.7,[(0,.22),(.11,.22),(.13,.16),(.57,.105),(.62,.12)],4)
    # Small vents occupy a few blind arches, with horizontal dark louvres.
    for x in [41.05,47.75,54.45]:
        box('courtSteel',x-.6,x+.6,125.06,125.14,3.35,4.7)
        for j in range(10):box('courtRoof',x-.6,x+.6,125.01,125.08,3.4+j*.125,3.435+j*.125)
    # Exterior furniture seen under the canopy: thin round tables and benches.
    for x,y in [(56.7,116),(62.7,116),(57.1,122),(63.6,122)]:
        turned('courtFurniture',x,y,3.87,[(0,.78),(.055,.78)],12)
        rod('courtSteel',[x,y,3.1],[x,y,3.87],.055)
        for dx in [-1.05,1.05]:
            box('courtFurniture',x+dx-.18,x+dx+.18,y-.85,y+.85,3.53,3.59)
            for dy in [-.6,.6]:rod('courtSteel',[x+dx,y+dy,3.1],[x+dx,y+dy,3.53],.035)
    for x,y,s in [(35.3,122.8,1.0),(36,117.5,.8),(68.4,123.4,1.0),(68.4,113.0,.9)]:
        box('courtConcrete',x-.85,x+.85,y-.7,y+.7,3.1,3.65)
        box('courtSoil',x-.75,x+.75,y-.6,y+.6,3.64,3.66);plant(x,y,3.67,s)
    for x,y in [(26,106),(27,120),(30,105)]:plant(x,y,.16,1.3)
    # Existing exhaust plant is retained. The photographed pair stands above
    # the laboratory roof, with shallow segmented bands and capped tops.
    for x,y,r,height in [(78,129,.55,4.2),(80.5,130,.42,3.0)]:
        rod('metal',[x,y,18.2],[x,y,18.2+height],r,12)
        for j in range(1,5):turned('metal',x,y,18.2+j*height/5,[(0,r+.045),(.07,r+.045)],12)
    deepen_court(d,base,upper,h)
    d['detailMeshes']=list(M.values())
    d['courtyardParameters']=T
    d['sources']['courtyard']='Existing footprint fixes courtyard edges. Exterior architectural evidence informs lower historic projection, masonry arches/balustrade, deep multipane historic windows, contrasting narrow laboratory openings, recessed terrace entrance, steel shade canopies and a planted split-level terrace; small dimensions remain approximate.'
    d['open']=['Unphotographed elevations and small dimensions remain approximate.',
               'Historic sculpted ornament and planting are simplified. The court is a geometry approximation; no camera calibration or whole-building height inference was used.']
    for m in d['detailMeshes']:
        assert all(math.isfinite(x) for p in m['vertices'] for x in p)
        assert all(0<=i<len(m['vertices']) for t in m['triangles'] for i in t)
    total=sum(len(m['triangles']) for m in d['detailMeshes'])
    assert total<30000,total
    # Generated numeric buffers are compact; handwritten architectural fields
    # and the generator remain readable without 90,000 lines of brackets.
    packed=copy.deepcopy(d);replacements={}
    for i,m in enumerate(packed['detailMeshes']):
        for field in ['vertices','triangles']:
            token='__WELCH_BUFFER_'+str(i)+'_'+field+'__'
            replacements[json.dumps(token)]=json.dumps(m[field],separators=(',',':'))
            m[field]=token
    text=json.dumps(packed,indent=2)
    for token,buffer in replacements.items():text=text.replace(token,buffer)
    PATH.write_text(text+'\n',encoding='utf-8')
    print('Welch courtyard:',total,'detail triangles;',len(d['blocks']),'blocks')


if __name__=='__main__':main()
