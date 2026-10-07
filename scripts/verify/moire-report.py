#!/usr/bin/env python3
"""moire-report.py -- score moire.mjs captures against their supersampled truth.

    python moire-report.py <dir> [<dir-after>] [--crops N] [--blur 1.5]

For every <pose>-native.png / <pose>-truth.png pair in <dir> (a pose capture),
or f####-native/truth sequence (a --flight capture), prints

  alias    mean |native - truth|                luma, 0..255, whole frame
  moire    mean |blur(native) - blur(truth)|    what folds into low frequency
  moireP99 the 99th percentile of the moire map (the worst patches)
  hot%     share of pixels whose moire exceeds HOT (visible bands)

and for flights the temporal half,

  shimmer  mean |dN/dt| - mean |dT/dt|          frame-to-frame change the truth
                                                does not have (per frame pair)

It writes <pose>-heat.png (the moire map, x8) and, with --crops, the N worst
64x64 blocks as native|truth crops (x3). With a second dir the same pose is
scored in both and printed side by side (BEFORE -> AFTER); crops then show
before|after|truth.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

HOT = 6.0          # luma levels of low-frequency error that read as a band
BLOCK = 64


def luma(img):
    a = np.asarray(img.convert('RGB'), dtype=np.float32)
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def blur(L, s):
    im = Image.fromarray(np.clip(L, 0, 255).astype(np.uint8))
    return np.asarray(im.filter(ImageFilter.GaussianBlur(s)), dtype=np.float32)


def blurf(L, s):
    # float gaussian via PIL on a 16-bit-ish scaled copy is lossy; do it in numpy
    r = int(3 * s + 0.5)
    x = np.arange(-r, r + 1, dtype=np.float32)
    k = np.exp(-0.5 * (x / s) ** 2); k /= k.sum()
    p = np.pad(L, r, mode='edge')
    t = np.zeros_like(p)
    for i, w in enumerate(k):
        t[:, r:-r] += w * p[:, i:i + p.shape[1] - 2 * r]
    u = np.zeros_like(L)
    for i, w in enumerate(k):
        u += w * t[i:i + L.shape[0], r:-r]
    return u


def score(nat, tru, s):
    A = np.abs(nat - tru)
    M = np.abs(blurf(nat, s) - blurf(tru, s))
    return A, M


def blocks(M, n):
    h, w = M.shape
    out = []
    for y in range(0, h - BLOCK + 1, BLOCK // 2):
        for x in range(0, w - BLOCK + 1, BLOCK // 2):
            out.append((float(M[y:y + BLOCK, x:x + BLOCK].mean()), x, y))
    out.sort(reverse=True)
    picked = []
    for v, x, y in out:
        if all(abs(x - px) >= BLOCK or abs(y - py) >= BLOCK for _, px, py in picked):
            picked.append((v, x, y))
        if len(picked) >= n:
            break
    return picked


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    opt = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
    ncrops = int(opt('--crops', '0'))
    s = float(opt('--blur', '1.5'))
    dirs = args[:2]
    # skip option values
    dirs = [d for d in dirs if os.path.isdir(d)]
    if not dirs:
        print(__doc__); sys.exit(2)
    base = dirs[0]
    names = sorted(f[:-11] for f in os.listdir(base) if f.endswith('-native.png'))
    flight = all(n.startswith('f') and n[1:].isdigit() for n in names) and len(names) > 1
    rows = []
    if flight:
        for d in dirs:
            prevN = prevT = None
            dn = dt = 0.0; al = mo = 0.0; k = 0
            for n in names:
                N = luma(Image.open(os.path.join(d, n + '-native.png')))
                T = luma(Image.open(os.path.join(d, n + '-truth.png')))
                A, M = score(N, T, s)
                al += A.mean(); mo += M.mean()
                if prevN is not None:
                    dn += np.abs(N - prevN).mean(); dt += np.abs(T - prevT).mean(); k += 1
                prevN, prevT = N, T
            rows.append((d, al / len(names), mo / len(names), dn / max(k, 1), dt / max(k, 1)))
        print(f"{'dir':50s} {'alias':>7s} {'moire':>7s} {'|dN|':>7s} {'|dT|':>7s} {'shimmer':>8s}")
        for d, al, mo, dn, dt in rows:
            print(f"{os.path.basename(d.rstrip('/')):50s} {al:7.3f} {mo:7.3f} {dn:7.3f} {dt:7.3f} {dn - dt:8.3f}")
        return
    print(f"{'pose':14s} " + ' | '.join(f"{'alias':>6s} {'moire':>6s} {'p99':>6s} {'hot%':>6s}" for _ in dirs))
    summary = {}
    for n in names:
        line = f"{n:14s} "
        maps = []
        for d in dirs:
            fn, ft = os.path.join(d, n + '-native.png'), os.path.join(d, n + '-truth.png')
            if not (os.path.exists(fn) and os.path.exists(ft)):
                line += ' | ' + ' ' * 27; maps.append(None); continue
            N, T = luma(Image.open(fn)), luma(Image.open(ft))
            A, M = score(N, T, s)
            hot = float((M > HOT).mean() * 100)
            line += (' | ' if maps else '') + f"{A.mean():6.2f} {M.mean():6.3f} {np.percentile(M, 99):6.2f} {hot:6.2f}"
            maps.append(M)
            summary.setdefault(n, []).append({'alias': float(A.mean()), 'moire': float(M.mean()), 'p99': float(np.percentile(M, 99)), 'hot': hot})
            heat = Image.fromarray(np.clip(M * 8, 0, 255).astype(np.uint8))
            heat.save(os.path.join(d, n + '-heat.png'))
        print(line)
        # ownership: which system draws the moire (moire.mjs --own)
        groups = ['authored', 'patterned', 'extrusions', 'outer', 'trees', 'ground']
        for d, M in zip(dirs, maps):
            if M is None or not os.path.exists(os.path.join(d, n + '-own-authored.png')):
                continue
            N = luma(Image.open(os.path.join(d, n + '-native.png')))
            diffs = np.stack([np.abs(N - luma(Image.open(os.path.join(d, f'{n}-own-{g}.png')))) for g in groups])
            owner = np.where(diffs.max(0) > 6, diffs.argmax(0), -1)
            tot = float(M.sum()) or 1.0
            parts = []
            for i, g in enumerate(groups):
                msk = owner == i
                parts.append(f"{g} {100 * M[msk].sum() / tot:4.1f}% ({100 * msk.mean():4.1f}% px, {M[msk].mean() if msk.any() else 0:4.2f})")
            msk = owner == -1
            parts.append(f"other {100 * M[msk].sum() / tot:4.1f}%")
            summary.setdefault(n + ':own:' + os.path.basename(d.rstrip('/')), []).append(
                {g: float(M[owner == i].sum() / tot) for i, g in enumerate(groups)})
            print('    own[' + os.path.basename(d.rstrip('/')) + ']: ' + '  '.join(parts))
        if ncrops and maps[0] is not None:
            picks = blocks(maps[0], ncrops)
            srcs = [Image.open(os.path.join(d, n + '-native.png')).convert('RGB') for d in dirs]
            srcs.append(Image.open(os.path.join(dirs[0], n + '-truth.png')).convert('RGB'))
            for i, (v, x, y) in enumerate(picks):
                box = (x - 32, y - 32, x + BLOCK + 32, y + BLOCK + 32)
                tiles = [im.crop(box).resize((384, 384), Image.NEAREST) for im in srcs]
                strip = Image.new('RGB', (384 * len(tiles) + 8 * (len(tiles) - 1), 384), (255, 255, 255))
                for j, t in enumerate(tiles):
                    strip.paste(t, (j * 392, 0))
                strip.save(os.path.join(dirs[-1], f"{n}-crop{i}-{x}-{y}.png"))
                print(f"    crop{i} at ({x},{y}) moire {v:.2f}" + ''.join(
                    f"  {os.path.basename(d.rstrip('/'))}={m[y:y + BLOCK, x:x + BLOCK].mean():.2f}" for d, m in zip(dirs, maps) if m is not None))
    with open(os.path.join(dirs[-1], 'moire-summary.json'), 'w') as f:
        json.dump({'dirs': dirs, 'blur': s, 'hot': HOT, 'poses': summary}, f, indent=1)


if __name__ == '__main__':
    main()
