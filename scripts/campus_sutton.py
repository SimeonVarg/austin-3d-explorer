"""Sutton's photographed east/north elevations in the existing metre frame.

Only facade and underside details are authored here. The surveyed footprint,
wall height and existing tiled roof rig remain the caller's responsibility.
"""
import copy
import math


# Appearance/dimension choices are editable without changing mesh code.
T = dict(
    eastBays=5, longBay=4.0, groundTop=4.6, upperStart=9.25,
    groundWidth=2.55, groundSill=.42, groundHead=4.02, archRise=1.18,
    middleWidth=2.05, middleSill=.65, middleHeight=2.96,
    topWidth=2.08, topSill=.44, topHeight=2.99,
    windowDepth=.46, frameWidth=.085, mullionWidth=.044,
    rows=[.18,.36,.54,.72,.88], cols=[.25,.5,.75],
    surroundWidth=.22, surroundDepth=.17, sillDepth=.22, sillHeight=.14,
    topPierWidth=.55, topPierDepth=.13, topCorniceHeight=.17,
    balconyDepth=.43, balconyMargin=.13, balconyHeight=.76,
    balconyBar=.032, balconyPicket=.018, balconySpacing=.18,
    eaveDepth=1.02, eaveThickness=.18, eaveBelow=.08,
    bracketPitch=.78, bracketWidth=.14, bracketHeight=.47,
    bracketInset=.18, friezeHeight=.5, friezeBlueHeight=.11,
    entryAt=.5, entryWidth=2.5, entryDepth=.73,
    doorBottom=.06, doorHeight=2.44, doorPanelDepth=.055,
    doorFrame=.11, doorPaneBottom=.97, doorPaneTop=2.20,
    doorPanelBottom=.19, doorPanelTop=.79, doorStud=.035,
    fanSegments=24, fanSpokes=9, benchWidth=1.95,
    benchDepth=.53, benchSeat=.47, benchThickness=.13,
    lampHeight=.54, lampWidth=.23, lampDepth=.25,
    daylightGlassStrength=.2, maxDetailTriangles=26000,
)
COLOURS = dict(sutBrick='#b78962', sutStone='#d7c7ad', sutPale='#e0cda6',
    sutWood='#713e2e', sutPane='#3d4640', sutGreen='#375f4c',
    sutDoor='#71928a', sutTimber='#62432d', sutOchre='#a18347',
    sutBlue='#617993', sutIron='#38473d', sutLamp='#b5a879')


class Details:
    def __init__(self): self.meshes={}

    def solid(self,tone,points,faces):
        m=self.meshes.setdefault(tone,dict(id='sut-'+tone,tone=tone,vertices=[],triangles=[]))
        off=len(m['vertices']);m['vertices'].extend([[round(x,5) for x in p] for p in points])
        for f in faces:
            m['triangles'].extend([[off+f[0],off+f[i],off+f[i+1]] for i in range(1,len(f)-1)])

    def box(self,tone,a,b,s0,s1,d0,d1,z0,z1):
        length=math.dist(a,b);tx,ty=(b[0]-a[0])/length,(b[1]-a[1])/length
        def at(s,d,z):return [a[0]+tx*s+ty*d,a[1]+ty*s-tx*d,z]
        pts=[at(s,d,z) for z in [z0,z1] for s,d in [(s0,d0),(s1,d0),(s1,d1),(s0,d1)]]
        fs=[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
        self.solid(tone,pts,[tuple(reversed(f)) for f in fs])

    def line(self,tone,a,b,sa,za,sb,zb,depth,width):
        # Flat solid bars in a facade plane, including fanlight spokes.
        length=math.dist(a,b);tx,ty=(b[0]-a[0])/length,(b[1]-a[1])/length
        ds,dz=sb-sa,zb-za;span=math.hypot(ds,dz);u=-dz/span*width/2;v=ds/span*width/2
        ring=[(sa+u,za+v),(sa-u,za-v),(sb-u,zb-v),(sb+u,zb+v)]
        pts=[[a[0]+tx*s+ty*d,a[1]+ty*s-tx*d,z] for d in [depth,depth+width] for s,z in ring]
        self.solid(tone,pts,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])


def opening(c,width,z0,z1,t,arched=False,depth=None):
    p=dict(s0=c-width/2,s1=c+width/2,z0=z0,z1=z1,d=t['windowDepth'] if depth is None else depth,
        glass='sutPane',tone='sutStone' if arched else 'sutBrick',lit=False,
        mullion=dict(cols=t['cols'],rows=t['rows'],w=t['mullionWidth'],tone='sutWood'))
    if arched:p['arch']=dict(rise=t['archRise'],trim=t['surroundWidth'],tone='sutStone',segments=t['fanSegments'],proud=.02)
    return p


def refine(model,profile):
    if model.get('code')!='SUT':return model
    t={**T,**profile.get('suttonDetail',{})};col={**COLOURS,**profile.get('suttonColours',{})}
    d=copy.deepcopy(model);d['replaceFrontage']=True;d['replaceArcades']=True;base=d['blocks'][0];h=base['z1'];ring=base['plan']['ring'];m=Details()
    assert len(ring)==4,'Sutton detail expects its surveyed quadrilateral'
    # Derive compass faces from the footprint, not ambiguous photo filenames.
    east=max(range(4),key=lambda i:(ring[i][0]+ring[(i+1)%4][0])/2)
    north=max(range(4),key=lambda i:(ring[i][1]+ring[(i+1)%4][1])/2)
    assert east!=north
    d['colours'].update({k:dict(hex=v) for k,v in col.items()})
    d.setdefault('materials',{}).update(dict(sutBrick='brick',sutStone='stone',sutPale='stone',
        sutWood='plain',sutPane='glass',sutGreen='plain',sutDoor='plain',sutTimber='plain',
        sutOchre='plain',sutBlue='plain',sutIron='plain',sutLamp='plain'))
    for key in ['sutBrick','sutStone','sutPale']:
        d['skins'][key]=dict(kind='flat',field=key)
    faces=base.setdefault('faces',{})
    for face in [east,north]:
        a,b=ring[face],ring[(face+1)%4];length=math.dist(a,b)
        n=t['eastBays'] if face==east else round(length/t['longBay']);pitch=length/n
        lower=[];middle=[];top=[]
        for j in range(n):
            c=(j+.5)*pitch
            is_entry=face==east and j==n//2
            lower.append(opening(c,t['entryWidth'] if is_entry else t['groundWidth'],
                t['doorBottom'] if is_entry else t['groundSill'],t['groundHead'],t,True,
                t['entryDepth'] if is_entry else None))
            if is_entry:lower[-1]['mullion']={'cols':[],'rows':[],'w':t['mullionWidth'],'tone':'sutDoor'}
            else:
                # Stone arch reveals meet a separate red timber sash at the
                # recessed plane. The whole deep jamb is not painted wood.
                depth=-t['windowDepth']+.02;half=t['groundWidth']/2
                spring=t['groundHead']-t['archRise'];fw=t['frameWidth']
                for s in [c-half,c+half-fw]:
                    m.box('sutWood',a,b,s,s+fw,depth,depth+fw,t['groundSill'],spring)
                m.box('sutWood',a,b,c-half,c+half,depth,depth+fw,t['groundSill'],t['groundSill']+fw)
                for k in range(t['fanSegments']):
                    q=math.pi*k/t['fanSegments'];r=math.pi*(k+1)/t['fanSegments']
                    m.line('sutWood',a,b,c+half*math.cos(q),spring+t['archRise']*math.sin(q),
                           c+half*math.cos(r),spring+t['archRise']*math.sin(r),depth,fw)
            mz=t['groundTop']+t['middleSill'];tz=t['upperStart']+t['topSill']
            middle.append(opening(c,t['middleWidth'],mz,mz+t['middleHeight'],t))
            top.append(opening(c,t['topWidth'],tz,tz+t['topHeight'],t))
            # Three distinct registers: red arched sash, plain brick middle
            # opening and pale framed top opening with its real iron balcony.
            for width,z0,z1 in [(t['middleWidth'],mz,mz+t['middleHeight']),
                                (t['topWidth'],tz,tz+t['topHeight'])]:
                half=width/2
                m.box('sutPale',a,b,c-half-.06,c+half+.06,-.02,t['sillDepth'],z0-t['sillHeight'],z0)
                for s in [c-half,c+half-t['frameWidth']]:
                    m.box('sutWood',a,b,s,s+t['frameWidth'],-t['windowDepth'],.018,z0,z1)
            half=t['topWidth']/2;pw=t['topPierWidth']
            for s in [c-half-pw,c+half]:
                m.box('sutPale',a,b,s,s+pw,.008,t['topPierDepth'],tz-.19,tz+t['topHeight']+.12)
                m.box('sutStone',a,b,s+.055,s+pw-.055,t['topPierDepth'],t['topPierDepth']+.035,tz+.02,tz+t['topHeight']-.08)
            m.box('sutPale',a,b,c-half-pw,c+half+pw,.01,t['topPierDepth']+.04,
                  tz+t['topHeight'],tz+t['topHeight']+t['topCorniceHeight'])
            # Restrained blue ceramic bands are physical inset panels, not a
            # substitute for the surrounding stone and window recesses.
            m.box('sutBlue',a,b,c-half,c+half,.006,.025,mz-.44,mz-.23)
            m.box('sutBlue',a,b,c-half-pw,c+half+pw,.01,.025,tz-.36,tz-.25)
            bh=half+t['balconyMargin'];bd=t['balconyDepth'];bar=t['balconyBar'];bz=tz+.02
            m.box('sutGreen',a,b,c-bh,c+bh,.04,bd,bz-.055,bz)
            m.box('sutGreen',a,b,c-bh,c+bh,bd-bar/2,bd+bar/2,bz+t['balconyHeight'],bz+t['balconyHeight']+bar)
            for s in [c-bh,c+bh-bar]:
                m.box('sutGreen',a,b,s,s+bar,.04,bd,bz+t['balconyHeight'],bz+t['balconyHeight']+bar)
            count=max(2,round(2*bh/t['balconySpacing']))
            for k in range(count+1):
                s=c-bh+2*bh*k/count;w=t['balconyPicket']
                m.box('sutGreen',a,b,s-w/2,s+w/2,bd-w/2,bd+w/2,bz,bz+t['balconyHeight'])
            if not is_entry:
                # Built-in pale stone seats beneath selected ground windows.
                if j%2==0:
                    bw=t['benchWidth'];dep=t['benchDepth'];z=t['benchSeat'];th=t['benchThickness']
                    m.box('sutStone',a,b,c-bw/2,c+bw/2,.03,dep,z-th,z)
                    for s in [c-bw*.33,c+bw*.33]:m.box('sutStone',a,b,s-.1,s+.1,.07,dep-.06,.02,z-th)
            else:
                dep=-t['entryDepth']+.035;dw=t['entryWidth'];dh=t['doorHeight'];bottom=t['doorBottom'];fw=t['doorFrame']
                # A real subdivided, studded teal door inside the arched recess.
                for s0,s1,z0,z1 in [(c-dw/2,c-dw/2+fw,bottom,dh),(c+dw/2-fw,c+dw/2,bottom,dh),
                    (c-fw/2,c+fw/2,bottom,dh),(c-dw/2,c+dw/2,bottom,bottom+fw),
                    (c-dw/2,c+dw/2,dh-fw,dh)]:m.box('sutDoor',a,b,s0,s1,dep,dep+t['doorPanelDepth'],z0,z1)
                for side in [-1,1]:
                    dc=c+side*dw*.25;wide=dw*.5-fw*1.5
                    m.box('sutDoor',a,b,dc-wide/2,dc+wide/2,dep,dep+.045,bottom+fw,t['doorPaneBottom'])
                    for zz in [t['doorPanelBottom'],t['doorPanelTop']]:
                        for xx in [-.23,.23]:
                            s=dc+xx;w=t['doorStud'];m.box('sutPale',a,b,s-w/2,s+w/2,dep+.045,dep+.065,zz-w/2,zz+w/2)
                    for k in range(1,3):
                        s=dc-wide/2+wide*k/3;m.box('sutDoor',a,b,s-.018,s+.018,dep,dep+.04,t['doorPaneBottom'],dh-fw)
                spring=t['groundHead']-t['archRise'];radius=dw/2
                for k in range(t['fanSpokes']):
                    th=math.pi*(k+1)/(t['fanSpokes']+1)
                    m.line('sutIron',a,b,c,spring,c+radius*math.cos(th),spring+t['archRise']*math.sin(th),dep,.035)
                for side in [-1,1]:
                    s=c+side*(dw/2+.58);lw=t['lampWidth'];lz=2.9
                    m.box('sutIron',a,b,s-.035,s+.035,.01,t['lampDepth'],lz-.15,lz+.15)
                    m.box('sutLamp',a,b,s-lw/2,s+lw/2,t['lampDepth']-.08,t['lampDepth']+.08,lz,lz+t['lampHeight'])
                    m.box('sutIron',a,b,s-lw*.66,s+lw*.66,t['lampDepth']-.11,t['lampDepth']+.11,lz+t['lampHeight'],lz+t['lampHeight']+.07)
        faces[str(face)]=dict(bands=[
            dict(z0=0,z1=t['groundTop'],skin='sutStone',openings=lower),
            dict(z0=t['groundTop'],z1=t['upperStart'],skin='sutBrick',openings=middle),
            dict(z0=t['upperStart'],z1=h,skin='sutBrick',openings=top)])
        for z in [t['groundTop']-.13,t['upperStart']-.11]:
            m.box('sutPale',a,b,.015,length-.015,.01,.19,z,z+.13)
    # Continuous closed timber underside, below the untouched legacy roof.
    for i,a in enumerate(ring):
        b=ring[(i+1)%4];length=math.dist(a,b);zt=h-t['eaveBelow'];zb=zt-t['eaveThickness'];dep=t['eaveDepth']
        m.box('sutTimber',a,b,0,length,-.025,dep,zb,zt)
        m.box('sutTimber',a,b,0,length,dep-.1,dep,zb-.12,zt)
        n=max(1,round(length/t['bracketPitch']));step=length/n
        for j in range(n):
            c=(j+.5)*step;w=t['bracketWidth']
            m.box('sutTimber',a,b,c-w/2,c+w/2,.01,dep-.09,zb-.14,zb)
            m.box('sutTimber',a,b,c-w/2,c+w/2,.01,dep*.58,zb-t['bracketHeight'],zb-.14)
            m.box('sutOchre',a,b,c-w*.3,c+w*.3,t['bracketInset'],dep*.48,zb-t['bracketHeight']-.035,zb-t['bracketHeight'])
        # Facade frieze remains under the overhang, with muted ceramic colour.
        m.box('sutPale',a,b,.01,length-.01,.008,.07,zb-t['friezeHeight'],zb-.16)
        m.box('sutBlue',a,b,.02,length-.02,.075,.09,zb-t['friezeHeight']+.055,zb-t['friezeHeight']+.055+t['friezeBlueHeight'])
    generated=list(m.meshes.values())
    d['detailMeshes']=[x for x in d.get('detailMeshes',[]) if not x['id'].startswith('sut-')]+generated
    total=sum(len(x['triangles']) for x in generated)
    assert total<t['maxDetailTriangles'],total
    assert all(math.isfinite(v) for x in generated for p in x['vertices'] for v in p)
    d['sources']['suttonDetail']='Exterior east/north views inform differentiated arched red sash, central east teal entry, pale top-storey surrounds, iron Juliet rails and bracketed timber eave. Small dimensions and simplified ornament are approximate; footprint, height and tiled roof rig are retained.'
    d['suttonParameters']=t
    return d
