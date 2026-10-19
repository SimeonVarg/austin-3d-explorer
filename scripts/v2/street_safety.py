#!/usr/bin/env python3
"""Validate ALL v2 street furniture against the final carriageway. Run after street_graph.py.

python3 scripts/v2/street_safety.py [--data v2/data/street] [--audit /tmp/audit.json]

Raw City records stay intact. Writes safe.json (City furniture) and safe_osm.json (OSM furniture and lane-use arrows;
ODbL). Never turn a missing/ambiguous observation into an invented lane or sign position. No network required.
"""
import argparse
import collections
import hashlib
import json
import math
from pathlib import Path
import numpy as np
from shapely.geometry import Point, LineString, Polygon
from shapely.ops import unary_union, nearest_points
from shapely import STRtree, prepare
from street_graph import pairs, loc, r5

ROOT = Path(__file__).resolve().parents[2]
POST_SNAP_M = 8.0
POST_CLEAR_M = 0.6       # includes the signal's 0.42 m footing and output rounding
ARROW = dict(max_snap=2.0, approach=(7.0, 42.0), lane_width=(2.7, 4.3), separator_tolerance=0.55,
             alignment_deg=12.0, max_way_distance=9.0)
KINDS = {0: {'through'}, 1: {'left'}, 2: {'right'}, 3: {'left', 'through'}, 4: {'right', 'through'}}
LICENSE = ('© OpenStreetMap contributors, ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/). '
           'Furniture and lane-use placement derived from OpenStreetMap and the v2 street surface; derivative database under ODbL.')


def polygon(r):
    return Polygon(pairs(r[0], 0), [pairs(h, 0) for h in r[1:]]).buffer(0)


def direction(line, s):
    a = line.interpolate(max(0, s - 0.5)); b = line.interpolate(min(line.length, s + 0.5))
    u = np.array([b.x - a.x, b.y - a.y]); return u / (np.linalg.norm(u) or 1)


def flat(rows):
    return [v for row in rows for v in row]


def rows(values, n):
    return [values[i:i+n] for i in range(0, len(values), n)]


class Placement:
    def __init__(self, surface):
        self.road = unary_union([polygon(r) for r in surface['asphalt']])
        self.road_clear = self.road.buffer(0.43)
        walk = unary_union([polygon(r) for r in surface['walk']])
        self.support = walk.buffer(-POST_CLEAR_M).difference(self.road.buffer(POST_CLEAR_M))
        prepare(self.road); prepare(self.road_clear); prepare(self.support)
        self.parts = list(self.support.geoms) if self.support.geom_type == 'MultiPolygon' else [self.support]
        self.tree = STRtree(self.parts)
        self.inners = {}

    def safe(self, p):
        return self.support.covers(p)

    def snap(self, row):
        p = Point(row[:2])
        if self.safe(p):
            return row, 'kept'
        i = self.tree.nearest(p)
        if i is None:
            return None, 'dropped'
        q = nearest_points(p, self.parts[i])[1]
        # Move slightly INSIDE the valid slab, then recheck the actual quantized coordinates.
        for extra in (0.08, 0.15, 0.3):
            key = (int(i), extra)
            if key not in self.inners:self.inners[key] = self.parts[i].buffer(-extra)
            inner = self.inners[key]
            if inner.is_empty:
                continue
            q = nearest_points(p, inner)[1]; q = Point(r5(q.x), r5(q.y))
            if p.distance(q) <= POST_SNAP_M and self.safe(q):
                return [q.x, q.y] + row[2:], 'snapped'
        return None, 'dropped'

    def clean(self, records):
        out = []; counts = collections.Counter(total=len(records))
        counts['road_before'] = sum(self.road_clear.intersects(Point(r[:2])) for r in records)
        counts['unsupported_before'] = sum(not self.safe(Point(r[:2])) for r in records)
        for r in records:
            q, why = self.snap(r); counts[why] += 1
            if q is not None:
                out.append(q)
        counts['road_after'] = sum(self.road_clear.intersects(Point(r[:2])) for r in out)
        counts['unsupported_after'] = sum(not self.safe(Point(r[:2])) for r in out)
        assert counts['road_after'] == counts['unsupported_after'] == 0
        return out, dict(counts)


class LaneUse:
    def __init__(self, near, surface, osm_surface, marks):
        self.placement = Placement(surface)
        self.edges = [LineString(pairs(r, 3)) for r in near['roads']]
        self.edge_tree = STRtree(self.edges)
        self.near = near
        self.paint = [LineString(pairs(r, 4)) for r in surface['lanes'] + osm_surface['lanes']]
        self.paint_tree = STRtree(self.paint)
        self.bars = []
        for x,z,a,L,width in rows(marks['bars'],5):
            u=np.array([math.cos(a),math.sin(a)]);n=np.array([-u[1],u[0]]);c=np.array([x,z])
            self.bars.append(Polygon([c+u*L*i/2+n*width*j/2 for i,j in [(-1,-1),(-1,1),(1,1),(1,-1)]]))
        self.bar_tree=STRtree(self.bars)
        self.ways = []; self.outgoing = collections.defaultdict(list)
        raw = json.loads((ROOT / 'data/osm_cache/roads.json').read_text())
        for e in raw['elements']:
            t = e.get('tags', {})
            if e['type'] != 'way' or len(e.get('geometry', [])) < 2 or t.get('highway') in ('motorway', 'motorway_link', 'footway', 'path', 'steps', 'cycleway', 'pedestrian', 'construction'):
                continue
            if t.get('access') in ('no', 'private') or t.get('motor_vehicle') == 'no':
                continue
            pts = [loc(p['lon'], p['lat']) for p in e['geometry']]
            line = LineString(pts); nodes = e.get('nodes', [])
            if len(nodes) != len(pts):
                continue
            index = len(self.ways); self.ways.append(dict(id=e['id'], tags=t, pts=pts, nodes=nodes, line=line))
            for k, (a, b) in enumerate(zip(pts[:-1], pts[1:])):
                u = np.array(b) - a; u /= np.linalg.norm(u) or 1
                if t.get('oneway') != '-1': self.outgoing[nodes[k]].append((index, u))
                if t.get('oneway') not in ('yes', '1'): self.outgoing[nodes[k+1]].append((index, -u))
        self.tree = STRtree([w['line'] for w in self.ways])

    def candidate(self, record):
        x, z, old_angle, kind = record
        if kind not in KINDS: return None, 'unsupported_symbol'
        p = Point(x, z); matches = []
        for wi in self.tree.query(p.buffer(ARROW['max_way_distance'])):
            w = self.ways[wi]; line = w['line']; t = w['tags']; s = line.project(p)
            if line.distance(p) > ARROW['max_way_distance']: continue
            u0 = direction(line, s)
            for sign in (1, -1):
                if sign == 1 and t.get('oneway') == '-1' or sign == -1 and t.get('oneway') in ('yes', '1'): continue
                ow = t.get('oneway') in ('yes', '1', '-1')
                key = 'turn:lanes' if ow else ('turn:lanes:forward' if sign == 1 else 'turn:lanes:backward')
                use = t.get(key, '').split('|')
                if not t.get(key) or t.get('lanes:both_ways') or t.get('junction') == 'roundabout': continue
                try:
                    count = int(t.get('lanes') if ow else t.get('lanes:forward' if sign == 1 else 'lanes:backward'))
                except (TypeError, ValueError): continue
                if count != len(use): continue
                u = u0 * sign; n = np.array([-u[1], u[0]])  # RIGHT of travel in x-east/z-south
                ei = int(self.edge_tree.nearest(p)); e = self.edges[ei]; er = self.near['roads'][ei]
                es = e.project(p); eu = direction(e, es)
                if abs(float(eu @ u)) < math.cos(math.radians(ARROW['alignment_deg'])) or e.distance(p) > max(-er[0], er[1]): continue
                cpt = e.interpolate(es); c = np.array([cpt.x, cpt.y])
                lo, hi = (er[0], er[1]) if float(eu @ u) > 0 else (-er[1], -er[0])
                if not ow: lo = 0.0
                width = (hi - lo) / count
                if not ARROW['lane_width'][0] <= width <= ARROW['lane_width'][1]: continue
                # Require actual painted boundaries at EVERY internal divider. Kerb-to-kerb divided by lane count alone
                # includes parking/bike lanes and is not a measurement of the motor lanes.
                cut = LineString([c + n * lo, c + n * hi]); offsets = []
                for pi in self.paint_tree.query(cut.buffer(0.3)):
                    hit = self.paint[pi].intersection(cut)
                    if hit.geom_type == 'Point': offsets.append(float((np.array([hit.x, hit.y]) - c) @ n))
                if any(not any(abs(off - (lo + k * width)) <= ARROW['separator_tolerance'] for off in offsets) for k in range(1, count)): continue
                for lane, text in enumerate(use):
                    turns = set(text.split(';'))
                    if turns != KINDS[kind]: continue
                    q = c + n * (lo + (lane + 0.5) * width); qp = Point(q)
                    if p.distance(qp) > ARROW['max_snap']: continue
                    # Find the FIRST junction in this travel direction, with a legal directed exit, using shared OSM nodes.
                    # A parallel continuation or a driveway does not justify a turn arrow.
                    target = None
                    for k in (range(len(w['nodes'])) if sign > 0 else range(len(w['nodes'])-1, -1, -1)):
                        ns = line.project(Point(w['pts'][k])); ahead = (ns - s) * sign
                        if ahead < 0: continue
                        exits = []
                        for other, out in self.outgoing[w['nodes'][k]]:
                            ot = self.ways[other]['tags']
                            if ot.get('highway') == 'service': continue
                            angle = math.atan2(u[0]*out[1]-u[1]*out[0], float(u @ out))
                            if abs(angle) > math.radians(150): continue
                            exits.append('through' if abs(angle) < math.radians(30) else 'right' if angle > 0 else 'left')
                        if 'left' in exits or 'right' in exits:
                            target = (ahead, set(exits)); break
                    if not target or not ARROW['approach'][0] <= target[0] <= ARROW['approach'][1] or not turns <= target[1]: continue
                    # Bound full symbol including lateral branches, not just its centre. Never overlap a divider/stop/crosswalk.
                    angle = math.atan2(u[1],u[0]); q = [r5(q[0]), r5(q[1]), round(angle, 5), kind]
                    if not self.placement.road.covers(Point(q[:2]).buffer(1.35)): continue
                    envelope=Polygon([np.array(q[:2])+u*1.35*i+n*1.2*j for i,j in [(-1,-1),(-1,1),(1,1),(1,-1)]])
                    if any(envelope.intersects(self.bars[bi]) for bi in self.bar_tree.query(envelope)):continue
                    matches.append((p.distance(qp), q, dict(way=w['id'], lane=lane, lanes=count, laneWidth=round(width,3),
                                                         turns=sorted(turns), junctionDistance=round(target[0],2))))
        if not matches: return None, 'no_proven_lane_and_turn'
        matches.sort(key=lambda r:r[0])
        # Ambiguous parallel roads or opposing direction: drop rather than guess.
        if any(math.hypot(m[1][0]-matches[0][1][0], m[1][1]-matches[0][1][1]) > .5 or abs(math.sin((m[1][2]-matches[0][1][2])/2)) > .1 for m in matches[1:]):
            return None, 'ambiguous_lane'
        return (matches[0][1], matches[0][2]), 'kept'


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--data', type=Path, default=ROOT/'v2/data/street');ap.add_argument('--audit', type=Path);a=ap.parse_args()
    get=lambda name:json.loads((a.data/(name+'.json')).read_text())
    near, surf, city, osm = (get(n) for n in ('near','surface','city','osm'))
    placement=Placement(surf); counts={}; out={'about':'Validated City of Austin furniture; scripts/v2/street_safety.py. Not endorsed by the City of Austin.'}; out_osm={'_license':LICENSE}
    out['signs'],counts['signs']=placement.clean(near['signs'])
    out['signals'],counts['signals']=placement.clean(rows(city['signals'],4))
    # Infer an inward mast bearing after moving the base: these inputs do not contain observed arm endpoints.
    # Clamp to a modest span; discard an arm whose outer head would not be above the carriageway.
    for r in out['signals']:
        p=Point(r[:2])
        # road's closest point gives an inward bearing, with the head over the carriageway rather than over the sidewalk.
        edge=nearest_points(p,placement.road)[1];dx,dz=edge.x-p.x,edge.y-p.y;L=math.hypot(dx,dz)
        r[2]=round(math.atan2(dz,dx),5)
        r[3]=round(min(12.0,L+6.0),2) if r[3]>0 else 0
        if r[3] and not placement.road.covers(Point(p.x+math.cos(r[2])*r[3]*.92,p.y+math.sin(r[2])*r[3]*.92)):r[3]=0
    for key,stride in [('lamps',3),('stops',5),('benches',3)]:
        out_osm[key],counts[key]=placement.clean(rows(osm.get(key,[]),stride))
    def road_angle(r):
        p=Point(r[:2]);q=nearest_points(p,placement.road)[1]
        return round(math.atan2(q.y-p.y,q.x-p.x),5)
    out_osm['lamp_angles']=[road_angle(r) for r in out_osm['lamps']]
    for r in out_osm['stops']+out_osm['benches']:r[2]=road_angle(r)
    # The full shelter/bench, not just its sign post, has to fit on the sidewalk. An unproven shelter is omitted.
    for s in out_osm['stops']:
        x,z,ang,shelter,bench=s
        n=np.array([math.cos(ang),math.sin(ang)]);side=np.array([-n[1],n[0]])
        def fits(back,depth,width):
            corners=[np.array([x,z])-n*back+n*depth*i/2+side*width*j/2 for i,j in [(-1,-1),(-1,1),(1,1),(1,-1)]]
            return placement.support.covers(Polygon(corners))
        if shelter and not fits(.8,1.6,3.6):s[3]=0
        if bench and not fits(1.2,.5,1.8):s[4]=0
    benches=[]
    for r in out_osm['benches']:
        x,z,ang=r;n=np.array([math.cos(ang),math.sin(ang)]);side=np.array([-n[1],n[0]])
        footprint=Polygon([np.array([x,z])+n*.25*i+side*.9*j for i,j in [(-1,-1),(-1,1),(1,1),(1,-1)]])
        if placement.support.covers(footprint):benches.append(r)
    counts['benches']['footprints_dropped']=len(out_osm['benches'])-len(benches)
    out_osm['benches']=benches
    lane=LaneUse(near,surf,get('surface_osm'),get('marks')); arrows=[]; evidence=[]; counts['arrows']=collections.Counter(total=len(near['arrows']))
    for r in near['arrows']:
        result,why=lane.candidate(r);counts['arrows'][why]+=1
        if result:
            q,source=result
            # No duplicates and no symbol within a crossing/stop bar.
            if any(Point(q[:2]).distance(Point(p[:2]))<3 for p in arrows):counts['arrows']['duplicates_dropped']+=1;continue
            arrows.append(q);evidence.append(source)
    out_osm['arrows']=arrows;out_osm['arrow_evidence']=evidence
    counts['arrows']=dict(counts['arrows']);counts['arrows']['after']=len(arrows)
    for key in ('signals',):out[key]=flat(out[key])
    for key in ('lamps','stops','benches'):out_osm[key]=flat(out_osm[key])
    digest=lambda n:hashlib.sha256((a.data/(n+'.json')).read_bytes()).hexdigest()
    out['inputs']={n:digest(n) for n in ('near','surface','city')}
    out_osm['inputs']={n:digest(n) for n in ('near','surface','osm','surface_osm','marks')}
    out_osm['road_input_sha256']=hashlib.sha256((ROOT/'data/osm_cache/roads.json').read_bytes()).hexdigest()
    out['counts']={k:counts[k] for k in ('signs','signals')}
    out_osm['counts']={k:counts[k] for k in ('lamps','stops','benches','arrows')}
    for name,data in [('safe',out),('safe_osm',out_osm)]:
        (a.data/(name+'.json')).write_text(json.dumps(data,separators=(',',':')))
    if a.audit:a.audit.write_text(json.dumps(counts,indent=2))
    print(json.dumps(counts,indent=2))

if __name__=='__main__':main()
