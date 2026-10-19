#!/usr/bin/env python3
"""Filter both public tree sources against the final quantized carriageway, without moving inferred trunks.

Run after street_graph.py: python3 scripts/v2/street_tree_safety.py
Raw trees stay reproducible. safe_city.json and safe_osm.json are the only tree files v2 draws.
"""
import json,hashlib
from pathlib import Path
from shapely.geometry import Point
from shapely.ops import unary_union
from shapely import prepare
from street_finish import polygon
ROOT=Path(__file__).resolve().parents[2]

def main():
    street=ROOT/'v2/data/street/surface.json';surface=json.loads(street.read_text())
    # Holes remain holes: an actual median beneath a trunk is not carriageway. Full trunk radius plus rounding clearance.
    road=unary_union([polygon(r) for r in surface['asphalt']]);prepare(road)
    counts={}
    for name in ('city','osm'):
        source=ROOT/f'v2/data/trees/{name}.json';d=json.loads(source.read_text());kept=[];dropped=[]
        for i in range(0,len(d['trees']),6):
            r=d['trees'][i:i+6];p=Point(r[:2]);trunk=.12+r[2]*.025+.08
            if road.intersects(p.buffer(trunk)):dropped.append(i//6)
            else:kept.extend(r)
        counts[name]={'before':len(d['trees'])//6,'dropped_on_carriageway':len(dropped),'after':len(kept)//6}
        d['_license'] = ('© OpenStreetMap contributors, ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/). '
                         'Tree selection filtered against the OSM-derived roadway surface; derivative selection offered under ODbL. '
                         + ('Original tree observations: City of Austin open inventories/aerial; raw city.json remains separate.'
                            if name == 'city' else 'Original tree observations: OpenStreetMap natural=tree nodes.'))
        d['trees']=kept;d['safety']={**counts[name],'surface_sha256':hashlib.sha256(street.read_bytes()).hexdigest(),'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'dropped_indices':dropped}
        (ROOT/f'v2/data/trees/safe_{name}.json').write_text(json.dumps(d,separators=(',',':')))
    print(json.dumps(counts,indent=2))
if __name__=='__main__':main()
