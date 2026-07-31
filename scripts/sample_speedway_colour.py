# -*- coding: utf-8 -*-
"""Sample the Speedway Mall brick colour off the z20 nadir mosaic, walking the
OSM centreline instead of hand-picking points.

The first attempt hand-placed three points and two of them landed in the live-oak
canopy -- the mall is shaded for most of its length, and the "brick" came back
rgb(113,116,94), which is a tree. So this walks the actual OSM way, samples a
perpendicular profile at every step, and separates the pixels into

    canopy   green-dominant  (G clearly above R and B)
    shadow   low luma, not green
    lit      everything else  <- the material colour

and reports all three with counts, so the shading is a NUMBER in the record
rather than an excuse. `lit` is what the palette is derived from; the canopy
share is what says how much of the corridor the viewer ever sees.

Controls sampled the same way, in the same image, under the same sun:
concrete walkways (pale), asphalt carriageway (dark), campus roof (terracotta).

Usage:  python scripts/sample_speedway_colour.py
"""
import json
import math
import os
from collections import Counter

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = os.path.join(ROOT, "research", "speedway")
CACHE = os.path.join(ROOT, "data", "osm_cache")
Z = 20
BBOX = (-97.7400, 30.2818, -97.7350, 30.2890)     # must match fetch_speedway_reference


def tile_xy(lon, lat, z):
    n = 2 ** z
    return ((lon + 180.0) / 360.0 * n,
            (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)


def classify(r, g, b):
    lu = 0.2126 * r + 0.7152 * g + 0.0722 * b
    # Live oak in this imagery is desaturated dark green: G above both R and B.
    if g > r + 4 and g > b + 16 and lu < 150:
        return "canopy", lu
    if lu < 95:
        return "shadow", lu
    return "lit", lu


def walk(px, W, H, coords, xa, ya, half_m, mpp, step_m=1.0):
    """Sample a perpendicular profile every step_m along a lon/lat polyline."""
    buckets = {k: {"n": 0, "sum": [0, 0, 0], "hex": Counter()} for k in ("lit", "shadow", "canopy")}
    lat0 = sum(c[1] for c in coords) / len(coords)
    kx = math.cos(math.radians(lat0))
    half_px = half_m / mpp
    for (lo0, la0), (lo1, la1) in zip(coords, coords[1:]):
        x0, y0 = tile_xy(lo0, la0, Z); x0 = (x0 - xa) * 256; y0 = (y0 - ya) * 256
        x1, y1 = tile_xy(lo1, la1, Z); x1 = (x1 - xa) * 256; y1 = (y1 - ya) * 256
        seg = math.hypot(x1 - x0, y1 - y0)
        if seg < 1e-6:
            continue
        ux, uy = (x1 - x0) / seg, (y1 - y0) / seg
        nx, ny = -uy, ux
        steps = max(1, int(seg * mpp / step_m))
        for i in range(steps + 1):
            t = i / steps
            cx, cy = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            j = -half_px
            while j <= half_px:
                X, Y = int(round(cx + nx * j)), int(round(cy + ny * j))
                j += 1.0
                if not (0 <= X < W and 0 <= Y < H):
                    continue
                r, g, b = px[X, Y]
                k, _ = classify(r, g, b)
                bk = buckets[k]
                bk["n"] += 1
                bk["sum"][0] += r; bk["sum"][1] += g; bk["sum"][2] += b
                bk["hex"]["#%02x%02x%02x" % (r, g, b)] += 1
    out = {}
    tot = sum(b["n"] for b in buckets.values()) or 1
    for k, b in buckets.items():
        if not b["n"]:
            out[k] = {"n": 0}
            continue
        m = tuple(round(v / b["n"]) for v in b["sum"])
        out[k] = {"n": b["n"], "pct": round(100 * b["n"] / tot, 1),
                  "mean_hex": "#%02x%02x%02x" % m, "mean_rgb": list(m),
                  "luma": round(0.2126*m[0] + 0.7152*m[1] + 0.0722*m[2], 1)}
    out["_total_px"] = tot
    return out


def osm_ways(named, highways=None, surfaces=None):
    """Every cached OSM way whose name matches, as lon/lat coordinate lists."""
    got = []
    for fn in ("footways", "surfaces", "roads"):
        p = os.path.join(CACHE, fn + ".json")
        if not os.path.exists(p):
            continue
        with open(p, encoding="utf-8") as f:
            for el in json.load(f).get("elements", []):
                t = el.get("tags") or {}
                if (t.get("name") or "") != named:
                    continue
                if highways and t.get("highway") not in highways:
                    continue
                if surfaces is not None and t.get("surface") not in surfaces:
                    continue
                g = el.get("geometry") or []
                if len(g) < 2:
                    continue
                key = (round(g[0]["lon"], 6), round(g[0]["lat"], 6),
                       round(g[-1]["lon"], 6), round(g[-1]["lat"], 6))
                if any(k == key for k, _ in got):
                    continue
                got.append((key, [[p2["lon"], p2["lat"]] for p2 in g]))
    return [c for _, c in got]


def main():
    im = Image.open(os.path.join(REF, "mall_z20.jpg")).convert("RGB")
    px, W, H = im.load(), im.width, im.height
    w, s, e, n = BBOX
    xa = int(tile_xy(w, n, Z)[0]); ya = int(tile_xy(w, n, Z)[1])
    lat0 = (s + n) / 2
    mpp = 156543.03392 * math.cos(math.radians(lat0)) / (2 ** Z)

    def inbb(c):
        return all(w <= p[0] <= e and s <= p[1] <= n for p in c)

    targets = [
        # name, coord-lists, half-width metres sampled either side of centreline
        # 3.5 m of a 9.14 m (30 ft) corridor: inside the curbs, off the edges.
        ("speedway_brick   (OSM surface=paving_stones)",
         [c for c in osm_ways("Speedway", {"pedestrian"}, {"paving_stones"}) if inbb(c)], 3.5),
        ("speedway_south   (OSM surface=asphalt, same corridor)",
         [c for c in osm_ways("Speedway", {"pedestrian"}, {"asphalt"}) if inbb(c)], 3.5),
        ("inner_campus_dr  (asphalt control)",
         [c for c in osm_ways("Inner Campus Drive") if inbb(c)], 3.0),
    ]
    report = {"m_per_px": round(mpp, 4), "half_width_m": {}, "targets": {}}
    for label, coords, half in targets:
        if not coords:
            print("%-46s NO GEOMETRY IN BBOX" % label)
            continue
        r = walk(px, W, H, [p for c in coords for p in c] if False else coords[0], xa, ya, half, mpp)
        # walk() takes one polyline; run each and merge by re-walking all.
        agg = {k: {"n": 0, "sum": [0, 0, 0]} for k in ("lit", "shadow", "canopy")}
        for c in coords:
            rr = walk(px, W, H, c, xa, ya, half, mpp)
            for k in agg:
                if rr[k].get("n"):
                    agg[k]["n"] += rr[k]["n"]
                    for i in range(3):
                        agg[k]["sum"][i] += rr[k]["mean_rgb"][i] * rr[k]["n"]
        tot = sum(a["n"] for a in agg.values()) or 1
        row = {}
        for k, a in agg.items():
            if not a["n"]:
                row[k] = {"n": 0}
                continue
            m = tuple(round(v / a["n"]) for v in a["sum"])
            row[k] = {"n": a["n"], "pct": round(100 * a["n"] / tot, 1),
                      "mean_hex": "#%02x%02x%02x" % m, "mean_rgb": list(m),
                      "luma": round(0.2126*m[0] + 0.7152*m[1] + 0.0722*m[2], 1)}
        report["targets"][label] = row
        report["half_width_m"][label] = half
        print("\n%s   (%d ways, %d px)" % (label, len(coords), tot))
        for k in ("lit", "shadow", "canopy"):
            if row[k].get("n"):
                print("   %-7s %5.1f%%  %s  rgb=%s  luma=%5.1f"
                      % (k, row[k]["pct"], row[k]["mean_hex"], row[k]["mean_rgb"], row[k]["luma"]))
            else:
                print("   %-7s   0.0%%" % k)

    with open(os.path.join(REF, "centreline_samples.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print("\nwrote research/speedway/centreline_samples.json")


if __name__ == "__main__":
    main()
