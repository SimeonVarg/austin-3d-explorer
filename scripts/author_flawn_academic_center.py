#!/usr/bin/env python3
"""Peter T. Flawn Academic Center (FAC): the library block of the West Mall, from a site photograph of its north face.

Writes only data/apartments/peter-t-flawn-academic-center.json (or --out PATH). The campus entry of data/campus_buildings.json
supplies the footprint and frame; this recipe supersedes it (an own file replaces a collection entry by id).

What the site photograph shows (every number is a ratio of pixels on one wall):
  * the north face is a plain limestone wall with SEVEN tall pierced lattice panels at an even pitch (face 64.2 m, so 9.2 m
    bays), each panel 0.37 of a bay wide and 2.6 times as tall as wide; none of the small ordinary window grid the old
    hand model drew (1.1 x 3.5 m windows every 2.8 m).
  * above the stone: a continuous glazed clerestory band with dark mullions, then a thin white roof slab, then a flat
    white membrane roof with a lighter penthouse box set back from the north edge.
  * the west wing is a low eight-sided volume with a white flat roof, far lower than the main wall.
Heights: the 2021 laser scan reads 19.2 m over 64 % of the footprint and 22.5 m over 36 % (flagged 'skewed': the site slopes);
19.2 m is used for the main roof and 22.5 m for the penthouse. The old model stood at 13.2 m.
INFERRED: the south, east and west faces wear the same rule, the ground floor under the north panels, the wing height
(5.5 m, from its roof's position against the wall), the penthouse footprint.
"""
import copy, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/apartments/peter-t-flawn-academic-center.json'
if '--out' in sys.argv: OUT = Path(sys.argv[sys.argv.index('--out') + 1])
ID = '1c11a66a-7138-402b-a5f9-8e0c23551162'

# ---- taste values -------------------------------------------------------------------------------------------
PARAMS = dict(
    roof=19.2, penthouse=22.5, wing=5.5,          # metres (scan; scan; inferred)
    clerestory=(16.0, 18.4), slab=(18.4, 19.2),   # glazed band and white roof slab
    bay=9.2, panel=dict(w=3.4, h=8.8, sill=0.2), panel_floor=5.0,  # lattice panel: 0.37 of the bay, 2.6 x as tall as wide
    colours={'stone': '#d3c9b4', 'stoneDark': '#c4baa4', 'lattice': '#5e5958', 'clerestory': '#716560', 'slab': '#d8d3c8',
             'roofWhite': '#e9efee', 'pent': '#cfc5b3', 'frame': '#8e8a7e', 'glassDark': '#3d4a4d', 'rail': '#a9a59a'},
    pent_plan=[43.0, 71.0, 14.0, 52.0],           # penthouse box, u0 u1 v0 v1 in the block's own frame (u from 26.7)
)
# --------------------------------------------------------------------------------------------------------------


def main():
    old = next(b for b in json.loads((ROOT / 'data/campus_buildings.json').read_text())['buildings'] if b['id'] == ID)
    P = PARAMS
    d = {k: copy.deepcopy(old[k]) for k in ('name', 'id', 'footprint', 'frame')}
    d['code'] = old.get('code')
    d['address'] = '2304 Whitis Avenue, Austin, TX'
    d['sources'] = {
        'MAP': {'type': 'map', 'source': 'Existing snapshot footprint and frame (campus_buildings.json)', 'confidence': 'high', 'supports': 'Plan: a 64.2 m square main block and a lower eight-sided west wing'},
        'SCAN': {'type': 'survey/LiDAR', 'source': 'StratMap 2021 laser scan, data/lidar_heights.json', 'confidence': 'medium', 'supports': 'Roof 19.2 m over 64 % of the footprint, 22.5 m over 36 %; flagged skewed (sloping site)'},
        'PHOTO': {'type': 'site photograph', 'confidence': 'high', 'supports': 'North face: seven lattice panels, limestone wall, clerestory band, roof slab, penthouse box, white roof, octagonal low wing'},
        'REF': {'type': 'reference photographs', 'source': 'architect-era and public photographs of the south entrance', 'confidence': 'medium', 'supports': 'Glazed ground-floor colonnade flanked by full-height pierced limestone screens on the south face'},
        'INFER': {'type': 'inference', 'derivedFrom': ['MAP', 'SCAN', 'PHOTO'], 'confidence': 'low', 'supports': 'South, east and west faces, ground floor under the north panels, wing height, penthouse plan'}}
    z_roof = P['roof']; pc = P['panel']
    d['levels'] = {'floors': [0, P['panel_floor'], z_roof, P['penthouse']], 'roof': P['penthouse'], '_src': 'scan roof 19.2 m and penthouse 22.5 m; one tall storey from 5.0 m on purpose: the pierced panels are 8.8 m tall (sill 0.2 m above the 5.0 m line) and run across the old floor lines'}
    d['colours'] = {k: {'hex': v, '_src': 'site photograph: material colour estimated, lighting removed'} for k, v in P['colours'].items()}
    d['colours']['glass'] = ['#4b5b60', '#566067', '#e0c88a']
    d['skins'] = {k: {'kind': 'flat', 'field': k} for k in P['colours']}
    d['skins']['wall'] = {'kind': 'flat', 'field': 'stone'}
    win = {'w': pc['w'], 'h': pc['h'], 'sill': pc['sill']}
    d['colours']['latticeGlass'] = ['#5e5958', '#6a6462', '#2a2827']
    d['skins']['clerestory'] = {'kind': 'storefront', 'mullion': 2.3, 'mullionW': 0.16, 'fascia': 0.05, 'plinth': 0.05, 'transom': 0.9, 'frame': 'frame', 'glass': 'clerestoryGlass', 'reveal': 0.12,
                                'fasciaTone': 'slab', 'nightOccupancy': 0.35, '_src': 'PHOTO: continuous glazed band with dark mullions under the roof slab'}
    d['colours']['clerestoryGlass'] = ['#6f625c', '#716560', '#e0c88a']
    d['skins']['colonnade'] = {'kind': 'storefront', 'mullion': 3.0, 'mullionW': 0.18, 'fascia': 0.5, 'plinth': 0.2, 'transom': 0.75, 'frame': 'frame', 'glass': 'glass', 'reveal': 0.5, 'fasciaTone': 'stone',
                               '_src': 'REF: recessed glazed ground-floor colonnade on the south face'}
    d['skins']['pent'] = {'kind': 'bays', 'field': 'pent', 'windowRule': 'all', 'bay': 5.6, 'window': {'w': 2.2, 'h': 1.3, 'sill': 1.2}, 'glass': 'clerestoryGlass', 'frame': 'frame', 'reveal': 0.1}
    z0, z1 = P['clerestory']; s0, s1 = P['slab']
    L = 64.2   # every face of the square main block
    nb = round(L / P['bay']); mod = L / nb
    # the pierced panels are explicit openings with no 'lit': they are lattice, not rooms, and must not glow at night
    panels = [{'s0': round((i + 0.5) * mod - pc['w'] / 2, 3), 's1': round((i + 0.5) * mod + pc['w'] / 2, 3),
               'z0': P['panel_floor'] + pc['sill'], 'z1': P['panel_floor'] + pc['sill'] + pc['h'], 'd': 0.18, 'glass': 'latticeGlass', 'lit': False, 'tone': 'stoneDark'} for i in range(nb)]
    def face(base):
        return {'bands': [{'z0': 0.0, 'z1': P['panel_floor'], 'skin': base}, {'z0': P['panel_floor'], 'z1': z0, 'skin': 'wall', 'openings': copy.deepcopy(panels)},
                          {'z0': z0, 'z1': z1, 'skin': 'clerestory'}, {'z0': s0, 'z1': s1, 'skin': 'slab'}]}
    main = {'id': 'main', 'plan': [26.679, 90.906, 0.0, 64.2], 'z0': 0.0, 'z1': z_roof, 'roofTone': 'roofWhite', 'parapet': 0.12, 'parapetTone': 'slab',
            'bands': face('wall')['bands'],
            'faces': {'v1': face('wall'), 'v0': face('colonnade'), 'u1': face('wall'), 'u0': face('wall')},
            '_src': 'MAP square block; faces PHOTO north (v1), REF south (v0), INFERRED east and west'}
    pu = P['pent_plan']
    pent = {'id': 'penthouse', 'plan': list(pu),
            'z0': z_roof, 'z1': P['penthouse'], 'roofTone': 'roofWhite', 'parapet': 0.1, 'parapetTone': 'slab', 'bands': [{'z0': z_roof, 'z1': P['penthouse'], 'skin': 'pent'}],
            '_src': 'PHOTO: tan box with a window grid set back from the north edge, about 45 % of the face long; plan and depth INFERRED'}
    wing_ring = [[27.0, 54.462], [24.21, 54.461], [17.392, 61.363], [6.818, 61.354], [0.0, 54.243], [0.007, 44.231], [6.806, 37.115], [17.216, 37.132], [24.348, 44.505], [27.0, 44.504]]
    wing = {'id': 'wing', 'plan': {'ring': wing_ring, 'holes': []}, 'z0': 0.0, 'z1': P['wing'], 'roofTone': 'roofWhite', 'parapet': 0.5, 'parapetTone': 'rail',
            'bands': [{'z0': 0.0, 'z1': P['wing'], 'skin': 'wall'}], 'faces': {'*': {'bands': [{'z0': 0.0, 'z1': P['wing'], 'skin': 'wall'}]}},
            '_src': 'MAP eight-sided west wing; PHOTO low white roof with a rail; height 5.5 m INFERRED from where its roof meets the wall'}
    d['blocks'] = [main, pent, wing]
    d['preserveRoof'] = False; d['replaceFrontage'] = False
    d['open'] = ['South, east and west faces and the ground floor under the north panels are inferred.',
                 'Penthouse plan and the 5.5 m wing height are inferred; the roof terrace vaults of the 1964 photographs are not drawn.',
                 'The roof slab overhang is drawn as a flush band, not a projecting slab.']
    OUT.write_text(json.dumps(d, separators=(',', ':'), ensure_ascii=False))
    print('wrote', OUT)


if __name__ == '__main__': main()
