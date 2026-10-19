#!/usr/bin/env python3
"""Audit actual Three.js street triangles against the saved complete sidewalk surface.

street-loader-check.mjs --ground-output /tmp/mesh.json supplies the mesh.
python3 scripts/v2/street_ground_check.py --mesh /tmp/mesh.json [--data v2/data/street] [--report]
"""
import argparse,json
from pathlib import Path
import numpy as np
from shapely.geometry import Polygon,LineString,Point
from shapely.ops import unary_union
from shapely import STRtree,prepare,points as make_points
from street_finish import polygon
from street_graph import pairs,polys
ROOT=Path(__file__).resolve().parents[2]

def audit(folder,mesh_path):
    s=json.loads((folder/'surface.json').read_text());walk=unary_union([polygon(r) for r in s['walk']]);walk_parts=list(walk.geoms) if hasattr(walk,'geoms') else [walk]
    kerb_bases=[polygon(r) for r in s.get('kerb_tops',[])]
    backing_parts=walk_parts+kerb_bases;wp=STRtree(backing_parts)
    walks=[];tops=[];sides=[];wrong_walk_heights=0;ramp_vertices=0
    ramps=s.get('walk_ramps',[])
    ramp_geoms=[polygon(r['region']).buffer(.08) for r in ramps];ramp_tree=STRtree(ramp_geoms)
    for mesh in json.loads(mesh_path.read_text()):
        pos=np.array(mesh['position']).reshape(-1,3);idx=np.array(mesh['index']).reshape(-1,3)
        for points in pos[idx]:
            h=points[:,1];xz=points[:,[0,2]]
            if mesh['name']=='near walk':
                tri=Polygon(xz)
                if tri.area>1e-8:walks.append(tri)
                for q,y in zip(xz,h):
                    p=Point(q);expected=.15
                    for j in ramp_tree.query(p):
                        r=ramps[j]
                        if not ramp_geoms[j].covers(p):continue
                        along=sum((q[k]-r['end'][k])*r['inward'][k] for k in (0,1))
                        expected=min(expected,.004+.146*max(0,min(1,along/r['length_m'])))
                    wrong_walk_heights+=int(abs(float(y)-expected)>.001)
                    ramp_vertices+=int(expected<.149)
            if np.ptp(h)<1e-5:
                tri=Polygon(xz)
                if tri.area<1e-8:continue
                if mesh['name']=='near curb' and h[0]>.1:tops.append((tri,float(h[0])))
            elif mesh['name']=='near curb' and min(h)<.001 and max(h)>.003:
                # Project every complete vertical triangle to its footprint line.
                unique=np.unique(xz,axis=0)
                if len(unique)>=2:sides.append(LineString(unique))
    sides = list({l.wkb:l for l in sides}.values()); st=STRtree(sides)
    parts=[]
    for p in walk_parts:
        for ring in [p.exterior,*p.interiors]:
            cs=list(ring.coords)
            for aa,bb in zip(cs[:-1],cs[1:]):
                edge=LineString([aa,bb]);ids=st.query(edge.buffer(.05))
                backing=unary_union([sides[j].buffer(.04,cap_style=3) for j in ids])
                gap=edge.difference(backing)
                if not gap.is_empty:parts.extend(list(gap.geoms) if hasattr(gap,'geoms') else [gap])
    padded=[p.buffer(.08) for p in backing_parts]
    for p in padded:prepare(p)
    unbacked=[]
    for t,h in tops:
        ids=wp.query(t.buffer(.2))
        if any(padded[j].covers(t) for j in ids):continue
        local=unary_union([padded[j].intersection(t.buffer(.2)) for j in ids])
        if t.difference(local).area>.002:unbacked.append(t)
    wt=STRtree(walks);coplanar=[]
    for t,h in tops:
        if abs(h-.15)>.0005:continue
        if sum(t.intersection(walks[j]).area for j in wt.query(t))>.002:coplanar.append(t)
    open_kerb_edges=0
    # Shared trim edges inside the union need no buried duplicate wall.
    for p in polys(unary_union(kerb_bases)):
        for ring in [p.exterior,*p.interiors]:
            cs=list(ring.coords)
            for aa,bb in zip(cs[:-1],cs[1:]):
                edge=LineString([aa,bb]);ids=st.query(edge.buffer(.05))
                backing=unary_union([sides[j].buffer(.04,cap_style=3) for j in ids])
                if edge.difference(backing).length>.1:open_kerb_edges+=1
    kerb_lines=[LineString(pairs(r,0)) for r in s['kerbs']];kt=STRtree(kerb_lines)
    coords=list({tuple(q) for t,h in tops for q in list(t.exterior.coords)[:-1]})
    matches,distances=kt.query_nearest(make_points(coords),return_distance=True,all_matches=False)
    wide_points={coords[int(i)] for i,d in zip(matches[0],distances) if d>.23}
    wide_tops=sum(any(tuple(q) in wide_points for q in t.exterior.coords) for t,h in tops)
    result={'walk_top_triangles':len(walks),'kerb_top_triangles':len(tops),
            'wrong_walk_transition_heights':wrong_walk_heights,'sloped_walk_vertices':ramp_vertices,
            'unbacked_kerb_top_triangles':len(unbacked),'unbacked_top_m2':round(sum(t.area for t in unbacked),2),
            'coplanar_kerb_walk_triangles':len(coplanar),
            'open_slab_edges':sum(l.length>.1 for l in parts),'open_slab_edge_m':round(sum(l.length for l in parts if l.length>.1),2),
            'open_curb_solid_edges':open_kerb_edges,'overwide_kerb_triangles':wide_tops, 'invalid_ground_polygons':sum(not polygon(r).is_valid for k in ('walk','kerb_tops') for r in s.get(k,[])),
            'join_checks':s.get('ground_join_checks',{})}
    return result

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--mesh',type=Path,required=True);ap.add_argument('--data',type=Path,default=ROOT/'v2/data/street');ap.add_argument('--report',action='store_true');ap.add_argument('--output',type=Path);a=ap.parse_args()
    d=audit(a.data,a.mesh);t=json.dumps(d,indent=2);print(t)
    if a.output:a.output.write_text(t)
    if not a.report and any(d[k] for k in ('wrong_walk_transition_heights','unbacked_kerb_top_triangles','coplanar_kerb_walk_triangles','open_slab_edges','invalid_ground_polygons','open_curb_solid_edges','overwide_kerb_triangles')):raise SystemExit('FAIL: exposed or overlapping slab geometry')
if __name__=='__main__':main()
