#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fetch the public inputs of the outer-city houses into a work folder OUTSIDE the repo.

    python scripts/fetch_outer_homes_inputs.py overture --work DIR   # footprints           (3 min)
    python scripts/fetch_outer_homes_inputs.py lidar    --work DIR   # 2021 scan -> rasters (1 to 3 h, 24 GB read)
    python scripts/fetch_outer_homes_inputs.py aerial   --work DIR   # 2025 aerial, 0.5 m   (5 min)
    python scripts/fetch_outer_homes_inputs.py truth    --work DIR   # City 2023 outlines   (1 min, measure only)

Nothing here writes inside the repo, and nothing here is shipped: these are
reference inputs to scripts/bake_outer_homes.py and scripts/measure_outer.py.

THE SOURCES AND THEIR LICENCES (docs/outer-homes.md has the full table)

  overture  Overture Maps buildings (here 96 % OpenStreetMap, 4 % Microsoft ML
            Buildings). ODbL / CDLA-Permissive-2.0. The rectangles the app
            ships are derived from these outlines.
  lidar     StratMap "Bexar & Travis Counties Lidar", flown 2021-01-26 to
            2021-03-07, published by TxGIO. CC0-1.0. Read tile by tile out of
            the public quarter-quad zip archives with HTTP range requests, so
            only the 33 tiles over the box are fetched (24 GB of 70) and no
            archive is ever stored. About 3.2 billion points.
  aerial    City of Austin "Aerials2025" image service: 6 inch true colour,
            January 2025. Copyright "City of Austin"; no licence grant found.
            Used to read ONE roof colour per building. No pixel is shipped.
  truth     City of Austin "Building Footprints 2023" (Watershed Protection
            Department), hand digitised from early 2023 imagery, with
            MAX_HEIGHT in feet. No licence grant found. Used ONLY to measure:
            no outline or height from it is in the app.

WHAT `lidar` WRITES (<work>/lidar/raster, about 4.5 GB, 0.5 m cells)
    grid.json  zb_max.f32.npy  zf_max.f32.npy  zv_max.f32.npy  b_cnt.u8.npy
    g_sum.f32.npy  g_cnt.u32.npy  dtm2.f32.npy  done.json
It resumes: a tile listed in done.json is not read again. Two workers may run
at once (`--worker 0 --workers 2` and `--worker 1 --workers 2`); they lock the
rasters around each write. Each needs about 1 GB of memory.
"""
import argparse
import fcntl
import io
import json
import os
import struct
import sys
import time
import zipfile
import zlib

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from outer_homes_lib import FT, OUTER, work_dir, to_m  # noqa: E402

UA = {"User-Agent": "Mozilla/5.0 (compatible; austin-3d-explorer data bake; +https://github.com/SimeonVarg/austin-3d-explorer)"}
OVERTURE_RELEASE = "2026-09-23.1"
LIDAR_ZIP = ("https://data.geographic.texas.gov/447db89a-58ee-4a1b-a61f-b918af2fb0bb/resources/"
             "stratmap21-28cm-50cm-bexar-travis_%s_lpc.zip")
# Quarter-quads over the box: Austin West SE and NE, Austin East SW and NW, and
# the two that hold the strip south of 30.25 (Oak Hill NE, Montopolis NW).
QQUADS = ["3097424", "3097433", "3097422", "3097431", "3097502", "3097511"]
AERIAL = "https://maps.austintexas.gov/image/rest/services/AerialMosaics/Aerials2025/ImageServer/exportImage"
TRUTH = "https://maps.austintexas.gov/arcgis/rest/services/Shared/PlanimetricsSurvey_1/MapServer/0/query"
RES, GRES, ZBASE = 0.5, 2.0, 150.0
MIN_TILE_OVERLAP = 450.0      # m: a tile that only clips the frame by less is not worth 700 MB


# ── overture ──────────────────────────────────────────────────────────
def overture(work):
    import duckdb
    out = os.path.join(work, "overture")
    os.makedirs(out, exist_ok=True)
    con = duckdb.connect(":memory:")
    con.execute("INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
    cols = ("id, names.primary AS name, height, num_floors, class, subtype, roof_shape, "
            "[s.dataset for s in sources] AS src, ST_AsWKB(geometry) AS wkb")
    dst = os.path.join(out, "building.parquet").replace("\\", "/")
    con.execute(f"""COPY (SELECT {cols} FROM read_parquet(
        's3://overturemaps-us-west-2/release/{OVERTURE_RELEASE}/theme=buildings/type=building/*.parquet', hive_partitioning=1)
        WHERE bbox.xmax >= {OUTER[0]} AND bbox.xmin <= {OUTER[2]} AND bbox.ymax >= {OUTER[1]} AND bbox.ymin <= {OUTER[3]})
        TO '{dst}' (FORMAT parquet);""")
    n = con.execute(f"select count(*) from '{dst}'").fetchone()[0]
    json.dump({"release": OVERTURE_RELEASE, "bbox": OUTER, "count": n}, open(os.path.join(out, "source.json"), "w"), indent=1)
    print("overture", OVERTURE_RELEASE, n, "buildings ->", dst)


# ── lidar: a remote zip read by range requests ────────────────────────
class HttpFile(io.RawIOBase):
    def __init__(self, url):
        import requests
        self.url, self.pos, self.rq = url, 0, requests
        r = requests.get(url, headers={**UA, "Range": "bytes=0-0"}, timeout=60)
        r.raise_for_status()
        self.size = int(r.headers["Content-Range"].split("/")[1])

    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else (self.pos + off if whence == 1 else self.size + off)
        return self.pos

    def read(self, n=-1):
        if n < 0:
            n = self.size - self.pos
        if n == 0:
            return b""
        a, b = self.pos, min(self.size, self.pos + n) - 1
        r = self.rq.get(self.url, headers={**UA, "Range": f"bytes={a}-{b}"}, timeout=600)
        r.raise_for_status()
        self.pos = b + 1
        return r.content

    def readinto(self, buf):
        d = self.read(len(buf))
        buf[:len(d)] = d
        return len(d)


def tile_index(work):
    """Every LAZ tile of the six archives with its bounds, read from each tile's own LAS header."""
    import requests
    p = os.path.join(work, "lidar", "tile_index.json")
    if os.path.exists(p):
        return json.load(open(p))
    idx = []
    for q in QQUADS:
        url = LIDAR_ZIP % q
        z = zipfile.ZipFile(io.BufferedReader(HttpFile(url), buffer_size=4 << 20))
        for i in z.infolist():
            if not i.filename.endswith(".laz"):
                continue
            r = requests.get(url, headers={**UA, "Range": f"bytes={i.header_offset}-{i.header_offset + 70000}"}, timeout=120).content
            nlen, xlen = struct.unpack("<HH", r[26:30])
            body = r[30 + nlen + xlen:]
            if i.compress_type == 8:
                body = zlib.decompressobj(-15).decompress(body, 4096)
            assert body[:4] == b"LASF", i.filename
            mxx, mnx, mxy, mny = struct.unpack("<4d", body[179:211])      # LAS 1.4 header
            idx.append(dict(q=q, name=i.filename, size=i.file_size, csize=i.compress_size, ctype=i.compress_type,
                            data_off=i.header_offset + 30 + nlen + xlen, minx=mnx, maxx=mxx, miny=mny, maxy=mxy))
            print("  indexed", i.filename, flush=True)
    json.dump(idx, open(p, "w"), indent=1)
    return idx


def frame(work):
    p = os.path.join(work, "lidar", "raster", "grid.json")
    if os.path.exists(p):
        return json.load(open(p))
    xs, ys = to_m([OUTER[0], OUTER[2], OUTER[0], OUTER[2]], [OUTER[1], OUTER[1], OUTER[3], OUTER[3]])
    m = 60.0
    x0 = np.floor((xs.min() - m) / GRES) * GRES
    x1 = np.ceil((xs.max() + m) / GRES) * GRES
    y0 = np.floor((ys.min() - m) / GRES) * GRES
    y1 = np.ceil((ys.max() + m) / GRES) * GRES
    g = dict(crs="EPSG:6578", res_m=RES, gres_m=GRES, x0_m=float(x0), y_top_m=float(y1),
             ncols=int(round((x1 - x0) / RES)), nrows=int(round((y1 - y0) / RES)), zbase_m=ZBASE,
             flown="2021-01-26..2021-03-07",
             source="StratMap Bexar & Travis Counties Lidar 2021, TxGIO, CC0-1.0",
             note="row 0 is the NORTH edge, column 0 the WEST edge; the frame is the Texas Central grid, "
                  "rotated about 1.3 degrees from true north")
    json.dump(g, open(p, "w"), indent=1)
    return g


def lidar(work, worker, workers):
    import laspy
    import requests
    out = os.path.join(work, "lidar", "raster")
    os.makedirs(out, exist_ok=True)
    G = frame(work)
    NR, NC = G["nrows"], G["ncols"]
    GK = int(GRES / RES)
    GR, GC = NR // GK, NC // GK
    x0, yt = G["x0_m"], G["y_top_m"]

    def mm(name, dtype, shape, fill):
        p = os.path.join(out, name)
        new = not os.path.exists(p)
        a = np.lib.format.open_memmap(p, mode="w+" if new else "r+", dtype=dtype, shape=shape)
        if new:
            a[:] = fill
        return a
    A = dict(zb=mm("zb_max.f32.npy", np.float32, (NR, NC), -np.inf), bc=mm("b_cnt.u8.npy", np.uint8, (NR, NC), 0),
             zf=mm("zf_max.f32.npy", np.float32, (NR, NC), -np.inf), zv=mm("zv_max.f32.npy", np.float32, (NR, NC), -np.inf),
             gs=mm("g_sum.f32.npy", np.float32, (GR, GC), 0), gc=mm("g_cnt.u32.npy", np.uint32, (GR, GC), 0))
    need = []
    for t in tile_index(work):
        ox = min(t["maxx"] * FT, x0 + NC * RES) - max(t["minx"] * FT, x0)
        oy = min(t["maxy"] * FT, yt) - max(t["miny"] * FT, yt - NR * RES)
        if ox > MIN_TILE_OVERLAP and oy > MIN_TILE_OVERLAP:
            need.append(t)
    print(len(need), "tiles,", round(sum(t["size"] for t in need) / 1e9, 1), "GB; frame", NR, "x", NC, flush=True)
    donep = os.path.join(out, "done.json")
    lockp = os.path.join(out, "lock")

    def load_done():
        return json.load(open(donep)) if os.path.exists(donep) else {}

    for i, t in enumerate(need):
        if i % workers != worker or t["name"] in load_done():
            continue
        dst = os.path.join(work, "lidar", t["name"])
        t0 = time.time()
        a, b = t["data_off"], t["data_off"] + t["csize"] - 1
        for attempt in range(5):
            try:
                with requests.get(LIDAR_ZIP % t["q"], headers={**UA, "Range": f"bytes={a}-{b}"}, stream=True, timeout=120) as r:
                    r.raise_for_status()
                    d = zlib.decompressobj(-15) if t["ctype"] == 8 else None
                    with open(dst + ".part", "wb") as f:
                        for chunk in r.iter_content(4 << 20):
                            f.write(d.decompress(chunk) if d else chunk)
                        if d:
                            f.write(d.flush())
                if os.path.getsize(dst + ".part") == t["size"]:
                    os.replace(dst + ".part", dst)
                    break
            except Exception as e:                       # noqa: BLE001
                print("  fetch retry", attempt, e, flush=True)
                time.sleep(10)
        else:
            raise SystemExit("fetch failed: " + t["name"])
        td = time.time() - t0
        # the tile's own window of the frame, snapped to the 2 m ground grid
        c0 = max(0, int((t["minx"] * FT - x0) / RES) - 2)
        c1 = min(NC, int((t["maxx"] * FT - x0) / RES) + 3)
        r0 = max(0, int((yt - t["maxy"] * FT) / RES) - 2)
        r1 = min(NR, int((yt - t["miny"] * FT) / RES) + 3)
        c0 -= c0 % GK
        r0 -= r0 % GK
        h, w = r1 - r0, c1 - c0
        n = h * w
        gh, gw = (h + GK - 1) // GK, (w + GK - 1) // GK
        zb = np.full(n, -np.inf, np.float32)
        zf = np.full(n, -np.inf, np.float32)
        zv = np.full(n, -np.inf, np.float32)
        bc = np.zeros(n, np.uint16)
        gs = np.zeros(gh * gw, np.float64)
        gc = np.zeros(gh * gw, np.uint32)
        seen = 0
        t1 = time.time()
        with laspy.open(dst, laz_backend=laspy.LazBackend.LazrsParallel) as rd:
            for pts in rd.chunk_iterator(5_000_000):
                seen += len(pts)
                X = np.asarray(pts.x) * FT
                Y = np.asarray(pts.y) * FT
                col = np.floor((X - x0) / RES).astype(np.int64) - c0
                row = np.floor((yt - Y) / RES).astype(np.int64) - r0
                ok = (col >= 0) & (col < w) & (row >= 0) & (row < h)
                cls = np.asarray(pts.classification)
                rn = np.asarray(pts.return_number)
                ok &= (cls != 7) & (cls != 18)                       # low and high noise
                z = (np.asarray(pts.z) * FT).astype(np.float32)
                flat = row * w + col
                m = ok & (rn == 1)
                np.maximum.at(zf, flat[m], z[m])
                m = ok & (cls == 6)
                np.maximum.at(zb, flat[m], z[m])
                np.add.at(bc, flat[m], 1)
                m = ok & (cls >= 3) & (cls <= 5)
                np.maximum.at(zv, flat[m], z[m])
                m = ok & (cls == 2)
                gf = (row[m] // GK) * gw + (col[m] // GK)
                gs += np.bincount(gf, weights=z[m].astype(np.float64) - ZBASE, minlength=gh * gw)
                gc += np.bincount(gf, minlength=gh * gw).astype(np.uint32)
        with open(lockp, "w") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)                           # tiles overlap by 40 m: one writer at a time
            for key, arr in (("zb", zb), ("zf", zf), ("zv", zv)):
                blk = A[key][r0:r1, c0:c1]
                np.maximum(blk, arr.reshape(h, w), out=blk)
            blk = A["bc"][r0:r1, c0:c1]
            blk[:] = np.minimum(255, blk.astype(np.uint16) + bc.reshape(h, w)).astype(np.uint8)
            gr0, gc0 = r0 // GK, c0 // GK
            gh2, gw2 = min(gh, GR - gr0), min(gw, GC - gc0)
            A["gs"][gr0:gr0 + gh2, gc0:gc0 + gw2] += gs.reshape(gh, gw)[:gh2, :gw2].astype(np.float32)
            A["gc"][gr0:gr0 + gh2, gc0:gc0 + gw2] += gc.reshape(gh, gw)[:gh2, :gw2]
            for a_ in A.values():
                a_.flush()
            done = load_done()
            done[t["name"]] = dict(points=int(seen), fetch_s=round(td), raster_s=round(time.time() - t1))
            json.dump(done, open(donep, "w"), indent=1)
            fcntl.flock(lk, fcntl.LOCK_UN)
        os.remove(dst)
        print(f"[{i + 1}/{len(need)}] {t['name']} {seen / 1e6:.0f}M points, fetch {td:.0f}s, raster {time.time() - t1:.0f}s", flush=True)
    if len(load_done()) >= len(need):
        dtm(work)
    print("lidar worker", worker, "done", flush=True)


def dtm(work):
    """Bare earth, 2 m cells: the mean ground return per cell, holes (under buildings and trees) filled with the nearest ground."""
    from scipy import ndimage as ndi
    out = os.path.join(work, "lidar", "raster")
    s = np.asarray(np.load(os.path.join(out, "g_sum.f32.npy"), mmap_mode="r"), np.float64)
    n = np.asarray(np.load(os.path.join(out, "g_cnt.u32.npy"), mmap_mode="r"))
    ok = n > 0
    z = np.where(ok, s / np.maximum(n, 1), 0).astype(np.float32)
    _, (ir, ic) = ndi.distance_transform_edt(~ok, return_indices=True)
    z = ndi.median_filter(z[ir, ic], 3) + ZBASE
    np.save(os.path.join(out, "dtm2.f32.npy"), z.astype(np.float32))
    print("dtm2", z.shape, "ground cells with a return: %.1f%%" % (100 * ok.mean()))


# ── aerial ────────────────────────────────────────────────────────────
def aerial(work):
    import requests
    from PIL import Image
    G = frame(work)
    NR, NC = G["nrows"], G["ncols"]
    os.makedirs(os.path.join(work, "img"), exist_ok=True)
    p = os.path.join(work, "img", "aerial2025.u8.npy")
    A = np.lib.format.open_memmap(p, mode="w+" if not os.path.exists(p) else "r+", dtype=np.uint8, shape=(NR, NC, 3))
    donep = os.path.join(work, "img", "done.json")
    done = json.load(open(donep)) if os.path.exists(donep) else []
    T = 3600
    for r0 in range(0, NR, T):
        for c0 in range(0, NC, T):
            key = "%d_%d" % (r0, c0)
            if key in done:
                continue
            h, w = min(T, NR - r0), min(T, NC - c0)
            bb = ((G["x0_m"] + c0 * RES) / FT, (G["y_top_m"] - (r0 + h) * RES) / FT,
                  (G["x0_m"] + (c0 + w) * RES) / FT, (G["y_top_m"] - r0 * RES) / FT)
            # EPSG:2277 is NAD83 Texas Central (ftUS), the service's own frame; it sits
            # within a metre of the scan's NAD83(2011) frame, under one 0.5 m cell or two.
            q = dict(bbox="%.3f,%.3f,%.3f,%.3f" % bb, bboxSR=2277, imageSR=2277, size="%d,%d" % (w, h), format="jpg",
                     compressionQuality=92, interpolation="RSP_BilinearInterpolation", f="image")
            for attempt in range(6):
                try:
                    r = requests.get(AERIAL, params=q, timeout=300)
                    r.raise_for_status()
                    im = np.asarray(Image.open(io.BytesIO(r.content)).convert("RGB"))
                    assert im.shape[:2] == (h, w), im.shape
                    break
                except Exception as e:                   # noqa: BLE001
                    print("  retry", key, e, flush=True)
                    time.sleep(8)
            else:
                raise SystemExit("aerial failed: " + key)
            A[r0:r0 + h, c0:c0 + w] = im
            A.flush()
            done.append(key)
            json.dump(done, open(donep, "w"))
            print("  aerial", key, flush=True)
    print("aerial ->", p)


# ── truth (measure only) ──────────────────────────────────────────────
def truth(work):
    import requests
    os.makedirs(os.path.join(work, "coa"), exist_ok=True)
    feats, off = [], 0
    while True:
        p = dict(where="1=1", geometry="%f,%f,%f,%f" % OUTER, geometryType="esriGeometryEnvelope", inSR=4326,
                 spatialRel="esriSpatialRelIntersects", outFields="OBJECTID,MAX_HEIGHT,ELEVATION,BASE_ELEVATION", outSR=4326,
                 f="geojson", resultOffset=off, resultRecordCount=2000, orderByFields="OBJECTID", geometryPrecision=7)
        fs = requests.get(TRUTH, params=p, timeout=180).json().get("features", [])
        feats += fs
        off += len(fs)
        if len(fs) < 2000:
            break
    json.dump({"type": "FeatureCollection", "features": feats}, open(os.path.join(work, "coa", "footprints2023.geojson"), "w"))
    print("truth", len(feats), "City of Austin 2023 outlines")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("what", choices=["overture", "lidar", "dtm", "aerial", "truth"])
    ap.add_argument("--work")
    ap.add_argument("--worker", type=int, default=0)
    ap.add_argument("--workers", type=int, default=1)
    a = ap.parse_args()
    work = work_dir(a.work)
    os.makedirs(os.path.join(work, "lidar"), exist_ok=True)
    if a.what == "overture":
        overture(work)
    elif a.what == "lidar":
        lidar(work, a.worker, a.workers)
    elif a.what == "dtm":
        dtm(work)
    elif a.what == "aerial":
        aerial(work)
    else:
        truth(work)


if __name__ == "__main__":
    main()
