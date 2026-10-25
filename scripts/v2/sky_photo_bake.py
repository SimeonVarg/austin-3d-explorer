"""The owner's own sky for a photo moment: his photo's sky pixels, put back on the dome through the photo's solved camera.

  python scripts/v2/sky_photo_bake.py NAME PHOTO.jpg CAMERA.json OUT_DIR [--key APP_KEY.png] [--rule day|sunset]
        [--horizon 0.405] [--exposure X] [--exclude x0,y0,x1,y1 ...]

  PHOTO.jpg   the photo at the camera's standard size (portrait 1500 x 2000 for the owner's iPhone pictures)
  CAMERA.json K, R_world_to_cam (world: x east, y north, z up), standard_size (scripts/verify/v2-moment-shots.mjs reads the same)
  --key       the app drawn at that camera with ?skykey=1 (the dome flat magenta): sky is kept only where the app ALSO draws sky,
              so a building the app has (his tower, its glass full of reflected sky) never lands on the dome
  --rule      which pixels of the photo are sky: day = blue sky or white / grey cloud; sunset = bright and above the horizon line
  --exposure  the moment's camera exposure (v2/data/moments.json); default: read from there

Writes OUT_DIR/photo-NAME.webp (RGBA: the sky in the app's dome units / scale, ^(1/gamma), sRGB; alpha = sky, feathered) and photo-NAME.json:
M (app direction -> texture u, v, homogeneous), its inverse, scale, the exposure it was baked for. At the photo's camera the app
then draws his sky pixel for pixel: dome = the app's tone map undone on his pixel / the exposure (v2/main.js CustomToneMapping).
"""
import argparse, json, os
import numpy as np
import cv2

EXPOSURE_APP = 1.0     # LOOK.EXPOSURE
SHOULDER = 0.8         # LOOK.TONE_SHOULDER
FEATHER_PX = 3.0       # the alpha's soft edge (sigma, photo pixels); the mask is first pulled in by ERODE_PX
ERODE_PX = 4
GAMMA = 2.0          # stored as (dome / scale)^(1 / GAMMA) before the sRGB curve: the sky below a clipped sun keeps its precision


def srgb2lin(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def lin2srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def untone(p):
    """the app's tone map (main.js CustomToneMapping, without its small desaturation) undone, per pixel, rgb linear in [0, 1]"""
    peak = p.max(-1, keepdims=True)
    d = 1 - SHOULDER
    npk = np.clip(peak, 1e-6, 0.995)
    inp = np.where(npk < SHOULDER, npk, d * d / (1 - npk) - d + SHOULDER)
    return p * (inp / npk)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('name'); ap.add_argument('photo'); ap.add_argument('camera'); ap.add_argument('out')
    ap.add_argument('--key'); ap.add_argument('--rule', default='day'); ap.add_argument('--horizon', type=float, default=0.405)
    ap.add_argument('--exposure', type=float)
    ap.add_argument('--feather', type=float, default=0, help='> 0: alpha ramps over this many pixels inward from every edge of the sky (a wide, invisible seam into the HDRI where the photo is cut by the frame, the horizon line or an exclude box)')
    ap.add_argument('--exclude', action='append', default=[], help='x0,y0,x1,y1 (fractions): never sky (a structure the app draws elsewhere)')
    a = ap.parse_args()
    cam = json.load(open(a.camera))
    W, H = cam.get('standard_size', [1500, 2000])
    img = cv2.imread(a.photo, cv2.IMREAD_COLOR)
    if img.shape[:2] != (H, W):
        img = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA)
    if a.exposure is None:
        mj = os.path.join(os.path.dirname(__file__), '..', '..', 'v2', 'data', 'moments.json')
        a.exposure = json.load(open(mj))['moments'][a.name].get('exposure', 1)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    Hh, S, V = hsv[..., 0].astype(int), hsv[..., 1].astype(int), hsv[..., 2].astype(int)
    if a.rule == 'day':
        sky = ((Hh >= 95) & (Hh <= 128) & (S >= 45) & (V >= 90)) | ((S <= 70) & (V >= 150))
        sky = sky & (np.arange(H)[:, None] < H * a.horizon)
    else:   # sunset: bright and above the horizon line, away from anything dark (balconies, rails, the far land)
        sky = (V >= 95) & (np.arange(H)[:, None] < H * a.horizon)
        dark = cv2.dilate(((V < 95) & (np.arange(H)[:, None] < H * (a.horizon + 0.03))).astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
        sky &= ~dark
    for e in a.exclude:
        x0, y0, x1, y1 = [float(t) for t in e.split(',')]
        sky[int(y0 * H):int(y1 * H), int(x0 * W):int(x1 * W)] = False
    if a.key:
        k = cv2.imread(a.key, cv2.IMREAD_COLOR)
        if k.shape[:2] != (H, W):
            k = cv2.resize(k, (W, H), interpolation=cv2.INTER_NEAREST)
        kb, kg, kr = k[..., 0].astype(int), k[..., 1].astype(int), k[..., 2].astype(int)
        app_sky = (kr >= 250) & (kb >= 250) & (kg <= 6)   # the flat key colour only (glass mirrors a darker magenta)
        app_sky = cv2.erode(app_sky.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
        sky &= app_sky
    m = cv2.morphologyEx(sky.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    keep = np.zeros_like(m)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] >= 400: keep[lab == i] = 1
    m = cv2.erode(keep, np.ones((2 * ERODE_PX + 1, 2 * ERODE_PX + 1), np.uint8)).astype(np.float32)
    alpha = cv2.GaussianBlur(m, (0, 0), FEATHER_PX) * m      # soft inside edge, nothing outside the sky
    if a.feather > 0:
        pad = np.pad(m, 1)   # the photo's own frame is an edge too
        dist = cv2.distanceTransform(pad.astype(np.uint8), cv2.DIST_L2, 5)[1:-1, 1:-1]
        t = np.clip(dist / a.feather, 0, 1)
        alpha = alpha * (t * t * (3 - 2 * t))
    # the photo in the app's dome units
    lin = srgb2lin(img[..., ::-1].astype(np.float32) / 255)
    dome = untone(lin) / (EXPOSURE_APP * a.exposure)
    # behind the mask: the sky round it (normalised blur), so the mip levels never pull in a building's colour
    wsum = cv2.GaussianBlur(m, (0, 0), 25) + 1e-6
    fill = np.stack([cv2.GaussianBlur(dome[..., c] * m, (0, 0), 25) / wsum for c in range(3)], -1)
    dome = np.where(m[..., None] > 0, dome, fill)
    ys, xs = np.nonzero(m)
    y0, y1, x0, x1 = max(0, ys.min() - 16), min(H, ys.max() + 17), max(0, xs.min() - 16), min(W, xs.max() + 17)
    dome, alpha = dome[y0:y1, x0:x1], alpha[y0:y1, x0:x1]
    scale = float(np.percentile(dome[alpha > 0.5].max(-1), 99.9)) * 1.02
    rgba = np.dstack([lin2srgb(np.clip(dome / scale, 0, 1) ** (1 / GAMMA))[..., ::-1], np.clip(alpha, 0, 1)])
    out_png = os.path.join(a.out, 'photo-%s.webp' % a.name)
    cv2.imwrite(out_png, (rgba * 255 + 0.5).astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 95])
    # app direction -> texture (u, v) of the crop, homogeneous: N K R T
    T = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)          # app (x east, y up, z south) -> world (x east, y north, z up)
    K, R = np.array(cam['K'], float), np.array(cam['R_world_to_cam'], float)
    cw, ch = x1 - x0, y1 - y0
    N = np.array([[1 / cw, 0, -x0 / cw], [0, -1 / ch, 1 + y0 / ch], [0, 0, 1]], float)
    M = N @ K @ R @ T
    info = {'note': 'the owner\'s photo %s: its sky in the app\'s dome units / scale (sRGB), alpha = sky; M: app direction -> (u, v, 1) x w; '
                    'baked for the moment\'s exposure (scripts/v2/sky_photo_bake.py)' % a.name,
            'file': os.path.basename(out_png), 'size': [int(cw), int(ch)], 'crop': [int(x0), int(y0), int(x1), int(y1)],
            'M': M.tolist(), 'Minv': np.linalg.inv(M).tolist(), 'scale': scale, 'gamma': GAMMA, 'exposure': a.exposure, 'rule': a.rule,
            'sky_share': float(alpha.mean()), 'bytes': os.path.getsize(out_png)}
    json.dump(info, open(os.path.join(a.out, 'photo-%s.json' % a.name), 'w'), indent=1)
    print(a.name, 'crop', info['crop'], 'sky px %.0f' % alpha.sum(), 'scale %.3f' % scale, '%.2f MB' % (info['bytes'] / 1e6))


if __name__ == '__main__':
    main()
