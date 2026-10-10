"""Author the Jimmy John's recipe (data/apartments/jimmy-johns.json), the two-storey sandwich shop on the corner by the campus.

The app drew this shop as a one-box OSM prism. One street photograph of the whole building (the owner's walk of
2026-09-29) shows what it is: a two-storey painted-brick box, grey, with five narrow black-framed windows over a black
awning with a red valance, a storefront of two windows and a door under it, an exterior steel stair up its west wall,
and the real sign (red JJ and the words JIMMY JOHN'S) on the north wall.

Every number sits in a table below and is marked:
  PHOTO     read off the photograph: the north wall flattened with the private tool rectify_face.py, scale from the
            OSM wall length (10.68 m), checked by the door (2.3 m) and the corner height of the camera fit (8.0 m)
  FIT       from a camera fitted to the four corners of the north wall (4 px), used for the oblique west wall
  SCAN      read off the 2021 laser scan (0.5 m cells)
  INFERRED  no photograph of that part: drawn plainly and said so

Lettering is real text in an installed font, turned into solid outlines (no logo artwork, no drawing of a mark).
Needs PIL and cv2: run with the building-run venv.
Frame: the app's own oriented box of the OSM outline: +u runs along the west wall (south-south-west, 17.5 deg west of
south), +v turns 90 deg anticlockwise from it (east-south-east). u = 0 is the NORTH wall, v = 0 the WEST wall.
Run: python3 scripts/author_jimmy_johns.py   (writes the file; running it again gives the identical file).
"""
from pathlib import Path
import json
import math
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from compact_models import compact

PATH = Path(__file__).resolve().parents[1] / 'data/apartments/jimmy-johns.json'
ID = '12a8cbfc-5d0d-4131-b055-d3c0516929d8'
FOOTPRINT = [[-97.743927, 30.282168], [-97.744033, 30.282197], [-97.744067, 30.282098], [-97.743965, 30.282069], [-97.743927, 30.282168]]
# the app's own oriented box of FOOTPRINT (js/slopes-apartments.js obbOf), computed once with the same arithmetic
FRAME = {'o': [-97.744033, 30.282197], 'ax': -0.300093623762098, 'ay': -0.9539097530570344,
         'mx': 96130.70209296724, 'my': 110540.0, 'L': 11.535305234501734, 'W': 10.682199641452094}

FONT_SERIF = '/System/Library/Fonts/Supplemental/Georgia Bold.ttf'

# ---- the shell (metres in the recipe's (u, v) frame) ----
U0, U1, V0, V1 = 0.0, 11.48, 0.08, 10.58     # SCAN + OSM: the roof edge, within 0.1 m of the OSM outline
ROOF_Z = 7.2          # SCAN: the roof deck reads 6.7 to 7.3 m
PARAPET = 0.8         # SCAN: the rim reads 7.3 to 7.9 m; PHOTO/FIT: the coping on the north wall tops out at 8.0 m
FACE_V_A = 10.68      # v of the north wall's NE end (A); the north wall's width the photograph is scaled from
ROOF_ITEMS = [dict(plan=[9.0, 10.4, 1.8, 4.4], h=0.75, tone='roofFlat')]    # SCAN: a 7.7 to 7.8 m box on the deck, west side

# ---- colours: photographed at dawn in cloud, then set by ratio. The wall reads #5c5b60 on the shaded north face and
#      #817e85 on the west face; the window frames #131419, the awning #211f22, the valance #611d21 in the same light. ----
COLOURS = {
    'wall': '#8b8a90', 'coping': '#9d9ca1', 'sill': '#a3a2a6', 'roofFlat': '#6e6e70',
    'awning': '#1d1c20', 'valance': '#a3202b', 'frame': '#16171b', 'pane': '#4f4e4d', 'shop': '#3a2e25',
    'door': '#30241b', 'shutter': '#37363d', 'signRed': '#b3202f', 'signDark': '#2d2e33', 'neon': '#e5532b',
    'roundelBlack': '#1b1b1f', 'roundelRed': '#b3202f', 'steel': '#25262a', 'concrete': '#8d8c91', 'roundelWhite': '#e6e3dc',
}

# ---- north wall (face u0): PHOTO. v measured from the west corner B; the photograph's left end is v = 10.68 ----
UP_WIN = [(9.58, 0.87), (7.89, 0.87), (6.05, 0.87), (4.13, 0.87), (1.72, 0.87)]   # centre v, width: five narrow double-hung windows
UP_Z = (4.50, 6.31)          # PHOTO: sill-line to head, 1.81 m tall; the meeting rail is at the middle
GROUND_WIN = [(7.73, 9.69, 0.72, 2.45, 'shop'), (3.75, 5.34, 0.80, 2.59, 'shop')]   # v0, v1, z0, z1: the two storefront windows
DOOR = (1.05, 1.93, 0.28, 2.57)   # v0, v1, z0, z1: the entrance, 0.88 x 2.29 m
AWNING = dict(z_top=3.70, z_front=2.77, valance=0.26, out=1.0)   # PHOTO: black slope over the whole north wall, red valance; depth INFERRED
FRAME_T, FRAME_PROUD, PANE_PROUD, SILL_PROUD, SILL_H = 0.09, 0.10, 0.04, 0.14, 0.12
# ---- the signs (PHOTO): real words, solid letters standing off the wall ----
SIGN_JJ = dict(text='JJ', v_centre=8.425, w=0.95, h=0.96, z0=6.69, tone='signRed')        # the red double J, x 1.78 to 2.73 m from the NE end
SIGN_WORD = dict(text="JIMMY JOHN'S", v_centre=5.05, w=5.36, h=0.59, z0=6.95, tone='signDark')   # x 2.95 to 8.31 m, cap height 0.57 m
SIGN_NEON = [dict(text='FREE', v_centre=8.99, w=0.80, h=0.26, z0=2.11), dict(text='SMELLS', v_centre=8.99, w=0.84, h=0.20, z0=1.89)]  # the window sign
SIGN_PROUD, SIGN_OFF = 0.12, 0.04

# ---- west wall (face v0): FIT. u measured from the north corner B ----
ROUNDEL = dict(u=1.25, z=7.2, r=0.70, ring=0.10, proud=0.10)   # PHOTO: a 1.4 m round board at the north corner, black with a red rim (artwork inside NOT drawn)
WEST_WIN = [(1.64, 3.1, 4.68, 6.59), (5.67, 7.24, 5.66, 6.84)]    # FIT: u0, u1, z0, z1: two openings with closed black shutters
UPPER_DOOR = (8.8, 9.6, 4.3, 6.5)        # FIT: the door onto the stair landing
STAIR = dict(u_foot=-0.2, z_foot=0.28, u_land=8.5, z_land=4.3, v_out=-1.05, v_in=-0.05, land_u1=11.4)  # FIT: the steel stair rising south along the west wall to a landing
STAIR_RAIL_H, STAIR_POST = 1.0, 0.06
DECIMALS = 3


# ---------------------------------------------------------------- lettering: real words as solid outlines
def text_outline(text, font, stretch=1.0):
    """Outlines of `text` in `font`, in a 0..1 box, y up. Returns (polygons, ink aspect w/h). cv2 and PIL are needed."""
    import numpy as np
    import cv2
    from PIL import Image, ImageDraw, ImageFont
    f = ImageFont.truetype(font, 400)
    l, t, r, b = f.getbbox(text)
    img = Image.new('L', (r - l + 40, b - t + 40), 0)
    ImageDraw.Draw(img).text((20 - l, 20 - t), text, font=f, fill=255)
    a = np.array(img)
    ys, xs = np.nonzero(a > 127)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    a = (a > 127).astype('uint8') * 255
    cs, hier = cv2.findContours(a, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    W, H = x1 - x0, y1 - y0

    def norm(c):
        c = cv2.approxPolyDP(c, 1.1, True)[:, 0, :]
        pts = [[round((x - x0) / W, 5), round(1 - (y - y0) / H, 5)] for x, y in c]
        return pts if len(pts) >= 3 else None
    polys = []
    for i, c in enumerate(cs):
        if hier[0][i][3] != -1:
            continue
        outer = norm(c)
        if not outer:
            continue
        holes = [h for h in (norm(cs[j]) for j in range(len(cs)) if hier[0][j][3] == i) if h]
        polys.append({'outer': outer, 'holes': holes})
    return polys, W / H * stretch


def disc(cx, cz, r, n=40):
    return [[round(0.5 + 0.5 * math.cos(2 * math.pi * k / n), 5), round(0.5 + 0.5 * math.sin(2 * math.pi * k / n), 5)] for k in range(n)]


# ---------------------------------------------------------------- plain boxes and quads in (u, v, z)
class Mesh:
    def __init__(self):
        self.v, self.t = [], []

    def quad(self, pts, want):
        """One quad (4 points), wound so its normal agrees with `want` (a vector)."""
        n = len(self.v)
        self.v.extend([[round(c, DECIMALS) for c in p] for p in pts])
        e1 = [pts[1][i] - pts[0][i] for i in range(3)]
        e2 = [pts[2][i] - pts[0][i] for i in range(3)]
        nrm = (e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0])
        if sum(nrm[i] * want[i] for i in range(3)) > 0:
            self.t.extend([[n, n + 1, n + 2], [n, n + 2, n + 3]])
        else:
            self.t.extend([[n, n + 2, n + 1], [n, n + 3, n + 2]])

    def tri(self, pts, want):
        n = len(self.v)
        self.v.extend([[round(c, DECIMALS) for c in p] for p in pts])
        e1 = [pts[1][i] - pts[0][i] for i in range(3)]
        e2 = [pts[2][i] - pts[0][i] for i in range(3)]
        nrm = (e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0])
        self.t.append([n, n + 1, n + 2] if sum(nrm[i] * want[i] for i in range(3)) > 0 else [n, n + 2, n + 1])

    def box(self, u0, u1, v0, v1, z0, z1):
        self.quad([(u0, v0, z1), (u1, v0, z1), (u1, v1, z1), (u0, v1, z1)], (0, 0, 1))
        self.quad([(u0, v0, z0), (u1, v0, z0), (u1, v0, z1), (u0, v0, z1)], (0, -1, 0))
        self.quad([(u0, v1, z0), (u1, v1, z0), (u1, v1, z1), (u0, v1, z1)], (0, 1, 0))
        self.quad([(u0, v0, z0), (u0, v1, z0), (u0, v1, z1), (u0, v0, z1)], (-1, 0, 0))
        self.quad([(u1, v0, z0), (u1, v1, z0), (u1, v1, z1), (u1, v0, z1)], (1, 0, 0))

    def north(self, v0, v1, z0, z1, off0, off1):
        """A box on the north wall (plane u = 0), standing out from `off0` to `off1` metres."""
        self.box(-off1, -off0, v0, v1, z0, z1)

    def west(self, u0, u1, z0, z1, off0, off1):
        """A box on the west wall (plane v = V0), standing out from `off0` to `off1` metres."""
        self.box(u0, u1, V0 - off1, V0 - off0, z0, z1)

    def disc_west(self, u, z, r, off, n=40):
        v = V0 - off
        for k in range(n):
            a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
            self.tri([(u, v, z), (u + r * math.cos(a0), v, z + r * math.sin(a0)), (u + r * math.cos(a1), v, z + r * math.sin(a1))], (0, -1, 0))


def north_window(m, v0, v1, z0, z1, rail=True, pane='pane', dark=None):
    """Frame ring + pane (+ meeting rail) on the north wall; returns nothing, adds to meshes dict m."""
    t = FRAME_T
    m['frame'].north(v0, v1, z0, z0 + t, 0, FRAME_PROUD)
    m['frame'].north(v0, v1, z1 - t, z1, 0, FRAME_PROUD)
    m['frame'].north(v0, v0 + t, z0 + t, z1 - t, 0, FRAME_PROUD)
    m['frame'].north(v1 - t, v1, z0 + t, z1 - t, 0, FRAME_PROUD)
    m[pane].north(v0 + t, v1 - t, z0 + t, z1 - t, 0, PANE_PROUD)
    if rail:
        mid = (z0 + z1) / 2
        m['frame'].north(v0 + t, v1 - t, mid - 0.03, mid + 0.03, 0, FRAME_PROUD - 0.01)


def sill(m, v0, v1, z0, wide=0.06):
    m['sill'].north(v0 - wide, v1 + wide, z0 - SILL_H, z0 + 0.02, 0, SILL_PROUD)


def build():
    names = ['frame', 'pane', 'shop', 'door', 'sill', 'awning', 'valance', 'shutter', 'roundelBlack', 'roundelRed', 'roundelWhite', 'steel', 'concrete']
    m = {k: Mesh() for k in names}
    # five upper windows (PHOTO)
    for vc, w in UP_WIN:
        north_window(m, vc - w / 2, vc + w / 2, UP_Z[0], UP_Z[1])
        sill(m, vc - w / 2, vc + w / 2, UP_Z[0])
    # the two storefront windows (PHOTO)
    for v0, v1, z0, z1, kind in GROUND_WIN:
        north_window(m, v0, v1, z0, z1, rail=False, pane='shop')
        sill(m, v0, v1, z0, wide=0.05)
    # the door (PHOTO)
    d0, d1, dz0, dz1 = DOOR
    north_window(m, d0, d1, dz0, dz1, rail=False, pane='door')
    # the awning: one black slope over the whole north wall, red valance on its front edge (PHOTO; depth INFERRED)
    A = AWNING
    va, vb = V0, V1
    zt, zf, o = A['z_top'], A['z_front'], A['out']
    m['awning'].quad([(0, va, zt), (0, vb, zt), (-o, vb, zf), (-o, va, zf)], (-o * 0 - (zt - zf), 0, o))      # the sloped top
    m['awning'].quad([(0, va, zt - 0.04), (0, vb, zt - 0.04), (-o, vb, zf - 0.04), (-o, va, zf - 0.04)], (zt - zf, 0, -o))   # its underside
    m['valance'].quad([(-o, va, zf - A['valance']), (-o, vb, zf - A['valance']), (-o, vb, zf), (-o, va, zf)], (-1, 0, 0))
    m['awning'].quad([(-o, va, zf), (-o, vb, zf), (-o - 0.02, vb, zf + 0.04), (-o - 0.02, va, zf + 0.04)], (0, 0, 1))
    for v in (va, vb):
        m['awning'].tri([(0, v, zt), (-o, v, zf), (0, v, zf)], (0, 1 if v == vb else -1, 0))
    # the round board at the north corner of the west wall (PHOTO): black, a red rim, no artwork
    R = ROUNDEL
    m['roundelRed'].disc_west(R['u'], R['z'], R['r'], R['proud'])
    m['roundelWhite'].disc_west(R['u'], R['z'], R['r'] - R['ring'], R['proud'] + 0.01)
    m['roundelBlack'].disc_west(R['u'], R['z'], R['r'] - 2 * R['ring'], R['proud'] + 0.02)
    # the two tall openings with closed shutters, the upper door (FIT)
    for u0, u1, z0, z1 in WEST_WIN:
        m['frame'].west(u0, u1, z0, z1, 0, 0.09)
        m['shutter'].west(u0 + 0.09, u1 - 0.09, z0 + 0.09, z1 - 0.09, 0, 0.11)
        m['sill'].west(u0 - 0.05, u1 + 0.05, z0 - 0.1, z0 + 0.02, 0, 0.14)
    u0, u1, z0, z1 = UPPER_DOOR
    m['frame'].west(u0, u1, z0, z1, 0, 0.08)
    m['door'].west(u0 + 0.08, u1 - 0.08, z0, z1 - 0.08, 0, 0.1)
    # the stair (FIT): a steel wedge rising south along the west wall, a landing, support walls, a rail
    S = STAIR
    vo, vi = S['v_out'], S['v_in']
    uf, zf0, ul, zl = S['u_foot'], S['z_foot'], S['u_land'], S['z_land']
    # steps: a sloped tread surface and a stepped look from the side (tread boxes, 0.28 m run)
    n = max(2, int(round((ul - uf) / 0.28)))
    for k in range(n):
        ua = uf + (ul - uf) * k / n
        ub = uf + (ul - uf) * (k + 1) / n
        zt = zf0 + (zl - zf0) * (k + 1) / n
        m['steel'].box(ua, ub, vo, vi, zt - 0.05, zt)
    # the two stringers, as solid planes
    for v in (vo, vi):
        m['steel'].quad([(uf, v, zf0 - 0.2), (ul, v, zl - 0.2), (ul, v, zl - 0.02), (uf, v, zf0 - 0.02)], (0, -1 if v == vo else 1, 0))
    # landing slab and its two support walls
    lu1 = S['land_u1']
    m['concrete'].box(ul, lu1, vo, vi, zl - 0.15, zl)
    m['concrete'].box(ul, ul + 0.3, vo, vi, 0.0, zl - 0.15)
    m['concrete'].box(lu1 - 0.3, lu1, vo, vi, 0.0, zl - 0.15)
    # rails: a top rail along the open side of the stair and round the landing, with posts
    H = STAIR_RAIL_H
    m['steel'].quad([(uf, vo, zf0 + H), (ul, vo, zl + H), (ul, vo, zl + H + 0.05), (uf, vo, zf0 + H + 0.05)], (0, -1, 0))
    m['steel'].quad([(uf, vo, zf0 + 0.4), (ul, vo, zl + 0.4), (ul, vo, zl + 0.45), (uf, vo, zf0 + 0.45)], (0, -1, 0))
    m['steel'].box(ul, lu1, vo, vo + STAIR_POST, zl, zl + H + 0.05)
    m['steel'].box(lu1 - STAIR_POST, lu1, vo, vi, zl, zl + H + 0.05)
    k = 0
    while True:
        u = uf + 0.9 * k
        if u > ul:
            break
        z = zf0 + (zl - zf0) * (u - uf) / (ul - uf)
        m['steel'].box(u, u + STAIR_POST, vo, vo + STAIR_POST, z, z + H)
        k += 1
    return m


def sign_spec(text, font, v_centre, w, h, z0, tone, face_v0=V0):
    polys, aspect = text_outline(text, font)
    # the lettering keeps the proportions of the font, squeezed or stretched to the measured width
    return dict(outline={'polygons': polys}, w=round(w, 3), h=round(h, 3), s=round(v_centre - face_v0, 3), z0=round(z0, 3), depth=SIGN_PROUD, off=SIGN_OFF, tone=tone)


def main():
    d = {
        'name': "Jimmy John's", 'id': ID,
        'sources': {
            'footprint': 'data/snapshots/2026-10-05/buildings.detailed.geojson, feature ' + ID,
            'reference': "one street photograph of the whole building (the owner's walk of 2026-09-29), its north wall flattened with rectify_face.py, and the 2021 laser scan",
            'dimensions': 'North wall scaled from the OSM wall length (10.68 m) and checked against the 2.29 m door; roof 7.2 m and rim 7.9 m from the scan. West wall, stair and round board come from a camera fitted to the north wall corners (4 px): oblique, so about 0.3 m. East and south walls are in no photograph.',
        },
        'footprint': {'ring': FOOTPRINT},
        'frame': {'obb': FRAME},
        'levels': {'floors': [0, 3.7, ROOF_Z]},
        'colours': {k: {'hex': v} for k, v in COLOURS.items()},
        'skins': {'wall': {'kind': 'flat', 'field': 'wall'}},
        'materials': {'wall': 'brick'},
        'blocks': [],
        'detailMeshes': [],
        'open': ['East and south walls are in no photograph: plain painted brick, no windows drawn.',
                 'The small canopy and the rear lean-to behind the south-west corner are not drawn (not in the outline).',
                 'The stair is a solid steel wedge with a top rail; the open risers, the open balusters and the landing guard are not drawn separately.',
                 'The small round logo board in the middle storefront window and any artwork on the round board at the corner are not drawn (plain rim only).',
                 'The stepped coping on the north wall is one flat parapet; the rear lean-to and the cage ladder past the south-west corner are not in the outline and are not drawn.'],
    }
    signs_north = [sign_spec(SIGN_JJ['text'], FONT_SERIF, SIGN_JJ['v_centre'], SIGN_JJ['w'], SIGN_JJ['h'], SIGN_JJ['z0'], SIGN_JJ['tone']),
                   sign_spec(SIGN_WORD['text'], FONT_SERIF, SIGN_WORD['v_centre'], SIGN_WORD['w'], SIGN_WORD['h'], SIGN_WORD['z0'], SIGN_WORD['tone'])]
    # the window sign: raised off the glass, so it stands further out than the wall letters
    for s in SIGN_NEON:
        sp = sign_spec(s['text'], '/System/Library/Fonts/Supplemental/Arial Bold.ttf', s['v_centre'], s['w'], s['h'], s['z0'], 'neon')
        sp['off'] = PANE_PROUD + 0.02
        sp['depth'] = 0.03
        signs_north.append(sp)
    block = {'id': 'shell', 'plan': [U0, U1, V0, V1], 'z0': 0, 'z1': ROOF_Z,
             'bands': [{'z0': 0, 'z1': ROOF_Z, 'skin': 'wall'}],
             'faces': {'u0': {'bands': [{'z0': 0, 'z1': ROOF_Z, 'skin': 'wall', 'signs': signs_north}]}},
             'roofTone': 'roofFlat', 'parapet': PARAPET, 'parapetTone': 'coping',
             'roofItems': ROOF_ITEMS, '_src': 'SCAN for the height; PHOTO for the north wall'}
    d['blocks'].append(block)
    for tone, mesh in build().items():
        if mesh.v:
            d['detailMeshes'].append({'id': 'jj-' + tone, 'tone': tone, 'vertices': mesh.v, 'triangles': mesh.t})
    return d


if __name__ == '__main__':
    d = main()
    PATH.write_text(compact(json.dumps(d, indent=1)), encoding='utf-8')
    print('wrote', PATH, len(PATH.read_bytes()), 'bytes')
