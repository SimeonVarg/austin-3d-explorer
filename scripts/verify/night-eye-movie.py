#!/usr/bin/env python3
"""Compose the night-eye movie frames (night-eye.mjs --only movie) into labelled animated webp/gif files and 3x crops.

    python3 night-eye-movie.py <movie-dir> <out-dir> [--fps 15]

Per view: <view>-before-after.webp (old night left, new night right, labelled; --gif adds a gif, about 35 MB), and <view>-crop-3x.png (a far patch of lit windows at 3x:
old, then the new night at three moments) . Needs Pillow."""
import sys, glob, os
from PIL import Image, ImageDraw, ImageFont

src, out = sys.argv[1], sys.argv[2]
fps = 15
os.makedirs(out, exist_ok=True)

def font(size):
    for f in ('/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/Supplemental/Arial.ttf', 'DejaVuSans.ttf'):
        try: return ImageFont.truetype(f, size)
        except Exception: pass
    return ImageFont.load_default()

def lit_window(im, w, h, y0, y1, thr=100):
    """Top-left of the w x h patch with the most lit pixels in rows y0..y1 (a coarse integral over 8 px cells)."""
    px = im.convert('L').load(); W, H = im.size
    best, at = -1, (0, y0)
    for y in range(y0, min(y1, H - h), 8):
        for x in range(0, W - w, 8):
            n = 0
            for yy in range(y, y + h, 4):
                for xx in range(x, x + w, 4):
                    if px[xx, yy] >= thr: n += 1
            if n > best: best, at = n, (x, y)
    return at

views = sorted({os.path.basename(f).rsplit('-before', 1)[0] for f in glob.glob(os.path.join(src, '*-before.jpg'))})
for v in views:
    before = Image.open(os.path.join(src, f'{v}-before.jpg')).convert('RGB')
    frames = sorted(glob.glob(os.path.join(src, f'{v}-after-*.jpg')))
    W, H = before.size; pw = 720; ph = round(H * pw / W); strip = 34
    f1, f2 = font(20), font(15)
    left = before.resize((pw, ph), Image.LANCZOS)
    out_frames = []
    for i, fn in enumerate(frames):
        a = Image.open(fn).convert('RGB').resize((pw, ph), Image.LANCZOS)
        canvas = Image.new('RGB', (pw * 2 + 6, ph + strip), (10, 12, 20))
        d = ImageDraw.Draw(canvas)
        d.text((10, 6), f'OLD NIGHT  ({v})', fill=(220, 220, 220), font=f1)
        d.text((pw + 16, 6), f'NEW NIGHT: shimmer, glare, colour   t = {i / fps:4.2f} s', fill=(255, 225, 160), font=f1)
        canvas.paste(left, (0, strip)); canvas.paste(a, (pw + 6, strip))
        out_frames.append(canvas)
    if out_frames:
        dur = round(1000 / fps)
        out_frames[0].save(os.path.join(out, f'{v}-before-after.webp'), save_all=True, append_images=out_frames[1:], duration=dur, loop=0, quality=78, method=4)
        if '--gif' in sys.argv: out_frames[0].save(os.path.join(out, f'{v}-before-after.gif'), save_all=True, append_images=out_frames[1:], duration=dur, loop=0, optimize=True)   # about 35 MB: only on request
        print(v, len(out_frames), 'frames ->', os.path.join(out, f'{v}-before-after.webp'))
        # 3x crop of a far patch of lit windows: old, then new at three moments
        a0 = Image.open(frames[0]).convert('RGB')
        cw, ch = 200, 120
        x, y = lit_window(a0, cw, ch, int(H * 0.22), int(H * 0.52))   # far rows: above the middle of the frame
        pick = [before, a0, Image.open(frames[min(5, len(frames) - 1)]).convert('RGB'), Image.open(frames[min(11, len(frames) - 1)]).convert('RGB')]
        names = ['old night', 'new night, t = 0.00 s', 'new night, t = 0.33 s', 'new night, t = 0.73 s']
        tiles = [im.crop((x, y, x + cw, y + ch)).resize((cw * 3, ch * 3), Image.NEAREST) for im in pick]
        sheet = Image.new('RGB', (cw * 3 * 2 + 6, (ch * 3 + 26) * 2 + 6), (10, 12, 20)); d = ImageDraw.Draw(sheet)
        for k, (t, nm) in enumerate(zip(tiles, names)):
            ox, oy = (k % 2) * (cw * 3 + 6), (k // 2) * (ch * 3 + 26 + 6)
            d.text((ox + 6, oy + 4), nm + f'   (patch at {x},{y}, 3x)', fill=(235, 235, 235), font=f2); sheet.paste(t, (ox, oy + 26))
        sheet.save(os.path.join(out, f'{v}-crop-3x.png'))
        # the glare skirt: the same frozen frame with the glare lobes off and on (night-eye.mjs --only movie writes both), around the brightest
        # warm cluster; third panel = the difference times 8. Also the mean light the glare adds, and its fall-off with distance from the cluster.
        g0f, g1f = os.path.join(src, f'{v}-glare0.png'), os.path.join(src, f'{v}-glare1.png')
        if os.path.exists(g0f) and os.path.exists(g1f):
            G0, G1 = Image.open(g0f).convert('RGB'), Image.open(g1f).convert('RGB'); p0, p1 = G0.load(), G1.load(); Wd, Hd = G0.size
            best, bx, by = -1, 0, 0
            for yy in range(int(Hd * 0.2), Hd - 70, 6):
                for xx in range(70, Wd - 70, 6):
                    r, g, b = p0[xx, yy]
                    sc = (r + g + b) if (r > b + 25 and r > 200) else 0
                    if sc > best: best, bx, by = sc, xx, yy
            gw, gh = 140, 90; gx, gy = max(0, min(Wd - gw, bx - gw // 2)), max(0, min(Hd - gh, by - gh // 2))
            # the exact skirt: the effects canvas (bloom + glare lobes, added over the map) with the glare off against on; the screenshot pair is the fallback
            fx0f, fx1f = os.path.join(src, f'{v}-glare0-fx.png'), os.path.join(src, f'{v}-glare1-fx.png')
            if os.path.exists(fx0f) and os.path.exists(fx1f):
                F0, F1 = Image.open(fx0f).convert('RGBA'), Image.open(fx1f).convert('RGBA')
                if F0.size != (Wd, Hd): F0, F1 = F0.resize((Wd, Hd)), F1.resize((Wd, Hd))
                a0, a1 = F0.load(), F1.load(); fxtot = 0.0; fxmax = 0
                for yy in range(0, Hd, 2):
                    for xx in range(0, Wd, 2):
                        dd = max(0, a1[xx, yy][0] - a0[xx, yy][0]) * a1[xx, yy][3] / 255.0
                        fxtot += dd
                        if dd > fxmax: fxmax = dd
                print(v, 'effects canvas: the glare lobes add on average %.3f of 255 (red) over the frame, at most %d' % (fxtot / ((Wd // 2) * (Hd // 2)), fxmax))
            tot = 0; n = 0; prof = {}
            for yy in range(Hd):
                for xx in range(Wd):
                    d = sum(abs(p1[xx, yy][k] - p0[xx, yy][k]) for k in range(3)) / 3.0
                    tot += d; n += 1
                    r_ = int(((xx - bx) ** 2 + (yy - by) ** 2) ** 0.5 // 10)
                    if r_ < 12: a = prof.setdefault(r_, [0, 0]); a[0] += d; a[1] += 1
            print(v, 'glare adds on average %.3f of 255 per channel over the whole frame' % (tot / n), '; around the brightest cluster (10 px rings):', ' '.join('%.1f' % (prof[k][0] / prof[k][1]) for k in sorted(prof)))
            diff = Image.new('RGB', (gw, gh)); dp = diff.load()
            if os.path.exists(fx0f) and os.path.exists(fx1f):   # the exact skirt, x16
                c0, c1 = F0.crop((gx, gy, gx + gw, gy + gh)).load(), F1.crop((gx, gy, gx + gw, gy + gh)).load()
                for yy in range(gh):
                    for xx in range(gw): dp[xx, yy] = tuple(min(255, max(0, c1[xx, yy][k] - c0[xx, yy][k]) * 16) for k in range(3))
            else:
                c0, c1 = G0.crop((gx, gy, gx + gw, gy + gh)).load(), G1.crop((gx, gy, gx + gw, gy + gh)).load()
                for yy in range(gh):
                    for xx in range(gw): dp[xx, yy] = tuple(min(255, max(0, c1[xx, yy][k] - c0[xx, yy][k]) * 8) for k in range(3))
            g10f = os.path.join(src, f'{v}-glare10.png')
            G10 = Image.open(g10f).convert('RGB') if os.path.exists(g10f) else G1
            tiles = [G0.crop((gx, gy, gx + gw, gy + gh)), G10.crop((gx, gy, gx + gw, gy + gh)), diff]
            gs = Image.new('RGB', (gw * 9 + 12, gh * 3 + 26), (10, 12, 20)); d = ImageDraw.Draw(gs)
            for k, (t, nm) in enumerate(zip(tiles, ['glare off', 'glare x10 (?glare=10)', 'default glare lobes (x16)'])):
                d.text((k * (gw * 3 + 6) + 6, 4), nm + f'   ({gx},{gy}, 3x)', fill=(235, 235, 235), font=f2); gs.paste(t.resize((gw * 3, gh * 3), Image.NEAREST), (k * (gw * 3 + 6), 26))
            gs.save(os.path.join(out, f'{v}-glare-crop-3x.png'))
