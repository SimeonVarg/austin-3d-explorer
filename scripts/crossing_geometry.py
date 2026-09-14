"""Restore verified through-roads beneath over-broad pedestrian mall polygons."""
import json
from pathlib import Path
from collections import Counter
from shapely.geometry import shape, box, mapping
from shapely.ops import unary_union
from shapely import make_valid
ROOT=Path(__file__).resolve().parents[1]

def repair_crossings(features, road_features, stats):
    from bake_ground import widen_roads
    config=json.loads((ROOT/'data/ground_crossings.json').read_text())
    mask=unary_union([box(*c['bounds'])for c in config['crossings']])
    selected=[f for f in road_features if f['properties'].get('k')=='road' and shape(f['geometry']).intersects(mask)]
    existing=unary_union([make_valid(shape(f['geometry'])).intersection(mask)for f in features if f['properties'].get('k')=='roadarea' and shape(f['geometry']).intersects(mask)])
    result=list(features)
    for f in widen_roads(selected,Counter(),[]):
        if f['properties'].get('k')!='roadarea':continue
        g=make_valid(shape(f['geometry'])).intersection(mask).difference(existing)
        parts=[g]if g.geom_type=='Polygon'else getattr(g,'geoms',[])
        for part in parts:
            if part.geom_type!='Polygon' or part.area<1e-12:continue
            result.append(dict(f,geometry=mapping(part)))
            stats['vehicle_crossing_patches']+=1
    return result
