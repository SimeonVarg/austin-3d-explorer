"""Pure final-stage geometry for the owned ground bake."""
import json, math
from pathlib import Path
from shapely.geometry import shape, mapping, box
from shapely.ops import transform, unary_union
from shapely import make_valid

ROOT=Path(__file__).resolve().parents[1]
MX=111320*math.cos(math.radians(30.285));MY=111320
local=lambda g:transform(lambda x,y:((x+97.74)*MX,(y-30.285)*MY),g)
world=lambda g:transform(lambda x,y:(x/MX-97.74,y/MY+30.285),g)

def pedestrian_levels(features,stats):
    config=json.loads((ROOT/'data/campus_walk_profiles.json').read_text())
    region=local(unary_union([box(*r) for r in config['regions']]))
    nearby=region.buffer(config['roadsideBand']+1)
    roads=[]
    for f in features:
        if f['properties'].get('k')!='roadarea':continue
        g=local(shape(f['geometry']))
        if g.intersects(nearby):roads.append(make_valid(g).intersection(nearby))
    verge=unary_union(roads).buffer(config['roadsideBand'])
    result=[]
    def emit(f,g,height=None):
        pieces=[g] if g.geom_type=='Polygon' else list(getattr(g,'geoms',[]))
        for part in pieces:
            if part.geom_type!='Polygon' or part.area<config['minimumArea']:continue
            p=dict(f['properties'])
            if height is not None:p['walk_z']=height
            result.append(dict(f,properties=p,geometry=mapping(world(part))))
    for f in features:
        p=f['properties']
        if p.get('k') not in ('patharea','pathslab') or p.get('u')=='steps':
            result.append(f);continue
        g=make_valid(local(shape(f['geometry'])))
        if not g.intersects(region):result.append(f);continue
        inside=g.intersection(region)
        emit(f,g.difference(region))
        emit(f,inside.intersection(verge),config['roadsideHeight'])
        emit(f,inside.difference(verge),config['interiorHeight'])
        stats['pedestrian_level_features']+=1
    return result
