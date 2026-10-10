"""Author the Raising Cane's recipe (data/apartments/raising-canes.json), the restaurant at 411 W MLK / Guadalupe.

The app drew this restaurant as the one-box OSM prism with a generic red band (data/places.geojson). Four walk
photographs show what it is: a one-storey rust-stucco box with beige stucco towers that stand above the roof,
a brick base, black metal awnings over dark shop-front glass, black canopies, and the real sign (a red board
reading Raising Cane's CHICKEN FINGERS) on the north and east towers.

Every number sits in a table below and is marked:
  PHOTO     read off one of the four photographs (the owner's walk of 2026-10-03; ids stay private)
  SCAN      read off the 2021 laser scan, cell by cell (0.5 m), in the recipe's own (u, v) frame
  INFERRED  no photograph of that part: drawn plainly and said so

Frame: the app's own oriented box of the OSM outline: +u runs along the long side (south-south-west, 18.7 deg
west of south), +v turns 90 deg anticlockwise from it (east-south-east). u = 0 is the NORTH end wall.
Run: python3 scripts/author_raising_canes.py  (writes the file; running it again gives the identical file).
Check only: python3 scripts/author_raising_canes.py --check [recipe.json]  (default: the committed recipe). Exit 1 if any detail
face lies entirely inside a block (a window, door, awning or canopy drawn behind the wall it belongs to). The write run makes
the same check on what it is about to write and refuses to write (exit 1) when it fails.
"""
from pathlib import Path
import json
import math
from compact_models import compact

PATH = Path(__file__).resolve().parents[1] / 'data/apartments/raising-canes.json'
ID = 'b32544f3-3221-480b-86bd-236b0eeb7be1'
FOOTPRINT = [[-97.742426, 30.281479], [-97.742432, 30.281481], [-97.742436, 30.281482], [-97.742377, 30.281637], [-97.742476, 30.281666],
             [-97.742536, 30.28151], [-97.742544, 30.281512], [-97.742586, 30.281404], [-97.742529, 30.281388], [-97.742525, 30.281399],
             [-97.742485, 30.281388], [-97.742475, 30.281413], [-97.742454, 30.281407], [-97.742426, 30.281479]]
# the app's own oriented box of FOOTPRINT (js/slopes-apartments.js obbOf), computed once with the same arithmetic
FRAME = {'o': [-97.74248323764735, 30.281668246049637], 'ax': -0.32037222275497057, 'ay': -0.9472917390577411,
         'mx': 96131.34742316582, 'my': 110540.0, 'L': 30.83501852988716, 'W': 11.914263092846422}

# ---- the shell (metres, in the recipe's (u, v) frame) ----
WALL_TOP = 5.0          # SCAN: wall tops read 4.9 to 5.3 m round the edge; the roof deck inside is 4.5 to 4.7
COPING = 0.25           # PHOTO: a black coping band on every wall and tower
BASE_H = 0.85           # PHOTO: tan brick base under the glass, about 0.7 to 0.9 m
# The OSM outline is 0.5 to 0.8 m wider than the walls: it includes the awnings. SCAN: the first return stops at
# v = 10.0 on the east wall and the walls stand at v = 1.3 on the west (awnings read 2 to 4 m high beyond them).
RING = [[0.0, 1.3], [18.1, 1.3], [18.1, 0.2], [30.6, 0.2],          # west wall north block, jog, west wall south block (SCAN)
        [30.6, 5.8], [29.4, 5.8], [29.4, 9.8], [26.5, 9.8],         # south end steps in (OSM outline; INFERRED, no photograph)
        [26.5, 11.9], [18.1, 11.9], [18.1, 10.0], [0.0, 10.0]]      # east wall south block (OSM) and north block (SCAN)
# towers: name -> plan [u0, u1, v0, v1], top height. SCAN for the plan, PHOTO for the face that carries the sign.
TOWERS = {
    'north': dict(plan=[-0.3, 1.5, 2.75, 7.75], top=6.3),   # SCAN: 6.2 to 6.4 m, 5 m wide, 1.5 m deep; PHOTO (north view): the big sign tower
    'east':  dict(plan=[2.5, 5.5, 8.0, 10.3], top=6.1),     # SCAN 6.0 to 6.1 m at u 2.5-5.5 on the east wall; PHOTO (east view): door + round sign
    'west':  dict(plan=[10.5, 14.5, 0.9, 2.6], top=6.1),    # SCAN 6.0 to 6.2 m at u 10.5-14.5 on the west wall; PHOTO (north view): narrow tower, vertical sign
    'southwest': dict(plan=[28.5, 30.6, 0.2, 2.2], top=6.0),  # SCAN 5.9 to 6.2 m; no photograph (INFERRED plain beige)
}
ROOF_ITEMS = [   # SCAN: boxes standing on the roof (air-conditioning units, 5.8 to 6.0 m top); PHOTO: grey boxes behind the east parapet
    dict(plan=[13.5, 16.5, 3.0, 8.0], top=6.0), dict(plan=[8.0, 9.5, 4.0, 7.5], top=5.9),
]

# ---- colours: photographed, overcast, then set by ratio. R: rust 128, beige 199, brick 154 in the photograph ----
COLOURS = {
    'rust': '#8a4a33', 'beige': '#c9bda4', 'brick': '#a89680', 'black': '#26272b', 'dkGlass': '#34312f',
    'signRed': '#b3202a', 'muralRed': '#9c1f27', 'white': '#f1ede6', 'yellow': '#f2c230', 'roofFlat': '#7a7b78',
    'pylonRed': '#8c0b1c',
}

# ---- openings: PHOTO unless noted. z in metres above the pavement ----
GLASS_Z = (0.95, 2.75)         # PHOTO: glass from just over the brick base to under the awning/canopy (door about 2.2 m)
CANOPY_Z, CANOPY_T = 2.85, 0.14    # PHOTO: the black canopy over the north windows and the doors, top of the slab
AWNING = dict(z0=2.95, z1=3.55, out=1.25)   # PHOTO: the black standing-seam awnings, 1.2 m out, 0.6 m deep on the slope
FRAME_W, GLASS_PROUD, FRAME_PROUD = 0.07, 0.10, 0.06
# Every detail stands this far (m) OUT from the outer face of the block it belongs to: the wall (shell) or the tower that
# carries it. Zero would leave the back of each box in the wall plane; this keeps it just clear of it. The face is worked
# out from the blocks (outer_plane below), never typed in, so a tower that grows out of a wall carries its own door.
STANDOFF = 0.02
BURIED_EPS = 0.005     # m: a detail face counts as inside a block only if every corner is deeper than this
# each: wall, a, b (metres along the wall), kind. wall N = the north end (along v); E = the east side (along u); W = the west
# side (along u). The wall's position at a..b comes from the blocks: u 0 or the north tower, v 10.0 / 10.3 / 11.9 on the east
# side, v 1.3 or the west tower on the west side (outer_plane).
OPENINGS = [
    # north end: window under its own awning left of the tower (ends 2.68 so its frame stops at the tower's side, v 2.75), two windows under the canopy (PHOTO north view)
    ('N', 1.55, 2.68, 'win'), ('N', 3.1, 4.95, 'win'), ('N', 5.25, 7.4, 'win'), ('N', 8.0, 9.7, 'win'),
    # east wall: wing windows and the door in the east tower (PHOTO east view); u 18 on is INFERRED
    ('E', 0.4, 2.1, 'win'), ('E', 3.55, 4.55, 'door'), ('E', 6.2, 9.0, 'win'), ('E', 9.8, 10.5, 'win'),
    ('E', 19.2, 21.8, 'win'), ('E', 22.6, 25.2, 'win'),
    # west wall: two windows under two awnings, a door in the west tower (PHOTO north view)
    ('W', 4.4, 7.0, 'win'), ('W', 7.6, 10.0, 'win'), ('W', 11.8, 13.2, 'door'), ('W', 15.2, 17.4, 'win'),
]
AWNINGS = [('E', 5.9, 9.3), ('E', 0.2, 2.4), ('W', 4.2, 7.2), ('W', 7.4, 10.2), ('N', 7.9, 9.9), ('E', 19.0, 22.0), ('E', 22.4, 25.4)]
CANOPIES = [('N', 1.5, 9.5, 1.0), ('E', 2.4, 5.7, 1.1), ('W', 11.3, 13.7, 1.0)]   # wall, from, to, depth

# ---- the signs: a red board with white lettering and a yellow strip (PHOTO). Plain shapes and the dot font only. ----
SIGN_BOARD = (3.0, 1.35)       # PHOTO: about 2.6 to 3 m wide, 1.2 to 1.4 m high on both towers
SIGNS = [   # tower, face key, centre along the tower face (m from its low-u/low-v end), bottom z
    ('north', 'u0', 2.5, 3.9),
    ('east', 'v1', 1.5, 3.6),
]
SIGN_LINES = [   # text, dot, gap, tone, bottom z above the board's foot, width is worked out from the dot font (5 dots a letter)
    ('RAISING', 0.032, 0.032, 'white', 1.02),
    ("CANE'S", 0.075, 0.075, 'white', 0.42),
    ('CHICKEN FINGERS', 0.02, 0.02, 'black', 0.18),
]
MURAL_LINES = [("CANE'S", 0.06, 0.06, 'white', 1.55), ('ONE LOVE', 0.05, 0.05, 'white', 0.95)]   # PHOTO: the words on the red panel
MURAL = dict(u0=11.0, u1=14.0, z0=0.8, z1=3.0)   # PHOTO (east view): the red wall panel, ONE LOVE (Austin)
PYLON = dict(u0=-0.7, u1=0.0, v0=2.0, v1=3.5, z0=0.5, z1=4.8)   # PHOTO (north view): the big red numeral 1 at the corner of the north tower
DECIMALS = 3


def text_w(text, dot, gap):
    return len(text) * (5 * dot + gap) - gap


def lines(items, centre, zb, mirror=False):
    return [dict(text=t, s0=round(centre - text_w(t, dot, gap) / 2, 3), z0=round(zb + dz, 3), dot=dot, gap=gap, tone=tone) for t, dot, gap, tone, dz in items]


def verts_box(u0, u1, v0, v1, z0, z1):
    """Five faces of a box (no bottom), each with its own four vertices, wound to face outward."""
    faces = [([(u0, v0, z1), (u1, v0, z1), (u1, v1, z1), (u0, v1, z1)], (0, 0, 1)),
             ([(u0, v0, z0), (u1, v0, z0), (u1, v0, z1), (u0, v0, z1)], (0, -1, 0)),
             ([(u0, v1, z0), (u1, v1, z0), (u1, v1, z1), (u0, v1, z1)], (0, 1, 0)),
             ([(u0, v0, z0), (u0, v1, z0), (u0, v1, z1), (u0, v0, z1)], (-1, 0, 0)),
             ([(u1, v0, z0), (u1, v1, z0), (u1, v1, z1), (u1, v0, z1)], (1, 0, 0))]
    return faces


class Mesh:
    def __init__(self):
        self.v, self.t = [], []

    def box(self, u0, u1, v0, v1, z0, z1):
        for q, want in verts_box(u0, u1, v0, v1, z0, z1):
            n = len(self.v)
            self.v.extend([[round(c, DECIMALS) for c in p] for p in q])
            e1 = [q[1][i] - q[0][i] for i in range(3)]
            e2 = [q[2][i] - q[0][i] for i in range(3)]
            nrm = (e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0])
            fwd = sum(nrm[i] * want[i] for i in range(3)) > 0
            self.t.extend([[n, n + 1, n + 2], [n, n + 2, n + 3]] if fwd else [[n, n + 2, n + 1], [n, n + 3, n + 2]])

    def wall_box(self, wall, a, b, z0, z1, off0, off1, plane):
        """A box on a wall: a..b along it, from `off0` to `off1` metres out from `plane` (the outer face of the block
        that carries it, from outer_plane) plus STANDOFF."""
        o0, o1 = off0 + STANDOFF, off1 + STANDOFF
        if wall == 'N':
            self.box(plane - o1, plane - o0, a, b, z0, z1)
        elif wall == 'E':
            self.box(a, b, plane + o0, plane + o1, z0, z1)
        else:
            self.box(a, b, plane - o1, plane - o0, z0, z1)


def _edge_cross(ring, axis, t):
    """Coordinates on the other axis where the polygon outline crosses the line axis == t."""
    out = []
    for i in range(len(ring)):
        p, q = ring[i], ring[(i + 1) % len(ring)]
        if (p[axis] - t) * (q[axis] - t) < 0 or (p[axis] == t and q[axis] == t):
            if p[axis] == q[axis]:
                out += [p[1 - axis], q[1 - axis]]
            else:
                k = (t - p[axis]) / (q[axis] - p[axis])
                out.append(p[1 - axis] + k * (q[1 - axis] - p[1 - axis]))
        elif p[axis] == t:
            out.append(p[1 - axis])
    return out


def outer_plane(wall, a, b, step=0.05):
    """(outermost, innermost) position of the blocks' outer face along a..b of a wall: u for N (smallest), v for E (largest)
    and W (smallest). The shell is the ring; a tower counts wherever its plan crosses the span. Details sit on the
    outermost, so nothing is left behind a tower that stands proud of the wall."""
    n = max(1, int(round((b - a) / step)))
    ts = [a + (b - a) * i / n for i in range(n + 1)]
    ring = RING
    vals = []
    for t in ts:
        if wall == 'N':      # along v; the face is the smallest u
            c = _edge_cross(ring, 1, t)
            cand = ([min(c)] if c else []) + [tw['plan'][0] for tw in TOWERS.values() if tw['plan'][2] <= t <= tw['plan'][3]]
            vals.append(min(cand))
        else:                # along u; E: the largest v, W: the smallest v
            c = _edge_cross(ring, 0, t)
            tows = [tw['plan'] for tw in TOWERS.values() if tw['plan'][0] <= t <= tw['plan'][1]]
            if wall == 'E':
                vals.append(max(([max(c)] if c else []) + [p[3] for p in tows]))
            else:
                vals.append(min(([min(c)] if c else []) + [p[2] for p in tows]))
    return (min(vals), max(vals)) if wall == 'N' or wall == 'W' else (max(vals), min(vals))


def plane_of(wall, a, b, level=True):
    """The outer face under a..b. `level`: the span must not cross a step in the wall (a window or a door has one plane)."""
    out, inn = outer_plane(wall, a, b)
    if level and abs(out - inn) > 1e-6:
        raise SystemExit('detail %s %.2f..%.2f crosses a step in the wall (%.2f to %.2f): split it' % (wall, a, b, out, inn))
    return out


def build():
    meshes = {k: Mesh() for k in ('dkGlass', 'black', 'signRed', 'muralRed', 'white', 'yellow', 'pylonRed')}
    # windows: a black frame and the dark glass in front of it. Each sits on the outer face of the block under it.
    for wall, a, b, kind in OPENINGS:
        z0, z1 = GLASS_Z if kind == 'win' else (0.1, 2.3)
        pl = plane_of(wall, a, b)
        meshes['black'].wall_box(wall, a - FRAME_W, b + FRAME_W, z0 - FRAME_W, z1 + FRAME_W, 0.0, FRAME_PROUD, pl)
        meshes['dkGlass'].wall_box(wall, a, b, z0, z1, 0.0, GLASS_PROUD, pl)
        if b - a > 1.8 and kind == 'win':       # PHOTO: the wide windows have one mullion down the middle
            m = (a + b) / 2
            meshes['black'].wall_box(wall, m - 0.03, m + 0.03, z0, z1, 0.0, GLASS_PROUD + 0.02, pl)
    # canopies (slab on the wall) and awnings (a thin box, sloping not drawn: INFERRED as a flat black slab)
    for wall, a, b, d in CANOPIES:      # one slab may run across a step (the north and door towers): it starts at the INNERMOST
        # face, so it is joined to the wall along its whole length and has a straight front edge; where a tower stands proud
        # the slab's back sits inside the tower, never a face of it (the check below only looks at whole faces)
        meshes['black'].wall_box(wall, a, b, CANOPY_Z - CANOPY_T, CANOPY_Z, 0.0, d, outer_plane(wall, a, b)[1])
    for wall, a, b in AWNINGS:
        pl = plane_of(wall, a, b)
        meshes['black'].wall_box(wall, a, b, AWNING['z1'] - 0.1, AWNING['z1'], 0.0, AWNING['out'] * 0.55, pl)
        meshes['black'].wall_box(wall, a, b, AWNING['z0'], AWNING['z0'] + 0.12, AWNING['out'] * 0.55, AWNING['out'], pl)
    # red mural panel on the east wall, and the pylon "1"
    meshes['muralRed'].wall_box('E', MURAL['u0'], MURAL['u1'], MURAL['z0'], MURAL['z1'], 0.0, 0.05, plane_of('E', MURAL['u0'], MURAL['u1']))
    P = PYLON
    meshes['pylonRed'].box(P['u0'], P['u1'], P['v0'], P['v1'], P['z0'], P['z1'])
    # sign boards on the tower faces (the lettering is added as dot-font `signs` on the tower blocks)
    for tower, key, centre, zb in SIGNS:
        u0, u1, v0, v1 = TOWERS[tower]['plan']
        w, h = SIGN_BOARD
        if key == 'u0':
            meshes['signRed'].box(u0 - 0.03, u0, v0 + centre - w / 2, v0 + centre + w / 2, zb, zb + h)
            meshes['yellow'].box(u0 - 0.045, u0, v0 + centre - w / 2 + 0.25, v0 + centre + w / 2 - 0.25, zb + 0.12, zb + 0.32)
        else:
            meshes['signRed'].box(u0 + centre - w / 2, u0 + centre + w / 2, v1, v1 + 0.03, zb, zb + h)
            meshes['yellow'].box(u0 + centre - w / 2 + 0.25, u0 + centre + w / 2 - 0.25, v1, v1 + 0.045, zb + 0.12, zb + 0.32)
    return meshes


def main():
    d = {
        'name': "Raising Cane's", 'id': ID,
        # remove the generic storefront slabs, doors and brand label that share this building id (js/slopes-apartments.js
        # hides the places-* and entrances-* layers for it); the recipe draws its own doors, glass and sign
        'replaceFrontage': True,
        'sources': {
            'footprint': 'data/snapshots/2026-10-05/buildings.detailed.geojson, feature ' + ID,
            'reference': "four street photographs of the restaurant, taken 2026-10-03, and the 2021 laser scan read in the recipe's own (u, v) frame",
            'dimensions': 'Walls at the laser scan (east v 10.0, west v 1.3, wall tops 4.9 to 5.3 m, towers 6.0 to 6.4 m). Window, awning, canopy and sign sizes are read off the photographs by ratio to the 2.2 m door and the 6.2 m tower; they are not survey measurements. The south end (u 18 to 30.6) is unphotographed.',
        },
        'footprint': {'ring': FOOTPRINT},
        'frame': {'obb': FRAME},
        'levels': {'floors': [0, WALL_TOP]},
        'colours': {k: {'hex': v} for k, v in COLOURS.items()},
        'skins': {
            'rust': {'kind': 'flat', 'field': 'rust'},
            'beige': {'kind': 'flat', 'field': 'beige'},
            'brick': {'kind': 'flat', 'field': 'brick'},
        },
        'materials': {'brick': 'brick'},
        'blocks': [],
        'detailMeshes': [],
        'open': ['The south end (u 18 to 30.6) is not in any photograph: plain rust stucco with two windows.',
                 'Awnings are flat slabs, not sloped. The freestanding pole sign, the roof railing, the ramp and the planters are not drawn.'],
    }
    # the shell
    main_block = {'id': 'shell', 'plan': {'ring': RING}, 'z0': 0, 'z1': WALL_TOP,
                  'bands': [{'z0': 0, 'z1': BASE_H, 'skin': 'brick'}, {'z0': BASE_H, 'z1': WALL_TOP, 'skin': 'rust'}],
                  'roofTone': 'roofFlat', 'parapet': COPING, 'parapetTone': 'black',
                  'roofItems': [dict(plan=r['plan'], h=r['top'] - WALL_TOP, tone='roofFlat') for r in ROOF_ITEMS],
                  '_src': 'SCAN for walls and heights; see sources.dimensions'}
    mc = (MURAL['u0'] + MURAL['u1']) / 2
    main_block['faces'] = {'10': {'bands': [{'z0': 0, 'z1': BASE_H, 'skin': 'brick'},
                                           {'z0': BASE_H, 'z1': WALL_TOP, 'skin': 'rust', 'signs': lines(MURAL_LINES, 18.1 - mc, MURAL['z0'])}]}}
    d['blocks'].append(main_block)
    for name, t in TOWERS.items():
        u0, u1, v0, v1 = t['plan']
        blk = {'id': 'tower-' + name, 'plan': [u0, u1, v0, v1], 'z0': 0, 'z1': t['top'],
               'bands': [{'z0': 0, 'z1': BASE_H, 'skin': 'brick'}, {'z0': BASE_H, 'z1': t['top'], 'skin': 'beige'}],
               'roofTone': 'roofFlat', 'parapet': COPING, 'parapetTone': 'black', 'cap': True}
        for tw, key, centre, zb in SIGNS:
            if tw == name:
                face_len = (v1 - v0) if key == 'u0' else (u1 - u0)
                blk['faces'] = {key: {'bands': [{'z0': 0, 'z1': BASE_H, 'skin': 'brick'},
                                                {'z0': BASE_H, 'z1': t['top'], 'skin': 'beige', 'signs': lines(SIGN_LINES, centre, zb)}]}}
        d['blocks'].append(blk)
    meshes = build()
    for tone, m in meshes.items():
        if m.v:
            d['detailMeshes'].append({'id': 'canes-' + tone, 'tone': tone, 'vertices': m.v, 'triangles': m.t})
    return d


def _in_poly(ring, u, v):
    """Point in polygon (ray casting) and the distance to the outline."""
    inside, dmin = False, 1e9
    for i in range(len(ring)):
        (x1, y1), (x2, y2) = ring[i], ring[(i + 1) % len(ring)]
        if (y1 > v) != (y2 > v) and u < x1 + (v - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
        dx, dy = x2 - x1, y2 - y1
        k = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((u - x1) * dx + (v - y1) * dy) / (dx * dx + dy * dy)))
        dmin = min(dmin, math.hypot(u - (x1 + k * dx), v - (y1 + k * dy)))
    return inside, dmin


def depth_in_block(blk, p):
    """How far inside the block the point p = (u, v, z) is, in metres (0 or less: on the surface or outside)."""
    plan = blk['plan']
    if isinstance(plan, dict):
        ring = plan['ring']
        inside, dist = _in_poly(ring, p[0], p[1])
        d_plan = dist if inside else -dist
    else:
        u0, u1, v0, v1 = plan
        d_plan = min(p[0] - u0, u1 - p[0], p[1] - v0, v1 - p[1])
    return min(d_plan, p[2] - blk['z0'], blk['z1'] - p[2])


def buried_faces(d):
    """Every detail triangle whose three corners are all deeper than BURIED_EPS inside ONE block: it is drawn behind a wall.
    Returns [(mesh id, box number, block id, depth of the shallowest corner)]. A face lying ON a wall is not buried."""
    out = []
    for m in d['detailMeshes']:
        for i, tri in enumerate(m['triangles']):
            pts = [m['vertices'][j] for j in tri]
            for blk in d['blocks']:
                depth = min(depth_in_block(blk, p) for p in pts)
                if depth > BURIED_EPS:
                    out.append((m['id'], i // 10, blk['id'], depth))
                    break
    return out


def report_buried(d):
    """Print the buried details, one line per box (ten triangles each); return how many boxes."""
    boxes = {}
    for mid, box, blk, depth in buried_faces(d):
        k = (mid, box)
        n, deepest, _ = boxes.get(k, (0, 0.0, blk))
        boxes[k] = (n + 1, max(deepest, depth), blk)
    for (mid, box), (n, deepest, blk) in sorted(boxes.items()):
        vs = [d_ for d_ in d['detailMeshes'] if d_['id'] == mid][0]['vertices'][box * 20:(box + 1) * 20]
        lo = [round(min(p[i] for p in vs), 2) for i in range(3)]
        hi = [round(max(p[i] for p in vs), 2) for i in range(3)]
        print('  BURIED %s box %d: %d of 10 triangles inside block %s, up to %.2f m deep; u %s..%s v %s..%s z %s..%s'
              % (mid, box, n, blk, deepest, lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]))
    return len(boxes)


def report_unregistered(d, index_path):
    """A new building recipe must be registered or the old generic box stays standing INSIDE the new walls: its file, id and
    name in data/apartments/index.json (files, replacedBuildingIds, replacedNames) and replaceFrontage in the recipe (removes
    the generic storefront slabs). Returns the number of missing pieces, each printed."""
    idx = json.loads(Path(index_path).read_text(encoding='utf-8'))
    missing = []
    if PATH.name not in [Path(f).name for f in idx.get('buildings', idx.get('files', []))]:
        missing.append('index.json does not list ' + PATH.name)
    if d.get('id') not in idx.get('replacedBuildingIds', []):
        missing.append('index.json replacedBuildingIds lacks ' + str(d.get('id')))
    if d.get('name') not in idx.get('replacedNames', []):
        missing.append('index.json replacedNames lacks ' + str(d.get('name')))
    if d.get('replaceFrontage') is not True:
        missing.append('the recipe has no replaceFrontage: true (the generic storefront slabs would stay)')
    for m in missing:
        print('  UNREGISTERED:', m)
    return len(missing)


if __name__ == '__main__':
    import sys
    INDEX = PATH.parent / 'index.json'
    if '--check' in sys.argv:
        rest = [a for a in sys.argv[1:] if a != '--check']
        src = Path(rest[0]) if rest else PATH
        doc = json.loads(src.read_text(encoding='utf-8'))
        n = report_buried(doc)
        print('%s: %d detail boxes buried inside a block' % (src, n))
        u = report_unregistered(doc, INDEX)
        sys.exit(1 if (n or u) else 0)
    d = main()
    if report_buried(d):
        sys.exit('refusing to write: details are drawn inside the blocks they belong to')
    PATH.write_text(compact(json.dumps(d, indent=1)), encoding='utf-8')
    print('wrote', PATH, len(PATH.read_bytes()), 'bytes; no detail face is inside a block')
