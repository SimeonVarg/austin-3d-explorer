#!/usr/bin/env python3
"""Keep public tree observations ahead of inferred road widths.

Run after street_graph.py: python3 scripts/v2/street_tree_safety.py [--audit /tmp/trees.json]
Raw observations never move. Render placements and their source indices are saved separately.
"""
import argparse
import collections
import hashlib
import json
from pathlib import Path
from shapely.geometry import Point, Polygon, box, LineString
from shapely.ops import unary_union, nearest_points
from shapely import STRtree, prepare
from street_finish import polygon
from street_graph import r5, pairs, offset
ROOT = Path(__file__).resolve().parents[2]
EDGE_ALLOWANCE_M = 2.0
MAX_RELOCATION_M = 6.0
ROUNDING_CLEAR_M = .08
DEPTH_BINS = (0, .5, 1, 2, 3, 5, float('inf'))


def source_kind(d, name, index):
    # street_trees.py appends downtown survey, general survey, then aerial detections.
    # Do not call the entire mixed City/aerial file surveyed.
    if name != 'city': return 'osm_point'
    counts = d['counts']
    assert sum(counts[k] for k in ('downtown_2013', 'inventory', 'detected')) == len(d['trees']) // 6
    return 'city_survey' if index < counts['downtown_2013'] + counts['inventory'] else 'aerial_detection'


def depth_bin(depth):
    if depth < 0: return 'outside_road'
    for lo, hi in zip(DEPTH_BINS[:-1], DEPTH_BINS[1:]):
        if depth <= hi: return f'{lo:g}–{hi:g}m'


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--audit', type=Path); ap.add_argument('--histogram-only', action='store_true'); a = ap.parse_args()
    street = ROOT / 'v2/data/street/surface.json'; surface = json.loads(street.read_text())
    road = unary_union([polygon(r) for r in surface['asphalt']]); boundary = road.boundary; prepare(road)
    near_path = ROOT/'v2/data/street/near.json'; near = json.loads(near_path.read_text()); travel_parts=[]
    for r in near['roads']:
        pts=pairs(r,3)
        travel_parts.append(LineString(pts).buffer((r[1]-r[0])/2,cap_style=2) if r[2]&1 else Polygon(offset(pts,r[1])+offset(pts,r[0])[::-1]).buffer(0))
    travel = unary_union(travel_parts); travel_boundary = travel.boundary; prepare(travel)
    support = [polygon(r) for k in ('walk', 'paving', 'lawn', 'mulch') for r in surface[k]]
    support_tree = STRtree(support)
    road_parts = [polygon(r) for r in surface['asphalt']]; road_tree = STRtree(road_parts)
    # The fallback is unclassified ground, not an invented planter. Exclude all known extruded building outlines.
    from street_trees import outlines
    grid = outlines(); building_rings = {tuple(ring) for rows in grid.values() for bb,ring in rows}
    buildings = [Polygon(r).buffer(0) for r in building_rings]; building_tree = STRtree(buildings)
    counts = {}
    for name in ('city', 'osm'):
        source = ROOT / f'v2/data/trees/{name}.json'; d = json.loads(source.read_text())
        kept = []; dropped = []; kept_indices = []; moved = []; unresolved = []; non_travel = []; hist = collections.defaultdict(collections.Counter)
        c = collections.Counter(before=len(d['trees']) // 6)
        for index in range(len(d['trees']) // 6):
            r = d['trees'][index*6:index*6+6]; p = Point(r[:2]); trunk = .12 + r[2] * .025 + ROUNDING_CLEAR_M
            collision = road.intersects(p.buffer(trunk))
            depth = boundary.distance(p) * (1 if road.covers(p) else -1)
            kind = source_kind(d, name, index)
            if collision:
                c['round2_dropped'] += 1; hist[kind][depth_bin(depth)] += 1
                travel_deep = travel.covers(p) and travel_boundary.distance(p)>EDGE_ALLOWANCE_M
                if depth > EDGE_ALLOWANCE_M and travel_deep:
                    dropped.append(index); c['dropped_deep_in_road'] += 1; continue
                c['restored_from_round2'] += 1
                if depth>EDGE_ALLOWANCE_M:
                    non_travel.append(index);c['retained_asphalt_frontage_or_corner']+=1
                if not a.histogram_only:
                    # A nearby sidewalk/planting surface is stronger support than a guessed width.
                    # Local union handles tile seams. Erode the full trunk footprint before choosing a point.
                    candidates = support_tree.query(p.buffer(MAX_RELOCATION_M + trunk))
                    local = unary_union([support[j] for j in candidates]).buffer(-trunk - ROUNDING_CLEAR_M)
                    local_road = unary_union([road_parts[j] for j in road_tree.query(p.buffer(MAX_RELOCATION_M + trunk + 1))])
                    region = box(p.x-MAX_RELOCATION_M,p.y-MAX_RELOCATION_M,p.x+MAX_RELOCATION_M,p.y+MAX_RELOCATION_M)
                    obstacles = unary_union([buildings[j].intersection(region) for j in building_tree.query(region)])
                    allowed = local.difference(local_road.buffer(trunk + ROUNDING_CLEAR_M)).difference(obstacles.buffer(trunk+ROUNDING_CLEAR_M))
                    if not allowed.is_empty:
                        inner_allowed = allowed.buffer(-ROUNDING_CLEAR_M)
                        if not inner_allowed.is_empty: allowed = inner_allowed
                        q = nearest_points(p, allowed)[1]; q = Point(r5(q.x), r5(q.y))
                        if p.distance(q) <= MAX_RELOCATION_M and local.covers(q) and not road.intersects(q.buffer(trunk)):
                            moved.append({'source_index': index, 'source_kind': kind, 'from': r[:2], 'to': [q.x, q.y],
                                          'road_depth_m': round(depth, 3), 'move_m': round(p.distance(q), 3)})
                            r = [q.x, q.y] + r[2:]; c['relocated_to_walk_or_planting'] += 1
                        else: unresolved.append(index)
                    else: unresolved.append(index)
                    if index in unresolved:
                        verge = region.difference(local_road.buffer(trunk+ROUNDING_CLEAR_M)).difference(obstacles.buffer(trunk+ROUNDING_CLEAR_M)).buffer(-ROUNDING_CLEAR_M)
                        if not verge.is_empty:
                            q = nearest_points(p,verge)[1]; q = Point(r5(q.x),r5(q.y))
                            if p.distance(q)<=MAX_RELOCATION_M and not road.intersects(q.buffer(trunk)) and not obstacles.intersects(q.buffer(trunk)):
                                moved.append({'source_index':index,'source_kind':kind,'from':r[:2],'to':[q.x,q.y],
                                              'road_depth_m':round(depth,3),'move_m':round(p.distance(q),3),
                                              'support':'inferred offroad verge; material/planter unobserved'})
                                r=[q.x,q.y]+r[2:];c['relocated_to_inferred_verge']+=1;unresolved.remove(index)
                    # Preserve and expose any conflict that neither mapped ground nor an unbuilt verge resolves.
            kept.extend(r); kept_indices.append(index)
        c['after'] = len(kept) // 6; c['unresolved_support'] = len(unresolved)
        counts[name] = {**c, 'round2_drop_depth_histogram': dict(hist)}
        if a.histogram_only: continue
        d['_license'] = ('© OpenStreetMap contributors, ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/). '
                         'Render tree selection/placements derived from the OSM-derived roadway; derivative database offered under ODbL. '
                         'Original observations remain in the separate raw tree files.')
        d['trees'] = kept
        d['safety'] = {**counts[name], 'edge_allowance_m': EDGE_ALLOWANCE_M, 'max_relocation_m': MAX_RELOCATION_M,
                       'surface_sha256': hashlib.sha256(street.read_bytes()).hexdigest(),
                       'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                       'travel_surface_input_sha256':hashlib.sha256(near_path.read_bytes()).hexdigest(),
                       'not_deep_in_carriageway_indices':non_travel,
                       'source_index_basis': 'street_trees.py append order and source counts',
                       'building_inputs': {n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in
                                           ('data/snapshots/2026-09-15/buildings.detailed.geojson','data/outer/downtown_massing.json')},
                       'kept_indices': kept_indices, 'dropped_indices': dropped, 'relocations': moved, 'unresolved_indices': unresolved}
        (ROOT / f'v2/data/trees/safe_{name}.json').write_text(json.dumps(d, separators=(',', ':')))
    print(json.dumps(counts, indent=2))
    if a.audit: a.audit.write_text(json.dumps(counts, indent=2))
if __name__ == '__main__': main()
