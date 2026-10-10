#!/usr/bin/env python3
"""Author T. S. Painter Hall (UT campus) from measured numbers. Run from the repo root:

    python3 scripts/author_painter_hall.py     # writes data/apartments/painter-hall.json; safe to run again

Why this file exists (2026-10-09). Painter Hall had only the generic campus-hall recipe baked into
data/campus_buildings.json (3.4 m bays, 2.3 m windows, four rows of one size on every wall). The owner scored an
earlier cheap attempt 0.7 out of 10. This is a plain, measured wall instead, with every number marked:

  SCAN      the 2021 laser scan, read cell by cell in the building's own grid (0.5 m cells):
            the north wing's first returns climb from 15.1 m at the north eave to a ridge of 21.9 m and fall to
            14.7 m at the south eave (a 30 degree hip, ridge east-west); the spine and the south block read
            15.3 to 15.9 m; the map outline's lengths: north face 51.7 m, spine west face 19.2 m.
  PHOTO     the owner's photographs of 2026-10-03, read as ratios (nothing was taken from a single reading):
            - the NORTH FRONT, square-on (the photograph that reads "T. S. PAINTER HALL" over the door):
              base of cream limestone, then three brick storeys, then a cream stone frieze with the top row of
              windows; one window to a bay; a carved limestone portal in the middle storeys;
            - the SPINE'S WEST WALL, nearly square-on in daylight: seven window columns across the wall
              (four arched, three plain on the third row), the same four storeys;
            - colours: the median of patches of the west-wall photograph (overcast evening light; the whole
              frame is dim, so the stone patch is the reference and all three were left as measured).
  INFERRED  every wall nobody photographed square-on (west end, east end, south walls, court walls): the north
            front's rows, repeated. Where the portal stands along the north wall. The size of the steps.

Scale. Photographs give ratios, not metres. The one real length is the wall height from the scan (15.2 m at the
north eave, where the walls end under the tile roof). On the north front the door sill is 3.5 m above the ground
at the wall's foot (about twenty steps), the first stone string course sits 2.6 m above it, and the cornice 9.1 m
above the string course: 3.5 + 2.6 + 9.1 = 15.2, which is the scan. That fixes 58.5 px per metre on that
photograph, and the bay (152 px) as 2.6 m; the door (125 px) comes out 2.1 m wide, which is a pair of doors.
On the west wall the 19.2 m wall length from the map gives 77 px per metre; the wall top then reads 15.9 m, which
is the scan's 15.9 m over the spine, so the two sources agree to 0.1 m.

Every taste or measured value is in the tables below.
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/apartments/painter-hall.json'
BUILDING_ID = '82bcddc0-ec33-4a0a-a9f2-f380a838a40f'
SNAPSHOT = sorted((ROOT / 'data/snapshots').glob('*/buildings.detailed.geojson'))[-1]
DECIMALS = 3

# ---- heights (metres above the ground at the wall foot) --------------------------------------------- SCAN
WALL_TOP = 15.2          # SCAN: first returns 15.1 at the north eave; the baked tile roof's own base is 15.2.
                         # The spine reads 15.9 m on the scan; this wall stops at the shared eave (open item).

# ---- the NORTH FRONT and every wall without a photograph ------------------------------------------- PHOTO
# Rows from the north-front photograph (58.5 px per metre; storey 188 px = 3.2 m).
BAY = 2.6                # PHOTO: window pitch 152 px. One window per bay: 51.7 m / 2.6 = 20 columns.
BASE_TOP = 6.1           # PHOTO+SCAN: cream limestone to the first string course (door sill 3.5 + 2.6)
STRING_1 = (5.95, 6.15)  # PHOTO: the stone string course under the first brick row
BRICK_TOP = 12.55        # PHOTO: second string course, the foot of the cream frieze (window sill row 4 on it)
STRING_2 = (12.55, 12.75)
FLOORS_BRICK = [6.15, 9.3]       # PHOTO: window bottoms at 6.45 and 9.6 (rows 3.15 and 3.3 m apart: 180 and 190 px)
WIN_W, WIN_H, WIN_SILL = 1.25, 1.62, 0.30      # PHOTO: 70 px wide, 95 px tall; 0.30 above the floor line
WIN_FRAME = 0.10         # PHOTO: a stone surround about 0.1 m wide
FRIEZE_FLOOR, FRIEZE_SILL, FRIEZE_H = 12.75, 0.15, 1.40   # PHOTO: top row sits on the string; 80 px tall; 1.0 m of stone over it
BASE_WIN_W, BASE_WIN_H, BASE_WIN_SILL = 1.30, 1.90, 0.90  # PHOTO: ground-storey windows, 1.30 x 1.9 m
PANES = {'cols': [1 / 3, 2 / 3], 'rows': [0.2, 0.4, 0.6, 0.8], 'w': 0.04}   # PHOTO: three panes across, five down

# ---- the SPINE'S WEST WALL (edge 4 of the footprint) ------------------------------------------------ PHOTO
WEST_COLUMNS = 7         # PHOTO: 4 arched + 3 plain on the third row; 19.2 m / 7 = 2.74 m
WEST_BASE_TOP, WEST_STRING = 4.8, (4.7, 4.9)     # PHOTO: 77 px per metre, string course at 395 px above the ground
WEST_ROW2 = (4.9, 8.3, 0.0, 1.95)                # band z0, z1, sill, window height (window 4.9 to 6.85)
WEST_ROW3 = (8.3, 12.3, 0.2, 1.95)               # third row sits on a sill course at 8.5; arches NOT drawn (open item)
WEST_FRIEZE = (12.3, WALL_TOP, 0.2, 1.85)        # cream frieze with the top row (12.5 to 14.35)

# ---- the portal on the north front ------------------------------------------------------------------ PHOTO
PORTAL_AT = 0.5          # INFERRED: where along the 51.7 m wall (0 = east end, 1 = west end). No photograph shows both ends.
PORTAL = dict(
    panel_half=2.90, panel_proud=0.12, sill=3.5, top=9.1,    # PHOTO: 340 px = 5.8 m wide; carved panel from the door sill to the cornice
    pilaster_off=2.30, pilaster_w=0.65, pilaster_proud=0.40, pilaster_top=8.6,
    cornice_half=3.15, cornice_proud=0.55, cornice_z=(8.6, 9.1),
    door_half=1.05, door_top=6.0,                            # PHOTO: 125 px = 2.1 m; head at 6.0 (transom grille in the photograph)
    balcony_half=1.55, balcony_proud=0.85, balcony_z=(11.9, 12.2),   # PHOTO: stone balcony over the third-row window
    console_off=1.2, console_w=0.35, console_proud=0.7, console_z=(11.0, 11.9),
)

# ---- colours (medians of patches of the west-wall photograph; overcast, dim) -------------------------- PHOTO
COLOURS = {
    'ptBrick': '#83715b',    # brick, median of two plain patches (sd 17 per channel: the brick is mixed)
    'ptStone': '#b3aea1',    # the clean ashlar pier (sd 8); the base and the frieze read about the same in shade
    'ptGlass': '#2f3436',    # the panes: dark with pale curtains. Set by eye (INFERRED).
    'ptFrame': '#a9a393',    # sashes and mullions: set by eye (INFERRED)
    'ptDoor': '#3f4a45',     # portal door, green-grey (PHOTO, set by eye)
    'ptRoofEdge': '#4a443e',
}
MATERIALS = {'ptBrick': 'brick', 'ptStone': 'stone', 'ptGlass': {'type': 'glass', 'strength': 0.18}}


def frame(ring):
    """The same (u, v) frame every campus recipe uses: 5 degrees off east-west, origin at the first point."""
    pts = ring[:-1]
    lat = sum(p[1] for p in pts) / len(pts)
    mx, my = 111320 * math.cos(math.radians(lat)), 111320
    ax, ay = math.cos(math.radians(5)), -math.sin(math.radians(5))
    p0 = ring[0]
    uv = [((p[0] - p0[0]) * mx * ax + (p[1] - p0[1]) * my * ay, -(p[0] - p0[0]) * mx * ay + (p[1] - p0[1]) * my * ax) for p in pts]
    u0, v0 = min(p[0] for p in uv), min(p[1] for p in uv)
    obb = dict(o=[p0[0] + (u0 * ax - v0 * ay) / mx, p0[1] + (u0 * ay + v0 * ax) / my], ax=ax, ay=ay, mx=mx, my=my,
               L=max(p[0] for p in uv) - u0, W=max(p[1] for p in uv) - v0)
    return obb, [[round(p[0] - u0, DECIMALS), round(p[1] - v0, DECIMALS)] for p in uv]


def window(w, h, sill, frame_w=WIN_FRAME, panes=True):
    spec = {'w': w, 'h': h, 'sill': sill, 'frame': {'w': frame_w, 'tone': 'ptStone'}}
    if panes:
        spec['mullion'] = {'cols': PANES['cols'], 'rows': PANES['rows'], 'w': PANES['w'], 'tone': 'ptFrame'}
    return spec


def bays(field, w, h, sill, frame_tone):
    return {'kind': 'bays', 'field': field, 'bay': BAY, 'glass': 'ptGlass', 'frame': frame_tone, 'reveal': 0.2,
            'window': window(w, h, sill)}


def box(a, along, out, s0, s1, d0, d1, z0, z1, verts, tris):
    """A closed box on a wall: s along the wall, d out of it (a point `a` of the wall, unit `along`, unit `out`)."""
    def at(s, d, z):
        return [round(a[0] + along[0] * s + out[0] * d, DECIMALS), round(a[1] + along[1] * s + out[1] * d, DECIMALS), round(z, DECIMALS)]
    sides = [  # (four corners, outward direction of the face)
        ([at(s0, d1, z0), at(s1, d1, z0), at(s1, d1, z1), at(s0, d1, z1)], out),                                  # front
        ([at(s0, d0, z1), at(s1, d0, z1), at(s1, d1, z1), at(s0, d1, z1)], (0, 0, 1)),                           # top
        ([at(s0, d0, z0), at(s1, d0, z0), at(s1, d1, z0), at(s0, d1, z0)], (0, 0, -1)),                          # underside
        ([at(s0, d0, z0), at(s0, d1, z0), at(s0, d1, z1), at(s0, d0, z1)], (-along[0], -along[1], 0)),          # end
        ([at(s1, d0, z0), at(s1, d1, z0), at(s1, d1, z1), at(s1, d0, z1)], (along[0], along[1], 0)),            # end
    ]
    for q, want in sides:
        n = len(verts)
        verts.extend(q)
        e1 = [q[1][i] - q[0][i] for i in range(3)]
        e2 = [q[2][i] - q[0][i] for i in range(3)]
        nrm = (e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0])
        wanted = (want[0], want[1], want[2] if len(want) > 2 else 0)
        fwd = sum(nrm[i] * wanted[i] for i in range(3)) > 0
        tris.extend([[n, n + 1, n + 2], [n, n + 2, n + 3]] if fwd else [[n, n + 2, n + 1], [n, n + 3, n + 2]])


def main():
    snap = json.loads(SNAPSHOT.read_text(encoding='utf-8'))
    feat = next(f for f in snap['features'] if f['properties']['id'] == BUILDING_ID)
    ring = [list(p) for p in feat['geometry']['coordinates'][0]]
    obb, uv = frame(ring)
    n = len(uv)
    area = sum(uv[i][0] * uv[(i + 1) % n][1] - uv[(i + 1) % n][0] * uv[i][1] for i in range(n)) / 2
    edges = []
    for i in range(n):
        a, b = uv[i], uv[(i + 1) % n]
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        along = ((b[0] - a[0]) / length, (b[1] - a[1]) / length)
        out = (along[1], -along[0]) if area > 0 else (-along[1], along[0])      # outward normal
        edges.append(dict(i=i, a=a, b=b, length=length, along=along, out=out))
    # the north front = the longest edge whose outward normal points north (+v); the spine's west wall = the edge
    # near 19 m whose outward normal points west (-u) and that stands between the court and the south block
    north = max((e for e in edges if e['out'][1] > 0.9), key=lambda e: e['length'])
    west = [e for e in edges if e['out'][0] < -0.9 and 18 < e['length'] < 20.5]
    assert len(west) == 2, [(e['i'], round(e['length'], 1), e['out']) for e in edges]
    spine_west = max(west, key=lambda e: e['a'][1])      # the more northerly of the two 19 m west walls
    print('north front: edge %d, %.1f m;  spine west wall: edge %d, %.1f m' % (north['i'], north['length'], spine_west['i'], spine_west['length']))
    assert abs(north['length'] - 51.7) < 1.0 and abs(spine_west['length'] - 19.2) < 1.0

    def stone(z0, z1):
        return {'z0': z0, 'z1': z1, 'skin': 'ptStone'}

    generic = [
        {'z0': 0, 'z1': STRING_1[0], 'skin': 'ptBase', 'floors': [0]},
        stone(*STRING_1),
        {'z0': STRING_1[1], 'z1': STRING_2[0], 'skin': 'ptBrickRows', 'floors': FLOORS_BRICK},
        stone(*STRING_2),
        {'z0': STRING_2[1], 'z1': WALL_TOP, 'skin': 'ptFrieze', 'floors': [FRIEZE_FLOOR]},
    ]
    west_bands = [
        {'z0': 0, 'z1': WEST_STRING[0], 'skin': 'ptBase', 'floors': [0]},
        stone(*WEST_STRING),
        {'z0': WEST_ROW2[0], 'z1': WEST_ROW2[1], 'skin': 'ptWestRow2', 'floors': [WEST_ROW2[0]]},
        {'z0': WEST_ROW3[0], 'z1': WEST_ROW3[1], 'skin': 'ptWestRow3', 'floors': [WEST_ROW3[0]]},
        {'z0': WEST_FRIEZE[0], 'z1': WEST_FRIEZE[1], 'skin': 'ptWestFrieze', 'floors': [WEST_FRIEZE[0]]},
    ]

    skins = {
        'ptBrick': {'kind': 'flat', 'field': 'ptBrick'},
        'ptStone': {'kind': 'flat', 'field': 'ptStone'},
        'ptBase': bays('ptStone', BASE_WIN_W, BASE_WIN_H, BASE_WIN_SILL, 'ptStone'),
        'ptBrickRows': bays('ptBrick', WIN_W, WIN_H, WIN_SILL, 'ptBrick'),
        'ptFrieze': bays('ptStone', WIN_W, FRIEZE_H, FRIEZE_SILL, 'ptStone'),
    }
    for name, (z0, z1, sill, h), field in (('ptWestRow2', WEST_ROW2, 'ptBrick'), ('ptWestRow3', WEST_ROW3, 'ptBrick'), ('ptWestFrieze', WEST_FRIEZE, 'ptStone')):
        skins[name] = dict(bays(field, WIN_W, h, sill, field), bay=spine_west['length'] / WEST_COLUMNS)

    block = {'id': 'painter-walls', 'plan': {'ring': uv, 'holes': []}, 'z0': 0, 'z1': WALL_TOP, 'bands': generic,
             'roofTone': 'ptRoofEdge', 'cap': False,
             'faces': {str(north['i']): {'bands': generic}, str(spine_west['i']): {'bands': west_bands}},
             '_src': 'footprint: snapshot; heights: SCAN; rows and bays: PHOTO (north front, spine west wall); other walls INFERRED'}

    # ---- the portal: boxes standing on the north wall (PHOTO sizes, INFERRED place) ----
    verts, tris = [], []
    a0 = north['a']
    # the wall runs a -> b; PORTAL_AT is measured from the east end. Which end is "a" is read from the geometry.
    east_first = north['a'][0] > north['b'][0]
    s_mid = north['length'] * (PORTAL_AT if east_first else 1 - PORTAL_AT)
    P = PORTAL
    box(a0, north['along'], north['out'], s_mid - P['panel_half'], s_mid + P['panel_half'], 0, P['panel_proud'], P['sill'], P['top'], verts, tris)
    for sign in (-1, 1):
        c = s_mid + sign * P['pilaster_off']
        box(a0, north['along'], north['out'], c - P['pilaster_w'] / 2, c + P['pilaster_w'] / 2, 0, P['pilaster_proud'], P['sill'], P['pilaster_top'], verts, tris)
        c = s_mid + sign * P['console_off']
        box(a0, north['along'], north['out'], c - P['console_w'] / 2, c + P['console_w'] / 2, 0, P['console_proud'], P['console_z'][0], P['console_z'][1], verts, tris)
    box(a0, north['along'], north['out'], s_mid - P['cornice_half'], s_mid + P['cornice_half'], 0, P['cornice_proud'], *P['cornice_z'], verts, tris)
    box(a0, north['along'], north['out'], s_mid - P['balcony_half'], s_mid + P['balcony_half'], 0, P['balcony_proud'], *P['balcony_z'], verts, tris)
    door_v, door_t = [], []
    box(a0, north['along'], north['out'], s_mid - P['door_half'], s_mid + P['door_half'], 0, P['panel_proud'] + 0.03, P['sill'], P['door_top'], door_v, door_t)

    colours = {k: {'hex': v} for k, v in COLOURS.items()}
    spec = {
        'name': 'T. S. Painter Hall', 'id': BUILDING_ID, 'code': 'PAI',
        'sources': {
            'footprint': f'data/snapshots/{SNAPSHOT.parent.name}/buildings.detailed.geojson, feature {BUILDING_ID}',
            'reference': 'https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/PAI/',
            'dimensions': 'See scripts/author_painter_hall.py: every number is marked SCAN, PHOTO or INFERRED there.',
        },
        'footprint': {'ring': ring, 'holes': []},
        'frame': {'obb': obb},
        'levels': {'floors': [0, 6.15, 9.3, 12.75, WALL_TOP]},
        'colours': colours,
        'materials': MATERIALS,
        'skins': skins,
        'blocks': [block],
        'detailMeshes': [
            {'id': 'painter-portal', 'tone': 'ptStone', 'vertices': verts, 'triangles': tris},
            {'id': 'painter-portal-door', 'tone': 'ptDoor', 'vertices': door_v, 'triangles': door_t},
        ],
        'preserveRoof': True,
        'open': [
            'The third-row arched windows (west wall of the spine, 4 columns), the brick hoods over the windows and the '
            'carved medallions are not drawn.',
            'Where the portal stands along the north wall is INFERRED (centred); no photograph shows both ends of that wall.',
            'Every wall without a square-on photograph repeats the north front. The spine reads 15.9 m on the scan; walls stop at 15.2 m.',
            'The entrance steps and terrace are not part of this model.',
        ],
    }
    OUT.write_text(json.dumps(spec, separators=(',', ':'), ensure_ascii=False), encoding='utf-8')
    print('wrote', OUT.relative_to(ROOT), OUT.stat().st_size, 'bytes;', len(edges), 'faces; portal at s = %.1f m of %.1f' % (s_mid, north['length']))


if __name__ == '__main__':
    main()
