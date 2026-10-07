"""Gearing's inferred raised court, compiled only through the landscape bake.

The datum matches the existing rear landing, not a surveyed elevation. Keep the
recorded accessible ramp unchanged; the new court meets it at its upper end.
"""
from copy import deepcopy
from shapely.geometry import Polygon, box, mapping
from shapely.ops import transform, triangulate
from shapely.affinity import translate

T = dict(grade=1.57, front=.3, rampClearance=.12, innerLeft=16.25,
         innerRight=36.05, plantingFront=.7, plantingBack=14.05,
         bedShift=-1.45, benchV=1.3, railEnd=14.05,
         stepsLeft=23.1, stepsRight=29.1, stepsFront=-2.9, stepsBack=.3,
         stepsCount=10, lawnHeight=.055, bedHeight=.11, minArea=.03)


def apply_gearing_ground(output, halls):
    """Only change Gearing garden features and add explicit walkable surfaces."""
    hall = next(b for b in halls if b['code'] == 'GEA')
    frame = hall['frame']['obb']
    def ll(u, v):
        return [round(frame['o'][0]+(u*frame['ax']-v*frame['ay'])/frame['mx'],9),
                round(frame['o'][1]+(u*frame['ay']+v*frame['ax'])/frame['my'],9)]
    def uv(x, y):
        x=(x-frame['o'][0])*frame['mx']; y=(y-frame['o'][1])*frame['my']
        return x*frame['ax']+y*frame['ay'], -x*frame['ay']+y*frame['ax']
    def rings(g):
        return [[ll(x,y) for x,y in r] for r in mapping(g)['coordinates']]
    def parts(g):
        return [g] if g.geom_type=='Polygon' else [p for p in getattr(g,'geoms',[]) if p.geom_type=='Polygon']
    def poly(f):
        return transform(uv, Polygon(f['rings'][0], f['rings'][1:]))
    ramp=next(r for r in output['ramps'] if r['eid']==239)
    ramp['structural']=True
    ramp_poly=Polygon([uv(*p[:2]) for p in ramp['vertices']])
    channel=ramp_poly.buffer(T['rampClearance'],join_style=2)
    boundary=[uv(*p) for p in hall['footprint']['ring']]
    # Clip to the actual two wing edges and split rear wall, not the OBB box.
    court=Polygon([boundary[2],boundary[3],boundary[4],boundary[5],boundary[6]])
    court=court.intersection(box(0,T['front'],frame['L'],frame['W']))
    terrace=court.difference(channel)
    garden=next(p for p in output['gardens']['places'] if p['name']=='Gearing courtyard')
    existing=deepcopy(garden['features']); features=[]
    floor=[]
    for p in parts(terrace):
        features.append(dict(kind='pave',height=T['grade'],rings=rings(p),structural=True))
        floor.append(dict(rings=rings(p),height=T['grade'],structural=True))
    planting=box(T['innerLeft'],T['plantingFront'],T['innerRight'],T['plantingBack']).difference(channel)
    for f in existing:
        if 'rings' in f:
            g=poly(f)
            if f['kind']=='bed' or (f['kind']=='stone' and f.get('height')==.15):
                g=translate(g,yoff=T['bedShift']).intersection(planting)
            elif f['kind']=='lawn':g=g.intersection(planting)
            for p in parts(g):
                if p.area<T['minArea']:continue
                raised=deepcopy(f);raised['rings']=rings(p)
                raised['height']=T['grade']+f.get('height',T.get(f['kind']+'Height',0))
                features.append(raised)
        else:
            f['base']=T['grade']
            if f['kind']=='bench':
                # Existing benches were outside the front wall. Keep their
                # left/right arrangement on the interior terrace margin.
                u,_=uv(*f['at']);f['at']=ll(u,T['benchV'])
            features.append(f)
    # A narrow shoulder follows the original ramp plane exactly, avoiding a
    # dark slit beside its quantized outline without changing any ramp vertex.
    a,b,c=ramp['vertices'][0],ramp['vertices'][1],ramp['vertices'][-1]
    ax,ay=uv(*a[:2]);bx,by=uv(*b[:2]);cx,cy=uv(*c[:2])
    det=(bx-ax)*(cy-ay)-(cx-ax)*(by-ay)
    pu=((b[2]-a[2])*(cy-ay)-(c[2]-a[2])*(by-ay))/det
    pv=((bx-ax)*(c[2]-a[2])-(cx-ax)*(b[2]-a[2]))/det
    height=lambda u,v:a[2]+pu*(u-ax)+pv*(v-ay)
    mesh=dict(kind='detailMesh',colour=ramp['colour'],vertices=[],triangles=[],structural=True)
    for p in parts(channel.intersection(court).difference(ramp_poly)):
        for tri in triangulate(p):
            if not p.covers(tri.representative_point()):continue
            v=[[x,y] for x,y in list(tri.exterior.coords)[:-1]]
            n=len(mesh['vertices']);mesh['vertices'].extend([*ll(x,y),height(x,y)] for x,y in v)
            mesh['triangles'].append([n,n+1,n+2])
    features.append(mesh)
    # Inferred rail termination aligns with the rear planting edge, leaving a
    # crossover onto the retained ramp before the rear wall. Its small level
    # difference is an inferred connection, not a surveyed access detail.
    for side in [channel.bounds[0],channel.bounds[2]]:
        features.append(dict(kind='raisedRail',line=[ll(side,T['front']),ll(side,T['railEnd'])],base=T['grade'],structural=True))
    # Controls use only these explicit ground surfaces, never overhead meshes.
    floor.append(dict(vertices=deepcopy(ramp['vertices']),rings=rings(channel.intersection(court)),structural=True))
    for i in range(T['stepsCount']):
        start=T['stepsFront']+(T['stepsBack']-T['stepsFront'])*i/T['stepsCount']
        end=T['stepsFront']+(T['stepsBack']-T['stepsFront'])*(i+1)/T['stepsCount']
        floor.append(dict(rings=rings(box(T['stepsLeft'],start,T['stepsRight'],end)),height=T['grade']*(i+1)/T['stepsCount'],structural=True,requiresAuthored=hall['id']))
    garden['features']=features
    garden['note']+=' Raised court datum inferred from the existing ramp landing; absolute elevation is not surveyed. Rail ends align with the rear planting edge to leave an inferred crossover onto the unchanged ramp.'
    output['walkableGround']=floor
