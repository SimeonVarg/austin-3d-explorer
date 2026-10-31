"""v2 street lamps, the two lamp models, built in Blender and written to v2/data/lamp_models.json (this script owns that file).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/v2/lamp_models_blender.py

Type 0, the UT campus globe lamp: a tapered dark post on a flared foot, a ringed fitter, a frosted acorn globe and a small cap with a
finial. Sizes measured from two site photographs with solved cameras (2026-10-31): foot to globe top 4.2 m (the two photographs give
5.2 and 3.4 m; their pixel proportions agree to 2 %, so the shape is sure and the size is their geometric mean), globe 0.45 m wide,
0.64 m tall with its cap; post 0.19 m at the foot, 0.13 m under the fitter. Profiles below are those ratios.
Type 1, a cobra-head street light on a 9 m mast (the size the v2 street layer used before; not measured from a photograph yet).

Each type is one lathe / box mesh, triangulated, written as flat triangles: position (x right, y up, z), smooth normal, part index.
Parts: 0 post (its colour is per instance: dark bronze or pale), 1 glass (lit at night), 2 fittings (cap, fitter, arm, head).
"""
import bpy, bmesh, json, math, os
from mathutils import Vector

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(REPO, 'v2', 'data', 'lamp_models.json')

# ── PARAMETERS ──────────────────────────────────────────────────────────
SEG_GLOBE = 10            # radial segments of the globe lamp
SEG_MAST = 8              # radial segments of the cobra mast
# (radius m, height m, part) from the foot up; consecutive rows of the same part make one band
GLOBE_PROFILE = [
    (0.20, 0.00, 0), (0.20, 0.10, 0), (0.13, 0.22, 0), (0.095, 0.34, 0),      # flared foot
    (0.065, 3.20, 0),                                                          # tapered shaft
    (0.10, 3.26, 2), (0.075, 3.34, 2), (0.075, 3.48, 2), (0.12, 3.56, 2),     # fitter and globe holder ring
    (0.10, 3.58, 1), (0.205, 3.70, 1), (0.225, 3.84, 1), (0.20, 3.98, 1), (0.13, 4.10, 1),   # acorn globe
    (0.115, 4.12, 2), (0.05, 4.19, 2), (0.012, 4.30, 2),                       # cap and finial
]
MAST = dict(r0=0.13, r1=0.085, h=9.0, arm_len=1.8, arm_y=8.9, arm_t=0.09, head=(0.72, 0.17, 0.34), lens=(0.55, 0.26))
PALETTE = {   # sRGB, read by v2/lamps.js; post colours fitted so the app at the photographs' matched exposure gives their pixels (2026-10-31)
    'post_dark': '#5d4642', 'post_pale': '#9a9d9e', 'glass': '#d4dcdc', 'fitting_dark': '#3c3532', 'mast': '#7d8184', 'head': '#5b5f62',
}


def lathe(bm, profile, seg):
    rings = []
    for r, y, p in profile:
        if r <= 1e-6:
            apex = bm.verts.new((0.0, y, 0.0)); rings.append(([apex] * seg, p)); continue
        rings.append(([bm.verts.new((r * math.cos(2 * math.pi * k / seg), y, r * math.sin(2 * math.pi * k / seg))) for k in range(seg)], p))
    faces = []
    for (a, pa), (b, pb) in zip(rings, rings[1:]):
        part = pb if pa != pb else pa
        for k in range(seg):
            k2 = (k + 1) % seg
            vs = [a[k], a[k2], b[k2], b[k]]
            vs = [v for i, v in enumerate(vs) if v not in vs[:i]]
            f = bm.faces.new(vs); f.material_index = part; faces.append(f)
    # close the bottom
    f = bm.faces.new(list(reversed(rings[0][0]))); f.material_index = rings[0][1]
    return faces


def box(bm, cx, cy, cz, sx, sy, sz, part):
    r = bmesh.ops.create_cube(bm, size=1.0)
    for v in r['verts']:
        v.co = Vector((cx + v.co.x * sx, cy + v.co.y * sy, cz + v.co.z * sz))
    for f in {f for v in r['verts'] for f in v.link_faces}:
        f.material_index = part


def export(bm, smooth=True):
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.normal_update()
    pos, nrm, part = [], [], []
    for f in bm.faces:
        for l in f.loops:
            # smooth inside a part's band, flat across part changes and on boxes (an angle limit, like auto smooth)
            n = f.normal.copy()
            if smooth:
                acc = Vector((0, 0, 0))
                for g in l.vert.link_faces:
                    if g.material_index == f.material_index and g.normal.dot(f.normal) > math.cos(math.radians(50)):
                        acc += g.normal
                if acc.length > 0: n = acc.normalized()
            pos += [round(c, 4) for c in l.vert.co]; nrm += [round(c, 3) for c in n]; part.append(f.material_index)
    return {'tris': len(bm.faces), 'pos': pos, 'nrm': nrm, 'part': part}


bpy.ops.wm.read_factory_settings(use_empty=True)
types = []
bm = bmesh.new(); lathe(bm, GLOBE_PROFILE, SEG_GLOBE)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
types.append({'name': 'UT campus globe lamp', 'height_m': GLOBE_PROFILE[-1][1], 'post_radius_m': 0.08, **export(bm)}); bm.free()

bm = bmesh.new(); M = MAST
lathe(bm, [(M['r0'], 0.0, 0), (M['r1'], M['h'], 0), (0.0, M['h'] + 0.05, 0)], SEG_MAST)
box(bm, M['arm_len'] / 2, M['arm_y'], 0, M['arm_len'], M['arm_t'], M['arm_t'], 2)
hx, hy, hz = M['head']; box(bm, M['arm_len'] + hx / 2 - 0.1, M['arm_y'] - 0.05, 0, hx, hy, hz, 2)
lx, lz = M['lens']; box(bm, M['arm_len'] + hx / 2 - 0.08, M['arm_y'] - 0.05 - hy / 2 - 0.01, 0, lx, 0.02, lz, 1)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
types.append({'name': 'cobra-head street light', 'height_m': M['h'], 'post_radius_m': 0.11, **export(bm)}); bm.free()

json.dump({'about': 'v2 street lamp models, built by scripts/v2/lamp_models_blender.py (Blender). x right, y up; type 1 arm points +x.',
           'parts': ['post', 'glass', 'fitting'], 'palette': PALETTE, 'types': types}, open(OUT, 'w'), separators=(',', ':'))
print('LAMP MODELS', [(t['name'], t['tris']) for t in types], os.path.getsize(OUT), 'bytes')
