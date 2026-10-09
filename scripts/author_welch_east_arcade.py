"""Author the arches on Welch Hall's east ground-floor arcade (faces 3 and 4 of the wings).

The owner's photographs of the east side show a smooth pale plaster wall with
wide openings along the ground floor: tall straight sides and a flat curved top
(not a half-circle). The recipe had square posts there.
This script adds one detail mesh, `welch-east-arcade`: a plaster wall pierced by
arches, one under each column of windows, standing just in front of the old posts, and it
takes the old posts out of those stretches only. It also gives the glass behind
the arches a dark tone, because the photographs show dark openings. Two stretches are built (see
BAYS): the south one and the middle one each appear in a photograph, and they meet
at the bend of the wall. The ends of the wall are in no photograph; their
arches are INFERRED from the pattern.

Run it after author_welch_courtyard.py (which leaves meshes it does not own
alone). Running it again gives the identical file: it removes its own mesh and
colour first, restores every old post from the column pitch, then rebuilds.

Frame: the recipe's own metres, u east, v north, z up, on block `welch-wings`.
Every flat face has its own vertices so it shades flat; faces that lie in the
same plane (the two big wall faces) share vertices among themselves only. The
inside of an arch is a run of flat strips.
"""
from pathlib import Path
import json
import math
from compact_models import compact

PATH = Path(__file__).resolve().parents[1] / 'data/apartments/welch-hall.json'

# ---- every taste or size choice is here (metres unless stated) ----
# One arcade wall per entry: (face of the block, first bay, bay after the last one).
# Bays are the face's own: n = round(face length / BAY), each face length / n wide. It is
# the rule the app uses to place the windows of the brick wall above (same BAY in
# author_welch_east_wall.py), so each arch sits under a column of windows and each
# post under the brick between two columns.
# Face 3 is the south stretch of the east wall, face 4 the middle stretch; they meet at
# the bend of the wall. The first bay at the south corner and the last two at the
# north end are in no photograph: their arches are INFERRED from the pattern.
BAYS = [(3, 0, 14), (4, 0, 15)]
BAY = 4.2            # one arch in each bay. In the photographs the columns of windows are as far
                     # apart as the rows are (row pitch / column pitch = 1.0), and the rows are
                     # 4.24 m apart (wall height from the 2021 laser scan), so a bay is about 4.2 m
                     # (14 bays on face 3, 15 on face 4).
OPENING = 3.4        # clear width of one arch opening (the photographs: 77 to 80% of a bay)
RISE = 0.72          # how far the curve rises above the straight sides. The photographs show a
                     # FLAT curve, about a fifth as high as the opening is wide, on tall straight
                     # sides. RISE = OPENING / 2 would be a half-circle, which is wrong here.
THICKNESS = 0.9      # wall thickness (the photographs: the piers are about as deep as they are wide)
STANDOFF = 0.4       # how far the front face stands out from the old wall line
HEIGHT = 4.8         # top of the wall; must equal the old arcade band's top
HEADROOM = 1.2       # plaster left above the crown (the photographs: the whole opening is about 1.06 times as high as it is wide)
SEGMENTS = 10        # flat strips in each half-circle head
COLOUR = '#efe9dc'   # plaster: a warm white, set so that it reads like the photographs in the app's light
TONE = 'eastPlaster'
MATERIAL = 'plaster'
MESH_ID = 'welch-east-arcade'
# The glass behind the arches: the photographs show dark openings (a shaded walk), not bright sky.
OLD_SKIN, SHADE_SKIN, SHADE_TONE = 'concourse', 'eastConcourse', 'eastShade'
SHADE_COLOUR, SHADE_STRENGTH = '#2e3338', 0.05
BLOCK = 'welch-wings'
DECIMALS = 3


def build(d, FACE, START, END, count):
    block = next(b for b in d['blocks'] if b['id'] == BLOCK)
    a, c = block['plan']['ring'][FACE:FACE + 2]
    band = block['faces'][str(FACE)]['bands'][0]
    assert abs(band['z1'] - HEIGHT) < 1e-9, 'HEIGHT must match the old arcade band top'
    bay = (END - START) / count
    half = OPENING / 2
    radius = (half * half + RISE * RISE) / (2 * RISE)      # the circle that the curve is a slice of
    sweep = math.asin(half / radius)                        # half of the angle that slice covers
    spring = HEIGHT - RISE - HEADROOM                       # where the straight sides end
    assert 0 < RISE <= half and 0 < spring < HEIGHT and OPENING < bay

    slope = (c[0] - a[0]) / (c[1] - a[1])          # the wall is a little off the v axis
    # outward (east) direction of the wall face, as a unit vector
    nrm = math.hypot(1, slope)
    east = (1 / nrm, -slope / nrm, 0.0)

    def at(v, z, back=False):
        u = a[0] + slope * (v - a[1]) + STANDOFF - (THICKNESS if back else 0)
        return [round(u, DECIMALS), round(v, DECIMALS), round(z, DECIMALS)]

    verts, tris = [], []

    def add(pts):
        n = len(verts)
        verts.extend(pts)
        return list(range(n, n + len(pts)))

    def face(i, j, k, want):
        """One triangle, wound so that its normal points along `want`."""
        p, q, s = verts[i], verts[j], verts[k]
        e1 = [q[x] - p[x] for x in range(3)]
        e2 = [s[x] - p[x] for x in range(3)]
        n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2],
             e1[0] * e2[1] - e1[1] * e2[0]]
        dot = sum(n[x] * want[x] for x in range(3))
        assert abs(dot) > 1e-9, 'degenerate triangle'
        tris.append([i, j, k] if dot > 0 else [i, k, j])

    def quad(p0, p1, p2, p3, want):
        """A flat quad with four vertices of its own."""
        i = add([p0, p1, p2, p3])
        face(i[0], i[1], i[2], want)
        face(i[0], i[2], i[3], want)

    openings = []
    for k in range(count):
        centre = START + (k + .5) * bay
        openings.append((centre - half, centre + half, centre))

    def arc(centre, j):
        t = -sweep + 2 * sweep * j / SEGMENTS
        return centre + radius * math.sin(t), spring + RISE - radius + radius * math.cos(t)

    def wall_face(back):
        """The big plane: piers and the plaster over each arch, shared vertices."""
        want = tuple(-x for x in east) if back else east
        cache = {}

        def vtx(v, z):
            key = (round(v, 6), round(z, 6))
            if key not in cache:
                cache[key] = add([at(v, z, back)])[0]
            return cache[key]

        edges = [START] + [x for lo, hi, _ in openings for x in (lo, hi)] + [END]
        for p in range(count + 1):                       # pier p: edges[2p] .. edges[2p+1]
            va, vb = edges[2 * p], edges[2 * p + 1]
            rows = [0.0, spring, HEIGHT]
            for z0, z1 in zip(rows, rows[1:]):
                face(vtx(va, z0), vtx(vb, z0), vtx(vb, z1), want)
                face(vtx(va, z0), vtx(vb, z1), vtx(va, z1), want)
        for lo, hi, centre in openings:                  # plaster over the arch
            A = [vtx(*arc(centre, j)) for j in range(SEGMENTS + 1)]
            A[0], A[-1] = vtx(lo, spring), vtx(hi, spring)
            TL, TR = vtx(lo, HEIGHT), vtx(hi, HEIGHT)
            m = SEGMENTS // 2
            for j in range(m):
                face(TL, A[j], A[j + 1], want)
            for j in range(m, SEGMENTS):
                face(TR, A[j], A[j + 1], want)
            face(TL, A[m], TR, want)

    wall_face(False)
    wall_face(True)

    for lo, hi, centre in openings:
        for j in range(SEGMENTS):                        # inside of the arch, flat strips
            (v0, z0), (v1, z1) = arc(centre, j), arc(centre, j + 1)
            vm, zm = (v0 + v1) / 2, (z0 + z1) / 2
            ln = math.hypot(centre - vm, spring - zm) or 1.0
            toward = (0.0, (centre - vm) / ln, (spring - zm) / ln)
            quad(at(v0, z0), at(v1, z1), at(v1, z1, True), at(v0, z0, True), toward)
        quad(at(lo, 0), at(lo, spring), at(lo, spring, True), at(lo, 0, True), (0, 1, 0))
        quad(at(hi, 0), at(hi, spring), at(hi, spring, True), at(hi, 0, True), (0, -1, 0))
    quad(at(START, HEIGHT), at(END, HEIGHT), at(END, HEIGHT, True), at(START, HEIGHT, True), (0, 0, 1))
    quad(at(START, 0), at(START, HEIGHT), at(START, HEIGHT, True), at(START, 0, True), (0, -1, 0))
    quad(at(END, 0), at(END, HEIGHT), at(END, HEIGHT, True), at(END, 0, True), (0, 1, 0))
    return verts, tris, count


def posts(block, FACE):
    """Centres (metres along the face) of every old post, from its pitch."""
    cols = block['faces'][str(FACE)]['bands'][0]['inset']['columns']
    a, c = block['plan']['ring'][FACE:FACE + 2]
    length = math.dist(a, c)
    n = max(1, round(length / cols['pitch']))
    return cols, a, c, length, [(i + .5) * length / n for i in range(n)]


def main():
    d = json.loads(PATH.read_text(encoding='utf-8'))
    block = next(b for b in d['blocks'] if b['id'] == BLOCK)

    # remove any earlier run: mesh, colour, material; restore the posts
    d['detailMeshes'] = [m for m in d['detailMeshes'] if m['id'] != MESH_ID]
    d['colours'].pop(TONE, None)
    d['materials'].pop(TONE, None)
    verts, tris, count, removed = [], [], 0, 0
    for FACE, first, stop in BAYS:
        cols, a, c, length, existing = posts(block, FACE)
        cols.pop('at', None)
        bays = max(1, round(length / BAY))
        assert 0 <= first < stop <= bays, 'BAYS must lie inside the face'
        START = a[1] + (c[1] - a[1]) * first / bays
        END = a[1] + (c[1] - a[1]) * stop / bays
        v, t, n = build(d, FACE, START, END, stop - first)
        for p in v:
            assert all(math.isfinite(x) for x in p)
        assert all(0 <= i < len(v) for tri in t for i in tri)
        tris.extend([[i + len(verts) for i in tri] for tri in t])
        verts.extend(v)
        count += n
        kept = [s for s in existing
                if not START <= a[1] + s * (c[1] - a[1]) / length <= END]
        cols['at'] = kept
        band = block['faces'][str(FACE)]['bands'][0]
        assert band['skin'] in (OLD_SKIN, SHADE_SKIN), 'the arcade band has a skin this script does not know'
        band['skin'] = SHADE_SKIN
        removed += len(existing) - len(kept)

    d['colours'][TONE] = {'hex': COLOUR}
    d['materials'][TONE] = MATERIAL
    d['colours'][SHADE_TONE] = {'hex': SHADE_COLOUR}
    d['materials'][SHADE_TONE] = {'type': 'glass', 'strength': SHADE_STRENGTH}
    d['skins'][SHADE_SKIN] = dict(d['skins'][OLD_SKIN], glass=SHADE_TONE)
    for table in (d['colours'], d['materials'], d['skins']):      # east-wall entries go last, in name order (see below)
        for k in sorted(k for k in table if k.startswith('east')):
            table[k] = table.pop(k)
    d['detailMeshes'].append(dict(id=MESH_ID, tone=TONE, vertices=verts, triangles=tris))
    # east-wall meshes go last, in name order, so the file does not depend on which author script ran last
    d['detailMeshes'].sort(key=lambda m: (m['id'].startswith('welch-east-'), m['id'] if m['id'].startswith('welch-east-') else ''))
    PATH.write_text(compact(json.dumps(d, indent=2)), encoding='utf-8')
    print('Welch east arcade:', count, 'arches,', len(verts), 'vertices,', len(tris), 'triangles;',
          removed, 'old posts removed')


if __name__ == '__main__':
    main()
