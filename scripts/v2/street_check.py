#!/usr/bin/env python3
"""Whole-network street acceptance checks, independent of the cleanup's record selection.

python3 scripts/v2/street_check.py --before /tmp/before --output /tmp/checks.json
No network, browser or private source required. A baseline may fail; the current data must pass.
"""
import argparse
import collections
import hashlib
import json
import math
import sys
import time
from pathlib import Path
import numpy as np
from shapely.geometry import Point, Polygon, LineString
from shapely.ops import unary_union
from shapely import STRtree, prepare
from street_graph import pairs, loc
from street_finish import inspect, documented_ground
from street_tree_check import audit_trees

ROOT=Path(__file__).resolve().parents[2]

def poly(r):return Polygon(pairs(r[0],0),[pairs(h,0) for h in r[1:]])
def chunks(a,n):return [a[i:i+n] for i in range(0,len(a),n)]
def rect(x,z,a,length,width):
    u=np.array([math.cos(a),math.sin(a)]);n=np.array([-u[1],u[0]]);p=np.array([x,z])
    return Polygon([p+u*length*i/2+n*width*j/2 for i,j in [(-1,-1),(-1,1),(1,1),(1,-1)]])

def audit(folder):
    t0=time.monotonic()
    def stage(s):print(f'{folder.name}: {s} ({time.monotonic()-t0:.1f}s)',file=sys.stderr,flush=True)
    stage('start')
    load=lambda n:json.loads((folder/(n+'.json')).read_text())
    near,surface,marks,city,osm=(load(n) for n in ('near','surface','marks','city','osm'))
    clean=(folder/'safe.json').exists();safe=load('safe') if clean else None;so=load('safe_osm') if clean else None
    polygons={k:[poly(r) for r in surface[k]] for k in ['asphalt','walk','paving','lawn','mulch']}
    result={'junctions':surface['checks']['junctions'],'streets':len(near['roads']),
            'invalid_polygons':{k:sum(not p.is_valid for p in ps) for k,ps in polygons.items()}}
    result['stale_safe_inputs']=0
    if clean:
        for inventory in (safe,so):
            result['stale_safe_inputs']+=sum(hashlib.sha256((folder/(n+'.json')).read_bytes()).hexdigest()!=h for n,h in inventory['inputs'].items())
        result['stale_safe_inputs']+=hashlib.sha256((ROOT/'data/osm_cache/roads.json').read_bytes()).hexdigest()!=so['road_input_sha256']
    road=unary_union([p.buffer(0) for p in polygons['asphalt']]);walk=unary_union([p.buffer(0) for p in polygons['walk']]);innerroad=road.buffer(.43)
    road_pad=road.buffer(.06);walk_pad=walk.buffer(.08)
    prepare(road);prepare(walk);prepare(innerroad);prepare(road_pad);prepare(walk_pad)
    stage('surface')
    objects={'signs':safe['signs'] if clean else near['signs'],'signals':chunks(safe['signals'] if clean else city['signals'],4),
             **{k:chunks(so.get(k,[]) if clean else osm.get(k,[]),n) for k,n in [('lamps',3),('stops',5),('benches',3)]}}
    result['poles']={}
    for k,rs in objects.items():
        result['poles'][k]={'total':len(rs),'in_carriageway':sum(innerroad.intersects(Point(r[:2])) for r in rs),
                           'not_supported_by_sidewalk':sum(not walk.covers(Point(r[:2]).buffer(.43)) for r in rs)}
    stage('poles')
    # Full symbol footprints, not point containment. Lane-use symbols cannot lie on a divider or the opposing half.
    arrows=so['arrows'] if clean else near['arrows'];edge=[LineString(pairs(r,3)) for r in near['roads']];et=STRtree(edge)
    lanes=[LineString(pairs(r,4)) for r in surface['lanes']+load('surface_osm')['lanes']];lt=STRtree(lanes)
    ar=collections.Counter(total=len(arrows),outside_road=0,straddles_line=0,opposes_travel=0,unsupported_kind=0,not_lane_centre=0,
                           unproven_lane_or_turn=0,overlaps_crossing_or_stop=0,midblock_or_past_junction=0,turn_exit_missing=0)
    bars=[rect(*r) for r in chunks(marks['bars'],5)];bt=STRtree(bars)
    result['paint_bars_outside_road']=sum(not road_pad.covers(b) for b in bars)
    result['lane_lines_outside_road']=sum(not road_pad.covers(l) for l in lanes)
    ways={e['id']:e for e in json.loads((ROOT/'data/osm_cache/roads.json').read_text())['elements'] if e['type']=='way'}
    network=[];departures=collections.defaultdict(list)
    for wid,w in ways.items():
        t=w.get('tags',{});g=w.get('geometry',[]);nodes=w.get('nodes',[])
        if len(g)<2 or len(nodes)!=len(g) or t.get('highway') in ('motorway','motorway_link','service','footway','path','steps','cycleway','pedestrian','construction') or t.get('access') in ('private','no') or t.get('motor_vehicle')=='no':continue
        pts=[loc(q['lon'],q['lat']) for q in g];line=LineString(pts);network.append((wid,line,pts,nodes,t))
        for j,(aa,bb) in enumerate(zip(pts[:-1],pts[1:])):
            v=np.array(bb)-aa;v/=np.linalg.norm(v) or 1
            if t.get('oneway')!='-1':departures[nodes[j]].append(v)
            if t.get('oneway') not in ('yes','1'):departures[nodes[j+1]].append(-v)
    nt=STRtree([r[1] for r in network])
    for i,(x,z,a,k) in enumerate(arrows):
        p=Point(x,z);envelope=rect(x,z,a,2.7,2.4 if k else .8)
        if not road_pad.covers(envelope):ar['outside_road']+=1
        if k not in range(5):ar['unsupported_kind']+=1
        if any(envelope.intersects(lanes[j]) for j in lt.query(envelope)):ar['straddles_line']+=1
        if any(envelope.intersects(bars[j]) for j in bt.query(envelope)):ar['overlaps_crossing_or_stop']+=1
        ri=int(et.nearest(p));e=edge[ri];s=e.project(p);c=e.interpolate(s);aa=e.interpolate(max(0,s-.5));bb=e.interpolate(min(e.length,s+.5))
        u=np.array([bb.x-aa.x,bb.y-aa.y]);u/=np.linalg.norm(u) or 1;n=np.array([-u[1],u[0]]);off=float((np.array([x-c.x,z-c.y]))@n)
        fwd=math.cos(a)*u[0]+math.sin(a)*u[1]
        if (near['roads'][ri][2]&2 and fwd<0) or (not near['roads'][ri][2]&2 and fwd*off<-.2):ar['opposes_travel']+=1
        candidates=nt.query(p.buffer(9));matches=[]
        for ni in candidates:
            wid,line,pts,nodes,t=network[ni];ss=line.project(p);a0=line.interpolate(max(0,ss-.5));b0=line.interpolate(min(line.length,ss+.5))
            du=np.array([b0.x-a0.x,b0.y-a0.y]);du/=np.linalg.norm(du) or 1
            if abs(float(du@[math.cos(a),math.sin(a)]))<math.cos(math.radians(15)):continue
            matches.append((line.distance(p),ni,ss,1 if float(du@[math.cos(a),math.sin(a)])>0 else -1))
        first=None
        if matches:
            _,ni,ss,sign=min(matches);wid,line,pts,nodes,t=network[ni];heading=np.array([math.cos(a),math.sin(a)])
            node_data=sorted(((line.project(Point(q))-ss)*sign,node) for q,node in zip(pts,nodes))
            for distance,node in node_data:
                if distance<0:continue
                exits=set()
                for v in departures[node]:
                    angle=math.degrees(math.atan2(heading[0]*v[1]-heading[1]*v[0],float(heading@v)))
                    if abs(angle)<30:exits.add('through')
                    elif abs(angle)<150:exits.add('right' if angle>0 else 'left')
                if 'left' in exits or 'right' in exits:first=(distance,exits);break
        if not first or not 7<=first[0]<=42:ar['midblock_or_past_junction']+=1
        requested={0:{'through'},1:{'left'},2:{'right'},3:{'left','through'},4:{'right','through'}}.get(k,set())
        if not first or not requested<=first[1]:ar['turn_exit_missing']+=1
        if not clean:
            ar['unproven_lane_or_turn']+=1
            # No saved lane identity exists in the old bake. Flag centres on dividers explicitly, don't pretend the rest are known.
            if min((p.distance(lanes[j]) for j in lt.query(p.buffer(2))),default=99)<.6:ar['not_lane_centre']+=1
        else:
            ev=so['arrow_evidence'][i];w=ways[ev['way']];t=w['tags'];wl=LineString([loc(g['lon'],g['lat']) for g in w['geometry']]);ws=wl.project(p)
            wa,wb=wl.interpolate(max(0,ws-.5)),wl.interpolate(min(wl.length,ws+.5));v=np.array([wb.x-wa.x,wb.y-wa.y]);v/=np.linalg.norm(v) or 1
            forward=np.dot(v,[math.cos(a),math.sin(a)])>0;ow=t.get('oneway') in ('yes','1','-1')
            key='turn:lanes' if ow else 'turn:lanes:forward' if forward else 'turn:lanes:backward'
            declared=t.get(key,'').split('|');masks={0:{'through'},1:{'left'},2:{'right'},3:{'left','through'},4:{'right','through'}}
            if ev['lane']>=len(declared) or set(declared[ev['lane']].split(';'))!=masks.get(k) or not 7<=ev['junctionDistance']<=42:ar['unproven_lane_or_turn']+=1
            lo,hi=(near['roads'][ri][0],near['roads'][ri][1]) if fwd>0 else (-near['roads'][ri][1],-near['roads'][ri][0])
            if not ow:lo=0
            expected=lo+(ev['lane']+.5)*(hi-lo)/ev['lanes']
            if abs(off*(1 if fwd>0 else -1)-expected)>.12:ar['not_lane_centre']+=1
    result['arrows']=dict(ar)
    stage('arrows')
    result['warning_pads']={'total':len(marks['pads'])//3,'on_road':0,'unsupported':0}
    road_parts=[p.buffer(0) for p in polygons['asphalt']];rt=STRtree(road_parts)
    for x,z,a in chunks(marks['pads'],3):
        # Before the fix the runtime added an extra 0.4 m shift perpendicular to the crossing.
        if not clean:x+=math.cos(a-math.pi/2)*.4;z+=math.sin(a-math.pi/2)*.4
        p=rect(x,z,a,1.2,.6)
        if sum(p.intersection(road_parts[j]).area for j in rt.query(p))>.02:result['warning_pads']['on_road']+=1
        if not walk_pad.covers(p):result['warning_pads']['unsupported']+=1
    # Audit every street, not only the named cameras. Area and length are independent of the renderer's fade.
    stage('pads')
    road_coverage=road.buffer(.12);prepare(road_coverage)
    misses=[i for i,l in enumerate(edge) if not road_coverage.covers(l) and l.difference(road_coverage).length>.5]
    result['road_surface']={'area_m2':round(road.area,2),'uncovered_street_centrelines':len(misses),'uncovered_ids':misses}
    stage('streets')
    # Flag ALL small enclosed spaces, with the amount incorrectly turned into raised frontage paving.
    parts=[road] if road.geom_type=='Polygon' else road.geoms
    holes=[Polygon(h) for p in parts for h in p.interiors if Polygon(h).area<400]
    paves=[p.buffer(0) for p in polygons['paving']];ptree=STRtree(paves)
    areas=[];documented_areas=[]
    dg=documented_ground(surface);dg_parts=list(dg.geoms) if hasattr(dg,'geoms') else ([] if dg.is_empty else [dg]);dgt=STRtree(dg_parts)
    for h in holes:
        h=h.buffer(-.15)
        total=sum(paves[j].intersection(h).area for j in ptree.query(h))
        known=sum(dg_parts[j].intersection(h).area for j in dgt.query(h))
        documented_areas.append(known);areas.append(max(0,total-known))
    example=Point(-480,387).buffer(5)
    result['enclosed_spaces']={'flagged':len(holes),'raised_frontage_m2':round(sum(areas),2),'documented_ground_paving_m2':round(sum(documented_areas),2),
                              'affected':sum(v>1 for v in areas),
                              'example_corner_frontage_m2':round(sum(paves[j].intersection(example).area for j in ptree.query(example)),2),
                              'flags':[{'centre_m':[round(h.centroid.x,2),round(h.centroid.y,2)],'area_m2':round(h.area,2),
                                        'raised_frontage_m2':round(area,2)} for h,area in zip(holes,areas)]}
    stage('islands')
    result['round2'] = inspect(surface, load('surface_osm'), near, marks)
    tree_dir = folder.parent/'trees'
    result['trees'] = {}
    for source in ('city','osm'):
        path=tree_dir/(('safe_'+source+'.json') if (tree_dir/('safe_'+source+'.json')).exists() else (source+'.json'))
        if not path.exists():continue
        trees=json.loads(path.read_text());rows=chunks(trees['trees'],6)
        result['trees'][source]={'total':len(rows),'trunk_centres_on_road':sum(road.covers(Point(r[:2])) for r in rows),
            'trunk_footprints_on_road':sum(road.intersects(Point(r[:2]).buffer(.12+r[2]*.025+.08)) for r in rows)}
        if 'safety' in trees:
            ev=trees['safety'];result['trees'][source]['stale']=int(hashlib.sha256((folder/'surface.json').read_bytes()).hexdigest()!=ev['surface_sha256'])
    if (tree_dir/'safe_city.json').exists() and (tree_dir/'city.json').exists():
        result['tree_retention'] = audit_trees(folder)
    if (folder/'sign_faces.json').exists():
        signs=load('sign_faces');result['sign_faces']=signs['counts']
        result['sign_faces']['stale']=sum(hashlib.sha256((folder/(n+'.json')).read_bytes()).hexdigest()!=h for n,h in signs['inputs'].items())
        result['sign_faces']['missing_glyphs']=sum(ch not in signs['glyphs'] for row in signs['faces'] for face in row if face for line in face for ch in line)
    stage('round2')
    return result

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--data',type=Path,default=ROOT/'v2/data/street');ap.add_argument('--before',type=Path);ap.add_argument('--output',type=Path);a=ap.parse_args()
    out={'after':audit(a.data)}
    if a.before:out['before']=audit(a.before)
    text=json.dumps(out,indent=2);print(text)
    if a.output:a.output.write_text(text)
    d=out['after'];errors=[]
    if d['stale_safe_inputs']:errors.append('stale safe inventories')
    if d['paint_bars_outside_road'] or d['lane_lines_outside_road']:errors.append('paint outside road')
    if any(d['invalid_polygons'].values()):errors.append('invalid polygons')
    if any(v['in_carriageway'] or v['not_supported_by_sidewalk'] for v in d['poles'].values()):errors.append('unsafe poles')
    if any(v for k,v in d['arrows'].items() if k!='total'):errors.append('unsafe symbols')
    if d['warning_pads']['on_road'] or d['warning_pads']['unsupported']:errors.append('unsafe warning pads')
    if d['enclosed_spaces']['raised_frontage_m2']>1:errors.append('invented islands')
    if d['road_surface']['uncovered_street_centrelines']:errors.append('road coverage')
    r2=d['round2']
    if any(r2[k]['detached_components'] for k in ('paving','lawn','mulch')) or r2['walk_fragments']:errors.append('detached raised fragments')
    if r2.get('ground_patch_provenance_stale'):errors.append('ground patch provenance')
    if any(v['nonparallel'] or v['duplicate_white'] for v in r2['lanes'].values()):errors.append('unsafe lane lines')
    if any(v.get('stale',0) for v in d['trees'].values()):errors.append('stale trees')
    if not d.get('tree_retention') and any(v['trunk_footprints_on_road'] for v in d['trees'].values()):errors.append('unverified tree conflicts')
    for c in d.get('tree_retention',{}).values():
        if any(v for k,v in c.items() if k not in ('total','inferred_verge_moves','trunks_on_road','trunk_footprints_on_road','recorded_edge_geometry_conflicts')):errors.append('tree retention/placement')
    if not d.get('sign_faces') or any(d['sign_faces'].get(k,0) for k in ('blank_faces_after','stale','missing_glyphs')):errors.append('sign legends')
    if errors:raise SystemExit('FAIL: '+', '.join(errors))
    conflicts=sum(v['recorded_edge_geometry_conflicts'] for v in d.get('tree_retention',{}).values())
    print(f'PASS: street retention/geometry checks; {conflicts} recorded edge-geometry conflicts remain open')
if __name__=='__main__':main()
