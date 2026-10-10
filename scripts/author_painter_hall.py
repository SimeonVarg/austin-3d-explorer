#!/usr/bin/env python3
"""Author T. S. Painter Hall (UT campus) from measured numbers. Run from the repo root:

    python3 scripts/author_painter_hall.py     # writes data/apartments/painter-hall.json; safe to run again

Why this file exists. Painter Hall had only the generic campus-hall recipe baked into data/campus_buildings.json
(3.4 m bays, four rows of one size on every wall). The first draft of this file drew dark grey-brown brick, a flat grey
slab with a black hole for the entrance, and plain squares for windows. Every number below is marked:

  SCAN      the 2021 laser scan, read in the building's own grid (0.5 m cells): the north wing's first returns climb
            from 15.1 m at the north eave to a ridge of 21.9 m (a 30 degree hip); the spine reads 15.9 m; the map
            outline gives the wall lengths (north front 51.7 m, the court's east wall 19.3 m).
  PHOTO     read off photographs of the building, always as RATIOS inside one flattened photograph:
            - the NORTH FRONT, the most square-on view (an ultra-wide frame, flattened to a straight-on drawing, right wing:
              lens check 11.8 mm against 12.1 mm, i.e. 2%). Window pitch 278 drawing px; glass 130 x 182; storey
              (window top to window top) 372; string courses; the frieze row; the base. Counted: 4 storeys = a
              stone base, TWO brick storeys, and a cream frieze storey that carries the top row of windows.
              (The first draft said "three brick storeys": the photograph shows two.)
            - the ENTRANCE, a close frontal view: door opening 218 px wide, 315 px tall; the whole stone frame
              645 px wide (2.96 door widths), 2.97 door widths from the door sill to the top of the entablature;
              two fluted columns, two pink marble discs, two lamps, the name over the door; the window over it
              with a stone-railed balcony.
            - the COURT'S EAST WALL ("spine west wall"), flattened to a straight-on drawing: a left block of four arched
              windows on the third row over four plain ones, a full-height stone pier, a right block of three
              plain columns; the top row in stone-framed pairs.
            - colours: median patches of the flattened photographs, as RATIOS of brick to limestone (see COLOURS).
  INFERRED  every wall nobody photographed square-on (east and west ends, south walls, the other court walls):
            the north front's rows repeated. The scale in metres (see below). Where the portal stands along the
            wall. The steps' run. The base windows' sills (the hedge hides them).

SCALE. Photographs give ratios, not metres. The scale of the north front is fixed three ways that agree:
  1. SCAN: the eave is 15.2 m; the flattened drawing has the eave 1490 px above the foot (98 px per metre).
  2. the camera: the photograph's eye is 1.6 m up; the horizon line in the frame and the eave 714 px above it put the
     wall about 15 m away, which gives the same 3.8 m storey.
  3. a window pane is 21.7 drawing px wide = 0.22 m, an ordinary 6-over-6 pane.
  The door sill then reads 1.6 m above the wall foot (about 8 steps), not the 3.5 m the first draft chained out of
  a guessed bay.
The court's east wall is flattened at 73.5 px per metre from its own 19.3 m wall length; its storey reads 3.8 m
as well, which is the cross-check between the two walls.
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/apartments/painter-hall.json'
BUILDING_ID = '82bcddc0-ec33-4a0a-a9f2-f380a838a40f'
SNAPSHOT = sorted((ROOT / 'data/snapshots').glob('*/buildings.detailed.geojson'))[-1]
DECIMALS = 3

# ======================================================================================== heights (m above the wall foot)
WALL_TOP = 15.2          # SCAN: first returns 15.1 at the north eave; the baked tile roof's own base is 15.2.
                         # The court's east wall reads 15.9 on the scan; the walls stop at the shared eave (open item).

# ======================================================================================== NORTH FRONT (PHOTO, 98 px/m)
BAY = 2.83               # PHOTO: window pitch 278 px / 98
STORIES = dict(          # glass bottoms and heights (z of the glass, m). Drawing px -> z = (1505 - y) / 98.
    base=(1.00, 1.75),   # PHOTO: base window top at drawing y 1220 (z 2.9 outer); sill hidden by the hedge: INFERRED
    row1=(4.80, 1.80),   # PHOTO: glass y 1035..862
    row2=(8.55, 1.80),   # PHOTO: glass y 672..490 (a storey of 3.75..3.85 m)
    frieze=(12.45, 1.75),  # PHOTO: glass y 290..118
)
STRING1 = (4.35, 4.65)   # PHOTO: stone course at drawing y 1078..1050 (base top)
STRING2 = (12.10, 12.40)  # PHOTO: y 320..292, the frieze's foot
GLASS_W = 1.33           # PHOTO: 130 px
FRAME = dict(jamb=0.08, head=0.20, sill=0.16, proud=0.05, sill_proud=0.10)   # PHOTO: 145 px outer, head 20 px, sill 16 px
HOOD = dict(h=0.28, extra=0.22, proud=0.025)       # PHOTO: the flat brick arch (ruddier) over each brick-row window
PANES = dict(cols=[i / 6 for i in range(1, 6)], rows=[i / 6 for i in range(1, 6)], w=0.03)     # PHOTO: 6 over 6, panes 0.22 x 0.30 m
FRIEZE_CENTRE_W, FRIEZE_SIDE_W = 1.05, 0.24         # PHOTO: a triple: sash 103 px, side lights 25 px, stone between
FRIEZE_SIDE_OFF = 0.58                              # PHOTO: side light centre from the sash centre (55 px / 98)
COLUMN_FROM_PORTAL = 1.70    # PHOTO: first window column is 1.7 bays from the portal's axis, then one bay each way
COLUMNS_EACH_SIDE = 7        # INFERRED: 7 each side leaves 3.4 m at each end for the corner pier
CORNER_PIER = 1.15           # PHOTO (an oblique view of the east end): a flush stone pier, full height
CORNICE = dict(z=(14.85, 15.2), proud=0.22)         # PHOTO: a stone cornice under the eave
RAFTER = dict(pitch=0.75, w=0.18, h=0.26, proud=0.55, z=(14.85, 15.11))   # PHOTO: rafter tails under the tile edge, dark wood

# ======================================================================================== ENTRANCE (PHOTO, ratios of the door width)
DOOR_W = 2.33            # PHOTO: the door opening is 125 px of the 53.6 px/m scale of the wide frame
PORTAL_AT = 0.5          # INFERRED: along the 51.7 m wall (the columns both sides of it are symmetrical in the photograph)
SILL = 1.60              # PHOTO+SCAN: door sill above the wall foot (the door top is 0.2 door widths over string 1)
DOOR_TOP = 5.00          # PHOTO: opening 315 px tall / 218 = 1.45 widths = 3.4 m
PORTAL = dict(
    panel_half=2.45, panel_proud=0.38, panel_top=8.37,     # PHOTO: the ashlar field between the columns, 450 px = 2.06 door widths
    door_half=1.0, leaf_split=2.9, leaf_top=4.0,            # PHOTO: leaves 1.6..4.0, transom grille 4.0..5.0, the lit panes above 2.9
    frame_jamb=0.20, frame_head=0.30, frame_proud=0.20,    # PHOTO: a moulded stone frame round the door
    col_off=2.85, col_w=0.55, col_z=(4.75, 7.15), col_proud=0.58,        # PHOTO: shaft centre +-2.9 m, 50 px wide
    cap_w=0.78, cap_z=(7.15, 7.75), corbel_w=0.55, corbel_z=(3.85, 4.75), corbel_proud=0.5,
    ent_half=3.40, ent_z=(7.75, 8.55), ent_proud=0.75,      # PHOTO: the entablature, 645 px wide = 6.9 m, from 7.7 to 8.5
    name_z=7.88, name_h=0.22,                               # PHOTO: "T. S. PAINTER HALL" over the door
    urn_z=(8.55, 9.95), urn_w=0.50,                         # PHOTO: a finial over each column, 1.4 m tall
    disc_off=1.60, disc_z=6.85, disc_r=0.37, disc_proud=0.06,   # PHOTO: two pink marble discs
    lamp_off=1.88, lamp_z=(4.05, 4.60), lamp_w=0.30, lamp_proud=0.32,   # PHOTO: lanterns beside the door
    win_half=1.07, win_z=(8.55, 10.35),                     # PHOTO: the window over the door, 2.14 m wide
    win_frame=0.22, win_proud=0.20,
    balc_half=2.1, balc_proud=0.95, balc_z=(10.85, 11.18), rail_h=0.95, rail_pitch=0.24,    # PHOTO: stone-railed balcony, 4.2 m wide
    steps=8, step_run=0.33, stair_w=6.2, cheek_w=1.1, cheek_h=2.0,
    terrace_z=0.45, terrace_depth=5.0, terrace_w=11.0, broad=(0.30, 0.15, 0.55, 0.75), broad_w=24.0,   # PHOTO: a brick terrace, then three broad steps across the whole front (depth INFERRED)   # PHOTO (8 treads up from the terrace); run INFERRED
)

# ======================================================================================== COURT'S EAST WALL (PHOTO, flattened, 73.5 px/m)
WE = dict(
    length=19.3,
    px_per_m=73.5, left_x=[117, 312, 508, 700], arch_x=[117, 312, 508, 700], right_x=[1025, 1195, 1360],
    row2_x=[135, 295, 520, 680, 1025, 1195, 1360], frieze_x=[140, 300, 520, 685, 1025, 1195, 1360],
    base_x=[140, 295, 1195, 1365],
    pier=(810, 875), pier_proud=0.12,
    string1=(4.40, 4.62), row2=(4.86, 1.95), arch_glass=(8.66, 1.85), arch_top=11.45, arch_rise_ratio=0.40,
    sill3=(8.40, 8.58), imposts=(10.95, 11.10),
    row3_right=(8.70, 1.85), frieze=(12.66, 1.75), cornice=(15.35, 15.9),
    win_w=1.25, arch_w=1.27, surround=0.23, arch_trim=0.22,
)

# ======================================================================================== colours
# THE LESSON (the first review of this building): a tone read off an overcast evening photograph draws dark. So no tone is taken
# as measured. The limestone is anchored to the tone that draws as cream in daylight in this app (the same limestone
# as Welch Hall's, sampled in sun), and the brick is that stone times the RATIO brick / limestone measured inside
# the same flattened photograph, so the light of the photograph cancels:
#   north front : brick 189,169,147 / base stone 216,218,214 = .875 .775 .687   (PHOTO)
#   court wall  : brick 128,110, 87 / stone pier  187,183,171 = .684 .601 .509   (PHOTO, shaded court)
# The north front is the wall that is compared, so its ratio is used. (A first try eased it toward the court's and
# the brick still drew brown-grey in the shade; the stone in shade is blue, so the brick needs the full ratio.)
STONE_DAY = (0xef, 0xe9, 0xdc)
BRICK_OVER_STONE = (0.875, 0.775, 0.687)
HOOD_OVER_BRICK = (0.95, 0.88, 0.82)         # PHOTO: the soldier arches over the windows are ruddier than the wall


def hexof(rgb):
    return '#%02x%02x%02x' % tuple(max(0, min(255, round(c))) for c in rgb)


BRICK_DAY = tuple(s * r for s, r in zip(STONE_DAY, BRICK_OVER_STONE))
COLOURS = {
    'ptBrick': hexof(BRICK_DAY),
    'ptHood': hexof(tuple(c * r for c, r in zip(BRICK_DAY, HOOD_OVER_BRICK))),
    'ptStone': hexof(STONE_DAY),
    'ptPane': '#8794a1',       # PHOTO: the panes read dark grey-blue with pale blinds. NOT named *glass*: the app mirrors the sky on any colour whose name says glass (check 7b)
    'ptFrame': '#d9d5c9',      # PHOTO: painted sashes, pale
    'ptDoor': '#6c8571',       # PHOTO: weathered green-grey doors
    'ptAmber': '#e9b45e',      # PHOTO: the lit panes and the transom behind its grille
    'ptIron': '#2a2c2b',
    'ptMarble': '#c9968b',     # PHOTO: the pink marble discs
    'ptLamp': '#f4cf86',
    'ptPaver': '#a95b45',      # PHOTO: the red brick terrace in front of the steps
    'ptGranite': '#b4b2aa',    # PHOTO: the broad grey granite steps below the terrace
    'ptWood': '#4d3d30',       # PHOTO: rafter tails and soffit
    'ptRoofEdge': '#4a443e',
}
MATERIALS = {'ptBrick': 'brick', 'ptStone': 'stone'}


# ======================================================================================== geometry helpers
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


class Meshes:
    """Detail meshes by tone: boxes and prisms standing on a wall (s along it, d out of it, z up)."""

    def __init__(self, edge):
        self.e = edge
        self.m = {}

    def at(self, s, d, z):
        a, al, o = self.e['a'], self.e['along'], self.e['out']
        return [round(a[0] + al[0] * s + o[0] * d, DECIMALS), round(a[1] + al[1] * s + o[1] * d, DECIMALS), round(z, DECIMALS)]

    def _mesh(self, tone):
        return self.m.setdefault(tone, ([], []))

    def poly(self, tone, pts, quads):
        v, t = self._mesh(tone)
        n = len(v)
        v.extend(pts)
        for q in quads:                       # q = 4 indices, outward by right-hand rule
            t.extend([[n + q[0], n + q[1], n + q[2]], [n + q[0], n + q[2], n + q[3]]])

    def box(self, tone, s0, s1, d0, d1, z0, z1):
        if s1 <= s0 or z1 <= z0:
            return
        P = self.at
        pts = [P(s0, d0, z0), P(s1, d0, z0), P(s1, d1, z0), P(s0, d1, z0), P(s0, d0, z1), P(s1, d0, z1), P(s1, d1, z1), P(s0, d1, z1)]
        v, t = self._mesh(tone)
        n = len(v)
        v.extend(pts)
        c = [sum(p[i] for p in pts) / 8 for i in range(3)]
        for q in ((0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            a, b, cc = (pts[q[0]], pts[q[1]], pts[q[2]])
            e1 = [b[i] - a[i] for i in range(3)]
            e2 = [cc[i] - a[i] for i in range(3)]
            nrm = (e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0])
            mid = [sum(pts[k][i] for k in q) / 4 for i in range(3)]
            out = sum(nrm[i] * (mid[i] - c[i]) for i in range(3)) > 0
            ids = q if out else tuple(reversed(q))
            t.extend([[n + ids[0], n + ids[1], n + ids[2]], [n + ids[0], n + ids[2], n + ids[3]]])

    def disc(self, tone, s, z, r, d0, d1, sides=14):
        """A round plate on the wall (a prism with the same outward test as the boxes)."""
        P = self.at
        ring0 = [P(s + r * math.cos(2 * math.pi * k / sides), d0, z + r * math.sin(2 * math.pi * k / sides)) for k in range(sides)]
        ring1 = [P(s + r * math.cos(2 * math.pi * k / sides), d1, z + r * math.sin(2 * math.pi * k / sides)) for k in range(sides)]
        cen = P(s, d1, z)
        pts = ring0 + ring1 + [cen]
        mid = P(s, (d0 + d1) / 2, z)
        v, t = self._mesh(tone)
        n = len(v)
        v.extend(pts)
        tris = []
        for k in range(sides):
            k2 = (k + 1) % sides
            tris.append((2 * sides, sides + k, sides + k2))
            tris.append((k, k2, sides + k2))
            tris.append((k, sides + k2, sides + k))
        for a, b, c in tris:
            pa, pb, pc = pts[a], pts[b], pts[c]
            e1 = [pb[i] - pa[i] for i in range(3)]
            e2 = [pc[i] - pa[i] for i in range(3)]
            nrm = (e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0])
            cen3 = [(pa[i] + pb[i] + pc[i]) / 3 - mid[i] for i in range(3)]
            if sum(nrm[i] * cen3[i] for i in range(3)) < 0:
                b, c = c, b
            t.append([n + a, n + b, n + c])

    def out(self):
        res = []
        for tone, (v, t) in self.m.items():
            res.append({'id': 'painter-' + tone.replace('pt', '').lower(), 'tone': tone, 'vertices': v, 'triangles': t})
        return res


def window_dress(M, s0, s1, z0, z1, brick_hood=False, frame_tone='ptStone'):
    """Stone jambs, head and sill round a glass rectangle s0..s1 x z0..z1 (the glass sits in the wall)."""
    F = FRAME
    M.box(frame_tone, s0 - F['jamb'], s0, 0, F['proud'], z0 - F['sill'], z1 + F['head'] - 0.0)
    M.box(frame_tone, s1, s1 + F['jamb'], 0, F['proud'], z0 - F['sill'], z1 + F['head'] - 0.0)
    M.box(frame_tone, s0 - F['jamb'], s1 + F['jamb'], 0, F['proud'], z1, z1 + F['head'])
    M.box(frame_tone, s0 - F['jamb'] - 0.04, s1 + F['jamb'] + 0.04, 0, F['sill_proud'], z0 - F['sill'], z0)
    if brick_hood:
        H = HOOD
        M.box('ptHood', s0 - H['extra'], s1 + H['extra'], 0, H['proud'], z1 + F['head'], z1 + F['head'] + H['h'])


def opening(s0, s1, z0, z1, d=0.2, panes=True, **kw):
    o = dict(s0=round(s0, 3), s1=round(s1, 3), z0=round(z0, 3), z1=round(z1, 3), d=d, glass='ptPane', tone='ptStone', lit=False)
    if panes:
        o['mullion'] = dict(PANES, tone='ptFrame')
    o.update(kw)
    return o


# ======================================================================================== the north front
def north_front(edge, M, portal_s):
    """Bands with explicit openings (the window columns are NOT on one grid: they start 1.7 bays from the portal on
    each side), plus the stone dressings as detail meshes. Returns the face's bands."""
    L = edge['length']
    cols = []
    for sign in (-1, 1):
        for k in range(COLUMNS_EACH_SIDE):
            cols.append(portal_s + sign * (COLUMN_FROM_PORTAL + k) * BAY)
    cols.sort()
    hw = GLASS_W / 2
    base_o, brick_o, frieze_o = [], [], []
    for c in cols:
        b0, bh = STORIES['base']
        if abs(c - portal_s) > (COLUMN_FROM_PORTAL + 0.5) * BAY:          # the two nearest base windows stand behind the steps' cheek walls in the photograph
            base_o.append(opening(c - hw, c + hw, b0, b0 + bh))
            window_dress(M, c - hw, c + hw, b0, b0 + bh)
        for key in ('row1', 'row2'):
            z0, h = STORIES[key]
            brick_o.append(opening(c - hw, c + hw, z0, z0 + h))
            window_dress(M, c - hw, c + hw, z0, z0 + h, brick_hood=True)
        z0, h = STORIES['frieze']
        cw, sw = FRIEZE_CENTRE_W / 2, FRIEZE_SIDE_W / 2
        frieze_o.append(opening(c - cw, c + cw, z0, z0 + h, mullion=dict(cols=[0.5], rows=[0.5], w=0.03, tone='ptFrame')))
        for sg in (-1, 1):
            cc = c + sg * FRIEZE_SIDE_OFF
            frieze_o.append(opening(cc - sw, cc + sw, z0, z0 + h, panes=False))
        window_dress(M, c - FRIEZE_SIDE_OFF - sw, c + FRIEZE_SIDE_OFF + sw, z0, z0 + h)
    ww = PORTAL['win_half']      # the window over the entrance (PHOTO), same row as row 2
    brick_o.append(opening(portal_s - ww, portal_s + ww, PORTAL['win_z'][0], PORTAL['win_z'][1], mullion=dict(cols=[0.25, 0.5, 0.75], rows=[0.2, 0.4, 0.6, 0.8], w=0.04, tone='ptFrame')))
    for s0, s1 in ((0, CORNER_PIER), (L - CORNER_PIER, L)):          # flush stone corner piers
        M.box('ptStone', s0, s1, 0, 0.07, 0, WALL_TOP - 0.35)
    # the eave: stone cornice and the dark rafter tails under the tile edge
    M.box('ptStone', 0, L, 0, CORNICE['proud'], *CORNICE['z'])
    R = RAFTER
    n = int(L / R['pitch'])
    for i in range(n):
        c = (i + 0.5) * L / n
        M.box('ptWood', c - R['w'] / 2, c + R['w'] / 2, 0, R['proud'], *R['z'])
    return [
        dict(z0=0, z1=STRING1[0], skin='ptStone', openings=base_o),
        dict(z0=STRING1[0], z1=STRING1[1], skin='ptStone'),
        dict(z0=STRING1[1], z1=STRING2[0], skin='ptBrick', openings=brick_o),
        dict(z0=STRING2[0], z1=STRING2[1], skin='ptStone'),
        dict(z0=STRING2[1], z1=WALL_TOP, skin='ptStone', openings=frieze_o),
    ]


def portal(edge, portal_s, meshes_of, blocks, v_wall_at):
    """The carved stone entrance (see PORTAL): a block standing out of the wall with the door cut in it, columns,
    entablature with the name, finials, discs, lamps, the window over it with its balcony, and the steps."""
    P = PORTAL
    M = meshes_of
    c = portal_s
    # --- the door and its frame, cut into the panel block
    d_half = P['door_half']
    leaf = [
        dict(s0=P['panel_half'] - d_half, s1=P['panel_half'] + d_half, z0=SILL, z1=P['leaf_split'], d=0.30, tone='ptDoor'),
        dict(s0=P['panel_half'] - d_half, s1=P['panel_half'] + d_half, z0=P['leaf_split'], z1=P['leaf_top'], d=0.32, glass='ptAmber', tone='ptDoor',
             mullion=dict(cols=[0.25, 0.5, 0.75], rows=[0.5], w=0.07, tone='ptDoor')),
        dict(s0=P['panel_half'] - d_half, s1=P['panel_half'] + d_half, z0=P['leaf_top'], z1=DOOR_TOP, d=0.32, glass='ptAmber', tone='ptDoor',
             mullion=dict(cols=[i / 9 for i in range(1, 9)], rows=[], w=0.06, tone='ptIron')),
    ]
    name = 'T. S. PAINTER HALL'
    dot = round(P['name_h'] / 7, 4)
    gap = round(dot * 1.4, 4)
    text_w = len(name) * 5 * dot + (len(name) - 1) * gap
    sign = dict(text=name, s0=round(P['panel_half'] - text_w / 2, 3), z0=P['name_z'], dot=dot, gap=gap, tone='ptIron')
    band = dict(z0=0, z1=P['panel_top'], skin='ptStone', openings=leaf, signs=[sign])
    blocks.append(dict(
        id='painter-portal', plan=[round(c - P['panel_half'], 3), round(c + P['panel_half'], 3), 0, 0],   # filled by caller (uv)
        z0=0, z1=P['panel_top'], bands=[dict(z0=0, z1=P['panel_top'], skin='ptStone')], faces=dict(v0=None, v1=dict(bands=[band])),
        roofTone='ptStone', _src='PHOTO (entrance, ratios of the door width): door, transom, name; INFERRED: place on the wall'))
    # --- stone dressing (all in the wall's s along it, measured from its east end)
    pr = P['panel_proud']
    fj, fh, fp = P['frame_jamb'], P['frame_head'], P['frame_proud']
    M.box('ptStone', c - d_half - fj, c - d_half, 0, pr + fp, SILL, DOOR_TOP + fh)
    M.box('ptStone', c + d_half, c + d_half + fj, 0, pr + fp, SILL, DOOR_TOP + fh)
    M.box('ptStone', c - d_half - fj, c + d_half + fj, 0, pr + fp, DOOR_TOP, DOOR_TOP + fh)
    M.box('ptStone', c - d_half - fj - 0.1, c + d_half + fj + 0.1, 0, pr + fp + 0.12, DOOR_TOP + fh, DOOR_TOP + fh + 0.12)   # the small hood over the frame
    for sg in (-1, 1):
        cc = c + sg * P['col_off']
        # corbel, shaft, capital
        M.box('ptStone', cc - P['corbel_w'] / 2, cc + P['corbel_w'] / 2, 0, P['corbel_proud'], *P['corbel_z'])
        M.box('ptStone', cc - P['col_w'] / 2, cc + P['col_w'] / 2, 0, P['col_proud'], *P['col_z'])
        for k in (-1, 0, 1):                                  # the flutes: three slim dark-edged bars read as fluting from a distance
            M.box('ptHood', cc + k * P['col_w'] / 3 - 0.02, cc + k * P['col_w'] / 3 + 0.02, P['col_proud'] - 0.0, P['col_proud'] + 0.02, P['col_z'][0] + 0.15, P['col_z'][1] - 0.1)
        M.box('ptStone', cc - P['cap_w'] / 2, cc + P['cap_w'] / 2, 0, P['col_proud'] + 0.10, *P['cap_z'])
        # finial urn: base, belly, neck
        u0, u1 = P['urn_z']
        w = P['urn_w']
        M.box('ptStone', cc - w / 2, cc + w / 2, 0, P['ent_proud'] * 0.8, u0, u0 + 0.35 * (u1 - u0))
        M.box('ptStone', cc - w * 0.36, cc + w * 0.36, 0.05, P['ent_proud'] * 0.8 - 0.05, u0 + 0.35 * (u1 - u0), u0 + 0.75 * (u1 - u0))
        M.box('ptStone', cc - w * 0.22, cc + w * 0.22, 0.1, P['ent_proud'] * 0.8 - 0.1, u0 + 0.75 * (u1 - u0), u1)
        # discs and lamps
        M.disc('ptMarble', c + sg * P['disc_off'], P['disc_z'], P['disc_r'], pr - 0.01, pr + P['disc_proud'])
        lc = c + sg * P['lamp_off']
        M.box('ptIron', lc - 0.04, lc + 0.04, 0, P['lamp_proud'] - 0.12, P['lamp_z'][1] - 0.10, P['lamp_z'][1] - 0.04)
        M.box('ptLamp', lc - P['lamp_w'] / 2, lc + P['lamp_w'] / 2, P['lamp_proud'] - 0.28, P['lamp_proud'], *P['lamp_z'])
        M.box('ptIron', lc - P['lamp_w'] / 2 - 0.02, lc + P['lamp_w'] / 2 + 0.02, P['lamp_proud'] - 0.30, P['lamp_proud'] + 0.02, P['lamp_z'][1], P['lamp_z'][1] + 0.05)
    ez0, ez1 = P['ent_z']
    for sg in (-1, 1):                                    # the entablature breaks forward over each column; the name panel between stays flush
        cc = c + sg * P['col_off']
        M.box('ptStone', cc - P['cap_w'] / 2 - 0.08, cc + P['cap_w'] / 2 + 0.08, 0, P['ent_proud'], P['cap_z'][1], ez1 - 0.18)
    M.box('ptStone', c - P['ent_half'], c + P['ent_half'], 0, pr + 0.2, ez1 - 0.18, ez1)               # its cornice runs across
    M.box('ptStone', c - P['ent_half'] - 0.1, c + P['ent_half'] + 0.1, 0, P['ent_proud'], ez1 - 0.18, ez1 - 0.02)
    # --- the window over the door, in a stone frame, with the stone-railed balcony
    wz0, wz1 = P['win_z']
    ww, wf = P['win_half'], P['win_frame']
    M.box('ptStone', c - ww - wf, c - ww, 0, P['win_proud'], wz0 - 0.15, wz1 + 0.25)
    M.box('ptStone', c + ww, c + ww + wf, 0, P['win_proud'], wz0 - 0.15, wz1 + 0.25)
    M.box('ptStone', c - ww - wf, c + ww + wf, 0, P['win_proud'], wz1, wz1 + 0.25)
    M.box('ptStone', c - ww - wf, c + ww + wf, 0, P['win_proud'] + 0.05, wz0 - 0.15, wz0)
    bz0, bz1 = P['balc_z']
    bh = P['balc_half']
    M.box('ptStone', c - bh, c + bh, 0, P['balc_proud'], bz0, bz1)
    rt = 0.05
    M.box('ptStone', c - bh, c + bh, P['balc_proud'] - 0.08, P['balc_proud'], bz1 + P['rail_h'] - 0.07, bz1 + P['rail_h'])
    n = int(2 * bh / P['rail_pitch'])
    for i in range(n + 1):
        sc = c - bh + i * (2 * bh) / n
        M.box('ptStone', sc - rt / 2, sc + rt / 2, P['balc_proud'] - 0.08, P['balc_proud'] - 0.03, bz1, bz1 + P['rail_h'] - 0.07)
    for sg in (-1, 1):
        M.box('ptStone', c + sg * bh - rt / 2 - (rt if sg > 0 else 0) * 0, c + sg * bh + rt / 2, 0.0, P['balc_proud'] - 0.03, bz1 + P['rail_h'] - 0.10, bz1 + P['rail_h'])
    # --- the steps: eight treads from the door sill down to the ground, two stone cheeks
    TZ = P['terrace_z']
    rise = (SILL - TZ) / P['steps']
    sw = P['stair_w']
    front = pr + 0.02
    vw = v_wall_at
    for i in range(P['steps']):
        blocks.append(dict(
            id=f'painter-step-{i}', plan=['U0', 'U1', round(vw + front + i * P['step_run'], 3), round(vw + front + (i + 1) * P['step_run'], 3)],
            z0=0, z1=round(SILL - rise * i - 0.02, 3), bands=[dict(z0=0, z1=round(SILL - rise * i - 0.02, 3), skin='ptStone')], faces=dict(v0=None), roofTone='ptStone'))
    t0 = vw + front + P['steps'] * P['step_run']
    blocks.append(dict(id='painter-terrace', plan=['T0', 'T1', round(t0, 3), round(t0 + P['terrace_depth'], 3)], z0=0, z1=TZ,
                       bands=[dict(z0=0, z1=TZ, skin='ptStone')], faces=dict(v0=None), roofTone='ptPaver'))
    bd, bh_, bw = P['broad'][0], P['broad'][1:3], P['broad_w']
    for i in range(3):
        zt = round(TZ * (3 - i) / 4, 3)
        blocks.append(dict(id=f'painter-broad-{i}', plan=['B0', 'B1', round(t0 + P['terrace_depth'] + i * bd, 3), round(t0 + P['terrace_depth'] + (i + 1) * bd, 3)],
                           z0=0, z1=zt, bands=[dict(z0=0, z1=zt, skin='ptStone')], faces=dict(v0=None), roofTone='ptGranite'))
    run = P['steps'] * P['step_run']
    for side in ('w', 'e'):
        blocks.append(dict(id=f'painter-cheek-{side}', plan=['C0' + side, 'C1' + side, round(vw + front, 3), round(vw + front + run * 0.8, 3)],
                           z0=0, z1=P['cheek_h'], bands=[dict(z0=0, z1=P['cheek_h'], skin='ptStone')], faces=dict(v0=None), roofTone='ptStone'))
    return sw


# ======================================================================================== the court's east wall
def court_east_wall(edge, M):
    W = WE
    k = 1 / W['px_per_m']
    L = edge['length']
    s_of = lambda x: round(x * L / 1400, 3)       # the flattened drawing is 1400 px for the whole wall
    hw = W['win_w'] / 2
    base_o, row2_o, row3_o, frieze_o = [], [], [], []
    # base: windows at the photographed columns and the glazed door with its canopy frame
    for x in W['base_x']:
        c = s_of(x)
        base_o.append(opening(c - hw, c + hw, 1.0, 2.9))
        window_dress(M, c - hw, c + hw, 1.0, 2.9)
    base_o.append(opening(s_of(645), s_of(800), 0.3, 3.3, d=0.45, panes=False, glass='ptAmber', tone='ptStone'))
    # row 2 (brick)
    z0, h = W['row2']
    for x in W['row2_x']:
        c = s_of(x)
        row2_o.append(opening(c - hw, c + hw, z0, z0 + h))
        window_dress(M, c - hw, c + hw, z0, z0 + h, brick_hood=True)
    # row 3: four arched windows (left block), three plain (right block)
    z0, h = W['arch_glass']
    aw = W['arch_w'] / 2
    rise = (W['arch_w']) * W['arch_rise_ratio']
    for x in W['arch_x']:
        c = s_of(x)
        row3_o.append(opening(c - aw, c + aw, z0, W['arch_top'], panes=True,
                              arch=dict(rise=round(rise, 3), trim=W['arch_trim'], tone='ptStone', proud=0.05),
                              mullion=dict(cols=[0.25, 0.5, 0.75, 1 / 8, 7 / 8], rows=[0.62], w=0.03, tone='ptFrame')))
        sj = W['surround']
        M.box('ptStone', c - aw - sj, c - aw, 0, 0.06, z0 - 0.15, W['arch_top'] - rise)
        M.box('ptStone', c + aw, c + aw + sj, 0, 0.06, z0 - 0.15, W['arch_top'] - rise)
        M.box('ptStone', c - aw - sj, c + aw + sj, 0, 0.08, z0 - 0.15, z0)
    zr, hr = W['row3_right']
    for x in W['right_x']:
        c = s_of(x)
        row3_o.append(opening(c - hw, c + hw, zr, zr + hr))
        window_dress(M, c - hw, c + hw, zr, zr + hr, brick_hood=True)
    # the stone string courses under row 3 and at the springing of the arches, and the full-height stone pier
    M.box('ptStone', 0, s_of(W['pier'][0]), 0, 0.07, *W['sill3'])
    M.box('ptStone', 0, s_of(W['pier'][0]), 0, 0.06, *W['imposts'])
    M.box('ptStone', s_of(W['pier'][0]), s_of(W['pier'][1]), 0, W['pier_proud'], 0, WALL_TOP - 0.35)
    # frieze: pairs and trios in stone frames with a stone panel between
    z0, h = W['frieze']
    pairs = [(W['frieze_x'][0], W['frieze_x'][1]), (W['frieze_x'][2], W['frieze_x'][3])]
    for xa, xb in pairs:
        a, b = s_of(xa), s_of(xb)
        for c in (a, b):
            frieze_o.append(opening(c - hw, c + hw, z0, z0 + h))
        M.box('ptStone', a - hw - 0.22, b + hw + 0.22, 0, 0.05, z0 - 0.25, z0 + h + 0.3)
        M.box('ptStone', a - hw - 0.30, b + hw + 0.30, 0, 0.09, z0 - 0.25, z0 - 0.10)
        # the glass again, in front of the stone frame: window_dress is not used (the frame is the wide one)
    xs = W['frieze_x'][4:]
    for x in xs:
        c = s_of(x)
        frieze_o.append(opening(c - hw, c + hw, z0, z0 + h))
    ra, rb = s_of(xs[0]), s_of(xs[-1])
    M.box('ptStone', ra - hw - 0.25, rb + hw + 0.25, 0, 0.05, z0 - 0.25, z0 + h + 0.3)
    M.box('ptStone', ra - hw - 0.30, rb + hw + 0.30, 0, 0.09, z0 - 0.25, z0 - 0.10)
    M.box('ptStone', 0, L, 0, 0.18, *W['cornice'][:1], W['cornice'][1] - 0.5)
    bands = [
        dict(z0=0, z1=W['string1'][0], skin='ptStone', openings=base_o),
        dict(z0=W['string1'][0], z1=W['string1'][1], skin='ptStone'),
        dict(z0=W['string1'][1], z1=8.3, skin='ptBrick', openings=row2_o),
        dict(z0=8.3, z1=12.4, skin='ptBrick', openings=row3_o),
        dict(z0=12.4, z1=WALL_TOP, skin='ptBrick', openings=frieze_o),
    ]
    return bands


# ======================================================================================== generic walls (INFERRED)
def window(w, h, sill, panes=True):
    spec = {'w': w, 'h': h, 'sill': sill, 'frame': {'w': FRAME['jamb'], 'h': FRAME['head'], 'tone': 'ptStone'}}
    if panes:
        spec['mullion'] = dict(PANES, tone='ptFrame')
    return spec


def bays(field, w, h, sill, frame_tone):
    return {'kind': 'bays', 'field': field, 'bay': BAY, 'glass': 'ptPane', 'frame': frame_tone, 'reveal': 0.2, 'window': window(w, h, sill)}


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
    north = max((e for e in edges if e['out'][1] > 0.9), key=lambda e: e['length'])
    west = [e for e in edges if e['out'][0] < -0.9 and 18 < e['length'] < 20.5]
    assert len(west) == 2, [(e['i'], round(e['length'], 1), e['out']) for e in edges]
    court_east = max(west, key=lambda e: e['a'][1])      # the more northerly of the two 19 m west-facing walls
    print('north front: edge %d, %.1f m;  court east wall: edge %d, %.1f m' % (north['i'], north['length'], court_east['i'], court_east['length']))
    assert abs(north['length'] - 51.7) < 1.0 and abs(court_east['length'] - 19.3) < 1.0
    assert court_east['along'][1] < 0, 'expected the court wall to run north to south (s = 0 at its north end)'

    # ---- the generic bands (every wall without a square-on photograph): the north front's rows, repeated
    def stone(z0, z1):
        return {'z0': z0, 'z1': z1, 'skin': 'ptStone'}

    g = STORIES
    generic = [
        {'z0': 0, 'z1': STRING1[0], 'skin': 'ptBase', 'floors': [0]},
        stone(*STRING1),
        {'z0': STRING1[1], 'z1': STRING2[0], 'skin': 'ptBrickRows', 'floors': [g['row1'][0] - 0.0, g['row2'][0]]},
        stone(*STRING2),
        {'z0': STRING2[1], 'z1': WALL_TOP, 'skin': 'ptFrieze', 'floors': [g['frieze'][0]]},
    ]
    skins = {
        'ptBrick': {'kind': 'flat', 'field': 'ptBrick'},
        'ptStone': {'kind': 'flat', 'field': 'ptStone'},
        'ptBase': bays('ptStone', GLASS_W, g['base'][1], g['base'][0], 'ptStone'),
        'ptBrickRows': bays('ptBrick', GLASS_W, g['row1'][1], 0.0, 'ptBrick'),
        'ptFrieze': bays('ptStone', GLASS_W, g['frieze'][1], 0.0, 'ptStone'),
    }
    # bays measure sill from the band's floor line: floors above are the glass bottoms, so sill 0 (base: glass bottom 1.0 on floor 0)

    # ---- explicit north front
    M = Meshes(north)
    s_p = north['length'] * PORTAL_AT
    north_bands = north_front(edge=north, M=M, portal_s=s_p)
    # the portal's own block: plan in uv from the wall line
    a, al, o = north['a'], north['along'], north['out']
    uc = a[0] + al[0] * s_p
    vw = a[1] + al[1] * s_p
    blocks_extra = []
    portal(north, s_p, M, blocks_extra, vw)
    PQ = PORTAL
    for bk in blocks_extra:
        if bk['id'] == 'painter-portal':
            bk['plan'] = [round(uc - PQ['panel_half'], 3), round(uc + PQ['panel_half'], 3), round(vw - 0.6, 3), round(vw + PQ['panel_proud'], 3)]
        elif bk['id'].startswith('painter-step'):
            bk['plan'][0], bk['plan'][1] = round(uc - PQ['stair_w'] / 2, 3), round(uc + PQ['stair_w'] / 2, 3)
        elif bk['id'] == 'painter-terrace':
            bk['plan'][0], bk['plan'][1] = round(uc - PQ['terrace_w'] / 2, 3), round(uc + PQ['terrace_w'] / 2, 3)
        elif bk['id'].startswith('painter-broad'):
            bk['plan'][0], bk['plan'][1] = round(uc - PQ['broad_w'] / 2, 3), round(uc + PQ['broad_w'] / 2, 3)
        elif bk['id'].startswith('painter-cheek'):
            if bk['id'].endswith('-w'):
                bk['plan'][0], bk['plan'][1] = round(uc - PQ['stair_w'] / 2 - PQ['cheek_w'], 3), round(uc - PQ['stair_w'] / 2, 3)
            else:
                bk['plan'][0], bk['plan'][1] = round(uc + PQ['stair_w'] / 2, 3), round(uc + PQ['stair_w'] / 2 + PQ['cheek_w'], 3)
    # a wall runs east -> west here, so "uc - half" is the wall's higher-s end: the block's own s starts at its low-u end,
    # which is the HIGH-s end of the wall: mirror nothing, the door is symmetrical.

    # ---- explicit court east wall
    MW = Meshes(court_east)
    west_bands = court_east_wall(court_east, MW)

    block = {'id': 'painter-walls', 'plan': {'ring': uv, 'holes': []}, 'z0': 0, 'z1': WALL_TOP, 'bands': generic,
             'roofTone': 'ptRoofEdge', 'cap': False,
             'faces': {str(north['i']): {'bands': north_bands}, str(court_east['i']): {'bands': west_bands}},
             '_src': 'footprint: snapshot; heights: SCAN; north front and the court east wall: PHOTO; other walls INFERRED'}

    colours = {k: {'hex': v} for k, v in COLOURS.items()}
    meshes = M.out() + [dict(m, id=m['id'] + '-e') for m in MW.out()]
    spec = {
        'name': 'T. S. Painter Hall', 'id': BUILDING_ID, 'code': 'PAI',
        'sources': {
            'footprint': f'data/snapshots/{SNAPSHOT.parent.name}/buildings.detailed.geojson, feature {BUILDING_ID}',
            'reference': 'https://utdirect.utexas.edu/apps/campus/buildings/information/nlogon/maps/UTM/PAI/',
            'dimensions': 'See scripts/author_painter_hall.py: every number is marked SCAN, PHOTO or INFERRED there.',
        },
        'footprint': {'ring': ring, 'holes': []},
        'frame': {'obb': obb},
        'levels': {'floors': [0, g['row1'][0], g['row2'][0], g['frieze'][0], WALL_TOP]},
        'colours': colours,
        'materials': MATERIALS,
        'skins': skins,
        'blocks': [block] + blocks_extra,
        'detailMeshes': meshes,
        'preserveRoof': True,
        'open': [
            'Arched windows and their balconies on the end bays and the tower-like end block are not drawn (no square-on photograph); '
            'only the court east wall carries arches.',
            'Where the entrance stands along the north wall is INFERRED (centred); no photograph shows both ends of that wall.',
            'Every wall without a square-on photograph repeats the north front. The court east wall reads 15.9 m on the scan; walls stop at 15.2 m.',
            'The terrace in front of the steps, the carved capitals and the iron grille detail are not drawn.',
        ],
    }
    OUT.write_text(json.dumps(spec, separators=(',', ':'), ensure_ascii=False), encoding='utf-8')
    tri = sum(len(m['triangles']) for m in meshes)
    print('wrote', OUT.relative_to(ROOT), OUT.stat().st_size, 'bytes;', len(edges), 'faces; portal at s = %.1f m of %.1f; %d detail triangles' % (s_p, north['length'], tri))
    print('brick', COLOURS['ptBrick'], 'stone', COLOURS['ptStone'])


if __name__ == '__main__':
    main()
