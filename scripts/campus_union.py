"""Bounded south entrance-tower refinement for the existing Union model.

Exterior proportions are interpretations, not survey measurements. The mapped
plan, wing elevations and roof remain authoritative. No source imagery or
private camera information belongs in this baked specification.
"""
import copy
import math

from campus_gearing import Details


T = dict(
    towerPlan=[20.3, 33.4, 0., 13.5], towerTop=18.3,
    coveredFaces=[14, 15, 16, 17, 18], overlapTolerance=.06,
    portalBottom=1.5, portalTop=9.05, portalWidth=4.9,
    portalRise=2.45, portalDepth=1.35, portalRim=.27,
    portalRimProud=.10, archSegments=32,
    portalColumnOffset=3.18, portalColumnRadius=.24,
    portalColumnTopRadius=.21, portalColumnProud=.18,
    portalColumnBottom=2.15, portalColumnTop=8.98, portalColumnSides=16,
    portalColumnBaseWidth=.77, portalColumnBaseDepth=.56,
    portalColumnBaseTop=2.15, portalCapitalHeight=.25,
    portalEntablatureWidth=7.3, portalEntablatureDepth=.60,
    portalEntablatureBottom=9.23, portalEntablatureTop=9.48,
    vaultFront=-.16, vaultClearance=.022, vaultShell=.065,
    doorWidth=2.42, doorSpring=4.72, doorRise=1.21,
    doorBackClearance=.035, doorFrame=.11, doorFrameDepth=.11,
    doorRailZ=[1.72, 2.65, 4.72], doorRail=.10,
    doorPaneInset=.13, doorPanelTop=2.65, fanBars=7,
    sashFrame=.085, sashDepth=.075, sashBar=.033,
    sashCols=[.5], sashRows=[.25, .5, .75], windowLit=False,
    balconyBottom=9.69, balconyTop=12.62, balconyDepth=.46,
    balconyDoorWidth=2.2, balconyFlankWidth=.83, balconyFlankOffset=2.03,
    balconySlabZ=9.48, balconySlabThickness=.21,
    balconyWidth=5.3, balconyProjection=.78, balconyBulge=.28,
    balconySlabBack=-.16, balconyGuardHeight=1.04,
    balconyGuardBar=.033, balconyGuardBars=27, balconyCurveSegments=24,
    balconyReturnBars=4,
    balconyBracketCentres=[-1.93, -.88, .88, 1.93],
    balconyBracketWidth=.23,
    balconyBracketProfile=[[-.10, 0], [.82, 0], [.82, -.17],
                           [.51, -.27], [.27, -.68], [-.10, -.68]],
    balconyJamb=.19, balconyHead=.25, balconySurroundProud=.14,
    balconyLintelWidth=5.35, balconyLintelZ=12.84,
    balconyLintelHeight=.20, balconyLintelProjection=.25,
    upperBottom=14.15, upperTop=17.63, upperDepth=.70,
    upperWidth=1.92, upperCentres=[1.75, 4.95, 8.15, 11.35],
    upperCourseZ=13.85, upperCourseHeight=.20, upperCourseProud=.18,
    upperCapitalWidth=2.20, upperCapitalHeight=.15,
    upperCapitalProud=.10, louverPitch=.115, louverThickness=.045,
    louverDepth=.10, louverSlope=.035,
    eaveOver=.75, eaveBottom=17.98, eaveTop=18.06,
    eaveBeamHeight=.14, eaveBeamDepth=.105,
    eaveBracketCountFront=14, eaveBracketCountSide=14,
    eaveBracketWidth=.17,
    eaveBracketProfile=[[-.14, 0], [.73, 0], [.73, -.12],
                       [.48, -.20], [.21, -.48], [-.14, -.48]],
    eaveCornerInset=.34, wallEmbed=.018, clearance=.015,
    maxDetailTriangles=12000,
)
COLOURS = dict(unionStone='#d8d0bc', unionPale='#e0d8c5',
    unionVault='#b96524', unionDoor='#694332', unionGlass='#374548',
    unionLouver='#343833', unionIron='#414640',
    unionTimber='#765039', unionSoffit='#a67750', unionFascia='#494137')
MATERIALS = dict(unionStone='stone', unionPale='stone', unionVault='plain',
    unionDoor='plain', unionGlass='glass', unionLouver='plain',
    unionIron='plain', unionTimber='plain', unionSoffit='plain', unionFascia='plain')


def refine(model):
    """Return an independent refined Union specification; never mutate input."""
    assert model['id'] == '8a2648f5-9994-4d01-9b12-5c589b863c5a'
    result = copy.deepcopy(model)
    assert not result.get('unionEntrance'), 'Refine the original Union baseline once'
    t = copy.deepcopy(T)
    blocks = {b['id']: b for b in result['blocks']}
    tower, wing, eave = (blocks[k] for k in ('entrance-tower', 'main-wings', 'tower-eave'))
    assert tower['plan'] == t['towerPlan'] and tower['z1'] == t['towerTop']
    u0, u1, v0, v1 = tower['plan']
    width = u1-u0
    centre = width/2
    result['colours'].update({k: dict(hex=v) for k, v in COLOURS.items()})
    result.setdefault('materials', {}).update(MATERIALS)
    result['skins']['unionTowerStone'] = dict(kind='flat', field='unionStone')
    result['skins']['unionEaveDark'] = dict(kind='flat', field='unionFascia')

    # These short returns and front edges are the original footprint's tower
    # notch, not a separate facade behind its vestibule. The rectangle differs
    # from the measured vertices by millimetres; retain all adjoining wings.
    ring = wing['plan']['ring']
    assert len(ring) == 29, 'Re-audit the Union footprint topology'
    tol = t['overlapTolerance']
    for edge in t['coveredFaces']:
        for u, v in (ring[edge], ring[(edge+1) % len(ring)]):
            assert u0-tol <= u <= u1+tol and v0-tol <= v <= v1+tol
        wing.setdefault('faces', {})[str(edge)] = None

    # Details use u increasing left-to-right on the south elevation and d
    # outward (negative v). Renderer v0 openings instead start at high u.
    front = Details([u0, v0], [1, 0])
    batches = [front]
    solids = []

    def solid(m, tone, points, faces, role):
        before = len(m.meshes.get(tone, {}).get('vertices', []))
        m.solid(tone, points, faces)
        solids.append(dict(batch=batches.index(m), tone=tone, start=before,
                           count=len(points), role=role))

    def box(m, tone, a, b, d0, d1, z0, z1, role):
        assert b > a and d1 > d0 and z1 > z0
        solid(m, tone, [[s, d, z] for z in (z0, z1)
              for s, d in ((a,d0),(b,d0),(b,d1),(a,d1))],
              [(0,1,2,3),(4,5,6,7),(0,1,5,4),(1,2,6,5),
               (2,3,7,6),(3,0,4,7)], role)

    def prism(m, tone, polygon, d0, d1, role):
        n = len(polygon)
        solid(m, tone, [[s,d,z] for d in (d0,d1) for s,z in polygon],
              [tuple(range(n)), tuple(range(n,2*n))] +
              [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)], role)

    def plan_prism(m, tone, polygon, z0, z1, role):
        n = len(polygon)
        solid(m, tone, [[s,d,z] for z in (z0,z1) for s,d in polygon],
              [tuple(range(n)), tuple(range(n,2*n))] +
              [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)], role)

    def opening(c, w, z0, z1, depth, *, glass=True, arch=None):
        out = dict(s0=width-c-w/2, s1=width-c+w/2, z0=z0,z1=z1,
                   d=depth,tone='unionStone',lit=t['windowLit'])
        if glass:
            out['glass'] = 'unionGlass'
        if arch:
            out['arch'] = arch
        return out

    portal = opening(centre,t['portalWidth'],t['portalBottom'],t['portalTop'],
        t['portalDepth'],glass=False,arch=dict(rise=t['portalRise'],
        tone='unionPale',trim=t['portalRim'],proud=t['portalRimProud'],
        segments=t['archSegments']))
    portal['tone'] = 'unionVault'
    balcony_centres = [centre-t['balconyFlankOffset'],centre,centre+t['balconyFlankOffset']]
    balcony_widths = [t['balconyFlankWidth'],t['balconyDoorWidth'],t['balconyFlankWidth']]
    balcony_openings = [opening(c,w,t['balconyBottom'],t['balconyTop'],t['balconyDepth'])
                         for c,w in zip(balcony_centres,balcony_widths)]
    upper = [opening(c,t['upperWidth'],t['upperBottom'],t['upperTop'],t['upperDepth'])
             for c in t['upperCentres']]
    upper[0].pop('glass')
    upper[0]['tone'] = 'unionLouver'
    tower.setdefault('faces', {})['v0'] = dict(bands=[
        dict(z0=0,z1=t['towerTop'],skin='unionTowerStone',
             openings=[portal]+balcony_openings+upper)])

    # Stone front arch is native geometry. A slightly smaller orange shell
    # sits ahead of its curved soffit only inside the vestibule, leaving a
    # genuinely stone mouth. Every shell wedge is an independent closed solid.
    r = t['portalWidth']/2-t['vaultClearance']
    rise = t['portalRise']-t['vaultClearance']
    spring = t['portalTop']-t['portalRise']
    depth = -t['portalDepth']+t['clearance']
    for i in range(t['archSegments']):
        a,b = (math.pi*j/t['archSegments'] for j in (i,i+1))
        def p(angle, dr):
            return [centre+(r+dr)*math.cos(angle),spring+(rise+dr)*math.sin(angle)]
        prism(front,'unionVault',[p(a,0),p(b,0),p(b,t['vaultShell']),p(a,t['vaultShell'])],
              depth,t['vaultFront'],'vault')
    for side in (-1,1):
        x=centre+side*t['portalWidth']/2
        lo,hi=(x-t['portalRim'],x) if side<0 else (x,x+t['portalRim'])
        box(front,'unionPale',lo,hi,t['vaultFront'],t['portalRimProud'],
            t['portalBottom'],spring,'portal-stone-jamb')
        c=centre+side*t['portalColumnOffset']; n=t['portalColumnSides']
        points=[[c+r*math.cos(i*math.tau/n),t['portalColumnProud']+r*math.sin(i*math.tau/n),z]
                for r,z in ((t['portalColumnRadius'],t['portalColumnBottom']),
                            (t['portalColumnTopRadius'],t['portalColumnTop'])) for i in range(n)]
        solid(front,'unionPale',points,[tuple(range(n)),tuple(range(n,2*n))]+
              [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],'portal-column')
        half_base=t['portalColumnBaseWidth']/2
        box(front,'unionPale',c-half_base,c+half_base,-t['wallEmbed'],t['portalColumnBaseDepth'],
            t['portalBottom'],t['portalColumnBaseTop'],'portal-base')
        box(front,'unionPale',c-half_base,c+half_base,-t['wallEmbed'],t['portalColumnBaseDepth'],
            t['portalColumnTop'],t['portalColumnTop']+t['portalCapitalHeight'],'portal-capital')
    box(front,'unionPale',centre-t['portalEntablatureWidth']/2,centre+t['portalEntablatureWidth']/2,
        -t['wallEmbed'],t['portalEntablatureDepth'],t['portalEntablatureBottom'],
        t['portalEntablatureTop'],'portal-entablature')

    # Inner timber door with arched glazed transom, not mullions across the
    # outer vestibule. Its backing sits ahead of the orange rear wall.
    dc = -t['portalDepth']+t['doorBackClearance']
    dr = t['doorWidth']/2
    door_bottom, door_spring = t['portalBottom'],t['doorSpring']
    box(front,'unionGlass',centre-dr,centre+dr,dc,dc+t['clearance'],
        door_bottom,door_spring,'inner-door-glass')
    for i in range(t['archSegments']):
        a,b = (math.pi*j/t['archSegments'] for j in (i,i+1))
        p0=[centre+dr*math.cos(a),door_spring+t['doorRise']*math.sin(a)]
        p1=[centre+dr*math.cos(b),door_spring+t['doorRise']*math.sin(b)]
        prism(front,'unionGlass',[[centre,door_spring],p0,p1],dc,dc+t['clearance'],'transom-glass')
        prism(front,'unionDoor',[p0,p1,
            [centre+(dr+t['doorFrame'])*math.cos(b),door_spring+(t['doorRise']+t['doorFrame'])*math.sin(b)],
            [centre+(dr+t['doorFrame'])*math.cos(a),door_spring+(t['doorRise']+t['doorFrame'])*math.sin(a)]],
            dc,dc+t['doorFrameDepth'],'inner-door-arch')
    for c in (centre-dr,centre,centre+dr):
        box(front,'unionDoor',c-t['doorFrame']/2,c+t['doorFrame']/2,dc,dc+t['doorFrameDepth'],
            door_bottom,door_spring,'inner-door-stile')
    for z in t['doorRailZ']:
        box(front,'unionDoor',centre-dr,centre+dr,dc,dc+t['doorFrameDepth'],z,z+t['doorRail'],'inner-door-rail')
    for side in (-1,1):
        c=centre+side*dr/2
        box(front,'unionDoor',c-dr/2+t['doorPaneInset'],c+dr/2-t['doorPaneInset'],
            dc,dc+t['doorFrameDepth'],door_bottom+t['doorPaneInset'],t['doorPanelTop']-t['doorPaneInset'],'door-panel')
    for i in range(1,t['fanBars']+1):
        x=-dr+2*dr*i/(t['fanBars']+1)
        top=door_spring+t['doorRise']*math.sqrt(1-(x/dr)**2)
        box(front,'unionDoor',centre+x-t['sashBar']/2,centre+x+t['sashBar']/2,
            dc,dc+t['doorFrameDepth'],door_spring,top-t['clearance'],'transom-bar')

    def sash(c,w,z0,z1,d):
        back=-d+t['clearance']; fw=t['sashFrame']
        for x in (c-w/2,c+w/2-fw):
            box(front,'unionDoor',x,x+fw,back,back+t['sashDepth'],z0,z1,'sash-frame')
        for z in (z0,z1-fw):
            box(front,'unionDoor',c-w/2+fw,c+w/2-fw,back,back+t['sashDepth'],z,z+fw,'sash-frame')
        for f in t['sashCols']:
            x=c-w/2+w*f
            box(front,'unionDoor',x-t['sashBar']/2,x+t['sashBar']/2,back,back+t['sashDepth'],z0+fw,z1-fw,'sash-bar')
        for f in t['sashRows']:
            z=z0+(z1-z0)*f
            box(front,'unionDoor',c-w/2+fw,c+w/2-fw,back,back+t['sashDepth'],z,z+t['sashBar'],'sash-bar')

    for c,w in zip(balcony_centres,balcony_widths):
        sash(c,w,t['balconyBottom'],t['balconyTop'],t['balconyDepth'])
        for a,b in ((c-w/2-t['balconyJamb'],c-w/2),(c+w/2,c+w/2+t['balconyJamb'])):
            box(front,'unionPale',a,b,-t['wallEmbed'],t['balconySurroundProud'],t['balconyBottom'],t['balconyTop'],'balcony-surround')
        box(front,'unionPale',c-w/2-t['balconyJamb'],c+w/2+t['balconyJamb'],
            -t['wallEmbed'],t['balconySurroundProud'],t['balconyTop'],t['balconyTop']+t['balconyHead'],'balcony-head')
    box(front,'unionPale',centre-t['balconyLintelWidth']/2,centre+t['balconyLintelWidth']/2,
        -t['wallEmbed'],t['balconyLintelProjection'],t['balconyLintelZ'],
        t['balconyLintelZ']+t['balconyLintelHeight'],'balcony-lintel')

    # Convex strip slabs follow a shallow bow; no concave polygon fan or
    # unsupported railing schema is required. Rails include both returns.
    half=t['balconyWidth']/2
    def curve(x):
        return t['balconyProjection']+t['balconyBulge']*(1-(x/half)**2)
    bz=t['balconySlabZ']; rail_z=bz+t['balconySlabThickness']
    rail_top=rail_z+t['balconyGuardHeight']; bar=t['balconyGuardBar']
    for i in range(t['balconyCurveSegments']):
        a=-half+2*half*i/t['balconyCurveSegments']; b=-half+2*half*(i+1)/t['balconyCurveSegments']
        polygon=[[centre+a,t['balconySlabBack']],[centre+b,t['balconySlabBack']],
                 [centre+b,curve(b)],[centre+a,curve(a)]]
        plan_prism(front,'unionPale',polygon,bz,rail_z,'balcony-slab')
        strip=[[centre+a,curve(a)-bar],[centre+b,curve(b)-bar],
               [centre+b,curve(b)],[centre+a,curve(a)]]
        for z in (rail_z+t['clearance'],rail_top):
            plan_prism(front,'unionIron',strip,z,z+bar,'balcony-rail')
    for i in range(t['balconyGuardBars']):
        x=-half+2*half*i/(t['balconyGuardBars']-1)
        box(front,'unionIron',centre+x-bar/2,centre+x+bar/2,curve(x)-bar,curve(x),rail_z,rail_top,'balcony-baluster')
    for x in (-half,half):
        for z in (rail_z+t['clearance'],rail_top):
            box(front,'unionIron',centre+x-bar/2,centre+x+bar/2,0,curve(x),z,z+bar,'balcony-return')
        for i in range(t['balconyReturnBars']):
            d=curve(x)*(i+1)/(t['balconyReturnBars']+1)
            box(front,'unionIron',centre+x-bar/2,centre+x+bar/2,d-bar/2,d+bar/2,
                rail_z,rail_top,'balcony-return-bar')
    for offset in t['balconyBracketCentres']:
        c=centre+offset
        # Extrude the convex side profile along the facade, using a rotated
        # Details frame so its s is outward depth and d is horizontal width.
        m=Details([u0+c,v0],[0,-1]);batches.append(m)
        prism(m,'unionPale',[[d,bz+z] for d,z in t['balconyBracketProfile']],
              -t['balconyBracketWidth']/2,t['balconyBracketWidth']/2,'balcony-bracket')

    for i,c in enumerate(t['upperCentres']):
        if i:
            sash(c,t['upperWidth'],t['upperBottom'],t['upperTop'],t['upperDepth'])
        else:
            z=t['upperBottom']+t['louverPitch']/2
            while z+t['louverThickness']<t['upperTop']:
                m=Details([u0+c-t['upperWidth']/2,v0],[0,-1]);batches.append(m)
                d=-t['upperDepth']+t['clearance']
                prism(m,'unionLouver',[[d,z],[d+t['louverDepth'],z-t['louverSlope']],
                    [d+t['louverDepth'],z-t['louverSlope']+t['louverThickness']],
                    [d,z+t['louverThickness']]],-t['upperWidth'],0,'louver')
                z+=t['louverPitch']
        box(front,'unionPale',c-t['upperCapitalWidth']/2,c+t['upperCapitalWidth']/2,
            -t['wallEmbed'],t['upperCapitalProud'],t['upperTop'],t['upperTop']+t['upperCapitalHeight'],'upper-head')
    box(front,'unionPale',0,width,-t['wallEmbed'],t['upperCourseProud'],
        t['upperCourseZ'],t['upperCourseZ']+t['upperCourseHeight'],'upper-course')

    # Keep the existing roof and eave envelope. A continuous underside fills
    # the ring; the end strips overlap only inside the corner join.
    eave['bands']=[dict(z0=eave['z0'],z1=eave['z1'],skin='unionEaveDark')]
    e=t['eaveOver']
    box(front,'unionSoffit',-e,width+e,-(v1-v0)-e,e,t['eaveBottom'],t['eaveTop'],'eave-underside')
    for origin,axis,length,count in (
        ([u0,v0],[1,0],width,t['eaveBracketCountFront']),
        ([u1,v0],[0,1],v1-v0,t['eaveBracketCountSide']),
        ([u1,v1],[-1,0],width,t['eaveBracketCountFront']),
        ([u0,v1],[0,-1],v1-v0,t['eaveBracketCountSide'])):
        m=Details(origin,axis);batches.append(m)
        box(m,'unionFascia',-e,length+e,e-t['eaveBeamDepth'],e,
            t['eaveBottom']-t['eaveBeamHeight'],t['eaveBottom'],'eave-beam')
        for i in range(count):
            c=t['eaveCornerInset']+(length-2*t['eaveCornerInset'])*i/(count-1)
            o=[origin[k]+c*axis[k] for k in range(2)]
            normal=[axis[1],-axis[0]]
            bracket=Details(o,normal);batches.append(bracket)
            prism(bracket,'unionTimber',[[d,t['eaveBottom']+z] for d,z in t['eaveBracketProfile']],
                -t['eaveBracketWidth']/2,t['eaveBracketWidth']/2,'eave-bracket')

    meshes=[]
    for i,batch in enumerate(batches):
        for tone,mesh in batch.meshes.items():
            mesh['id']=f'union-entrance-{i}-{tone}'
            meshes.append(mesh)
    triangles=sum(len(m['triangles']) for m in meshes)
    assert triangles <= t['maxDetailTriangles']
    result.setdefault('detailMeshes',[]).extend(meshes)
    result['unionEntrance']=dict(version=1,parameters=t,front='v0',
        coveredWingFaces=t['coveredFaces'],upperBays=4,louverBays=1,
        balconyOpenings=3,portalOpenings=1,detailTriangles=triangles,
        detailSolids=solids,detailMeshIds=[m['id'] for m in meshes],
        scope='South tower vestibule, balcony, four upper recesses and connected eave; approximate exterior dimensions.',
        limits=['Unphotographed tower elevations retain their baseline treatment.',
                'Wing elevations, mapped footprint and existing roofs remain unchanged.',
                'No carved insignia, text or walkable interior is inferred.',
                'The landscape bake owns the inferred exterior stair and landing connection.'])
    return result
