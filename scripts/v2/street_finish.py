"""Final street geometry cleanup used by street_graph.py, before the safe inventories.

python3 scripts/v2/street_finish.py --existing [--audit /tmp/finish.json]
Reprocesses checked-in graph outputs without refetching source observations.
"""
import argparse, json, math
from pathlib import Path
import numpy as np
from shapely import STRtree, prepare, set_precision
from shapely.geometry import Polygon, LineString, Point
from shapely.ops import unary_union
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

def inspect(surface,osm,near,marks):
    road=unary_union([polygon(r) for r in surface['asphalt']]);walk=unary_union([polygon(r) for r in surface['walk']]);checks={}
    for k in ('paving','lawn','mulch'):
        parts=polys(unary_union([polygon(r) for r in surface[k]]))
        bad=[p for p in parts if p.distance(walk)>ATTACH_M]
        checks[k]={'detached_components':len(bad),'detached_m2':round(sum(p.area for p in bad),2)}
    checks['walk_fragments']=sum(p.area<WALK_FRAGMENT_M2 and p.distance(road)>ATTACH_M for p in polys(walk))
    audit=LaneAudit(near)
    checks['lanes']={k:{'total':len(d['lanes']),'nonparallel':len(audit.failures(d['lanes'])),'duplicate_white':len(duplicates(d['lanes']))} for k,d in [('city',surface),('osm',osm)]}
    checks['tiny_paint_bars']=sum(marks['bars'][i+3]<MIN_PAINT_BAR_M for i in range(0,len(marks['bars']),5))
    return checks

def finish(surface,osm,near,marks):
    road=unary_union([polygon(r) for r in surface['asphalt']]);walk=unary_union([polygon(r) for r in surface['walk']])
    fragments=[p for p in polys(walk) if p.area<WALK_FRAGMENT_M2 and p.distance(road)>ATTACH_M]
    cut=unary_union(fragments)
    surface['walk']=[packed(p) for r in surface['walk'] for p in polys(set_precision(polygon(r).difference(cut),.05)) if p.area>=.2]
    walk=walk.difference(cut)
    for k in ('paving','lawn','mulch'):
        detached=unary_union([p for p in polys(unary_union([polygon(r) for r in surface[k]])) if p.distance(walk)>ATTACH_M])
        surface[k]=[packed(p) for r in surface[k] for p in polys(set_precision(polygon(r).difference(detached),.05)) if p.area>=.2]
    audit=LaneAudit(near)
    for d in (surface,osm):
        # Drop observations that cannot establish a parallel lane. Don't fabricate a correction to a possibly wrong parent.
        bad=set(audit.failures(d['lanes']))|duplicates(d['lanes'])
        d['lanes']=[r for i,r in enumerate(d['lanes']) if i not in bad]
    marks['bars']=[v for i in range(0,len(marks['bars']),5) if marks['bars'][i+3]>=MIN_PAINT_BAR_M for v in marks['bars'][i:i+5]]
    return surface,osm,marks

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--existing',action='store_true',required=True);ap.add_argument('--audit',type=Path);a=ap.parse_args()
    data=Path(__file__).resolve().parents[2]/'v2/data/street';get=lambda n:json.loads((data/(n+'.json')).read_text())
    s,o,n,m=(get(k) for k in ('surface','surface_osm','near','marks'));before=inspect(s,o,n,m);finish(s,o,n,m);after=inspect(s,o,n,m)
    for name,d in [('surface',s),('surface_osm',o),('marks',m)]:(data/(name+'.json')).write_text(json.dumps(d,separators=(',',':')))
    result={'before':before,'after':after};print(json.dumps(result,indent=2))
    if a.audit:a.audit.write_text(json.dumps(result,indent=2))
if __name__=='__main__':main()
