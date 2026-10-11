#!/usr/bin/env python3
"""make-clip.py - turn the frames scripts/verify/air-run.mjs --mode clip wrote into one animated WebP.

  python3 scripts/air/make-clip.py FRAMES_DIR OUT.webp [--fps 30] [--width 960] [--quality 72] [--step 1]

--step 2 keeps every second frame (halves the size; the clip then plays at fps/2 x 2 so it keeps real time).
Pillow only (no ffmpeg on the Mac). Prints the size, because a clip that is too big to share is not a deliverable.
"""
import argparse, glob, os
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('frames'); ap.add_argument('out')
ap.add_argument('--fps', type=float, default=30); ap.add_argument('--width', type=int, default=960)
ap.add_argument('--quality', type=int, default=72); ap.add_argument('--step', type=int, default=1)
a = ap.parse_args()
files = sorted(glob.glob(os.path.join(a.frames, '*.jpg')))[::a.step]
if not files: raise SystemExit('no frames in ' + a.frames)
imgs = []
for f in files:
    im = Image.open(f).convert('RGB')
    h = round(im.height * a.width / im.width)
    imgs.append(im.resize((a.width, h), Image.LANCZOS))
dur = int(round(1000 * a.step / a.fps))
imgs[0].save(a.out, save_all=True, append_images=imgs[1:], duration=dur, loop=0, quality=a.quality, method=6)
print(f'{len(imgs)} frames, {dur} ms each, {os.path.getsize(a.out)/1e6:.1f} MB -> {a.out}')
