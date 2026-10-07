"""Author the round arches on the south part of Welch Hall's east ground-floor arcade.

An owner's photograph of the east side shows a smooth pale plaster wall with
round-arched openings along the ground floor. The recipe had square posts there.
This script adds one detail mesh, `welch-east-arcade`: a plaster wall pierced by
evenly spaced round arches, standing just in front of the old posts, and it
takes the old posts out of that stretch only. The north part of the east wall
is not photographed and is left exactly as it was.

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
START = 2.0          # v where the arcade wall begins
END = 58.0           # v where it ends (the rest of the east wall is untouched)
BAY = 3.5            # one arch every BAY metres; count = round((END-START)/BAY)
OPENING = 2.5        # clear width of one arch opening
THICKNESS = 0.5      # wall thickness
STANDOFF = 0.4       # how far the front face stands out from the old wall line
HEIGHT = 4.8         # top of the wall; must equal the old arcade band's top
HEADROOM = 0.30      # plaster left above the crown of each arch
SEGMENTS = 10        # flat strips in each half-circle head
COLOUR = '#dad8d3'   # plaster, sampled from the owner's photograph
TONE = 'eastPlaster'
MATERIAL = 'plaster'
MESH_ID = 'welch-east-arcade'
BLOCK = 'welch-wings'
FACE = 3             # the block's east face: ring points FACE to FACE+1
DECIMALS = 3


def build(d):
    block = next(b for b in d['blocks'] if b['id'] == BLOCK)
    a, c = block['plan']['ring'][FACE:FACE + 2]
    band = block['faces'][str(FACE)]['bands'][0]
    assert abs(band['z1'] - HEIGHT) < 1e-9, 'HEIGHT must match the old arcade band top'
    count = round((END - START) / BAY)
    bay = (END - START) / count
    r = OPENING / 2
    spring = HEIGHT - r - HEADROOM
    assert 0 < spring < HEIGHT and OPENING < bay

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
        openings.append((centre - r, centre + r, centre))

    def arc(centre, j):
        t = j * math.pi / SEGMENTS
        return centre - r * math.cos(t), spring + r * math.sin(t)

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


def posts(block):
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
    cols, a, c, length, existing = posts(block)
    cols.pop('at', None)

    verts, tris, count = build(d)
    for p in verts:
        assert all(math.isfinite(x) for x in p)
    assert all(0 <= i < len(verts) for t in tris for i in t)

    d['colours'][TONE] = {'hex': COLOUR}
    d['materials'][TONE] = MATERIAL
    d['detailMeshes'].append(dict(id=MESH_ID, tone=TONE, vertices=verts, triangles=tris))
    kept = [s for s in existing
            if not START <= a[1] + s * (c[1] - a[1]) / length <= END]
    cols['at'] = kept
    PATH.write_text(compact(json.dumps(d, indent=2)), encoding='utf-8')
    print('Welch east arcade:', count, 'arches,', len(verts), 'vertices,', len(tris), 'triangles;',
          len(existing) - len(kept), 'old posts removed')


if __name__ == '__main__':
    main()
