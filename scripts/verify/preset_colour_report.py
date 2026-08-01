#!/usr/bin/env python3
"""Read the frames preset-colour.mjs rendered and answer one question:
does changing the graphics preset change the COLOUR of the city?

Measures mean saturation, mean hue and mean luma over the scene area of each
frame, and prints the spread ACROSS presets. A spread near zero means the
preset no longer touches colour.

The scene area excludes the top strip (the HUD pill) and the right/bottom
chrome, because a fixed UI panel would otherwise pin every statistic together
and hide a real difference.

Usage: python scripts/verify/preset_colour_report.py
"""
import json
import pathlib
import sys

import numpy as np
from PIL import Image

OUT = pathlib.Path(__file__).parent / "shots" / "preset-colour"
PRESETS = ["performance", "balanced", "cinematic", "ultra"]
# Absolute tolerances: saturation on 0..1, hue in degrees, luma on 0..255.
TOL = {"sat": 0.010, "hue": 2.0, "luma": 2.0}


def stats(path):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im, dtype=np.float32) / 255.0
    # Scene only: drop the HUD strip, the right-hand slider and the bottom hint.
    a = a[60:700, 40:1180]
    mx = a.max(axis=2)
    mn = a.min(axis=2)
    v = mx
    c = mx - mn
    sat = np.where(mx > 1e-6, c / np.maximum(mx, 1e-6), 0.0)
    lum = 0.2126 * a[:, :, 0] + 0.7152 * a[:, :, 1] + 0.0722 * a[:, :, 2]
    # Circular mean hue, weighted by chroma so flat grey pixels do not vote.
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    h = np.zeros_like(mx)
    nz = c > 1e-6
    idx = (mx == r) & nz
    h[idx] = (60 * ((g[idx] - b[idx]) / c[idx]) + 360) % 360
    idx = (mx == g) & nz
    h[idx] = 60 * ((b[idx] - r[idx]) / c[idx]) + 120
    idx = (mx == b) & nz
    h[idx] = 60 * ((r[idx] - g[idx]) / c[idx]) + 240
    rad = np.deg2rad(h)
    hx = float((np.cos(rad) * c).sum())
    hy = float((np.sin(rad) * c).sum())
    hue = float(np.rad2deg(np.arctan2(hy, hx)) % 360)
    return {"sat": float(sat.mean()), "hue": hue, "luma": float(lum.mean() * 255), "v": float(v.mean())}


def main():
    man_path = OUT / "manifest.json"
    if not man_path.exists():
        sys.exit(f"no manifest at {man_path} — run `node preset-colour.mjs` first")
    man = json.loads(man_path.read_text())

    cache = {}
    for row in man:
        f = pathlib.Path(row["file"])
        if not f.exists():
            sys.exit(f"missing frame {f}")
        cache[row["file"]] = stats(f)

    failures = []
    for hour in ["day", "golden", "night"]:
        for mode in ["gradeonly", "asshipped"]:
            print(f"\n=== {hour}, {mode} " + "=" * 46)
            print(f"{'':13s} {'saturation':>22s} {'hue°':>16s} {'luma':>16s}")
            print(f"{'preset':13s} {'old':>10s} {'new':>10s} {'old':>7s} {'new':>7s} {'old':>7s} {'new':>7s}   filter (new)")
            cols = {"old": {}, "new": {}}
            for preset in PRESETS:
                vals = {}
                filt = ""
                for era in ["old", "new"]:
                    row = next(r for r in man if r["hour"] == hour and r["mode"] == mode
                               and r["era"] == era and r["preset"] == preset)
                    vals[era] = cache[row["file"]]
                    cols[era][preset] = vals[era]
                    if era == "new":
                        filt = row["filter"] if row["filter"] != "none" else "(none)"
                print(f"{preset:13s} {vals['old']['sat']:10.4f} {vals['new']['sat']:10.4f} "
                      f"{vals['old']['hue']:7.1f} {vals['new']['hue']:7.1f} "
                      f"{vals['old']['luma']:7.1f} {vals['new']['luma']:7.1f}   {filt[:52]}")

            for era in ["old", "new"]:
                spread = {k: max(cols[era][p][k] for p in PRESETS) - min(cols[era][p][k] for p in PRESETS)
                          for k in ("sat", "hue", "luma")}
                verdict = ""
                if mode == "gradeonly":
                    ok = all(spread[k] <= TOL[k] for k in TOL)
                    verdict = "  PASS" if ok else "  *FAIL"
                    if era == "new" and not ok:
                        failures.append((hour, mode, spread))
                print(f"  spread across presets ({era}): "
                      f"saturation {spread['sat']:.4f}  hue {spread['hue']:.2f}deg  luma {spread['luma']:.2f}{verdict}")
            if mode == "asshipped":
                print("  (reported, not asserted: bloom, god rays and grain are SUPPOSED to change pixels)")

    print("\n" + "=" * 70)
    if failures:
        print(f"*FAIL — the grade still differs across presets in {len(failures)} case(s)")
        sys.exit(1)
    print("PASS — with effects neutralised, every preset renders the same colour")


if __name__ == "__main__":
    main()
