# -*- coding: utf-8 -*-
"""Is the bike lane actually GREEN? Measure it, do not assume it.

Austin paints green thermoplastic at conflict zones, and some protected lanes
are green end to end. OSM carries NO colour information whatsoever -- verified:
there is not one `*colour*` or `*color*` key on any of the 13,440 ways this pass
fetched. So the choice is between painting the whole network green (wrong), not
drawing bike lanes at all (useless), and going and looking.

This goes and looks. For every OSM way in the core area that claims a bike lane,
it walks the way, steps sideways to where that lane physically is (half the
carriageway out from the centreline), pulls z20 nadir imagery for that spot, and
measures the pixels. Green is scored as

    g_excess = G - (R + B) / 2

which is positive for green paint and near zero for grey asphalt, and is immune
to exposure because it is a difference within one pixel.

Output: research/speedway/bike_paint.json  (+ tiles cached under research/tiles/)

Usage:  python scripts/sample_bike_lane_paint.py
"""
import io
import json
import math
import os
from collections import Counter

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data", "osm_cache")
TILES = os.path.join(ROOT, "research", "tiles")
OUT = os.path.join(ROOT, "research", "speedway", "bike_paint.json")
ESRI = ("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery"
        "/MapServer/tile/{z}/{y}/{x}")
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"}
Z = 20
# Core area only. Sampling every bike lane in the outer ring is not the question.
BB = (-97.7560, 30.2740, -97.7240, 30.2960)
LANE_W = 1.8            # metres, a US 6 ft bike lane
_tile_cache = {}


def tile_xy(lon, lat, z=Z):
    n = 2 ** z
    return ((lon + 180.0) / 360.0 * n,
            (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)


def get_tile(xt, yt):
    import urllib.request
    key = (xt, yt)
    if key in _tile_cache:
        return _tile_cache[key]
    os.makedirs(TILES, exist_ok=True)
    p = os.path.join(TILES, "%d_%d_%d.jpg" % (Z, yt, xt))
    if not os.path.exists(p):
        try:
            req = urllib.request.Request(ESRI.format(z=Z, x=xt, y=yt), headers=UA)
            with urllib.request.urlopen(req, timeout=40) as r:
                d = r.read()
            if len(d) < 500:
                raise ValueError("empty tile")
            with open(p, "wb") as f:
                f.write(d)
        except Exception as e:                                     # noqa: BLE001
            _tile_cache[key] = None
            return None
    try:
        im = Image.open(p).convert("RGB")
    except Exception:                                              # noqa: BLE001
        im = None
    _tile_cache[key] = im
    return im


def pixel(fx, fy):
    """RGB at fractional global tile coordinates."""
    xt, yt = int(fx), int(fy)
    im = get_tile(xt, yt)
    if im is None:
        return None
    px = int((fx - xt) * 256), int((fy - yt) * 256)
    return im.getpixel((min(255, px[0]), min(255, px[1])))


# ---------------------------------------------------------------- the rule --
# What each OSM cycleway value MEANS on the ground, and therefore whether this
# pass may draw a lane for it. This is the whole "render a lane only where the
# data says one exists" requirement, in one table.
LANE_VALUES = {
    "lane":           ("lane",  "painted on-carriageway lane"),
    "opposite_lane":  ("lane",  "contraflow painted lane"),
    "track":          ("track", "physically separated / protected"),
    "opposite_track": ("track", "contraflow protected track"),
    "shoulder":       ("lane",  "rideable shoulder, striped"),
}
NOT_A_LANE = {
    "shared_lane": "sharrow -- a stencil on a shared travel lane, no lane exists",
    "share_busway": "shares the bus lane, no separate bike lane exists",
    "separate": "mapped as its own way -- drawing it here would double-draw it",
    "no": "explicitly none",
    "shared": "shared, undifferentiated",
    "shared_parking_lane": "shares the parking lane",
    "crossing": "an intersection crossing, not a lane",
    "sidepath": "the sidepath is the separate way",
    "planned": "not built",
    "link": "a connector, not a lane",
    "traffic_island": "not a lane",
}


def road_width_m(tags):
    """Same rule the bake uses, so the sample lands where the lane is drawn."""
    try:
        n = int(str(tags.get("lanes", "")).split(";")[0])
    except (TypeError, ValueError):
        n = 0
    if n:
        return n * 3.4 + 1.6
    return {"motorway": 30, "trunk": 24, "primary": 18, "secondary": 15,
            "tertiary": 12, "residential": 9.5, "unclassified": 9.5,
            "living_street": 8, "service": 5.5}.get(tags.get("highway"), 9)


def sides(tags):
    """-> {'left': ('lane'|'track', raw), 'right': ...} for this way."""
    out = {}
    both = tags.get("cycleway:both") or tags.get("cycleway")
    for side in ("left", "right"):
        raw = tags.get("cycleway:" + side) or both
        if not raw:
            continue
        m = LANE_VALUES.get(raw)
        if m:
            out[side] = (m[0], raw)
    return out


# ---------------------------------------------------------- the detector ---
# Derived by cropping the Guadalupe protected lane out of the z20 mosaic and
# tracking the greenest pixel across 27 rows (see research/speedway/
# _gu_ribbon.png). Measured means in that one image, same sun, same exposure:
#
#   green paint   rgb(158,168,151)   G-R = +10   R-B =  +7
#   asphalt lane  rgb(138,132,120)   G-R =  -6   R-B = +18
#   concrete walk rgb(188,174,152)   G-R = -14   R-B = +36
#   live oak      rgb(107,115, 91)   G-R =  +8   R-B = +16
#
# G-R alone cannot separate paint from a live oak -- both are +8..+10 -- which is
# why the first two versions of this script found nothing and everything. The
# pair does: the paint is neutral in red-versus-blue (+7) and the canopy is not
# (+16). So GREEN is G-R above +5 AND R-B below +12, and that is a rule that
# reproduces every one of the four measurements above.
def is_green(r, g, b):
    return (g - r) > 5 and (r - b) < 12 and (0.2126*r + 0.7152*g + 0.0722*b) > 80


def sweep(g, lat0, offs):
    """Mean g_excess and mean colour at each perpendicular offset, in metres.

    Sweeping rather than sampling one modelled offset is the fix for the first
    version of this script, which put the sample where it THOUGHT the lane was,
    found nothing, and would have concluded "no green anywhere" -- while a crop
    of the same imagery over Guadalupe shows an unmistakable green ribbon. The
    picture beat the derived number, so the number had to get better.
    """
    mpp = 156543.03392 * math.cos(math.radians(lat0)) / (2 ** Z)
    acc = {o: [0, 0, 0, 0, 0.0, 0] for o in offs}    # r,g,b,n,gexsum,ngreen
    for (a, b) in zip(g, g[1:]):
        ax, ay = tile_xy(a["lon"], a["lat"])
        bx, by = tile_xy(b["lon"], b["lat"])
        seg = math.hypot(bx - ax, by - ay)
        if seg < 1e-9:
            continue
        nx, ny = -(by - ay) / seg, (bx - ax) / seg
        steps = max(1, int(seg * 256 * mpp / 2.0))   # a sample every 2 m along
        for i in range(steps + 1):
            tt = i / steps
            cx, cy = ax + (bx - ax) * tt, ay + (by - ay) * tt
            for o in offs:
                opx = o / mpp / 256.0
                p = pixel(cx + nx * opx, cy + ny * opx)
                if p is None:
                    continue
                A = acc[o]
                A[0] += p[0]; A[1] += p[1]; A[2] += p[2]; A[3] += 1
                A[4] += p[1] - (p[0] + p[2]) / 2.0
                if is_green(*p):
                    A[5] += 1
    out = {}
    for o, A in acc.items():
        if A[3] < 20:
            continue
        m = tuple(round(v / A[3]) for v in A[:3])
        out[o] = {"n": A[3], "hex": "#%02x%02x%02x" % m,
                  "gex": round(A[4] / A[3], 2),
                  "green": round(A[5] / A[3], 3)}
    return out


def main():
    with open(os.path.join(CACHE, "roads.json"), encoding="utf-8") as f:
        els = json.load(f)["elements"]
    # Every offset from the centreline out to 14 m each way, half a metre apart.
    OFFS = [round(-14 + 0.5 * i, 1) for i in range(57)]
    rows, summary = [], Counter()
    for el in els:
        t = el.get("tags") or {}
        g = el.get("geometry") or []
        if len(g) < 2:
            continue
        if not all(BB[0] <= p["lon"] <= BB[2] and BB[1] <= p["lat"] <= BB[3] for p in g):
            continue
        sd = sides(t)
        if not sd:
            continue
        # Length filter: below ~25 m a way is a junction stub and its samples are
        # nearly all crossing paint and kerb radius. 25 m is 12 samples.
        lat0 = sum(p["lat"] for p in g) / len(g)
        kx = math.cos(math.radians(lat0))
        L = sum(math.hypot((b["lon"] - a["lon"]) * kx, b["lat"] - a["lat"]) * 111320.0
                for a, b in zip(g, g[1:]))
        if L < 25:
            continue
        sw = sweep(g, lat0, OFFS)
        if not sw:
            continue
        best = max(sw.items(), key=lambda kv: kv[1]["green"])
        centre = sw.get(0.0, {"gex": 0.0, "hex": "?", "green": 0.0})
        half = road_width_m(t) / 2.0
        # A verdict, not a number to eyeball later. GREEN requires both that a
        # third of the samples pass is_green() and that the band is ON the
        # carriageway -- the runners-up in this table all peak at 12-14 m out,
        # which is the verge, not a bike lane.
        green = (best[1]["green"] >= 0.35 and abs(best[0]) <= half + 2.0)
        rows.append({
            "id": el.get("id"),
            "name": t.get("name", "(unnamed)"), "highway": t.get("highway"),
            "GREEN": green,
            "sides": {s: v[1] for s, v in sd.items()},
            "kinds": sorted({v[0] for v in sd.values()}),
            "lanes": t.get("lanes"), "modelled_w_m": round(road_width_m(t), 1),
            "len_m": round(L),
            "peak_offset_m": best[0], "peak_green": best[1]["green"],
            "peak_hex": best[1]["hex"], "peak_gex": best[1]["gex"],
            "centre_green": centre["green"], "centre_hex": centre["hex"],
            "green_above_centre": round(best[1]["green"] - centre["green"], 3),
            "profile_green": {str(o): sw[o]["green"] for o in sorted(sw)},
        })
        for s, v in sd.items():
            summary[v[1]] += 1
    rows.sort(key=lambda r: -r["peak_green"])
    verdict = {"threshold_green_frac": 0.35,
               "rule": "peak_green >= 0.35 AND |peak_offset| <= modelled_half_width + 2 m",
               "green_way_ids": sorted(r["id"] for r in rows if r["GREEN"])}
    with open(os.path.join(ROOT, "data", "osm_cache", "_green_lanes.json"),
              "w", encoding="utf-8") as f:
        json.dump(verdict, f, indent=1)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"note": "g_excess = G-(R+B)/2 at each perpendicular offset; the "
                           "peak MINUS the carriageway centre is the green-paint signal. "
                           "green = share of samples passing is_green()",
                   "lane_values_drawn": {k: v[1] for k, v in LANE_VALUES.items()},
                   "values_NOT_drawn": NOT_A_LANE,
                   "rows": rows}, f, indent=1)

    print("%-32s %-11s %-22s %5s %6s %8s %8s %9s"
          % ("way", "highway", "cycleway tags", "len", "offs", "hex", "green%", "centre%"))
    for r in rows[:30]:
        print("%-32s %-11s %-22s %5d %6.1f %8s %7.1f%% %8.1f%%"
              % (r["name"][:32], r["highway"],
                 ",".join("%s=%s" % (k, v) for k, v in sorted(r["sides"].items()))[:22],
                 r["len_m"], r["peak_offset_m"], r["peak_hex"],
                 100 * r["peak_green"], 100 * r["centre_green"]))
    print("\n%d ways swept. tags seen: %s" % (len(rows), dict(summary)))


if __name__ == "__main__":
    main()
