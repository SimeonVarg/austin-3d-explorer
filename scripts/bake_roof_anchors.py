"""Bind stale roofscape decks and both equipment tiers to their current walls.

Owns only data/roof_anchors.json. Does not rewrite another bake's geometry or
PMTiles. Guards include the observed old base heights, so a later roofscape
rebake is not translated a second time.
"""
import json
from pathlib import Path
from shapely.geometry import shape, mapping
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
MIN_MISMATCH = 2.0
MIN_COVERAGE = .98
CAP_MIN = 1.0
CAP_RATIO = .015


def build():
    manifest = json.loads((ROOT/'data/manifest.json').read_text())
    snapshot = manifest['latest']
    buildings = json.loads((ROOT/f'data/snapshots/{snapshot}/buildings.detailed.geojson').read_text(encoding='utf-8'))['features']
    geoms = [shape(f['geometry']).buffer(0) for f in buildings]
    tree = STRtree(geoms)
    tiers = [json.loads((ROOT/f'data/{file}').read_text())['features']
             for file in ['roofscape.geojson', 'roofscape.detail.geojson']]
    anchors = []
    for deck in tiers[0]:
        if deck['properties']['k'] != 'deck':
            continue
        g = shape(deck['geometry']).buffer(0)
        candidates = tree.query(g)
        if not len(candidates) or not g.area:
            continue
        i = max(candidates, key=lambda i: g.intersection(geoms[i]).area)
        host = buildings[i]['properties']
        if g.intersection(geoms[i]).area/g.area < MIN_COVERAGE:
            continue
        h = host['final_height']
        expected = round(h + max(CAP_MIN, CAP_RATIO*h), 2)
        old = deck['properties']['b']
        if abs(expected-old) <= MIN_MISMATCH:
            continue
        # The deck and equipment are already inset from the host boundary.
        # Keep that complete host polygon for the tiled polygon-distance test.
        bases = set()
        counts = []
        for tier in tiers:
            n = 0
            for f in tier:
                if geoms[i].contains(shape(f['geometry'])):
                    bases.add(f['properties']['b'])
                    n += 1
            counts.append(n)
        anchors.append(dict(id=host['id'], name=host.get('name'), geometry=mapping(geoms[i]),
                            oldBases=sorted(bases), oldDeck=old, deck=expected,
                            delta=round(expected-old, 2), tierCounts=counts))
    return dict(version=1, snapshot=snapshot, anchors=anchors)


if __name__ == '__main__':
    result = build()
    (ROOT/'data/roof_anchors.json').write_text(json.dumps(result, separators=(',', ':'))+'\n')
    print(json.dumps([{k: a[k] for k in ['name','oldDeck','deck','tierCounts']} for a in result['anchors']], indent=2))
