"""Author the Domino's recipe (data/apartments/dominos.json), the pizza shop on Guadalupe, one block from the campus.

The app drew this shop as a one-box OSM prism (10 m). Two street photographs of the owner's walk of 2026-10-03 show what it
is: a single-storey cream-stucco shop in two wings (a recessed north-west wing with a service door, a front wing with a
glass shop front), wrapped at the top by one deep faded-red fascia that carries the real sign (the word Domino's in white,
once large on the south wall, once small on the west face of the front wing), and a flat canopy on red posts running east
from the shop front under the same fascia.

Every number sits in a table below and is marked:
  PHOTO     read off the photograph (a 24 mm view of the whole building from the south-west), by a camera fitted to the
            wall corners (about 8 px) with the owner's GPS spot and the laser-scan heights as priors
  SCAN      read off the 2021 laser scan (0.5 m cells)
  INFERRED  no photograph of that part: drawn plainly and said so

Lettering is real text in an installed font, turned into solid outlines (no logo artwork, no drawing of the mark).
Needs PIL and cv2: run with the building-run venv.
Frame: the app's own oriented box of the OSM outline: +u runs WEST (275 deg), +v turns 90 deg anticlockwise from it (south).
u = 0 is the east end (the canopy), v = 0 the north edge.
Run: python3 scripts/author_dominos.py   (writes the file; running it again gives the identical file).
"""
from pathlib import Path
import json
import math
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from compact_models import compact

PATH = Path(__file__).resolve().parents[1] / 'data/apartments/dominos.json'
ID = '9f1e1dcd-9fc3-4771-b83e-e290483f80b7'
FOOTPRINT = [[-97.7423619, 30.2821179], [-97.7423541, 30.2821952], [-97.7425547, 30.28221], [-97.7425633, 30.2821249], [-97.742473, 30.2821181],
             [-97.742479, 30.2820587], [-97.742368, 30.2820503], [-97.742367, 30.2820599], [-97.7423029, 30.2820551], [-97.7422971, 30.2821131],
             [-97.7423619, 30.2821179]]
# the app's own oriented box of FOOTPRINT (js/slopes-apartments.js obbOf), computed once with the same arithmetic
FRAME = {'o': [-97.74228937947167, 30.28219030528328], 'ax': -0.9962398892883719, 'ay': 0.08663765342328024,
         'mx': 96130.7243130962, 'my': 110540.0, 'L': 25.606785312638674, 'W': 16.072786092821545}

FONT_SIGN = '/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf'
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



# ---- the shell (metres in the recipe's (u, v) frame) ----
ROOF_Z = 4.3          # SCAN: the roof deck reads 4.2 to 4.3 m
WALL_Z = 4.0          # PHOTO: the wall stops and the fascia starts at 4.0 m (fit: 3.6 to 4.4 along its length)
FASCIA_TOP = 5.4      # PHOTO: the fascia top (fit 4.9 to 6.0 along its length); SCAN: the rim reads 4.8 to 5.7 m
# the OSM outline is two rectangles and a canopy; the wing is a little taller than the front (PHOTO: fascia 4.4 to 5.6 m, the fit's error grows with distance); the scan shows the north-west wing runs 1.8 m further west than the outline
WING = dict(plan=[6.25, 27.4, 0.0, 9.48], wall_z=4.4, roof_z=4.5, top=5.6)       # SCAN (west end 27.4, OSM 25.6) + OSM
FRONT = dict(plan=[6.18, 16.9, 9.48, 16.07])    # OSM; PHOTO agrees (the seam and the shop-front end land within 0.5 m)
CANOPY = dict(u0=0.0, u1=6.2, v0=8.57, v1=15.0, roof_top=3.6, slab=0.25, fascia_z=(3.2, 4.4), fascia_t=0.18)   # SCAN: roof 3.5 to 3.7, rim 4.4; PHOTO: pink fascia, red posts
POSTS = [dict(u=4.7, v=14.6), dict(u=0.5, v=14.6)]   # PHOTO: two red steel posts at the canopy's south edge; their spacing is INFERRED
POST_W = 0.14

# ---- colours: photographed in cloud, then set by ratio. Photograph: wall #878075, fascia #78404d, service door #282b30. ----
COLOURS = {
    'wall': '#a79f8e', 'fascia': '#8a4356', 'roofFlat': '#77776f', 'coping': '#8a4356', 'signWhite': '#f4f2ee',
    'frame': '#2a2b2e', 'shop': '#2d3033', 'serviceDoor': '#2b2e33', 'bulkhead': '#9a9486', 'post': '#9b2332',
    'soffit': '#5e534c', 'slab': '#6d6a64',
}

# ---- south wall of the front wing (face v1): PHOTO, u measured from the east end (the photograph's right) ----
SHOP_FRONT = dict(u0=6.3, u1=9.4, z0=0.65, z1=2.9)      # PHOTO: the glass shop front, 3.1 m wide, on a 0.65 m bulkhead; its door is at the east end
SHOP_DOOR = dict(u0=6.5, u1=7.4)                          # PHOTO (B): the entrance door in the shop front, INFERRED width
FRAME_T, FRAME_PROUD, PANE_PROUD = 0.08, 0.10, 0.04
SERVICE_DOOR = dict(u0=23.6, u1=25.8, z0=0.05, z1=2.8)    # PHOTO: a dark metal door in the north-west wing's south face
# ---- the signs (PHOTO): the real word, solid white letters standing off the fascia ----
SIGN_BIG = dict(text="Domino's", u_centre=9.2, w=4.4, h=1.0, z0=4.1)     # on the south wall of the front wing: 4.6 m wide
SIGN_SMALL = dict(text="Domino's", v_centre=12.5, w=4.0, h=0.85, z0=4.35)  # on the west face of the front wing
SIGN_PROUD, SIGN_OFF = 0.12, 0.04


def build():
    m = {k: Mesh() for k in ('frame', 'shop', 'serviceDoor', 'bulkhead', 'post', 'soffit', 'slab', 'fascia')}
    # the glass shop front on the south wall of the front wing (plane v = 16.07, standing out toward +v)
    V = FRONT['plan'][3]
    S = SHOP_FRONT
    m['bulkhead'].box(S['u0'], S['u1'], V, V + 0.1, 0, S['z0'])
    t = FRAME_T
    m['frame'].box(S['u0'], S['u1'], V, V + FRAME_PROUD, S['z0'], S['z0'] + t)
    m['frame'].box(S['u0'], S['u1'], V, V + FRAME_PROUD, S['z1'] - t, S['z1'])
    m['frame'].box(S['u0'], S['u0'] + t, V, V + FRAME_PROUD, S['z0'], S['z1'])
    m['frame'].box(S['u1'] - t, S['u1'], V, V + FRAME_PROUD, S['z0'], S['z1'])
    m['shop'].box(S['u0'] + t, S['u1'] - t, V, V + PANE_PROUD, S['z0'] + t, S['z1'] - t)
    D = SHOP_DOOR
    m['frame'].box(D['u1'], D['u1'] + 0.06, V, V + FRAME_PROUD + 0.01, S['z0'], S['z1'] - 0.5)    # the door's closing stile
    m['frame'].box(D['u0'], D['u1'] + 0.06, V, V + FRAME_PROUD + 0.01, S['z1'] - 0.56, S['z1'] - 0.5)   # its head
    m['frame'].box(S['u0'] + 1.55, S['u0'] + 1.61, V, V + FRAME_PROUD, S['z0'], S['z1'])   # one mullion beside it
    # the dark service door on the north-west wing's south wall (plane v = 9.48, toward +v)
    W = WING['plan'][3]
    d = SERVICE_DOOR
    m['frame'].box(d['u0'] - 0.07, d['u1'] + 0.07, W, W + 0.06, d['z0'], d['z1'] + 0.07)
    m['serviceDoor'].box(d['u0'], d['u1'], W, W + 0.09, d['z0'], d['z1'])
    # the canopy: a flat slab on the east of the front wing, one deep fascia round its south and east edges, two red posts
    C = CANOPY
    zt = C['roof_top']
    m['slab'].box(C['u0'], C['u1'], C['v0'], C['v1'], zt - C['slab'], zt)
    m['soffit'].quad([(C['u0'], C['v0'], zt - C['slab'] - 0.01), (C['u1'], C['v0'], zt - C['slab'] - 0.01), (C['u1'], C['v1'], zt - C['slab'] - 0.01), (C['u0'], C['v1'], zt - C['slab'] - 0.01)], (0, 0, -1))
    z0f, z1f = C['fascia_z']
    ft = C['fascia_t']
    m['fascia'].box(C['u0'], C['u1'], C['v1'] - ft, C['v1'], z0f, z1f)              # south edge
    m['fascia'].box(C['u0'], C['u0'] + ft, C['v0'], C['v1'], z0f, z1f)              # east end
    for p in POSTS:
        m['post'].box(p['u'] - POST_W / 2, p['u'] + POST_W / 2, p['v'] - POST_W / 2, p['v'] + POST_W / 2, 0, zt - C['slab'])
    return m


def sign_spec(text, w, h, z0, s, tone='signWhite'):
    polys, aspect = text_outline(text, FONT_SIGN)
    return dict(outline={'polygons': polys}, w=round(w, 3), h=round(h, 3), s=round(s, 3), z0=round(z0, 3), depth=SIGN_PROUD, off=SIGN_OFF, tone=tone)


def main():
    d = {
        'name': "Domino's", 'id': ID,
        'replaceFrontage': True,   # hide the generic storefront slabs and door skins (places.js, entrances.js) drawn on this building's old walls
        'sources': {
            'footprint': 'data/snapshots/2026-10-05/buildings.detailed.geojson, feature ' + ID,
            'reference': "two street photographs of the shop, taken 2026-10-03 (a wide view of the whole building from the south-west and a long-lens view of the shop front from the south-east), and the 2021 laser scan",
            'dimensions': 'Wall corners and the shop front from a camera fitted to the whole-building photograph (about 8 px), heights from the laser scan (roof 4.3 m, rim 4.8 to 5.7 m); the north-west wing runs 1.8 m past the OSM outline in the scan. Metres off the photograph are good to about 0.5 m: the shop is seen from 40 m.',
        },
        'footprint': {'ring': FOOTPRINT},
        'frame': {'obb': FRAME},
        'levels': {'floors': [0, WALL_Z, ROOF_Z]},
        'colours': {k: {'hex': v} for k, v in COLOURS.items()},
        'skins': {'wall': {'kind': 'flat', 'field': 'wall'}, 'fascia': {'kind': 'flat', 'field': 'fascia'}},
        'materials': {'wall': 'none'},   # stucco: no brick or stone texture
        'blocks': [],
        'detailMeshes': [],
        'open': ['The north and east faces and the roof are in no photograph: plain stucco with the fascia round it.',
                 'The fascia is flush with the wall; the photographs show it standing out a little (about 0.3 m) and slanting.',
                 'The freestanding pole sign with the reader board at the corner, the red bench seats, the bollards, dumpsters and the blue mural on the neighbour are not drawn.',
                 'The mark beside the word on each sign is not drawn (the word only).',
                 'The paper notices and wall lights on the stucco are not drawn.'],
    }
    bands = [{'z0': 0, 'z1': WALL_Z, 'skin': 'wall'}, {'z0': WALL_Z, 'z1': ROOF_Z, 'skin': 'fascia'}]
    big = sign_spec(SIGN_BIG['text'], SIGN_BIG['w'], SIGN_BIG['h'], SIGN_BIG['z0'], SIGN_BIG['u_centre'] - FRONT['plan'][0])    # the south face runs from its u0 end
    small = sign_spec(SIGN_SMALL['text'], SIGN_SMALL['w'], SIGN_SMALL['h'], SIGN_SMALL['z0'], FRONT['plan'][3] - SIGN_SMALL['v_centre'])   # s runs from the v1 end of the u1 face
    wbands = [{'z0': 0, 'z1': WING['wall_z'], 'skin': 'wall'}, {'z0': WING['wall_z'], 'z1': WING['roof_z'], 'skin': 'fascia'}]
    u0, uj, u1, v0, v1 = WING['plan'][0], FRONT['plan'][1], WING['plan'][1], WING['plan'][2], WING['plan'][3]
    # the north-west wing is two blocks so that the fascia stops where the front wing stands against it
    wing_e = {'id': 'wing-east', 'plan': [u0, uj, v0, v1], 'z0': 0, 'z1': WING['roof_z'], 'bands': wbands,
              'faces': {'v1': None, 'u1': None},
              'roofTone': 'roofFlat', 'parapet': WING['top'] - WING['roof_z'], 'parapetTone': 'fascia', 'parapetSides': ['v0', 'u0'], '_src': 'OSM + SCAN'}
    wing_w = {'id': 'wing-west', 'plan': [uj, u1, v0, v1], 'z0': 0, 'z1': WING['roof_z'], 'bands': wbands,
              'faces': {'u0': None},
              'roofTone': 'roofFlat', 'parapet': WING['top'] - WING['roof_z'], 'parapetTone': 'fascia', 'parapetSides': ['v0', 'v1', 'u1'], '_src': 'OSM + SCAN'}
    front = {'id': 'front', 'plan': FRONT['plan'], 'z0': 0, 'z1': ROOF_Z, 'bands': bands,
             'faces': {'v0': None,
                       'v1': {'bands': [{'z0': 0, 'z1': WALL_Z, 'skin': 'wall'}, {'z0': WALL_Z, 'z1': ROOF_Z, 'skin': 'fascia', 'signs': [big]}]},
                       'u1': {'bands': [{'z0': 0, 'z1': WALL_Z, 'skin': 'wall'}, {'z0': WALL_Z, 'z1': ROOF_Z, 'skin': 'fascia', 'signs': [small]}]}},
             'roofTone': 'roofFlat', 'parapet': FASCIA_TOP - ROOF_Z, 'parapetTone': 'fascia', 'parapetSides': ['v1', 'u1', 'u0'], '_src': 'OSM + PHOTO'}
    d['blocks'] += [wing_e, wing_w, front]
    for tone, mesh in build().items():
        if mesh.v:
            d['detailMeshes'].append({'id': 'dom-' + tone, 'tone': tone, 'vertices': mesh.v, 'triangles': mesh.t})
    return d


if __name__ == '__main__':
    d = main()
    PATH.write_text(compact(json.dumps(d, indent=1)), encoding='utf-8')
    print('wrote', PATH, len(PATH.read_bytes()), 'bytes')
