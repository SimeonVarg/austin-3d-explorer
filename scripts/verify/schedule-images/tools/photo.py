"""photo.py — turn a clean render into the thing a student actually sends you.

    python photo.py <jobs.json>

Three operations, driven entirely by the job spec corpus.mjs writes:

  clean   downscale + JPEG.
  crop    take a rectangle, downscale + JPEG.
  photo   put the render on a plane in 3D, turn the plane away from the camera,
          project it, composite it onto a dark room with a bezel around it,
          then apply — in this order, because it is the order a real camera
          applies them — a monitor pixel-grid moire, a specular glare, a graded
          defocus blur, a white-balance shift, sensor noise, a vignette, and
          JPEG compression.

BE CLEAR ABOUT WHAT THIS IS. It is a synthesis. The perspective is real
projective geometry and the blur, noise and compression are real degradations,
but no photons were involved: nothing here was photographed. The manifest says
so for every image and so does this file.
"""
import json
import math
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


# ── projective geometry ───────────────────────────────────────────────────
def find_coeffs(dst_quad, src_quad):
    """Coefficients for Image.transform(PERSPECTIVE): output -> input."""
    rows = []
    for (dx, dy), (sx, sy) in zip(dst_quad, src_quad):
        rows.append([dx, dy, 1, 0, 0, 0, -sx * dx, -sx * dy])
        rows.append([0, 0, 0, dx, dy, 1, -sy * dx, -sy * dy])
    A = np.array(rows, dtype=np.float64)
    B = np.array(src_quad, dtype=np.float64).reshape(8)
    return np.linalg.lstsq(A, B, rcond=None)[0]


def project_quad(sw, sh, yaw, pitch, roll, dist, out_w, out_h, margin=0.1):
    """Where the four corners of an sw x sh plane land, seen from `dist`.

    Angles in degrees. The result is fitted into the output box with `margin`
    of room around it, so a bigger yaw makes a smaller, more slanted screen
    rather than one that walks out of frame.
    """
    ar = sh / sw
    pts = np.array([(-0.5, -0.5 * ar, 0.0), (0.5, -0.5 * ar, 0.0),
                    (0.5, 0.5 * ar, 0.0), (-0.5, 0.5 * ar, 0.0)])
    ry, rx, rz = math.radians(yaw), math.radians(pitch), math.radians(roll)
    Rz = np.array([[math.cos(rz), -math.sin(rz), 0],
                   [math.sin(rz), math.cos(rz), 0], [0, 0, 1]])
    Rx = np.array([[1, 0, 0], [0, math.cos(rx), -math.sin(rx)],
                   [0, math.sin(rx), math.cos(rx)]])
    Ry = np.array([[math.cos(ry), 0, math.sin(ry)], [0, 1, 0],
                   [-math.sin(ry), 0, math.cos(ry)]])
    p = pts @ Rz.T @ Rx.T @ Ry.T
    p[:, 2] += dist
    proj = np.stack([p[:, 0] / p[:, 2], p[:, 1] / p[:, 2]], axis=1)

    lo, hi = proj.min(axis=0), proj.max(axis=0)
    span = hi - lo
    box = np.array([out_w * (1 - 2 * margin), out_h * (1 - 2 * margin)])
    s = float(min(box[0] / span[0], box[1] / span[1]))
    centred = (proj - (lo + hi) / 2) * s
    return [(float(x + out_w / 2), float(y + out_h / 2)) for x, y in centred]


def warp(src, quad, out_size):
    """src -> an RGB layer at out_size plus the mask of where it landed."""
    sw, sh = src.size
    coeffs = find_coeffs(quad, [(0, 0), (sw, 0), (sw, sh), (0, sh)])
    layer = src.convert('RGB').transform(out_size, Image.PERSPECTIVE, coeffs,
                                         Image.BICUBIC)
    mask = Image.new('L', src.size, 255).transform(out_size, Image.PERSPECTIVE,
                                                   coeffs, Image.BICUBIC)
    return layer, mask


def expand_quad(quad, k):
    """The same quad, pushed out from its centre — the monitor's bezel."""
    cx = sum(p[0] for p in quad) / 4.0
    cy = sum(p[1] for p in quad) / 4.0
    return [(cx + (x - cx) * k, cy + (y - cy) * k) for x, y in quad]


# ── the degradations ──────────────────────────────────────────────────────
def room_background(size, rgb):
    """A dark, softly-lit surround. Not a photograph of a room; a gradient."""
    w, h = size
    base = np.array(rgb, dtype=np.float32)
    yy = np.linspace(1.25, 0.55, h, dtype=np.float32)[:, None]
    xx = np.linspace(0.85, 1.15, w, dtype=np.float32)[None, :]
    field = (yy * xx)[:, :, None] * base[None, None, :]
    rng = np.random.default_rng(7)
    field += rng.normal(0.0, 2.4, (h, w, 1)).astype(np.float32)
    return Image.fromarray(np.clip(field, 0, 255).astype(np.uint8))


def radial_field(size, spots):
    """Sum of soft elliptical highlights, 0..1, for glare."""
    w, h = size
    yy = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    xx = np.linspace(0, 1, w, dtype=np.float32)[None, :]
    acc = np.zeros((h, w), dtype=np.float32)
    for sp in spots:
        d = (((xx - sp['cx']) / sp['rx']) ** 2 + ((yy - sp['cy']) / sp['ry']) ** 2)
        acc += sp['s'] * np.exp(-2.2 * d)
    return np.clip(acc, 0.0, 1.6)


def linear_field(size, direction, offset):
    """0..1 ramp across the frame, for the graded defocus."""
    w, h = size
    xx = np.linspace(0, 1, w, dtype=np.float32)[None, :]
    yy = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    t = xx if direction >= 0 else (1.0 - xx)
    t = t * 0.82 + yy * 0.18
    return np.clip((t - offset) / max(1e-3, 1.0 - offset), 0.0, 1.0)


def make_photo(src, p):
    out_w, out_h = p['canvas']
    canvas = room_background((out_w, out_h), p.get('bg', [26, 25, 24]))

    quad = project_quad(src.size[0], src.size[1], p['yaw'], p['pitch'],
                        p['roll'], p['dist'], out_w, out_h,
                        p.get('margin', 0.085))

    # Bezel first, screen on top of it.
    bez_layer, bez_mask = warp(Image.new('RGB', src.size, (16, 16, 18)),
                               expand_quad(quad, 1.045), (out_w, out_h))
    canvas.paste(bez_layer, (0, 0), bez_mask.filter(ImageFilter.GaussianBlur(0.6)))

    screen, mask = warp(src, quad, (out_w, out_h))
    canvas.paste(screen, (0, 0), mask)

    arr = np.asarray(canvas, dtype=np.float32)
    m = np.asarray(mask, dtype=np.float32)[:, :, None] / 255.0

    # 1. the monitor's own pixel grid, beating against the sampling grid
    if p.get('moire', 0) > 0:
        h, w = arr.shape[:2]
        yy = np.arange(h, dtype=np.float32)[:, None]
        xx = np.arange(w, dtype=np.float32)[None, :]
        ripple = (np.sin(yy * 0.83 + xx * 0.11) * np.sin(xx * 0.77 - yy * 0.05))
        arr += (ripple[:, :, None] * (p['moire'] * 255.0) * m)

    # 2. glare — additive, on the screen only, because that is what reflects
    if p.get('glare'):
        g = radial_field((out_w, out_h), p['glare'])[:, :, None]
        arr = arr + g * m * 235.0 * (0.55 + 0.45 * m)

    arr = np.clip(arr, 0, 255)
    img = Image.fromarray(arr.astype(np.uint8))

    # 3. defocus, graded across the frame: one edge of a slanted screen is
    #    genuinely further from the lens than the other.
    base_blur = img.filter(ImageFilter.GaussianBlur(p.get('blur', 0.8)))
    if p.get('blurGrad'):
        d, off = p['blurGrad']
        far = img.filter(ImageFilter.GaussianBlur(p.get('blurGradMax', 2.0)))
        t = linear_field((out_w, out_h), d, off)[:, :, None]
        img = Image.fromarray(np.clip(
            np.asarray(base_blur, np.float32) * (1 - t) +
            np.asarray(far, np.float32) * t, 0, 255).astype(np.uint8))
    else:
        img = base_blur

    a = np.asarray(img, dtype=np.float32)

    # 4. white balance and a gentle gamma
    wb = np.array(p.get('wb', [1, 1, 1]), dtype=np.float32)
    a = a * wb[None, None, :]
    gam = p.get('gamma', 1.0)
    if abs(gam - 1.0) > 1e-3:
        a = 255.0 * np.power(np.clip(a, 0, 255) / 255.0, gam)

    # 5. sensor noise
    if p.get('noise', 0) > 0:
        rng = np.random.default_rng(11)
        a = a + rng.normal(0.0, p['noise'], a.shape).astype(np.float32)

    # 6. vignette
    if p.get('vignette', 0) > 0:
        h, w = a.shape[:2]
        yy = np.linspace(-1, 1, h, dtype=np.float32)[:, None]
        xx = np.linspace(-1, 1, w, dtype=np.float32)[None, :]
        r = np.sqrt(xx ** 2 + yy ** 2) / math.sqrt(2)
        a = a * (1.0 - p['vignette'] * (r ** 2.1))[:, :, None]

    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


# ── driver ────────────────────────────────────────────────────────────────
def fit(img, maxw):
    if img.size[0] <= maxw:
        return img
    h = round(img.size[1] * maxw / img.size[0])
    return img.resize((maxw, h), Image.LANCZOS)


def main(job_path):
    jobs = json.load(open(job_path, 'r', encoding='utf-8'))
    for j in jobs:
        src = Image.open(j['src']).convert('RGB')
        if j['op'] == 'photo':
            img = make_photo(src, j['photo'])
        elif j['op'] == 'crop':
            x, y, w, h = [int(round(v)) for v in j['rect']]
            img = src.crop((x, y, x + w, y + h))
        else:
            img = src
        img = fit(img, j['maxw'])
        img.save(j['dst'], 'JPEG', quality=j['quality'], optimize=True,
                 progressive=True, subsampling=1)
        print('  %s  %dx%d' % (j['id'], img.size[0], img.size[1]))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    main(sys.argv[1])
