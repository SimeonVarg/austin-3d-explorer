"""Sample leaf and trunk colour from the owner's photographs: median sRGB of masked pixels, split into shaded / mid / sunlit by luminance.
Regions are (photo, x0, y0, x1, y1) in the 1200x1600 oriented jpgs. The foliage mask drops sky, white cloud, grey walls, water."""
import json, os, sys
import numpy as np
from PIL import Image
D = os.environ.get('TREE_PHOTOS', os.path.dirname(os.path.abspath(__file__)) + '/photos') + '/'

REG = {
    # species: (photo, box, kind)
    'live_oak_street':   ('1789', (200, 760, 680, 1100), 'leaf'),   # a street live oak against brick, shade side
    'live_oak_lake':     ('1762', (300, 1100, 1200, 1600), 'leaf'),   # lakeside oak crowns from above (Mount Bonnell)
    'dark_backlit':      ('1778', (900, 1330, 1190, 1590), 'leaf'),   # the dark backlit crown at IMG_1778 bottom right
    'sunlit_leafy':      ('1779', (25, 650, 425, 1350), 'leaf'),
    'juniper_slope':     ('1759', (20, 1000, 340, 1350), 'leaf'),    # ashe juniper bush on the bluff
    'hill_mix':          ('1761', (75, 625, 1100, 1000), 'leaf'),     # far wooded hillside, oak + juniper
    'trunk_street_oak':  ('1789', (439, 1160, 449, 1290), 'trunk'),
    'trunk_juniper':     ('1759', (880, 900, 940, 950), 'trunk'),
}

def lum(a):
    return 0.2126 * a[:, 0] + 0.7152 * a[:, 1] + 0.0722 * a[:, 2]

out = {}
dbg = []
for k, (n, box, kind) in REG.items():
    im = np.asarray(Image.open(D + f'IMG_{n}.jpg').convert('RGB')).astype(np.float32)
    x0, y0, x1, y1 = box
    c = im[y0:y1, x0:x1].reshape(-1, 3)
    r, g, b = c[:, 0], c[:, 1], c[:, 2]
    L = lum(c)
    if kind == 'leaf':
        m = (g >= r * 0.92) & (g >= b * 1.02) & (L < 175) & (L > 12)      # green-ish, not sky (b>g), not white cloud
    else:
        m = (L > 15) & (L < 200) & (~((b > g * 1.1) & (b > r * 1.1)))
    sel = c[m]
    if len(sel) < 200:
        out[k] = {'photo': n, 'n': int(len(sel)), 'error': 'too few'}; continue
    l = lum(sel)
    q = np.quantile(l, [0.25, 0.75])
    res = {'photo': n, 'box': box, 'masked_px': int(len(sel)), 'of_px': int(len(c))}
    for name, mk in (('shaded', l <= q[0]), ('mid', (l > q[0]) & (l < q[1])), ('sunlit', l >= q[1])):
        med = np.median(sel[mk], axis=0)
        res[name] = '#%02x%02x%02x' % tuple(int(round(v)) for v in med)
    res['all'] = '#%02x%02x%02x' % tuple(int(round(v)) for v in np.median(sel, axis=0))
    out[k] = res
    # debug tile: left the crop, right the masked pixels (grey elsewhere)
    cr = im[y0:y1, x0:x1].copy()
    mm = m.reshape(cr.shape[:2])
    ms = cr.copy(); ms[~mm] = 128
    t = np.concatenate([cr, ms], axis=1).astype(np.uint8)
    t = Image.fromarray(t); t.thumbnail((420, 220)); dbg.append((k, t))
print(json.dumps(out, indent=1))
json.dump(out, open(os.path.dirname(os.path.abspath(__file__)) + '/photo_colours.json', 'w'), indent=1)
W = 440; H = 240
sheet = Image.new('RGB', (W * 2, H * ((len(dbg) + 1) // 2)), 'white')
from PIL import ImageDraw
for i, (k, t) in enumerate(dbg):
    sheet.paste(t, ((i % 2) * W, (i // 2) * H + 14)); ImageDraw.Draw(sheet).text(((i % 2) * W + 2, (i // 2) * H), k, fill='black')
if os.environ.get('TREE_DEBUG'): sheet.save(os.environ['TREE_DEBUG'])   # the crops are the owner's photographs: written outside the repo, only when asked
