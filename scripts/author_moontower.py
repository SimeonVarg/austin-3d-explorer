#!/usr/bin/env python3
"""Rebuild Moontower's shape and its street (east) walls from MEASURED numbers. Run from the repo root:

    python3 scripts/author_moontower.py          # rewrites data/apartments/moontower.json; safe to run again

Why this script exists (2026-10-09). Five builder rounds painted the east wall with a RANDOM white/charcoal
pattern and a flat front, and an audit found 35 of 42 rows different from the owner's photographs. Nobody had
measured the wall. Two sources settle it, and every number below comes from one of them:

  SCAN   the 2021 laser scan, read cell by cell in the building's own grid (0.5 m cells):
         - the tower's wings are 0.25..19.15 m (north) and 27.75..46.75 m (south); the notch is between them;
         - a LOW BOX stands 3.6 m in front of the tower face on both wings (top 16.5 m north, 17.5 m south);
         - the notch terrace is at 8 m; the pool deck on the south-east roof is at 52.0 m; the roof beam about 57.
  PHOTO  the owner's photographs, flattened wall by wall into straight-on drawings (a private tool; no camera
         fit, so it cannot inherit a wrong model). The drawings show the RULE of this wall:
         - floors are 2.97 m apart (15 flats' floors from 7.4 m to the 52.0 m deck);
         - the white panels are blocks THREE floors tall; charcoal columns between them hold one window a floor;
         - each tier of three floors is the same layout moved 1.07 m north (layout A, then B, then A, then B);
         - a dark glass strip four panes wide runs up the OUTER end of each wing;
         - the low boxes have their own wide white blocks: two window rows (south), three (north);
         - the south wing's glass base is one storey taller than the north wing's (10.37 m against 7.4 m);
         - the tall glass corner box is on the north wing at the NOTCH corner (the draft had it at the far end);
         - the MOONTOWER letters stand on TOP of a white beam 2.2 m deep, on a wide post, a middle post and an end post.
  INFERRED  the west, south and north walls (no photograph): the same tier rule with a plain repeating layout.
            The hidden corner of the north wing's wall behind the glass box. Row 1 of each tower wall behind the box.

Every taste or measured value is in the tables at the top. Lengths in the tables are TRUE metres along the wall;
`K` turns them into the generator's frame (it uses 110540 m per degree of latitude, so its north-south metre is
0.28% short).
"""
import json, os

PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'apartments', 'moontower.json')
K = 0.9972                      # true metres along u -> the generator's frame

# ---- plan (true metres; u runs north to south, v west to east) ------------------------------------------- SCAN
N0, NC = 0.25, 19.15            # north wing: its north wall, its notch corner
SC, S1 = 27.75, 46.75           # south wing: its notch corner, its south wall
V_TOWER = 33.81                 # the tower's east face (the footprint edge; the scan reads 33.5)
V_FRONT = 37.2                  # the front of the low boxes and of the glass base (scan 37.25)
V_CENTRE = 27.0                 # the recessed centre wall

# ---- heights ---------------------------------------------------------------------------------------- SCAN + PHOTO
BASE_TOP = 7.4                  # top of the two glazed storeys (the notch terrace)
FLOOR = (52.0 - 7.4) / 15       # 2.973 m
FLOORS = [round(BASE_TOP + FLOOR * i, 2) for i in range(16)]        # 7.4 ... 52.0
DECK = FLOORS[15]               # 52.0: the pool deck and the top slab line
TOWER_Z0 = FLOORS[3]            # 16.32: first tower floor line above the boxes
ROOF = 53.3                     # wall top (deck + 1.3 m guard); the roof of the rest
S_BASE_TOP = FLOORS[1]          # 10.37: the south wing's glass base is one storey taller
N_BOX_TOP, S_BOX_TOP = 17.8, 18.1      # PHOTO (flattened, parapet top); the scan's cells read 16.5 to 17.5 there
BEAM = (55.4, 57.6)             # the white roof beam on the south wing
GLASS_BOX = (FLOORS[12], 55.4)  # the corner glass box: three floors and past the roof
TIERS = [(FLOORS[3], FLOORS[6], 'B'), (FLOORS[6], FLOORS[9], 'A'), (FLOORS[9], FLOORS[12], 'B'), (FLOORS[12], FLOORS[15], 'A')]
SHIFT = 1.07                    # layout B = layout A moved this far north

# ---- windows ---------------------------------------------------------------------------------------------- PHOTO
WIN = {'h': 1.7, 'sill': 0.92, 'jamb': 0.06, 'd': 0.12}            # head 0.35 m under the next floor line
STRIP = {'S': 4.09, 'N': 3.66}  # glass strip width at the south wing's south end and the north wing's north end
STRIP_FRAME = 0.34              # the dark frame beside it

# ---- layouts: (from, to, kind) along the wall, metres from the END NAMED; kind w = window column,
#      n = narrow window column, p = a pair of windows. Everything not listed is white panel. --------------- PHOTO
# South wing tower wall, layout A, from its SOUTH corner (photo flattened at 44.06 px per metre).
S_TOWER_A = [(5.45, 7.38, 'w'), (9.69, 11.57, 'w'), (15.09, 16.00, 'n'), (17.02, 18.95, 'w')]
# North wing tower wall, layout A, from its NORTH corner.
N_TOWER_A = [(5.79, 6.62, 'n'), (8.17, 9.83, 'w'), (12.69, 14.36, 'w'), (17.09, 18.76, 'w')]     # scale solved with the photo's camera: 42 px per metre
# Low boxes (they do not shift: each is one tier). South box from its south end; north box from its SOUTH end.
S_BOX = [(0.47, 1.41, 'n'), (5.77, 7.65, 'w'), (10.00, 11.88, 'w'), (15.41, 16.38, 'n')]
N_BOX = [(1.16, 1.95, 'n'), (5.27, 6.98, 'w'), (9.57, 12.13, 'p'), (15.12, 16.71, 'w')]      # scale solved with the photo's camera: 82 px per metre
# Notch side walls (short; tiers seen in the photographs, positions approximate), from the street corner.
NOTCH_A = [(1.0, 2.9, 'w')]
# INFERRED walls: one repeating unit, from the wall's start.
UNIT = [(2.3, 4.2, 'w'), (7.6, 8.5, 'n'), (9.5, 11.4, 'w')]; UNIT_LEN = 11.4

# ---- the roof beam and its posts, metres from the south corner ---------------------------------------------- PHOTO
POSTS = [(0.0, 6.62), (8.48, 10.64), (18.7, 19.0)]
SIGN = {'from_south': 0.6, 'length': 12.3, 'height': 1.25}
GLASS_BAND = {'bay': 2.1}
ENTRANCE = (7.0, 13.0)           # the door band under the south wing, metres from the south corner (approximate)


def col_bands(z0, z1, width, kind, floors):
    """A charcoal column `width` wide with one window (or a pair) on every floor line in [z0, z1)."""
    ops = []
    for f in floors:
        if f < z0 - 1e-6 or f >= z1 - 1e-6: continue
        a, b = f + WIN['sill'], min(f + WIN['sill'] + WIN['h'], z1 - 0.1)
        spans = [(WIN['jamb'], width - WIN['jamb'])] if kind != 'p' else [(WIN['jamb'], width / 2 - 0.04), (width / 2 + 0.04, width - WIN['jamb'])]
        for s0, s1 in spans: ops.append({'s0': round(s0, 3), 's1': round(s1, 3), 'z0': round(a, 2), 'z1': round(b, 2), 'd': WIN['d'], 'glass': 'glass', 'tone': 'frame'})
    return [{'z0': z0, 'z1': z1, 'skin': 'colField', 'openings': ops}]


def shifted(layout, length, shift):
    """Layout moved `shift` along the wall and cut at the wall's ends; a cut column under 0.8 m is dropped."""
    out = []
    for a, b, k in layout:
        a, b = max(0.0, a + shift), min(length, b + shift)
        if b - a >= 0.8: out.append((a, b, 'n' if b - a < 1.3 else k))
    return out


def repeat(length, start=0.0):
    out, x = [], start
    while x < length:
        out += [(x + a, x + b, k) for a, b, k in UNIT if x + b <= length - 0.4]
        x += UNIT_LEN
    return out


def main():
    d = json.load(open(PATH))
    n0, nc, sc, s1 = [round(x * K, 2) for x in (N0, NC, SC, S1)]
    E, EPS = V_TOWER, 0.05
    old = {b['id']: b for b in d['blocks']}

    d['levels']['floors'] = [0, 4.5] + FLOORS                 # 4.5: the glass band over the ground floor starts on its own line
    d['levels'].update({'bandBreak': TOWER_Z0, 'roof': ROOF, 'crown': BEAM[1],
                        '_src': 'scripts/author_moontower.py: floors 2.973 m apart from the 7.4 m terrace to the 52.0 m pool deck (laser scan), counted and scaled on the flattened photographs.'})
    d['skins']['colField'] = {'kind': 'flat', 'field': 'charcoal', '_src': 'the charcoal column between two white blocks; its windows are openings (scripts/author_moontower.py)'}
    d['skins']['glassStrip'] = {'kind': 'bays', 'field': 'storeFrame', 'bay': 1.02, 'window': {'w': 0.95, 'h': 2.75, 'sill': 0.11}, 'glass': 'storeGlass', 'frame': 'storeFrame', 'reveal': 0.03,
                                '_src': 'PHOTO: the dark glass strip four panes wide at the outer end of each wing'}
    d['skins']['glassBand'] = {'kind': 'storefront', 'mullion': GLASS_BAND['bay'], 'mullionW': 0.09, 'horizontalPitch': 9, 'fascia': 0.22, 'fasciaTone': 'storeFrame', 'plinth': 0.12,
                               'glass': 'storeGlass', 'frame': 'storeFrame', 'reveal': 0.06,
                               '_src': 'PHOTO: the glazed levels over the ground floor are ONE row of tall panes each, about 2.1 m apart (horizontalPitch above the band height = one pane)'}
    d['skins']['centreWall']['field'] = 'charcoal'                    # PHOTO: the recessed wall is the columns' charcoal, in shade; not a blue-black
    for dead in ('panelPale', 'banded', 'crownPier', 'darkWindows', 'lowDark', 'lowDarkSingle', 'stripDark', 'topCorner', 'lowCorner', 'cornerGlass', 'northRows', 'baseBlank'):
        d['skins'].pop(dead, None)

    ring = [[n0, 0], [s1, 0], [s1, E], [sc, E], [sc, V_CENTRE], [nc, V_CENTRE], [nc, E], [n0, E]]
    # walls by edge index: 0 west, 1 south, 2 south wing east, 3 notch (south side), 4 centre, 5 notch (north side), 6 north wing east, 7 north

    def east_region(a, b): return [round(min(a, b), 3), round(max(a, b), 3), E - EPS, E + EPS]
    wing = (S1 - SC)                                         # true length of a wing wall (both 19.0 / 18.9)
    tiers = []
    # ONE BLOCK PER TIER. An override replaces a wall's bands for the block's whole height, and the columns of
    # layout A and layout B overlap, so the tiers cannot share a block.
    for ti, (z0, z1, lay) in enumerate(TIERS):
        ov = []
        sh = SHIFT if lay == 'B' else 0.0
        # south wing: measured from the south corner; "north" is toward larger s
        for a, b, k in shifted(S_TOWER_A, wing, sh):
            ov.append({'region': east_region((S1 - a) * K, max((S1 - b) * K, sc + 0.02)), 'bands': col_bands(z0, z1, round((b - a) * K, 3), k, FLOORS)})
        # north wing: measured from the north corner; "north" is toward smaller s
        nl = shifted(N_TOWER_A, NC - N0, -sh)
        for a, b, k in nl:
            ov.append({'region': east_region((N0 + a) * K, min((N0 + b) * K, nc - 0.02)), 'bands': col_bands(z0, z1, round((b - a) * K, 3), k, FLOORS)})
        # notch side walls (u fixed, v from the street corner inward)
        for a, b, k in shifted(NOTCH_A, E - V_CENTRE, sh):
            for u in (sc, nc):
                ov.append({'region': [u - EPS, u + EPS, round(E - b, 3), round(min(E - a, E - 0.02), 3)], 'bands': col_bands(z0, z1, round(b - a, 3), k, FLOORS)})
        # INFERRED walls: west (v = 0), south (u = s1), north (u = n0)
        for a, b, k in shifted(repeat(S1 - N0, 1.5), S1 - N0, sh):
            ov.append({'region': [round((N0 + a) * K + 0.02, 3), round((N0 + b) * K - 0.02, 3), -EPS, EPS], 'bands': col_bands(z0, z1, round((b - a) * K - 0.04, 3), k, FLOORS)})
        for u in (s1, n0):
            for a, b, k in shifted(repeat(E - STRIP['S'] - STRIP_FRAME, 1.5), E - STRIP['S'] - STRIP_FRAME, sh):
                ov.append({'region': [u - EPS, u + EPS, round(a + 0.02, 3), round(b - 0.02, 3)], 'bands': col_bands(z0, z1, round(b - a - 0.04, 3), k, FLOORS)})
        # the glass strips at the outer ends (they turn the corner on to the end walls: INFERRED there)
        strip = [{'z0': z0, 'z1': z1, 'skin': 'glassStrip'}]; bar = [{'z0': z0, 'z1': z1, 'skin': 'storeBar'}]
        ov += [{'region': east_region((S1 - STRIP['S']) * K, s1 + 1), 'bands': strip}, {'region': east_region((S1 - STRIP['S'] - STRIP_FRAME) * K, (S1 - STRIP['S']) * K), 'bands': bar},
               {'region': east_region(n0 - 1, (N0 + STRIP['N']) * K), 'bands': strip}, {'region': east_region((N0 + STRIP['N']) * K, (N0 + STRIP['N'] + STRIP_FRAME) * K), 'bands': bar},
               {'region': [s1 - EPS, s1 + EPS, round(E - STRIP['S'], 3), E - 0.06], 'bands': strip}, {'region': [n0 - EPS, n0 + EPS, round(E - STRIP['N'], 3), E - 0.06], 'bands': strip}]
        w = [{'z0': z0, 'z1': z1, 'skin': 'whiteBlank'}]
        c = [{'z0': z0, 'z1': z1, 'skin': 'centreWall'}] if z1 <= FLOORS[14] else [{'z0': z0, 'z1': FLOORS[14], 'skin': 'centreWall'}, {'z0': FLOORS[14], 'z1': z1, 'skin': 'centreGlass'}]
        tiers.append({'id': f'tower-tier-{ti + 1}', 'plan': ring, 'z0': z0, 'z1': z1, 'bands': w, 'faces': {'4': {'bands': c}, '*': {'bands': w}}, 'overrides': ov, 'cap': False,
                      '_src': f'layout {lay}: three floors of the tower. PHOTO (flattened): east walls and notch sides. INFERRED: west, south and north walls.'})

    top = [{'z0': DECK, 'z1': ROOF, 'skin': 'whiteBlank'}]
    tower = old['tower']
    tower.update({'plan': ring, 'z0': DECK, 'z1': ROOF, 'bands': top, 'overrides': [],
                  'faces': {'4': {'bands': [{'z0': DECK, 'z1': ROOF, 'skin': 'storeBar'}]}, '*': {'bands': top}},
                  '_src': 'the wall above the top floor line (the pool deck guard on the south-east; the roof edge elsewhere), with the roof and what stands on it.'})
    low = old['low-wings']
    low_white = [{'z0': BASE_TOP, 'z1': TOWER_Z0, 'skin': 'whiteBlank'}]
    low_ov = []
    for a, b, k in repeat(S1 - N0, 1.5):
        low_ov.append({'region': [round((N0 + a) * K + 0.02, 3), round((N0 + b) * K - 0.02, 3), -EPS, EPS], 'bands': col_bands(BASE_TOP, TOWER_Z0, round((b - a) * K - 0.04, 3), k, FLOORS)})
    for u in (s1, n0):
        for a, b, k in repeat(E - 0.5, 1.5):
            low_ov.append({'region': [u - EPS, u + EPS, round(a + 0.02, 3), round(b - 0.02, 3)], 'bands': col_bands(BASE_TOP, TOWER_Z0, round(b - a - 0.04, 3), k, FLOORS)})
    low.update({'plan': ring, 'z0': BASE_TOP, 'z1': TOWER_Z0, 'bands': low_white, 'overrides': low_ov, 'parapet': 0,
                'faces': {'4': {'bands': [{'z0': BASE_TOP, 'z1': TOWER_Z0, 'skin': 'centreWall'}]}, '*': {'bands': low_white}},
                '_src': 'the three floors behind the low boxes. Its east walls are hidden by the boxes. West, south and north INFERRED.'})

    def box(bid, u0, u1, z0, z1, layout, from_south, src):
        length = (u1 - u0) / K; o = []
        for a, b, k in layout:
            ua, ub = ((u1 - b * K, u1 - a * K) if from_south else (u0 + a * K, u0 + b * K))
            o.append({'region': [round(ua, 3), round(ub, 3), V_FRONT - EPS, V_FRONT + EPS], 'bands': col_bands(z0, z1, round((b - a) * K, 3), k, FLOORS)})
        w = [{'z0': z0, 'z1': z1, 'skin': 'whiteBlank'}]
        return {'id': bid, 'plan': [u0, u1, E, V_FRONT], 'z0': z0, 'z1': z1, 'bands': w, 'faces': {'v0': None}, 'overrides': o, 'roofTone': 'roofM', '_src': src}
    box_n = box('box-north', n0, nc, BASE_TOP, N_BOX_TOP, N_BOX, True, 'SCAN: a box 3.6 m in front of the tower, top 16.5 to 17 m. PHOTO: three window rows, four charcoal columns (positions approximate, oblique photograph).')
    box_s = box('box-south', sc, s1, S_BASE_TOP, S_BOX_TOP, S_BOX, True, 'SCAN: a box 3.6 m in front of the tower, top 17.5 m. PHOTO (flattened): two window rows on a glass base one storey taller than the north one.')
    glass_up = [{'z0': BASE_TOP, 'z1': S_BASE_TOP, 'skin': 'glassBand'}]
    base_s = {'id': 'base-south-upper', 'plan': [sc, s1, E, V_FRONT], 'z0': BASE_TOP, 'z1': S_BASE_TOP, 'bands': glass_up, 'faces': {'v0': None}, 'roofTone': 'roofM',
              '_src': 'PHOTO: the south wing has a third glazed level under its white box (the main entrance side).'}

    base = old['base']; base['plan'] = [0, s1, 0, V_FRONT]
    street = [{'z0': 0.0, 'z1': 3.7, 'skin': 'store'}, {'z0': 3.7, 'z1': 4.5, 'skin': 'storeBar'}, {'z0': 4.5, 'z1': BASE_TOP, 'skin': 'glassBand'}]
    base['faces'] = {'v1': {'bands': street}}
    # the street doors. PHOTO: the main entrance, with the small white MOONTOWER letters over it, is under the SOUTH wing;
    # the notch has a dark shop portal. (The draft had the entrance in the notch.) Positions along the wing approximate.
    door = next(o for o in base['overrides'] if any('signs' in b for b in o['bands']))
    e0, e1 = [round((S1 - x) * K, 2) for x in ENTRANCE]
    door['region'] = [min(e0, e1), max(e0, e1), round(V_FRONT - 0.1, 2), round(V_FRONT + 0.1, 2)]
    for b in door['bands']:
        if b['z0'] >= 4.4: b.update({'skin': 'glassBand'})
    portal = [{'z0': 0.0, 'z1': 4.5, 'skin': 'storeBar', 'openings': [{'s0': round((sc - nc) / 2 - 1.0, 2), 's1': round((sc - nc) / 2 + 1.0, 2), 'z0': 0.1, 'z1': 2.6, 'd': 0.4, 'glass': 'storeGlass', 'tone': 'storeFrame'}]},
              {'z0': 4.5, 'z1': BASE_TOP, 'skin': 'glassBand'}]
    base['overrides'] = [door, {'region': [nc, sc, round(V_FRONT - 0.1, 2), round(V_FRONT + 0.1, 2)], 'bands': portal}]
    for it in base.get('roofItems', []):
        if it.get('tone') == 'glass': it['plan'] = [nc, sc, V_FRONT - 0.12, V_FRONT]        # the terrace rail: only across the notch

    post = lambda i, a, b: {'id': f'crown-post-{i}', 'plan': [round((S1 - b) * K, 2), round((S1 - a) * K, 2), E - 0.81, E], 'z0': ROOF, 'z1': BEAM[0],
                            'bands': [{'z0': ROOF, 'z1': BEAM[0], 'skin': 'crownBeam'}], 'roofTone': 'coping', '_src': 'PHOTO (flattened): a post under the roof beam.'}
    dot = round(SIGN['height'] / 7, 3); gap = round((SIGN['length'] - 9 * 5 * dot) / 8, 3)
    beam_len = (S1 - SC) * K
    beam = {'id': 'crown-beam', 'plan': [sc, s1, E - 0.81, E], 'z0': BEAM[0], 'z1': BEAM[1], 'bands': [{'z0': BEAM[0], 'z1': BEAM[1], 'skin': 'crownBeam'}], 'roofTone': 'coping',
            'faces': {'v1': {'bands': [{'z0': BEAM[0], 'z1': BEAM[1], 'skin': 'crownBeam',
                                        'signs': [{'text': 'MOONTOWER', 's0': round(SIGN['from_south'] * K, 2), 'z0': BEAM[1], 'dot': dot, 'gap': gap, 'tone': 'sign'}]}]}},
            '_beam_len': round(beam_len, 2),
            '_src': 'PHOTO (flattened): a white beam 2.2 m deep along the south wing, the letters standing on top of it over its south 12.3 m. SCAN: 56 to 58 m.'}
    gbox = {'id': 'north-glass-top', 'plan': [round(nc - 4.0, 2), round(nc + 0.45, 2), 30.2, E + 0.45], 'z0': GLASS_BOX[0], 'z1': GLASS_BOX[1],
            'bands': [{'z0': GLASS_BOX[0], 'z1': GLASS_BOX[1], 'skin': 'glassStrip', 'floors': FLOORS[12:16]}], 'roofTone': 'frame',
            '_src': 'PHOTO: the tall glass box at the top of the north wing, on its NOTCH corner. Size approximate; back INFERRED.'}

    d['blocks'] = [base, base_s, low, box_n, box_s] + tiers + [tower, gbox, beam] + [post(i, a, b) for i, (a, b) in enumerate(POSTS)]
    d['_open'] = ['West, south and north walls are INFERRED (no photograph): the east rule with a plain repeating layout.',
                  'North box column positions are approximate (one oblique photograph).',
                  'The pool deck is 1.3 m lower than this file draws it (52.0 m against the 53.3 m roof): seen only from the air.',
                  'The small vent pairs on the white blocks are not drawn.']
    d['_review'] = 'Shape and east walls rebuilt 2026-10-09 by scripts/author_moontower.py from the laser scan and flattened photographs. Waits for the owner\'s look.'
    d['_decision'] = 'See scripts/author_moontower.py: every number is in its tables with its source.'
    open(PATH, 'w').write(json.dumps(d, separators=(',', ':'), ensure_ascii=False))       # compact, as scripts/compact_models.py keeps it
    print('wrote', PATH, '| blocks', len(d['blocks']), '| overrides a tier', len(tiers[0]['overrides']), '| floors', FLOORS[:4], '...', FLOORS[-1])


if __name__ == '__main__':
    main()
