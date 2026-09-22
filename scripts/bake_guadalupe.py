"""Guadalupe's continuous frontage. Owns only data/guadalupe.json.

The older Drag experiment and its output are intentionally not inputs to the
authoring process. Real footprint edges determine shopfronts, never rear walls.
"""
import copy
import json
import math
from pathlib import Path
from neighborhood_geometry import local_frame, band, rect, validate

ROOT=Path(__file__).resolve().parents[1]


class FrontDetails:
    """Small architectural solids in metres along/out from a real wall."""
    def __init__(self, a, b, blocks, prefix, meshes):
        self.a=a;self.length=math.dist(a,b)
        self.tx=(b[0]-a[0])/self.length;self.ty=(b[1]-a[1])/self.length
        self.blocks=blocks;self.prefix=prefix;self.serial=0;self.meshes=meshes

    def beam(self,label,s,d0,z0,d1,z1,width,tone):
        def point(d,z):return [self.a[0]+self.tx*s+self.ty*d,self.a[1]+self.ty*s-self.tx*d,z]
        a,b=point(d0,z0),point(d1,z1);dy,dz=d1-d0,z1-z0;length=math.hypot(dy,dz)
        U=[self.tx*width/2,self.ty*width/2,0]
        V=[self.ty*dz/length*width/2,-self.tx*dz/length*width/2,-dy/length*width/2]
        vertices=[[round(p[k]+u*U[k]+v*V[k],5)for k in range(3)]for p in [a,b]for u,v in [(-1,-1),(1,-1),(1,1),(-1,1)]]
        triangles=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]]
        self.serial+=1;self.meshes.append(dict(id=f'{self.prefix}-{label}-{self.serial}',tone=tone,vertices=vertices,triangles=[[a,c,b]for a,b,c in triangles]))

    def box(self, label, s0, s1, d0, d1, z0, z1, tone, signs=None):
        def p(s,d):return [round(self.a[0]+self.tx*s+self.ty*d,4),round(self.a[1]+self.ty*s-self.tx*d,4)]
        self.serial+=1;z0,z1=round(z0,3),round(z1,3)
        item=dict(id=f'{self.prefix}-{label}-{self.serial}',plan=dict(ring=[p(s0,d1),p(s1,d1),p(s1,d0),p(s0,d0)]),z0=z0,z1=z1,bands=[band(z0,z1,tone)],roofTone=tone)
        if signs:item['faces']={'0':dict(bands=[band(z0,z1,tone,signs=signs)])}
        self.blocks.append(item);return item

    def canopy(self, s0, s1, c):
        z,d,t=c['z'],c['depth'],c['thickness']
        self.box('canopy-deck',s0,s1,0,d,z-t,z,'metal')
        self.box('canopy-fascia',s0,s1,d-c['fasciaDepth'],d,z-c['fasciaHeight'],z,'metal')
        self.box('canopy-soffit',s0,s1,0,d-c['fasciaDepth'],z-t-c['soffitThickness'],z-t,'soffit')
        n=max(2,round((s1-s0)/c['rafterPitch']))
        for i in range(n+1):
            s=s0+(s1-s0)*i/n;w=c['rafterWidth']
            self.box('canopy-rafter',s-w/2,s+w/2,0,d,z-c['rafterHeight'],z-t,'metal')
        for i in range(c['tieCount']):
            s=s0+(s1-s0)*(i+.5)/c['tieCount'];w=c['tieWidth']
            self.beam('canopy-tie',s,0,z+c['tieRise'],d,z,w,'metal')


def vector_sign(name,w,h,s,z,tone,depth,off=0):
    from sign_outlines import load_sign
    return dict(outline=load_sign(name),w=w,h=h,s=s,z0=z,depth=depth,off=off,tone=tone)


def detailed_barefoot(base,blocks,plan,p,meshes):
    c=p['photoDetail'];edge=p['frontEdges'][0]
    f=FrontDetails(plan['ring'][edge],plan['ring'][(edge+1)%len(plan['ring'])],blocks,'barefoot',meshes);L=f.length
    base['z1']=c['shoulder'];base['bands']=[band(0,c['shoulder'],'wall')];base['parapet']=0
    openings=[]
    for lo,hi in c['displayBays']:
        a,b=lo*L,hi*L
        count=c['displayPanes'];step=(b-a)/count
        for i in range(count):
            openings.append(dict(s0=a+i*step+c['mullion']/2,s1=a+(i+1)*step-c['mullion']/2,z0=c['plinth'],z1=c['shopTop'],d=c['windowDepth'],glass='glass',tone='metal'))
            # The inset shop glass has real thin mullions, not opaque brick
            # between panes. A continuous horizontal transom gives it scale.
        f.box('display-transom',a,b,-c['windowDepth'], -c['windowDepth']+c['frameDepth'],c['transom'],c['transom']+c['mullion'],'metal')
        f.box('tile-bulkhead',a,b,0,c['tileProud'],0,c['plinth'],'tile')
        for i in range(1,count):
            s=a+i*step;f.box('display-mullion',s-c['mullion']/2,s+c['mullion']/2,-c['windowDepth'],c['frameProud'],c['plinth'],c['shopTop'],'metal')
    a,b=[v*L for v in c['entry']];mid=(a+b)/2
    # The continuous recess contains separate door/sidelight frames; its
    # mouth has no false masonry piers between the inset door panes.
    openings.append(dict(s0=a,s1=b,z0=c['doorSill'],z1=c['shopTop'],d=c['entryDepth'],glass='entryGlass',tone='metal'))
    for s in [a,mid-c['doorWidth'],mid,mid+c['doorWidth'],b]:
        f.box('entry-frame',s-c['mullion']/2,s+c['mullion']/2,-c['entryDepth'],-c['entryDepth']+c['frameDepth'],c['doorSill'],c['shopTop'],'metal')
    for s in [mid-c['handleSpacing'],mid+c['handleSpacing']]:
        f.box('door-pull',s-c['handleWidth']/2,s+c['handleWidth']/2,-c['entryDepth']+c['frameDepth'],-c['entryDepth']+c['handleDepth'],c['handleBottom'],c['handleTop'],'handle')
    base['faces'][str(edge)]={'bands':[band(0,c['shopTop'],'wall',openings=openings),band(c['shopTop'],c['shoulder'],'wall',signs=[])]}
    f.canopy(c['canopyEnds'][0]*L,c['canopyEnds'][1]*L,c['canopy'])
    # Distinct wood signboards, their raised rails and individual planks.
    for name,lo,hi in c['woodPanels']:
        a,b=lo*L,hi*L;z0,z1=c['panelBottom'],c['panelTop'];rim=c['panelRim']
        f.box('wood-frame',a-rim,b+rim,0,c['panelDepth'],z0-rim,z1+rim,'woodFrame')
        count=c['plankCount'];step=(z1-z0)/count
        for row in range(count):
            f.box('wood-plank',a,b,c['panelDepth'],c['panelDepth']+c['plankProud'],z0+row*step+c['plankJoint']/2,z0+(row+1)*step-c['plankJoint']/2,'wood'+str(row%3))
        # Font contours stand ahead of the individual wooden boards.
        s=vector_sign(name,(b-a)*c['panelTextWidth'],c['panelTextHeight'],(a+b)/2,z0+c['panelTextBottom'],'letters',c['letterDepth'],c['panelDepth']+c['plankProud'])
        base['faces'][str(edge)]['bands'][1]['signs'].append(s)
    # Terracotta diamond infill, with cream perimeter frame beneath the arch.
    a,b=[v*L for v in c['diamondPanel']];z0,z1=c['diamondBottom'],c['diamondTop'];rim=c['diamondRim']
    f.box('diamond-frame',a-rim,b+rim,0,c['diamondDepth'],z0-rim,z1+rim,'stoneTrim')
    f.box('diamond-bed',a,b,c['diamondDepth'],c['diamondDepth']+c['diamondProud'],z0,z1,'tile')
    from shapely.geometry import Polygon,box
    clip=box(a,z0,b,z1);pitch=c['diamondPitch'];polys=[]
    for row in range(-1,math.ceil((z1-z0)/pitch)+2):
        for col in range(-1,math.ceil((b-a)/pitch)+2):
            x=a+col*pitch+(row%2)*pitch/2;y=z0+row*pitch/2;r=pitch/2-c['diamondJoint']
            tile=Polygon([(x-r,y),(x,y+r),(x+r,y),(x,y-r)]).intersection(clip)
            if tile.geom_type=='Polygon' and tile.area>0:
                polys.append({'outer':[[(x-a)/(b-a),(y-z0)/(z1-z0)]for x,y in list(tile.exterior.coords)[:-1]],'holes':[]})
    base['faces'][str(edge)]['bands'][1]['signs'].append(dict(outline={'polygons':polys},w=b-a,h=z1-z0,s=(a+b)/2,z0=z0,depth=c['diamondProud'],off=c['diamondDepth']+c['diamondProud'],tone='diamond'))
    # The public brand mark retains its real lettering, footprints and wings.
    # The plaque contour and raised white logo share the same transform.
    s=L*c['logoCenter'];w,h=c['logoWidth'],c['logoHeight']
    base['faces'][str(edge)]['bands'][1]['signs'].append(vector_sign('barefoot-plaque',w,h,s,c['logoBottom'],'logo',c['logoDepth'],c['logoOff']))
    base['faces'][str(edge)]['bands'][1]['signs'].append(vector_sign('barefoot-logo',w,h,s,c['logoBottom'],'letters',c['letterDepth'],c['logoOff']+c['logoDepth']+c['logoFaceDepth']))
    name=c['nameTablet'];a=s-name['width']/2;b=s+name['width']/2
    f.box('name-tablet',a,b,0,name['depth'],name['bottom'],name['bottom']+name['height'],'stoneTrim',signs=[vector_sign('wukasch',name['width']*name['textWidth'],name['textHeight'],name['width']/2,name['bottom']+name['textBottom'],'nameInk',c['letterDepth'])])
    # Staggered projecting brick relief follows both shoulders and the arch.
    start,end=[v*L for v in c['arch']]
    def top(s):return c['shoulder']+c['archRise']*math.sin(math.pi*(s-start)/(end-start)) if start<s<end else c['shoulder']
    for row in range(c['reliefRows']):
        n=round(L/c['reliefPitch'])
        for i in range(n):
            s=(i+.5+(row%2)*.5)*L/n
            if s> L-c['reliefWidth']:continue
            z=top(s)-c['reliefTopInset']-row*c['reliefRowPitch']
            f.box('brick-relief',s-c['reliefWidth']/2,s+c['reliefWidth']/2,0,c['reliefDepth']*(1-row*c['reliefTaper']),z-c['reliefHeight'],z,'relief'+str((i+row)%3))
    # Retain the supported curved crown, but remove its old pixel lettering.
    crown=dict(frontEdges=[edge],frontage=dict(bands=base['faces'][str(edge)]['bands'],crown=dict(base=c['shoulder'],rise=c['archRise'],depth=c['archDepth'],**{'from':c['arch'][0],'to':c['arch'][1]},segments=c['archSegments'],tone='wall',minimumSlopeRise=.05)))
    # Crown only: authored_frontage expects normalized details; the finished
    # metre-based facade remains intact while a temporary carrier gets its roof.
    temporary={'faces':{}};crown['frontage']['bands']=[]
    authored_frontage(temporary,blocks,plan,crown,{})


def detailed_coop(base,blocks,plan,p,meshes):
    c=p['photoDetail'];edge=c['mainEdge'];a,b=plan['ring'][edge],plan['ring'][(edge+1)%len(plan['ring'])]
    f=FrontDetails(a,b,blocks,'coop',meshes);L=f.length
    base['z1']=p['wingHeight'];base['bands']=[band(0,p['wingHeight'],'wall')];base['parapet']=0
    # Side/service returns are quiet masonry; the storefront belongs to the
    # long street edge, not to every east-pointing edge of the rear plan.
    base['faces']={};low,high=[v*L for v in c['center']];width=high-low
    openings=[]
    for lo,hi in c['wingWindows']:
        start,end=lo*L,hi*L
        n=max(2,round((end-start)/c['windowPitch']));step=(end-start)/n
        for i in range(n):
            openings.append(dict(s0=start+i*step+c['mullion']/2,s1=start+(i+1)*step-c['mullion']/2,z0=c['windowSill'],z1=c['windowTop'],d=c['windowDepth'],glass='glass',tone='metal'))
        f.box('wing-window-head',start,end,-c['windowDepth'],c['frameProud'],c['transom'],c['transom']+c['mullion'],'metal')
        f.canopy(start-c['canopyMargin'],end+c['canopyMargin'],c['canopy'])
    # This underlying opening clears the rear wall behind the projecting
    # centre portal. Otherwise a shallow base pane fills the apparent recess.
    portal=dict(s0=low+c['portalSide'],s1=high-c['portalSide'],z0=c['doorSill'],z1=c['lowerTop'],d=c['basePortalDepth'],glass='entryGlass',tone='lowerWall')
    openings.append(portal)
    upperPortal={**portal,'z0':c['lowerTop'],'z1':c['portalTop']}
    base['faces'][str(edge)]={'bands':[band(0,c['lowerTop'],'lowerWall',openings=openings),band(c['lowerTop'],p['wingHeight'],'wall',openings=[upperPortal])]}
    # Main smooth-clad centre, with an actual deep portal and independent
    # lintel, jambs, upper transom, lower doors, pull handles and canopy.
    center=f.box('raised-entry',low,high,-c['centerDepth'],c['centerProjection'],0,p['height'],'wall')
    cf=FrontDetails(center['plan']['ring'][0],center['plan']['ring'][1],blocks,'coop-portal',meshes)
    pa,pb=c['portalSide'],width-c['portalSide'];span=pb-pa;mid=(pa+pb)/2
    # Cut a single full-height void. Subdividing the cut itself would leave
    # thin cream masonry piers projecting across the depth of the vestibule.
    inner=[dict(s0=pa,s1=pb,z0=c['doorSill'],z1=c['portalTop']-c['lintelHeight'],d=c['portalDepth'],glass='entryGlass',tone='portalTrim')]
    center['faces']={'0':dict(bands=[band(0,c['portalTop'],'wall',openings=inner),band(c['portalTop'],p['height'],'wall',signs=[vector_sign('co-op',c['signWidth'],c['signHeight'],width/2,c['signBottom'],'letters',c['letterDepth']),vector_sign('the',c['theWidth'],c['theHeight'],width/2,c['theBottom'],'letters',c['letterDepth'])])])}
    for s in [pa,pb]:
        cf.box('portal-jamb',s-c['jambWidth']/2,s+c['jambWidth']/2,-c['portalDepth'],c['portalProud'],0,c['portalTop'],'portalTrim')
    cf.box('portal-lintel',pa-c['jambWidth'],pb+c['jambWidth'],-c['portalDepth'],c['portalProud'],c['portalTop']-c['lintelHeight'],c['portalTop'],'portalTrim')
    cf.box('portal-floor',pa,pb,-c['portalDepth'],c['portalProud'],0,c['doorSill'],'portalFloor')
    for i in range(1,c['portalPanes']):
        s=pa+span*i/c['portalPanes']
        cf.box('portal-mullion',s-c['mullion']/2,s+c['mullion']/2,-c['portalDepth'],-c['portalDepth']+c['frameDepth'],c['doorSill'],c['portalTop']-c['lintelHeight'],'metal')
    cf.box('portal-door-head',pa,pb,-c['portalDepth'],-c['portalDepth']+c['frameDepth'],c['doorTop'],c['upperBottom'],'metal')
    for s in [mid-c['handleSpacing'],mid+c['handleSpacing']]:
        cf.box('door-pull',s-c['handleWidth']/2,s+c['handleWidth']/2,-c['portalDepth']+c['frameDepth'],-c['portalDepth']+c['handleDepth'],c['handleBottom'],c['handleTop'],'handle')
    cf.canopy(pa-c['canopyMargin'],pb+c['canopyMargin'],c['portalCanopy'])
    # Cream horizontal/vertical cladding joints are sparse and shallow, not
    # the inherited rough stone-brick texture. Cornices have cast dentils.
    def cornice(g,s0,s1,z):
        for drop,depth,height in c['corniceSteps']:
            g.box('cornice',s0,s1,0,depth,z-drop-height,z-drop,'trim')
        n=max(1,round((s1-s0)/c['dentilPitch']))
        for i in range(n):
            s=s0+(s1-s0)*(i+.5)/n
            g.box('dentil',s-c['dentilWidth']/2,s+c['dentilWidth']/2,0,c['dentilDepth'],z-c['dentilDrop']-c['dentilHeight'],z-c['dentilDrop'],'trim')
    cornice(f,0,low,p['wingHeight']);cornice(f,high,L,p['wingHeight']);cornice(cf,0,width,p['height'])
    for s0,s1 in [(0,low),(high,L)]:
        for z in c['panelJoints']:
            f.box('cladding-joint',s0,s1,0,c['jointDepth'],z,z+c['jointWidth'],'joint')
        n=max(1,round((s1-s0)/c['panelPitch']))
        for i in range(1,n):
            s=s0+(s1-s0)*i/n
            f.box('cladding-joint',s-c['jointWidth']/2,s+c['jointWidth']/2,0,c['jointDepth'],c['lowerTop'],p['wingHeight']-c['dentilDrop'],'joint')
    # The banner artwork is intentionally original vector/typographic work;
    # the owner's photographs are never embedded as building textures.
    for i,(lo,hi) in enumerate(c['banners']):
        start,end=lo*L,hi*L;w=end-start
        panel=f.box('banner',start,end,0,c['bannerDepth'],c['bannerBottom'],c['bannerTop'],'banner')
        rows=[]
        for name,ratio,z,h in c['bannerText']:
            rows.append(vector_sign(name,w*ratio,h,w*c['bannerTextCenter'],z,'bannerLetters',c['bannerLetterDepth']))
        panel['faces']={'0':dict(bands=[band(c['bannerBottom'],c['bannerTop'],'banner',signs=rows)])}
        # Three broad jersey-colour shapes carry the burnt orange/cream
        # balance of the ads without tracing or publishing owner images.
        for j in range(c['bannerFigureCount']):
            s=start+w*(c['bannerFigureStart']+j*c['bannerFigureStep'])
            poly=c['jerseyOutline'];pw=w*c['bannerFigureWidth'];ph=c['bannerFigureHeight']
            panel['faces']['0']['bands'][0]['signs'].append(dict(outline={'polygons':[{'outer':poly,'holes':[]}]},w=pw,h=ph,s=s-start,z0=c['bannerBottom']+c['bannerFigureBottom'],depth=c['bannerLetterDepth'],off=0,tone='jersey'+str(j%2)))


def detailed_row_shop(base, blocks, plan, p, meshes):
    """Individually measured storefront layers on the connected retail row."""
    c=p['photoDetail'];edge=p['frontEdges'][0]
    f=FrontDetails(plan['ring'][edge],plan['ring'][(edge+1)%len(plan['ring'])],blocks,p['special'],meshes);L=f.length
    base['parapet']=0
    a,b=[s*L for s in c['mouth']];w=b-a
    opening=lambda lo,hi,z0,z1,d,glass,tone:dict(s0=lo,s1=hi,z0=z0,z1=z1,d=d,glass=glass,tone=tone,lit=c['shopLit'])
    openings=[]
    if p['special']=='potbelly-photo':
        openings=[opening(a,b,c['sill'],c['transom'],c['entryDepth'],'entryGlass','wall'),
                  opening(a,b,c['transom'],c['shopTop'],c['entryDepth'],None,'soffit')]
        # Deep court, with the glass door at the back and the gate standing
        # independently near its mouth. Upper posts span the open transom.
        f.box('court-floor',a,b,-c['entryDepth'],c['floorProud'],0,c['sill'],'floor')
        for q in c['backPosts']:
            s=a+w*q;f.box('back-frame',s-c['frameWidth']/2,s+c['frameWidth']/2,-c['entryDepth'],-c['entryDepth']+c['frameDepth'],c['sill'],c['transom'],'metal')
        f.box('back-transom',a,b,-c['entryDepth'],-c['entryDepth']+c['frameDepth'],c['backTransom'],c['backTransom']+c['frameWidth'],'metal')
        for q in c['upperPosts']:
            s=a+w*q;f.box('upper-post',s-c['upperPostWidth']/2,s+c['upperPostWidth']/2,-c['upperPostDepth'],c['frameProud'],c['transom'],c['shopTop'],'metal')
        f.box('transom-beam',a,b,-c['upperPostDepth'],c['frameProud'],c['transom']-c['beamHeight'],c['transom'],'metal')
        ga,gb=[a+v*w for v in c['gate']];d=-c['gateInset']
        f.box('court-side-wall',ga,b,-c['entryDepth'],-c['entryDepth']+c['wallDepth'],c['sill'],c['transom'],'wall')
        for s in [ga,gb]:
            f.box('gate-post',s-c['gatePost']/2,s+c['gatePost']/2,d,d+c['gatePost'],c['sill'],c['gateTop'],'metal')
        for z in c['gateRails']:
            f.box('gate-rail',ga,gb,d,d+c['gateBar'],z,z+c['gateBar'],'metal')
        n=max(1,round((gb-ga)/c['gatePitch']))
        for i in range(1,n):
            s=ga+(gb-ga)*i/n;f.box('gate-picket',s-c['gateBar']/2,s+c['gateBar']/2,d,d+c['gateBar'],c['sill'],c['gateTop']-c['gatePost'],'metal')
        # Circular gate ornaments use smooth vector contours, not dot glyphs.
        rings=[]
        for i in range(n):
            cx=(i+.5)/n;r=c['gateRingRadius'];cy=c['gateRingZ']
            outer=[[cx+r*math.cos(t)/(gb-ga),(cy+r*math.sin(t)-c['sill'])/(c['gateTop']-c['sill'])]for t in [j*2*math.pi/c['ringSegments']for j in range(c['ringSegments'])]]
            inner=[[cx+(r-c['gateBar'])*math.cos(t)/(gb-ga),(cy+(r-c['gateBar'])*math.sin(t)-c['sill'])/(c['gateTop']-c['sill'])]for t in [j*2*math.pi/c['ringSegments']for j in range(c['ringSegments'])]]
            rings.append(dict(outer=outer,holes=[inner]))
        gateSign=dict(outline={'polygons':rings},w=gb-ga,h=c['gateTop']-c['sill'],s=(ga+gb)/2,z0=c['sill'],depth=c['gateBar'],off=d,tone='metal')
        csigns=[gateSign]
    elif p['special']=='wingstop-photo':
        openings=[opening(a,b,c['sill'],c['shopTop'],c['windowDepth'],'glass','wall')];csigns=[]
        for q in c['posts']:
            s=a+w*q;f.box('silver-mullion',s-c['frameWidth']/2,s+c['frameWidth']/2,-c['windowDepth'],c['frameProud'],c['sill'],c['shopTop'],'metal')
        f.box('silver-transom',a,b,-c['windowDepth'],c['frameProud'],c['transom'],c['transom']+c['frameWidth'],'metal')
        for q in c['doorHandles']:
            s=a+w*q;f.box('door-pull',s-c['handleWidth']/2,s+c['handleWidth']/2,-c['windowDepth']+c['frameDepth'],-c['windowDepth']+c['handleDepth'],c['handleBottom'],c['handleTop'],'metal')
    else:
        csigns=[]
        for lo,hi in c['displayBays']:
            da,db=lo*L,hi*L
            openings.append(opening(da,db,c['bulkhead'],c['shopTop'],c['windowDepth'],'glass','displayTrim'))
            # Painted timber panels and double perimeter mouldings distinguish
            # these displays from the adjoining aluminium restaurant front.
            f.box('display-plinth',da,db,0,c['panelDepth'],0,c['bulkhead'],'displayTrim')
            for inset in c['panelInsets']:
                z0=inset;z1=c['bulkhead']-inset;ra=da+inset;rb=db-inset;t=c['panelRail']
                for lo,hi in [(ra,ra+t),(rb-t,rb)]:f.box('panel-side',lo,hi,c['panelDepth'],c['panelDepth']+c['panelRelief'],z0,z1,'panelEdge')
                for z in [z0,z1-t]:f.box('panel-rail',ra,rb,c['panelDepth'],c['panelDepth']+c['panelRelief'],z,z+t,'panelEdge')
            for s in [da,db]:f.box('display-frame',s-c['frameWidth']/2,s+c['frameWidth']/2,-c['windowDepth'],c['frameProud'],c['bulkhead'],c['shopTop'],'displayTrim')
        da,db=[v*L for v in c['entry']];mid=(da+db)/2
        openings.append(opening(da,db,c['sill'],c['shopTop'],c['entryDepth'],'entryGlass','displayTrim'))
        for s in [da,db]:f.box('entry-frame',s-c['frameWidth']/2,s+c['frameWidth']/2,-c['entryDepth'],-c['entryDepth']+c['frameDepth'],c['sill'],c['shopTop'],'metal')
        s=da+c['handleSpacing'];f.box('door-pull',s-c['handleWidth']/2,s+c['handleWidth']/2,-c['entryDepth']+c['frameDepth'],-c['entryDepth']+c['handleDepth'],c['handleBottom'],c['handleTop'],'metal')
        ua,ub=[v*L for v in c['upperMouth']]
        openings.append(opening(ua,ub,c['upperBottom'],c['upperTop'],c['upperDepth'],'upperGlass','metal'))
        for q in c['upperPosts']:
            s=ua+(ub-ua)*q;f.box('upper-mullion',s-c['upperFrame']/2,s+c['upperFrame']/2,-c['upperDepth'],c['upperProud'],c['upperBottom'],c['upperTop'],'metal')
        f.box('upper-transom',ua,ub,-c['upperDepth'],c['upperProud'],c['upperTransom'],c['upperTransom']+c['upperFrame'],'metal')
        f.canopy(a,b,c['canopy'])
        z=c['eaveZ'];d=c['eaveDepth']
        f.box('eave-soffit',0,L,0,d,z-c['eaveThickness'],z,'soffit')
        f.box('tile-fascia',0,L,d-c['eaveFascia'],d,z,z+c['eaveCap'],'terracotta')
        n=max(1,round(L/c['rafterPitch']))
        for i in range(n+1):
            s=L*i/n;f.box('red-rafter',max(0,s-c['rafterWidth']/2),min(L,s+c['rafterWidth']/2),0,d,z-c['rafterHeight'],z-c['eaveThickness'],'terracotta')
        f.box('upper-sill',ua,ub,0,c['sillProud'],c['upperBottom']-c['sillThickness'],c['upperBottom'],'stoneTrim')
    # A single flat wall skin prevents accidental repeated generic shop bays.
    base['faces'][str(edge)]={'bands':[band(0,p['height'],'wall',openings=openings,signs=csigns)]}
    signs=base['faces'][str(edge)]['bands'][0]['signs']
    for spec in c['signs']:
        s=copy.deepcopy(spec);name=s.pop('asset',None)
        if name:s['outline']=vector_sign(name,1,1,0,0,'letters',0)['outline']
        s['s']*=L;s['w']*=L;signs.append(s)
    # Thin surface relief follows the brick header and continuous roof line.
    for z in c.get('courses',[]):f.box('brick-course',0,L,0,c['courseDepth'],z,z+c['courseHeight'],'trim')


def lettering(text, width, s, z, tone, config, serif=False):
    rows=config['bitmaps'][('serif:' if serif else '')+text]
    return dict(bitmap=rows,bitmapRuns=True,dot=width/len(rows[0]),s=s,z0=z,tone=tone)


def authored_frontage(base, blocks, plan, spec, config):
    """Street elevations with individual shop proportions, on real edges.

    Horizontal positions are fractions of an edge; heights/depths are metres.
    This deliberately leaves unseen party walls and the surveyed plan alone.
    """
    def position_sign(sign,span):
        center=sign.pop('s')*span
        # The renderer centres bitmap signs with s, but horizontal text uses
        # s0. Resolve the authored centre before handing it to that contract.
        if 'bitmap' in sign or 'outline' in sign:sign['s']=center
        else:sign['s0']=center-(len(sign['text'])*(5*sign['dot']+sign['gap'])-sign['gap'])/2

    for edge in spec['frontEdges']:
        a,b=plan['ring'][edge],plan['ring'][(edge+1)%len(plan['ring'])]
        length=math.dist(a,b);tx,ty=(b[0]-a[0])/length,(b[1]-a[1])/length
        bands=copy.deepcopy(spec['frontage']['bands'])
        for row in bands:
            for key in ['openings','canopies']:
                for item in row.get(key,[]):
                    item['s0']*=length;item['s1']*=length
            for sign in row.get('signs',[]):
                position_sign(sign,length)
            for fin in row.get('fins',[]) if isinstance(row.get('fins'),list) else [row['fins']] if row.get('fins') else []:
                for key in ['from','to']:
                    if key in fin:fin[key]*=length
                if 'at' in fin:fin['at']=[s*length for s in fin['at']]
        base['faces'][str(edge)]={'bands':bands}
        for i,panel in enumerate(spec['frontage'].get('panels',[])):
            s0,s1=panel['s0']*length,panel['s1']*length;d=panel['depth']
            ring=[[a[0]+tx*s0+ty*d,a[1]+ty*s0-tx*d],
                  [a[0]+tx*s1+ty*d,a[1]+ty*s1-tx*d],
                  [a[0]+tx*s1,a[1]+ty*s1],
                  [a[0]+tx*s0,a[1]+ty*s0]]
            signs=copy.deepcopy(panel.get('signs',[]))
            for sign in signs:position_sign(sign,s1-s0)
            low,high,tone=panel['z0'],panel['z1'],panel['tone']
            blocks.append(dict(id=f'front-panel-{edge}-{i}',plan=dict(ring=ring),z0=low,z1=high,bands=[band(low,high,tone)],roofTone=tone,faces={'0':dict(bands=[band(low,high,tone,signs=signs)])}))
        c=spec['frontage'].get('crown')
        if not c:continue
        # A low brick parapet with a broad circular-looking central arch. Each
        # segment has a genuinely sloping top, not a stack of square steps.
        def strip(s0,s1):
            return dict(ring=[[a[0]+tx*s0,a[1]+ty*s0],
                              [a[0]+tx*s1,a[1]+ty*s1],
                              [a[0]+tx*s1-ty*c['depth'],a[1]+ty*s1+tx*c['depth']],
                              [a[0]+tx*s0-ty*c['depth'],a[1]+ty*s0+tx*c['depth']]])
        start,end=c['from']*length,c['to']*length
        for i in range(c['segments']):
            s0=start+(end-start)*i/c['segments'];s1=start+(end-start)*(i+1)/c['segments']
            z0=round(c['base']+c['rise']*math.sin(math.pi*i/c['segments']),3)
            z1=round(c['base']+c['rise']*math.sin(math.pi*(i+1)/c['segments']),3)
            low,high=min(z0,z1),max(z0,z1);shape=strip(s0,s1)
            if low>c['base']:
                blocks.append(dict(id=f'crown-{edge}-{i}-base',plan=shape,z0=c['base'],z1=low,bands=[band(c['base'],low,c['tone'])],roofTone=c['tone']))
            if high-low>c['minimumSlopeRise']:
                blocks.append(dict(id=f'crown-{edge}-{i}-slope',plan=shape,z0=low,z1=high,bands=[band(low,high,c['tone'])],roofTone=c['tone'],rake=dict(face='3' if z1>z0 else '1')))
            elif high>low:
                blocks.append(dict(id=f'crown-{edge}-{i}-crest',plan=shape,z0=low,z1=high,bands=[band(low,high,c['tone'])],roofTone=c['tone']))


def make_building(p, feature, config, roofs):
    t={**config['detail'],**p.get('tuning',{})};f,plan,footprint=local_frame(feature['geometry'],p.get('angle',t['angle']))
    colours=copy.deepcopy(config['colours']);colours.update({k:dict(hex=v) for k,v in p.get('colours',{}).items()})
    skins={k:dict(kind='flat',field=k) for k in colours}
    h,ground=p['height'],p.get('ground',t['shopHeight'])
    floors=[0,ground]+[ground+(h-ground)*i/(p['floors']-1) for i in range(1,p['floors'])] if p['floors']>1 else [0,h]
    skins['shop']=dict(kind='storefront',glass='glass',frame='metal',reveal=t['reveal'],mullion=p.get('shopBay',t['shopBay']),mullionW=t['mullion'],transom=t['transom'],fascia=t['fascia'],fasciaTone='signboard')
    skins['upper']=dict(kind='bays',windowRule=t['windowRule'],field='wall',bay=p.get('bay',t['upperBay']),glass='glass',frame='trim',reveal=t['upperReveal'],window=dict(w=t['upperWindow'],h=t['upperWindowHeight'],sill=t['upperSill'],frame=dict(w=t['upperFrame'],tone='trim')))
    skins.update(copy.deepcopy(p.get('skins',{})))
    base=dict(id='street-building',plan=plan,z0=0,z1=h,bands=[band(0,h,'wall')],roofTone='roof',parapet=t['parapet'],parapetTone='trim',faces={})
    fronts=p['frontEdges']
    for edge in fronts:
        a,b=plan['ring'][edge],plan['ring'][(edge+1)%len(plan['ring'])];length=((b[0]-a[0])**2+(b[1]-a[1])**2)**.5
        shopTop=min(ground,h-t['cornice']-t['signHeight'])
        bands=[band(0,t['bulkhead'],'dark'),band(t['bulkhead'],shopTop,'shop'),band(shopTop,min(h-t['cornice'],shopTop+t['signHeight']),'signboard')]
        if shopTop+t['signHeight']<h-t['cornice']:bands.append(band(shopTop+t['signHeight'],h-t['cornice'],'upper' if p['floors']>1 else 'wall'))
        bands.append(band(h-t['cornice'],h,'trim'))
        bands[1]['openings']=[dict(s0=max(t['doorMargin'],length*p.get('doorAt',t['doorAt'])-t['doorWidth']/2),s1=min(length-t['doorMargin'],length*p.get('doorAt',t['doorAt'])+t['doorWidth']/2),z0=t['doorSill'],z1=min(t['doorHeight'],shopTop-t['doorHead']),d=t['doorRecess'],glass='glass',tone='metal')]
        if p.get('sign') and length>t['signMinFront']:
            textWidth=min(length*t['signWidthRatio'],p.get('signWidth',t['signMaxWidth']))
            bands[2]['signs']=[lettering(p['sign'],textWidth,length/2,shopTop+t['signBaseline'],'letters',config['lettering'])]
        if p.get('canopy'):
            bands[1]['canopies']=[dict(s0=t['awningEnd'],s1=max(t['awningEnd']+t['awningMinimum'],length-t['awningEnd']),z=t['awningHeight'],d=p['canopy'],t=t['awningThickness'],tone='awning',soffitTone='dark')]
        base['faces'][str(edge)]=dict(bands=bands)
    blocks=[base]
    if p.get('frontage'):
        base['z1']=p['frontage'].get('bodyHeight',h)
        base['bands']=[band(0,base['z1'],'wall')]
        authored_frontage(base,blocks,plan,p,config)
    aligned=abs(base['z1']-feature['properties']['final_height'])<0.05 and not p.get('special')
    rigs=[r for k,r in roofs.items()if k.startswith(p['id']+'/')]
    keep_roof=bool(rigs) and p.get('preserveRoof',t['retainSurveyedRoofs'] and aligned)
    if keep_roof:
        # These selected small roofs are kept only at their existing height.
        base['cap']=False
    if p.get('special')=='coop':
        c=p['detail']
        # Main east elevation: black shop base, cream upper fascia, raised
        # central entry bay. The irregular west service plan stays intact.
        base['z1']=p['wingHeight'];base['bands']=[band(0,p['wingHeight'],'wall')]
        base['parapet']=0
        for edge in fronts:
            length=((plan['ring'][(edge+1)%len(plan['ring'])][0]-plan['ring'][edge][0])**2+(plan['ring'][(edge+1)%len(plan['ring'])][1]-plan['ring'][edge][1])**2)**.5
            base['faces'][str(edge)]=dict(bands=[band(0,c['bulkhead'],'dark'),band(c['bulkhead'],c['shopTop'],'shop',canopies=[dict(s0=c['awningEnd'],s1=length-c['awningEnd'],z=c['awningHeight'],d=c['awningDepth'],t=c['awningThickness'],tone='dark')]),band(c['shopTop'],p['wingHeight']-c['wingCornice'],'wall'),band(p['wingHeight']-c['wingCornice'],p['wingHeight'],'trim')])
        center=rect(f,p['centerPlan']);u0,u1,v0,v1=center;span=v1-v0
        skins['coop-entry']=dict(kind='bays',windowRule=t['windowRule'],field='dark',bay=span,window=dict(w=span*c['entryWindowRatio'],h=c['entryWindowHeight'],sill=c['entryWindowSill'],mullion=dict(cols=c['mullionCols'],rows=c['mullionRows'],w=c['mullionWidth'],tone='metal')),glass='glass',frame='dark',reveal=c['entryReveal'])
        central=dict(id='raised-entry',plan=center,z0=0,z1=h,bands=[band(0,h,'wall')],roofTone='roof',faces={'u1':dict(bands=[band(0,c['entryTop'],'coop-entry'),band(c['entryTop'],c['entryUpperTop'],'coop-entry'),band(c['entryUpperTop'],h-c['centerCornice'],'wall',signs=[lettering('CO-OP',span*c['coopWidthRatio'],span/2,c['coopBaseline'],'dark',config['lettering'],True),lettering('THE',span*c['theWidthRatio'],span/2,c['theBaseline'],'dark',config['lettering'],True)]),band(h-c['centerCornice'],h,'trim')])})
        blocks.append(central)
    if p.get('special')=='hole':
        c=p['detail'];u=f['L']*p['marqueeAt'][0];v=f['W']*p['marqueeAt'][1]
        for key,width,low,high,lines,tone in p['panels']:
            panel=[u,u+width,v,v+c['panelThickness']]
            signs=[lettering(text,width*ratio,width/2,z,t,config['lettering'],serif)for text,ratio,z,t,serif in lines]
            faces={k:dict(bands=[band(low,high,tone,signs=signs)])for k in ['v0','v1']}
            blocks.append(dict(id=key,plan=panel,z0=low,z1=high,bands=[band(low,high,tone)],roofTone='metal',faces=faces,parapet=c['frameWidth'],parapetTone='metal'))
        # Two timber-framed display bays under deep green awnings.
        skins['bar-window']=dict(kind='bays',windowRule=t['windowRule'],field='wall',bay=c['frontBay'],glass='glass',frame='timber',reveal=c['windowReveal'],window=dict(w=c['windowWidth'],h=c['windowHeight'],sill=c['windowSill'],frame=dict(w=c['windowFrame'],tone='timber')))
        for edge in fronts:
            a,b=plan['ring'][edge],plan['ring'][(edge+1)%len(plan['ring'])];length=((b[0]-a[0])**2+(b[1]-a[1])**2)**.5
            base['faces'][str(edge)]=dict(bands=[band(0,h,'bar-window',canopies=[dict(s0=c['awningEnd'],s1=length-c['awningEnd'],z=c['awningHeight'],d=c['awningDepth'],t=c['awningThickness'],tone='awning')])])
    detailMeshes=[]
    if p.get('special')=='barefoot-photo':detailed_barefoot(base,blocks,plan,p,detailMeshes)
    if p.get('special')=='coop-photo':detailed_coop(base,blocks,plan,p,detailMeshes)
    if p.get('special') in ['potbelly-photo','wingstop-photo','miss-behavin-photo']:detailed_row_shop(base,blocks,plan,p,detailMeshes)
    return dict(id=p['id'],name=p['name'],category='guadalupe',replaceFrontage=True,aliases=p.get('aliases',[]),labelOverride=p.get('labelOverride',False),
                sources=dict(reference=p['source'],observations=p['observations'],footprint='data/snapshots/'+config['snapshot']+'/buildings.detailed.geojson',dimensions='Footprints retained. Heights, facade subdivisions, sign sizing and unphotographed elevations are approximate unless explicitly measured in the source.'),
                footprint=footprint,frame=dict(obb=f),levels=dict(floors=floors),colours=colours,skins=skins,blocks=blocks,preserveRoof=keep_roof,preserveRoofscape=t['retainSurveyedRoofs'] and aligned,
                **({'detailMeshes':detailMeshes,'materials':p['materials']}if p.get('photoDetail') else {}))


def main():
    config=json.loads((ROOT/'data/guadalupe_profiles.json').read_text(encoding='utf-8'))
    features={f['properties']['id']:f for f in json.loads((ROOT/f"data/snapshots/{config['snapshot']}/buildings.detailed.geojson").read_text(encoding='utf-8'))['features']}
    roofs=json.loads((ROOT/'data/roofs.geojson').read_text())['rig']['roofs']
    buildings=[make_building(p,features[p['id']],config,roofs) for p in config['buildings']]
    validate(buildings)
    (ROOT/'data/guadalupe.json').write_text(json.dumps(dict(version=1,buildings=buildings),separators=(',',':'),ensure_ascii=False)+'\n',encoding='utf-8')
    print('Guadalupe buildings:',len(buildings))


if __name__=='__main__':main()
