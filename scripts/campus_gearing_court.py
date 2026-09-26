"""Permanent Gearing court architecture; exterior proportions are approximate.

The mapped U plan and separately baked main roof stay authoritative. Every
addition is baked through campus_buildings, with no runtime special renderer.
"""
import copy
import math

T = dict(
    grade=1.57, lowerRows=[[5.12, 6.84], [7.75, 9.53]],
    groups=[2, 3, 2, 3, 2], sashWidth=1.02, withinGap=.52,
    groupGap=1.24, sashDepth=.32, sashFrame=.07, sashFrameDepth=.085,
    sashBars=.028, sashCols=[1/3, 2/3], sashRows=[.25, .5, .75],
    jamb=.16, lintel=.25, stoneProud=.07, sill=.105,
    lowerBandTop=9.9,
    rearDoorCentre=12.068063017734, rearDoorWidth=2.5, rearDoorSpring=3.18,
    rearDoorCrown=4.43, rearDoorDepth=.64, doorBars=.045,
    arcadeDepth=2.15, arcadeEave=4.25, arcadeHigh=4.85,
    arcadeTile=.12, arcadeBeam=.18, arcadePost=.36,
    rearPosts=[1.9, 6.1, 9.8, 14.7, 18.4, 22.6],
    sidePostV=[4.2, 8.6, 12.7], sideArchV=1.2,
    sideArchWidth=2.25, sideArchSpring=3.10, sideArchCrown=4.225,
    sideArchDepth=.46, sideArchHead=4.63,
    gateCentre=26.1, gateV=.3, gateOpening=5., gatePier=1.05,
    gatePierDepth=1.1, gatePierHeight=3.35, gateCap=.16,
    gateCapOut=.13, gateUrnHeight=.88, gateUrnRadius=.37,
    gateMetalDepth=.045, gateLeafWidth=.93, gateBarPitch=.16,
    gateBar=.025, gateHeight=2.96, gateFrieze=.57,
    gateCurlRadius=.092, gateCurlPitch=.245, gateCurlSegments=12,
    boundaryHeight=1.22, boundaryDepth=.45, boundaryCoping=.15,
    stairCount=10, stairRun=3.2, stairWidth=6.,
    railRadius=.024, railHeight=.94, stairRailPosts=5,
    towerRects=[[8.7, 14.2, 16.75, 22.1], [38.2, 43.7, 16.82, 22.17]],
    towerBottom=13.55, towerTop=19.55, towerCorniceOut=.42,
    towerCorniceDepth=.26, towerTile=.14,
    towerOpeningWidth=.95, towerOpeningBottom=17.27,
    towerOpeningTop=18.95, towerOpeningRise=.475,
    towerChimneyWidth=.75, towerChimneyHeight=1.05,
    balconyV=[.5, 4.9], balconyBase=8.07, balconyProjection=.90,
    balconySlab=.20, balconyRail=.96, balconyCorbelDrop=.56,
    balconyBarPitch=.18, balconyCorbelPitch=1.15,
    sideUpperRow=[11.38, 12.96], balconyDoorTop=10.25, doorStile=.065,
    lanternWidth=.30, lanternHeight=.56, lanternZ=4.18,
    maxDetailTriangles=22000,
)
COLOURS = dict(geaLowerSash='#a69264', geaCourtGlass='#47534e',
    geaAshlar='#c9bda6', geaIron='#30312d', geaDoor='#393b32',
    geaLantern='#857854')
MATERIALS = dict(geaLowerSash='plain', geaCourtGlass='glass',
    geaAshlar='stone', geaIron='plain', geaDoor='plain', geaLantern='plain')
BOX_FACES = [(0,1,2,3),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]


def refine_court(model, profile, Details):
    t = copy.deepcopy({**T, **profile.get('gearingCourt', {})})
    model['colours'].update({k: dict(hex=v) for k,v in
                             {**COLOURS, **profile.get('gearingCourtColours', {})}.items()})
    model['materials'].update(MATERIALS)
    model['skins']['geaCourtWall'] = dict(kind='flat', field='geaAshlar')
    model['skins']['geaTowerWall'] = dict(kind='flat', field='geaAshlar')
    wall = model['blocks'][0]
    ring = wall['plan']['ring']
    a,b = ring[3],ring[5]
    length = math.dist(a,b)
    axis = [(b[k]-a[k])/length for k in range(2)]
    rear = Details(a, axis)
    world = Details([0,0], [1,0])  # s=u, d=-v
    batches = [rear, world]
    grade = t['grade']

    def box(tone, u0,u1,v0,v1,z0,z1):
        world.box(tone,u0,u1,-v1,-v0,z0,z1)

    def prism(m,tone,polygon,d0,d1):
        n=len(polygon)
        m.solid(tone,[[s,d,z] for d in (d0,d1) for s,z in polygon],
                [tuple(range(n)),tuple(range(n,2*n))]+
                [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)])

    def archwall(m,centre,width,base,spring,crown,head,d0,d1,tone='geaAshlar',jamb=.30):
        """Solid piers and spandrels around an actually empty curved passage."""
        r=width/2
        for x0,x1 in ((centre-r-jamb,centre-r),(centre+r,centre+r+jamb)):
            m.box(tone,x0,x1,d0,d1,base,head)
        for i in range(24):
            q0=math.pi-i*math.pi/24;q1=math.pi-(i+1)*math.pi/24
            x0=centre+r*math.cos(q0);x1=centre+r*math.cos(q1)
            z0=spring+(crown-spring)*math.sin(q0)
            z1=spring+(crown-spring)*math.sin(q1)
            prism(m,tone,[(x0,z0),(x1,z1),(x1,head),(x0,head)],d0,d1)

    def bar(m,tone,a,b,r):
        dx,dz=b[0]-a[0],b[1]-a[1]
        L=math.hypot(dx,dz)
        nx,nz=-dz/L*r,dx/L*r
        prism(m,tone,[(a[0]+nx,a[1]+nz),(b[0]+nx,b[1]+nz),
                     (b[0]-nx,b[1]-nz),(a[0]-nx,a[1]-nz)],-.025,.025)

    def turn(m,tone,c,depth,z,levels,sides=16):
        # Each closed frustum has a positive volume; adjacent caps meet.
        for (h0,r0),(h1,r1) in zip(levels,levels[1:]):
            pts=[[c+r*math.cos(i*math.tau/sides),depth+r*math.sin(i*math.tau/sides),z+h]
                 for h,r in ((h0,r0),(h1,r1)) for i in range(sides)]
            m.solid(tone,pts,[tuple(range(sides)),tuple(range(sides,2*sides))]+
                    [(i,(i+1)%sides,(i+1)%sides+sides,i+sides) for i in range(sides)])

    # Five groups run continuously across the redundant rear-wall vertex.
    total=sum(t['groups'])*t['sashWidth']+(sum(t['groups'])-len(t['groups']))*t['withinGap']+(len(t['groups'])-1)*t['groupGap']
    cursor=(length-total)/2
    centres=[]
    for n in t['groups']:
        for i in range(n):
            centres.append(cursor+t['sashWidth']/2)
            cursor+=t['sashWidth']+t['withinGap']
        cursor+=t['groupGap']-t['withinGap']
    assert len(centres)==12
    rows=t['lowerRows']
    for edge in (3,4):
        p,q=ring[edge],ring[edge+1]
        start=sum((p[k]-a[k])*axis[k] for k in range(2))
        L=math.dist(p,q)
        holes=[]
        for row,(z0,z1) in enumerate(rows):
            for i,c in enumerate(centres):
                s=c-start;hw=t['sashWidth']/2
                if 0<s<L:
                    assert s-hw>0 and s+hw<L, 'Grouped sash must clear rear split'
                    holes.append(dict(s0=s-hw,s1=s+hw,z0=z0,z1=z1,d=t['sashDepth'],
                        glass='geaCourtGlass',tone='geaAshlar',lit=(i+row)%4==1,
                        mullion=dict(cols=t['sashCols'],rows=t['sashRows'],w=t['sashBars'],tone='geaLowerSash')))
        # Cut the rectangular door envelope on both halves. The detailed
        # curved spandrel below supplies one continuous arch across the split.
        lo=t['rearDoorCentre']-t['rearDoorWidth']/2-start
        hi=lo+t['rearDoorWidth']
        holes.append(dict(s0=max(0,lo),s1=min(L,hi),z0=grade,
                          z1=t['rearDoorCrown']+.05,d=t['rearDoorDepth'],tone='geaDoor'))
        upper=wall['faces'][str(edge)]['bands'][-1]
        upper['z0']=t['lowerBandTop']
        wall['faces'][str(edge)]['bands']=[dict(z0=0,z1=t['lowerBandTop'],skin='geaCourtWall',openings=holes),upper]
    for z0,z1 in rows:
        for c in centres:
            lo,hi=c-t['sashWidth']/2,c+t['sashWidth']/2
            fw=t['sashFrame'];back=-t['sashDepth']+.015
            for x0,x1 in ((lo,lo+fw),(hi-fw,hi)):
                rear.box('geaLowerSash',x0,x1,back,back+t['sashFrameDepth'],z0,z1)
            for z in (z0,z1-fw):
                rear.box('geaLowerSash',lo+fw,hi-fw,back,back+t['sashFrameDepth'],z,z+fw)
            for x0,x1 in ((lo-t['jamb'],lo),(hi,hi+t['jamb'])):
                rear.box('geaPale',x0,x1,-.025,t['stoneProud'],z0,z1)
            rear.box('geaPale',lo-t['jamb'],hi+t['jamb'],-.025,t['stoneProud'],z1,z1+t['lintel'])
            rear.box('geaPale',lo-t['jamb'],hi+t['jamb'],-.025,t['sill'],z0-t['sill'],z0)
    archwall(rear,t['rearDoorCentre'],t['rearDoorWidth'],grade,t['rearDoorSpring'],
             t['rearDoorCrown'],t['rearDoorCrown']+.16,-t['rearDoorDepth']+.02,.055,jamb=.26)
    c=t['rearDoorCentre'];hw=t['rearDoorWidth']/2
    # Dark glazed paired doors with straight lower rails and a curved transom.
    for i in range(9):
        s=c-hw+(i+.5)*2*hw/9
        top=t['rearDoorSpring']+(t['rearDoorCrown']-t['rearDoorSpring'])*math.sqrt(max(0,1-((s-c)/hw)**2))
        rear.box('geaIron',s-t['doorBars']/2,s+t['doorBars']/2,-.61,-.55,grade+.02,top-.02)
    for z in (grade+.10,grade+.95,t['rearDoorSpring']):
        rear.box('geaIron',c-hw,c+hw,-.61,-.55,z,z+t['doorBars'])
    # The mapped rear wall has a redundant vertex through this doorway.
    # Its two renderer jambs are buried inside one intentional door stile.
    assert abs(c-math.dist(ring[3],ring[4])) < .001
    rear.box('geaDoor',c-t['doorStile']/2,c+t['doorStile']/2,
             -t['rearDoorDepth'],.06,grade,t['rearDoorCrown'])

    # Rear lean-to, closed tile skin and soffit, with modest inward side roofs.
    def roof(m,s0,s1,d0,d1,z0,z1):
        points=[[s,d,z] for s,d,z in ((s0,d0,z0),(s1,d0,z0),(s1,d1,z1),(s0,d1,z1))]
        m.solid('geaTile',[[s,d,z-t['arcadeTile']] for s,d,z in points]+points,BOX_FACES)
        m.solid('geaSoffit',[[s,d,z-t['arcadeTile']-.09] for s,d,z in points]+[[s,d,z-t['arcadeTile']] for s,d,z in points],BOX_FACES)
    roof(rear,0,length,-.06,t['arcadeDepth'],t['arcadeHigh'],t['arcadeEave'])
    rear.box('geaTimber',0,length,t['arcadeDepth']-.15,t['arcadeDepth']-.01,t['arcadeEave']-.30,t['arcadeEave']-.12)
    for c in t['rearPosts']:
        p=t['arcadePost']/2
        rear.box('geaAshlar',c-p,c+p,t['arcadeDepth']-.30,t['arcadeDepth']+.06,grade,t['arcadeEave']-.26)
    for edge in (2,5):
        p,q=ring[edge],ring[edge+1];L=math.dist(p,q)
        m=Details(p,[(q[k]-p[k])/L for k in range(2)]);batches.append(m)
        roof(m,.04,L,-.06,t['arcadeDepth'],t['arcadeHigh'],t['arcadeEave'])
        m.box('geaTimber',0,L,t['arcadeDepth']-.15,t['arcadeDepth']-.01,t['arcadeEave']-.30,t['arcadeEave']-.12)
        for v in t['sidePostV']:
            s=v if edge==2 else L-v
            m.box('geaAshlar',s-.18,s+.18,t['arcadeDepth']-.30,t['arcadeDepth']+.06,grade,t['arcadeEave']-.26)
        # Inner sidewalls use rectangular lower sash, not generic ground arches.
        openings=[]
        for row,(base,head) in enumerate(rows+[t['sideUpperRow']]):
            for i in range(6):
                s=(i+.5)*L/6;w=t['sashWidth']
                z0,z1=base,head
                v=s if edge==2 else L-s
                if row==1 and t['balconyV'][0]<v<t['balconyV'][1]:
                    z0=t['balconyBase']+t['balconySlab'];z1=t['balconyDoorTop']
                openings.append(dict(s0=s-w/2,s1=s+w/2,z0=z0,z1=z1,d=t['sashDepth'],glass='geaCourtGlass',tone='geaAshlar',lit=i%4==2,
                    mullion=dict(cols=[.5],rows=t['sashRows'],w=t['sashBars'],tone='geaLowerSash')))
                lo,hi=s-w/2,s+w/2;fw=t['sashFrame'];back=-t['sashDepth']+.015
                for x0,x1 in ((lo,lo+fw),(hi-fw,hi)):
                    m.box('geaLowerSash',x0,x1,back,back+t['sashFrameDepth'],z0,z1)
                for z in (z0,z1-fw):
                    m.box('geaLowerSash',lo+fw,hi-fw,back,back+t['sashFrameDepth'],z,z+fw)
                for x0,x1 in ((lo-t['jamb'],lo),(hi,hi+t['jamb'])):
                    m.box('geaPale',x0,x1,-.025,t['stoneProud'],z0,z1)
                m.box('geaPale',lo-t['jamb'],hi+t['jamb'],-.025,t['stoneProud'],z1,z1+t['lintel'])
                m.box('geaPale',lo-t['jamb'],hi+t['jamb'],-.025,t['sill'],z0-t['sill'],z0)
        wall.setdefault('faces',{})[str(edge)]=dict(bands=[dict(z0=0,z1=wall['z1'],skin='geaCourtWall',openings=openings)])
        # The transverse entrance arch is at the mouth, beneath a sloped cap.
        u=ring[2][0]+t['arcadeDepth']/2 if edge==2 else ring[6][0]-t['arcadeDepth']/2
        arch=Details([u,t['sideArchV']],[1,0]);batches.append(arch)
        archwall(arch,0,t['sideArchWidth'],grade,t['sideArchSpring'],t['sideArchCrown'],t['sideArchHead'],-t['sideArchDepth']/2,t['sideArchDepth']/2,jamb=.30)
        roof(arch,-t['sideArchWidth']/2-.38,t['sideArchWidth']/2+.38,-.31,.31,t['sideArchHead']+.15,t['sideArchHead']+.10)

    # Gate piers and boundary sit on the same terrace as the rear door.
    gate=Details([t['gateCentre'],t['gateV']],[1,0]);batches.append(gate)
    half=t['gateOpening']/2;pw=t['gatePier'];pd=t['gatePierDepth']/2
    for side in (-1,1):
        c=side*(half+pw/2)
        gate.box('geaAshlar',c-pw/2,c+pw/2,-pd,pd,grade,grade+t['gatePierHeight'])
        for h in [.18,.80,1.45,2.12,2.8]:
            gate.box('geaPale',c-pw/2-.012,c+pw/2+.012,-pd-.012,pd+.012,grade+h,grade+h+.035)
        out=t['gateCapOut'];cap=grade+t['gatePierHeight']
        gate.box('geaPale',c-pw/2-out,c+pw/2+out,-pd-out,pd+out,cap,cap+t['gateCap'])
        r=t['gateUrnRadius'];h=t['gateUrnHeight']
        turn(gate,'geaPale',c,0,cap+t['gateCap'],[(0,r*.55),(.12*h,r*.58),(.24*h,r*.4),(.62*h,r),(.83*h,r*.72),(.91*h,r*.34),(h,r*.13)])
        # Lantern body, projecting bracket, peaked metal cap and four slender stiles.
        w=t['lanternWidth'];z=t['lanternZ'];d=pd+.17
        gate.box('geaIron',c-.045,c+.045,pd-.01,d,z-.28,z+.15)
        gate.box('geaLantern',c-w/2,c+w/2,d,d+w*.6,z,z+t['lanternHeight'])
        for x in (c-w/2,c+w/2-.025):
            gate.box('geaIron',x,x+.025,d-.015,d+w*.6+.015,z,z+t['lanternHeight'])
        for zz in (z,z+t['lanternHeight']):
            gate.box('geaIron',c-w*.6,c+w*.6,d-.035,d+w*.6+.035,zz,zz+.05)
    # Open central passage; narrow fixed side leaves and a decorative frieze.
    bottom=grade+.05;top=grade+t['gateHeight'];leaf=t['gateLeafWidth']
    for x0,x1 in ((-half,-half+leaf),(half-leaf,half)):
        for z in (bottom,bottom+.45,top-t['gateFrieze']):
            gate.box('geaIron',x0,x1,-.025,.025,z,z+.05)
        n=math.ceil((x1-x0)/t['gateBarPitch'])
        for i in range(n+1):
            x=x0+(x1-x0)*i/n
            gate.box('geaIron',x-t['gateBar']/2,x+t['gateBar']/2,-.025,.025,bottom,top)
    for z in (top-t['gateFrieze'],top):
        gate.box('geaIron',-half,half,-.04,.04,z,z+.05)
    count=int(t['gateOpening']/t['gateCurlPitch'])
    for i in range(count):
        c=-half+(i+.5)*t['gateOpening']/count
        gate.box('geaIron',c-.012,c+.012,-.025,.025,top-t['gateFrieze'],top)
        for z,flip in ((top-.15,1),(top-t['gateFrieze']+.15,-1)):
            pts=[]
            for j in range(t['gateCurlSegments']+1):
                f=j/t['gateCurlSegments'];angle=flip*f*math.tau*1.1;r=t['gateCurlRadius']*(1-.65*f)
                pts.append([c+r*math.cos(angle),z+r*math.sin(angle)])
            for p,q in zip(pts,pts[1:]):bar(gate,'geaIron',p,q,.009)
    # Boundary stops short of the retained ramp, leaving its toe reachable.
    for u0,u1 in ((16.2,t['gateCentre']-half-pw),(t['gateCentre']+half+pw,30.72),(32.80,36.2)):
        box('geaAshlar',u0,u1,t['gateV']-.22,t['gateV']+.23,0,grade+t['boundaryHeight'])
        box('geaPale',u0-.03,u1+.03,t['gateV']-.29,t['gateV']+.30,grade+t['boundaryHeight'],grade+t['boundaryHeight']+t['boundaryCoping'])
    # Ten shallow approach treads. Their exact rectangles also feed walking
    # support through the landscape bake; do not alter one without the other.
    for i in range(t['stairCount']):
        v=t['gateV']-t['stairRun']+i*t['stairRun']/t['stairCount']
        box('geaPale',t['gateCentre']-t['stairWidth']/2,t['gateCentre']+t['stairWidth']/2,v,t['gateV'],0,grade*(i+1)/t['stairCount'])
    # Rails run with the actual stair rise and finish at the gate landing.
    for u in (t['gateCentre']-t['stairWidth']/2+.10,t['gateCentre']+t['stairWidth']/2-.10):
        rail=Details([u,t['gateV']-t['stairRun']],[0,1]);batches.append(rail)
        bar(rail,'geaIron',[0,t['railHeight']],[t['stairRun'],grade+t['railHeight']],t['railRadius'])
        for j in range(t['stairRailPosts']):
            f=j/(t['stairRailPosts']-1);s=f*t['stairRun'];z=grade*f
            rail.box('geaIron',s-.025,s+.025,-.025,.025,z,z+t['railHeight'])

    # Raised tower walls are seated through the original roof at its wing
    # junctions. Closed shallow projecting caps replace unsupported pyramids.
    model['blocks']=[b for b in model['blocks'] if not b['id'].startswith('gea-court-tower')]
    for i,(u0,u1,v0,v1) in enumerate(t['towerRects']):
        w=u1-u0;opening=dict(s0=w/2-t['towerOpeningWidth']/2,s1=w/2+t['towerOpeningWidth']/2,
            z0=t['towerOpeningBottom'],z1=t['towerOpeningTop'],d=.28,
            glass='geaCourtGlass',tone='geaAshlar',lit=False,
            arch=dict(rise=t['towerOpeningRise'],trim=.13,tone='geaLowerSash',segments=16),
            mullion=dict(cols=[.5] if i==0 else [],rows=[.45] if i==0 else [.25,.35,.45,.55,.65,.75],w=.035,tone='geaLowerSash' if i==0 else 'geaIron'))
        model['blocks'].append(dict(id='gea-court-tower-'+str(i),plan=dict(ring=[[u0,v0],[u1,v0],[u1,v1],[u0,v1]],holes=[]),
            z0=t['towerBottom'],z1=t['towerTop'],bands=[dict(z0=t['towerBottom'],z1=t['towerTop'],skin='geaTowerWall')],
            faces={'0':dict(bands=[dict(z0=t['towerBottom'],z1=t['towerTop'],skin='geaTowerWall',openings=[opening])])},cap=True,roofTone='geaTile'))
        out=t['towerCorniceOut'];z=t['towerTop']
        box('geaPale',u0-out*.7,u1+out*.7,v0-out*.7,v1+out*.7,z-.16,z+.04)
        box('geaTimber',u0-out,u1+out,v0-out,v1+out,z+.04,z+t['towerCorniceDepth'])
        box('geaTile',u0-out-.04,u1+out+.04,v0-out-.04,v1+out+.04,z+t['towerCorniceDepth'],z+t['towerCorniceDepth']+t['towerTile'])
        cw=t['towerChimneyWidth'];cx=(u1-cw) if i==0 else u0
        box('geaAshlar',cx,cx+cw,v1-cw,v1,z,z+t['towerChimneyHeight'])
        box('geaTile',cx-.12,cx+cw+.12,v1-cw-.12,v1+.12,z+t['towerChimneyHeight'],z+t['towerChimneyHeight']+.12)
    # Shallow supported side balconies at the courtyard mouth.
    for edge in (2,5):
        p,q=ring[edge],ring[edge+1];L=math.dist(p,q);m=Details(p,[(q[k]-p[k])/L for k in range(2)]);batches.append(m)
        s0,s1=t['balconyV'] if edge==2 else [L-t['balconyV'][1],L-t['balconyV'][0]]
        z=t['balconyBase'];d=t['balconyProjection']
        m.box('geaPale',s0,s1,-.06,d,z,z+t['balconySlab'])
        for ss in [s0+(s1-s0)*j/4 for j in range(5)]:
            prism(m,'geaPale',[(ss-.11,z),(ss+.11,z),(ss+.11,z-t['balconyCorbelDrop']),(ss-.11,z-t['balconyCorbelDrop'])],-.04,.23)
            m.solid('geaPale',[[s,dd,zz] for s in (ss-.12,ss+.12) for dd,zz in ((-.04,z),(.77*d,z),(.24,z-t['balconyCorbelDrop']),(-.04,z-t['balconyCorbelDrop']))],
                    [(0,1,2,3),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
        zr=z+t['balconySlab'];n=math.ceil((s1-s0)/t['balconyBarPitch'])
        for j in range(n+1):
            s=s0+(s1-s0)*j/n;m.box('geaIron',s-.016,s+.016,d-.04,d,zr,zr+t['balconyRail'])
        m.box('geaIron',s0,s1,d-.065,d+.025,zr+t['balconyRail'],zr+t['balconyRail']+.045)
        for ss in (s0,s1):
            m.box('geaIron',ss-.025,ss+.025,0,d,zr+t['balconyRail'],zr+t['balconyRail']+.045)
            for j in range(1,5):m.box('geaIron',ss-.016,ss+.016,d*j/5-.016,d*j/5+.016,zr,zr+t['balconyRail'])
    # Merge tones into a bounded number of detail batches.
    merged={}
    for batch in batches:
        for tone,m in batch.meshes.items():
            dest=merged.setdefault(tone,dict(id='gea-court-'+tone,tone=tone,vertices=[],triangles=[]))
            offset=len(dest['vertices']);dest['vertices'].extend(m['vertices'])
            dest['triangles'].extend([[offset+i for i in tri] for tri in m['triangles']])
    meshes=list(merged.values())
    assert sum(len(m['triangles']) for m in meshes)<=t['maxDetailTriangles']
    model['detailMeshes'].extend(meshes)
    model['gearingCourtParameters']=t
    model['sources']['gearingCourt']='Permanent exterior form: grouped rectangular sash, curved court entrance, covered walks, raised mouth gate and shallow tower caps. Editable proportions and absolute grade are approximate; unseen plan remains conservative.'
    model['open']=[s for s in model['open'] if not s.startswith('Gearing towers, roof vents')]
    model['open'].append('Gearing hidden elevations, exact masonry profiles, gate mechanisms, roof vents and measured ground survey remain unverified.')
    return model
