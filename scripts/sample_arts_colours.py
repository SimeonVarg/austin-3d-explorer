# -*- coding: utf-8 -*-
"""Sample material colours off the reference photographs, in pixels.

PASS_COMMON section 1: "sampled off a photograph's pixels - not guessed". This
prints a per-patch median (median, not mean - a mean over a patch that clips a
window mullion or a leaf is a lie) in hex and in HSV, plus the patch's own
standard deviation so a patch that straddles two materials announces itself.

Patches are given in FRACTIONS of the image, so they survive a re-fetch at a
different thumbnail width.

Only the patches that ended up cited in docs/PASS_ARTS.md are kept in the repo;
`python scripts/fetch_arts_reference.py` regenerates the full set (74 images,
78 MB) from Wikimedia Commons and Esri World Imagery.

Usage:  python scripts/sample_arts_colours.py [substring]
"""
import colorsys
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = os.path.join(ROOT, "research", "arts-precinct")

# file, label, x0, y0, x1, y1   (fractions of width/height)
PATCHES = [
    # ── LBJ: travertine. The long wall in this photo faces AWAY from the sun and
    #    reads as sky-lit; the top fascia and the corner pier are the sunlit ones.
    ("cited/12_LBJ_Library_March_2024_01_jpg.jpg", "lbj travertine SUN top fascia",     0.42, 0.205, 0.52, 0.245),
    ("cited/12_LBJ_Library_March_2024_01_jpg.jpg", "lbj travertine SUN corner pier",    0.295, 0.48, 0.325, 0.66),
    ("cited/12_LBJ_Library_March_2024_01_jpg.jpg", "lbj travertine sky-lit long wall",  0.55, 0.50, 0.65, 0.60),
    ("cited/12_LBJ_Library_March_2024_01_jpg.jpg", "lbj travertine recessed S wall",    0.23, 0.45, 0.28, 0.58),
    ("cited/12_LBJ_Library_March_2024_01_jpg.jpg", "lbj shadow gap under cantilever",   0.62, 0.415, 0.72, 0.437),
    ("cited/12_LBJ_Library_March_2024_01_jpg.jpg", "lbj grade loggia SHADOW",           0.22, 0.745, 0.27, 0.768),
    ("cited/06_LBJ_Library_and_Museum_02_jpg.jpg", "lbj travertine end wall overcast", 0.47, 0.40, 0.58, 0.46),

    # ── Kelly's Austin: white stone. The crown patch has the lowest sd, so it is
    #    the cleanest read of the lit material.
    ("cited/07_Austin_Building_Southeast_Corner_2018_jpg.jpg", "kelly stone SUN vault crown",  0.30, 0.10, 0.38, 0.16),
    ("cited/07_Austin_Building_Southeast_Corner_2018_jpg.jpg", "kelly stone SUN gable left",   0.17, 0.45, 0.215, 0.70),
    ("cited/07_Austin_Building_Southeast_Corner_2018_jpg.jpg", "kelly stone SHADE east flank", 0.62, 0.40, 0.75, 0.55),
    ("cited/04_Austin_Building_East_Elevation_2018_jpg.jpg",   "kelly stone flat elevation",   0.20, 0.62, 0.32, 0.74),

    # ── Blanton Michener Gallery + the Snohetta petals ─────────────────────
    ("cited/12_Blanton_Museum_of_Art___UT_Austin__54984937578__jpg.jpg", "blanton limestone SUN wall",     0.80, 0.50, 0.88, 0.56),
    ("cited/12_Blanton_Museum_of_Art___UT_Austin__54984937578__jpg.jpg", "blanton limestone shaded wall",  0.755, 0.52, 0.79, 0.58),
    ("cited/12_Blanton_Museum_of_Art___UT_Austin__54984937578__jpg.jpg", "blanton arcade SHADOW",          0.655, 0.705, 0.685, 0.735),
    ("cited/12_Blanton_Museum_of_Art___UT_Austin__54984937578__jpg.jpg", "blanton clay tile roof",         0.78, 0.318, 0.88, 0.345),
    ("cited/12_Blanton_Museum_of_Art___UT_Austin__54984937578__jpg.jpg", "blanton eave soffit DARK",       0.72, 0.365, 0.80, 0.392),
    ("cited/12_Blanton_Museum_of_Art___UT_Austin__54984937578__jpg.jpg", "petal canopy TOP lit",           0.05, 0.16, 0.14, 0.22),
    ("cited/12_Blanton_Museum_of_Art___UT_Austin__54984937578__jpg.jpg", "petal canopy TOP right",         0.60, 0.30, 0.70, 0.355),
    ("cited/12_Blanton_Museum_of_Art___UT_Austin__54984937578__jpg.jpg", "petal trumpet underside",        0.12, 0.42, 0.18, 0.48),
    ("aerial_blanton_z20.jpg", "blanton clay tile roof NADIR",  0.40, 0.19, 0.52, 0.22),
    ("aerial_blanton_z20.jpg", "blanton court roof BLOCKED sd>120",      0.30, 0.30, 0.34, 0.36),
    ("aerial_blanton_z20.jpg", "petal disc top NADIR",          0.085, 0.415, 0.115, 0.44),

    # ── Harry Ransom Center ───────────────────────────────────────────────
    ("cited/09_Harry_ransom_center_2012_jpg.jpg", "ransom panel field left face",  0.20, 0.45, 0.28, 0.55),
    ("cited/09_Harry_ransom_center_2012_jpg.jpg", "ransom panel field mid face",   0.33, 0.40, 0.40, 0.50),
    ("cited/09_Harry_ransom_center_2012_jpg.jpg", "ransom panel field right face", 0.66, 0.30, 0.73, 0.42),
    ("cited/09_Harry_ransom_center_2012_jpg.jpg", "ransom cornice top face",       0.40, 0.175, 0.50, 0.205),
    ("cited/09_Harry_ransom_center_2012_jpg.jpg", "ransom cornice fascia lit",     0.30, 0.205, 0.34, 0.235),
    ("cited/09_Harry_ransom_center_2012_jpg.jpg", "ransom vertical joint DARK",    0.283, 0.42, 0.292, 0.54),
    ("cited/09_Harry_ransom_center_2012_jpg.jpg", "ransom fin band  BLOCKED by oaks",        0.44, 0.665, 0.50, 0.695),

    # ── Bass Concert Hall ─────────────────────────────────────────────────
    ("cited/00_Bass_Concert_Hall___UT_Austin__54985000414__jpg.jpg", "bass brick fly tower SUN",  0.15, 0.13, 0.27, 0.20),
    ("cited/00_Bass_Concert_Hall___UT_Austin__54985000414__jpg.jpg", "bass brick mid mass",       0.35, 0.19, 0.50, 0.235),
    ("cited/00_Bass_Concert_Hall___UT_Austin__54985000414__jpg.jpg", "bass brick right block",    0.70, 0.21, 0.78, 0.255),
    ("cited/00_Bass_Concert_Hall___UT_Austin__54985000414__jpg.jpg", "bass lobby GLASS mid",      0.50, 0.48, 0.57, 0.56),
    ("cited/00_Bass_Concert_Hall___UT_Austin__54985000414__jpg.jpg", "bass lobby GLASS upper",    0.46, 0.36, 0.55, 0.42),
    ("cited/00_Bass_Concert_Hall___UT_Austin__54985000414__jpg.jpg", "bass sunshade    BLOCKED, sd>80",       0.30, 0.256, 0.36, 0.270),
    ("cited/00_Bass_Concert_Hall___UT_Austin__54985000414__jpg.jpg", "bass soffit      BLOCKED, sd>100",   0.42, 0.694, 0.55, 0.706),
    ("cited/00_Bass_Concert_Hall___UT_Austin__54985000414__jpg.jpg", "bass ground brick",         0.33, 0.72, 0.37, 0.755),
    ("aerial_bass_z20.jpg", "bass roof deck NADIR",  0.40, 0.52, 0.48, 0.60),
    # ── nadir roof planes: the surface the flying camera actually sees most ──
    ("aerial_kelly_z20.jpg",  "kelly vault crown NADIR",     0.575, 0.515, 0.60, 0.535),
    ("aerial_lbj_z20.jpg",    "lbj roof deck NADIR",         0.53, 0.34, 0.60, 0.38),
    ("aerial_ransom_z20.jpg", "ransom roof deck NADIR",      0.34, 0.50, 0.44, 0.58),
    ("aerial_ransom_z20.jpg", "ransom cornice rim NADIR",    0.255, 0.50, 0.275, 0.60),
    ("cited/12_LBJ_Library_March_2024_01_jpg.jpg", "lbj travertine FULL SUN S wall", 0.235, 0.47, 0.265, 0.56),
]


def med(vals):
    v = sorted(vals)
    return v[len(v) // 2]


def main():
    filt = sys.argv[1] if len(sys.argv) > 1 else ""
    cache = {}
    for rel, label, fx0, fy0, fx1, fy1 in PATCHES:
        if filt and filt not in label and filt not in rel:
            continue
        path = os.path.join(REF, rel.replace("/", os.sep))
        if not os.path.exists(path):
            print("  MISSING", rel)
            continue
        im = cache.get(path) or Image.open(path).convert("RGB")
        cache[path] = im
        W, H = im.size
        box = (int(fx0 * W), int(fy0 * H), max(int(fx1 * W), int(fx0 * W) + 1),
               max(int(fy1 * H), int(fy0 * H) + 1))
        px = list(im.crop(box).getdata())
        r, g, b = (med([p[i] for p in px]) for i in range(3))
        n = len(px)
        var = sum((p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2 for p in px) / n
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        print("%-40s #%02x%02x%02x  rgb(%3d,%3d,%3d)  H%3.0f S%4.1f%% V%4.1f%%  sd%5.1f  %s"
              % (label, r, g, b, r, g, b, h * 360, s * 100, v * 100, var ** 0.5, os.path.basename(rel)))


if __name__ == "__main__":
    main()
