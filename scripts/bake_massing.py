#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bake_massing.py - measure building massing from public USGS 3DEP lidar.

One bake, one output file: data/massing.json. Nothing else writes that file.

What it measures, per building, from the 2017 USGS_LPC_TX_Central_B1 point cloud
(EPT octree on the AWS usgs-lidar-public bucket, no key, US public domain):

  ground_z   median class-2 (ground) elevation in a ring just outside the footprint
  h_max      tallest class-6 (building) point inside the footprint, above ground_z
  h_p99      99th percentile of the same - the robust roof/parapet height
  h_med      median - the height of the bulk of the roof surface
  levels     roof steps: modes of a 0.5 m max-height raster, as [height_m, % of cells]
  roof       flat / pitched / mixed, from the slope histogram of that raster
  roof_conf  0..1 confidence in that verdict (see ROOF_CONF in the code)
  n, d       class-6 point count inside the footprint, and points per m^2
  city_h     City of Austin 2017 footprint height (ELEVATION - BASE_ELEVATION, ft->m)
  city_cover fraction of OUR footprint the city polygon covers, and
  city_ratio that polygon's area over ours. TRUST FLAGS, and they fail in
             opposite directions: well below 1.0 cover means the city drew our
             building as several polygons; a ratio well above 1 means the city
             polygon is a whole block and its height belongs to somebody else
  trust      good / fair / poor / none, plus `why` when it is not good

It answers nothing about walls and nothing about night: lidar is nadir.

Re-run:
    pip install --only-binary=:all: laspy lazrs numpy
    python scripts/bake_massing.py --plan            # node/download plan only
    python scripts/bake_massing.py                   # full bake, resumable
    python scripts/bake_massing.py --only <id|slug>  # one building
    python scripts/bake_massing.py --report          # print the summary table

Downloaded octree nodes are cached OUTSIDE the repo (--cache, default
%TEMP%/austin-massing-cache or $AUSTIN_MASSING_CACHE). Per-building results are
cached too, so an interrupted run resumes without re-measuring anything.

Gotchas that cost the scouting round real time - do not rediscover them:
  * `pip install lazrs` builds from source and fails on Python 3.9; laspy then
    silently cannot open any LAZ file. Use --only-binary=:all:.
  * EPT X/Y are EPSG:3857. Planar distances must be multiplied by cos(lat)=0.863
    at this latitude or every area and density is 34% too small. Z is already
    true metres - never scale it.
  * 5 download workers, not 12 (12 gave 31 timeouts out of 92 nodes).
"""

import argparse
import concurrent.futures as cf
import datetime as _dt
import io
import json
import math
import os
import random
import sys
import time
import urllib.parse
import urllib.request

import numpy as np

# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------

EPT_BASE = ("https://s3-us-west-2.amazonaws.com/usgs-lidar-public/"
            "USGS_LPC_TX_Central_B1_2017_LAS_2019")
EPT_PROJECT = "USGS_LPC_TX_Central_B1_2017_LAS_2019"

CITY_URL = ("https://services.arcgis.com/0L95CJ0VTaxqcmED/ArcGIS/rest/services/"
            "UTILITIESCOMMUNICATION_building_footprints_2017/FeatureServer/0/query")
FT = 0.3048

OVERPASS = "https://overpass-api.de/api/interpreter"

UA = {"User-Agent": "austin-3d-explorer/bake_massing (github SimeonVarg/austin-3d-explorer)"}

# ---------------------------------------------------------------------------
# TASTE / tuning - every threshold in this bake is a one-line edit
# ---------------------------------------------------------------------------

GRID = 0.5          # m, raster cell for roof rasters
PAD = 14.0          # m, ring outside the footprint used for the ground median
LEVEL_MIN_PCT = 3.0     # % of roof cells before a step counts as a roof level
LEVEL_MIN_SEP = 1.5     # m, two roof levels closer than this are one level
FLAT_DEG = 10.0         # cells below this slope count as flat
FLAT_VERDICT = 55.0     # % flat cells at or above which the roof is called flat
PITCH_VERDICT = 25.0    # % flat cells at or below which it is called pitched
MIN_CELLS_FOR_ROOF = 120    # 30 m^2 of roof before any flat/pitched call is made
MIN_D_FOR_ROOF = 1.0        # class-6 pts/m^2 below which no call is made
CITY_TRUST = 0.90       # city polygon must cover this much of our footprint
CITY_RATIO_MAX = 2.0    # ... and be no more than this many times its area
CLASS_GROUND, CLASS_VEG_HI, CLASS_BUILDING, CLASS_WATER = 2, 5, 6, 9


def default_cache():
    env = os.environ.get("AUSTIN_MASSING_CACHE")
    if env:
        return env
    return os.path.join(os.environ.get("TEMP") or "/tmp", "austin-massing-cache")


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

R3857 = 20037508.342789244


def ll2m(lon, lat):
    x = lon * R3857 / 180.0
    y = math.log(math.tan((90.0 + lat) * math.pi / 360.0)) / (math.pi / 180.0) * R3857 / 180.0
    return x, y


def ring_area(ring):
    """Signed-area magnitude of a ring already in planar coords."""
    a = 0.0
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def pip_np(xs, ys, ring):
    """Vectorised point-in-polygon for one ring. ring = [(x,y), ...]."""
    r = np.asarray(ring, dtype=np.float64)
    inside = np.zeros(len(xs), dtype=bool)
    x1 = r[:, 0]
    y1 = r[:, 1]
    x2 = np.roll(x1, -1)
    y2 = np.roll(y1, -1)
    for i in range(len(r)):
        dy = y2[i] - y1[i]
        if dy == 0:
            continue
        a = (y1[i] > ys) != (y2[i] > ys)
        xint = (x2[i] - x1[i]) * (ys - y1[i]) / dy + x1[i]
        inside ^= (a & (xs < xint))
    return inside


def pip_one(pt, ring):
    x, y = pt
    c = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if ((y1 > y) != (y2 > y)) and (x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-15) + x1):
            c = not c
    return c


def in_polys(xs, ys, polys):
    """polys = [[exterior, hole, hole...], ...] in the same coords as xs/ys."""
    m = np.zeros(len(xs), dtype=bool)
    for rings in polys:
        sub = pip_np(xs, ys, rings[0])
        for h in rings[1:]:
            sub &= ~pip_np(xs, ys, h)
        m |= sub
    return m


def geom_polys(geom):
    """GeoJSON geometry -> [[exterior, hole...], ...] as lon/lat tuples."""
    t = geom.get("type")
    if t == "Polygon":
        return [[[(p[0], p[1]) for p in ring] for ring in geom["coordinates"]]]
    if t == "MultiPolygon":
        return [[[(p[0], p[1]) for p in ring] for ring in poly] for poly in geom["coordinates"]]
    return []


# ---------------------------------------------------------------------------
# EPT octree
# ---------------------------------------------------------------------------

class Ept(object):
    def __init__(self, cache, base=EPT_BASE):
        self.base = base
        self.cache = cache
        os.makedirs(cache, exist_ok=True)
        self.info = json.loads(self._get(base + "/ept.json", "ept.json"))
        self.cube = self.info["bounds"]
        self._h = {}

    def _get(self, url, name, timeout=180):
        p = os.path.join(self.cache, name)
        if os.path.exists(p) and os.path.getsize(p) > 0:
            return open(p, "rb").read()
        req = urllib.request.Request(url, headers=UA)
        d = urllib.request.urlopen(req, timeout=timeout).read()
        tmp = p + ".part%d" % os.getpid()
        open(tmp, "wb").write(d)
        os.replace(tmp, p)
        return d

    def node_bounds(self, d, x, y, z):
        c = self.cube
        sx = (c[3] - c[0]) / (2 ** d)
        sy = (c[4] - c[1]) / (2 ** d)
        sz = (c[5] - c[2]) / (2 ** d)
        return (c[0] + x * sx, c[1] + y * sy, c[2] + z * sz,
                c[0] + (x + 1) * sx, c[1] + (y + 1) * sy, c[2] + (z + 1) * sz)

    def hier(self, key="0-0-0-0"):
        if key not in self._h:
            self._h[key] = json.loads(self._get(
                "%s/ept-hierarchy/%s.json" % (self.base, key), "h_%s.json" % key))
        return self._h[key]

    def find_nodes(self, bb, max_depth=12, page="0-0-0-0"):
        """bb = (xmin, ymin, xmax, ymax) in EPSG:3857 -> [(key, npoints)]."""
        H = self.hier(page)
        out = []

        def overlaps(nb):
            return not (nb[3] <= bb[0] or nb[0] >= bb[2] or nb[4] <= bb[1] or nb[1] >= bb[3])

        def walk(key):
            v = H.get(key)
            if v is None:
                return
            d, x, y, z = (int(t) for t in key.split("-"))
            if not overlaps(self.node_bounds(d, x, y, z)):
                return
            if v == -1:
                out.extend(self.find_nodes(bb, max_depth, page=key))
                return
            out.append((key, v))
            if d >= max_depth:
                return
            for dx in (0, 1):
                for dy in (0, 1):
                    for dz in (0, 1):
                        walk("%d-%d-%d-%d" % (d + 1, 2 * x + dx, 2 * y + dy, 2 * z + dz))

        walk(page)
        return out

    def node_path(self, key):
        return os.path.join(self.cache, key + ".laz")

    def have(self, key):
        p = self.node_path(key)
        return os.path.exists(p) and os.path.getsize(p) > 0

    def download(self, keys, workers=5, log=print):
        todo = [k for k in keys if not self.have(k)]
        if not todo:
            return 0, 0, 0
        ok = bad = tot = 0

        def dl(k):
            p = self.node_path(k)
            tmp = p + ".part%d" % os.getpid()
            for attempt in (1, 2):
                try:
                    req = urllib.request.Request(
                        "%s/ept-data/%s.laz" % (self.base, k), headers=UA)
                    d = urllib.request.urlopen(req, timeout=420).read()
                    open(tmp, "wb").write(d)
                    os.replace(tmp, p)
                    return (k, len(d), None)
                except Exception as e:
                    err = str(e)[:70]
                    time.sleep(1.5 * attempt)
            try:
                os.remove(tmp)
            except Exception:
                pass
            return (k, 0, err)

        # 5 workers, not 12. 12 gave 31 timeouts out of 92 nodes.
        with cf.ThreadPoolExecutor(max_workers=workers) as ex:
            for k, n, err in ex.map(dl, todo):
                if err:
                    bad += 1
                    log("    node FAIL %s %s" % (k, err))
                else:
                    ok += 1
                    tot += n
        log("    downloaded %d nodes, %.1f MB, %d failures" % (ok, tot / 1e6, bad))
        return ok, bad, tot

    def load(self, key):
        import laspy
        raw = open(self.node_path(key), "rb").read()
        return laspy.read(io.BytesIO(raw))


def gps_to_date(t):
    """LAS Adjusted Standard GPS time -> UTC date string."""
    unix = float(t) + 1e9 + 315964800.0 - 18.0
    return _dt.datetime.utcfromtimestamp(unix).strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# Targets
# ---------------------------------------------------------------------------

def load_targets(repo, snapshot, inventory_path=None, log=print):
    """Every building we can find a real footprint for.

    Primary key is the loaded snapshot's feature id, which is what the app joins on.
    Buildings the detailed snapshot does not carry (the outer-ring tiles, the
    Capitol) are matched from their own data files by nearest centroid.
    """
    snap_path = os.path.join(repo, "data", "snapshots", snapshot, "buildings.detailed.geojson")
    snap = json.load(open(snap_path))
    feats = {}
    for f in snap["features"]:
        pid = f["properties"].get("id")
        if not pid:
            continue
        feats[pid] = f

    targets = []
    seen = set()

    def centroid(polys):
        pts = [p for rings in polys for p in rings[0]]
        return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))

    def add(key, polys, **kw):
        if key in seen:
            return
        seen.add(key)
        lon, lat = centroid(polys)
        t = dict(key=key, polys=polys, lon=lon, lat=lat)
        t.update(kw)
        targets.append(t)

    # -- inventory (the curated model-area list), when we were given one --------
    inv = []
    if inventory_path and os.path.exists(inventory_path):
        inv = json.load(open(inventory_path))
        log("  inventory: %d buildings" % len(inv))

    # extra footprint sources for the inventory rows the snapshot does not carry
    extra = []
    for fn in ("data/outer_ring.geojson", "data/capitol.geojson"):
        p = os.path.join(repo, fn)
        if not os.path.exists(p):
            continue
        g = json.load(open(p))
        for i, f in enumerate(g["features"]):
            polys = geom_polys(f["geometry"])
            if not polys:
                continue
            c = centroid(polys)
            extra.append((c, polys, f["properties"], "%s#%d" % (os.path.basename(fn), i)))

    matched = 0
    for b in inv:
        ids = b.get("snapshot_ids") or []
        got = [feats[i] for i in ids if i in feats]
        if got:
            polys = []
            for f in got:
                polys.extend(geom_polys(f["geometry"]))
            add(got[0]["properties"]["id"], polys,
                slug=b.get("slug"), name=b.get("name"), area=b.get("area"),
                tier=b.get("tier"), snapshot_ids=[f["properties"]["id"] for f in got],
                inv_h=b.get("height_m"),
                snap_h=got[0]["properties"].get("final_height"),
                snap_floors=got[0]["properties"].get("num_floors"))
            matched += 1
        elif b.get("lng") is not None and extra:
            # nearest centroid in the tile-only / capitol sources, within 40 m
            best = None
            for c, polys, props, src in extra:
                d = math.hypot((c[0] - b["lng"]) * 96123.0, (c[1] - b["lat"]) * 111320.0)
                if best is None or d < best[0]:
                    best = (d, polys, props, src)
            if best and best[0] < 40.0:
                key = best[2].get("id") or ("inv:" + b["slug"])
                add(key, best[1], slug=b.get("slug"), name=b.get("name"),
                    area=b.get("area"), tier=b.get("tier"), snapshot_ids=[],
                    inv_h=b.get("height_m"), src_file=best[3])
                matched += 1
    if inv:
        log("  inventory footprints resolved: %d of %d" % (matched, len(inv)))

    return targets, feats, inv


def attach_apartments(repo, targets, log=print):
    """data/apartments/<slug>.json carries the snapshot feature id it was authored from."""
    d = os.path.join(repo, "data", "apartments")
    by_id = {}
    if os.path.isdir(d):
        for fn in sorted(os.listdir(d)):
            if not fn.endswith(".json") or fn == "index.json":
                continue
            try:
                j = json.load(open(os.path.join(d, fn), encoding="utf-8"))
            except Exception:
                continue
            if j.get("id"):
                floors = (j.get("levels") or {}).get("floors") or []
                by_id[j["id"]] = (fn[:-5], floors[-1] if floors else None)
    n = 0
    for t in targets:
        ids = [t["key"]] + list(t.get("snapshot_ids") or [])
        for i in ids:
            if i in by_id:
                t["apartment"], t["auth_h"] = by_id[i]
                n += 1
                break
    log("  apartments joined: %d" % n)
    return n


# ---------------------------------------------------------------------------
# City of Austin footprints (2017) - height + coverage trust flag
# ---------------------------------------------------------------------------

class CityFootprints(object):
    """Cached tile fetch of the city's 2017 building-footprint layer.

    LICENCE: the City of Austin catalogue says 'See Terms of Use' for this layer.
    It is NOT an explicit public-domain dedication (unlike the USGS lidar).
    Derived numbers are fine; the polygons are not ours to redistribute.
    """

    TILE = 0.005  # deg, about 480 m

    def __init__(self, cache, log=print):
        self.dir = os.path.join(cache, "city")
        os.makedirs(self.dir, exist_ok=True)
        self.tiles = {}
        self.log = log
        self.offline = False

    def _key(self, lon, lat):
        return (int(math.floor(lon / self.TILE)), int(math.floor(lat / self.TILE)))

    def _fetch_tile(self, kx, ky):
        name = os.path.join(self.dir, "t_%d_%d.json" % (kx, ky))
        if os.path.exists(name):
            try:
                return json.load(open(name))
            except Exception:
                pass
        bbox = (kx * self.TILE, ky * self.TILE, (kx + 1) * self.TILE, (ky + 1) * self.TILE)
        feats = []
        offset = 0
        while True:
            p = {
                "f": "json", "where": "1=1",
                "outFields": "OBJECTID,MAX_HEIGHT,ELEVATION,BASE_ELEVATION,SOURCE,Shape__Area",
                "geometry": json.dumps({"xmin": bbox[0], "ymin": bbox[1],
                                        "xmax": bbox[2], "ymax": bbox[3],
                                        "spatialReference": {"wkid": 4326}}),
                "geometryType": "esriGeometryEnvelope", "inSR": "4326", "outSR": "4326",
                "spatialRel": "esriSpatialRelIntersects", "returnGeometry": "true",
                "resultRecordCount": "1000", "resultOffset": str(offset),
            }
            try:
                req = urllib.request.Request(CITY_URL + "?" + urllib.parse.urlencode(p), headers=UA)
                d = json.loads(urllib.request.urlopen(req, timeout=120).read())
            except Exception as e:
                self.log("    city tile %d,%d failed: %s" % (kx, ky, str(e)[:60]))
                self.offline = True
                return []
            fs = d.get("features") or []
            feats.extend(fs)
            if not d.get("exceededTransferLimit") or not fs:
                break
            offset += len(fs)
        slim = []
        for f in feats:
            a = f["attributes"]
            e, b = a.get("ELEVATION"), a.get("BASE_ELEVATION")
            h = round((e - b) * FT, 2) if (e is not None and b is not None) else None
            rings = (f.get("geometry") or {}).get("rings") or []
            if not rings:
                continue
            xs = [p[0] for r in rings for p in r]
            ys = [p[1] for r in rings for p in r]
            slim.append(dict(oid=a.get("OBJECTID"), h=h, src=a.get("SOURCE"),
                             bbox=[min(xs), min(ys), max(xs), max(ys)], rings=rings))
        json.dump(slim, open(name, "w"))
        return slim

    def near(self, lon, lat):
        kx, ky = self._key(lon, lat)
        out = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                k = (kx + dx, ky + dy)
                if k not in self.tiles:
                    self.tiles[k] = self._fetch_tile(k[0], k[1])
                out.extend(self.tiles[k])
        return out

    @staticmethod
    def poly_area(rings):
        """Area in true m^2 of an ArcGIS ring set given in lon/lat."""
        a = 0.0
        for r in rings:
            if len(r) < 3:
                continue
            lat = sum(p[1] for p in r) / len(r)
            k = math.cos(math.radians(lat)) * 111320.0
            pts = [(p[0] * k, p[1] * 110540.0) for p in r]
            a += ring_area(pts)
        return a

    def best(self, samples, lon, lat):
        """samples = lon/lat points inside our footprint.

        Returns (height, cover, oid, area_m2). `cover` is how much of OUR
        footprint the city polygon covers; `area_m2` is how big that polygon is,
        because the two failures are opposite: a city polygon much SMALLER than
        our footprint is one wing of our building, and one much LARGER is a whole
        block that happens to contain us - and its height is then somebody else's.
        """
        if not samples:
            return None, None, None, None
        cands = self.near(lon, lat)
        sx0 = min(s[0] for s in samples)
        sx1 = max(s[0] for s in samples)
        sy0 = min(s[1] for s in samples)
        sy1 = max(s[1] for s in samples)
        best = (0.0, None, None, None)
        for c in cands:
            bb = c["bbox"]
            if bb[2] < sx0 or bb[0] > sx1 or bb[3] < sy0 or bb[1] > sy1:
                continue
            hit = 0
            for s in samples:
                inside = False
                for r in c["rings"]:
                    if pip_one(s, [(p[0], p[1]) for p in r]):
                        inside = not inside
                if inside:
                    hit += 1
            frac = hit / float(len(samples))
            if frac > best[0]:
                best = (frac, c.get("h"), c.get("oid"), self.poly_area(c["rings"]))
        if best[0] <= 0:
            return None, 0.0, None, None
        return best[1], round(best[0], 3), best[2], best[3]


# ---------------------------------------------------------------------------
# OSM ids (join convenience only - never a source of truth here)
# ---------------------------------------------------------------------------

def load_osm(cache, bbox, log=print):
    path = os.path.join(cache, "osm_buildings.json")
    if not os.path.exists(path):
        q = ('[out:json][timeout:180];(way["building"](%f,%f,%f,%f);'
             'relation["building"](%f,%f,%f,%f););out geom;') % (
            bbox[1], bbox[0], bbox[3], bbox[2], bbox[1], bbox[0], bbox[3], bbox[2])
        try:
            req = urllib.request.Request(OVERPASS, data=urllib.parse.urlencode({"data": q}).encode(),
                                         headers=UA)
            d = urllib.request.urlopen(req, timeout=300).read()
            open(path, "wb").write(d)
        except Exception as e:
            log("  overpass failed (%s) - osm ids will be null" % str(e)[:60])
            return []
    try:
        j = json.load(open(path, encoding="utf-8"))
    except Exception:
        return []
    out = []
    for e in j.get("elements", []):
        g = e.get("geometry")
        if not g or len(g) < 4:
            continue
        ring = [(p["lon"], p["lat"]) for p in g]
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        out.append(dict(id=("w%d" if e["type"] == "way" else "r%d") % e["id"],
                        ring=ring, bbox=[min(xs), min(ys), max(xs), max(ys)]))
    log("  osm buildings in bbox: %d" % len(out))
    return out


def osm_index(osm):
    idx = {}
    for o in osm:
        kx = int(math.floor(o["bbox"][0] / 0.005))
        ky = int(math.floor(o["bbox"][1] / 0.005))
        idx.setdefault((kx, ky), []).append(o)
    return idx


def osm_match(idx, samples, lon, lat):
    if not idx or not samples:
        return None
    kx, ky = int(math.floor(lon / 0.005)), int(math.floor(lat / 0.005))
    cands = []
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            cands.extend(idx.get((kx + dx, ky + dy), []))
    sx0 = min(s[0] for s in samples)
    sx1 = max(s[0] for s in samples)
    sy0 = min(s[1] for s in samples)
    sy1 = max(s[1] for s in samples)
    best = (0.0, None)
    for c in cands:
        bb = c["bbox"]
        if bb[2] < sx0 or bb[0] > sx1 or bb[3] < sy0 or bb[1] > sy1:
            continue                     # cheap reject: most candidates die here
        hit = 0
        for s in samples:
            if bb[0] <= s[0] <= bb[2] and bb[1] <= s[1] <= bb[3] and pip_one(s, c["ring"]):
                hit += 1
        frac = hit / float(len(samples))
        if frac > best[0]:
            best = (frac, c["id"])
    return best[1] if best[0] >= 0.5 else None


# ---------------------------------------------------------------------------
# The measurement
# ---------------------------------------------------------------------------

def roof_stats(h, lx, ly, gs=GRID):
    """Rasterise the roof at gs metres, return (levels, slope_median, flat_pct, cells, fill)."""
    x0, y0 = lx.min(), ly.min()
    W = int((lx.max() - x0) / gs) + 1
    H = int((ly.max() - y0) / gs) + 1
    if W < 2 or H < 2 or W * H > 4_000_000:
        return [], None, None, 0, None
    xi = ((lx - x0) / gs).astype(np.int32)
    yi = ((ly - y0) / gs).astype(np.int32)
    grid = np.full((H, W), np.nan)
    o = np.argsort(h)
    grid[yi[o], xi[o]] = h[o]          # max height wins per cell
    filled = np.isfinite(grid)
    cells = int(filled.sum())
    if cells < 8:
        return [], None, None, cells, None
    vals = grid[filled]
    top = max(float(vals.max()), 0.5)
    hist, edges = np.histogram(vals, bins=np.arange(0, top + gs, gs))
    levels = []
    for i in np.argsort(hist)[::-1]:
        if hist[i] < cells * (LEVEL_MIN_PCT / 100.0):
            continue
        c = (edges[i] + edges[i + 1]) / 2.0
        if all(abs(c - m0) > LEVEL_MIN_SEP for m0, _ in levels):
            levels.append((round(float(c), 2), round(100.0 * float(hist[i]) / cells, 1)))
        if len(levels) >= 5:
            break
    levels.sort()
    gy, gx = np.gradient(np.where(filled, grid, np.nan))
    slope = np.degrees(np.arctan(np.hypot(gx, gy) / gs))
    sl = slope[np.isfinite(slope)]
    if len(sl) < 8:
        return levels, None, None, cells, round(100.0 * cells / (W * H), 1)
    return (levels, round(float(np.median(sl)), 1),
            round(100.0 * float((sl < FLAT_DEG).mean()), 1),
            cells, round(100.0 * cells / (W * H), 1))


def roof_verdict(flat_pct, cells, dens):
    """flat / pitched / mixed with a confidence in 0..1, or (None, 0) when the
    2017 density cannot support a call at this footprint size."""
    if flat_pct is None or cells < MIN_CELLS_FOR_ROOF or dens < MIN_D_FOR_ROOF:
        return None, 0.0
    if flat_pct >= FLAT_VERDICT:
        v = "flat"
        margin = (flat_pct - FLAT_VERDICT) / (100.0 - FLAT_VERDICT)
    elif flat_pct <= PITCH_VERDICT:
        v = "pitched"
        margin = (PITCH_VERDICT - flat_pct) / PITCH_VERDICT
    else:
        v = "mixed"
        margin = 1.0 - abs(flat_pct - (FLAT_VERDICT + PITCH_VERDICT) / 2.0) / \
                 ((FLAT_VERDICT - PITCH_VERDICT) / 2.0)
    size = min(1.0, cells / 600.0)          # 150 m^2 of roof = full size credit
    dscore = min(1.0, dens / 4.0)           # 4 pts/m^2 = full density credit
    conf = max(0.0, min(1.0, 0.25 + 0.75 * (0.45 * margin + 0.3 * size + 0.25 * dscore)))
    return v, round(conf, 2)


def footprint_samples(t, n=22):
    """A grid of lon/lat points inside our own footprint, for the overlap tests."""
    lons = [p[0] for rings in t["polys"] for p in rings[0]]
    lats = [p[1] for rings in t["polys"] for p in rings[0]]
    out = []
    for i in range(n):
        for j in range(n):
            x = min(lons) + (max(lons) - min(lons)) * (i + 0.5) / n
            y = min(lats) + (max(lats) - min(lats)) * (j + 0.5) / n
            ok = False
            for rings in t["polys"]:
                if pip_one((x, y), rings[0]) and not any(pip_one((x, y), h) for h in rings[1:]):
                    ok = not ok
            if ok:
                out.append((x, y))
    return out


def measure(t, pts, city, oidx, rng):
    """pts = dict of concatenated arrays for this target's padded box."""
    lat = t["lat"]
    sc = math.cos(math.radians(lat))
    cx, cy = ll2m(t["lon"], lat)

    polys_m = [[[ll2m(a, b) for a, b in ring] for ring in rings] for rings in t["polys"]]
    area = 0.0
    for rings in polys_m:
        area += ring_area(rings[0]) * sc * sc
        for h in rings[1:]:
            area -= ring_area(h) * sc * sc
    area = max(area, 1.0)

    res = dict(id=t["key"], area_m2=round(area, 1))
    for k in ("slug", "name", "apartment", "area", "tier", "snap_h", "snap_floors",
              "inv_h", "auth_h"):
        if t.get(k) not in (None, ""):
            res["nbhd" if k == "area" else k] = t[k]

    # sample grid inside our footprint, in lon/lat, for the city + OSM overlap tests
    samples = footprint_samples(t)
    if city is not None:
        ch, cc, coid, carea = city.best(samples, t["lon"], lat)
        if ch is not None:
            res["city_h"] = ch
        if cc is not None:
            res["city_cover"] = cc
        if coid is not None:
            res["city_oid"] = coid
        if carea:
            res["city_ratio"] = round(carea / area, 2)   # city polygon / our footprint
    om = osm_match(oidx, samples, t["lon"], lat)
    if om:
        res["osm"] = om

    if pts is None or len(pts["z"]) == 0:
        res["trust"] = "none"
        res["why"] = "no_points"
        return res

    X, Y, Z, C = pts["x"], pts["y"], pts["z"], pts["c"]
    inb = in_polys(X, Y, polys_m)

    # ground: class 2 in the ring just outside the footprint
    gm = (C == CLASS_GROUND) & (~inb)
    if gm.sum() >= 30:
        ground = float(np.median(Z[gm]))
        gsrc = int(gm.sum())
    elif (C == CLASS_GROUND).sum() >= 10:
        ground = float(np.median(Z[C == CLASS_GROUND]))
        gsrc = int((C == CLASS_GROUND).sum())
    else:
        ground = float(np.percentile(Z, 2))
        gsrc = 0
    res["ground_z"] = round(ground, 2)
    res["ground_n"] = gsrc

    if pts.get("t0") is not None:
        res["acq"] = [gps_to_date(pts["t0"]), gps_to_date(pts["t1"])]
    res["src"] = EPT_PROJECT

    bld = inb & (C == CLASS_BUILDING)
    n = int(bld.sum())
    veg = int((inb & np.isin(C, (3, 4, CLASS_VEG_HI))).sum())
    wat = int((inb & (C == CLASS_WATER)).sum())
    gnd_in = int((inb & (C == CLASS_GROUND)).sum())

    # Everything inside the footprint that is not vegetation and not water. On a
    # correctly classified building this is the same surface as class 6; where
    # the 2017 classifier failed it is the ONLY record of the building. Signature
    # 1909's roof, 73 m up, is classified as GROUND in this tile.
    nonveg = inb & ~np.isin(C, (3, 4, CLASS_VEG_HI, CLASS_WATER))
    h_nv = (float(np.percentile(Z[nonveg], 99)) - ground) if int(nonveg.sum()) >= 50 else None
    if h_nv is not None:
        res["h_nv"] = round(h_nv, 2)

    if n < 20:
        # No class-6 points. Either nothing stood here in 2017, or the returns
        # from what did stand here went into another class.
        if h_nv is not None and h_nv > 3.0 and int(nonveg.sum()) >= 200:
            bld = nonveg
            n = int(bld.sum())
            res["fallback"] = "unclassified"   # measured off non-vegetation returns
        else:
            res["n"] = n
            res["d"] = round(n / area, 2)
            if veg:
                res["veg_n"] = veg
            res["trust"] = "none"
            res["why"] = (
                "water" if wat > max(n, 10) else
                # mostly ground returns and nothing above 3 m: open ground in 2017
                "vacant_in_2017" if (gnd_in > 0.4 * max(inb.sum(), 1)
                                     and (h_nv is None or h_nv <= 3.0)) else
                "tree_cover" if veg > max(n, 10) else
                "no_class6" if inb.sum() > 20 else "footprint_mismatch")
            return res

    res["n"] = n
    res["d"] = round(n / area, 2)
    if veg:
        res["veg_n"] = veg

    h = Z[bld] - ground
    res["h_max"] = round(float(h.max()), 2)
    res["h_p99"] = round(float(np.percentile(h, 99)), 2)
    res["h_med"] = round(float(np.median(h)), 2)

    lx = (X[bld] - cx) * sc
    ly = (Y[bld] - cy) * sc
    levels, slope_med, flat_pct, cells, fill = roof_stats(h, lx, ly)
    if levels:
        res["levels"] = levels
    if slope_med is not None:
        res["slope_med"] = slope_med
        res["flat_pct"] = flat_pct
    if fill is not None:
        res["fill"] = fill
    v, conf = roof_verdict(flat_pct, cells, res["d"])
    if v:
        res["roof"] = v
        res["roof_conf"] = conf

    # Split-half stability: does HALF this building's points give the same verdict?
    # This is the honest answer to "at what size does 2017 density support a call".
    if v and n >= 60:
        idx = rng.permutation(n)
        agree = True
        for half in (idx[:n // 2], idx[n // 2:]):
            _l, _s, fp, cl, _f = roof_stats(h[half], lx[half], ly[half])
            hv, _c = roof_verdict(fp, cl, res["d"] / 2.0)
            if hv != v:
                agree = False
        res["split_agree"] = bool(agree)

    return assess(res)


def assess(res):
    """Trust flags, recomputed from the stored fields alone.

    Kept separate from the measurement so the thresholds above can be changed
    and re-applied to the cached results without re-reading a single point.
    """
    if res.get("h_max") is None:
        return res
    cc = res.get("city_cover")
    why = []
    # The flight is from 2017. A building the model says is much taller than
    # anything the lidar found on that footprint was built after the plane flew:
    # these heights are the SITE's 2017 heights, not this building's.
    # the tallest thing the MODEL claims stands here, from any of its own sources
    sh = max([v for v in (res.get("snap_h"), res.get("inv_h"), res.get("auth_h"))
              if v is not None] or [0])
    res.pop("late_build", None)
    if sh and (sh - res["h_max"]) > 8.0:
        res["late_build"] = True
        why.append("built_after_2017")
    if res.get("fallback"):
        why.append("unclassified_returns")
    # The 2017 classifier put some roofs in class 1 or 2. When the non-vegetation
    # returns reach well above the class-6 surface, class 6 is not the whole roof.
    if res.get("h_nv") is not None and res["h_nv"] > res["h_max"] + 5.0:
        why.append("taller_returns_unclassified")
    if res.get("d", 0) < 1.0:
        why.append("sparse")
    fill = res.get("fill")
    if fill is not None and fill < 25:
        why.append("patchy")
    cr = res.get("city_ratio")
    if cc is not None and cc < CITY_TRUST:
        why.append("city_polygon_is_part")     # the city drew our building as several
    if cr is not None and cr > CITY_RATIO_MAX:
        why.append("city_polygon_is_a_block")  # the city polygon is a whole block
    # compare like with like: the city's number is a MAX_HEIGHT, so use h_max
    if res.get("city_h") and abs(res["city_h"] - res["h_max"]) > 4.0 and (cc or 0) >= CITY_TRUST:
        why.append("city_height_disagrees")
    n = res.get("n", 0)
    if not why and res.get("d", 0) >= 2.0 and n >= 200:
        res["trust"] = "good"
    elif "sparse" in why or n < 60 or res.get("late_build") or res.get("fallback"):
        res["trust"] = "poor"
    else:
        res["trust"] = "fair"
    res.pop("why", None)
    if why:
        res["why"] = ",".join(why)
    return res


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

def target_bbox3857(t, pad=PAD):
    lat = t["lat"]
    sc = math.cos(math.radians(lat))
    pts = [ll2m(a, b) for rings in t["polys"] for a, b in rings[0]]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    p = pad / sc
    return (min(xs) - p, min(ys) - p, max(xs) + p, max(ys) + p)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ap.add_argument("--snapshot", default=None, help="snapshot date (default: manifest latest)")
    ap.add_argument("--inventory", default=os.environ.get("AUSTIN_MASSING_INVENTORY"),
                    help="model-area inventory.json (slug/name/tier per building)")
    ap.add_argument("--cache", default=default_cache())
    ap.add_argument("--out", default=None)
    ap.add_argument("--depth", type=int, default=12)
    ap.add_argument("--workers", type=int, default=5)
    ap.add_argument("--batch", type=int, default=120)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--only", default=None, help="comma-separated ids or slugs")
    ap.add_argument("--plan", action="store_true", help="report the node plan and stop")
    ap.add_argument("--report", action="store_true", help="print the summary table from the cache")
    ap.add_argument("--force", action="store_true", help="re-measure cached buildings")
    ap.add_argument("--osm-refresh", action="store_true",
                    help="re-match OSM ids against the cached results and rewrite the output "
                         "(no lidar work; use after widening the Overpass bbox)")
    ap.add_argument("--no-city", action="store_true")
    a = ap.parse_args()

    repo = a.repo
    out_path = a.out or os.path.join(repo, "data", "massing.json")
    snapshot = a.snapshot
    if not snapshot:
        snapshot = json.load(open(os.path.join(repo, "data", "manifest.json")))["latest"]
    os.makedirs(a.cache, exist_ok=True)
    results_path = os.path.join(a.cache, "results.json")

    def log(*m):
        print(*m, flush=True)

    log("snapshot %s | cache %s" % (snapshot, a.cache))
    targets, feats, inv = load_targets(repo, snapshot, a.inventory, log)
    if not targets:
        log("no inventory given - falling back to every feature in the snapshot")
        for pid, f in feats.items():
            polys = geom_polys(f["geometry"])
            if not polys:
                continue
            pts = [p for rings in polys for p in rings[0]]
            targets.append(dict(key=pid, polys=polys,
                                lon=sum(p[0] for p in pts) / len(pts),
                                lat=sum(p[1] for p in pts) / len(pts),
                                name=f["properties"].get("name"), snapshot_ids=[pid]))
    attach_apartments(repo, targets, log)

    if a.only:
        want = set(s.strip() for s in a.only.split(","))
        targets = [t for t in targets if t["key"] in want or t.get("slug") in want]
    if a.limit:
        targets = targets[:a.limit]
    log("targets: %d" % len(targets))

    # spatial sort so each batch shares octree nodes
    targets.sort(key=lambda t: (int(t["lat"] / 0.003), int(t["lon"] / 0.003)))

    ept = Ept(a.cache)
    for t in targets:
        t["bb"] = target_bbox3857(t)

    if a.plan:
        need = {}
        for t in targets:
            for k, n in ept.find_nodes(t["bb"], a.depth):
                need[k] = n
        have = sum(1 for k in need if ept.have(k))
        log("nodes needed %d (%d cached, %d to download), %.1fM points in those nodes"
            % (len(need), have, len(need) - have, sum(need.values()) / 1e6))
        return

    if a.osm_refresh:
        done = {r["id"]: r for r in json.load(open(results_path))}
        lons = [t["lon"] for t in targets]
        lats = [t["lat"] for t in targets]
        bbox = (min(lons) - 0.002, min(lats) - 0.002, max(lons) + 0.002, max(lats) + 0.002)
        oidx = osm_index(load_osm(a.cache, bbox, log))
        hit = 0
        for t in targets:
            r = done.get(t["key"])
            if r is None:
                continue
            om = osm_match(oidx, footprint_samples(t), t["lon"], t["lat"])
            if om:
                r["osm"] = om
                hit += 1
            else:
                r.pop("osm", None)
        log("osm ids matched: %d of %d" % (hit, len(targets)))
        json.dump(list(done.values()), open(results_path, "w"))
        rows = [done[t["key"]] for t in targets if t["key"] in done]
        write_out(out_path, rows, snapshot, a.depth, log, targets)
        summary(rows, log)
        return

    done = {}
    if os.path.exists(results_path) and not a.force:
        try:
            done = {r["id"]: r for r in json.load(open(results_path))}
            log("resuming: %d buildings already measured" % len(done))
        except Exception:
            done = {}

    lons = [t["lon"] for t in targets]
    lats = [t["lat"] for t in targets]
    bbox = (min(lons) - 0.002, min(lats) - 0.002, max(lons) + 0.002, max(lats) + 0.002)
    oidx = osm_index(load_osm(a.cache, bbox, log))
    city = None if a.no_city else CityFootprints(a.cache, log)
    rng = np.random.default_rng(12345)

    todo = [t for t in targets if a.force or t["key"] not in done]
    log("to measure: %d" % len(todo))
    t_start = time.time()
    for bi in range(0, len(todo), a.batch):
        batch = todo[bi:bi + a.batch]
        need = {}
        for t in batch:
            for k, n in ept.find_nodes(t["bb"], a.depth):
                need[k] = n
        log("batch %d/%d: %d buildings, %d nodes"
            % (bi // a.batch + 1, (len(todo) + a.batch - 1) // a.batch, len(batch), len(need)))
        ept.download(sorted(need), workers=a.workers, log=log)

        acc = dict((t["key"], dict(x=[], y=[], z=[], c=[], t0=None, t1=None)) for t in batch)
        for k in sorted(need):
            if not ept.have(k):
                continue
            try:
                las = ept.load(k)
            except Exception as e:
                log("    node unreadable %s %s" % (k, str(e)[:60]))
                continue
            X = np.asarray(las.x)
            Y = np.asarray(las.y)
            Z = np.asarray(las.z)
            C = np.asarray(las.classification)
            try:
                T = np.asarray(las.gps_time)
            except Exception:
                T = None
            nb = ept.node_bounds(*[int(v) for v in k.split("-")])
            for t in batch:
                bb = t["bb"]
                if nb[3] <= bb[0] or nb[0] >= bb[2] or nb[4] <= bb[1] or nb[1] >= bb[3]:
                    continue
                m = (X >= bb[0]) & (X <= bb[2]) & (Y >= bb[1]) & (Y <= bb[3])
                if not m.any():
                    continue
                s = acc[t["key"]]
                s["x"].append(X[m])
                s["y"].append(Y[m])
                s["z"].append(Z[m].astype(np.float32))
                s["c"].append(C[m].astype(np.uint8))
                if T is not None:
                    lo, hi = float(T[m].min()), float(T[m].max())
                    s["t0"] = lo if s["t0"] is None else min(s["t0"], lo)
                    s["t1"] = hi if s["t1"] is None else max(s["t1"], hi)
            del X, Y, Z, C, T, las

        for t in batch:
            s = acc[t["key"]]
            if s["x"]:
                pts = dict(x=np.concatenate(s["x"]), y=np.concatenate(s["y"]),
                           z=np.concatenate(s["z"]).astype(np.float64),
                           c=np.concatenate(s["c"]), t0=s["t0"], t1=s["t1"])
            else:
                pts = None
            try:
                r = measure(t, pts, city, oidx, rng)
            except Exception as e:
                import traceback
                traceback.print_exc()
                r = dict(id=t["key"], slug=t.get("slug"), trust="none", why="error:" + str(e)[:60])
            done[r["id"]] = r
        acc = None
        json.dump(list(done.values()), open(results_path, "w"))
        el = time.time() - t_start
        log("  measured %d / %d  (%.0f s elapsed)"
            % (min(bi + a.batch, len(todo)), len(todo), el))

    rows = [done[t["key"]] for t in targets if t["key"] in done]
    write_out(out_path, rows, snapshot, a.depth, log, targets)
    summary(rows, log)


def write_out(path, rows, snapshot, depth, log, targets=None):
    # Re-attach the identity fields from the target list and re-apply the trust
    # thresholds, so a cached result measured under older thresholds is brought
    # up to date without re-reading a point.
    if targets:
        tk = dict((t["key"], t) for t in targets)
        for r in rows:
            t = tk.get(r["id"])
            if not t:
                continue
            for k in ("slug", "name", "apartment", "tier", "snap_h", "snap_floors",
                      "inv_h", "auth_h"):
                if t.get(k) not in (None, "") and r.get(k) is None:
                    r[k] = t[k]
            if t.get("area") and not r.get("nbhd"):
                r["nbhd"] = t["area"]
    for r in rows:
        assess(r)
    ok = [r for r in rows if r.get("h_p99") is not None]
    gz = [r["ground_z"] for r in rows if r.get("ground_z") is not None]
    acq = [r["acq"] for r in rows if r.get("acq")]
    meta = dict(
        generated=_dt.datetime.utcnow().strftime("%Y-%m-%d"),
        bake="scripts/bake_massing.py",
        source=dict(name="USGS 3DEP lidar", project=EPT_PROJECT, ept=EPT_BASE,
                    licence="US public domain (USGS 3DEP)",
                    acquired=[min(a[0] for a in acq), max(a[1] for a in acq)] if acq else None,
                    depth=depth),
        city=dict(layer="City of Austin UTILITIESCOMMUNICATION_building_footprints_2017",
                  licence="See Terms of Use (NOT public domain) - heights are facts, "
                          "the polygons are not redistributed here",
                  height="ELEVATION - BASE_ELEVATION, feet converted to metres"),
        snapshot=snapshot,
        counts=dict(buildings=len(rows), measured=len(ok),
                    failed=len(rows) - len(ok)),
        ground=dict(min=round(min(gz), 2), max=round(max(gz), 2),
                    spread=round(max(gz) - min(gz), 2)) if gz else None,
        fields=dict(
            ground_z="median class-2 ground elevation, metres above the lidar datum",
            h_max="tallest class-6 point above ground_z, metres",
            h_p99="99th percentile of the same - the robust roof height",
            h_med="median class-6 height - the bulk roof surface",
            levels="[height_m, % of roof cells] roof steps, 0.5 m raster",
            roof="flat / pitched / mixed from the slope histogram",
            roof_conf="0..1 confidence in that verdict",
            split_agree="both random halves of the points gave the same verdict",
            n="class-6 points inside the footprint", d="those points per m^2",
            city_h="City of Austin 2017 footprint height, metres",
            city_cover="fraction of OUR footprint that city polygon covers",
            city_ratio="that city polygon's area divided by our footprint's. Above ~2 "
                       "the city polygon is a whole block and its height is "
                       "somebody else's building",
            h_nv="99th percentile of every non-vegetation return inside the footprint; "
                 "far above h_max means the 2017 classifier missed this roof",
            fallback="height taken from non-vegetation returns because class 6 was empty",
            snap_h="the snapshot's own final_height, for comparison only",
            late_build="the snapshot height is >8 m above anything the 2017 lidar "
                       "found here: this building was built after the flight and "
                       "the heights above describe the SITE, not the building",
            trust="good / fair / poor / none", why="why it is not good"),
        caveats=["lidar is nadir: this says nothing about walls and nothing about night",
                 "2017 flight: anything finished after 2017 is missing or half-built"],
    )
    rows = sorted(rows, key=lambda r: (r.get("slug") or "", r["id"]))
    json.dump(dict(meta=meta, buildings=rows), open(path, "w"), separators=(",", ":"))
    log("wrote %s (%.2f MB, %d buildings)" % (path, os.path.getsize(path) / 1e6, len(rows)))


def summary(rows, log):
    ok = [r for r in rows if r.get("h_p99") is not None]
    log("")
    log("  %-34s %7s %7s %7s %6s %7s %5s" %
        ("building", "h_max", "h_p99", "city_h", "cover", "roof", "trust"))
    for r in sorted(ok, key=lambda r: -r["h_p99"])[:25]:
        log("  %-34s %7.2f %7.2f %7s %6s %7s %5s" % (
            (r.get("slug") or r.get("name") or r["id"])[:34], r["h_max"], r["h_p99"],
            ("%.2f" % r["city_h"]) if r.get("city_h") else "-",
            ("%.2f" % r["city_cover"]) if r.get("city_cover") is not None else "-",
            r.get("roof") or "-", r.get("trust") or "-"))
    import collections
    log("")
    log("  trust: %s" % dict(collections.Counter(r.get("trust") for r in rows)))
    log("  roof:  %s" % dict(collections.Counter(r.get("roof") for r in rows)))
    fails = collections.Counter(r.get("why") for r in rows if r.get("h_p99") is None)
    log("  failures: %s" % dict(fails))
    gz = [r["ground_z"] for r in rows if r.get("ground_z") is not None]
    if gz:
        log("  ground: %.2f to %.2f m (spread %.2f m)" % (min(gz), max(gz), max(gz) - min(gz)))


if __name__ == "__main__":
    main()
