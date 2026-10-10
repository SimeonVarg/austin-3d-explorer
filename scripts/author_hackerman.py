"""Author the south wall of the Norman Hackerman Building's east block (and its top), from the owner's photographs
and the 2021 laser scan.

What the old recipe had wrong, found 2026-10-09 by drawing it from the photographs' cameras and reading the scan
cell by cell (the frame is the recipe's own: u east along the long side, v north, z up, metres):

  * The south face of the east block stands at v = -4.5 (SCAN: from u = 46 eastward the roof, 28-31 m, starts at
    v = -4.5 and nothing is higher than 1 m at v = -5). The recipe put the arcade front at v = 3.5, eight metres
    inside, because the map outline (v = 0 is its south edge) leaves out the colonnade.
  * The colonnade is two storeys of EQUAL height, and the three brick storeys above it have the same pitch
    (PHOTO: a flat drawing of the wall gives 341 px for the upper colonnade storey and 335 px for the brick row
    pitch; the near-frontal photograph gives 420 and 407 px). The recipe had a low first storey (4.65 m) and a
    brick pitch of 5.05 m.
  * The windows come in PAIRS. Each window is a clear pane under a wider pale-blue hood box (a glazed
    clerestory light with a projecting soffit); pairs repeat every 7.9 m, and a pair is 2.6 m between its panes.
    The recipe had a grid of single windows at an even pitch and no hoods.
  * The roof of the east block between u = 45 and 127 stands 5 m higher than the recipe's 30.75 m at its north
    part (SCAN: 34-37 m for v >= 3.5), which is the louvred top storey seen in the photographs.

What this script does (run it once on the file from main; it removes its own pieces first, so it can be run again):
  1. moves the arcade (piers, fascia beams, floor, recessed wall) and the brick wall above it to the scan's south
     face, with equal storeys and the measured pair rhythm of windows and hoods;
  2. raises the east block's north part to the louvred top storey;
  3. sets the pale stone and the window and hood glass from the photographs.
Everything else in the file is left alone (west wing, entrance, north side, roof louvres, trees and walks).

Every number below is marked PHOTO (measured on an owner photograph), SCAN (the laser scan) or INFERRED.
"""
from pathlib import Path
import json
import math
from compact_models import compact

PATH = Path(__file__).resolve().parents[1] / 'data/apartments/norman-hackerman-building.json'

# ---- every taste or size choice is here (metres unless stated) ----
U_EAST_BLOCK = (45.2, 146.3)    # SCAN + old recipe: the east block runs from the entrance bay to the east end
SOUTH_V = -4.5                  # SCAN: south face of the east block (first return jumps from 0-1 m to 28 m between v=-5 and -4)
ARCADE_DEPTH = 5.5              # INFERRED: kept from the old recipe (3.5 -> 9.0); the photographs show a deep covered walk
SHIFT_V = SOUTH_V - 3.5         # everything that stood on the old arcade front moves by this much (-8.0)
P = 5.7                         # PHOTO: storey height = brick row pitch = colonnade storey. 5 storeys + a 1.2 m parapet reach the SCAN roof 29.7
COLONNADE_TOP = 2 * P           # PHOTO: the top fascia's upper edge, where the lowest brick window row sits (11.4 m)
BODY_TOP = 29.7                 # SCAN: 28-31 m along the south strip (rising east, as the ground falls), kept from the old recipe
FASCIA_H = 1.25                 # PHOTO: top fascia 92 px against a 413 px storey, 1.25 m
MID_BEAM_H = 0.57               # PHOTO: middle fascia 42 px against 413, 0.57 m
BEAM_DEPTH = 0.8                # INFERRED: kept from the old recipe
PIER_W, PIER_D = 1.1, 1.6       # PHOTO: front face 78 px against 413 px = 1.07 m. INFERRED: the depth
GRID = 3.95                     # PHOTO: upper piers 297, 290 px apart against a 566 px pair period (7.9 m / 2)
GRID_FIRST = 60.6               # PHOTO: a pier stands 0.3 m west of the first pair of windows
PAIR_PERIOD = 7.9               # PHOTO: window pairs 566 px apart in the near-frontal photograph, 465 px in the flat drawing of 335 px = 5.7 m
PAIR_FIRST = 60.9               # PHOTO: 7.6 m of plain brick east of the glass tower (flat drawing); the next pair is 7.9 m on
PAIR_SPACING = 2.6              # PHOTO: window centre to window centre, 190 px and 155 px against the two scales above
WIN_W, WIN_H = 1.5, 2.3         # PHOTO: clear pane 110 px x 155 px (near-frontal), 135 px tall in the flat drawing
HOOD_W, HOOD_H = 2.1, 1.3       # PHOTO: pale-blue panel 156 px wide in the near-frontal photograph, 125 px in the flat one; 75 px tall in the flat one
HOOD_LEFT_EXTRA = 0.55          # PHOTO: the hood stands out to the WEST of the pane by 41 px; its east edge is 0.08 m past the pane's
HOOD_RIGHT_EXTRA = 0.08
HOOD_GAP = 0.35                 # PHOTO: dark soffit between the pane's head and the hood panel (30 px)
HOOD_PROUD = 0.3                # INFERRED: how far the hood stands off the wall (the soffit is seen from below at about this depth)
FRAME_T = 0.07                  # INFERRED: metal frame round the hood panel
SILL_T = 0.07                   # PHOTO: thin dark sill under each pane
ROWS = 3                        # PHOTO: three brick storeys above the colonnade (counted in two photographs)
LAST_PAIR_U = 142.0             # INFERRED: the pattern continues to the east wing; no photograph shows beyond u = 110
PENTHOUSE = (45.2, 127.0, 3.5, 24.1)   # SCAN: u 45-127 is 34-37 m for v >= 3.5 (v < 3.5 stays at the brick roof, 29-31 m); the north edge is left at 24.1 (not photographed)
PENTHOUSE_TOP = 34.8            # SCAN: median of the first return over that area, 34 at the west end to 37 at the east (the ground falls east)
GLASS_BAY = (45.2, 50.6)        # old recipe (not changed in u); it now stands in front of the brick, as in the photographs
GLASS_BAY_DEPTH = 1.0           # PHOTO: projects about 1 m
GLASS_BAY_BOTTOM = COLONNADE_TOP + 0.4   # PHOTO: the tower starts just above the top fascia
COLOURS = {
    'stone': '#dad5c5', 'stoneLight': '#e0dccd',      # PHOTO: pier fronts #e4e0d5, fascia #e2e3e1 at dawn, 1.48 times the brick's brightness (the old pair gave 1.34)
    'hackHoodGlass': '#9dbddb',      # PHOTO: hood panels #a6c8e6 / #94b7d4 (they reflect the overcast sky)
    'hackWindow': '#9cbccf',         # PHOTO: panes #a2c6de / #bdd3db at dawn
    'hackFrame': '#5f656b',          # PHOTO: thin grey-blue metal round the hoods and under the panes
    'hackSoffit': '#2b2723',         # PHOTO: soffit under a hood #15120f..#514839
}
DECIMALS = 3
OPEN_D = 0.38                   # old recipe: how far a window pane sits behind the brick face

HOOD_TOPS = lambda z_sill: (z_sill + WIN_H + HOOD_GAP, z_sill + WIN_H + HOOD_GAP + HOOD_H)


def quad(a, b, c, d):
    return [list(map(lambda x: round(x, DECIMALS), p)) for p in (a, b, c, d)]


def push(mesh, q):
    n = len(mesh['vertices'])
    mesh['vertices'].extend(q)
    mesh['triangles'].extend([[n, n + 1, n + 2], [n, n + 2, n + 3]])


def box_quads(u0, u1, v0, v1, z0, z1):
    """Five outside faces of a box (not the back, which sits on the wall), as quads."""
    return {
        'front': [(u0, v0, z0), (u1, v0, z0), (u1, v0, z1), (u0, v0, z1)],
        'bottom': [(u0, v0, z0), (u1, v0, z0), (u1, v1, z0), (u0, v1, z0)],
        'top': [(u0, v0, z1), (u1, v0, z1), (u1, v1, z1), (u0, v1, z1)],
        'west': [(u0, v0, z0), (u0, v1, z0), (u0, v1, z1), (u0, v0, z1)],
        'east': [(u1, v0, z0), (u1, v1, z0), (u1, v1, z1), (u1, v0, z1)],
    }


def pair_centres():
    out, u = [], PAIR_FIRST
    while u <= LAST_PAIR_U:
        out.append(round(u, 3))
        u += PAIR_PERIOD
    return out


def pier_centres():
    out, k = [], -3
    while True:
        u = GRID_FIRST + GRID * k
        if u + PIER_W / 2 > U_EAST_BLOCK[1] - 0.2:
            break
        out.append(round(u, 3))
        k += 1
    return out


def window_rects(pc):
    """(left, right) of the two panes of a pair centred on pc, and the hood to the west of each."""
    out = []
    for dx in (-PAIR_SPACING / 2, PAIR_SPACING / 2):
        c = pc + dx
        left, right = c - WIN_W / 2, c + WIN_W / 2
        out.append((left, right, right - HOOD_W + HOOD_RIGHT_EXTRA, right + HOOD_RIGHT_EXTRA))
    return out


def remove_old_pieces(d):
    keep = []
    for b in d['blocks']:
        i = b['id']
        if i.startswith('arcade-pier-') or i in ('brick-plinth-below-projecting-glass', 'brick-head-above-projecting-glass',
                                                 'east-penthouse'):
            continue
        keep.append(b)
    d['blocks'] = keep
    d['detailMeshes'] = [m for m in d['detailMeshes'] if not m['id'].startswith('hackerman-')]


def in_old_south_zone(c):
    """The old arcade and wall details: they stood at v 2.5-5.6, on the old front, and are rebuilt below."""
    return U_EAST_BLOCK[0] - 0.2 <= c[0] <= U_EAST_BLOCK[1] + 1.5 and 2.0 <= c[1] <= 5.6 and c[2] < 28.0


def clean_old_meshes(d):
    """Drop the triangles of the old south wall and arcade from the old meshes; move the recessed shopfront with its wall."""
    dropped = moved = 0
    for m in d['detailMeshes']:
        if m['id'] == 'authored-stone':           # all of it is the old arcade's inner stone (v 5.1-9)
            moved += len(m['triangles']); m['triangles'] = []; m['vertices'] = []; continue
        V, T = m['vertices'], m['triangles']
        if m['id'] in ('authored-darkMetal', 'authored-metal', 'authored-joint'):
            keepT = []
            for t in T:
                c = [sum(V[i][k] for i in t) / 3 for k in range(3)]
                if in_old_south_zone(c):
                    dropped += 1
                else:
                    keepT.append(t)
            T = keepT
        shift = set()
        for t in T:
            c = [sum(V[i][k] for i in t) / 3 for k in range(3)]
            if U_EAST_BLOCK[0] - 0.2 <= c[0] <= U_EAST_BLOCK[1] + 1.5 and 8.4 <= c[1] <= 9.6 and c[2] < 12.5 \
                    and m['id'] in ('authored-darkMetal', 'authored-metal'):
                shift.update(t)                    # the recessed shopfront's mullions, on the arcade's back wall (old v 9.0)
        if m['id'] in ('authored-orange', 'authored-sign') and V and min(v[1] for v in V) > 2.0:
            shift = set(range(len(V)))             # seats and the building sign stand in the arcade (only while they are still on the old front)
        for i in shift:
            V[i][1] = round(V[i][1] + SHIFT_V, DECIMALS)
        moved += len(shift)
        # drop the vertices nobody uses any more
        used = sorted({i for t in T for i in t})
        remap = {old: new for new, old in enumerate(used)}
        m['vertices'] = [V[i] for i in used]
        m['triangles'] = [[remap[i] for i in t] for t in T]
    d['detailMeshes'] = [m for m in d['detailMeshes'] if m['triangles']]
    return dropped, moved


def main():
    d = json.loads(PATH.read_text(encoding='utf-8'))
    remove_old_pieces(d)
    dropped, moved = clean_old_meshes(d)
    B = {b['id']: b for b in d['blocks']}
    u0, u1 = U_EAST_BLOCK
    back = SOUTH_V + ARCADE_DEPTH

    for tone, hexv in COLOURS.items():
        d['colours'][tone] = {'hex': hexv}
    d['levels']['floors'] = [0, P, 2 * P, 3 * P, 4 * P, 5 * P, 32]           # equal storeys (PHOTO); the last is the old screen top
    d['parameters'].update({'arcade_front': SOUTH_V, 'arcade_back': back, 'base_top': COLONNADE_TOP, 'crossbeam': round(P - MID_BEAM_H, 3),
                            'body_top': BODY_TOP, 'arcade_pitch': GRID, 'pier': PIER_W})

    # ---- the brick wall: south face to the scan, equal storeys, openings in pairs ----
    wing = B['east-upper-paired-window-wing']
    wu0, wu1 = wing['plan'][0], wing['plan'][1]
    wing['plan'] = [wu0, wu1, SOUTH_V, wing['plan'][3]]
    wing['z0'] = COLONNADE_TOP
    openings = []
    rows = [COLONNADE_TOP + k * P for k in range(ROWS)]
    pcs = pair_centres()
    for z in rows:
        for pc in pcs:
            for (wl, wr, hl, hr) in window_rects(pc):
                if wl < wu0 + 0.3 or wr > wu1 - 0.3:
                    continue
                openings.append({'s0': round(wu1 - wr, 3), 's1': round(wu1 - wl, 3), 'z0': round(z, 3), 'z1': round(z + WIN_H, 3),
                                 'd': OPEN_D, 'glass': 'hackWindow', 'tone': 'brick'})
    openings.sort(key=lambda o: (o['z0'], o['s0']))
    wing['faces']['v0'] = {'bands': [{'z0': COLONNADE_TOP, 'z1': BODY_TOP, 'skin': 'brick', 'openings': openings}]}
    for fk in ('u1', 'v1'):                                      # the ends and the north keep their old windows, but at the new storey height
        for band in wing['faces'][fk]['bands']:
            band['z0'] = COLONNADE_TOP
            for o in band.get('openings', []):
                for old, new in zip((14.3, 19.35, 24.4), rows):
                    if abs(o['z0'] - old) < 1e-6:
                        o['z1'] = round(new + (o['z1'] - o['z0']), 3); o['z0'] = round(new, 3)
    # the old wing's u0 face (against the glass bay) is unchanged

    # ---- hoods, sills: meshes in their own tones ----
    hood_glass = {'id': 'hackerman-hood-glass', 'tone': 'hackHoodGlass', 'vertices': [], 'triangles': []}
    hood_frame = {'id': 'hackerman-hood-frame', 'tone': 'hackFrame', 'vertices': [], 'triangles': []}
    hood_soffit = {'id': 'hackerman-hood-soffit', 'tone': 'hackSoffit', 'vertices': [], 'triangles': []}
    n_hoods = 0
    for z in rows:
        za, zb = HOOD_TOPS(z)
        for pc in pcs:
            for (wl, wr, hl, hr) in window_rects(pc):
                if wl < wu0 + 0.3 or wr > wu1 - 0.3:
                    continue
                v0, v1 = SOUTH_V - HOOD_PROUD, SOUTH_V
                # glass panel on the front, inside a frame of FRAME_T
                push(hood_glass, quad((hl + FRAME_T, v0 - 0.005, za + FRAME_T), (hr - FRAME_T, v0 - 0.005, za + FRAME_T),
                                      (hr - FRAME_T, v0 - 0.005, zb - FRAME_T), (hl + FRAME_T, v0 - 0.005, zb - FRAME_T)))
                box = box_quads(hl, hr, v0, v1, za, zb)
                push(hood_frame, quad(*box['top'])); push(hood_frame, quad(*box['west'])); push(hood_frame, quad(*box['east']))
                for (a, b, c_, e) in (((hl, v0, za), (hr, v0, za), (hr, v0, za + FRAME_T), (hl, v0, za + FRAME_T)),
                                      ((hl, v0, zb - FRAME_T), (hr, v0, zb - FRAME_T), (hr, v0, zb), (hl, v0, zb)),
                                      ((hl, v0, za), (hl + FRAME_T, v0, za), (hl + FRAME_T, v0, zb), (hl, v0, zb)),
                                      ((hr - FRAME_T, v0, za), (hr, v0, za), (hr, v0, zb), (hr - FRAME_T, v0, zb))):
                    push(hood_frame, quad(a, b, c_, e))
                push(hood_soffit, quad(*box['bottom']))
                # a thin dark sill under the pane
                push(hood_frame, quad((wl, SOUTH_V - 0.08, z - SILL_T), (wr, SOUTH_V - 0.08, z - SILL_T), (wr, SOUTH_V - 0.08, z), (wl, SOUTH_V - 0.08, z)))
                n_hoods += 1
    d['detailMeshes'].extend([hood_glass, hood_frame, hood_soffit])

    # ---- the arcade: piers on the grid, two fascia beams, floor, the recessed wall ----
    piers = pier_centres()
    for i, c in enumerate(piers):
        d['blocks'].append({'id': 'arcade-pier-%02d' % i, 'plan': [round(c - PIER_W / 2, 3), round(c + PIER_W / 2, 3), SOUTH_V, round(SOUTH_V + PIER_D, 3)],
                            'z0': 0.2, 'z1': round(COLONNADE_TOP - FASCIA_H, 3), 'bands': [{'z0': 0.2, 'z1': round(COLONNADE_TOP - FASCIA_H, 3), 'skin': 'stone'}],
                            'roofTone': 'stone', 'cap': True})
    B = {b['id']: b for b in d['blocks']}
    mid = B['arcade-intermediate-beam']
    mid['plan'] = [u0, u1, SOUTH_V, SOUTH_V + BEAM_DEPTH]
    mid['z0'], mid['z1'] = round(P - MID_BEAM_H, 3), round(P, 3)
    mid['bands'] = [{'z0': mid['z0'], 'z1': mid['z1'], 'skin': 'stoneLight'}]
    top = B['arcade-upper-entablature']
    top['plan'] = [u0, u1, SOUTH_V, back]
    top['z0'], top['z1'] = round(COLONNADE_TOP - FASCIA_H, 3), COLONNADE_TOP
    top['bands'] = [{'z0': top['z0'], 'z1': top['z1'], 'skin': 'stoneLight'}]
    fl = B['east-arcade-floor']
    fl['plan'] = [u0, u1, SOUTH_V - 0.1, back + 0.1]
    enc = B['east-recessed-ground-enclosure']
    enc['plan'] = [u0, u1, back, enc['plan'][3]]
    enc['z1'] = COLONNADE_TOP - FASCIA_H
    for fk, f in enc['faces'].items():
        if f is None:
            continue
        for band in f['bands']:
            band['z1'] = round(COLONNADE_TOP - FASCIA_H, 3)
            for o in band.get('openings', []):
                if o['z1'] > band['z1'] - 0.2:
                    o['z1'] = round(band['z1'] - 0.2, 3)
                if o['z0'] > P - 0.1 and o['z0'] < P + 0.4:
                    o['z0'] = round(P + 0.4, 3)
    # the old walkway return and planter that stood in front of the old arcade now stand in front of the new one
    for bid in ('east-planted-terrace', 'east-terrace-retaining-wall'):
        b = B[bid]
        if b['plan'][3] > -4.0:                      # still on the old front
            b['plan'] = [b['plan'][0], b['plan'][1], round(b['plan'][2] + SHIFT_V, 3), round(b['plan'][3] + SHIFT_V, 3)]
    ret = B['upper-walk-east-return']
    ret['plan'] = [ret['plan'][0], ret['plan'][1], ret['plan'][2], min(ret['plan'][3], SOUTH_V - 0.1)]

    # ---- the glass tower: in front of the brick, as photographed ----
    g0, g1 = GLASS_BAY
    rear = B['east-rear-of-glazed-corner']
    rear['plan'] = [g0, g1, SOUTH_V, rear['plan'][3]]
    rear['z0'] = COLONNADE_TOP
    rear['bands'] = [{'z0': COLONNADE_TOP, 'z1': BODY_TOP, 'skin': 'brick'}]
    bay = B['projected-glass-bay']
    bay['plan'] = [g0, g1, SOUTH_V - GLASS_BAY_DEPTH, SOUTH_V]
    bay['z0'], bay['z1'] = round(GLASS_BAY_BOTTOM, 3), 28.45
    bay['bands'] = [{'z0': bay['z0'], 'z1': bay['z1'], 'skin': 'glass'}]
    if 'faces' in bay:
        for fk, f in bay['faces'].items():
            if f and f.get('bands'):
                f['bands'][0]['z0'] = bay['z0']; f['bands'][0]['z1'] = bay['z1']

    # ---- the top: roof edge and clerestory only where the old top storey is not; the louvred top storey over u 45-127 ----
    pu0, pu1, pv0, pv1 = PENTHOUSE
    d['blocks'].append({'id': 'east-penthouse', 'plan': [pu0, pu1, pv0, pv1], 'z0': BODY_TOP, 'z1': PENTHOUSE_TOP,
                        'bands': [{'z0': BODY_TOP, 'z1': PENTHOUSE_TOP, 'skin': 'glassDark'}], 'roofTone': 'metal', 'cap': True, 'soffitTone': 'metal'})
    B = {b['id']: b for b in d['blocks']}
    for bid in ('east-clerestory', 'east-roof-edge'):
        b = B[bid]
        b['plan'] = [pu1 - 0.0 if bid == 'east-clerestory' else pu1 - 0.08, b['plan'][1], b['plan'][2], b['plan'][3]]
    # the south edge of the clerestory and roof edge now sit on the new south face where they are kept (east of the penthouse)
    for bid in ('east-clerestory', 'east-roof-edge'):
        b = B[bid]
        b['plan'][2] = SOUTH_V + (0.15 if bid == 'east-clerestory' else 0.05)

    d['sources']['dimensions'] = ('South face, storeys, window pairs, hoods and top of the east block: owner photographs (PHOTO), the 2021 laser scan '
                                  '(SCAN) and, where neither shows, plain inference (INFERRED). See scripts/author_hackerman.py for each number.')
    PATH.write_text(compact(json.dumps(d, indent=2)), encoding='utf-8')
    print('Hackerman: %d piers, %d pairs per row, %d openings, %d hoods; old mesh triangles dropped %d, vertices moved %d'
          % (len(piers), len(pcs), len(openings), n_hoods, dropped, moved))


if __name__ == '__main__':
    main()
