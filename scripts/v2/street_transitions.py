"""Finish curb-less driveway breaks: no unsupported raised trim or vertical walk-end lips.

python3 scripts/v2/street_transitions.py --audit /tmp/transitions.json
Canonical walk coverage stays unchanged. Transition length/grade is inferred, not surveyed.
"""
import argparse, json, math
from pathlib import Path
from shapely import STRtree, set_precision
from shapely.geometry import Point, LineString, Polygon
from shapely.ops import unary_union
from street_graph import pairs, polys, CORNER_R_M
from street_finish import polygon, packed, documented_ground

RAMP_M = 1.2
DRIVE_APPROACH_M = 1.5
BACKING_M = .2


def transitions(surface, near):
    # Keep canonical survey coverage separate from the split render panels.
    walks = [polygon(r) for r in surface['walk']]; wt = STRtree(walks)
    support = walks + [polygon(r) for k in ('lawn', 'mulch') for r in surface[k]]; st = STRtree(support)
    drives = [LineString(pairs(r,3)).buffer((r[1]-r[0])/2 + DRIVE_APPROACH_M, cap_style=2)
              for r in near['roads'] if r[2]&1]; dt = STRtree(drives)
    fillets = [LineString(pairs(r,3)).buffer((r[1]-r[0])/2 + CORNER_R_M, cap_style=2)
               for r in near['roads'] if r[2]&1]; ft = STRtree(fillets)
    ground = documented_ground(surface)
    ramps = []; seen = set()
    for index, r in enumerate(near['walks']):
        pts = pairs(r,1)
        if len(pts)<2: continue
        for end, inside in ((pts[0],pts[1]),(pts[-1],pts[-2])):
            p = Point(end); local = unary_union([walks[j] for j in wt.query(p.buffer(2))])
            length = math.dist(end,inside)
            if not length or local.is_empty: continue
            u = [(inside[k]-end[k])/length for k in (0,1)]; v = [-u[1],u[0]]
            # A source line endpoint inside continuous pavement is not a driveway transition.
            beyond = Point(end[0]-u[0]*.5,end[1]-u[1]*.5)
            if local.distance(p)>.15 or local.covers(beyond) or ground.distance(p)>.3: continue
            if not any(drives[j].covers(p) for j in dt.query(p)): continue
            key = tuple(end)
            if key in seen: continue
            seen.add(key)
            width = r[0]/2 + BACKING_M
            region = Polygon([(end[0]+u[0]*a+v[0]*b,end[1]+u[1]*a+v[1]*b)
                              for a,b in ((-.15,-width),(RAMP_M,-width),(RAMP_M,width),(-.15,width))])
            if region.intersection(local).area<.1: continue
            ramps.append({'source_walk':index,'end':list(end),'inward':u,'length_m':RAMP_M,'region':packed(region)})
    regions = [polygon(r['region']) for r in ramps]; rt = STRtree(regions)
    panels = {};panel_count=0
    for index,w in enumerate(walks):
        hits=rt.query(w)
        if not len(hits):continue
        pieces = [w]
        for j in hits:
            pieces = [q for p in pieces for g in (p.intersection(regions[j]),p.difference(regions[j])) for q in polys(g)]
        # Preserve the survey footprint. Rounding a new split point to 5 cm moves
        # the outside edge and can change unrelated furniture placement.
        panels[index]=[[[round(v,6) for xy in list(r.coords)[:-1] for v in xy]
                        for r in [p.exterior,*p.interiors]] for p in pieces if p.area>1e-7]
        panel_count+=len(panels[index])
    surface['walk_panels'] = panels
    trimmed = []; sources = []; removed_area = 0.; changed = 0
    for r, source in zip(surface['kerb_tops'],surface['kerb_top_sources']):
        top = polygon(r); halo = top.buffer(BACKING_M)
        backing = unary_union([support[j].intersection(halo) for j in st.query(halo)]).buffer(BACKING_M)
        approach = unary_union([fillets[j].intersection(halo) for j in ft.query(halo)])
        cut = approach.difference(backing)
        # The walk's sloped side is its own curb at a driveway: no horizontal trim across the ramp.
        ramp_cut = unary_union([regions[j] for j in rt.query(top)])
        result = top.difference(unary_union([cut,ramp_cut]))
        if top.difference(result).area<.002:
            trimmed.append(r);sources.append(source);continue
        result = set_precision(result,.05)
        loss = top.difference(result).area
        removed_area += loss; changed += int(loss>.002)
        for p in polys(result):
            if p.area>.002: trimmed.append(packed(p));sources.append(source)
    surface['kerb_tops'] = trimmed; surface['kerb_top_sources'] = sources
    surface['walk_ramps'] = ramps
    result = {'driveway_walk_transitions':len(ramps),'trim_sections_changed':changed,
              'raised_trim_removed_m2':round(removed_area,3),'walk_panels_before':len(walks),'walk_panels_after':len(walks)-len(panels)+panel_count,
              'evidence':'City sidewalk endpoints and curb-less road records; adjoining aerial-classified paving',
              'inference':'1.2 m linear transition to ground; exact ramp grades unmeasured'}
    surface['driveway_transitions'] = result
    return result


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--audit',type=Path);a=ap.parse_args()
    folder=Path(__file__).resolve().parents[2]/'v2/data/street'
    s=json.loads((folder/'surface.json').read_text());n=json.loads((folder/'near.json').read_text())
    result=transitions(s,n);(folder/'surface.json').write_text(json.dumps(s,separators=(',',':')))
    text=json.dumps(result,indent=2);print(text)
    if a.audit:a.audit.write_text(text)
if __name__=='__main__':main()
