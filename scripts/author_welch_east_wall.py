"""Author the brick wall above Welch Hall's east ground-floor arcade.

Two photographs of the east side show, above the plaster arcade, THREE storeys
of tall narrow dark windows, one pane each, every window with a pale stone bar
on top and a thin pale sill under it, on warm red-brown brick, with a dark roof
edge and dark downpipes. The recipe had two rows of wide gridded windows and a
blank strip of brick above them, because the wall took its window rows from
the building's `levels`, which give this wall two storeys. Each window also has
a dark bar across it, a little under half way up.

This script gives faces 3 and 4 of the blocks `welch-wings` and
`welch-upper-wings` their own skin, with the band's own floor lines (`floors`
on a band, see docs/apartments.md), and adds three small detail meshes: the
stone bars and sills, the dark bars across the glass, and the downpipes. The bars and sills are placed by the
same rule the app uses for a `bays` skin (n = round(L / bay), one window at
each bay centre), so they sit on the windows.

Run it after author_welch_courtyard.py and author_welch_east_arcade.py, in any
order with the arcade script. Running it again gives the identical file: it
removes its own meshes first and sets every value it owns outright. The first
band of each face (the arcade storefront and its posts) is not touched.
"""
from pathlib import Path
import json
import math
from compact_models import compact
import author_welch_east_arcade as arcade

PATH = Path(__file__).resolve().parents[1] / 'data/apartments/welch-hall.json'

# ---- every taste or size choice is here (metres unless stated) ----
FACES = (3, 4)                 # the east wall: ring points 3-4 and 4-5
LOWER, UPPER = 'welch-wings', 'welch-upper-wings'
ARCADE_TOP = 4.8               # top of the plaster arcade = bottom of the brick
SEAM = 12.7                    # where the two blocks meet
WALL_TOP = 18.2
FLOORS = [4.8, 9.27, 13.74]    # floor line of each window row (three even storeys)
BAY = arcade.BAY               # one window per bay; the arcade script puts one arch under each
WIN_W, WIN_H, SILL = 1.2, 2.3, 0.75
FRAME_W = 0.05
REVEAL = 0.2
BAR_H = 0.55                   # the stone bar on top of each window
SILL_H = 0.08                  # the thin stone sill under it
PROUD = 0.03                   # bars and sills stand this far in front of the brick
ROOF_EDGE_H = 0.25             # dark band at the top of the wall
TRANSOM_AT, TRANSOM_H = 0.38, 0.06   # the dark bar across each window: how far up the glass, and how thick
PIPES_PER_FACE = 4
PIPE_W, PIPE_PROUD, PIPE_TOP = 0.14, 0.05, 17.95   # a pipe on an arcade post runs on down the plaster to the ground
COLOURS = {                    # measured from the photographs, then set by eye in the app's light
    'eastBrick': '#c2a492',
    'eastGlass': '#6a6c6e',
    'eastFrame': '#37393d',
    'eastPipe': '#443b3b',
    'eastStone': '#eeeae0',
    'eastRoofEdge': '#4a443e',
}
MATERIALS = {'eastBrick': 'brick', 'eastGlass': {'type': 'glass', 'strength': 0.12}, 'eastStone': 'stone'}
SKIN = 'eastWall'
BARS_ID, PIPES_ID, TRANSOMS_ID = 'welch-east-lintels', 'welch-east-pipes', 'welch-east-transoms'
DECIMALS = 3


def quad(a, along, out, s0, s1, off, z0, z1):
    """A flat quad with four vertices of its own, `off` metres in front of the wall."""
    def at(s, z):
        return [round(a[0] + along[0] * s + out[0] * off, DECIMALS),
                round(a[1] + along[1] * s + out[1] * off, DECIMALS), round(z, DECIMALS)]
    return [at(s0, z0), at(s1, z0), at(s1, z1), at(s0, z1)]


def push(verts, tris, q):
    n = len(verts)
    verts.extend(q)
    tris.extend([[n, n + 1, n + 2], [n, n + 2, n + 3]])


def main():
    d = json.loads(PATH.read_text(encoding='utf-8'))
    blocks = {b['id']: b for b in d['blocks']}
    lower, upper = blocks[LOWER], blocks[UPPER]
    ring = lower['plan']['ring']
    assert upper['plan']['ring'][FACES[0]:FACES[-1] + 2] == ring[FACES[0]:FACES[-1] + 2], 'the two blocks must share the east wall line'
    for f in FLOORS:                      # no window may cross the seam between the blocks
        assert not (f + SILL < SEAM < f + SILL + WIN_H), 'a window would cross the block seam'

    for tone, hexv in COLOURS.items():
        d['colours'][tone] = {'hex': hexv}
    for tone, mat in MATERIALS.items():
        d['materials'][tone] = mat
    d['skins'][SKIN] = {
        'kind': 'bays', 'field': 'eastBrick', 'bay': BAY, 'glass': 'eastGlass', 'frame': 'eastBrick', 'reveal': REVEAL,
        'window': {'w': WIN_W, 'h': WIN_H, 'sill': SILL, 'frame': {'w': FRAME_W, 'tone': 'eastFrame'}},
        'bands': [{'z0': WALL_TOP - ROOF_EDGE_H, 'z1': WALL_TOP, 'tone': 'eastRoofEdge'}],
    }
    for table in (d['colours'], d['materials'], d['skins']):      # east-wall entries go last, in name order (see the end of main)
        for k in sorted(k for k in table if k.startswith('east')):
            table[k] = table.pop(k)
    low_floors = [f for f in FLOORS if f < SEAM]
    up_floors = [f for f in FLOORS if f >= SEAM]
    for face in FACES:
        k = str(face)
        bands = lower['faces'][k]['bands']
        assert bands[0]['z1'] == ARCADE_TOP, 'the arcade band must end where the brick begins'
        lower['faces'][k]['bands'] = [bands[0], {'z0': ARCADE_TOP, 'z1': SEAM, 'skin': SKIN, 'floors': low_floors}]
        upper['faces'][k] = {'bands': [{'z0': SEAM, 'z1': WALL_TOP, 'skin': SKIN, 'floors': up_floors}]}

    bars_v, bars_t, pipes_v, pipes_t, bar_v, bar_t, windows = [], [], [], [], [], [], 0
    arches = {face: (first, stop) for face, first, stop in arcade.BAYS}
    for face in FACES:
        a, b = ring[face], ring[face + 1]
        length = math.dist(a, b)
        along = ((b[0] - a[0]) / length, (b[1] - a[1]) / length)
        out = (along[1], -along[0])                         # east, away from the building
        n = max(1, round(length / BAY))                     # the app's own bay rule
        mod = length / n
        for f in FLOORS:
            for i in range(n):
                s = (i + .5) * mod
                top = f + SILL + WIN_H
                push(bars_v, bars_t, quad(a, along, out, s - WIN_W / 2, s + WIN_W / 2, PROUD, top, top + BAR_H))
                push(bars_v, bars_t, quad(a, along, out, s - WIN_W / 2, s + WIN_W / 2, PROUD, f + SILL - SILL_H, f + SILL))
                mid = f + SILL + WIN_H * TRANSOM_AT
                push(bar_v, bar_t, quad(a, along, out, s - WIN_W / 2, s + WIN_W / 2, 0.02 - REVEAL, mid, mid + TRANSOM_H))
                windows += 1
        for p in range(1, PIPES_PER_FACE + 1):              # on a bay line, so between two windows
            line = round(p * n / (PIPES_PER_FACE + 1))
            s = line * mod
            push(pipes_v, pipes_t, quad(a, along, out, s - PIPE_W / 2, s + PIPE_W / 2, PIPE_PROUD, ARCADE_TOP, PIPE_TOP))
            first, stop = arches.get(face, (0, 0))
            if first <= line <= stop and first < stop:      # this bay line is an arcade post
                push(pipes_v, pipes_t, quad(a, along, out, s - PIPE_W / 2, s + PIPE_W / 2, arcade.STANDOFF + PIPE_PROUD, 0, ARCADE_TOP))

    d['detailMeshes'] = [m for m in d['detailMeshes'] if m['id'] not in (BARS_ID, PIPES_ID, TRANSOMS_ID)]
    d['detailMeshes'].append(dict(id=BARS_ID, tone='eastStone', vertices=bars_v, triangles=bars_t))
    d['detailMeshes'].append(dict(id=PIPES_ID, tone='eastPipe', vertices=pipes_v, triangles=pipes_t))
    d['detailMeshes'].append(dict(id=TRANSOMS_ID, tone='eastFrame', vertices=bar_v, triangles=bar_t))
    # east-wall meshes go last, in name order, so the file does not depend on which author script ran last
    d['detailMeshes'].sort(key=lambda m: (m['id'].startswith('welch-east-'), m['id'] if m['id'].startswith('welch-east-') else ''))
    PATH.write_text(compact(json.dumps(d, indent=2)), encoding='utf-8')
    print('Welch east wall:', len(FLOORS), 'rows,', windows, 'windows with a bar and a sill each,', PIPES_PER_FACE * len(FACES), 'downpipes')


if __name__ == '__main__':
    main()
