# shimmer = mean|native(t+1)-native(t)| - mean|truth(t+1)-truth(t)| in an ROI, and alias = mean|native - truth| (as scripts/verify/moire.mjs)
import sys, numpy as np
from PIL import Image
pre, n, roi = sys.argv[1], int(sys.argv[2]), [int(v) for v in sys.argv[3].split(',')]
def load(tag, i, size=None):
    im = Image.open('%s_%s_%d.png' % (pre, tag, i)).convert('L')
    if size: im = im.resize(size, Image.BOX)
    return np.asarray(im, float)[roi[1]:roi[3], roi[0]:roi[2]]
size = Image.open('%s_native_0.png' % pre).size
N = [load('native', i) for i in range(n)]; T = [load('truth', i, size) for i in range(n)]
alias = np.mean([np.abs(a - b).mean() for a, b in zip(N, T)])
dn = np.mean([np.abs(N[i + 1] - N[i]).mean() for i in range(n - 1)]); dt = np.mean([np.abs(T[i + 1] - T[i]).mean() for i in range(n - 1)])
# flicker that is not motion: frame-to-frame change of the ERROR (native - truth)
fl = np.mean([np.abs((N[i + 1] - T[i + 1]) - (N[i] - T[i])).mean() for i in range(n - 1)])
print('alias %.2f  shimmer %.2f (native %.2f - truth %.2f)  error-flicker %.2f  (grey levels, ROI %s)' % (alias, dn - dt, dn, dt, fl, roi))
