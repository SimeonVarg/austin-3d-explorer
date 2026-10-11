"""facet-meter-cross.py - the apples-to-apples reading of two moire-meter runs (facadeshader=0 and =1) from their saved pictures.
The meter scores each arm against ITS OWN 4x4 supersampled truth; that cannot say whether the shader wall's picture is the same picture as the geometry's.
This reads, over the pixels the authored-building layer draws in both arms: geometry 1x vs geometry truth, shader 1x vs geometry truth, shader truth vs
geometry truth (do the two pictures agree at high resolution), shader 1x vs shader truth, and the mean level of each (a bias shows here).
  python3 facet-meter-cross.py <dir containing meter0/ and meter1/> [views...]"""
import sys
import numpy as np
from PIL import Image
d = sys.argv[1]; views = sys.argv[2:] or ['west-far', 'west-mid', 'drag-mid']
L = lambda p: np.array(Image.open(p).convert('RGB')).astype(np.float32)
for v in views:
    g1, gt, s1, st = L(f'{d}/meter0/{v}-1x.png'), L(f'{d}/meter0/{v}-truth.png'), L(f'{d}/meter1/{v}-1x.png'), L(f'{d}/meter1/{v}-truth.png')
    m0, m1 = np.array(Image.open(f'{d}/meter0/{v}-mask.png').convert('RGB')), np.array(Image.open(f'{d}/meter1/{v}-mask.png').convert('RGB'))
    mask = (m0[..., 0] > 200) & (m1[..., 0] > 200)
    e = lambda a, b: np.abs(a - b).mean(axis=2)[mask].mean()
    print(f"{v:9s} px {mask.sum():6d} | geometry 1x vs geometry truth {e(g1, gt):5.2f} | shader 1x vs geometry truth {e(s1, gt):5.2f} | shader truth vs geometry truth {e(st, gt):5.2f} | shader 1x vs shader truth {e(s1, st):5.2f} | mean level: geometry truth {gt[mask].mean():.1f}, shader truth {st[mask].mean():.1f}, shader 1x {s1[mask].mean():.1f}, geometry 1x {g1[mask].mean():.1f}")
