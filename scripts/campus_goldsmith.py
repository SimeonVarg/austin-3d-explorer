"""Goldsmith's distinct courtyard registers and West Mall entrance.

All dimensions are editable interpretations of exterior views. The mapped
footprint, courtyard hole and five existing roof wings remain authoritative;
the projecting entrance has its own raised pavilion and covering roof.
"""
import math

T = dict(floors=[0, 4.0, 8.0, 12.4], sill=.65, frame=.09,
         reveal=.42, mullion=.045, outerBay=5.2, courtBay=5.15,
         lowerWidth=1.05, lowerHeight=2.25, middleWidth=.95,
         middleHeight=2.5, tripleOffset=1.14, studioWidth=3.35,
         studioHeight=3.15, archWidth=3.15, archHeight=3.45,
         archRise=1.38, archTrim=.19, archSegments=24,
         doorWidth=3.1, doorHeight=3.6, doorReveal=.85,
         portalWidth=5.4, portalHeight=5.1, portalDepth=.22,
         lanternHeight=3.35, lanternSpacing=2.3, lanternWidth=.32,
         lanternDepth=.34, lanternBody=.48, lanternFrame=.035,
         courseHeight=.12, courseDepth=.085, courseZ=[7.86,11.88],
         studioSill=.35, archSill=.2, courtSideWidth=2.25,
         courtSideHeight=2.9, courtSideSill=.4, corniceZ=11.92,
         courtEndCols=[.29,.5,.71], courtMiddleCols=[.5],
         entryCols=[.31,.5,.69], entryWindowWidth=2.05,
         entryMiddleSill=1.4, entryMiddleHeight=2.35,
         sashCols=[.25,.5,.75], sashRows=[.2,.4,.6,.8],
         entrySashRows=[.25,.5,.75], doorSashCols=[.5],
         doorSashRows=[.78], doorFrame=.09,
         courtDoorStile=.11, courtDoorBottom=.38,
         courtDoorRailHeight=.11, courtDoorRailZ=1.05,
         courtDoorRelief=.13, courtDoorBackProud=.012,
         courtDoorPullSpacing=.15, courtDoorPullWidth=.035,
         courtDoorPullZ=[.95,1.27], courtDoorPullProud=.06)
COLOURS = dict(golSash='#67776b', golDoor='#374f46', golIron='#343b37',
               golStone='#d2c9b5', golWarmStone='#c5bba5',
               golGlass='#3e5252', golLamp='#c5c3a1',
               golWood='#966a43', golWoodDark='#534238',
               golSoffit='#d5cbb7', golGutter='#616369', golPavilionTile='#b99478')

# Photo-fitted, not surveyed. Only the mapped entrance frontage is fixed.
# This shallow upper volume keeps the existing wing hip below its floor;
# extending it farther back requires checking that roof intersection again.
PAVILION = dict(depth=3.95, floor=13.2, floorThickness=.24,
    pierWidth=.68, pierInset=.34, ceiling=16.12, rearWall=.24,
    friezeTop=17.0, friezeProud=.12, corniceHeight=.14,
    sideOver=.52, frontOver=1.14, rearOver=.26,
    eave=17.58, eaveThickness=.15, roofRise=.78, gutterHeight=.15,
    bracketCount=12, bracketWidth=.19,
    bracketProfile=[[-.04,0],[1.05,0],[1.05,-.18],[.76,-.23],
                    [.49,-.39],[.27,-.53],[-.04,-.53]],
    upperWidth=1.7, upperHeight=2.65, upperCols=[.27,.5,.73],
    balconyWidth=3.8, balconyDepth=.76, balconyFloor=8.12,
    balconySlab=.19, railHeight=1.04, railWidth=.032, balusters=19,
    columnX=1.55, columnRadius=.14, columnSides=12,
    columnBase=8.31, columnTop=11.26,
    pedimentWidth=4.15, pedimentBase=11.35, pedimentRise=1.12,
    pedimentDepth=.3, pedimentMoulding=.11,
    cofferInset=.26, cofferBorder=.10, rosetteRadius=.18,
    rosetteSides=16, rosetteDepth=.045,
    capitalScale=1.3, capitalProud=.07, corniceSide=.08, corniceProud=.1,
    cofferPanelThickness=.035, cofferBeamThickness=.05,
    eaveBeamBack=-.02, eaveBeamFront=.16, gutterHalfWidth=.045,
    columnCapitalScale=1.5, columnCapitalDepthScale=2.6,
    columnCapitalHeight=.12, embed=.01,
    balconyBracketInset=.34, balconyBracketHalfWidth=.12,
    balconyBracketDepthScale=.7, balconyBracketHeight=.55,
    pedimentLintelHeight=.18)


def refine(model, profile):
    if model['code'] != 'GOL':
        return model
    model['replaceFrontage']=True
    skins=model['skins']; wall=model['blocks'][0]
    model['colours'].update({k:{'hex':v} for k,v in COLOURS.items()})
    model['levels']['floors']=T['floors'][:]

    def window(name, width, height, *, bay=None, sill=None, arch=None,
               offsets=None, cols=None, sash=None, reveal=None, tone='golSash'):
        w=dict(w=width,h=height,sill=T['sill'] if sill is None else sill,
               frame=dict(w=T['frame'],tone=tone),
               mullion=dict(cols=T['sashCols'],rows=T['sashRows'] if sash is None else sash,
                            w=T['mullion'],tone=tone))
        if offsets:w['offsets']=offsets
        if cols:w['cols']=cols
        if arch:
            # A rectangular frame would leave two square corners above the
            # curved head. The arch supplies its own curved stone surround.
            w.pop('frame',None)
            w['arch']=dict(rise=arch,trim=T['archTrim'],tone='golStone',segments=T['archSegments'])
        skins[name]=dict(kind='bays',field='wall',bay=bay or T['outerBay'],
                         window=w,glass='golGlass',frame='golStone',
                         reveal=T['reveal'] if reveal is None else reveal)
        return name

    window('golGround',T['lowerWidth'],T['lowerHeight'],offsets=[[-T['tripleOffset'],T['lowerWidth']],[0,T['lowerWidth']],[T['tripleOffset'],T['lowerWidth']]])
    window('golMiddle',T['middleWidth'],T['middleHeight'],offsets=[[-T['tripleOffset'],T['middleWidth']],[0,T['middleWidth']],[T['tripleOffset'],T['middleWidth']]])
    window('golStudio',T['studioWidth'],T['studioHeight'],sill=T['studioSill'])
    window('courtEndStudio',T['studioWidth'],T['studioHeight'],sill=T['studioSill'],cols=T['courtEndCols'])
    window('courtEndMiddle',T['middleWidth'],T['middleHeight'],cols=T['courtMiddleCols'],
           offsets=[[-T['tripleOffset'],T['middleWidth']],[0,T['middleWidth']],[T['tripleOffset'],T['middleWidth']]])
    window('golCourtArch',T['archWidth'],T['archHeight'],cols=[T['courtEndCols'][0],T['courtEndCols'][-1]],
           sill=T['archSill'],arch=T['archRise'])
    window('golCourtSide',T['courtSideWidth'],T['courtSideHeight'],bay=T['courtBay'],sill=T['courtSideSill'])
    def bands(lower,middle='golMiddle',upper='golStudio'):
        f=T['floors']
        return [dict(z0=f[0],z1=f[1],skin=lower),dict(z0=f[1],z1=f[2],skin=middle),
                dict(z0=f[2],z1=T['corniceZ'],skin=upper),dict(z0=T['corniceZ'],z1=f[3],skin='trim')]
    wall['bands']=bands('golGround')
    wall['faces']={}
    for i in range(4):
        end=i in (1,3)
        bb=bands('golCourtArch','courtEndMiddle','courtEndStudio') if end else bands('golCourtSide')
        if end:
            # The photo's middle ground arch reaches the paving as a door.
            # Give it its own opening so side windows retain their raised sills.
            hole=wall['plan']['holes'][0]
            mid=math.dist(hole[i],hole[(i+1)%len(hole)])/2
            bb[0]['openings']=[dict(s0=mid-T['archWidth']/2,s1=mid+T['archWidth']/2,
                z0=0,z1=T['archSill']+T['archHeight'],d=T['reveal'],glass='golGlass',tone='golStone',
                arch=dict(rise=T['archRise'],trim=T['archTrim'],tone='golStone',segments=T['archSegments']),
                mullion=dict(cols=T['sashCols'],rows=T['sashRows'],w=T['mullion'],tone='golDoor'))]
        wall['faces'][f'h0.{i}']=dict(bands=bb)
    # North projecting pavilion: a single genuine inset opening, with the
    # upper windows separately composed instead of another repeated door row.
    ring=wall['plan']['ring']; a,b=ring[6],ring[7]
    length=math.dist(a,b)
    window('golEntry',T['doorWidth'],T['doorHeight'],bay=length,sill=0,
           cols=[.5],reveal=T['doorReveal'],tone='golDoor')
    skins['golEntry']['window']['mullion']=dict(cols=T['doorSashCols'],rows=T['doorSashRows'],w=T['doorFrame'],tone='golDoor')
    window('golEntryMiddle',T['entryWindowWidth'],T['entryMiddleHeight'],bay=length,cols=T['entryCols'],
           sill=T['entryMiddleSill'],sash=T['entrySashRows'])
    window('golEntryUpper',PAVILION['upperWidth'],PAVILION['upperHeight'],bay=length,
           cols=PAVILION['upperCols'],sill=T['studioSill'])
    wall['faces']['6']=dict(bands=bands('golEntry','golEntryMiddle','golEntryUpper'))

    meshes={}
    def solid(tone,pts,faces):
        m=meshes.setdefault(tone,dict(id='goldsmith-'+tone,tone=tone,vertices=[],triangles=[]));off=len(m['vertices'])
        m['vertices'].extend([[round(v,5)for v in p]for p in pts])
        center=[sum(p[k] for p in pts)/len(pts) for k in range(3)]
        for f in faces:
            a,b,c=(pts[f[k]] for k in range(3))
            u=[b[k]-a[k] for k in range(3)];v=[c[k]-a[k] for k in range(3)]
            n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
            # Retain the fan anchor when reversing a concave bracket profile.
            # Reversing the whole list can put the anchor across its notch.
            if sum(n[k]*(a[k]-center[k]) for k in range(3))<0:f=(f[0],*reversed(f[1:]))
            m['triangles'].extend([[off+f[0],off+f[j],off+f[j+1]]for j in range(1,len(f)-1)])
    # The near-axis-aligned north edge is retained exactly by transforming
    # local facade boxes onto its tangent and outward normal.
    center=[(a[k]+b[k])/2 for k in range(2)];axis=[(b[k]-a[k])/length for k in range(2)];normal=[axis[1],-axis[0]]
    def facade(tone,x0,x1,d0,d1,z0,z1):
        pts=[]
        for z in (z0,z1):
            for x,d in ((x0,d0),(x1,d0),(x1,d1),(x0,d1)):
                pts.append([center[k]+x*axis[k]+d*normal[k]for k in range(2)]+[z])
        solid(tone,pts,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
    def local_solid(tone,pts,faces):
        solid(tone,[[center[k]+x*axis[k]+d*normal[k] for k in range(2)]+[z]
                    for x,d,z in pts],faces)
    def front_prism(tone,outline,d0,d1):
        n=len(outline)
        local_solid(tone,[[x,d,z] for d in (d0,d1) for x,z in outline],
                    [tuple(range(n)),tuple(range(n,2*n))]+
                    [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)])

    p=PAVILION; half_front=length/2; depth=p['depth']; floor=p['floor']
    ceiling=p['ceiling']; eave=p['eave']; thick=p['pierWidth']
    # A real open volume: floor, rear/side walls and ceiling, with daylight
    # gaps between the front piers. No glass or black plane seals the loggia.
    facade('golWarmStone',-half_front,half_front,-depth,0,T['floors'][-1],floor)
    facade('golStone',-half_front,half_front,-depth,p['friezeProud'],floor,floor+p['floorThickness'])
    facade('golWarmStone',-half_front,half_front,-depth,-depth+p['rearWall'],floor,ceiling)
    for side in (-1,1):
        lo,hi=sorted([side*half_front,side*(half_front-thick)])
        facade('golStone',lo,hi,-depth,0,floor,ceiling)
    pier_centres=[-half_front+p['pierInset'],-length/6,length/6,half_front-p['pierInset']]
    for x in pier_centres:
        facade('golStone',x-thick/2,x+thick/2,-thick,p['friezeProud'],floor,ceiling)
        facade('golSoffit',x-thick*p['capitalScale']/2,x+thick*p['capitalScale']/2,-thick,p['friezeProud']+p['capitalProud'],
               ceiling-p['corniceHeight'],ceiling)
    # The lower cornice supplies the single exposed ceiling underside.
    facade('golStone',-half_front,half_front,-depth,p['friezeProud'],ceiling+p['corniceHeight'],p['friezeTop'])
    for z in (ceiling,p['friezeTop']):
        facade('golSoffit',-half_front-p['corniceSide'],half_front+p['corniceSide'],-depth,p['friezeProud']+p['corniceProud'],z,z+p['corniceHeight'])
    # Warm, recessed ceiling coffers remain behind the white front structure.
    for left,right in zip(pier_centres,pier_centres[1:]):
        inset=p['cofferInset'];border=p['cofferBorder'];x0=left+inset;x1=right-inset
        panel=ceiling-p['cofferPanelThickness'];beam=panel-p['cofferBeamThickness']
        facade('golWoodDark',x0,x1,-depth+inset,-thick,panel,ceiling)
        for xx in (x0,x1-border):
            facade('golWood',xx,xx+border,-depth+inset,-thick,beam,panel)
        for dd in (-depth+inset,-thick-border):
            facade('golWood',x0,x1,dd,dd+border,beam,panel)
    # The deep eave has an actual pale underside and shaped timber brackets.
    x0=-half_front-p['sideOver'];x1=half_front+p['sideOver']
    d0=-depth-p['rearOver'];d1=p['frontOver']
    facade('golSoffit',x0,x1,d0,d1,eave-p['eaveThickness'],eave)
    facade('golWood',-half_front,half_front,-depth,0,p['friezeTop'],eave-p['eaveThickness'])
    facade('golWood',x0,x1,p['eaveBeamBack'],p['eaveBeamFront'],p['friezeTop'],eave-p['eaveThickness'])
    n=p['bracketCount']
    for i in range(n):
        x=x0+(i+.5)*(x1-x0)/n;w=p['bracketWidth'];section=p['bracketProfile'];m=len(section)
        pts=[[xx,d,eave-p['eaveThickness']+z] for xx in (x-w/2,x+w/2) for d,z in section]
        local_solid('golWood',pts,[tuple(range(m)),tuple(range(m,2*m))]+
                    [(j,(j+1)%m,(j+1)%m+m,j+m) for j in range(m)])
    # A low hip closes the whole projecting pavilion. Its ridge is local to
    # this roof and cannot reach the courtyard or alter the five wing rigs.
    ridge_d=(d0+d1)/2;run=(d1-d0)/2
    roof_pts=[[x0,d0,eave],[x1,d0,eave],[x1,d1,eave],[x0,d1,eave],
              [x0+run,ridge_d,eave+p['roofRise']],[x1-run,ridge_d,eave+p['roofRise']]]
    local_solid('golPavilionTile',roof_pts,[(0,1,5,4),(1,2,5),(2,3,4,5),(3,0,4),(3,2,1,0)])
    for dd in (d0,d1):
        facade('golGutter',x0,x1,dd-p['gutterHalfWidth'],dd+p['gutterHalfWidth'],eave,eave+p['gutterHeight'])
    for xx in (x0,x1):
        facade('golGutter',xx-p['gutterHalfWidth'],xx+p['gutterHalfWidth'],d0,d1,eave,eave+p['gutterHeight'])
    # Central balcony and pediment frame the upper entrance window. Rails,
    # round shafts and sloping mouldings have depth and cast their own shade.
    bw=p['balconyWidth']/2;bz=p['balconyFloor'];bd=p['balconyDepth'];rw=p['railWidth']
    facade('golWarmStone',-bw,bw,0,bd,bz,bz+p['balconySlab'])
    rz=bz+p['balconySlab'];rt=rz+p['railHeight']
    for zz in (rz,rt):facade('golIron',-bw,bw,bd-rw,bd,zz,zz+rw)
    for i in range(p['balusters']):
        x=-bw+i*2*bw/(p['balusters']-1)
        facade('golIron',x-rw/2,x+rw/2,bd-rw,bd,rz,rt)
    for side in (-1,1):
        x=side*bw
        facade('golIron',x-rw/2,x+rw/2,0,bd,rt,rt+rw)
        x=side*p['columnX'];radius=p['columnRadius'];sides=p['columnSides']
        pts=[[x+radius*math.cos(i*math.tau/sides),radius+radius*math.sin(i*math.tau/sides),z]
             for z in (p['columnBase'],p['columnTop']) for i in range(sides)]
        local_solid('golStone',pts,[tuple(range(sides)),tuple(range(sides,2*sides))]+
                    [(i,(i+1)%sides,(i+1)%sides+sides,i+sides) for i in range(sides)])
        for z in (p['columnBase'],p['columnTop']):
            facade('golSoffit',x-radius*p['columnCapitalScale'],x+radius*p['columnCapitalScale'],-p['embed'],radius*p['columnCapitalDepthScale'],z,z+p['columnCapitalHeight'])
        bx=side*(bw-p['balconyBracketInset']);bhw=p['balconyBracketHalfWidth']
        facade('golWarmStone',bx-bhw,bx+bhw,0,bd*p['balconyBracketDepthScale'],bz-p['balconyBracketHeight'],bz)
    pw=p['pedimentWidth']/2;pz=p['pedimentBase'];rise=p['pedimentRise'];q=p['pedimentMoulding']
    facade('golStone',-pw,pw,-p['embed'],p['pedimentDepth'],pz-p['pedimentLintelHeight'],pz)
    front_prism('golWarmStone',[(-pw,pz),(pw,pz),(0,pz+rise)],-p['embed'],p['pedimentDepth'])
    for side in (-1,1):
        front_prism('golSoffit',[(0,pz+rise),(side*pw,pz),(side*(pw-q),pz+q),(0,pz+rise+q)],
                    p['pedimentDepth'],p['pedimentDepth']+q)
    facade('golSoffit',-pw,pw,p['pedimentDepth'],p['pedimentDepth']+q,pz,pz+q)
    # Modest raised roundels on the frieze; fine carved motifs stay simplified.
    for x in (-length/3,0,length/3):
        z=(ceiling+p['friezeTop'])/2;r=p['rosetteRadius']
        front_prism('golSoffit',[(x+r*math.cos(i*math.tau/p['rosetteSides']),z+r*math.sin(i*math.tau/p['rosetteSides']))
                               for i in range(p['rosetteSides'])],p['friezeProud'],p['friezeProud']+p['rosetteDepth'])
    half=T['portalWidth']/2;opening=T['doorWidth']/2
    for side in (-1,1):
        lo,hi=sorted([side*(opening+.12),side*(opening+.34)])
        facade('golStone',lo,hi,-.01,T['portalDepth'],0,T['doorHeight']+.3)
        lo,hi=sorted([side*(half-.16),side*half])
        facade('golWarmStone',lo,hi,-.01,.1,0,T['portalHeight'])
    for z,width,dep in [(T['doorHeight'],T['doorWidth']+.68,.28),(T['doorHeight']+.22,T['doorWidth']+.82,.19),(T['portalHeight'],T['portalWidth']+.18,.18)]:
        facade('golStone',-width/2,width/2,-.01,dep,z,z+.12)
    # Iron transom is in front of the recessed glass, not painted on masonry.
    for i in range(13):
        x=-opening+(i+.5)*T['doorWidth']/13
        facade('golIron',x-.018,x+.018,-.60,-.565,2.82,T['doorHeight']-.10)
    for side in (-1,1):
        x=side*T['lanternSpacing'];z=T['lanternHeight'];w=T['lanternWidth'];d=T['lanternDepth'];h=T['lanternBody'];q=T['lanternFrame']
        facade('golIron',x-.065,x+.065,0,.075,z-.22,z+h+.18)
        facade('golIron',x-.04,x+.04,.06,d,z+.10,z+.16)
        facade('golLamp',x-w/2+q,x+w/2-q,d,d+.15,z,z+h)
        for u in (x-w/2,x+w/2-q):facade('golIron',u,u+q,d-.02,d+.17,z-.035,z+h+.035)
        for zz in (z-.035,z+h):facade('golIron',x-w/2,x+w/2,d-.025,d+.175,zz,zz+q)
        facade('golIron',x-w*.65,x+w*.65,d-.06,d+.21,z+h+.035,z+h+.1)
    # Physical double door leaves below each courtyard arch's fanlight.
    # They sit just ahead of the glass and inside the stone reveal, rather
    # than drawing a rectangular frame around the entire curved opening.
    hole=wall['plan']['holes'][0]
    area=sum(p[0]*hole[(i+1)%len(hole)][1]-hole[(i+1)%len(hole)][0]*p[1] for i,p in enumerate(hole))
    for edge in (1,3):
        p,q=hole[edge],hole[(edge+1)%len(hole)]
        ll=math.dist(p,q);tangent=[(q[k]-p[k])/ll for k in range(2)]
        inward=[tangent[1],-tangent[0]] if area<0 else [-tangent[1],tangent[0]]
        middle=[(p[k]+q[k])/2 for k in range(2)]
        def doorbox(tone,x0,x1,d0,d1,z0,z1):
            pts=[]
            for z in (z0,z1):
                for x,d in ((x0,d0),(x1,d0),(x1,d1),(x0,d1)):
                    pts.append([middle[k]+x*tangent[k]+d*inward[k] for k in range(2)]+[z])
            solid(tone,pts,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
        half=T['archWidth']/2;stile=T['courtDoorStile']
        spring=T['archSill']+T['archHeight']-T['archRise']
        back=-T['reveal']+T['courtDoorBackProud'];front=back+T['courtDoorRelief']
        for x0,x1 in [(-half,-half+stile),(-stile/2,stile/2),(half-stile,half)]:
            doorbox('golDoor',x0,x1,back,front,0,spring)
        for x0,x1 in [(-half+stile,-stile/2),(stile/2,half-stile)]:
            doorbox('golDoor',x0,x1,back,front,0,T['courtDoorBottom'])
            doorbox('golDoor',x0,x1,back,front,T['courtDoorRailZ'],T['courtDoorRailZ']+T['courtDoorRailHeight'])
        doorbox('golDoor',-half,half,back,front,spring-stile,spring)
        for side in (-1,1):
            x=side*T['courtDoorPullSpacing'];pw=T['courtDoorPullWidth']
            doorbox('golIron',x-pw/2,x+pw/2,front,front+T['courtDoorPullProud'],*T['courtDoorPullZ'])
    # Pale continuous sill courses at the photographed register transitions.
    for rg,into in [(wall['plan']['ring'],False),(wall['plan']['holes'][0],True)]:
        area=sum(p[0]*rg[(i+1)%len(rg)][1]-rg[(i+1)%len(rg)][0]*p[1]for i,p in enumerate(rg))
        for i,p in enumerate(rg):
            q=rg[(i+1)%len(rg)];ll=math.dist(p,q);dx=(q[0]-p[0])/ll;dy=(q[1]-p[1])/ll
            nx,ny=dy,-dx
            if (area<0) != into:nx,ny=-nx,-ny
            for z in T['courseZ']:
                pts=[]
                for zz in (z,z+T['courseHeight']):
                    pts.extend([[p[0],p[1],zz],[q[0],q[1],zz],[q[0]+nx*T['courseDepth'],q[1]+ny*T['courseDepth'],zz],[p[0]+nx*T['courseDepth'],p[1]+ny*T['courseDepth'],zz]])
                solid('golStone',pts,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
    model['detailMeshes']=[mesh for mesh in model.get('detailMeshes',[]) if not mesh['id'].startswith('goldsmith-')]+list(meshes.values())
    model['sources']['observations']='Distinct wing and courtyard registers with inset arches and green doors. North entrance has three closed registers, central balcony and pediment, and a raised open loggia beneath a bracketed eave and separate covering roof. Mapped footprint, courtyard and five wing roofs preserved. Pavilion dimensions and unphotographed roof junction are adjustable photo-based approximations; fine carved ornament remains simplified.'
    return model
