"""Final street geometry cleanup used by street_graph.py, before the safe inventories.

python3 scripts/v2/street_finish.py --existing [--audit /tmp/finish.json]
Reprocesses checked-in graph outputs without refetching source observations.
"""
import argparse, json, math, hashlib
from pathlib import Path
import numpy as np
from shapely import STRtree, prepare, set_precision
from shapely.geometry import Polygon, LineString, Point, box
from shapely.ops import unary_union
from shapely.geometry.polygon import orient
from street_graph import pairs, polys, lines_of, r5

# Output is quantized to 5 cm. Allow that tolerance at adjoining material boundaries.
ATTACH_M = .15
WALK_FRAGMENT_M2 = 4.0
LANE_ANGLE_DEG = 2.0
LANE_DRIFT_M = .25
DUPLICATE_WHITE_M = .35
MIN_LANE_M = 3.0
MIN_PAINT_BAR_M = .5

def polygon(r): return Polygon(pairs(r[0],0),[pairs(h,0) for h in r[1:]])
def packed(p): return [[r5(v) for q in list(r.coords)[:-1] for v in q] for r in [p.exterior,*p.interiors]]

class LaneAudit:
    def __init__(self, near):
        self.rows=near['roads'];self.roads=[LineString(pairs(r,3)) for r in self.rows];self.tree=STRtree(self.roads)

    def match(self,l):
        # Independent of the saved lane's parent: match all samples to one complete road, including its bends.
        samples=[l.interpolate(f,normalized=True) for f in (.1,.3,.5,.7,.9)];matches=[]
        for j in self.tree.query(l.buffer(20)):
            road=self.roads[j];angles=[];offsets=[];distances=[]
            for p in samples:
                s=l.project(p);aa=l.interpolate(max(0,s-.75));bb=l.interpolate(min(l.length,s+.75))
                u=np.array(bb.coords[0])-aa.coords[0];u/=np.linalg.norm(u) or 1
                s=road.project(p);aa=road.interpolate(max(0,s-.75));bb=road.interpolate(min(road.length,s+.75))
                v=np.array(bb.coords[0])-aa.coords[0];v/=np.linalg.norm(v) or 1
                angles.append(math.degrees(math.acos(min(1,abs(float(u@v))))))
                q=road.interpolate(s);offsets.append(float((np.array(p.coords[0])-q.coords[0])@[-v[1],v[0]]));distances.append(p.distance(road))
            if max(distances)>max(abs(self.rows[j][0]),self.rows[j][1])+1:continue
            matches.append((np.mean(angles)+np.std(offsets)*2+np.mean(distances)*.03,int(j),max(angles),float(np.ptp(offsets))))
        return min(matches) if matches else None

    def failures(self,records):
        bad=[]
        for i,r in enumerate(records):
            l=LineString(pairs(r,4));m=self.match(l)
            if not m or m[2]>LANE_ANGLE_DEG or m[3]>LANE_DRIFT_M:bad.append(i)
        return bad

def duplicates(records):
    geoms=[LineString(pairs(r,4)) for r in records];tree=STRtree(geoms);drop=set()
    # Retain one longest observation; keep yellow pairs, which may be legitimate double centre lines.
    for i in sorted(range(len(records)),key=lambda i:(-geoms[i].length,i)):
        if i in drop or records[i][0]:continue
        g=geoms[i]
        for j in tree.query(g.buffer(DUPLICATE_WHITE_M)):
            if j==i or j in drop or records[j][0]:continue
            h=geoms[j]
            if h.length>g.length+.01 or h.length==g.length and j<i:continue
            if h.difference(g.buffer(DUPLICATE_WHITE_M,cap_style=2)).length<.2:drop.add(int(j))
    return drop

def documented_ground(surface):
    """Attested classified ground rows; never an exemption for raised pavement (checked in the real loader)."""
    ev=surface.get('ground_patches',{});n=ev.get('added',0)
    if not n or n>len(surface['paving']):return Polygon()
    rows=surface['paving'][-n:]
    if hashlib.sha256(json.dumps(rows,separators=(',',':')).encode()).hexdigest()!=ev.get('geometry_sha256'):return Polygon()
    return unary_union([polygon(r) for r in rows])


def inspect(surface,osm,near,marks):
    road=unary_union([polygon(r) for r in surface['asphalt']]);walk=unary_union([polygon(r) for r in surface['walk']]);checks={}
    documented=documented_ground(surface);documented_pad=documented.buffer(.06)
    for k in ('paving','lawn','mulch'):
        parts=polys(unary_union([polygon(r) for r in surface[k]]))
        backing=unary_union([walk,road]) if k=='paving' else walk
        bad=[p for p in parts if p.distance(backing)>ATTACH_M]
        known=[p for p in bad if k=='paving' and p.difference(documented_pad).area<.02]
        unknown=[p for p in bad if p not in known]
        checks[k]={'detached_components':len(unknown),'detached_m2':round(sum(p.area for p in unknown),2),'documented_detached_ground':len(known)}
    checks['ground_patch_provenance_stale']=int(bool(surface.get('ground_patches',{}).get('added')) and documented.is_empty)
    checks['walk_fragments']=sum(p.area<WALK_FRAGMENT_M2 and p.distance(road)>ATTACH_M for p in polys(walk))
    audit=LaneAudit(near)
    checks['lanes']={k:{'total':len(d['lanes']),'nonparallel':len(audit.failures(d['lanes'])),'duplicate_white':len(duplicates(d['lanes']))} for k,d in [('city',surface),('osm',osm)]}
    checks['tiny_paint_bars']=sum(marks['bars'][i+3]<MIN_PAINT_BAR_M for i in range(0,len(marks['bars']),5))
    return checks

# Join only narrow gaps already classified as hard paving. Never bridge a roadway or planting bed.
WALK_JOIN_M = .65
KERB_TOP_M = .15


def ground_joins(surface, near):
    def area(g):
        parts = polys(g)
        return unary_union(parts) if parts else Polygon()
    road = unary_union([polygon(r) for r in surface['asphalt']])
    walks = [polygon(r) for r in surface['walk']]
    paves = [polygon(r) for r in surface['paving']]; pt = STRtree(paves)
    roads = [polygon(r) for r in surface['asphalt']]; rt = STRtree(roads)
    walk = unary_union(walks); wt = STRtree(walks)
    additions = []
    # Local overlays bound the cost and keep a shared edge across tiles; do not simplify separate materials afterwards.
    x0,z0,x1,z1 = walk.bounds
    for x in range(math.floor(x0/125)*125, math.ceil(x1/125)*125, 125):
        for z in range(math.floor(z0/125)*125, math.ceil(z1/125)*125, 125):
            tile = box(x,z,x+125,z+125); region = tile.buffer(WALK_JOIN_M*4)
            parts = [walks[i].intersection(region) for i in wt.query(region)]
            if not parts: continue
            local = area(unary_union(parts))
            closed = area(set_precision(local.buffer(WALK_JOIN_M,join_style=2).buffer(-WALK_JOIN_M,join_style=2),.05))
            gap = area(closed.difference(area(set_precision(local,.05)),grid_size=.05))
            if gap.area < .02: continue
            paving = area(unary_union([paves[i].intersection(region) for i in pt.query(region)]))
            local_road = area(unary_union([roads[i].intersection(region) for i in rt.query(region)]))
            add = area(gap.intersection(tile,grid_size=.05))
            if add.is_empty or paving.is_empty: continue
            add = area(add.intersection(paving,grid_size=.05))
            if add.is_empty: continue
            if not local_road.is_empty: add = area(add.difference(local_road,grid_size=.05))
            if not add.is_empty: additions.append(add)
    fill = unary_union(additions)
    # Keep every original survey-supported slab, adding only backed narrow joins.
    joined = area(set_precision(walk.union(fill).difference(road), .05))
    print('sidewalk gaps joined', flush=True)
    fragments = [p for p in polys(joined) if p.area < WALK_FRAGMENT_M2 and p.distance(road) > ATTACH_M]
    if fragments: joined = area(joined.difference(unary_union(fragments)))
    tops = []; top_sources = []
    for source_index,r in enumerate(surface['kerbs']):
        line = LineString(pairs(r,0)); region = line.buffer(KERB_TOP_M+.1)
        local_road = area(unary_union([roads[i].intersection(region) for i in rt.query(region)]))
        # A true offset polygon has bounded width even at sharp bends. Do not erase a curb just because it borders grass.
        top = line.buffer(KERB_TOP_M,cap_style=2,join_style=3).difference(local_road)
        for p in polys(set_precision(top,.05)):
            if p.area < .002: continue
            tops.append(p); top_sources.append(source_index)
    # Output the union so the client can close the COMPLETE outside edge, without walls at tile seams.
    surface['walk'] = [packed(p) for p in polys(set_precision(joined,.05)) if p.area >= .2]
    surface['paving'] = [packed(p) for r in surface['paving'] for p in polys(set_precision(polygon(r).difference(joined),.05)) if p.area >= .2]
    surface['kerb_tops'] = [packed(p) for p in tops]
    surface['kerb_top_sources'] = top_sources
    surface['solid_edges'] = True
    return {'narrow_paving_gaps_joined': len(polys(fill)), 'joined_m2': round(fill.area,2),
            'new_detached_fragments_removed':len(fragments),'kerb_sources_total':len(surface['kerbs']),
            'kerb_sources_retained':len(set(top_sources)), 'closed_slab_rings':sum(len(r) for r in surface['walk']),
            'closed_kerb_rings':sum(len(r) for r in surface['kerb_tops'])}


def finish(surface,osm,near,marks,aerial_cache=None):
    road=unary_union([polygon(r) for r in surface['asphalt']]);walk=unary_union([polygon(r) for r in surface['walk']])
    fragments=[p for p in polys(walk) if p.area<WALK_FRAGMENT_M2 and p.distance(road)>ATTACH_M]
    cut=unary_union(fragments)
    surface['walk']=[packed(p) for r in surface['walk'] for p in polys(set_precision(polygon(r).difference(cut),.05)) if p.area>=.2]
    walk=walk.difference(cut)
    for k in ('paving','lawn','mulch'):
        backing=unary_union([walk,road]) if k=='paving' else walk
        detached=unary_union([p for p in polys(unary_union([polygon(r) for r in surface[k]])) if p.distance(backing)>ATTACH_M])
        surface[k]=[packed(p) for r in surface[k] for p in polys(set_precision(polygon(r).difference(detached),.05)) if p.area>=.2]
    audit=LaneAudit(near)
    for d in (surface,osm):
        # Drop observations that cannot establish a parallel lane. Don't fabricate a correction to a possibly wrong parent.
        bad=set(audit.failures(d['lanes']))|duplicates(d['lanes'])
        d['lanes']=[r for i,r in enumerate(d['lanes']) if i not in bad]
    marks['bars']=[v for i in range(0,len(marks['bars']),5) if marks['bars'][i+3]>=MIN_PAINT_BAR_M for v in marks['bars'][i:i+5]]
    print('joining sidewalk surfaces', flush=True)
    surface['ground_join_checks'] = ground_joins(surface, near)
    print(surface['ground_join_checks'], flush=True)
    if aerial_cache:
        from street_ground_patches import patch_ground,CachedAerial
        patch_ground(surface,near,CachedAerial(str(aerial_cache)))
    return surface,osm,marks

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--existing',action='store_true',required=True);ap.add_argument('--audit',type=Path);ap.add_argument('--aerial-cache',type=Path);a=ap.parse_args()
    data=Path(__file__).resolve().parents[2]/'v2/data/street';get=lambda n:json.loads((data/(n+'.json')).read_text())
    s,o,n,m=(get(k) for k in ('surface','surface_osm','near','marks'));before=inspect(s,o,n,m);finish(s,o,n,m,aerial_cache=a.aerial_cache);after=inspect(s,o,n,m)
    for name,d in [('surface',s),('surface_osm',o),('marks',m)]:(data/(name+'.json')).write_text(json.dumps(d,separators=(',',':')))
    result={'before':before,'after':after};print(json.dumps(result,indent=2))
    if a.audit:a.audit.write_text(json.dumps(result,indent=2))
if __name__=='__main__':main()
