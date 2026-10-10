"""Author the south wall of the Norman Hackerman Building's east block (and its top), from the owner's photographs
and the 2021 laser scan.

THE OPEN QUESTION, decided 2026-10-09: where is the brick south face of the east block? (frame = the recipe's own:
u east along the long side, v north, z up, metres; checked against a render, NOT assumed: u runs east, the arcade is
on the low-v side.)  Three candidates:  A  v = -4.5 (a first draft of this script),  B  v = -0.5 (the map outline's
south edge is v = 0),  C  v = 3.5 (the old recipe).  ANSWER: C, v = 3.5.  The scan's 29 m strip at v -4.5 .. -1 is
the louvred sunshade, which stands out 8 m past the brick, not a roof terrace.  Evidence, none of it from the map:

  1. SIDE PHOTO, the lead's own test.  The camera was fitted (solvePnP, 24 mm lens) on 32 window corners of the south
     wall, taken off a flattened drawing of that wall; it lands 19.4 m from the wall, 1.7 m up.  The canopy's
     lowest corner (its south-west tip) is photographed 189 px to the LEFT of the glass tower's west edge.  Projecting
     the scan's tip (u 46, v -4.5, z 29) from that camera gives, for each candidate face: A  40 px to the RIGHT of
     the tower edge,  B  72 px left,  C  198 px left.  Only C matches.  (The canopy stands out 8.0 m past the face =
     about one window pair period, 7.9 m.)
  2. FRONT PHOTO, ground check.  Fitted on 28 window corners; with the face as a free unknown and the red curb
     (a ground line, 6.5 m in front of the camera by its pixel rows) added, the fit needs a camera 6.1 m high if the
     face is at A, 4.1 m at B, and 1.5 - 2.1 m (a hand-held phone) only at C.  The street data (curb at v = -9.2)
     puts the face at v = 3.6 by the same measure.
  3. SIDE PHOTO, the west wing.  The wing's brick face runs on to the tower with no return wall; A would need a
     7.6 m step there.
  4. The scan outside the face: first returns at v 2.5 jump from 30 m to 34 m (the glass top storey rises at the
     face), and nothing but a shelf 29-31 m high stands south of it.
  The first draft's own camera (face at A) was fitted to its own model and so proved nothing about v; its 8 m shift
  also dragged the planter and the street wall with it.

What the old recipe had wrong (found by drawing it from the photographs' cameras and reading the scan cell by cell):

  * The colonnade is two storeys of EQUAL height, and the three brick storeys above it have the same pitch
    (PHOTO: a flat drawing of the wall gives 341 px for the upper colonnade storey and 335 px for the brick row
    pitch; the near-frontal photograph gives 420 and 407 px). The recipe had a low first storey (4.65 m) and a
    brick pitch of 5.05 m.  Five floors of 5.7 m make the scan's 29 m roof, and both photographs' cameras land 19-20 m
    from the wall with this size (the north side shows the same five floors).
  * The windows come in PAIRS. Each window is a clear pane under a wider pale-blue hood box (a glazed
    clerestory light with a projecting soffit); pairs repeat every 7.9 m, and a pair is 2.6 m between its panes.
    The recipe had a grid of single windows at an even pitch and no hoods.
  * The sunshade stood out 3.7 m at 32 m; the scan and the side photograph give 8 m, with its lip level with the
    glass tower's top and the fins tilted up toward the building (29 m at the lip, 30-31 m at the face).
  * The roof of the east block between u = 45 and 127 stands 5 m higher than the recipe's 30.75 m at its north
    part (SCAN: 34-37 m for v >= 3.5), which is the glass top storey seen in the photographs.

What this script does (run it once on the file from main; it removes its own pieces first, so it can be run again):
  1. rebuilds the arcade (piers, fascia beams, floor) and the brick wall above it with equal storeys and the measured
     pair rhythm of windows and hoods, on the old face;
  2. raises the east block's north part to the glass top storey;
  3. sets the pale stone and the window, hood and (dark) arcade glass from the photographs;
  4. builds the louvred sunshade 8 m out, and leaves the glass tower and its mullions as they were.
Everything else in the file is left alone (west wing, entrance, north side, trees and walks).

Every number below is marked PHOTO (measured on an owner photograph), SCAN (the laser scan) or INFERRED.
"""
from pathlib import Path
import copy
import json
import math
from compact_models import compact

PATH = Path(__file__).resolve().parents[1] / 'data/apartments/norman-hackerman-building.json'

# ---- every taste or size choice is here (metres unless stated) ----
U_EAST_BLOCK = (45.2, 146.3)    # SCAN + old recipe: the east block runs from the entrance bay to the east end
SOUTH_V = 3.5                   # PHOTO + street data: south face of the east block, as in the old recipe (see the header: the helper's -4.5 was a canopy edge)
BACK_LOWER = 12.5               # PHOTO: the ground-floor back wall. Side camera (ceiling edge z 5.13): v 12-14; front camera: 10-12. Old recipe 9.0
BACK_UPPER = 15.0               # PHOTO: the upper-storey back wall. Ceiling/back-wall edge at z 10.15 read in the side photo (v 14.4-14.7, a straight line) and in the front photo (15.5-16.8). Old recipe 9.0
LOWER_CEIL = 5.13               # = P - MID_BEAM_H: the underside of the upper floor deck
SHIFT_V = SOUTH_V - 3.5         # everything that stood on the old arcade front moves by this much (-8.0)
P = 5.7                         # PHOTO: storey height = brick row pitch = colonnade storey. 5 storeys + a 1.2 m parapet reach the SCAN roof 29.7
COLONNADE_TOP = 2 * P           # PHOTO: the top fascia's upper edge, where the lowest brick window row sits (11.4 m)
BODY_TOP = 29.7                 # SCAN: 28-31 m along the south strip (rising east, as the ground falls), kept from the old recipe
FASCIA_H = 1.25                 # PHOTO: top fascia 92 px against a 413 px storey, 1.25 m
MID_BEAM_H = 0.57               # PHOTO: middle fascia 42 px against 413, 0.57 m
BEAM_DEPTH = 0.8                # INFERRED: kept from the old recipe
PIER_W, PIER_D = 1.1, 1.8       # PHOTO: upper piers, front face 78 px against 413 px = 1.07 m; side photo: east face 42 and 71 px, i.e. depth 1.2 and 2.1 m (mean 1.65, taken 1.8)
LOWER_PIER_W, LOWER_PIER_D = 1.5, 2.0   # PHOTO: ground-floor piers are broader than the upper ones, 85-145 px against 75 px in the front photograph (1.2-2.0 m); depth INFERRED, in proportion
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
CANOPY_U = (46.0, 146.3)        # SCAN: the 29 m shelf starts at u = 46-48 (the glass tower's west edge is 45.2) and runs to the east end
CANOPY_LIP_V = -4.5             # SCAN: first returns stop at v = -4.5 (4.5 m past the map outline, 8 m past the brick face)
CANOPY_LIP_Z = 26.5             # INFERRED between PHOTO and SCAN: the side photograph's fitted camera puts the lip at z 24-26 (its far edge line, tip at u 47, v -4.5); the scan's first return there is 29.0 above LOCAL ground
CANOPY_FACE_Z = 29.7            # SCAN: 30-31 m (top of the fins) at the face; underside level with the brick roof (BODY_TOP)
CANOPY_T = 0.55                 # INFERRED: fin depth
SLAT_PITCH, SLAT_W = 0.5, 0.42  # PHOTO: fins 0.5 m apart, running from the lip back to the building, a dark soffit seen between them
BEAM_PITCH = 7.9                # INFERRED: a cross beam under the canopy at every window pair
COLOURS = {
    'stone': '#dad5c5', 'stoneLight': '#e0dccd',      # PHOTO: pier fronts #e4e0d5, fascia #e2e3e1 at dawn, 1.48 times the brick's brightness (the old pair gave 1.34)
    'hackHoodGlass': '#9dbddb',      # PHOTO: hood panels #a6c8e6 / #94b7d4 (they reflect the overcast sky)
    'hackArcadePane': '#3a444b',    # PHOTO: the upper colonnade openings show dark glass (#1f2325..#3a4145). Named WITHOUT 'glass', 'glaz' or 'window': the app gives any such tone its sky-mirroring glass material (js/slopes-apartments.js palette())
    'hackShopPane': '#4a4a3e',      # PHOTO: the ground-floor shopfronts are dark with warm lit interiors
    'hackWindow': '#9cbccf',         # PHOTO: panes #a2c6de / #bdd3db at dawn
    'hackCanopyFin': '#c4ccd2',      # PHOTO: light grey-blue fins (#7e8690 .. #a9b4c1 under an overcast sky); drawn lighter because their undersides take no sun
    'hackRecessWall': '#7b776b',     # PHOTO: the recess walls in shade, #6d6860 .. #8a857a (the shared stone tone drew them as bright as the piers, so the bays read flat)
    'hackCeiling': '#6b5d46',        # PHOTO: the upper ceilings average #4c4130 lit; drawn lighter because an underside takes only sky light and came out near black at #34312d
    'hackFrame': '#5f656b',          # PHOTO: thin grey-blue metal round the hoods and under the panes
    'hackSoffit': '#2b2723',         # PHOTO: soffit under a hood #15120f..#514839
}
DECIMALS = 3
GLASS_STRENGTH_HOOD, GLASS_STRENGTH_PANE = 0.35, 0.25  # taste: how much sky the hood and pane glass mirror (the app's own glass is 1.0)
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


def canopy_meshes():
    """The louvred sunshade that stands out 8 m past the brick face over the whole east block, tilted up toward the building.
    PHOTO (side photograph): fins run from the lip back to the building, 0.5 m apart, light against a dark soffit, with
    two dark beams along the length and cross beams; the fitted camera puts the lip at v -4.5, u 47, z 24-26."""
    fin = {'id': 'hackerman-canopy-fins', 'tone': 'hackCanopyFin', 'vertices': [], 'triangles': []}
    dark = {'id': 'hackerman-canopy-dark', 'tone': 'darkMetal', 'vertices': [], 'triangles': []}
    u0, u1 = CANOPY_U; v0, v1 = CANOPY_LIP_V, SOUTH_V
    k = (CANOPY_FACE_Z - CANOPY_LIP_Z) / (v1 - v0)
    zu = lambda v: CANOPY_LIP_Z + (v - v0) * k
    def both(mesh, q):
        push(mesh, q); push(mesh, list(reversed(q)))
    # no soffit plate: the sky shows between the fins, as in the photograph (a plate drew the whole canopy near-black from below)
    both(dark, quad((u0, v0, zu(v0)), (u1, v0, zu(v0)), (u1, v0, zu(v0) + CANOPY_T + 0.1), (u0, v0, zu(v0) + CANOPY_T + 0.1)))   # lip fascia
    both(dark, quad((u0, v0, zu(v0)), (u0, v1, zu(v1)), (u0, v1, zu(v1) + CANOPY_T), (u0, v0, zu(v0) + CANOPY_T)))            # west end
    both(dark, quad((u1, v0, zu(v0)), (u1, v1, zu(v1)), (u1, v1, zu(v1) + CANOPY_T), (u1, v0, zu(v0) + CANOPY_T)))            # east end
    n_fins = 0
    u = u0 + 0.1
    while u + SLAT_W <= u1 - 0.05:                                                       # fins: along v, hung just under the soffit's top skin
        zt = lambda v: zu(v) + CANOPY_T
        both(fin, quad((u, v0, zt(v0)), (u + SLAT_W, v0, zt(v0)), (u + SLAT_W, v1, zt(v1)), (u, v1, zt(v1))))
        both(fin, quad((u, v0, zu(v0)), (u + SLAT_W, v0, zu(v0)), (u + SLAT_W, v1, zu(v1)), (u, v1, zu(v1))))   # and the underside
        n_fins += 1; u += SLAT_PITCH
    for frac in (0.0, 1 / 3, 2 / 3, 1.0):                                                   # beams along the length, under the soffit
        v = v0 + frac * (v1 - v0) - (0.3 if frac == 1.0 else 0.0)
        for (da, db) in ((0.0, 0.3),):
            both(dark, quad((u0, v + da, zu(v + da) - 0.4), (u1, v + da, zu(v + da) - 0.4), (u1, v + db, zu(v + db) - 0.4), (u0, v + db, zu(v + db) - 0.4)))
            both(dark, quad((u0, v, zu(v)), (u1, v, zu(v)), (u1, v, zu(v) - 0.4), (u0, v, zu(v) - 0.4)))
    b = u0 + 1.0
    while b < u1 - 0.2:                                                                      # cross beams, one at every window pair
        both(dark, quad((b, v0, zu(v0) - 0.3), (b + 0.25, v0, zu(v0) - 0.3), (b + 0.25, v1, zu(v1) - 0.3), (b, v1, zu(v1) - 0.3)))
        both(dark, quad((b, v0, zu(v0)), (b, v1, zu(v1)), (b, v1, zu(v1) - 0.3), (b, v0, zu(v0) - 0.3)))
        b += BEAM_PITCH
    return [fin, dark], n_fins


def drop_old_canopy_south(d):
    """The old recipe's flat grille at z = 32 over the first 3.5 m of the east block is replaced by the real canopy."""
    n = 0
    for m in d['detailMeshes']:
        if m['id'] not in ('authored-metal', 'authored-darkMetal'):
            continue
        V, T = m['vertices'], m['triangles']
        keep = []
        for t in T:
            c = [sum(V[i][k] for i in t) / 3 for k in range(3)]
            if CANOPY_U[0] - 1.5 <= c[0] <= CANOPY_U[1] + 1.6 and c[1] < SOUTH_V - 0.1 and c[2] > 31.0:
                n += 1
            else:
                keep.append(t)
        used = sorted({i for t in keep for i in t}); remap = {o: k for k, o in enumerate(used)}
        m['vertices'] = [V[i] for i in used]; m['triangles'] = [[remap[i] for i in t] for t in keep]
    return n


def remove_old_pieces(d):
    keep = []
    for b in d['blocks']:
        i = b['id']
        if i.startswith('arcade-pier-') or i in ('east-penthouse', 'arcade-upper-deck', 'east-recessed-upper-enclosure'):
            continue
        keep.append(b)
    d['blocks'] = keep
    d['detailMeshes'] = [m for m in d['detailMeshes'] if not m['id'].startswith('hackerman-')]


def in_old_south_zone(c):
    """The old arcade and wall details: they stood at v 2.5-5.6, on the old front, and are rebuilt below."""
    if GLASS_BAY[0] - 0.3 <= c[0] <= GLASS_BAY[1] + 0.3 and c[2] >= 13.5:
        return False                                  # the glass tower's own mullions and transoms stay with the tower
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
        shift = {}
        for t in T:
            c = [sum(V[i][k] for i in t) / 3 for k in range(3)]
            if U_EAST_BLOCK[0] - 0.2 <= c[0] <= U_EAST_BLOCK[1] + 1.5 and 8.4 <= c[1] <= 9.6 and c[2] < 12.5 \
                    and m['id'] in ('authored-darkMetal', 'authored-metal'):
                dv = (BACK_LOWER if c[2] < P - 0.3 else BACK_UPPER) - 9.0
                for i in t:                        # the recessed shopfront's mullions go with their back wall (old v 9.0): lower storey, upper storey
                    shift[i] = dv
        if m['id'] in ('authored-orange', 'authored-sign') and V and min(v[1] for v in V) > 2.0:
            shift = {i: SHIFT_V for i in range(len(V))}   # seats and the building sign stand in the arcade (only while they are still on the old front)
        for i, dv in shift.items():
            V[i][1] = round(V[i][1] + dv, DECIMALS)
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
    back = BACK_UPPER

    for tone, hexv in COLOURS.items():
        d['colours'][tone] = {'hex': hexv}
    d['skins']['hackRecess'] = {'kind': 'flat', 'field': 'hackRecessWall'}
    # the hood and pane glass keep the glass material, but less of its sky mirror: at some sun angles the full mirror
    # drew one hood (and a pane) pure white, where the photographs show an even pale blue
    d.setdefault('materials', {}).update({'hackHoodGlass': {'type': 'glass', 'strength': GLASS_STRENGTH_HOOD},
                                          'hackWindow': {'type': 'glass', 'strength': GLASS_STRENGTH_PANE}})
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
    ceil = {'id': 'hackerman-ceilings', 'tone': 'hackCeiling', 'vertices': [], 'triangles': []}    # the dark ceilings of both colonnade storeys
    for (zc, vb) in ((COLONNADE_TOP - FASCIA_H - 0.02, BACK_UPPER), (LOWER_CEIL - 0.02, BACK_LOWER)):
        for q in (quad((U_EAST_BLOCK[0], SOUTH_V + 0.05, zc), (U_EAST_BLOCK[1], SOUTH_V + 0.05, zc), (U_EAST_BLOCK[1], vb, zc), (U_EAST_BLOCK[0], vb, zc)),):
            push(ceil, q); push(ceil, list(reversed(q)))
    d['detailMeshes'].append(ceil)
    n_old = drop_old_canopy_south(d)
    cm, n_slats = canopy_meshes()
    d['detailMeshes'].extend(cm)

    # ---- the arcade: piers on the grid, two fascia beams, floor, the recessed wall ----
    piers = pier_centres()
    top_z0 = round(COLONNADE_TOP - FASCIA_H, 3)
    for i, c in enumerate(piers):
        for tag, w, dep, za, zb in (('lo', LOWER_PIER_W, LOWER_PIER_D, 0.2, LOWER_CEIL), ('up', PIER_W, PIER_D, P, top_z0)):
            d['blocks'].append({'id': 'arcade-pier-%02d%s' % (i, '' if tag == 'lo' else 'u'), 'plan': [round(c - w / 2, 3), round(c + w / 2, 3), SOUTH_V, round(SOUTH_V + dep, 3)],
                                'z0': za, 'z1': zb, 'bands': [{'z0': za, 'z1': zb, 'skin': 'stone'}], 'roofTone': 'stone', 'cap': True})
    B = {b['id']: b for b in d['blocks']}
    mid = B['arcade-intermediate-beam']
    mid['plan'] = [u0, u1, SOUTH_V, SOUTH_V + BEAM_DEPTH]
    mid['z0'], mid['z1'] = round(P - MID_BEAM_H, 3), round(P, 3)
    mid['bands'] = [{'z0': mid['z0'], 'z1': mid['z1'], 'skin': 'stoneLight'}]
    top = B['arcade-upper-entablature']
    top['plan'] = [u0, u1, SOUTH_V, BACK_UPPER]
    top['z0'], top['z1'] = round(COLONNADE_TOP - FASCIA_H, 3), COLONNADE_TOP
    top['bands'] = [{'z0': top['z0'], 'z1': top['z1'], 'skin': 'stoneLight'}]
    fl = B['east-arcade-floor']
    fl['plan'] = [u0, u1, SOUTH_V - 0.1, BACK_LOWER + 0.1]
    # the upper floor deck: its underside is the ground-floor ceiling, its top the terrace floor, all the way to the upper back wall
    d['blocks'].append({'id': 'arcade-upper-deck', 'plan': [u0, u1, SOUTH_V, BACK_UPPER], 'z0': LOWER_CEIL, 'z1': P,
                        'bands': [{'z0': LOWER_CEIL, 'z1': P, 'skin': 'stoneLight'}], 'roofTone': 'paving', 'cap': True})
    # the recessed back wall stands at a different depth on each storey: two blocks, each with its own openings
    enc = B['east-recessed-ground-enclosure']
    enc_up = copy.deepcopy(enc); enc_up['id'] = 'east-recessed-upper-enclosure'
    top_z = round(COLONNADE_TOP - FASCIA_H, 3)
    enc['plan'] = [u0, u1, BACK_LOWER, enc['plan'][3]]
    enc['z1'] = LOWER_CEIL
    enc_up['plan'] = [u0, u1, BACK_UPPER, enc_up['plan'][3]]
    enc_up['z0'], enc_up['z1'] = P, top_z
    def retarget(block, z0, z1, upper):
        block['bands'] = [{'z0': z0, 'z1': z1, 'skin': 'hackRecess'}]
        block['roofTone'] = 'hackCeiling'
        for fk, f in block['faces'].items():
            if f is None:
                continue
            for band in f['bands']:
                band['z0'], band['z1'] = z0, z1
                band['skin'] = 'hackRecess'
                keep = []
                for o in band.get('openings', []):
                    if (o['z0'] >= P - 0.3) != upper:
                        continue
                    o['glass'] = 'hackArcadePane' if upper else 'hackShopPane'
                    if upper:
                        o['z0'], o['z1'] = round(P + 0.4, 3), round(z1 - 0.2, 3)
                    else:
                        o['z1'] = min(o['z1'], round(z1 - 0.2, 3))
                    keep.append(o)
                band['openings'] = keep
    retarget(enc, 0, LOWER_CEIL, False)
    retarget(enc_up, P, top_z, True)
    d['blocks'].append(enc_up)
    # the old walkway return and planter that stood in front of the old arcade now stand in front of the new one
    for bid in ('east-planted-terrace', 'east-terrace-retaining-wall'):
        b = B[bid]
        if b['plan'][3] > -4.0:                      # still on the old front
            b['plan'] = [b['plan'][0], b['plan'][1], round(b['plan'][2] + SHIFT_V, 3), round(b['plan'][3] + SHIFT_V, 3)]
    ret = B['upper-walk-east-return']
    ret['plan'] = [ret['plan'][0], ret['plan'][1], ret['plan'][2], min(ret['plan'][3], SOUTH_V - 0.1)]

    # ---- the glass tower: its block, glass and mullions stay as in the old recipe (it already stands 1 m proud of the brick);
    # only the brick plinth under it follows the new colonnade height ----
    plinth = B['brick-plinth-below-projecting-glass']
    plinth['z0'] = COLONNADE_TOP
    plinth['bands'] = [{'z0': COLONNADE_TOP, 'z1': plinth['z1'], 'skin': 'brick'}]
    B['east-rear-of-glazed-corner']['z0'] = COLONNADE_TOP
    B['east-rear-of-glazed-corner']['bands'] = [{'z0': COLONNADE_TOP, 'z1': BODY_TOP, 'skin': 'brick'}]

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
    print('canopy: %d fins, %d old grille triangles dropped' % (n_slats, n_old))
    print('Hackerman: %d piers, %d pairs per row, %d openings, %d hoods; old mesh triangles dropped %d, vertices moved %d'
          % (len(piers), len(pcs), len(openings), n_hoods, dropped, moved))


if __name__ == '__main__':
    main()
