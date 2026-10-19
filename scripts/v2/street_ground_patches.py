"""Model small exposed hardscape pockets near City sidewalk observations, without raised slabs.

Called by street_finish with the same public City 2025 aerial cache used by street_graph.
Material is classified from the aerial; expanded boundaries are explicitly inferred.
"""
import math
import hashlib,json
from pathlib import Path
from PIL import Image
from street_align import Aerial,URL
import numpy as np
from shapely.geometry import Polygon,LineString,Point,box
from shapely.ops import unary_union
from shapely import STRtree,set_precision,contains_xy,prepare
from street_graph import pairs,polys

VICINITY_M=2.5
KERB_VICINITY_M=3.0
MAX_POCKET_M2=100.0
MAX_POCKET_SPAN_M=20.0
MIN_POCKET_M2=.5
PALE_SHARE=.65
PALE_LUMA_MIN=.45
NEUTRAL_SAT_MAX=.16
PAVING_EXG_MAX=.035

class CachedAerial(Aerial):
    def tile(self,z,x,y):
        p=Path(self.cache)/f'{z}_{x}_{y}.jpg'
        if not p.is_file() or p.stat().st_size==0:raise FileNotFoundError(str(p.name))
        return np.asarray(Image.open(p).convert('RGB'),np.float32)/255


def patch_ground(surface,near,aerial):
    from street_finish import polygon,packed
    def area(g):
        ps=polys(g)
        return unary_union(ps) if ps else Polygon()
    from street_trees import outlines
    # The City walk positions constrain WHERE; the aerial constrains WHAT. No claim of a surveyed paving boundary.
    raw_walk=[LineString(pairs(r,1)).buffer(r[0]/2,cap_style=2).buffer(VICINITY_M) for r in near['walks']]
    wt=STRtree(raw_walk);kerbs=[LineString(pairs(r,0)) for r in surface['kerbs']];kt=STRtree(kerbs)
    covered=[polygon(r) for k in ('asphalt','walk','paving','lawn','mulch') for r in surface[k]];ct=STRtree(covered)
    road=unary_union([polygon(r) for r in surface['asphalt']])
    holes=[Polygon(h) for p in polys(road) for h in p.interiors if Polygon(h).area<400]
    grid=outlines();buildings=[Polygon(r).buffer(0) for r in {tuple(r) for rows in grid.values() for bb,r in rows}];bt=STRtree(buildings)
    additions=[];examined=0;rejected=0;missing=0;unsupported=0;records=[]
    # Include a halo before clipping to tiles: a tile edge must not turn a long unmodelled frontage into a 'small pocket'.
    for tx,tz in sorted({(math.floor(x/125),math.floor(z/125)) for r in near['walks'] for x,z in pairs(r,1)}):
        tile=box(tx*125,tz*125,(tx+1)*125,(tz+1)*125);region=tile.buffer(20)
        walks=area(unary_union([raw_walk[i].intersection(region) for i in wt.query(region)]))
        curb=unary_union([kerbs[i].intersection(region).buffer(KERB_VICINITY_M,cap_style=1) for i in kt.query(region)])
        if walks.is_empty or curb.is_empty:continue
        mask=area(unary_union([covered[i].intersection(region) for i in ct.query(region)]))
        occupied=unary_union([buildings[i].intersection(region).buffer(.2) for i in bt.query(region)])
        candidate=area(area(walks.intersection(curb)).difference(mask)).difference(occupied)
        for p in polys(set_precision(candidate,.05)):
            if not tile.covers(p.representative_point()) or not MIN_POCKET_M2<=p.area<=MAX_POCKET_M2:continue
            x0,z0,x1,z1=p.bounds
            if max(x1-x0,z1-z0)>MAX_POCKET_SPAN_M or p.distance(region.boundary)<.1:continue
            # Fill a ground pocket only when it meets an existing kerb/walk/paving edge.
            if p.distance(mask)>.15:unsupported+=1;continue
            examined+=1
            x0,z0,x1,z1=p.bounds
            xx,zz=np.meshgrid(np.arange(x0+.15,x1,.5),np.arange(z0+.15,z1,.5))
            prepare(p);inside=contains_xy(p,xx,zz);q=np.column_stack((xx[inside],zz[inside]))
            if len(q)<3:rejected+=1;continue
            try:rgb=aerial.sample(q[:,0],q[:,1])
            except FileNotFoundError:missing+=1;continue
            r,g,b=rgb.T
            exg=(2*g-r-b)/(r+g+b+1e-6);lum=.2126*r+.7152*g+.0722*b;sat=rgb.max(1)-rgb.min(1)
            # Conservative pale, nearly neutral paving: leave shaded/vegetated/unknown ground to the aerial.
            share=float(np.mean((lum>PALE_LUMA_MIN)&(sat<NEUTRAL_SAT_MAX)&(exg<PAVING_EXG_MAX)))
            if share<PALE_SHARE:rejected+=1;continue
            additions.append(p);records.append({'centre_m':[round(p.centroid.x,2),round(p.centroid.y,2)],'area_m2':round(p.area,2),'pale_sample_share':round(share,3)})
    patch=unary_union(additions)
    result=[q for p in polys(patch) for q in polys(set_precision(p,.05)) if q.area>=.2]
    rows=[packed(p) for p in result]
    surface['paving'].extend(rows)
    surface['ground_patches']={'source_url':URL,'evidence_confidence':'inference, moderate; pale colour is observed, material and boundaries are classified', 'source':'City of Austin 2025 aerial, public City sidewalk observations',
        'material_evidence':'aerial pale neutral surface samples; conservative classifier',
        'boundary_evidence':'inference: small uncovered pockets within 2.5 m of City-derived walks and 3 m of kerbs; known building outlines excluded',
        'height_evidence':'inference: ground level, not a raised slab',
        'small_enclosed_spaces_audited':len(holes),'geometry_sha256':hashlib.sha256(json.dumps(rows,separators=(',',':')).encode()).hexdigest(),'rejected_geometric_support':unsupported,'examined':examined,'missing_cached_imagery':missing,'rejected_material_or_sparse':rejected,'added':len(result),'added_m2':round(patch.area,2),'records':records,
        'parameters':{'sidewalk_vicinity_m':VICINITY_M,'kerb_vicinity_m':KERB_VICINITY_M,'max_pocket_m2':MAX_POCKET_M2,'max_pocket_span_m':MAX_POCKET_SPAN_M,'minimum_pale_share':PALE_SHARE,'minimum_luminance':PALE_LUMA_MIN,'maximum_saturation':NEUTRAL_SAT_MAX,'maximum_excess_green':PAVING_EXG_MAX}}
    return surface['ground_patches']
