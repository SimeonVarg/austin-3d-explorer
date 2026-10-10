# -*- coding: utf-8 -*-
"""Shared by the three outer-homes scripts: the boxes, the metre frame and the
windows into the laser-scan rasters.

    fetch_outer_homes_inputs.py   public inputs -> a work folder OUTSIDE the repo
    bake_outer_homes.py           work folder   -> data/outer_homes.bin
    measure_outer.py              the accuracy table, before and after

Nothing here reads or writes a file inside the repo. The work folder is named
with --work or OUTER_HOMES_WORK; it holds about 5 GB (rasters, the aerial, the
footprints) and is regenerable from the fetch script.

THE FRAME. Everything metric is in NAD83(2011) / Texas Central (EPSG:6578),
the laser scan's own grid, with US survey feet converted to metres once (FT).
That grid is rotated about 1.3 degrees from true north at Austin, so an angle
measured in it is NOT the angle the browser needs: bake_outer_homes.py turns
each rectangle's axis back into longitude and latitude before it packs it.
"""
import json
import math
import os

import numpy as np

FT = 1200.0 / 3937.0                     # one US survey foot in metres
CRS = "EPSG:6578"

# The boxes, verbatim from scripts/bake_outer.py. (west, south, east, north)
OUTER = (-97.7880, 30.2400, -97.7020, 30.3150)
CORE = (-97.752, 30.276, -97.726, 30.296)
CAPITOL = (-97.752, 30.271, -97.726, 30.276)
DOWNTOWN = (-97.7580, 30.2560, -97.7280, 30.2770)

# Named areas for the accuracy table: plain boxes named after the main
# neighbourhood inside each. They are reporting units, not official boundaries.
AREAS = {
    "Tarrytown":           (-97.7880, 30.2850, -97.7650, 30.3150),
    "Old West Austin":     (-97.7650, 30.2700, -97.7520, 30.2960),
    "Rosedale-Heritage":   (-97.7650, 30.2960, -97.7370, 30.3150),
    "Hyde Park":           (-97.7370, 30.2960, -97.7200, 30.3150),
    "Hancock-Cherrywood":  (-97.7260, 30.2850, -97.7020, 30.3150),
    "Central East":        (-97.7280, 30.2620, -97.7020, 30.2850),
    "Holly-Cesar Chavez":  (-97.7280, 30.2470, -97.7020, 30.2620),
    "Travis Heights-SoCo": (-97.7520, 30.2400, -97.7280, 30.2560),
    "Bouldin Creek":       (-97.7700, 30.2400, -97.7520, 30.2600),
    "Zilker-Barton Hills": (-97.7880, 30.2400, -97.7700, 30.2700),
    "West Lake shore":     (-97.7880, 30.2700, -97.7650, 30.2850),
    "East Riverside":      (-97.7280, 30.2400, -97.7020, 30.2470),
}
STRIPS = "(strips between areas)"


def work_dir(arg=None):
    d = arg or os.environ.get("OUTER_HOMES_WORK")
    if not d:
        raise SystemExit("name the work folder: --work DIR or OUTER_HOMES_WORK (outside the repo, about 5 GB)")
    os.makedirs(d, exist_ok=True)
    return os.path.abspath(d)


def in_box(x, y, b):
    return b[0] <= x <= b[2] and b[1] <= y <= b[3]


def excluded(lon, lat):
    """True where another lane owns the city: the campus core, the Capitol strip, downtown."""
    return in_box(lon, lat, CORE) or in_box(lon, lat, CAPITOL) or in_box(lon, lat, DOWNTOWN)


def area_of(lon, lat):
    """The reporting area of a point, None where another lane owns the city or outside the box."""
    if not in_box(lon, lat, OUTER) or excluded(lon, lat):
        return None
    for k, b in AREAS.items():
        if in_box(lon, lat, b):
            return k
    return STRIPS


_tr = _inv = None


def _transformers():
    global _tr, _inv
    if _tr is None:
        from pyproj import Transformer
        _tr = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
        _inv = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)
    return _tr, _inv


def to_m(lon, lat):
    x, y = _transformers()[0].transform(lon, lat)
    return np.asarray(x) * FT, np.asarray(y) * FT


def to_ll(x, y):
    return _transformers()[1].transform(np.asarray(x) / FT, np.asarray(y) / FT)


def geom_m(g):
    """A shapely geometry in longitude/latitude -> the metre frame."""
    import shapely
    return shapely.transform(g, lambda c: np.column_stack(to_m(c[:, 0], c[:, 1])))


def rect_poly(cx, cy, L, W, th):
    """A rectangle (centre, half length along `th`, half width) as a polygon in the metre frame."""
    from shapely.geometry import Polygon
    ct, st = math.cos(th), math.sin(th)
    return Polygon([(cx + su * L * ct - sv * W * st, cy + su * L * st + sv * W * ct)
                    for su, sv in ((1, 1), (-1, 1), (-1, -1), (1, -1))])


def max_rect(M):
    """Largest all-True axis-aligned rectangle in a boolean grid: (cells, r0, r1, c0, c1), ends exclusive."""
    nr, nc = M.shape
    h = np.zeros(nc, np.int32)
    best = (0, 0, 0, 0, 0)
    for r in range(nr):
        h = np.where(M[r], h + 1, 0)
        stack = []
        hl = h.tolist()
        for c in range(nc + 1):
            cur = hl[c] if c < nc else 0
            start = c
            while stack and stack[-1][1] >= cur:
                s, hh = stack.pop()
                a = hh * (c - s)
                if a > best[0]:
                    best = (a, r - hh + 1, r + 1, s, c)
                start = s
            stack.append((start, cur))
    return best


class Scan:
    """Windows into the rasters fetch_outer_homes_inputs.py writes under <work>/lidar/raster.

    zb_max   highest building-class return per 0.5 m cell, metres NAVD88
    zf_max   highest first return of any class but noise (so trees count)
    zv_max   highest vegetation return (classes 3 to 5)
    b_cnt    building-class returns per cell
    dtm2     bare earth, 2 m cells, holes filled with the nearest ground
    Row 0 is the north edge, column 0 the west edge.
    """

    def __init__(self, work):
        self.dir = os.path.join(work, "lidar", "raster")
        g = json.load(open(os.path.join(self.dir, "grid.json")))
        self.grid = g
        self.NR, self.NC, self.RES = g["nrows"], g["ncols"], g["res_m"]
        self.GK = int(round(g["gres_m"] / g["res_m"]))
        self.X0, self.YT, self.ZBASE = g["x0_m"], g["y_top_m"], g["zbase_m"]
        self._m = {}

    def arr(self, name):
        if name not in self._m:
            self._m[name] = np.load(os.path.join(self.dir, name), mmap_mode="r")
        return self._m[name]

    def window(self, x0, y0, x1, y1, pad=0.0):
        r0 = int(np.floor((self.YT - (y1 + pad)) / self.RES))
        r1 = int(np.ceil((self.YT - (y0 - pad)) / self.RES))
        c0 = int(np.floor((x0 - pad - self.X0) / self.RES))
        c1 = int(np.ceil((x1 + pad - self.X0) / self.RES))
        return max(0, r0), min(self.NR, r1), max(0, c0), min(self.NC, c1)

    def centres(self, r0, r1, c0, c1):
        xs = self.X0 + (np.arange(c0, c1) + 0.5) * self.RES
        ys = self.YT - (np.arange(r0, r1) + 0.5) * self.RES
        return np.meshgrid(xs, ys)

    def ground(self, r0, r1, c0, c1):
        """Bare earth under a window, one value per 0.5 m cell."""
        k = self.GK
        g = np.asarray(self.arr("dtm2.f32.npy")[r0 // k:(r1 + k - 1) // k + 1, c0 // k:(c1 + k - 1) // k + 1])
        return np.repeat(np.repeat(g, k, 0), k, 1)[r0 % k:r0 % k + (r1 - r0), c0 % k:c0 % k + (c1 - c0)]
