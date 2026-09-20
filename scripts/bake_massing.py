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
  roof       flat / pitched / mixed, from the slope histogram of that raster,
             or absent with roof_no saying which guard declined the call
  roof_conf  0..1 confidence in that verdict, capped when the two random halves
             of the points disagree or the footprint is a fragment
  n, d       class-6 point count inside the footprint, and points per m^2
  match      how we found this building's footprint: "snapshot_id" (the
             inventory names the snapshot feature) or "centroid" (nearest
             polygon within 40 m). It decides what foot_ratio is worth
  foot_ratio our footprint's area over the inventory's own figure for the same
             building. Outside 0.25-3.5 we publish no height at all. INDEPENDENT
             ONLY WHEN match="centroid": on a snapshot_id row both numbers are
             the same polygon measured two ways and the ratio is a constant 1.007
  city_h     City of Austin 2017 footprint height (ELEVATION - BASE_ELEVATION, ft->m)
  city_cover fraction of OUR footprint the city polygon covers, and
  city_ratio that polygon's area over ours. TRUST FLAGS, and they fail in
             opposite directions: well below 1.0 cover means the city drew our
             building as several polygons; a ratio well above 1 means the city
             polygon is a whole block and its height belongs to somebody else
  trust      good / fair / poor / none, plus `why` when it is not good

It answers nothing about walls and nothing about night: lidar is nadir.

Re-run (the target list is committed, so this reproduces from a clean checkout):
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
  * A height with no footprint check is worthless. 90 of the model-area
    buildings are absent from the detailed snapshot and get matched by nearest
    centroid onto the tiled outer ring; that match landed on a 12 m^2 corner of
    a 4029 m^2 tower and nothing downstream could see it. foot_ratio is the test
    FOR THOSE 90 ONLY - see the FOOT_OK comment. The other 462 are matched by
    snapshot id, and there the ratio compares a polygon with itself.
  * Non-class-6 returns are NOT a spare roof. Class 1 over a 2017 construction
    site is the tower crane, and class 7 is noise. Neither is promoted to a height.
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
import zlib

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

# The model-area target list, IN THE REPO, so this bake reproduces from a clean
# checkout. It is an input, not an output: --write-targets regenerates it from
# whatever curated inventory you point at, and that is the only thing that
# writes it. data/massing.json remains this bake's single output file.
TARGETS_FILE = "data/massing_targets.json"
TARGET_KEYS = ("slug", "name", "area", "tier", "lng", "lat",
               "footprint_area_m2", "height_m", "snapshot_ids")

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
MIN_FILL_FOR_ROOF = 25.0    # % of the raster's own bounding box that must carry a
                            # return; below it the "roof" is scattered fragments
MAX_SLOPE_FOR_ROOF = 45.0   # deg. A median cell-to-cell slope above this is not a
                            # roof surface at all - it is a column of FACADE returns
                            # rasterised in plan. Towers measured through a sliver
                            # footprint read 70-80 deg and used to ship as "pitched".
SPLIT_FAIL_CONF = 0.45      # roof_conf ceiling once the two random halves disagree
LATE_CONF = 0.45        # roof_conf ceiling on a late_build row. The roof is real,
                        # but it is the 2017 SITE's roof, not this building's:
                        # ten rows used to ship a flat/pitched verdict at 0.75-1.00
                        # describing whatever stood here before the tower did.
CITY_TRUST = 0.90       # city polygon must cover this much of our footprint
CITY_RATIO_MAX = 2.0    # ... and be no more than this many times its area
# Our footprint area over the inventory's own footprint_area_m2 for the same
# building. Inside FOOT_OK we say nothing; between FOOT_OK and FOOT_REFUSE the
# footprint is a fragment (heights survive, area/density/roof do not); outside
# FOOT_REFUSE we publish no height at all, because we cannot say what we measured.
#
# READ match FIRST. This ratio is only an INDEPENDENT comparison on the rows
# matched by centroid (match="centroid"), where the inventory's area was
# measured on a different polygon from ours. On a match="snapshot_id" row the
# inventory names the very snapshot feature we measure, so both numbers describe
# the SAME polygon and the ratio collapses to the two formulas' constant,
# 111320/110540 = 1.007: 401 of 462 such rows sit inside 1.000-1.015 and only 2
# are flagged, against 48 of the 90 centroid rows. It cannot catch a wrong
# snapshot_id. What tests those footprints is the city polygon - city_cover and
# city_ratio, an outline drawn by somebody else.
FOOT_OK = (0.5, 2.0)
FOOT_REFUSE = (0.25, 3.5)
FOOT_CONST = (1.000, 1.015)   # the degenerate band: same polygon, two formulas
FOOT_PART_CONF = 0.6    # roof_conf ceiling on a fragment of a footprint
PIT_DEPTH = 2.0         # m. Class-2 ground INSIDE the footprint sitting this far
                        # below the ring outside it is an excavated basement:
                        # the site was under construction when the plane flew.
LATE_GAP = 8.0          # m of disagreement between the model and the lidar before
                        # we call the building late (either direction)
CLASS_GROUND, CLASS_VEG_HI, CLASS_BUILDING, CLASS_WATER = 2, 5, 6, 9
CLASS_NOISE = (7, 18)   # ASPRS low/high noise. Dropped before anything is measured:
                        # a single class-7 return used to be able to set h_nv.


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
                inv_h=b.get("height_m"), inv_area=b.get("footprint_area_m2"),
                # The inventory NAMED these features, so its footprint_area_m2 is
                # our own polygon measured with a different earth constant.
                # foot_ratio cannot be an independent check here; record that.
                match="snapshot_id",
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
                # Proximity, not identity: a different polygon supplies the area,
                # so foot_ratio is a real cross-check on exactly these rows.
                add(key, best[1], slug=b.get("slug"), name=b.get("name"),
                    area=b.get("area"), tier=b.get("tier"), snapshot_ids=[],
                    inv_h=b.get("height_m"), inv_area=b.get("footprint_area_m2"),
                    match="centroid", src_file=best[3])
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

def osm_bbox(targets):
    """Overpass extent for a target list, padded. Always the FULL list."""
    lons = [t["lon"] for t in targets]
    lats = [t["lat"] for t in targets]
    return (min(lons) - 0.002, min(lats) - 0.002, max(lons) + 0.002, max(lats) + 0.002)


def load_osm(cache, bbox, log=print, required=True):
    """The Overpass extract for bbox, cached.

    Overpass answers 504 under load often enough to matter - it did it twice in
    a row while this was being checked. That used to cost one log line and then
    a normal-looking bake: every osm id in the run silently became null, and
    data/massing.json was rewritten with 487 join keys removed and nothing in it
    saying why. A run whose OSM fetch failed is now an ERROR unless --no-osm
    says the operator meant it.
    """
    path = os.path.join(cache, "osm_buildings.json")
    bpath = path + ".bbox"
    # The cache file used to be keyed by its directory alone, so the FIRST run to
    # touch a cache froze the extent for every run after it. A --only run drew a
    # bbox round its own handful of buildings, and every later full run silently
    # matched OSM ids against that little window. The bbox the extract was
    # fetched for is recorded next to it now, and a request outside it refetches.
    if os.path.exists(path) and os.path.exists(bpath):
        try:
            old = json.load(open(bpath))
            if not (old[0] <= bbox[0] and old[1] <= bbox[1]
                    and old[2] >= bbox[2] and old[3] >= bbox[3]):
                log("  osm cache covers %s, need %s - refetching"
                    % (["%.4f" % v for v in old], ["%.4f" % v for v in bbox]))
                os.remove(path)
        except Exception:
            pass
    elif os.path.exists(path):
        log("  osm cache has no recorded bbox (fetched by an older bake); "
            "delete %s to be sure of its extent" % path)
    if not os.path.exists(path):
        log("  overpass bbox %s" % ["%.4f" % v for v in bbox])
        q = ('[out:json][timeout:180];(way["building"](%f,%f,%f,%f);'
             'relation["building"](%f,%f,%f,%f););out geom;') % (
            bbox[1], bbox[0], bbox[3], bbox[2], bbox[1], bbox[0], bbox[3], bbox[2])
        last = None
        for attempt, wait in enumerate((0, 15, 45)):
            if wait:
                time.sleep(wait)
            try:
                req = urllib.request.Request(
                    OVERPASS, data=urllib.parse.urlencode({"data": q}).encode(), headers=UA)
                d = urllib.request.urlopen(req, timeout=300).read()
                open(path, "wb").write(d)
                json.dump(list(bbox), open(bpath, "w"))
                last = None
                break
            except Exception as e:
                last = e
                log("  overpass attempt %d failed (%s)" % (attempt + 1, str(e)[:60]))
        if last is not None:
            if required:
                raise RuntimeError(
                    "Overpass failed 3 times (%s). Every osm id in this run would "
                    "be null and the output would look normal, so the bake stops "
                    "here. Re-run it, or pass --no-osm if you mean to publish "
                    "without join keys." % str(last)[:80])
            log("  overpass failed - osm ids will be null (--no-osm)")
            return []
    try:
        j = json.load(open(path, encoding="utf-8"))
    except Exception as e:
        # This used to return [] in silence, which is indistinguishable from
        # "no buildings here" and quietly drops every osm id in the run.
        log("  osm cache unreadable (%s) - osm ids will be null" % str(e)[:60])
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


def roof_verdict(flat_pct, cells, dens, fill=None, slope_med=None):
    """flat / pitched / mixed with a confidence in 0..1, or (None, 0, reason)
    when the 2017 density or the geometry cannot support a call.

    Returns (verdict, conf, declined_because).
    """
    if flat_pct is None:
        return None, 0.0, "no_slope"
    if cells < MIN_CELLS_FOR_ROOF:
        return None, 0.0, "roof_too_small"
    if dens < MIN_D_FOR_ROOF:
        return None, 0.0, "too_sparse"
    if fill is not None and fill < MIN_FILL_FOR_ROOF:
        return None, 0.0, "raster_patchy"
    if slope_med is not None and slope_med > MAX_SLOPE_FOR_ROOF:
        # 78 deg over a 0.5 m cell is 2.5 m of rise per cell. That is the side of
        # a building seen from above, not its top.
        return None, 0.0, "facade_not_roof"
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
    return v, round(conf, 2), None


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
    # Cross-check our footprint against the one the inventory measured for the
    # SAME building. 90 of the model-area buildings are not in the detailed
    # snapshot and are matched by nearest centroid onto data/outer_ring.geojson,
    # which is drawn as tiles: that match can land on a 12 m^2 corner of a 4000
    # m^2 tower. Without this test nothing downstream can tell.
    #
    # It is a test on THOSE rows. Where match="snapshot_id" the inventory's
    # area was measured on the polygon we are measuring now, so the ratio is the
    # two formulas' constant and proves nothing; `match` ships so a reader can
    # tell the two cases apart instead of reading 1.007 as agreement.
    if t.get("inv_area"):
        res["inv_area_m2"] = t["inv_area"]
        res["foot_ratio"] = round(area / float(t["inv_area"]), 3)
    for k in ("slug", "name", "apartment", "area", "tier", "snap_h", "snap_floors",
              "inv_h", "auth_h", "match"):
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
    # ASPRS noise classes go first, before ground, heights or h_nv see them.
    keep = ~np.isin(C, CLASS_NOISE)
    if not keep.all():
        res["noise_n"] = int((~keep).sum())
        X, Y, Z, C = X[keep], Y[keep], Z[keep], C[keep]
    if len(Z) == 0:
        res["trust"] = "none"
        res["why"] = "no_points"
        return res
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

    # Where the class-2 ground INSIDE the footprint sits relative to the ring
    # outside it. A basement excavation reads several metres negative, and that
    # is the one unambiguous signature of a construction site in this data.
    if gnd_in >= 30:
        res["gnd_in_dz"] = round(float(np.median(Z[inb & (C == CLASS_GROUND)])) - ground, 2)

    # Every non-vegetation, non-water, non-noise return inside the footprint.
    # DIAGNOSTIC ONLY. It is NOT a height: on a construction site it is the
    # crane, and class 1 alone can carry it. Signature 1909 reads 74.68 m here
    # off 2167 class-1 points whose median is 5.9 m BELOW grade, over 6127
    # class-2 points sitting 8 m below grade in the pit. Nothing is promoted
    # from this number - a building with no class-6 returns gets no height.
    nonveg = inb & ~np.isin(C, (3, 4, CLASS_VEG_HI, CLASS_WATER))
    h_nv = (float(np.percentile(Z[nonveg], 99)) - ground) if int(nonveg.sum()) >= 50 else None
    if h_nv is not None:
        res["h_nv"] = round(h_nv, 2)

    if n < 20:
        # No class-6 points: nothing we can call a roof stood here in 2017.
        res["n"] = n
        res["d"] = round(n / area, 2)
        if veg:
            res["veg_n"] = veg
        res["trust"] = "none"
        pit = res.get("gnd_in_dz")
        res["why"] = (
            "water" if wat > max(n, 10) else
            # ground inside the footprint sunk below the ground outside it
            "construction_in_2017" if (pit is not None and pit < -PIT_DEPTH) else
            # mostly ground returns and nothing above 3 m: open ground in 2017
            "vacant_in_2017" if (gnd_in > 0.4 * max(inb.sum(), 1)
                                 and (h_nv is None or h_nv <= 3.0)) else
            "tree_cover" if veg > max(n, 10) else
            "no_class6" if inb.sum() > 20 else "footprint_mismatch")
        return assess(res)

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
    v, conf, declined = roof_verdict(flat_pct, cells, res["d"], fill, slope_med)
    if v:
        res["roof"] = v
        res["roof_conf"] = conf
    elif declined:
        res["roof_no"] = declined

    # Split-half stability: does HALF this building's points give the same
    # verdict? It measures REPEATABILITY, not correctness - a biased estimator
    # agrees with itself perfectly - so it can only ever lower the confidence,
    # never raise it. A verdict its own halves will not reproduce is capped.
    if v and n >= 60:
        idx = rng.permutation(n)
        agree = True
        for half in (idx[:n // 2], idx[n // 2:]):
            _l, hs, fp, cl, hf = roof_stats(h[half], lx[half], ly[half])
            hv, _c, _d = roof_verdict(fp, cl, res["d"] / 2.0, hf, hs)
            if hv != v:
                agree = False
        res["split_agree"] = bool(agree)
        if not agree:
            res["roof_conf"] = min(res["roof_conf"], SPLIT_FAIL_CONF)

    return assess(res)


def assess(res):
    """Trust flags, recomputed from the stored fields alone.

    Kept separate from the measurement so the thresholds above can be changed
    and re-applied to the cached results without re-reading a single point.

    ONE EXCEPTION, and it is not re-derivable here: the failure reasons that
    measure() decides from the raw returns - tree_cover, vacant_in_2017,
    construction_in_2017 - are carried through, not recomputed. Nothing stored
    on a failure row can reconstruct them (the points are gone), so changing
    those thresholds needs --force, not a rewrite. 14 rows are in that state.
    """
    # -- the footprint cross-check runs first and can veto everything else ----
    fr = res.get("foot_ratio")
    foot = None
    if fr is not None:
        if fr < FOOT_REFUSE[0] or fr > FOOT_REFUSE[1]:
            foot = "footprint_mismatch"
        elif fr < FOOT_OK[0] or fr > FOOT_OK[1]:
            foot = "footprint_partial"
    if foot == "footprint_mismatch":
        # Our polygon is not this building. Whatever the returns inside it say,
        # we cannot claim it is this building's roof - so we publish no height,
        # no density and no roof form, only the two areas that prove the clash.
        for k in ("h_max", "h_p99", "h_med", "h_nv", "levels", "roof", "roof_conf",
                  "roof_no", "slope_med", "flat_pct", "fill", "split_agree", "d",
                  "late_build", "gnd_in_dz"):
            res.pop(k, None)
        res["trust"] = "none"
        res["why"] = "footprint_mismatch"
        return res
    if res.get("h_max") is None:
        # A failure row. Its reason came from measure(); add the footprint flag
        # if there is one, because a fragment explains a lot of "nothing here".
        if foot and foot not in (res.get("why") or ""):
            res["why"] = ((res.get("why") + ",") if res.get("why") else "") + foot
        return res
    cc = res.get("city_cover")
    why = []
    if foot:
        why.append(foot)
        # half a footprint is still a real roof, but area, density and the roof
        # raster are all measured over the wrong extent: cap what we claim.
        if res.get("roof_conf") is not None:
            res["roof_conf"] = min(res["roof_conf"], FOOT_PART_CONF)
    # The flight is from 2017. A building the model says is much taller than
    # anything the lidar found on that footprint was built after the plane flew:
    # these heights are the SITE's 2017 heights, not this building's.
    # the tallest thing the MODEL claims stands here, from any of its own sources
    sh = max([v for v in (res.get("snap_h"), res.get("inv_h"), res.get("auth_h"))
              if v is not None] or [0])
    res.pop("late_build", None)
    if sh and (sh - res["h_max"]) > LATE_GAP:
        res["late_build"] = True
        why.append("built_after_2017")
        # The roof verdict describes whatever stood on this site in 2017, not
        # this building. It can be a perfectly repeatable reading of the wrong
        # roof: the-standard shipped "flat" at 0.92 and union-on-san-antonio
        # "flat" at 0.88 for buildings that did not exist when the plane flew.
        # roof_conf is meant to be readable on its own, so cap it here too.
        if res.get("roof_conf") is not None:
            res["roof_conf"] = min(res["roof_conf"], LATE_CONF)
    elif sh and (res["h_max"] - sh) > LATE_GAP and not res.get("city_h"):
        # The other direction, which nothing used to catch: the lidar reads far
        # ABOVE everything the model claims, on a footprint the 2017 city layer
        # does not carry either. Nothing here corroborates the height.
        why.append("lidar_above_model")
    # Non-vegetation returns reaching well above the class-6 roof. This is a
    # QUESTION, not a correction: it is sometimes an unclassified roof and
    # sometimes a crane, a neighbour's wall, or a stray class-1 return. East
    # Campus Garage reads 63 m here against a class-6 roof of 22.05 m that
    # agrees with the city's 19.54 m - there, h_nv is the wrong number.
    if res.get("h_nv") is not None and res["h_nv"] > res["h_max"] + 5.0:
        why.append("returns_above_roof")
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
    elif "sparse" in why or n < 60 or res.get("late_build"):
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
                    help="model-area inventory.json (default: %s in the repo)" % TARGETS_FILE)
    ap.add_argument("--write-targets", action="store_true",
                    help="copy the --inventory list into %s (the committed input "
                         "list) and stop" % TARGETS_FILE)
    ap.add_argument("--all-snapshot", action="store_true",
                    help="measure every feature in the snapshot instead of a target list")
    ap.add_argument("--cache", default=default_cache())
    ap.add_argument("--out", default=None)
    ap.add_argument("--depth", type=int, default=12)
    ap.add_argument("--workers", type=int, default=5)
    ap.add_argument("--batch", type=int, default=120)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--only", default=None, help="comma-separated ids or slugs")
    ap.add_argument("--plan", action="store_true", help="report the node plan and stop")
    ap.add_argument("--report", action="store_true", help="print the summary table from the cache")
    ap.add_argument("--check", action="store_true",
                    help="assert the published invariants on data/massing.json and stop")
    ap.add_argument("--force", action="store_true", help="re-measure cached buildings")
    ap.add_argument("--osm-refresh", action="store_true",
                    help="re-match OSM ids against the cached results and rewrite the output "
                         "(no lidar work; use after widening the Overpass bbox)")
    ap.add_argument("--no-city", action="store_true")
    ap.add_argument("--no-osm", action="store_true",
                    help="publish without OSM join keys instead of erroring when "
                         "the Overpass fetch fails")
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

    if a.check:
        log("checking %s" % out_path)
        sys.exit(1 if check(out_path, log) else 0)

    log("snapshot %s | cache %s" % (snapshot, a.cache))
    inv_path = a.inventory or os.path.join(repo, TARGETS_FILE)
    if a.write_targets:
        if not a.inventory or not os.path.exists(a.inventory):
            sys.exit("--write-targets needs --inventory <curated inventory.json>")
        src = json.load(open(a.inventory, encoding="utf-8"))
        out = [dict((k, b.get(k)) for k in TARGET_KEYS if b.get(k) is not None)
               for b in src]
        tp = os.path.join(repo, TARGETS_FILE)
        json.dump(out, open(tp, "w", encoding="utf-8"), separators=(",", ":"))
        log("wrote %s (%d buildings, %.0f KB)"
            % (tp, len(out), os.path.getsize(tp) / 1024.0))
        return

    if not a.all_snapshot and not os.path.exists(inv_path):
        # Silence here used to mean "measure every feature in the snapshot",
        # which produced a DIFFERENT target set with different ids and looked
        # like a successful bake. It is an error now.
        sys.exit("no target list at %s.\n"
                 "  Run --write-targets --inventory <inventory.json> once, or pass\n"
                 "  --all-snapshot to deliberately measure the whole snapshot."
                 % inv_path)

    targets, feats, inv = load_targets(repo, snapshot, None if a.all_snapshot else inv_path, log)
    if a.all_snapshot:
        log("--all-snapshot: every feature in the snapshot")
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

    # The Overpass extent is drawn round the WHOLE target list, never round the
    # selection, so --only cannot fetch a different extract from a full run's.
    #
    # Measured, a narrow bbox was NOT what dropped an osm id: refetched for five
    # buildings it returned 467 ways and matched all five exactly as the full
    # 9704-element extract does (capitol w25758443, welch-hall None in both).
    # The id that went missing went missing to an Overpass 504 - see load_osm.
    # What a per-selection bbox really did was freeze a cache: the extract was
    # keyed by its directory alone, so the first --only run to touch a cache
    # decided the extent for every full run after it. Both ends are closed now.
    all_targets = list(targets)
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
        bbox = osm_bbox(all_targets)
        oidx = osm_index(load_osm(a.cache, bbox, log, required=not a.no_osm))
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

    bbox = osm_bbox(all_targets)
    oidx = osm_index(load_osm(a.cache, bbox, log, required=not a.no_osm))
    city = None if a.no_city else CityFootprints(a.cache, log)

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
                # Seeded from the building's own key, so --only <one building>
                # reproduces the split-half result a full run gives it. A single
                # shared generator advances in target order and does not.
                rng = np.random.default_rng(zlib.crc32(t["key"].encode("utf-8")) ^ 0x3039)
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


def check(path, log=print):
    """Assert, on the SHIPPED file, every invariant this bake's page claims.

    The page is not the evidence; this is. Each assertion below is a sentence
    somewhere in docs/massing-from-lidar.md, and a page that drifts off the file
    fails here rather than being believed. Returns the number of failures.
    """
    doc = json.load(open(path, encoding="utf-8"))
    rows, meta = doc["buildings"], doc["meta"]
    bad = []
    ran = []

    def want(cond, msg):
        ran.append(msg)
        log("  %s  %s" % ("ok  " if cond else "FAIL", msg))
        if not cond:
            bad.append(msg)

    measured = [r for r in rows if r.get("h_p99") is not None]
    want(all(r.get("match") in ("snapshot_id", "centroid") for r in rows),
         "every row records how its footprint was matched")
    want(not [r for r in rows
              if r.get("foot_ratio") is not None
              and not (FOOT_REFUSE[0] <= r["foot_ratio"] <= FOOT_REFUSE[1])
              and any(r.get(k) is not None for k in ("h_max", "d", "roof"))],
         "no height, density or roof form outside foot_ratio %s" % (FOOT_REFUSE,))
    want(not [r for r in rows if r.get("split_agree") is False
              and (r.get("roof_conf") or 0) >= 0.70],
         "no roof verdict at conf >= 0.70 that its own halves will not reproduce")
    want(not [r for r in rows if r.get("late_build")
              and (r.get("roof_conf") or 0) >= 0.70],
         "no roof verdict at conf >= 0.70 on a building the 2017 flight predates")
    want(not [r for r in rows if "footprint_partial" in (r.get("why") or "")
              and (r.get("roof_conf") or 0) > FOOT_PART_CONF],
         "no roof verdict above %.2f on a fragment of a footprint" % FOOT_PART_CONF)
    want(not [r for r in rows if "footprint_mismatch" in (r.get("why") or "")
              and r.get("h_max") is not None],
         "no height at all where the polygon is not the building")

    # The counts the page quotes have to be the file's counts. A flag count and
    # the count of rows meeting that flag's condition are DIFFERENT numbers and
    # the page has already confused them once, so both are published and both
    # are re-derived here.
    cond = meta.get("conditions", {})
    want(cond.get("city_cover_lt_0_90") == sum(
        1 for r in rows if r.get("city_cover") is not None and r["city_cover"] < CITY_TRUST),
         "meta.conditions.city_cover_lt_0_90 re-derives from the rows")
    want(cond.get("city_ratio_gt_2") == sum(
        1 for r in rows if r.get("city_ratio") is not None and r["city_ratio"] > CITY_RATIO_MAX),
         "meta.conditions.city_ratio_gt_2 re-derives from the rows")
    want(cond.get("late_build") == sum(1 for r in rows if r.get("late_build")),
         "meta.conditions.late_build re-derives from the rows")
    for k, v in (meta.get("flags") or {}).items():
        n = sum(1 for r in rows if k in (r.get("why") or "").split(","))
        want(v == n, "meta.flags.%s = %d re-derives from the rows" % (k, n))
    c = meta.get("counts", {})
    want(c.get("buildings") == len(rows) and c.get("measured") == len(measured),
         "meta.counts matches the rows it describes")
    want(c.get("match_snapshot_id", 0) + c.get("match_centroid", 0) == len(rows),
         "every row is in one match class or the other")

    # foot_ratio's reach. Not a pass/fail - a number the page must keep quoting
    # correctly, because reading 1.007 as agreement is the mistake it invites.
    snapm = [r for r in rows if r.get("match") == "snapshot_id" and r.get("foot_ratio")]
    cent = [r for r in rows if r.get("match") == "centroid" and r.get("foot_ratio")]
    inband = sum(1 for r in snapm if FOOT_CONST[0] <= r["foot_ratio"] <= FOOT_CONST[1])
    log("  note  foot_ratio: snapshot_id %d/%d in the degenerate band %s (same "
        "polygon, two formulas), %d flagged | centroid %d/%d in band, %d flagged"
        % (inband, len(snapm), FOOT_CONST,
           sum(1 for r in snapm if "footprint_" in (r.get("why") or "")),
           sum(1 for r in cent if FOOT_CONST[0] <= r["foot_ratio"] <= FOOT_CONST[1]),
           len(cent),
           sum(1 for r in cent if "footprint_" in (r.get("why") or ""))))
    want(inband > len(snapm) * 0.8,
         "foot_ratio IS degenerate on the snapshot_id rows (so the page must not "
         "cite it as agreement there)")

    # The file itself
    raw = io.open(path, "rb").read()
    want(all(b < 128 for b in bytearray(raw)), "file is ASCII")
    want(len(set(r["id"] for r in rows)) == len(rows), "no duplicate ids")
    want(not [r for r in rows for v in r.values()
              if isinstance(v, float) and v != v], "no NaN")
    want(not [r for r in rows if "polys" in r or "geometry" in r],
         "no polygons redistributed (city layer carries no licence grant)")
    log("")
    log("  %d assertions, %d failed" % (len(ran), len(bad)))
    return len(bad)


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
                      "inv_h", "auth_h", "match"):
                if t.get(k) not in (None, "") and r.get(k) is None:
                    r[k] = t[k]
            if t.get("area") and not r.get("nbhd"):
                r["nbhd"] = t["area"]
    for r in rows:
        assess(r)
    ok = [r for r in rows if r.get("h_p99") is not None]
    # Ground statistics use only footprints that passed the cross-check. A 27 m^2
    # sliver's ground ring is a real elevation somewhere, but it is not this
    # building's, and one of them used to anchor the headline spread on its own.
    gz = [r["ground_z"] for r in rows if r.get("ground_z") is not None
          and "footprint_mismatch" not in (r.get("why") or "")]
    acq = [r["acq"] for r in rows if r.get("acq")]
    meta = dict(
        generated=_dt.datetime.utcnow().strftime("%Y-%m-%d"),
        bake="scripts/bake_massing.py",
        source=dict(name="USGS 3DEP lidar", project=EPT_PROJECT, ept=EPT_BASE,
                    licence="US public domain (USGS 3DEP)",
                    acquired=[min(a[0] for a in acq), max(a[1] for a in acq)] if acq else None,
                    depth=depth),
        city=dict(layer="City of Austin UTILITIESCOMMUNICATION_building_footprints_2017",
                  licence="NOT public domain, and no licence grant found. The "
                          "FeatureServer carries an empty copyrightText and no "
                          "licenseInfo; the City's own AGOL item for this service "
                          "(652d553ee993461289a2d68b464044dc, owner CTM.Publisher) "
                          "states only a liability disclaimer - informational "
                          "purposes, no warranty of accuracy. Checked 2026-09-20. "
                          "Heights are facts; the polygons are not redistributed here",
                  height="ELEVATION - BASE_ELEVATION, feet converted to metres"),
        snapshot=snapshot,
        counts=dict(buildings=len(rows), measured=len(ok),
                    failed=len(rows) - len(ok),
                    footprint_mismatch=sum(1 for r in rows
                                           if "footprint_mismatch" in (r.get("why") or "")),
                    footprint_partial=sum(1 for r in rows
                                          if "footprint_partial" in (r.get("why") or "")),
                    match_snapshot_id=sum(1 for r in rows if r.get("match") == "snapshot_id"),
                    match_centroid=sum(1 for r in rows if r.get("match") == "centroid")),
        # A flag fires only where the measurement it guards exists, so its count
        # is ALWAYS smaller than the count of rows meeting its condition. Both
        # are published, because quoting one under the other's name is how the
        # headline table came to say "cover below 0.90: 106" for a file with 127.
        flags=dict((k, sum(1 for r in rows if k in (r.get("why") or "").split(",")))
                   for k in sorted(set(w for r in rows
                                       for w in (r.get("why") or "").split(",") if w))),
        conditions=dict(
            city_cover_lt_0_90=sum(1 for r in rows if (r.get("city_cover") is not None
                                                       and r["city_cover"] < CITY_TRUST)),
            city_ratio_gt_2=sum(1 for r in rows if (r.get("city_ratio") is not None
                                                    and r["city_ratio"] > CITY_RATIO_MAX)),
            late_build=sum(1 for r in rows if r.get("late_build"))),
        ground=dict(min=round(min(gz), 2), max=round(max(gz), 2),
                    spread=round(max(gz) - min(gz), 2), n=len(gz),
                    basis="footprints that passed the foot_ratio cross-check") if gz else None,
        fields=dict(
            ground_z="median class-2 ground elevation, metres above the lidar datum",
            gnd_in_dz="median class-2 height INSIDE the footprint relative to "
                      "ground_z; a few metres negative is an excavated basement",
            area_m2="area of OUR footprint polygon, EPSG:3857 corrected by cos(lat)",
            match="how this building's footprint was found: snapshot_id (the "
                  "inventory names the snapshot feature - identity, not "
                  "proximity) or centroid (nearest polygon within 40 m). It "
                  "decides what foot_ratio is worth, so read it first",
            inv_area_m2="the inventory's own footprint area for the same building",
            foot_ratio="area_m2 / inv_area_m2. 0.5-2.0 is fine; outside that our "
                       "polygon is a fragment or the wrong building, and outside "
                       "0.25-3.5 no height is published at all. AN INDEPENDENT "
                       "COMPARISON ONLY WHERE match=centroid: on a snapshot_id "
                       "row the inventory measured the polygon we measure, so "
                       "the ratio is the two formulas' constant 1.007 and says "
                       "nothing. There it is city_cover and city_ratio - an "
                       "outline drawn by somebody else - that test the footprint",
            h_max="tallest class-6 point above ground_z, metres",
            h_p99="99th percentile of the same - the robust roof height",
            h_med="median class-6 height - the bulk roof surface",
            levels="[height_m, % of roof cells] roof steps, 0.5 m raster",
            slope_med="median cell-to-cell slope of that raster, degrees",
            flat_pct="% of raster cells below 10 deg",
            fill="% of the raster's bounding box that carries any return",
            roof="flat / pitched / mixed from the slope histogram",
            roof_no="which guard declined a roof call: roof_too_small, too_sparse, "
                    "raster_patchy, facade_not_roof, no_slope",
            roof_conf="0..1 confidence in that verdict. Capped at 0.45 when "
                      "split_agree is false, at 0.6 on a partial footprint and at "
                      "0.45 on a late_build row (where the roof is the 2017 "
                      "SITE's, not this building's), so the number can be read "
                      "on its own",
            split_agree="both random halves of the points gave the same verdict. "
                        "This is REPEATABILITY, not correctness - a biased "
                        "estimator agrees with itself - so it only lowers roof_conf",
            n="class-6 points inside the footprint", d="those points per m^2",
            noise_n="ASPRS class 7/18 returns dropped before measuring",
            city_h="City of Austin 2017 footprint height, metres",
            city_cover="fraction of OUR footprint that city polygon covers",
            city_ratio="that city polygon's area divided by our footprint's. Above ~2 "
                       "the city polygon is a whole block and its height is "
                       "somebody else's building",
            h_nv="99th percentile of every non-vegetation, non-noise return inside "
                 "the footprint. A QUESTION, never a height: well above h_max it "
                 "is sometimes an unclassified roof and sometimes a crane, a "
                 "neighbour's wall or a stray class-1 return. Nothing is derived "
                 "from it",
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
    gz = [r["ground_z"] for r in rows if r.get("ground_z") is not None
          and "footprint_mismatch" not in (r.get("why") or "")]
    if gz:
        log("  ground (trusted footprints, n=%d): %.2f to %.2f m (spread %.2f m)"
            % (len(gz), min(gz), max(gz), max(gz) - min(gz)))


if __name__ == "__main__":
    main()
