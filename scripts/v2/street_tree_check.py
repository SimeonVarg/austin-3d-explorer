"""Independently check observed tree retention and rendered placements against the road/support."""
import hashlib,json,math
from pathlib import Path
from shapely.geometry import Point,Polygon,LineString
from shapely.ops import unary_union
from shapely import STRtree,prepare
from street_finish import polygon
from street_graph import pairs,offset


def audit_trees(folder):
    surface=json.loads((folder/'surface.json').read_text());road=unary_union([polygon(r) for r in surface['asphalt']]);boundary=road.boundary;prepare(road)
    near=json.loads((folder/'near.json').read_text());travel_parts=[]
    for r in near['roads']:
        pts=pairs(r,3);travel_parts.append(LineString(pts).buffer((r[1]-r[0])/2,cap_style=2) if r[2]&1 else Polygon(offset(pts,r[1])+offset(pts,r[0])[::-1]).buffer(0))
    travel=unary_union(travel_parts);travel_boundary=travel.boundary;prepare(travel)
    def deep(p):return road.covers(p) and boundary.distance(p)>2. and travel.covers(p) and travel_boundary.distance(p)>2.
    from street_trees import outlines
    grid=outlines();buildings=list({tuple(ring) for rs in grid.values() for bb,ring in rs});buildings=[__import__('shapely').geometry.Polygon(r).buffer(0) for r in buildings];bt=STRtree(buildings)
    support=[polygon(r) for k in ('walk','paving','lawn','mulch') for r in surface[k]];st=STRtree(support);out={}
    caps=unary_union([Point(q).buffer(min(-r[0],r[1])) for r in near['roads'] if not r[2]&1 for q in (pairs(r,3)[0],pairs(r,3)[-1])]);prepare(caps)
    def unsupported_gap(p):
        return (road.intersects(p.buffer(.5)) and caps.covers(p) and caps.boundary.distance(p)>1.
                and not any(support[j].distance(p)<=6. for j in st.query(p.buffer(6.))))
    for name in ('city','osm'):
        td=folder.parent/'trees';raw=json.loads((td/(name+'.json')).read_text());safe=json.loads((td/('safe_'+name+'.json')).read_text());ev=safe['safety']
        original=[raw['trees'][i:i+6] for i in range(0,len(raw['trees']),6)];actual=[safe['trees'][i:i+6] for i in range(0,len(safe['trees']),6)]
        drops=set(ev['dropped_indices']);indices=ev.get('kept_indices',[i for i in range(len(original)) if i not in drops]);moves={r['source_index']:r for r in ev.get('relocations',[])}
        d=dict(total=len(actual),unjustified_drops=0,deep_road_observations_kept=0,trunks_on_road=0,trunk_footprints_on_road=0,
               unsupported_mapped_moves=0,unrecorded_moves=0,oversized_moves=0,changed_dimensions=0,bad_index_partition=0,moved_into_building=0,
               unrecorded_collisions=0,recorded_edge_geometry_conflicts=0,inferred_verge_moves=sum('support' in r for r in moves.values()),stale=0)
        d['bad_index_partition']=int(set(indices)&drops!=set() or set(indices)|drops!=set(range(len(original))) or len(indices)!=len(set(indices)) or len(indices)!=len(actual))
        for i in drops:
            p=Point(original[i][:2])
            seam=i in ev.get('unsupported_road_end_gap_indices',[])
            if not (unsupported_gap(p) if seam else deep(p)):d['unjustified_drops']+=1
        for i,r in zip(indices,actual):
            old=original[i];p=Point(r[:2]);op=Point(old[:2]);radius=.12+r[2]*.025+.08
            d['deep_road_observations_kept']+=int(deep(op))
            d['trunks_on_road']+=int(road.covers(p));d['trunk_footprints_on_road']+=int(road.intersects(p.buffer(radius)))
            collides=road.intersects(p.buffer(radius))
            if collides:
                if i in ev.get('unresolved_indices',[]) and r[:2]==old[:2] and not deep(op):d['recorded_edge_geometry_conflicts']+=1
                else:d['unrecorded_collisions']+=1
            d['changed_dimensions']+=int(r[2:]!=old[2:])
            if r[:2]!=old[:2]:
                if i not in moves or moves[i]['from']!=old[:2] or moves[i]['to']!=r[:2]:d['unrecorded_moves']+=1
                if p.distance(op)>6.001:d['oversized_moves']+=1
                if any(buildings[j].intersects(p.buffer(radius)) for j in bt.query(p.buffer(radius))):d['moved_into_building']+=1
                if not moves.get(i,{}).get('support'):
                    local=unary_union([support[j] for j in st.query(p.buffer(radius+.1))])
                    if not local.buffer(.001).covers(p.buffer(radius)):d['unsupported_mapped_moves']+=1
        d['stale']=int(hashlib.sha256((folder/'surface.json').read_bytes()).hexdigest()!=ev['surface_sha256'])
        if ev.get('source_sha256'):d['stale']+=int(hashlib.sha256((td/(name+'.json')).read_bytes()).hexdigest()!=ev['source_sha256'])
        if ev.get('travel_surface_input_sha256'):d['stale']+=int(hashlib.sha256((folder/'near.json').read_bytes()).hexdigest()!=ev['travel_surface_input_sha256'])
        for n,h in ev.get('building_inputs',{}).items():d['stale']+=int(hashlib.sha256((Path(__file__).resolve().parents[2]/n).read_bytes()).hexdigest()!=h)
        out[name]=d
    return out
