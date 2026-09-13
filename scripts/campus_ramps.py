"""Recover continuous planes from the entrance bake's sampled ramp slabs.

Reads geometry only; the campus landscape bake owns the compiled output.
The source ramps are inferred entrance details, not a terrain/access survey.
"""
import math
from collections import defaultdict
from shapely.geometry import shape, mapping
from shapely.ops import unary_union, transform
from shapely.geometry.polygon import orient


def compile_ramps(features,ids,toe):
    groups=defaultdict(list)
    for f in features:
        if f['properties'].get('k')=='ramp' and f['properties'].get('eid') in ids:
            groups[f['properties']['eid']].append(f)
    result=[]
    for eid,fs in groups.items():
        fs.sort(key=lambda f:f['properties']['h'])
        origin=shape(fs[0]['geometry']).centroid
        mx=111320*math.cos(math.radians(origin.y));my=111320
        local=lambda g:transform(lambda x,y:((x-origin.x)*mx,(y-origin.y)*my),g)
        shapes=[local(shape(f['geometry'])) for f in fs]
        a,b=shapes[0].centroid,shapes[-1].centroid
        dx,dy=b.x-a.x,b.y-a.y;length=math.hypot(dx,dy);dx/=length;dy/=length
        g=orient(unary_union(shapes).buffer(0),sign=1)
        ring=list(g.exterior.coords)[:-1]
        projection=lambda p:(p[0]-a.x)*dx+(p[1]-a.y)*dy
        low=min(map(projection,ring));high=max(map(projection,ring))
        slope=(fs[-1]['properties']['h']-fs[0]['properties']['h'])/length
        top=fs[0]['properties']['h']+slope*high
        vertices=[[origin.x+x/mx,origin.y+y/my,toe+(projection((x,y))-low)/(high-low)*(top-toe)] for x,y in ring]
        p=fs[0]['properties']
        result.append(dict(eid=eid,ref=p['ref'],vertices=vertices,colour=[p['wd'],p['wg'],p['wn']],toe=toe,top=top,
                           source='data/entrances.geojson: continuous plane recovered from existing sampled slabs'))
    return result
