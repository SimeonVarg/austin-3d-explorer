#!/usr/bin/env python3
"""Compose the night-eye movie frames (night-eye.mjs --only movie) into labelled animated webp/gif files and 3x crops.

    python3 night-eye-movie.py <movie-dir> <out-dir> [--fps 15]

Per view: <view>-before-after.webp (old night left, new night right, labelled), and <view>-crop-3x.png (a far patch of lit windows at 3x:
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
        out_frames[0].save(os.path.join(out, f'{v}-before-after.gif'), save_all=True, append_images=out_frames[1:], duration=dur, loop=0, optimize=True)
        print(v, len(out_frames), 'frames ->', os.path.join(out, f'{v}-before-after.webp'))
        # 3x crop of a far patch of lit windows: old, then new at three moments
        a0 = Image.open(frames[0]).convert('RGB')
        cw, ch = 200, 120
        x, y = lit_window(a0, cw, ch, int(H * 0.15), int(H * 0.62))
        pick = [before, a0, Image.open(frames[min(5, len(frames) - 1)]).convert('RGB'), Image.open(frames[min(11, len(frames) - 1)]).convert('RGB')]
        names = ['old night', 'new night, t = 0.00 s', 'new night, t = 0.33 s', 'new night, t = 0.73 s']
        tiles = [im.crop((x, y, x + cw, y + ch)).resize((cw * 3, ch * 3), Image.NEAREST) for im in pick]
        sheet = Image.new('RGB', (cw * 3 * 2 + 6, (ch * 3 + 26) * 2 + 6), (10, 12, 20)); d = ImageDraw.Draw(sheet)
        for k, (t, nm) in enumerate(zip(tiles, names)):
            ox, oy = (k % 2) * (cw * 3 + 6), (k // 2) * (ch * 3 + 26 + 6)
            d.text((ox + 6, oy + 4), nm + f'   (patch at {x},{y}, 3x)', fill=(235, 235, 235), font=f2); sheet.paste(t, (ox, oy + 26))
        sheet.save(os.path.join(out, f'{v}-crop-3x.png'))
        # the glare skirt: the brightest patch, old against new, 3x
        px = a0.convert('L'); bx, by, bv = 0, 0, -1
        lp = a0.convert('L').load(); lb = before.convert('L').load()
        for yy in range(int(H * 0.2), H - 60, 6):
            for xx in range(60, W - 60, 6):
                if lp[xx, yy] > bv: bv, bx, by = lp[xx, yy], xx, yy
        gw, gh = 130, 80; gx, gy = max(0, min(W - gw, bx - gw // 2)), max(0, min(H - gh, by - gh // 2))
        g0 = before.crop((gx, gy, gx + gw, gy + gh)).resize((gw * 3, gh * 3), Image.NEAREST); g1 = a0.crop((gx, gy, gx + gw, gy + gh)).resize((gw * 3, gh * 3), Image.NEAREST)
        gs = Image.new('RGB', (gw * 6 + 6, gh * 3 + 26), (10, 12, 20)); d = ImageDraw.Draw(gs)
        d.text((6, 4), f'old night   (brightest patch at {gx},{gy}, 3x)', fill=(235, 235, 235), font=f2); d.text((gw * 3 + 12, 4), 'new night (glare skirt, shimmer)', fill=(255, 225, 160), font=f2)
        gs.paste(g0, (0, 26)); gs.paste(g1, (gw * 3 + 6, 26)); gs.save(os.path.join(out, f'{v}-glare-crop-3x.png'))
