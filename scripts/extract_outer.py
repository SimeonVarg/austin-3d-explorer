#!/usr/bin/env python3
"""Step 1 of the OUTER RING pipeline: pull Overture buildings for the tripled bbox.

This is deliberately a sibling of scripts/extract.sh rather than a change to it.
The core bbox (scripts/config.sh) is a *snapshot* — dated, diffed, and the subject
of the date switcher. The outer ring is *context*: it exists so the world does not
end at 30.276, it is not what the diff tour is about, and it must never be allowed
to make the core scene more expensive. Two pipelines, two files, one z-stack.

Reads the same public Overture bucket the core pipeline does, with the same
"fully inside the box" predicate, and writes ONE raw file:

    data/outer/outer_raw.geojson

Everything after this - the culling, the simplification, the dedup against the
core snapshot and the Capitol, the colour tiering - is scripts/bake_outer.py.
This step interprets nothing.

DuckDB is used through the Python module rather than the CLI because the CLI is
not installed on the machine this was written on and `pip install duckdb` is one
line. The SQL is the same shape as scripts/extract_overture.sql.

Usage:  python scripts/extract_outer.py [--release YYYY-MM-DD.N]
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "data", "outer")
OUT = os.path.join(OUT_DIR, "outer_raw.geojson")

# ── The tripled box. Justified in docs/OUTER_RING.md. ─────────────────
# Core (config.sh):  lon -97.752 .. -97.726   lat 30.276 .. 30.296
#                    2.50 km E-W  x  2.23 km N-S
# Outer (here):      lon -97.788 .. -97.702   lat 30.240 .. 30.315
#                    8.27 km E-W  x  8.35 km N-S   =  3.31x  x  3.75x
#
# Asymmetric on purpose, and the asymmetry is about the CAMERA, not the map:
#   south to 30.240  - past Lady Bird Lake and its two bridges, so the downtown
#                      towers have water in front of them from campus. This is
#                      the shot the whole extension is for. The first cut
#                      stopped at 30.250, ON the lake's south bank, and the
#                      along-the-lake shot came back with a correct skyline
#                      standing behind a bare tan plain: at a flying pitch the
#                      near HALF of that frame is the ground you are over, and
#                      it was outside the box. 30.240 clears Oltorf, so South
#                      Congress and Bouldin are the foreground instead.
#   west to -97.788  - the spawn pose faces WSW (bearing 250), so west is the
#                      direction the horizon is actually in frame at load.
#   east to -97.702  - across I-35, so downtown has a backdrop when the camera
#                      is west of it rather than a cliff behind the towers.
#   north to 30.315  - the thinnest reach (2.7 km from spawn) because no
#                      intended flight path looks north for long, but far
#                      enough that the idle-cinema orbit never frames the edge.
BBOX = dict(minlon=-97.7880, minlat=30.2400, maxlon=-97.7020, maxlat=30.3150)

# The core box, verbatim from scripts/config.sh. Extraction here uses the SAME
# "fully inside" predicate the core uses, negated - so a building the core
# extraction took is the exact set this one skips. A footprint that STRADDLES
# the core edge was rejected by the core (not fully inside) and is therefore
# kept here, which is what stops a ring of holes appearing along the seam.
CORE = dict(minlon=-97.752, minlat=30.276, maxlon=-97.726, maxlat=30.296)

BUCKET = "s3://overturemaps-us-west-2/release"
FALLBACK_RELEASE = "2026-06-17.0"


def latest_release():
    """Newest release folder that actually exists in the public bucket."""
    try:
        url = ("https://overturemaps-us-west-2.s3.amazonaws.com/"
               "?list-type=2&prefix=release/&delimiter=/")
        with urllib.request.urlopen(url, timeout=60) as r:
            body = r.read().decode("utf-8", "replace")
        tags = sorted(set(re.findall(r"release/(\d{4}-\d{2}-\d{2}\.\d+)/", body)))
        if tags:
            return tags[-1]
    except Exception as exc:  # noqa: BLE001
        print(f"  release auto-detect failed ({exc})", file=sys.stderr)
    return FALLBACK_RELEASE


SQL = """
INSTALL spatial;  LOAD spatial;
INSTALL httpfs;   LOAD httpfs;
SET s3_region = 'us-west-2';

COPY (
    SELECT
        id,
        names.primary  AS name,
        height         AS overture_height,
        num_floors     AS num_floors,
        class          AS building_class,
        geometry       AS geometry
    FROM read_parquet(
        '{s3}/theme=buildings/type=building/*.parquet',
        hive_partitioning = 1
    )
    WHERE bbox.xmin >= {minlon} AND bbox.xmax <= {maxlon}
      AND bbox.ymin >= {minlat} AND bbox.ymax <= {maxlat}
      -- NOT fully inside the core box: exactly the complement of the core
      -- extraction's own predicate, so nothing is dropped twice and nothing
      -- along the seam is dropped by both.
      AND NOT (bbox.xmin >= {cminlon} AND bbox.xmax <= {cmaxlon}
           AND bbox.ymin >= {cminlat} AND bbox.ymax <= {cmaxlat})
)
TO '{out}'
WITH (FORMAT gdal, DRIVER 'GeoJSON', LAYER_CREATION_OPTIONS 'RFC7946=YES');
"""


def main():
    release = None
    if "--release" in sys.argv:
        release = sys.argv[sys.argv.index("--release") + 1]
    release = release or latest_release()
    s3 = f"{BUCKET}/{release}"

    os.makedirs(OUT_DIR, exist_ok=True)
    print(f"Overture release: {release}")
    print("Outer bbox [{minlon},{minlat} -> {maxlon},{maxlat}]".format(**BBOX))
    print("  minus core [{minlon},{minlat} -> {maxlon},{maxlat}]".format(**CORE))

    import duckdb  # noqa: PLC0415 -- optional dep, only this script needs it

    sql = SQL.format(
        s3=s3, out=OUT.replace("\\", "/"),
        cminlon=CORE["minlon"], cmaxlon=CORE["maxlon"],
        cminlat=CORE["minlat"], cmaxlat=CORE["maxlat"], **BBOX)
    t0 = time.time()
    con = duckdb.connect(":memory:")
    con.execute(sql)
    con.close()

    with open(OUT, encoding="utf-8") as f:
        n = len(json.load(f)["features"])
    print(f"Wrote {n} raw footprints to {OUT} "
          f"({os.path.getsize(OUT) // 1024} KB) in {time.time() - t0:.0f}s")

    meta = os.path.join(OUT_DIR, "outer_source.json")
    with open(meta, "w", encoding="utf-8") as f:
        json.dump({"release": release, "bbox": BBOX, "core_bbox": CORE,
                   "raw_count": n}, f, indent=2)


if __name__ == "__main__":
    main()
