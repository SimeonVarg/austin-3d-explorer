#!/usr/bin/env python3
"""The Nine at West Campus (2518 Leon St): the mapped shell in the colours and rhythm of the site photographs.

Writes only data/apartments/the-nine-at-west-campus.json (or --out PATH). The generic neighbourhood entry supplies the
footprint, frame, levels and the lobby face; this script replaces its palette, window module and wall rule.

From the site photographs (the south-east facade, five storeys; numbers are pixel ratios):
  * the wall is a rhythm of wide bright-red blocks and narrower blue-tile patchwork runs, not one cream wall: three
    red blocks, two blue runs and a grey end block across the visible facade; roof parapets are white.
  * a red block is about 2.5 storeys' width... windows on the red are small and paired (about 1.15 x 1.55 m on a
    3.6 m bay, 0.38 of the storey high), blue runs carry glazed balcony doors and a teal slab edge per storey.
  * roof: white membrane with rows of condensers along the parapet (not drawn here).
INFERRED: all faces not in the photographs wear the same rule; the grey end block, the roof condenser rows and the
balcony niches in the blue runs are NOT drawn yet. The wall rule is vertical stripes of 2 red bays then 2 blue bays (three blues).
"""
import copy, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/apartments/the-nine-at-west-campus.json'
if '--out' in sys.argv: OUT = Path(sys.argv[sys.argv.index('--out') + 1])
ID = '5087a362-0908-4863-a94b-6d7cf6e87d92'

# ---- taste values -------------------------------------------------------------------------------------------
PARAMS = dict(
    bay=3.6,
    window=dict(w=1.15, h=1.55, sill=0.95),
    stripes=['red', 'red', 'blueMid', 'blueLight', 'red', 'red', 'blueDark', 'blueMid'],   # per bay along a wall, repeating (2 red : 2 blue runs, as in the photographs)
    palette={'red': '#b4382d', 'blueLight': '#9cc4dc', 'blueMid': '#4f8fbd', 'blueDark': '#2f6f8f',
             'grey': '#8a8e98', 'trim': '#ece9e2', 'roof': '#e3e4dc', 'stone': '#a3907a', 'glass': '#2a3a44',
             'frame': '#dcdcd4', 'balc': '#a9b8c0', 'rail': '#40484c', 'metal': '#596369'},
    parapet=0.45,
)
# --------------------------------------------------------------------------------------------------------------


def main():
    old = next(b for b in json.loads((ROOT / 'data/neighborhood_apartments.json').read_text())['buildings'] if b['id'] == ID)
    P = PARAMS
    d = {k: copy.deepcopy(old[k]) for k in ('id', 'name', 'footprint', 'frame', 'levels', 'category', 'aliases', 'preserveRoof', 'preserveRoofscape', 'balcony', 'deck')}
    d['address'] = '2518 Leon Street, Austin, TX'
    d['sources'] = {
        'MAP': {'type': 'map', 'source': 'Existing snapshot footprint and frame; level heights of the generic entry', 'confidence': 'high', 'supports': 'Plan, frame, 5 storeys (17.0 m)'},
        'PHOTO': {'type': 'site photograph', 'confidence': 'high', 'supports': 'Wall colours (red blocks, blue tile runs, white parapet, grey end block) and the window family on the south-east facade; private source join'},
        'INFER': {'type': 'inference', 'derivedFrom': ['MAP', 'PHOTO'], 'confidence': 'low', 'supports': 'Every other facade, the exact order of red and blue runs, window positions, ground floor'}}
    d['colours'] = {k: {'hex': v, '_src': 'site photograph: material colour estimated, lighting removed'} for k, v in P['palette'].items()}
    d['colours']['wall'] = d['colours']['red']; d['colours']['accent'] = d['colours']['blueMid']
    d['skins'] = {k: {'kind': 'flat', 'field': k} for k in P['palette']}
    win = {'w': P['window']['w'], 'h': P['window']['h'], 'sill': P['window']['sill'], 'frame': {'w': 0.07, 'tone': 'frame'}}
    d['skins']['mosaic'] = {'kind': 'bays', 'field': 'red', 'fields': P['stripes'], 'windowRule': 'all', 'bay': P['bay'], 'window': win, 'glass': 'glass', 'frame': 'frame', 'reveal': 0.16,
                            '_src': 'PHOTO: red blocks and blue tile runs; stripe order and window positions inferred'}
    d['skins']['base'] = {'kind': 'bays', 'field': 'stone', 'windowRule': 'all', 'bay': P['bay'], 'window': {'w': 1.5, 'h': 1.9, 'sill': 0.6}, 'glass': 'glass', 'frame': 'frame', 'reveal': 0.16}
    d['skins']['lobby'] = copy.deepcopy(old['skins']['lobby']); d['skins']['lobby']['fasciaTone'] = 'stone'
    z = d['levels']['floors'][-1]
    top = z - 0.34
    blk = copy.deepcopy(old['blocks'][0])
    blk['bands'] = [{'z0': 0, 'z1': 3.8, 'skin': 'base'}, {'z0': 3.8, 'z1': top, 'skin': 'mosaic'}, {'z0': top, 'z1': z, 'skin': 'trim'}]
    blk['roofTone'] = 'roof'; blk['parapet'] = P['parapet']; blk['parapetTone'] = 'trim'
    face = copy.deepcopy(old['blocks'][0]['faces']['83'])
    face['bands'] = [{'z0': 0, 'z1': 3.8, 'skin': 'lobby'}, dict(face['bands'][1], skin='mosaic', z1=top), {'z0': top, 'z1': z, 'skin': 'trim'}]
    blk['faces'] = {'83': face}
    d['blocks'] = [blk]
    d['_open'] = ['Only one facade is photographed; the red / blue order along it, window positions and the ground floor are inferred.',
                  'The grey end block, balcony niches in the blue runs and the roof condenser rows are not drawn.',
                  'Height 17 m (five storeys) comes from the generic entry and the storey count in the photographs; the 2021 scan reads 17.4 to 21.7 m (sloping site).']
    OUT.write_text(json.dumps(d, separators=(',', ':'), ensure_ascii=False))
    print('wrote', OUT)


if __name__ == '__main__': main()
